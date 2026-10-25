/**
 * Notebook Types
 *
 * Every notebook carries a canonical `notebook/{slug}` identifier
 * (including the predefined default notebooks `notebook/journal`,
 * `notebook/playground`, and `notebook/guides`).
 */
import type { FeedId } from './feed';

/** Predefined default notebook slugs always present in the application. */
export const DEFAULT_NOTEBOOK_SLUGS = ['journal', 'playground', 'guides'] as const;
export type DefaultNotebookSlug = (typeof DEFAULT_NOTEBOOK_SLUGS)[number];
export type NotebookId = `notebook/${string}`;
/** Where a notebook comes from. 'seed' = delivered by a feed (the artifact
 *  vocabulary — the feed that delivers it is named by `feedEntryId`); 'user'
 *  = the user owns it; 'default' = one of the predefined notebooks. */
export type NotebookOrigin = 'default' | 'user' | 'seed';

/** Extract the bare slug from a `notebook/{slug}` or `notebook:{slug}` or bare identifier. */
export function notebookSlugFromId(slugOrId: string): string {
  const trimmed = slugOrId.trim();
  if (trimmed.startsWith('notebook/')) return trimmed.slice('notebook/'.length);
  if (trimmed.startsWith('notebook:')) return trimmed.slice('notebook:'.length);
  return trimmed;
}

/** Normalize any notebook slug or id to the canonical `notebook/{slug}` form. */
export function toNotebookId(slugOrId: string): NotebookId {
  return `notebook/${notebookSlugFromId(slugOrId)}`;
}

/** Application-level editability rule: only user-created notes (`seedOrigin !== 'seed'`) are editable. */
export function isNoteEditable(note: { seedOrigin?: string | null }): boolean {
  return note.seedOrigin !== 'seed';
}

export interface Notebook {
  /** Canonical `notebook/{slug}` identifier. */
  id: NotebookId | string;
  /** Bare slug segment (e.g. 'journal', 'playground', 'guides', 'crossfit-girls'). */
  slug: string;
  /** Canonical `notebook/{slug}` identifier. */
  notebookId: NotebookId;
  name: string;
  description: string;
  icon: string;
  origin: NotebookOrigin;
  /** Registered seed source entry id where the source is pulled from — the
   *  source's own id (the seed spelling of the feed identity below). */
  sourceEntryId?: string;
/** Registered feed entry id — the feed that publishes this notebook, in the
   *  feed vocabulary. Agrees with `sourceEntryId` for every notebook a
   *  feed publishes. */
  feedEntryId?: FeedId;
  /** Seed package id when delivered by a named package slice. */
  packageId?: string;
  /** Seed directory URL where the source is pulled from. */
  sourceUrl?: string;
  /** Published Git repository URL when declared by the source entry. */
  repositoryUrl?: string;
  /** Seed manifest chunk id when delivered by a seed. */
  seedChunkId?: string;
  createdAt: number;
  lastEditedAt: number;
}
export const NOTEBOOK_TAG_PREFIX = 'notebook:';

export const toNotebookTag = (notebookId: string): string =>
  `${NOTEBOOK_TAG_PREFIX}${notebookId}`;

export const fromNotebookTag = (tag: string): string | null =>
  tag.startsWith(NOTEBOOK_TAG_PREFIX) ? tag.slice(NOTEBOOK_TAG_PREFIX.length) : null;

export const isNotebookTag = (tag: string): boolean =>
  tag.startsWith(NOTEBOOK_TAG_PREFIX);
