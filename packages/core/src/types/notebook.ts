/**
 * Notebook Types
 *
 * Every notebook carries a canonical `notebook/{slug}` identifier
 * (including the predefined default notebooks `notebook/journal`,
 * `notebook/playground`, and `notebook/guides`).
 */
import type { FeedId } from './feed';

/** Predefined default notebook slugs always present in the application. */
export const DEFAULT_NOTEBOOK_SLUGS = ['journal', 'playground', 'defaults', 'guides'] as const;
export type DefaultNotebookSlug = (typeof DEFAULT_NOTEBOOK_SLUGS)[number];
export type NotebookId = `notebook/${string}`;
/** Where a notebook comes from. 'feed' = delivered by a feed (the feed that
 *  delivers it is named by `feedEntryId`); 'user' = the user owns it;
 *  'default' = one of the predefined notebooks. */
export type NotebookOrigin = 'default' | 'user' | 'feed';

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

/** Application-level editability rule (ticket 05): a note is editable when
 *  its NOTEBOOK is user-owned. `notebookOrigin` is the origin of the note's
 *  resolved notebook (`notebookOfItem` + the notebook registry) — feed-delivered
 *  notebooks are read-only, and a note cloned into a user-owned notebook
 *  (e.g. `notebook/defaults`) is editable even though it keeps its seed/feed
 *  provenance stamps. Without a resolved notebook origin the decision falls
 *  back to the note's own stamps, which match the registry answer for every
 *  importer-written row. */
export function isNoteEditable(
  note: { seedOrigin?: string | null; feedOrigin?: string | null },
  notebookOrigin?: NotebookOrigin,
): boolean {
  if (notebookOrigin) return notebookOrigin !== 'feed';
  return note.seedOrigin !== 'seed' && note.feedOrigin !== 'feed';
}

export interface BuiltinNotebookSpec {
  slug: string;
  notebookId: NotebookId;
  name: string;
  description: string;
  icon: string;
  href: string;
  feedEntryId?: FeedId;
  seedChunkId?: string;
}

/** Single source of truth for always-present built-in and core reference notebooks. */
export const BUILTIN_NOTEBOOKS: readonly BuiltinNotebookSpec[] = [
  {
    slug: 'journal',
    notebookId: 'notebook/journal',
    name: 'Journal',
    description: 'Dated training log and scheduled workouts.',
    icon: '📅',
    href: '/journal',
  },
  {
    slug: 'playground',
    notebookId: 'notebook/playground',
    name: 'Playground',
    description: 'Scratchpad workouts and timer experiments.',
    icon: '🧪',
    href: '/playgrounds',
  },
  {
    slug: 'defaults',
    notebookId: 'notebook/defaults',
    name: 'Defaults',
    description: 'Starter notes — clone any of them into your own notebooks.',
    icon: '📝',
    href: '/notebook/defaults',
  },
  {
    slug: 'guides',
    notebookId: 'notebook/guides',
    name: 'Guides',
    description: 'Built-in Whiteboard Language and WQL guides.',
    icon: '📖',
    href: '/notebook/guides',
    feedEntryId: 'core',
    seedChunkId: 'canvas',
  },
  {
    slug: 'efforts',
    notebookId: 'notebook/efforts',
    name: 'Efforts',
    description: 'The effort library — every effort the parser and analytics resolve, across the canonical disciplines.',
    icon: '🏋️',
    href: '/efforts',
    feedEntryId: 'core',
    seedChunkId: 'efforts',
  },
  {
    slug: 'equipment',
    notebookId: 'notebook/equipment',
    name: 'Equipment',
    description: 'The equipment library — gear definitions the language resolves.',
    icon: '🔧',
    href: '/equipment',
    feedEntryId: 'core',
    seedChunkId: 'equipment',
  },
  {
    slug: 'dashboards',
    notebookId: 'notebook/dashboards',
    name: 'Dashboards',
    description: 'Prebuilt WQL dashboards — query compositions ready to open.',
    icon: '📊',
    href: '/dashboards',
    feedEntryId: 'core',
    seedChunkId: 'dashboards',
  },
] as const;

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
  /** Registered feed entry id — the feed that publishes this notebook. */
  feedEntryId?: FeedId;
  /** Seed manifest chunk id when delivered by a seed. */
  seedChunkId?: string;
  createdAt: number;
}
export const NOTEBOOK_TAG_PREFIX = 'notebook:';

export const toNotebookTag = (notebookId: string): string =>
  `${NOTEBOOK_TAG_PREFIX}${notebookId}`;

export const fromNotebookTag = (tag: string): string | null =>
  tag.startsWith(NOTEBOOK_TAG_PREFIX) ? tag.slice(NOTEBOOK_TAG_PREFIX.length) : null;

export const isNotebookTag = (tag: string): boolean =>
  tag.startsWith(NOTEBOOK_TAG_PREFIX);
