/**
 * useEffortContent — Load/save effort documents through the effort registry.
 *
 * The registry is the single resolution surface: both tiers live in
 * IndexedDB (bundled = seed rows, user = clones/edits). Save →
 * commitReferenceNote (one atomic transaction: note source + projection +
 * derived links); the document source is canonical — normalization patches
 * the raw document, never just the projection.
 *
 * The document format lives in lang (`effort-registry/definition-markdown`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorSave } from './useEditorSave';
import { effortToDocument, documentToEffort } from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote, deleteReferenceNote } from '@/repositories/referenceNotes';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import { patchFrontmatterProperty } from '@bitcobblers/wod-wiki-core';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import { storageService } from '@/services/storage';
import { toast } from '@/hooks/use-toast';

/**
 * Patch clone identity into the RAW document — one property range per field,
 * so comments, unknown frontmatter fields and the body survive byte-identical.
 * Used by both cloneForEdit and save-time auto-clone, keeping the visible
 * document and the committed source in lockstep.
 */
function patchCloneSource(raw: string, sourceSlug: string, sourceLabel: string): { raw: string; id: string; slug: string; label: string } {
  const id = `effort-user-${crypto.randomUUID()}`;
  const slug = `${sourceSlug}-custom`;
  const label = `${sourceLabel} (Custom)`;
  let next = patchFrontmatterProperty(raw, ['id'], id);
  next = patchFrontmatterProperty(next, ['slug'], slug);
  next = patchFrontmatterProperty(next, ['label'], label);
  next = patchFrontmatterProperty(next, ['registrySource'], 'user');
  next = patchFrontmatterProperty(next, ['derivation', 'parentSlug'], sourceSlug);
  return { raw: next, id, slug, label };
}

export interface UseEffortContentResult {
  /** The full document (YAML frontmatter + body) for NoteEditor */
  document: string;
  /** Set document directly (e.g. from NoteEditor onChange) */
  setDocument: (value: string) => void;
  /** Whether the initial load is complete */
  isLoading: boolean;
  /** The resolved effort (bundled or user); null when not found / create mode */
  effort: IEffort | null;
  /** Whether this effort is editable (user-created or cloned) */
  isEditable: boolean;
  /** True when the slug matches no effort — render the create flow, not an error */
  notFound: boolean;
  /** Save hooks result for manual flush */
  flush: () => Promise<void>;
  onLineChange: (line: number, column: number) => void;
  onBlur: () => void;
  /** Persist the current document (create or update); resolves with the owning note. */
  save: (value?: string) => Promise<{ id: string; sourceRevision: number }>;
  /** Remove this user-owned effort (projection + note + links). */
  remove: () => Promise<void>;
  /** Clone a bundled effort: patches identity into the raw source and persists the copy. */
  cloneForEdit: () => Promise<IEffort | null>;
  /** Error if load failed */
  error: string | null;
  /** True if resolved by alias rather than direct slug */
  isAliasMatch: boolean;
}

/**
 * Load the effort document for a given slug — one resolution surface:
 * the registry (both tiers from IndexedDB).
 */
