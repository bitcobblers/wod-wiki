/**
 * feedCatalog — manifest-backed distributed Feed & Notebook catalog seam for WQL.
 *
 * Unifies:
 *   - "My Published Feed" (`local`) — user's public Notebooks & public Sessions
 *     (self-hosted `/feed/` on `wod server` or `wod-wiki-feed-repository` in browser)
 *   - Built-in & custom distributed Feeds — manifest summaries persisted in `meta`
 *     (`catalog:<feedId>`), falling back to bootstrap definitions before first probe
 *   - Zero-import remote preview (`getRemoteNotebookNotes`) & single-record Clone
 *     via `HttpFeedTree` + `previewRemoteNotebook` / `cloneRemoteRecord`
 */

import {
  HttpFeedTree,
  cloneRemoteRecord,
  notebookSlugForChunkId,
  previewRemoteNotebook,
  previewRemoteRecord,
  seedMetaKey,
  type FeedCatalogQueryStore,
  type FeedNotebookCatalogRow,
  type FeedSourceCatalogRow,
  type NotebookIndex,
  type SeedManifest,
  type SeedMetaRecord,
  type SeedRecordRef,
  type SeedRow,
} from '@bitcobblers/wod-wiki-engine';
import type { Note } from '@/types/storage';
import { storage, storageBackend, whenStorageReady } from '@/services/storage';
import { notebookService } from '@/services/NotebookService';
import {
  CORE_FEED_SOURCE,
  CORE_FEED_URL,
  canonicalNotebookSlug,
  customFeedSources,
  feedSourceById,
  listFeedSources,
  notebooksOfFeed,
  toAbsoluteFeedUrl,
  type FeedSource,
} from './feedSources';
import { isFeedSubscribed, isNotebookSubscribed } from './feedSubscriptions';
import { getOutboundFeedStatus, type OutboundFeedStatus } from '@/services/ExportImportService';

export const FEED_CATALOG_META_PREFIX = 'catalog:';

export interface FeedCatalogMetaRecord {
  key: string;
  feedId: string;
  manifest: SeedManifest;
  updatedAt: number;
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

function isSeedMeta(v: unknown): v is SeedMetaRecord {
  return (
    typeof v === 'object' &&
    v !== null &&
    'key' in v &&
    typeof v.key === 'string' &&
    v.key.startsWith('seed:')
  );
}

export async function saveFeedCatalogManifest(feedId: string, manifest: SeedManifest): Promise<void> {
  const rec: FeedCatalogMetaRecord = {
    key: `${FEED_CATALOG_META_PREFIX}${feedId}`,
    feedId,
    manifest,
    updatedAt: Date.now(),
  };
  try {
    await whenStorageReady().catch(() => undefined);
    await storage.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put(rec);
    });
  } catch {
    // Non-fatal in read-only or uninitialized test harnesses
  }
}

export async function readFeedCatalogManifest(feedId: string): Promise<SeedManifest | undefined> {
  try {
    await whenStorageReady().catch(() => undefined);
    const raw = await storage.readonly('meta').get(`${FEED_CATALOG_META_PREFIX}${feedId}`);
    return isCatalogMeta(raw) ? raw.manifest : undefined;
  } catch {
    return undefined;
  }
}

const remoteIndexCache = new Map<string, NotebookIndex>();
const remoteRecordLookup = new Map<
  string,
  { feedId: string; feedUrl: string; notebookSlug: string; record: SeedRecordRef }
>();

export function lookupRemoteRecord(noteId: string): {
  feedId: string;
  feedUrl: string;
  notebookSlug: string;
  record: SeedRecordRef;
} | undefined {
  return remoteRecordLookup.get(noteId);
}

export async function loadRemoteRecordDetail(noteId: string): Promise<SeedRow | undefined> {
  const entry = remoteRecordLookup.get(noteId);
  if (!entry) return undefined;
  const tree = new HttpFeedTree(entry.feedUrl);
  return previewRemoteRecord(tree, entry.record.recordPath);
}

