/**
 * feedCatalog — manifest-backed distributed Feed & Notebook catalog seam for WQL.
 *
 * Unifies:
 *   - "My Published Feed" (`local`) — user's public Notebooks & public Sessions
 *     (self-hosted `/feed/` on `wod server` or `wod-wiki-feed-repository` in browser)
 *   - Built-in & custom distributed Feeds — manifest summaries persisted in `meta`
 *     (`catalog:<feedId>`), falling back to bootstrap definitions before first probe
 *   - Cached notebook indexes (`feed:index:<feedId>:<notebookId>`) in `meta`
 *   - On-demand single-workout resolution (`resolveRemoteWorkout`, `loadRemoteRecordDetail`)
 *     supporting precompiled `records/*.json` OR lazy client-side `.md` compilation
 *     cached locally under the canonical record UUID with `retention: 'cached'`.
 */

import {
  countNotesByNotebook,
  toNotebookId,
  type NotebookLink,
} from '@bitcobblers/wod-wiki-core';
import {
  FEED_INDEX_META_PREFIX,
  HttpFeedTree,
  assertSeedManifest,
  cloneRemoteRecord,
  feedIndexMetaKey,
  materializeCachedRemoteRecord,
  notebookSlugForChunkId,
  previewRemoteNotebook,
  previewRemoteRecord,
  seedMetaKey,
  type FeedCatalogQueryStore,
  type FeedNotebookCatalogRow,
  type FeedSourceCatalogRow,
  type FeedTreeReader,
  type NotebookIndex,
  type NotebookIndexSummary,
  type SeedManifest,
  type SeedMetaRecord,
  type SeedRecordRef,
  type SeedRow,
} from '@bitcobblers/wod-wiki-engine';
import type { Note } from '@/types/storage';
import type { IStorage } from '@/services/storage/IStorage';
import { storage, storageBackend, whenStorageReady } from '@/services/storage';
import { notebookService } from '@/services/NotebookService';
import {
  CORE_FEED_SOURCE,
  CORE_FEED_URL,
  canonicalNotebookSlug,
  customFeedSources,
  feedSourceById,
  listFeedSources,
  normalizeFeedUrl,
  notebooksOfFeed,
  safeRepositoryUrl,
  toAbsoluteFeedUrl,
  type FeedSource,
} from './feedSources';
import {
  hydrateFeedStateFromStorage,
  isFeedSubscribed,
  isNotebookSubscribed,
} from './feedSubscriptions';
import { isFeedStateHydrated } from './feedRegistryStore';
import type { IFeedSource } from './IFeedSource';
import { getOutboundFeedStatus, type OutboundFeedStatus } from '@/services/ExportImportService';

export const FEED_CATALOG_META_PREFIX = 'catalog:';

export interface FeedCatalogMetaRecord {
  key: string;
  feedId: string;
  manifest: SeedManifest;
  updatedAt: number;
}

export interface FeedNotebookIndexMetaRecord {
  key: string;
  feedId: string;
  notebookId: string;
  index: NotebookIndex;
  updatedAt: number;
}

export interface ProbedFeedManifest {
  url: string;
  manifest: SeedManifest;
  name: string;
  description?: string;
  repositoryUrl?: string;
  version: number;
  schema: number;
  builtAt: string;
  notebooks: NotebookIndexSummary[];
  notebookCount: number;
  itemCount: number;
  indexBytes: number;
  chunkBytes: number;
  hasOfflineChunks: boolean;
}

export interface RemoteWorkoutLocator {
  noteId?: string;
  uuid?: string;
  feedId?: string;
  feedUrl?: string;
  notebookId?: string;
  notebookSlug?: string;
  record?: SeedRecordRef;
  recordPath?: string;
  rawUrl?: string;
  path?: string;
  title?: string;
  version?: number;
  date?: number;
}

export interface ResolveRemoteWorkoutOptions {
  storage?: IStorage;
  source?: IFeedSource;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  cache?: boolean;
  forceRefresh?: boolean;
}

type RetentionNote = Note & {
  retention?: 'indexed' | 'cached' | 'session-pinned';
  upstreamStatus?: 'live' | 'unsubscribed' | 'removed';
};

export interface ResolvedRemoteWorkout {
  note: RetentionNote;
  seedRow: SeedRow;
  row: SeedRow;
  feedId?: string;
  notebookSlug?: string;
  record?: SeedRecordRef;
  remoteNoteId?: string;
  canonicalNoteId: string;
  fromCache: boolean;
}

function isCatalogMeta(v: unknown): v is FeedCatalogMetaRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    'key' in v &&
    typeof v.key === 'string' &&
    v.key.startsWith(FEED_CATALOG_META_PREFIX) &&
    'manifest' in v
  );
}

function isNotebookIndexMeta(v: unknown): v is FeedNotebookIndexMetaRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    'key' in v &&
    typeof v.key === 'string' &&
    v.key.startsWith(FEED_INDEX_META_PREFIX) &&
    'index' in v
  );
}

function isSeedMeta(v: unknown): v is SeedMetaRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    'key' in v &&
    typeof v.key === 'string' &&
    v.key.startsWith('seed:')
  );
}