export function useEffortContent(slug: string | undefined): UseEffortContentResult {
  const { registry, isReady, revision, refresh } = useEffortRegistry();
  const [document, setDocumentState] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [effort, setEffort] = useState<IEffort | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isAliasMatch, setIsAliasMatch] = useState(false);
  const isEditable = effort?.registrySource === 'user';
  const committedNote = useRef<{ id: string; revision: number } | null>(null);
  const loadedSlug = useRef<string | undefined>(undefined);

  // Re-resolve refreshed registries without replacing an active editor draft.
  useEffect(() => {
    if (!isReady) {
      setIsLoading(false);
      return;
    }
    if (!slug) {
      // Create mode: blank editable document.
      loadedSlug.current = undefined;
      setEffort(null);
      setNotFound(false);
      setIsAliasMatch(false);
      committedNote.current = null;
      setError(null);
      setIsLoading(false);
      return;
    }

    const slugChanged = loadedSlug.current !== slug;
    loadedSlug.current = slug;
    let cancelled = false;

    if (slugChanged) {
      committedNote.current = null;
      setIsLoading(true);
      setError(null);
      setNotFound(false);
      setEffort(null);
      setDocumentState('');
    }

    async function load() {
      try {
        // One resolution surface: the registry (both tiers from IndexedDB).
        const direct = registry.resolve(slug!);
        const resolved = direct ?? registry.resolveByAlias(slug!);
        if (!resolved) {
          // A refresh must not reset an unresolved route's create draft.
          if (slugChanged && !cancelled) {
            setNotFound(true);
            setIsLoading(false);
          }
          return;
        }
        const noteId = resolved.ownerNoteId ?? `effort/${resolved.slug}`;
        // Keep live editor text when only the projection changes.
        if (!slugChanged && committedNote.current?.id === noteId) {
          if (!cancelled) {
            setEffort(resolved);
            setIsAliasMatch(!direct);
          }
          return;
        }
        // Preserve a clone being edited under its original route.
        if (!slugChanged && committedNote.current) return;
        const note = await storageService.getNote(noteId);
        if (cancelled) return;
        setEffort(resolved);
        setIsAliasMatch(!direct);
        committedNote.current = { id: noteId, revision: note?.sourceRevision ?? 0 };
        setDocumentState(note?.rawContent ?? effortToDocument(resolved));
        setNotFound(false);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load effort.');
          setIsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, isReady, revision, registry]);

  // Atomic save: one commit (note source + projection + derived links);
  // failure keeps the draft intact. Normalization patches the raw source so
  // document and projection always agree.
  const handleSave = useCallback(async (value: string) => {
    if (!slug && !effort) return;

    const { effort: parsed, errors } = documentToEffort(value, effort ?? undefined);
    if (errors.length > 0) {
      toast({ title: 'Invalid YAML', description: errors.join('\n'), variant: 'destructive' });
      throw new Error(errors.join('\n'));
    }

    let source = value;
    const normalizedSlug = parsed.slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (normalizedSlug !== parsed.slug) {
      parsed.slug = normalizedSlug;
      source = patchFrontmatterProperty(source, ['slug'], normalizedSlug);
    }
    if (parsed.label.trim() !== parsed.label) {
      parsed.label = parsed.label.trim();
      source = patchFrontmatterProperty(source, ['label'], parsed.label);
    }
    parsed.updatedAt = new Date().toISOString();

    // Bundled definitions are read-only: the first edit auto-clones by
    // patching identity into the raw source (no re-serialization).
    if (parsed.registrySource === 'bundled') {
      const patched = patchCloneSource(source, parsed.slug, parsed.label);
      source = patched.raw;
      parsed.id = patched.id;
      parsed.slug = patched.slug;
      parsed.label = patched.label;
      parsed.registrySource = 'user';
      parsed.derivation = { parentSlug: effort?.slug, coefficients: {}, hardOverrides: {} };
    }

    try {
      const noteId = parsed.ownerNoteId ?? committedNote.current?.id ?? `effort/${parsed.slug}`;
      const expectedSourceRevision = committedNote.current?.id === noteId ? committedNote.current.revision : 0;
      const saved = await commitReferenceNote({
        kind: 'effort',
        slug: parsed.slug,
        rawContent: source,
        title: parsed.label,
        expectedSourceRevision,
      });
      committedNote.current = { id: saved.id, revision: saved.sourceRevision };
      await refresh();
      setEffort(parsed);
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save effort.',
        variant: 'destructive',
      });
      throw err;
    }
  }, [slug, effort, refresh]);

  const { onChange, onLineChange, onBlur, flush } = useEditorSave({
    onSave: handleSave,
  });

  // Wrap setDocument to also trigger save mechanics
  const setDocument = useCallback((value: string) => {
    setDocumentState(value);
    onChange(value);
  }, [onChange]);

  const save = useCallback((value?: string) => handleSave(value ?? document), [handleSave, document]);

  const remove = useCallback(async () => {
    const target = effort?.slug ?? slug;
    if (!target) return;
    try {
      await deleteReferenceNote('effort', target);
      committedNote.current = null;
      setEffort(null);
      await refresh();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Failed to delete effort.',
        variant: 'destructive',
      });
      throw err;
    }
  }, [effort, slug, refresh]);

  // Clone a bundled effort: patch identity into the CURRENT raw document and
  // persist the copy immediately — an unpersisted clone would lose its
  // identity if the tab closed. Throws on failure (caller catches); the
  // editable draft stays intact either way.
  const cloneForEdit = useCallback(async (): Promise<IEffort | null> => {
    if (!effort || effort.registrySource !== 'bundled') return null;
    const source = document || effortToDocument(effort);
    const patched = patchCloneSource(source, effort.slug, effort.label);
    const cloned: IEffort = {
      ...effort,
      id: patched.id,
      slug: patched.slug,
      label: patched.label,
      registrySource: 'user',
      derivation: { parentSlug: effort.slug, coefficients: {}, hardOverrides: {} },
      ownerNoteId: `effort/${patched.slug}`,
      sourceId: 'efforts',
      sourcePath: `effort/${patched.slug}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEffort(cloned);
    setDocumentState(patched.raw);
    try {
      const saved = await commitReferenceNote({
        kind: 'effort',
        slug: patched.slug,
        rawContent: patched.raw,
        title: patched.label,
        expectedSourceRevision: 0,
      });
      committedNote.current = { id: saved.id, revision: saved.sourceRevision };
      await refresh();
    } catch (err) {
      toast({
        title: 'Clone not saved',
        description: err instanceof Error ? err.message : 'Failed to save the cloned copy.',
        variant: 'destructive',
      });
      throw err;
    }
    return cloned;
  }, [effort, document, refresh]);

  return {
    document,
    setDocument,
    isLoading,
    effort,
    isEditable,
    notFound,
    flush,
    onLineChange,
    onBlur,
    save,
    remove,
    cloneForEdit,
    error,
    isAliasMatch,
  };
}