export async function cloneRemotePreviewNoteToNotebook(
  noteId: string,
  targetNotebookId: string,
): Promise<Note> {
  const entry = remoteRecordLookup.get(noteId);
  if (!entry) {
    throw new Error(`Remote record metadata not found for ${noteId}`);
  }
  await whenStorageReady().catch(() => undefined);
  const tree = new HttpFeedTree(entry.feedUrl);
  return cloneRemoteRecord(storage, tree, {
    feedId: entry.feedId,
    record: entry.record,
    targetNotebookId,
  });
}

export async function probeAndCacheFeedManifest(
  feedId: string,
  feedUrl: string,
): Promise<SeedManifest | undefined> {
  try {
    const tree = new HttpFeedTree(feedUrl);
    const manifest = await tree.readJson<SeedManifest>('manifest.json');
    await saveFeedCatalogManifest(feedId, manifest);
    return manifest;
  } catch {
    return undefined;
  }
}

function resolveFeedDisplayLabel(src: FeedSource, manifest?: SeedManifest): string {
  const curated = src.label.trim();
  if (!curated) return manifest?.name?.trim() || src.id;
  if (src.tier === 'imported' && manifest?.name?.trim()) {
    let defaultHostLabel = '';
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

async function readAllMetaMaps(): Promise<{
  catalogs: Map<string, SeedManifest>;
  checkpoints: Map<string, SeedMetaRecord>;
}> {
  const catalogs = new Map<string, SeedManifest>();
  const checkpoints = new Map<string, SeedMetaRecord>();
  try {
    await whenStorageReady().catch(() => undefined);
    const allMeta = await storage.readonly('meta').getAll();
    for (const row of allMeta) {
      if (isCatalogMeta(row)) {
        catalogs.set(row.feedId, row.manifest);
      } else if (isSeedMeta(row)) {
        checkpoints.set(row.key, row);
      }
    }
  } catch {
    // Ignore when storage not yet open
  }
  return { catalogs, checkpoints };
}

async function listCatalogNotebooks(): Promise<FeedNotebookCatalogRow[]> {
  await whenStorageReady().catch(() => undefined);
  const [localNotebooks, allNotes, { catalogs, checkpoints }] = await Promise.all([
    notebookService.getAllNotebooks().catch(() => []),
    storage.readonly('notes').getAll().catch(() => [] as Note[]),
    readAllMetaMaps(),
  ]);

  const notesById = new Map(allNotes.map((n) => [n.id, n]));
  const noteCountBySlug = new Map<string, number>();
  for (const n of allNotes) {
    if (n.id.startsWith('notebook/') && n.notebookId === n.id) continue;
    if (n.notebookId) {
      const slug = n.notebookId.replace(/^notebook\//, '');
      noteCountBySlug.set(slug, (noteCountBySlug.get(slug) ?? 0) + 1);
    }
  }

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
      count: noteCountBySlug.get(nb.slug) ?? 0,
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
          installed: Boolean(chunkMeta),
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
          installed: Boolean(chunkMeta),
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
          count: chunkMeta?.noteIds?.length ?? 0,
          indexPath: `indexes/notebooks/${def.chunkId}.json`,
          subscribed: isNotebookSubscribed(src.id, def.chunkId),
          installed: Boolean(chunkMeta),
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
        description: manifest?.description ?? src.description,
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
      try {
        const tree = new HttpFeedTree(feedUrl);
        notebookIndex = await previewRemoteNotebook(tree, indexPath);
        remoteIndexCache.set(cacheKey, notebookIndex);
      } catch {
        return [];
      }
    }

    return notebookIndex.records.map((rec): Note => {
      const syntheticId = `remote:${resolvedFeedId}:${rec.uuid}`;
      remoteRecordLookup.set(syntheticId, {
        feedId: resolvedFeedId,
        feedUrl,
        notebookSlug: cleanSlug,
        record: rec,
      });
      const itemRel = rec.path
        .replace(/^markdown\/notebooks\/[^/]+\//, '')
        .replace(/\.md$/i, '');
      return {
        id: syntheticId,
        title: rec.title,
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
