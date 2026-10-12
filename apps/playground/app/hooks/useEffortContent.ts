/**
 * useEffortContent — Load/save effort documents through the effort registry.
 *
 * The registry is the single resolution surface: both tiers live in
 * IndexedDB (bundled = seed rows, user = clones/edits) — docs/prototypes/
 * seed-data-unification.md. Save → registry.upsert() (which persists via
 * the storage adapter); editing a bundled effort auto-clones `-custom`.
 *
 * The document format is YAML frontmatter + body (effort-markdown.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorSave } from './useEditorSave';
import { effortToDocument, documentToEffort } from '@/repositories/effort-markdown';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import { storageService } from '@/services/storage';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { toast } from '@/hooks/use-toast';

export interface UseEffortContentResult {
  /** The full document (YAML frontmatter + body) for NoteEditor */
  document: string;
  /** Set document directly (e.g. from NoteEditor onChange) */
  setDocument: (value: string) => void;
  /** Whether the initial load is complete */
  isLoading: boolean;
  /** The resolved effort (bundled or user) */
  effort: IEffort | null;
  /** Whether this effort is editable (user-created or cloned) */
  isEditable: boolean;
  /** Save hooks result for manual flush */
  flush: () => Promise<void>;
  /** Clone a bundled effort so it becomes editable */
  cloneForEdit: () => IEffort | null;
  /** Error if load failed */
  error: string | null;
  /** True if resolved by alias rather than direct slug */
  isAliasMatch: boolean;
}

/**
 * Load the effort document for a given slug — one resolution surface:
 * the registry (bundled + user tiers from IndexedDB).
 */
export function useEffortContent(slug: string | undefined): UseEffortContentResult {
  const { registry, isReady, refresh } = useEffortRegistry();
  const [document, setDocumentState] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [effort, setEffort] = useState<IEffort | null>(null);
  const [isAliasMatch, setIsAliasMatch] = useState(false);
  const isEditable = effort?.registrySource === 'user';
  const hasClonedRef = useRef(false);
  const committedNote = useRef<{ id: string; revision: number } | null>(null);

  // Load effort on mount / slug change
  useEffect(() => {
    if (!isReady || !slug) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    hasClonedRef.current = false;

    async function load() {
      try {
        // One resolution surface: the registry (both tiers from IndexedDB).
        const direct = registry.resolve(slug);
        const resolved = direct ?? (typeof registry.resolveByAlias === 'function' ? registry.resolveByAlias(slug) : null);
        const note = resolved ? await storageService.getNote(`effort/${resolved.slug}`) : undefined;
        if (resolved && !cancelled) {
          setEffort(resolved);
          setIsAliasMatch(!direct);
          committedNote.current = { id: `effort/${resolved.slug}`, revision: note?.sourceRevision ?? 0 };
          setDocumentState(note?.rawContent ?? effortToDocument(resolved));
          setIsLoading(false);
          return;
        }

        if (!cancelled) {
          setError(`Effort "${slug}" not found.`);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load effort.');
          setIsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, isReady, registry]);

  // Debounced save to registry + IDB
  const handleSave = useCallback(async (value: string) => {
    if (!slug || !effort) return;

    // Parse document back to effort
    const { effort: parsed, errors } = documentToEffort(value, effort);
    if (errors.length > 0) {
      toast({
        title: 'Invalid YAML',
        description: errors.join('\n'),
        variant: 'destructive',
      });
      throw new Error(errors.join('\n'));
    }

    // Normalize
    parsed.slug = parsed.slug.trim().toLowerCase().replace(/\s+/g, '-');
    parsed.label = parsed.label.trim();
    parsed.updatedAt = new Date().toISOString();

    // If bundled, auto-clone on first edit
    if (parsed.registrySource === 'bundled') {
      parsed.id = `effort-user-${crypto.randomUUID()}`;
      parsed.slug = `${parsed.slug}-custom`;
      parsed.label = `${parsed.label} (Custom)`;
      parsed.registrySource = 'user';
      parsed.derivation = {
        parentSlug: effort.slug,
        coefficients: {},
        hardOverrides: {},
      };
      hasClonedRef.current = true;
    }

    try {
      const noteId = `effort/${parsed.slug}`;
      const expectedSourceRevision = committedNote.current?.id === noteId ? committedNote.current.revision : 0;
      const provider = new IndexedDBContentProvider();
      const saved = expectedSourceRevision > 0
        ? await provider.updateEntry(noteId, { rawContent: value, expectedSourceRevision, title: parsed.label, slug: noteId })
        : await provider.saveEntry({ id: noteId, title: parsed.label, slug: noteId,
            rawContent: value, tags: [], targetDate: Date.now(), type: 'note', sourceId: 'effort' });
      committedNote.current = { id: saved.id, revision: saved.sourceRevision! };
      await registry.upsert(parsed);
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
  }, [slug, effort, registry, refresh]);

  const { onChange, onLineChange, onBlur, flush } = useEditorSave({
    onSave: handleSave,
    lineIdleMs: 1200,
  });

  // Wrap setDocument to also trigger save mechanics
  const setDocument = useCallback((value: string) => {
    setDocumentState(value);
    onChange(value);
  }, [onChange]);

  // Clone helper for bundled efforts
  const cloneForEdit = useCallback((): IEffort | null => {
    if (!effort || effort.registrySource !== 'bundled') return null;
    const cloned: IEffort = {
      ...effort,
      id: `effort-user-${crypto.randomUUID()}`,
      slug: `${effort.slug}-custom`,
      label: `${effort.label} (Custom)`,
      registrySource: 'user',
      derivation: {
        parentSlug: effort.slug,
        coefficients: {},
        hardOverrides: {},
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEffort(cloned);
    setDocumentState(effortToDocument(cloned));
    hasClonedRef.current = true;
    return cloned;
  }, [effort]);

  return {
    document,
    setDocument,
    isLoading,
    effort,
    isEditable,
    flush,
    cloneForEdit,
    error,
    isAliasMatch,
  };
}