async function resolveTargetStorage(explicit?: IStorage): Promise<IStorage> {
  if (explicit) return explicit;
  await whenStorageReady().catch(() => undefined);
  return storage;
}

async function ensureRegistryHydratedOnce(targetStorage?: IStorage): Promise<void> {
  const s = targetStorage ?? storage;
  if (!isFeedStateHydrated()) {
    await hydrateFeedStateFromStorage(s).catch(() => undefined);
  }
}

export async function saveFeedCatalogManifest(
  feedId: string,
  manifest: SeedManifest,
  targetStorage?: IStorage,
): Promise<void> {
  const rec: FeedCatalogMetaRecord = {
    key: `${FEED_CATALOG_META_PREFIX}${feedId}`,
    feedId,
    manifest,
    updatedAt: Date.now(),
  };
  try {
    const db = await resolveTargetStorage(targetStorage);
    if (!db) return;
    await db.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put(rec);
    });
  } catch {
    // Non-fatal in read-only or uninitialized test harnesses
  }
}

export async function readFeedCatalogManifest(
  feedId: string,
  targetStorage?: IStorage,
): Promise<SeedManifest | undefined> {
  try {
    const db = await resolveTargetStorage(targetStorage);
    if (!db) return undefined;
    const raw = await db.readonly('meta').get(`${FEED_CATALOG_META_PREFIX}${feedId}`);
    return isCatalogMeta(raw) ? raw.manifest : undefined;
  } catch {
    return undefined;
  }
}

export async function saveFeedNotebookIndex(
  feedId: string,
  notebookId: string,
  index: NotebookIndex,
  targetStorage?: IStorage,
): Promise<void> {
  const rec: FeedNotebookIndexMetaRecord = {
    key: feedIndexMetaKey(feedId, notebookId),
    feedId,
    notebookId,
    index,
    updatedAt: Date.now(),
  };
  try {
    const db = await resolveTargetStorage(targetStorage);
    if (!db) return;
    await db.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put(rec);
    });
  } catch {
    // Non-fatal in read-only or uninitialized test harnesses
  }
}

export async function readFeedNotebookIndex(
  feedId: string,
  notebookId: string,
  targetStorage?: IStorage,
): Promise<NotebookIndex | undefined> {
  try {
    const db = await resolveTargetStorage(targetStorage);
    if (!db) return undefined;
    const raw = await db.readonly('meta').get(feedIndexMetaKey(feedId, notebookId));
    return isNotebookIndexMeta(raw) ? raw.index : undefined;
  } catch {
    return undefined;
  }
}

function summarizeNotebooks(manifest: SeedManifest): NotebookIndexSummary[] {
  if (manifest.notebooks && manifest.notebooks.length > 0) {
    return manifest.notebooks;
  }
  return manifest.chunks
    .filter((chunk) => chunk.id.startsWith('notebook.'))
    .map((chunk): NotebookIndexSummary => {
      const slug = notebookSlugForChunkId(chunk.id) ?? chunk.id.slice('notebook.'.length);
      return {
        notebookId: chunk.id,
        label: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        indexPath: `indexes/notebooks/${chunk.id}.json`,
        version: manifest.version,
        commit: manifest.commit ?? '',
        builtAt: manifest.builtAt,
        sha256: chunk.sha256,
        bytes: chunk.bytes,
        chunkBytes: chunk.bytes,
        count: chunk.count,
      };
    });
}

/**
 * Probe and validate a feed directory URL (without requiring prior custom-feed
 * registration) so `/subscribe` and `/settings/sync` can inspect metadata,
 * notebooks, counts, and index vs optional offline chunk sizes beforehand.
 */
export async function probeFeedManifest(
  url: string,
  options?: {
    source?: IFeedSource;
    feedId?: string;
    storage?: IStorage;
  },
): Promise<ProbedFeedManifest> {
  const normalizedUrl =
    normalizeFeedUrl(url) ?? (url.startsWith('/') ? toAbsoluteFeedUrl(url) : null);
  if (!normalizedUrl && !options?.source) {
    throw new Error('Enter an absolute http(s) URL of a feed directory.');
  }

  let rawManifest: unknown;
  if (options?.source) {
    rawManifest = await options.source.fetchManifest();
  } else {
    const tree = new HttpFeedTree(normalizedUrl!);
    rawManifest = await tree.readJson<unknown>('manifest.json');
  }
  const manifest = assertSeedManifest(rawManifest);

  const resolvedUrl = normalizedUrl ?? url;
  const persistFeedId =
    options?.feedId ??
    listFeedSources().find((src) => normalizeFeedUrl(src.url) === normalizedUrl)?.id;
  if (persistFeedId) {
    await saveFeedCatalogManifest(persistFeedId, manifest, options?.storage);
  }

  const notebooks = summarizeNotebooks(manifest);
  const itemCount =
    notebooks.length > 0
      ? notebooks.reduce((sum, nb) => sum + nb.count, 0)
      : manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0);
  const indexBytes =
    manifest.indexBytes ?? notebooks.reduce((sum, nb) => sum + (nb.indexBytes ?? 0), 0);
  const chunkBytes =
    manifest.chunkBytes ??
    (manifest.chunks.length > 0
      ? manifest.chunks.reduce((sum, chunk) => sum + (chunk.bytes ?? 0), 0)
      : notebooks.reduce((sum, nb) => sum + (nb.chunkBytes ?? 0), 0));
  const repositoryUrl = safeRepositoryUrl(manifest.repositoryUrl ?? '') ?? undefined;

  let hostFallback: string;
  try {
    hostFallback = new URL(resolvedUrl).hostname || 'Feed';
  } catch {
    hostFallback = 'Feed';
  }

  return {
    url: resolvedUrl,
    manifest,
    name: manifest.name?.trim() || hostFallback,
    ...(manifest.description?.trim() ? { description: manifest.description.trim() } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    version: manifest.version,
    schema: manifest.schema,
    builtAt: manifest.builtAt,
    notebooks,
    notebookCount: notebooks.length,
    itemCount,
    indexBytes,
    chunkBytes,
    hasOfflineChunks: manifest.chunks.length > 0 || chunkBytes > 0,
  };
}

