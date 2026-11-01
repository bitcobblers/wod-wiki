/**
 * usePropertyNote — Deep Property Note lifecycle module across
 * Effort (`/effort/:slug`), Equipment (`/equipment/:slug`),
 * Tag (`/t/:category/:slug`), and Tag Category (`/t/:category`).
 *
 * Owns starter-document synthesis, source-preserving clone-on-edit for
 * bundled records, atomic `commitReferenceNote` writes, and registry refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { patchFrontmatterProperty, type Tag, type TagTypeRecord } from '@bitcobblers/wod-wiki-core';
import {
  tagCategoryRecordToDocument,
  tagRecordToDocument,
} from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote, deleteReferenceNote, type ReferenceKind } from '@/repositories/referenceNotes';
import { storageService } from '@/services/storage';
import { refreshTagIndex } from '@/services/tags/tagCatalogue';
import { toast } from '@/hooks/use-toast';
import { useEditorSave } from './useEditorSave';

export function patchPropertyCloneSource(
  kind: ReferenceKind,
  raw: string,
  sourceSlug: string,
  sourceLabel: string,
): { raw: string; id: string; slug: string; label: string } {
  const id = `${kind}-user-${crypto.randomUUID()}`;
  const slug = `${sourceSlug}-custom`;
  const label = `${sourceLabel} (Custom)`;
  let next = patchFrontmatterProperty(raw, ['id'], id);
  next = patchFrontmatterProperty(next, ['slug'], slug);
  next = patchFrontmatterProperty(next, ['label'], label);
  next = patchFrontmatterProperty(next, ['registrySource'], 'user');
  if (kind === 'effort') {
    next = patchFrontmatterProperty(next, ['derivation', 'parentSlug'], sourceSlug);
  }
  return { raw: next, id, slug, label };
}

export const buildTagNoteDocument = tagRecordToDocument;
export const buildTagCategoryNoteDocument = tagCategoryRecordToDocument;

export interface RegistryEntityBase {
  id: string;
  slug: string;
  label: string;
  registrySource: 'bundled' | 'user' | 'synthetic-unresolved';
  ownerNoteId?: string;
  sourceId?: string;
  sourcePath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UseRegistryPropertyNoteAdapter<T extends RegistryEntityBase> {
  kind: 'effort' | 'equipment';
  slug: string | undefined;
  isReady: boolean;
  revision?: number;
  resolveDirect: (slug: string) => T | undefined;
  resolveByAlias: (slug: string) => T | undefined;
  toDocument: (item: T) => string;
  fromDocument: (raw: string, base?: T) => { item: T; errors: string[] };
  applyCloneFields?: (cloned: T, source: T, patched: { id: string; slug: string; label: string }) => T;
  refresh: () => Promise<void>;
}

export interface UseRegistryPropertyNoteResult<T extends RegistryEntityBase> {
  document: string;
  setDocument: (value: string) => void;
  isLoading: boolean;
  item: T | null;
  isEditable: boolean;
  notFound: boolean;
  flush: () => Promise<void>;
  onLineChange: (line: number, column: number) => void;
  onBlur: () => void;
  save: (value?: string) => Promise<T | null>;
  remove: () => Promise<void>;
  cloneForEdit: () => Promise<T | null>;
  error: string | null;
  isAliasMatch: boolean;
}

export function useRegistryPropertyNote<T extends RegistryEntityBase>(
  adapter: UseRegistryPropertyNoteAdapter<T>,
): UseRegistryPropertyNoteResult<T> {
  const {
    kind,
    slug,
    isReady,
    revision = 0,
    resolveDirect,
    resolveByAlias,
    toDocument,
    fromDocument,
    applyCloneFields,
    refresh,
  } = adapter;

  const [document, setDocumentState] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<T | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isAliasMatch, setIsAliasMatch] = useState(false);
  const isEditable = item?.registrySource === 'user';
  const committedNote = useRef<{ id: string; revision: number } | null>(null);
  const loadedSlug = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isReady) {
      setIsLoading(false);
      return;
    }
    if (!slug) {
      loadedSlug.current = undefined;
      setItem(null);
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
      setItem(null);
      setDocumentState('');
    }

    async function load() {
      try {
        const direct = resolveDirect(slug!);
        const resolved = direct ?? resolveByAlias(slug!);
        if (!resolved) {
          if (slugChanged && !cancelled) {
            setNotFound(true);
            setIsLoading(false);
          }
          return;
        }
        const noteId = resolved.ownerNoteId ?? `${kind}/${resolved.slug}`;
        if (!slugChanged && committedNote.current?.id === noteId) {
          if (!cancelled) {
            setItem(resolved);
            setIsAliasMatch(!direct);
          }
          return;
        }
        if (!slugChanged && committedNote.current) return;
        const note = await storageService.getNote(noteId);
        if (cancelled) return;
        setItem(resolved);
        setIsAliasMatch(!direct);
        committedNote.current = { id: noteId, revision: note?.sourceRevision ?? 0 };
        setDocumentState(note?.rawContent ?? toDocument(resolved));
        setNotFound(false);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : `Failed to load ${kind}.`);
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [kind, slug, isReady, revision, resolveDirect, resolveByAlias, toDocument]);

  const handleSave = useCallback(
    async (value: string): Promise<T | null> => {
      if (kind === 'effort' && !slug && !item) return null;

      const { item: parsed, errors } = fromDocument(value, item ?? undefined);
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

      if (parsed.registrySource === 'bundled') {
        const patched = patchPropertyCloneSource(kind, source, parsed.slug, parsed.label);
        source = patched.raw;
        parsed.id = patched.id;
        parsed.slug = patched.slug;
        parsed.label = patched.label;
        parsed.registrySource = 'user';
        parsed.ownerNoteId = `${kind}/${parsed.slug}`;
        if (applyCloneFields && item) {
          Object.assign(parsed, applyCloneFields(parsed, item, patched));
        }
      }

      try {
        const noteId = parsed.ownerNoteId ?? committedNote.current?.id ?? `${kind}/${parsed.slug}`;
        const expectedSourceRevision = committedNote.current?.id === noteId ? committedNote.current.revision : 0;
        const saved = await commitReferenceNote({
          kind,
          slug: parsed.slug,
          rawContent: source,
          title: parsed.label,
          expectedSourceRevision,
          ...(kind === 'equipment' ? { noteId } : {}),
        });
        committedNote.current = { id: saved.id, revision: saved.sourceRevision };
        await refresh();
        setItem(parsed);
        return parsed;
      } catch (err) {
        toast({
          title: 'Save failed',
          description: err instanceof Error ? err.message : `Failed to save ${kind}.`,
          variant: 'destructive',
        });
        throw err;
      }
    },
    [kind, slug, item, fromDocument, applyCloneFields, refresh],
  );

  const { onChange, onLineChange, onBlur, flush } = useEditorSave({
    onSave: async (value) => {
      await handleSave(value);
    },
  });

  const setDocument = useCallback(
    (value: string) => {
      setDocumentState(value);
      onChange(value);
    },
    [onChange],
  );

  const save = useCallback((value?: string) => handleSave(value ?? document), [handleSave, document]);

  const remove = useCallback(async () => {
    const target = kind === 'effort' ? (item?.slug ?? slug) : item?.slug;
    if (!target) return;
    try {
      await deleteReferenceNote(kind, target);
      committedNote.current = null;
      setItem(null);
      await refresh();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : `Failed to delete ${kind}.`,
        variant: 'destructive',
      });
      throw err;
    }
  }, [kind, item, slug, refresh]);

  const cloneForEdit = useCallback(async (): Promise<T | null> => {
    if (!item || item.registrySource !== 'bundled') return null;
    const source = document || toDocument(item);
    const patched = patchPropertyCloneSource(kind, source, item.slug, item.label);
    const now = new Date().toISOString();
    let cloned: T = {
      ...item,
      id: patched.id,
      slug: patched.slug,
      label: patched.label,
      registrySource: 'user',
      ownerNoteId: `${kind}/${patched.slug}`,
      sourceId: kind === 'effort' ? 'efforts' : 'equipment',
      sourcePath: `${kind}/${patched.slug}`,
      createdAt: now,
      updatedAt: now,
    };
    if (applyCloneFields) {
      cloned = applyCloneFields(cloned, item, patched);
    }
    setItem(cloned);
    setDocumentState(patched.raw);
    try {
      const saved = await commitReferenceNote({
        kind,
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
  }, [kind, item, document, toDocument, applyCloneFields, refresh]);

  return {
    document,
    setDocument,
    isLoading,
    item,
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

export interface UsePropertyNoteResult {
  document: string;
  setDocument: (value: string) => void;
  sourceRevision: number;
  isLoading: boolean;
  save: (nextDoc?: string) => Promise<{ id: string; sourceRevision: number }>;
}

export function usePropertyNote(
  category: string | undefined,
  tagSlug?: string,
  activeTag?: Tag | null,
  activeTagType?: TagTypeRecord | null,
): UsePropertyNoteResult {
  const [document, setDocument] = useState('');
  const [sourceRevision, setSourceRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const normalizedCategory = (category ?? 'tag').trim() || 'tag';
  const noteId = tagSlug
    ? `t/${normalizedCategory}/${tagSlug}`
    : `t/${normalizedCategory}`;

  useEffect(() => {
    let cancelled = false;
    async function loadNote() {
      if (!category && !tagSlug) {
        setDocument('');
        setSourceRevision(0);
        return;
      }
      setIsLoading(true);
      try {
        const stored = await storageService.getNote(noteId);
        if (cancelled) return;
        if (stored) {
          setDocument(stored.rawContent);
          setSourceRevision(stored.sourceRevision);
        } else if (tagSlug && activeTag) {
          setDocument(buildTagNoteDocument(activeTag, normalizedCategory));
          setSourceRevision(0);
        } else if (!tagSlug && category) {
          setDocument(buildTagCategoryNoteDocument(normalizedCategory, activeTagType ?? undefined));
          setSourceRevision(0);
        } else {
          setDocument('');
          setSourceRevision(0);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadNote();
    return () => {
      cancelled = true;
    };
  }, [noteId, category, tagSlug, activeTag, activeTagType, normalizedCategory]);

  const save = useCallback(
    async (nextDoc?: string) => {
      const content = nextDoc ?? document;
      if (tagSlug) {
        const res = await commitReferenceNote({
          kind: 'tag',
          slug: tagSlug,
          category: normalizedCategory,
          title: activeTag?.label ?? tagSlug,
          rawContent: content,
          expectedSourceRevision: sourceRevision,
          noteId,
        });
        await refreshTagIndex();
        setSourceRevision(res.sourceRevision);
        return res;
      }
      const res = await commitReferenceNote({
        kind: 'tag-type',
        slug: normalizedCategory,
        title: activeTagType?.label ?? normalizedCategory,
        rawContent: content,
        expectedSourceRevision: sourceRevision,
        noteId,
      });
      await refreshTagIndex();
      setSourceRevision(res.sourceRevision);
      return res;
    },
    [document, tagSlug, normalizedCategory, activeTag, activeTagType, sourceRevision, noteId],
  );

  return {
    document,
    setDocument,
    sourceRevision,
    isLoading,
    save,
  };
}
