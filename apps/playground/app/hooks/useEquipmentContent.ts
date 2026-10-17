/**
 * useEquipmentContent — Load/save equipment documents through the equipment
 * registry; the equipment twin of useEffortContent.
 *
 * The registry is the single resolution surface: both tiers live in
 * IndexedDB (bundled = seed rows, user = custom definitions). Save →
 * commitReferenceNote (one atomic transaction: note source + projection +
 * derived links); bundled definitions are cloned via a source-preserving
 * raw patch, never re-serialized.
 *
 * The document format is YAML frontmatter + body (equipment-markdown.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorSave } from './useEditorSave';
import { equipmentToDocument, documentToEquipment } from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote, deleteReferenceNote } from '@/repositories/referenceNotes';
import { useEquipmentRegistry } from '../contexts/EquipmentRegistryContext';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import { patchFrontmatterProperty } from '@bitcobblers/wod-wiki-core';
import { storageService } from '@/services/storage';
import type { IEffort, IEquipment } from '@bitcobblers/wod-wiki-lang';
import { toast } from '@/hooks/use-toast';

/** Minimal editable starter document for the create page (`/equipment/new?mode=create`). */
export function blankEquipmentDocument(slug: string, label?: string): string {
  const title = label
    ?? slug
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return equipmentToDocument({
    id: `equipment-user-${crypto.randomUUID()}`,
    slug,
    label: title || slug,
    aliases: [],
    registrySource: 'user',
  });
}

/**
 * Patch clone identity into the RAW document — one property range per field,
 * so comments, unknown frontmatter fields and the body survive byte-identical.
 */
function patchCloneSource(raw: string, sourceSlug: string, sourceLabel: string): { raw: string; id: string; slug: string; label: string } {
  const id = `equipment-user-${crypto.randomUUID()}`;
  const slug = `${sourceSlug}-custom`;
  const label = `${sourceLabel} (Custom)`;
  let next = patchFrontmatterProperty(raw, ['id'], id);
  next = patchFrontmatterProperty(next, ['slug'], slug);
  next = patchFrontmatterProperty(next, ['label'], label);
  next = patchFrontmatterProperty(next, ['registrySource'], 'user');
  return { raw: next, id, slug, label };
}

export interface UseEquipmentContentResult {
  /** The full document (YAML frontmatter + body) for NoteEditor */
  document: string;
  /** Set document directly (e.g. from NoteEditor onChange) */
  setDocument: (value: string) => void;
  /** Whether the initial load is complete */
  isLoading: boolean;
  /** The resolved equipment (bundled or user); null when not found / create mode */
  equipment: IEquipment | null;
  /** Whether this equipment is editable (user-created) */
  isEditable: boolean;
  /** True when the slug matches no equipment — render the create flow, not an error */
  notFound: boolean;
  /** Save hooks result for manual flush */
  flush: () => Promise<void>;
  /** Persist the current document (create or update); resolves with the owning note. */
  save: (value?: string) => Promise<{ id: string; sourceRevision: number }>;
  /** Remove this user-owned equipment (projection + note + links). */
  remove: () => Promise<void>;
  /** Clone a bundled definition: patches identity into the raw source and persists the copy. */
  cloneForEdit: () => Promise<IEquipment | null>;
  /** Error if load failed */
  error: string | null;
  /** True if resolved by alias rather than direct slug */
  isAliasMatch: boolean;
}

/**
 * Load the equipment document for a given slug — one resolution surface:
 * the registry (both tiers from IndexedDB). An undefined slug starts a blank
 * create document.
 */