interface RemoteRecordEntry {
  feedId: string;
  feedUrl: string;
  notebookSlug: string;
  record: SeedRecordRef;
}

const remoteIndexCache = new Map<string, NotebookIndex>();
const remoteRecordLookup = new Map<string, RemoteRecordEntry>();
const remoteRecordByUuid = new Map<string, RemoteRecordEntry>();

function registerRemoteRecordEntry(entry: RemoteRecordEntry): void {
  const syntheticId = `remote:${entry.feedId}:${entry.record.uuid}`;
  remoteRecordLookup.set(syntheticId, entry);
  remoteRecordLookup.set(entry.record.uuid, entry);
  remoteRecordByUuid.set(entry.record.uuid, entry);
}

export function lookupRemoteRecord(noteId: string): RemoteRecordEntry | undefined {
  return remoteRecordLookup.get(noteId) ?? remoteRecordByUuid.get(noteId);
}

function parseRemoteSyntheticId(noteId: string): { feedId?: string; uuid: string } {
  const match = /^remote:([^:]+):(.+)$/.exec(noteId);
  if (match) {
    return { feedId: match[1], uuid: match[2] };
  }
  return { uuid: noteId };
}

function createFeedTreeReader(entry: RemoteRecordEntry, source?: IFeedSource): FeedTreeReader {
  if (source) {
    const encoder = new TextEncoder();
    return {
      async read(path: string): Promise<Uint8Array> {
        if (/\.md$/i.test(path) && source.fetchText) {
          return encoder.encode(await source.fetchText(path));
        }
        const json = await source.fetchChunk(path);
        return encoder.encode(JSON.stringify(json));
      },
      async readText(path: string): Promise<string> {
        if (source.fetchText) return source.fetchText(path);
        if (/\.json$/i.test(path)) {
          return JSON.stringify(await source.fetchChunk(path));
        }
        throw new Error(`Feed source for ${entry.feedId} cannot read text '${path}'`);
      },
      async stat(): Promise<undefined> {
        return undefined;
      },
    };
  }
  return new HttpFeedTree(entry.feedUrl);
}

function resolveSlugForNotebook(notebookId?: string, path?: string): string {
  if (notebookId) return canonicalNotebookSlug(notebookId);
  const match = /^markdown\/notebooks\/([^/]+)\//.exec(path ?? '');
  return match?.[1] ? canonicalNotebookSlug(match[1]) : 'workouts';
}

