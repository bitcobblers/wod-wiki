/**
 * Notebook Types
 *
 * Every notebook carries a canonical `notebook/{slug}` identifier
 * (including the predefined default notebooks `notebook/journal`,
 * `notebook/playground`, and `notebook/guides`).
 */
import type { FeedId } from './feed';
import type { NoteRetention, NoteUpstreamStatus } from './storage';

/** Predefined default notebook slugs always present in the application. */
export const DEFAULT_NOTEBOOK_SLUGS = ['journal', 'playground', 'defaults', 'custom', 'guides'] as const;
export type DefaultNotebookSlug = (typeof DEFAULT_NOTEBOOK_SLUGS)[number];
export type NotebookId = `notebook/${string}`;

export const READONLY_SYSTEM_NOTEBOOK_SLUGS = ['defaults', 'guides', 'efforts', 'equipment', 'dashboards'] as const;
export const NON_PUBLISHABLE_NOTEBOOK_SLUGS = ['journal', 'playground', 'defaults', 'custom', 'guides', 'efforts', 'equipment', 'dashboards'] as const;

const READONLY_SET: ReadonlySet<string> = new Set(READONLY_SYSTEM_NOTEBOOK_SLUGS);
const NON_PUBLISHABLE_SET: ReadonlySet<string> = new Set(NON_PUBLISHABLE_NOTEBOOK_SLUGS);

export function isSystemReadOnlyNotebook(slugOrId: string): boolean {
  return READONLY_SET.has(notebookSlugFromId(slugOrId));
}

export function isNonPublishableNotebook(slugOrId: string): boolean {
  return NON_PUBLISHABLE_SET.has(notebookSlugFromId(slugOrId));
}
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

export type NoteOwnershipKind = 'user' | 'feed' | 'system' | 'feed-archived';

export interface ResolvedNoteOwnership {
  kind: NoteOwnershipKind;
  /** Only `'user'` notes are editable in place. */
  editable: boolean;
  /** Only `'user'` notes outside non-publishable notebooks can publish. */
  canPublish: boolean;
  feedSourceId?: string;
  sourceNotebookId?: string;
  upstreamStatus?: NoteUpstreamStatus;
}

export interface NoteOwnershipInput {
  id?: string;
  type?: string | null;
  seedOrigin?: string | null;
  feedOrigin?: string | null;
  feedSourceId?: string | null;
  sourceNotebookId?: string | null;
  notebookId?: string | null;
  notebookIds?: readonly string[] | null;
  sourceId?: string | null;
  sourcePath?: string | null;
  seedChunkId?: string | null;
  retention?: NoteRetention | null;
  upstreamStatus?: NoteUpstreamStatus | null;
  provenance?: {
    sourceNoteId?: string;
    feedSourceId?: string;
    sourceNotebookId?: string;
  } | null;
}

function hasExplicitSystemOrFeedStamp(
  note: NoteOwnershipInput,
  feedSourceId: string | undefined,
  isRemotePreview: boolean,
): boolean {
  return Boolean(
    note.seedOrigin === 'seed' ||
      note.feedOrigin === 'feed' ||
      isRemotePreview ||
      note.retention === 'cached' ||
      note.retention === 'session-pinned' ||
      feedSourceId ||
      note.seedChunkId ||
      note.sourcePath?.startsWith('markdown/') ||
      note.sourceId?.startsWith('notebook:') ||
      note.sourceId?.startsWith('guides:') ||
      note.sourceId === 'efforts' ||
      note.sourceId === 'equipment' ||
      note.sourceId === 'dashboards' ||
      (note.notebookId?.trim() && isSystemReadOnlyNotebook(note.notebookId)) ||
      note.notebookIds?.some((id) => Boolean(id?.trim()) && isSystemReadOnlyNotebook(id)),
  );
}