export function useEquipmentContent(slug: string | undefined): UseEquipmentContentResult {
  const { registry, isReady, refresh } = useEquipmentRegistry();
  const [document, setDocumentState] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<IEquipment | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isAliasMatch, setIsAliasMatch] = useState(false);
  const isEditable = equipment?.registrySource === 'user';
  const committedNote = useRef<{ id: string; revision: number } | null>(null);

  // Load equipment on mount / slug change
  useEffect(() => {
    if (!isReady) {
      setIsLoading(false);
      return;
    }
    if (!slug) {
      // Create mode: blank editable document.
      setEquipment(null);
      setNotFound(false);
      setIsAliasMatch(false);
      committedNote.current = null;
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    setEquipment(null);
    setDocumentState('');

    async function load() {
      try {
        const direct = registry.resolve(slug!);
        const resolved = direct ?? registry.resolveByAlias(slug!);
        if (!resolved) {
          // Unknown slug is a not-found (create) state, never a load error.
          if (!cancelled) {
            setNotFound(true);
            setIsLoading(false);
          }
          return;
        }
        const noteId = resolved.ownerNoteId ?? `equipment/${resolved.slug}`;
        const note = await storageService.getNote(noteId);
        if (cancelled) return;
        setEquipment(resolved);
        setIsAliasMatch(!direct);
        committedNote.current = { id: noteId, revision: note?.sourceRevision ?? 0 };
        setDocumentState(note?.rawContent ?? equipmentToDocument(resolved));
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load equipment.');
          setIsLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, isReady, registry]);

  const handleSave = useCallback(async (value: string) => {
    const { equipment: parsed, errors } = documentToEquipment(value, equipment ?? undefined);
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

    // Bundled definitions are read-only: clone by patching the raw source.
    if (parsed.registrySource === 'bundled') {
      const patched = patchCloneSource(source, parsed.slug, parsed.label);
      source = patched.raw;
      parsed.id = patched.id;
      parsed.slug = patched.slug;
      parsed.label = patched.label;
      parsed.registrySource = 'user';
    }

    try {
      const noteId = parsed.ownerNoteId ?? committedNote.current?.id ?? `equipment/${parsed.slug}`;
      const expectedSourceRevision = committedNote.current?.id === noteId ? committedNote.current.revision : 0;
      const saved = await commitReferenceNote({
        kind: 'equipment',
        slug: parsed.slug,
        rawContent: source,
        title: parsed.label,
        expectedSourceRevision,
        noteId,
      });
      committedNote.current = { id: saved.id, revision: saved.sourceRevision };
      await refresh();
      setEquipment(parsed);
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save equipment.',
        variant: 'destructive',
      });
      throw err;
    }
  }, [equipment, refresh]);

  const { onChange, onLineChange, onBlur, flush } = useEditorSave({
    onSave: handleSave,
    lineIdleMs: 1200,
  });

  const setDocument = useCallback((value: string) => {
    setDocumentState(value);
    onChange(value);
  }, [onChange]);

  const save = useCallback((value?: string) => handleSave(value ?? document), [handleSave, document]);

  const remove = useCallback(async () => {
    const target = equipment?.slug;
    if (!target) return;
    try {
      await deleteReferenceNote('equipment', target);
      committedNote.current = null;
      setEquipment(null);
      await refresh();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Failed to delete equipment.',
        variant: 'destructive',
      });
      throw err;
    }
  }, [equipment, refresh]);

  // Clone a bundled definition: patch identity into the CURRENT raw document
  // and persist the copy immediately. Throws on failure (caller catches);
  // the editable draft stays intact either way.
  const cloneForEdit = useCallback(async (): Promise<IEquipment | null> => {
    if (!equipment || equipment.registrySource !== 'bundled') return null;
    const source = document || equipmentToDocument(equipment);
    const patched = patchCloneSource(source, equipment.slug, equipment.label);
    const cloned: IEquipment = {
      ...equipment,
      id: patched.id,
      slug: patched.slug,
      label: patched.label,
      registrySource: 'user',
      ownerNoteId: `equipment/${patched.slug}`,
      sourceId: 'equipment',
      sourcePath: `equipment/${patched.slug}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEquipment(cloned);
    setDocumentState(patched.raw);
    try {
      const saved = await commitReferenceNote({
        kind: 'equipment',
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
  }, [equipment, document, refresh]);

  return {
    document,
    setDocument,
    isLoading,
    equipment,
    isEditable,
    notFound,
    flush,
    save,
    remove,
    cloneForEdit,
    error,
    isAliasMatch,
  };
}

export interface EquipmentLinksResult {
  /** Effort definitions that reference this equipment (canonical slug list). */
  efforts: IEffort[];
  /** Notes whose workout blocks link this equipment, with real titles. */
  usedBy: Array<{ noteId: string; title: string }>;
}

/**
 * Context data for the equipment detail page: related effort definitions
 * (canonical `equipment` references) and real usage (block_equipment links).
 */
export function useEquipmentLinks(slug: string | undefined): EquipmentLinksResult {
  const { isReady, registry } = useEquipmentRegistry();
  const { isReady: effortsReady, registry: effortRegistry } = useEffortRegistry();
  const [links, setLinks] = useState<EquipmentLinksResult>({ efforts: [], usedBy: [] });

  useEffect(() => {
    if (!isReady || !effortsReady || !slug) {
      setLinks({ efforts: [], usedBy: [] });
      return;
    }
    let cancelled = false;
    async function load() {
      const efforts = effortRegistry.list().filter((effort) => effort.equipment?.includes(slug!) ?? false);
      const usedBy = await storageService.getEquipmentUsage(slug!);
      if (!cancelled) setLinks({ efforts, usedBy });
    }
    load();
    return () => { cancelled = true; };
  }, [slug, isReady, effortsReady, registry, effortRegistry]);

  return links;
}
