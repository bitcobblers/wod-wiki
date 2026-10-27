/**
 * usePropertyNote — Unified load/save/clone hook for Property Notes
 * (`/t/:category` and `/t/:category/:slug`).
 *
 * Synthesizes a starter Markdown document (with frontmatter `metrics:`,
 * `summaries:`, and an embedded WQL Dashboard Widget) when a Tag or Tag
 * Category has a projection row in storage but no authored Note row yet,
 * and commits updates atomically through `commitReferenceNote`.
 */

import { useCallback, useEffect, useState } from 'react';
import { patchFrontmatterProperty, type Tag, type TagTypeRecord } from '@bitcobblers/wod-wiki-core';
import {
  tagCategoryToDocument,
  tagToDocument,
} from '@bitcobblers/wod-wiki-lang';
import { commitReferenceNote, type ReferenceKind } from '@/repositories/referenceNotes';
import { storageService } from '@/services/storage';
import { refreshTagIndex } from '@/services/tags/tagCatalogue';

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

export function buildTagNoteDocument(tag: Tag, categoryFallback = 'tag'): string {
  const metrics: Record<string, string | number | readonly string[]> = {};
  const summaries: Record<string, string> = {};
  const tags: string[] = [];
  const functions: string[] = [];
  for (const c of tag.contributions ?? []) {
    if (c.kind === 'metric' && c.type.startsWith('summaries.')) {
      summaries[c.type.slice('summaries.'.length)] = String(c.value);
    } else if (c.kind === 'metric' && c.type) {
      metrics[c.type] = c.unit ? `${String(c.value)} ${c.unit}` : typeof c.value === 'boolean' ? String(c.value) : c.value;
    } else if (c.kind === 'tag' && c.slug) {
      tags.push(c.slug);
    } else if (c.kind === 'function' && c.name) {
      functions.push(c.name);
    }
  }

  return tagToDocument({
    id: tag.id,
    slug: tag.label,
    label: tag.label,
    category: tag.type || categoryFallback,
    aliases: [],
    metrics,
    summaries,
    tags,
    functions,
  });
}

export function buildTagCategoryNoteDocument(
  category: string,
  record?: TagTypeRecord,
): string {
  const title =
    record?.label ||
    category
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return tagCategoryToDocument({
    id: record?.id ?? `tag-type-${category}`,
    name: category,
    label: title || category,
    color: record?.color,
  });
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