function inferSourceNotebookId(
  note: NoteOwnershipInput,
  resolvedNotebookId?: string,
): NotebookId | undefined {
  if (note.provenance?.sourceNotebookId?.trim()) {
    return toNotebookId(note.provenance.sourceNotebookId);
  }
  if (note.sourceNotebookId?.trim()) {
    return toNotebookId(note.sourceNotebookId);
  }
  if (resolvedNotebookId?.trim()) {
    return toNotebookId(resolvedNotebookId);
  }
  if (note.notebookId?.trim()) {
    return toNotebookId(note.notebookId);
  }
  if (note.sourceId?.startsWith('notebook:')) {
    const rest = note.sourceId.slice('notebook:'.length);
    const slug = rest.split('/')[0];
    if (slug && slug !== '_root') return toNotebookId(slug);
  }
  if (note.sourceId?.startsWith('guides:')) return 'notebook/guides';
  if (note.sourceId === 'efforts') return 'notebook/efforts';
  if (note.sourceId === 'equipment') return 'notebook/equipment';
  if (note.sourceId === 'dashboards') return 'notebook/dashboards';
  if (note.sourcePath) {
    const nbMatch = /^markdown\/notebooks\/([^/]+)\//.exec(note.sourcePath);
    if (nbMatch?.[1]) return toNotebookId(nbMatch[1]);
    if (note.sourcePath.startsWith('markdown/efforts/')) return 'notebook/efforts';
    if (note.sourcePath.startsWith('markdown/equipment/')) return 'notebook/equipment';
    if (note.sourcePath.startsWith('markdown/dashboards/')) return 'notebook/dashboards';
    if (note.sourcePath.startsWith('markdown/canvas/')) return 'notebook/guides';
  }
  if (note.seedChunkId?.startsWith('notebook.')) {
    const slug = note.seedChunkId.slice('notebook.'.length);
    if (slug && slug !== '_root') return toNotebookId(slug);
  }
  if (note.seedChunkId === 'efforts') return 'notebook/efforts';
  if (note.seedChunkId === 'equipment') return 'notebook/equipment';
  if (note.seedChunkId === 'dashboards') return 'notebook/dashboards';
  if (note.seedChunkId === 'canvas') return 'notebook/guides';
  if (note.notebookIds?.length) {
    const nonDefault = note.notebookIds
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => toNotebookId(id))
      .find((id) => id !== 'notebook/journal' && id !== 'notebook/playground');
    return nonDefault ?? toNotebookId(note.notebookIds[0]!);
  }
  return undefined;
}

/**
 * Pure ownership classifier distinguishing user-authored notes, live feed
 * notes, system reference notes, and archived feed notes whose upstream feed
 * was unsubscribed or removed.
 */