function titleFromRecordRef(rec: SeedRecordRef): string {
  if (rec.title?.trim()) return rec.title.trim();
  const base = (rec.path.split('/').at(-1) ?? rec.path).replace(/\.md$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function resolveRemoteEntryFromStorageOrLocator(
  locatorOrNoteId: string | RemoteWorkoutLocator,
  options?: ResolveRemoteWorkoutOptions,
): Promise<{ entry?: RemoteRecordEntry; canonicalUuid?: string; requestedFeedId?: string }> {
  const locator: RemoteWorkoutLocator =
    typeof locatorOrNoteId === 'string' ? { noteId: locatorOrNoteId } : locatorOrNoteId;

  const lookupKey = locator.noteId ?? locator.uuid;
  if (lookupKey) {
    const inMem = lookupRemoteRecord(lookupKey);
    if (inMem) {
      return { entry: inMem, canonicalUuid: inMem.record.uuid, requestedFeedId: inMem.feedId };
    }
  }

  const parsed = locator.noteId
    ? parseRemoteSyntheticId(locator.noteId)
    : { feedId: locator.feedId, uuid: locator.uuid };
  const canonicalUuid = locator.uuid ?? parsed.uuid;
  const feedId = locator.feedId ?? parsed.feedId;

  const feedUrl =
    locator.feedUrl ?? (feedId ? feedSourceById(feedId)?.url : undefined);

  if (
    locator.record ||
    ((locator.recordPath || locator.rawUrl || locator.path) && (feedUrl || options?.source))
  ) {
    const ref: SeedRecordRef = locator.record ?? {
      uuid: canonicalUuid ?? '',
      path: locator.path ?? locator.recordPath ?? locator.rawUrl ?? '',
      ...(locator.recordPath ? { recordPath: locator.recordPath } : {}),
      ...(locator.rawUrl ? { rawUrl: locator.rawUrl } : {}),
      commit: '',
      version: locator.version ?? 1,
      sha256: '',
      ...(locator.title ? { title: locator.title } : {}),
      ...(locator.date !== undefined ? { date: locator.date } : {}),
    };
    if (feedId || feedUrl || options?.source) {
      const resolvedFeedId = feedId ?? 'remote';
      const resolvedFeedUrl = feedUrl ?? '';
      const notebookSlug =
        locator.notebookSlug ?? resolveSlugForNotebook(locator.notebookId, ref.path);
      const constructed: RemoteRecordEntry = {
        feedId: resolvedFeedId,
        feedUrl: resolvedFeedUrl,
        notebookSlug,
        record: ref,
      };
      if (ref.uuid) registerRemoteRecordEntry(constructed);
      return {
        entry: constructed,
        canonicalUuid: ref.uuid || canonicalUuid,
        requestedFeedId: resolvedFeedId,
      };
    }
  }

  const db = await resolveTargetStorage(options?.storage);
  if (db && canonicalUuid) {
    try {
      const allMeta = await db.readonly('meta').getAll();
      for (const row of allMeta) {
        if (!isNotebookIndexMeta(row)) continue;
        if (feedId && row.feedId !== feedId) continue;
        const found = row.index.records.find((rec) => rec.uuid === canonicalUuid);
        if (!found) continue;
        const srcUrl = feedUrl ?? feedSourceById(row.feedId)?.url ?? '';
        const entry: RemoteRecordEntry = {
          feedId: row.feedId,
          feedUrl: srcUrl,
          notebookSlug: resolveSlugForNotebook(row.notebookId, found.path),
          record: found,
        };
        registerRemoteRecordEntry(entry);
        return { entry, canonicalUuid: found.uuid, requestedFeedId: row.feedId };
      }
    } catch {
      // Ignore meta scan failure; fall through to network fallback if available.
    }
  }

  if (feedId && (feedUrl || options?.source) && canonicalUuid) {
    try {
      const tree = createFeedTreeReader(
        {
          feedId,
          feedUrl: feedUrl ?? '',
          notebookSlug: 'workouts',
          record: { uuid: canonicalUuid, path: '', commit: '', version: 1, sha256: '' },
        },
        options?.source,
      );
      let manifest = db ? await readFeedCatalogManifest(feedId, db) : undefined;
      if (!manifest && options?.source) {
        manifest = assertSeedManifest(await options.source.fetchManifest());
      } else if (!manifest && feedUrl) {
        manifest = assertSeedManifest(await new HttpFeedTree(feedUrl).readJson<unknown>('manifest.json'));
      }
      for (const nb of manifest?.notebooks ?? []) {
        const index = await previewRemoteNotebook(tree, nb.indexPath);
        if (db) await saveFeedNotebookIndex(feedId, nb.notebookId, index, db);
        for (const rec of index.records) {
          const entry: RemoteRecordEntry = {
            feedId,
            feedUrl: feedUrl ?? '',
            notebookSlug: resolveSlugForNotebook(nb.notebookId, rec.path),
            record: rec,
          };
          registerRemoteRecordEntry(entry);
        }
        const match = lookupRemoteRecord(canonicalUuid);
        if (match) return { entry: match, canonicalUuid: match.record.uuid, requestedFeedId: feedId };
      }
    } catch {
      // Best-effort remote fallback; return missing below.
    }
  }

  return { entry: undefined, canonicalUuid, requestedFeedId: feedId };
}

function seedRowFromExistingNote(note: RetentionNote): SeedRow {
  return {
    path: note.sourcePath ?? `${note.id}.md`,
    content: note.rawContent,
    blocks: note.blocks,
    blockIndex: [],
    blockEfforts: [],
    blockEquipment: [],
    commit: note.seedCommit,
    uuid: note.id,
    version: note.seedVersion,
  };
}

/**
 * Fetch and lazily compile a single indexed or remote workout (from either
 * `records/*.json` or raw `.md`/`rawUrl`), optionally caching the resulting note
 * in `IStorage` under its canonical UUID (`retention: 'cached'`).
 */
export async function resolveRemoteWorkout(
  locatorOrNoteId: string | RemoteWorkoutLocator,
  options: ResolveRemoteWorkoutOptions = {},
): Promise<ResolvedRemoteWorkout | undefined> {
  const { entry, canonicalUuid, requestedFeedId } = await resolveRemoteEntryFromStorageOrLocator(
    locatorOrNoteId,
    options,
  );
  const db = await resolveTargetStorage(options.storage);

  if (db && canonicalUuid && !options.forceRefresh) {
    try {
      const existing = (await db.readonly('notes').get(canonicalUuid)) as RetentionNote | undefined;
      if (existing) {
        const isUserOwned =
          existing.seedOrigin !== 'seed' &&
          existing.feedOrigin !== 'feed' &&
          !existing.retention;
        const requestedVer = entry?.record.version ?? 0;
        const currentVer = existing.seedVersion ?? 0;
        const cachedFresh =
          existing.retention === 'cached' &&
          existing.rawContent.length > 0 &&
          (requestedVer === 0 || currentVer >= requestedVer);
        if (isUserOwned || existing.retention === 'session-pinned' || cachedFresh) {
          const fallbackRow = seedRowFromExistingNote(existing);
          const resolvedFeed = existing.feedSourceId ?? requestedFeedId;
          return {
            note: existing,
            seedRow: fallbackRow,
            row: fallbackRow,
            feedId: resolvedFeed,
            ...(entry ? { notebookSlug: entry.notebookSlug, record: entry.record } : {}),
            ...(resolvedFeed ? { remoteNoteId: `remote:${resolvedFeed}:${existing.id}` } : {}),
            canonicalNoteId: existing.id,
            fromCache: true,
          };
        }
      }
    } catch {
      // Fall through to remote fetch.
    }
  }

  if (!entry) return undefined;
  const reader = createFeedTreeReader(entry, options.source);
  const seedRow = await previewRemoteRecord(reader, entry.record, {
    fetchImpl: options.fetchImpl,
  });

  if (db && options.cache !== false) {
    const cachedNote = await materializeCachedRemoteRecord(db, {
      feedId: entry.feedId,
      notebookSlug: entry.notebookSlug,
      record: entry.record,
      seedRow,
      retention: 'cached',
      upstreamStatus: 'live',
    });
    return {
      note: cachedNote,
      seedRow,
      row: seedRow,
      feedId: entry.feedId,
      notebookSlug: entry.notebookSlug,
      record: entry.record,
      remoteNoteId: `remote:${entry.feedId}:${cachedNote.id}`,
      canonicalNoteId: cachedNote.id,
      fromCache: false,
    };
  }

  const canonicalId = entry.record.uuid || seedRow.uuid || canonicalUuid || seedRow.path;
  const syntheticNote: RetentionNote = {
    id: canonicalId,
    title: entry.record.title || seedRow.blockIndex[0]?.noteTitle || titleFromRecordRef(entry.record),
    rawContent: seedRow.content,
    sourceRevision: 1,
    blocks: seedRow.blocks,
    ...(entry.record.date !== undefined ? { date: entry.record.date } : {}),
    createdAt: entry.record.date ?? 0,
    notebookId: `notebook/${entry.notebookSlug}`,
    feedOrigin: 'feed',
    feedSourceId: entry.feedId,
    seedOrigin: 'seed',
    seedChunkId: `notebook.${entry.notebookSlug}`,
    seedVersion: entry.record.version ?? seedRow.version ?? 1,
    sourcePath: seedRow.path,
    retention: 'cached',
    upstreamStatus: 'live',
  };
  return {
    note: syntheticNote,
    seedRow,
    row: seedRow,
    feedId: entry.feedId,
    notebookSlug: entry.notebookSlug,
    record: entry.record,
    remoteNoteId: `remote:${entry.feedId}:${canonicalId}`,
    canonicalNoteId: canonicalId,
    fromCache: false,
  };
}

export async function loadRemoteRecordDetail(
  noteId: string,
  options: ResolveRemoteWorkoutOptions = {},
): Promise<SeedRow | undefined> {
  const { entry } = await resolveRemoteEntryFromStorageOrLocator(noteId, options);
  if (!entry) return undefined;
  const reader = createFeedTreeReader(entry, options.source);
  const seedRow = await previewRemoteRecord(reader, entry.record, {
    fetchImpl: options.fetchImpl,
  });
  if (options.cache !== false) {
    try {
      const db = await resolveTargetStorage(options.storage);
      if (db) {
        await materializeCachedRemoteRecord(db, {
          feedId: entry.feedId,
          notebookSlug: entry.notebookSlug,
          record: entry.record,
          seedRow,
          retention: 'cached',
          upstreamStatus: 'live',
        });
      }
    } catch {
      // Caching is best-effort for pure preview callers without open IStorage.
    }
  }
  return seedRow;
}

export async function cloneRemotePreviewNoteToNotebook(
  noteId: string,
  targetNotebookId: string,
  options: ResolveRemoteWorkoutOptions = {},
): Promise<Note> {
  const { entry } = await resolveRemoteEntryFromStorageOrLocator(noteId, options);
  if (!entry) {
    throw new Error(`Remote record metadata not found for ${noteId}`);
  }
  const db = await resolveTargetStorage(options.storage);
  if (!db) {
    throw new Error('Storage is not ready for cloning remote record');
  }
  const tree = createFeedTreeReader(entry, options.source);
  return cloneRemoteRecord(db, tree, {
    feedId: entry.feedId,
    record: entry.record,
    targetNotebookId,
    sourceNotebookId: `notebook/${entry.notebookSlug}`,
  });
}

export async function probeAndCacheFeedManifest(
  feedId: string,
  feedUrl: string,
  targetStorage?: IStorage,
): Promise<SeedManifest | undefined> {
  try {
    const probed = await probeFeedManifest(feedUrl, {
      feedId,
      storage: targetStorage,
    });
    return probed.manifest;
  } catch {
    return undefined;
  }
}

function resolveFeedDisplayLabel(src: FeedSource, manifest?: SeedManifest): string {
  const curated = src.label.trim();
  if (!curated) return manifest?.name?.trim() || src.id;
  if (src.tier === 'imported' && manifest?.name?.trim()) {
    let defaultHostLabel: string;
    try {
      defaultHostLabel = new URL(src.url).hostname;
    } catch {
      defaultHostLabel = '';
    }
    if (
      curated === 'Source' ||
      curated === src.url ||
      (defaultHostLabel && curated === defaultHostLabel)
    ) {
      return manifest.name.trim();
    }
  }
  return curated;
}

/** The generic copy `wod build` stamps into every manifest — never user-facing copy. */
const CLI_BOILERPLATE_MARKER = 'a Wod.Wiki community seed source';

/**
 * Curated copy wins over CLI-generated manifest copy (WW-015): a built-in
 * source's hand-written description must survive manifest caching, whose
 * `description` is the `wod build` boilerplate. Non-generic curated copy is
 * preferred; otherwise a non-generic manifest description; otherwise
 * whichever exists.
 */
export function resolveFeedDisplayDescription(src: FeedSource, manifest?: SeedManifest): string | undefined {
  const curated = src.description?.trim() || undefined;
  if (curated && !curated.includes(CLI_BOILERPLATE_MARKER)) return curated;
  const fromManifest = manifest?.description?.trim() || undefined;
  if (fromManifest && !fromManifest.includes(CLI_BOILERPLATE_MARKER)) return fromManifest;
  return curated ?? fromManifest;
}

async function readAllMetaMaps(): Promise<{
  catalogs: Map<string, SeedManifest>;
  checkpoints: Map<string, SeedMetaRecord>;
  indexes: Map<string, NotebookIndex>;
}> {
  const catalogs = new Map<string, SeedManifest>();
  const checkpoints = new Map<string, SeedMetaRecord>();
  const indexes = new Map<string, NotebookIndex>();
  try {
    await whenStorageReady().catch(() => undefined);
    await ensureRegistryHydratedOnce();
    const allMeta = await storage.readonly('meta').getAll();
    for (const row of allMeta) {
      if (isCatalogMeta(row)) {
        catalogs.set(row.feedId, row.manifest);
      } else if (isSeedMeta(row)) {
        checkpoints.set(row.key, row);
      } else if (isNotebookIndexMeta(row)) {
        indexes.set(row.key, row.index);
        const srcUrl = feedSourceById(row.feedId)?.url ?? '';
        const slug = notebookSlugForChunkId(row.notebookId) ?? canonicalNotebookSlug(row.notebookId);
        for (const rec of row.index.records) {
          registerRemoteRecordEntry({
            feedId: row.feedId,
            feedUrl: srcUrl,
            notebookSlug: slug,
            record: rec,
          });
        }
      }
    }
  } catch {
    // Ignore when storage not yet open
  }
  return { catalogs, checkpoints, indexes };
}

async function listCatalogNotebooks(): Promise<FeedNotebookCatalogRow[]> {
  await whenStorageReady().catch(() => undefined);
  await ensureRegistryHydratedOnce();
  const [localNotebooks, allNotes, allLinks, { catalogs, checkpoints, indexes }] = await Promise.all([
    notebookService.getAllNotebooks().catch(() => []),
    storage.readonly('notes').getAll().catch(() => [] as Note[]),
    storage.readonly('notebook_links').getAll().catch(() => [] as NotebookLink[]),
    readAllMetaMaps(),
  ]);

  const notesById = new Map(allNotes.map((n) => [n.id, n]));
  const noteCounts = countNotesByNotebook(allNotes, allLinks);

  const out: FeedNotebookCatalogRow[] = [];
  const seenKeys = new Set<string>();

  for (const nb of localNotebooks) {
    if (nb.origin !== 'user' && nb.origin !== 'default') continue;
    const landing = notesById.get(`notebook/${nb.slug}`);
    const key = `${nb.origin === 'default' ? 'core' : 'local'}#${nb.slug}`;
    seenKeys.add(key);
    out.push({
      id: nb.id,
      feedId: nb.origin === 'default' ? 'core' : 'local',
      feedLabel: nb.origin === 'default' ? 'Core' : 'Yours (Local)',
      chunkId: `notebook.${nb.slug}`,
      slug: nb.slug,
      label: nb.name,
      description: nb.description,
      category: nb.origin,
      count: noteCounts.get(toNotebookId(nb.slug)) ?? 0,
      subscribed: true,
      installed: true,
      origin: nb.origin,
      public: landing?.public === true,
      icon: nb.icon,
    });
  }

  for (const src of listFeedSources()) {
    const manifest = catalogs.get(src.id);
    const cp = checkpoints.get(seedMetaKey(src.id));
    const displayLabel = resolveFeedDisplayLabel(src, manifest);

    if (manifest?.notebooks && manifest.notebooks.length > 0) {
      for (const nbSummary of manifest.notebooks) {
        const slug =
          notebookSlugForChunkId(nbSummary.notebookId) ?? canonicalNotebookSlug(nbSummary.notebookId);
        const key = `${src.id}#${slug}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const chunkMeta = cp?.chunks?.[nbSummary.notebookId];
        const indexedMeta = indexes.get(feedIndexMetaKey(src.id, nbSummary.notebookId));
        out.push({
          id: `${src.id}:${nbSummary.notebookId}`,
          feedId: src.id,
          feedLabel: displayLabel,
          feedUrl: src.url,
          chunkId: nbSummary.notebookId,
          slug,
          label: nbSummary.label,
          description: manifest.description ?? src.description,
          category: nbSummary.category,
          count: nbSummary.count,
          version: nbSummary.version,
          commit: nbSummary.commit,
          sha256: nbSummary.sha256,
          updatedAt: nbSummary.updatedAt,
          builtAt: nbSummary.builtAt,
          indexPath: nbSummary.indexPath,
          subscribed: isNotebookSubscribed(src.id, nbSummary.notebookId),
          installed: Boolean(chunkMeta || indexedMeta),
          origin: 'feed',
        });
      }
    } else if (manifest) {
      for (const chunk of manifest.chunks) {
        if (!chunk.id.startsWith('notebook.')) continue;
        const slug = notebookSlugForChunkId(chunk.id) ?? chunk.id.slice('notebook.'.length);
        const key = `${src.id}#${slug}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const chunkMeta = cp?.chunks?.[chunk.id];
        const indexedMeta = indexes.get(feedIndexMetaKey(src.id, chunk.id));
        out.push({
          id: `${src.id}:${chunk.id}`,
          feedId: src.id,
          feedLabel: displayLabel,
          feedUrl: src.url,
          chunkId: chunk.id,
          slug,
          label: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: manifest.description ?? src.description,
          count: chunk.count,
          version: manifest.version,
          sha256: chunk.sha256,
          builtAt: manifest.builtAt,
          indexPath: `indexes/notebooks/${chunk.id}.json`,
          subscribed: isNotebookSubscribed(src.id, chunk.id),
          installed: Boolean(chunkMeta || indexedMeta),
          origin: 'feed',
        });
      }
    } else {
      const fallbackDefs = notebooksOfFeed(src.id);
      for (const def of fallbackDefs) {
        const slug = canonicalNotebookSlug(def.chunkId || def.id);
        const key = `${src.id}#${slug}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const chunkMeta = cp?.chunks?.[def.chunkId];
        const indexedMeta = indexes.get(feedIndexMetaKey(src.id, def.chunkId));
        out.push({
          id: def.id,
          feedId: src.id,
          feedLabel: displayLabel,
          feedUrl: src.url,
          chunkId: def.chunkId,
          slug,
          label: def.label,
          description: def.description,
          category: def.category,
          count: indexedMeta?.count ?? chunkMeta?.noteIds?.length ?? 0,
          indexPath: `indexes/notebooks/${def.chunkId}.json`,
          subscribed: isNotebookSubscribed(src.id, def.chunkId),
          installed: Boolean(chunkMeta || indexedMeta),
          origin: 'feed',
        });
      }
    }
  }

  return out;
}

export const playgroundFeedCatalogStore: FeedCatalogQueryStore = {
  async getAllFeeds(): Promise<FeedSourceCatalogRow[]> {
    const [{ catalogs, checkpoints }, outbound] = await Promise.all([
      readAllMetaMaps(),
      getOutboundFeedStatus().catch(
        (): OutboundFeedStatus => ({
          hasPublicContent: false,
          publishedVersion: null,
          builtAt: null,
          dirty: false,
          publicNotebooks: 0,
          publicNotes: 0,
          publicSessions: 0,
          changes: [],
          mode: storageBackend === 'api' ? 'self-hosted' : 'browser-repo',
        }),
      ),
    ]);

    const rows: FeedSourceCatalogRow[] = [];

    const selfUrl =
      outbound.feedUrl ??
      (storageBackend === 'api' && typeof window !== 'undefined'
        ? `${window.location.origin}/feed/`
        : 'wod-wiki-feed-repository (.zip / folder)');
    rows.push({
      id: 'local',
      label: 'My Published Feed',
      url: selfUrl,
      description:
        outbound.publicNotebooks > 0
          ? `Publishes ${outbound.publicNotebooks} public notebook(s), ${outbound.publicNotes} note(s), and ${outbound.publicSessions} opted-in session(s).`
          : 'Mark any user-owned notebook as Public to publish via self-hosted server or export a wod-wiki-feed-repository.',
      tier: 'local',
      subscribed: true,
      installed: true,
      notebookCount: outbound.publicNotebooks,
      itemCount: outbound.publicNotes,
      localVersion: outbound.publishedVersion ?? undefined,
      remoteVersion: outbound.publishedVersion ?? undefined,
      unpublishedChanges: outbound.dirty,
      builtAt: outbound.builtAt ?? undefined,
    });

    const registered = [CORE_FEED_SOURCE, ...listFeedSources()];
    for (const src of registered) {
      const manifest = catalogs.get(src.id);
      const cp = checkpoints.get(seedMetaKey(src.id));
      const sub = src.id === 'core' ? true : isFeedSubscribed(src.id);
      const installed = (cp?.seedVersion ?? 0) > 0;
      const fallbackNbs = notebooksOfFeed(src.id);

      const notebookCount = manifest?.notebooks
        ? manifest.notebooks.length
        : manifest
          ? manifest.chunks.filter((c) => c.id.startsWith('notebook.')).length
          : fallbackNbs.length;

      const cpNoteCount = cp
        ? Object.values(cp.chunks ?? {}).reduce(
            (acc, c) => acc + (Array.isArray(c?.noteIds) ? c.noteIds.length : 0),
            0,
          )
        : 0;
      const manifestItemCount = manifest?.notebooks
        ? manifest.notebooks.reduce((acc, n) => acc + n.count, 0)
        : manifest
          ? manifest.chunks.reduce((acc, c) => acc + c.count, 0)
          : 0;

      const localVer = cp?.seedVersion || undefined;
      const remoteVer = manifest?.version;
      const updateAvailable = Boolean(sub && localVer && remoteVer && remoteVer > localVer);

      rows.push({
        id: src.id,
        label: resolveFeedDisplayLabel(src, manifest),
        url: src.id === 'core' ? toAbsoluteFeedUrl(CORE_FEED_URL) : src.url,
        repositoryUrl: manifest?.repositoryUrl ?? src.repositoryUrl,
        description: resolveFeedDisplayDescription(src, manifest),
        tier: src.id === 'core' ? 'core' : (src.tier ?? 'imported'),
        subscribed: sub,
        installed,
        notebookCount,
        itemCount: manifestItemCount || cpNoteCount,
        localVersion: localVer,
        remoteVersion: remoteVer,
        updateAvailable,
        builtAt: manifest?.builtAt ?? cp?.builtAt,
      });
    }

    return rows;
  },

  getAllNotebooks: listCatalogNotebooks,

  async getRemoteNotebookNotes(slug: string, feedId?: string): Promise<Note[]> {
    const cleanSlug = canonicalNotebookSlug(slug);
    const chunkId = `notebook.${cleanSlug}`;
    const allNbs = await listCatalogNotebooks();
    const effectiveFeedId =
      feedId ??
      (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('feed') ?? undefined : undefined);

    let candidate = allNbs.find(
      (nb) =>
        nb.origin === 'feed' &&
        nb.slug === cleanSlug &&
        (!effectiveFeedId || nb.feedId === effectiveFeedId),
    );

    if (!candidate && effectiveFeedId) {
      const src = feedSourceById(effectiveFeedId);
      if (src?.url) {
        await probeAndCacheFeedManifest(effectiveFeedId, src.url);
        const refreshed = await listCatalogNotebooks();
        candidate = refreshed.find(
          (nb) => nb.origin === 'feed' && nb.slug === cleanSlug && nb.feedId === effectiveFeedId,
        );
      }
    }

    if (!candidate) {
      const customs = customFeedSources();
      for (const custom of customs) {
        await probeAndCacheFeedManifest(custom.id, custom.url);
      }
      if (customs.length > 0) {
        const refreshed = await listCatalogNotebooks();
        candidate = refreshed.find((nb) => nb.origin === 'feed' && nb.slug === cleanSlug);
      }
    }

    const feedUrl = candidate?.feedUrl ?? (effectiveFeedId ? feedSourceById(effectiveFeedId)?.url : undefined);
    const resolvedFeedId = candidate?.feedId ?? effectiveFeedId;
    if (!feedUrl || !resolvedFeedId) return [];

    const indexPath = candidate?.indexPath ?? `indexes/notebooks/${chunkId}.json`;
    const cacheKey = `${feedUrl}#${indexPath}@${candidate?.sha256 ?? 'latest'}`;
    let notebookIndex = remoteIndexCache.get(cacheKey);
    if (!notebookIndex) {
      const cachedInStorage = await readFeedNotebookIndex(resolvedFeedId, chunkId);
      if (
        cachedInStorage &&
        (!candidate?.sha256 || cachedInStorage.sha256 === candidate.sha256)
      ) {
        notebookIndex = cachedInStorage;
        remoteIndexCache.set(cacheKey, notebookIndex);
      }
    }
    if (!notebookIndex) {
      try {
        const tree = new HttpFeedTree(feedUrl);
        notebookIndex = await previewRemoteNotebook(tree, indexPath);
        remoteIndexCache.set(cacheKey, notebookIndex);
        await saveFeedNotebookIndex(resolvedFeedId, chunkId, notebookIndex);
      } catch {
        return [];
      }
    }

    return notebookIndex.records.map((rec): Note => {
      registerRemoteRecordEntry({
        feedId: resolvedFeedId,
        feedUrl,
        notebookSlug: cleanSlug,
        record: rec,
      });
      const syntheticId = `remote:${resolvedFeedId}:${rec.uuid}`;
      const itemRel = rec.path
        .replace(/^markdown\/notebooks\/[^/]+\//, '')
        .replace(/\.md$/i, '');
      return {
        id: syntheticId,
        title: titleFromRecordRef(rec),
        rawContent: '',
        sourceRevision: 1,
        blocks: {},
        ...(rec.date !== undefined ? { date: rec.date } : {}),
        createdAt: rec.date ?? 0,
        notebookId: `notebook/${cleanSlug}`,
        sourceId: `notebook:${cleanSlug}/${itemRel}`,
        sourcePath: rec.path,
        feedOrigin: 'feed',
        feedSourceId: resolvedFeedId,
        seedOrigin: 'seed',
        seedChunkId: chunkId,
        seedVersion: rec.version,
        tags: ['preview:remote'],
      };
    });
  },
};