export function resolveNoteOwnership(
  note: NoteOwnershipInput,
  notebookOrigin?: NotebookOrigin,
  resolvedNotebookId?: string,
): ResolvedNoteOwnership {
  const feedSourceId =
    note.feedSourceId?.trim() ||
    note.provenance?.feedSourceId?.trim() ||
    undefined;
  const sourceNotebookId = inferSourceNotebookId(note, resolvedNotebookId);
  const targetNb = resolvedNotebookId?.trim()
    ? toNotebookId(resolvedNotebookId)
    : note.notebookId?.trim()
      ? toNotebookId(note.notebookId)
      : sourceNotebookId;

  const isRemotePreview =
    Boolean(note.id?.startsWith('remote:')) || note.retention === 'indexed';
  const hasFeedStamp =
    note.feedOrigin === 'feed' ||
    note.seedOrigin === 'seed' ||
    isRemotePreview;
  const isArchivedExternal =
    (note.upstreamStatus === 'unsubscribed' || note.upstreamStatus === 'removed') &&
    (hasFeedStamp || note.retention === 'session-pinned' || Boolean(feedSourceId));
  const isSystemNb = Boolean(targetNb && isSystemReadOnlyNotebook(targetNb));
  const isUserForkInUserNb =
    note.seedOrigin === 'user' &&
    note.feedOrigin !== 'feed' &&
    !isRemotePreview &&
    note.retention !== 'session-pinned' &&
    note.retention !== 'cached';
  const isIntrinsicUserDashboard =
    note.type === 'dashboard' &&
    !hasExplicitSystemOrFeedStamp(note, feedSourceId, isRemotePreview) &&
    (targetNb === 'notebook/dashboards' || !targetNb);

  let kind: NoteOwnershipKind;
  if (isArchivedExternal) {
    kind = 'feed-archived';
  } else if (isIntrinsicUserDashboard) {
    kind = 'user';
  } else if (isRemotePreview) {
    kind = isSystemNb && (!feedSourceId || feedSourceId === 'core') ? 'system' : 'feed';
  } else if (
    isSystemNb &&
    (!feedSourceId || feedSourceId === 'core') &&
    !(notebookOrigin === 'user' && isUserForkInUserNb)
  ) {
    kind = 'system';
  } else if (hasFeedStamp || notebookOrigin === 'feed') {
    kind = isSystemNb && (!feedSourceId || feedSourceId === 'core') ? 'system' : 'feed';
  } else if (isSystemNb) {
    kind = 'system';
  } else {
    kind = 'user';
  }

  const editable = kind === 'user';

  let canPublish = false;
  if (kind === 'user') {
    const candidateNotebooks: string[] = [];
    if (resolvedNotebookId?.trim()) candidateNotebooks.push(toNotebookId(resolvedNotebookId));
    if (note.notebookId?.trim()) candidateNotebooks.push(toNotebookId(note.notebookId));
    for (const id of note.notebookIds ?? []) {
      if (id?.trim()) candidateNotebooks.push(toNotebookId(id));
    }
    canPublish = candidateNotebooks.some((nb) => !isNonPublishableNotebook(nb));
  }

  const upstreamStatus: NoteUpstreamStatus | undefined =
    note.upstreamStatus ??
    (kind === 'feed' ? 'live' : undefined);

  return {
    kind,
    editable,
    canPublish,
    ...(feedSourceId ? { feedSourceId } : {}),
    ...(sourceNotebookId ? { sourceNotebookId } : {}),
    ...(upstreamStatus ? { upstreamStatus } : {}),
  };
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
  note: NoteOwnershipInput,
  notebookOrigin?: NotebookOrigin,
  resolvedNotebookId?: string,
): boolean {
  const isRemotePreview =
    Boolean(note.id?.startsWith('remote:')) || note.retention === 'indexed';
  if (isRemotePreview) return false;
  if (note.upstreamStatus === 'unsubscribed' || note.upstreamStatus === 'removed') return false;
  if (note.retention === 'session-pinned' && (note.seedOrigin === 'seed' || note.feedOrigin === 'feed')) {
    return false;
  }
  const feedSourceId =
    note.feedSourceId?.trim() ||
    note.provenance?.feedSourceId?.trim() ||
    undefined;
  const targetNb = resolvedNotebookId ?? note.notebookId ?? undefined;
  if (
    note.type === 'dashboard' &&
    !hasExplicitSystemOrFeedStamp(note, feedSourceId, isRemotePreview) &&
    (targetNb === 'notebook/dashboards' || !targetNb)
  ) {
    return true;
  }
  if (targetNb && isSystemReadOnlyNotebook(targetNb)) return false;
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
  readOnly?: boolean;
  publishable?: boolean;
  feedEntryId?: FeedId;
  seedChunkId?: string;
}

/** Single source of truth for always-present built-in and core reference notebooks. */
export const BUILTIN_NOTEBOOKS: readonly BuiltinNotebookSpec[] = [
  {
    slug: 'journal',
    notebookId: 'notebook/journal',
    name: 'Journal',
    description: 'Private training log tracking all created notes and sessions across journal and playground.',
    icon: 'J',
    href: '/journal',
    readOnly: false,
    publishable: false,
  },
  {
    slug: 'playground',
    notebookId: 'notebook/playground',
    name: 'Playground',
    description: 'Scratchpad workouts and timer experiments.',
    icon: 'P',
    href: '/playgrounds',
    readOnly: false,
    publishable: false,
  },
  {
    slug: 'defaults',
    notebookId: 'notebook/defaults',
    name: 'Defaults',
    description: 'Read-only base primitives: Tags, Efforts, Equipment, and shared dynamic properties.',
    icon: 'D',
    href: '/notebook/defaults',
    readOnly: true,
    publishable: false,
  },
  {
    slug: 'custom',
    notebookId: 'notebook/custom',
    name: 'Custom',
    description: 'User overrides and custom Tags, Efforts, Equipment, and starter workouts.',
    icon: 'C',
    href: '/notebook/custom',
    readOnly: false,
    publishable: false,
  },
  {
    slug: 'guides',
    notebookId: 'notebook/guides',
    name: 'Guides',
    description: 'Pre-subscribed read-only Whiteboard Language and WQL guides.',
    icon: 'G',
    href: '/notebook/guides',
    readOnly: true,
    publishable: false,
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
