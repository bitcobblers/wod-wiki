import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEED_REGISTRY_META_KEY,
  FEED_SUBSCRIPTIONS_META_KEY,
  feedIndexMetaKey,
  type NotebookIndex,
  type SeedManifest,
  type SeedRow,
} from '@bitcobblers/wod-wiki-engine';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import type { Session } from '@/types/storage';
import { InMemoryFeedStorage } from './FeedImportStorage';
import type { IFeedSource } from './IFeedSource';
import {
  addCustomFeedSource,
  customFeedSources,
  hiddenFeedSourceIds,
  hideFeedSourceRow,
} from './feedSources';
import {
  flushFeedStatePersistence,
  getFeedOfflinePolicy,
  hydrateFeedStateFromStorage,
  isFeedAutoSync,
  isFeedSubscribed,
  resetFeedSubscriptionsForTest,
  setFeedAutoSync,
  setFeedOfflinePolicy,
  setFeedSubscribed,
  subscribeFeedSubscriptions,
} from './feedSubscriptions';
import { resetFeedRegistryStoreForTest } from './feedRegistryStore';
import {
  downloadFeedOffline,
  probeFeedManifest,
  readFeedStatus,
  subscribeFeed,
  toggleNotebookSubscription,
  unsubscribeFeedSource,
  type FeedSourceSpec,
} from './feedSync';
import {
  loadRemoteRecordDetail,
  readFeedCatalogManifest,
  resolveRemoteWorkout,
} from './feedCatalog';
import { ensurePlaygroundDefaultSubscriptions } from './playgroundFeedBootstrap';
import { resetSyncActivityForTest } from '@/services/syncActivity';

function makeSpec(source: IFeedSource, id: string, label = id): FeedSourceSpec {
  return {
    id,
    label,
    source,
    url: `https://feed.example/${id}/`,
    embeddedVersion: 0,
    autoImport: false,
  };
}

describe('index-first distributed feeds, lazy workout resolution, unified IStorage registry, and pinning', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    resetFeedRegistryStoreForTest();
    resetSyncActivityForTest();
  });

  it('subscribing to a distributed feed defaults to index-only and skips chunk downloads until downloadFeedOffline', async () => {
    const storage = new InMemoryFeedStorage();
    const rowJson = await compileSeedRow('markdown/notebooks/kettlebell/simple.md', '# Simple & Sinister\n\n```time\n10:00 EMOM\n  10 Swings\n```\n');
    const rowMdRaw = '# Armor Building\n\n```time\n5:00 EMOM\n  2 Cleans\n  1 Press\n  3 Squats\n```\n';
    const rowMdCompiled = await compileSeedRow('markdown/notebooks/kettlebell/abc.md', rowMdRaw);
    const uuidJson = rowJson.uuid ?? '01950000-0000-7000-8000-000000001001';
    const uuidMd = '01950000-0000-7000-8000-000000001002';

    const nbIndex: NotebookIndex = {
      notebookId: 'notebook.kettlebell',
      label: 'Kettlebell',
      indexPath: 'indexes/notebooks/notebook.kettlebell.json',
      version: 5,
      commit: 'abc5',
      builtAt: '2026-11-21T00:00:00.000Z',
      sha256: '1'.repeat(64),
      bytes: 512,
      indexBytes: 512,
      chunkBytes: 2048,
      count: 2,
      records: [
        {
          uuid: uuidJson,
          path: 'markdown/notebooks/kettlebell/simple.md',
          recordPath: 'records/simple.json',
          commit: 'abc5',
          version: 5,
          sha256: '2'.repeat(64),
          title: 'Simple & Sinister',
        },
        {
          uuid: uuidMd,
          path: 'markdown/notebooks/kettlebell/abc.md',
          rawUrl: 'raw/abc.md',
          commit: 'abc5',
          version: 5,
          sha256: '3'.repeat(64),
          title: 'Armor Building',
        },
      ],
    };

    const manifest: SeedManifest = {
      name: 'Kettlebell Collective',
      description: 'Heavy bells only',
      schema: 10,
      version: 5,
      builtAt: '2026-11-21T00:00:00.000Z',
      indexBytes: 512,
      chunkBytes: 2048,
      chunks: [
        {
          id: 'notebook.kettlebell',
          path: 'chunks/notebook.kettlebell.json',
          sha256: '4'.repeat(64),
          bytes: 2048,
          count: 2,
        },
      ],
      notebooks: [
        {
          notebookId: nbIndex.notebookId,
          label: nbIndex.label,
          indexPath: nbIndex.indexPath,
          version: nbIndex.version,
          commit: nbIndex.commit,
          builtAt: nbIndex.builtAt,
          sha256: nbIndex.sha256,
          bytes: nbIndex.bytes,
          indexBytes: 512,
          chunkBytes: 2048,
          count: 2,
        },
      ],
    };

    const chunkFetches: string[] = [];
    const textFetches: string[] = [];
    let manifestFetches = 0;

    const remoteSource: IFeedSource = {
      async fetchManifest() {
        manifestFetches++;
        return manifest;
      },
      async fetchChunk(path: string) {
        chunkFetches.push(path);
        if (path === nbIndex.indexPath) return nbIndex;
        if (path === 'records/simple.json') return rowJson;
        if (path === 'chunks/notebook.kettlebell.json') return [rowJson, rowMdCompiled];
        throw new Error(`Unexpected path ${path}`);
      },
      async fetchText(path: string) {
        textFetches.push(path);
        if (path === 'raw/abc.md') return rowMdRaw;
        throw new Error(`Missing markdown ${path}`);
      },
    };

    const sources = [makeSpec(remoteSource, 'kb-feed', 'Kettlebell Collective')];

    // 1. probeFeedManifest inspects metadata & byte sizes before registering
    const probed = await probeFeedManifest('https://feed.example/kb-feed', { source: remoteSource });
    expect(probed.name).toBe('Kettlebell Collective');
    expect(probed.notebookCount).toBe(1);
    expect(probed.itemCount).toBe(2);
    expect(probed.indexBytes).toBe(512);
    expect(probed.chunkBytes).toBe(2048);
    expect(probed.hasOfflineChunks).toBe(true);
    manifestFetches = 0;

    // 2. subscribeFeed fetches ONLY manifest + notebook index (0 chunk bundles)
    const outcome = await subscribeFeed('kb-feed', { sources, storage, isEnabled: () => true });
    expect(outcome).toBe('imported');
    expect(getFeedOfflinePolicy('kb-feed')).toBe('index-only');
    expect(isFeedSubscribed('kb-feed')).toBe(true);
    expect(chunkFetches).toEqual(['indexes/notebooks/notebook.kettlebell.json']);
    expect(chunkFetches).not.toContain('chunks/notebook.kettlebell.json');
    expect(await readFeedCatalogManifest('kb-feed', storage.storageInstance)).toMatchObject({ version: 5 });
    expect(await storage.getMeta(feedIndexMetaKey('kb-feed', 'notebook.kettlebell'))).toBeTruthy();

    // 3. readFeedStatus reads cached catalog:<feedId> with 0 manifest HTTP fetches unless probe: true
    manifestFetches = 0;
    const cachedStatus = await readFeedStatus({ sources, storage });
    expect(manifestFetches).toBe(0);
    expect(cachedStatus.sources[0]!.remote?.version).toBe(5);
    expect(cachedStatus.sources[0]!.offlinePolicy).toBe('index-only');
    expect(cachedStatus.sources[0]!.indexBytes).toBe(512);
    expect(cachedStatus.sources[0]!.chunkBytes).toBe(2048);

    const probedStatus = await readFeedStatus({ sources, storage, probe: true, now: () => 9999 });
    expect(manifestFetches).toBe(1);
    expect(probedStatus.sources[0]!.checkedAt).toBe(9999);

    // 4. resolveRemoteWorkout lazily fetches raw .md and caches under canonical uuid
    const resolvedMd = await resolveRemoteWorkout(`remote:kb-feed:${uuidMd}`, {
      storage: storage.storageInstance,
      source: remoteSource,
    });
    expect(resolvedMd).toBeTruthy();
    expect(resolvedMd!.fromCache).toBe(false);
    expect(resolvedMd!.canonicalNoteId).toBe(uuidMd);
    expect(resolvedMd!.note.id).toBe(uuidMd);
    expect(resolvedMd!.note.retention).toBe('cached');
    expect(resolvedMd!.note.upstreamStatus).toBe('live');
    expect(textFetches).toEqual(['raw/abc.md']);

    // Second resolve uses local IStorage cache (0 extra network calls)
    const resolvedFromCache = await resolveRemoteWorkout(uuidMd, {
      storage: storage.storageInstance,
      source: remoteSource,
    });
    expect(resolvedFromCache?.fromCache).toBe(true);
    expect(textFetches).toEqual(['raw/abc.md']);

    // loadRemoteRecordDetail handles compiled recordPath JSON and caches under canonical uuid
    const detailRow: SeedRow | undefined = await loadRemoteRecordDetail(`remote:kb-feed:${uuidJson}`, {
      storage: storage.storageInstance,
      source: remoteSource,
    });
    expect(detailRow?.content).toContain('Simple & Sinister');
    const cachedSimple = await storage.storageInstance.readonly('notes').get(uuidJson);
    expect((cachedSimple as { retention?: string } | undefined)?.retention).toBe('cached');

    // 5. Explicit downloadFeedOffline upgrades policy and fetches chunks/records
    chunkFetches.length = 0;
    const offlineOutcome = await downloadFeedOffline('kb-feed', undefined, {
      sources,
      storage,
      isEnabled: () => true,
    });
    expect(offlineOutcome).toBe('imported');
    expect(getFeedOfflinePolicy('kb-feed')).toBe('offline-full');
    expect(chunkFetches).toContain('chunks/notebook.kettlebell.json');
  });

  it('migrates legacy localStorage once into IStorage meta cleanly and treats IStorage as canonical across resets', async () => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([
      { id: 'coach-jane', label: 'Coach Jane', url: 'https://jane.example/feed/' },
    ]));
    localStorage.setItem('wodwiki.seedSources.hidden', JSON.stringify(['sport-yoga']));
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({
      'coach-jane': true,
      'samples-movement': false,
    }));
    localStorage.setItem('wodwiki.seedAutoSync', JSON.stringify({ 'coach-jane': true }));
    localStorage.setItem('wodwiki.seedChecks', JSON.stringify({ 'coach-jane': 4242 }));

    const storage = new InMemoryFeedStorage();
    await hydrateFeedStateFromStorage(storage.storageInstance);

    expect(customFeedSources().map((f) => f.id)).toEqual(['coach-jane']);
    expect(hiddenFeedSourceIds()).toEqual(['sport-yoga']);
    expect(isFeedSubscribed('coach-jane')).toBe(true);
    expect(isFeedSubscribed('samples-movement')).toBe(false);
    expect(isFeedAutoSync('coach-jane')).toBe(true);

    // Non-destructive: legacy localStorage stays intact
    expect(localStorage.getItem('wodwiki.seedSources')).toBeTruthy();

    // Subsequent mutations go through IStorage & notify synchronous React listeners
    const onChange = vi.fn();
    const unsub = subscribeFeedSubscriptions(onChange);
    setFeedOfflinePolicy('coach-jane', 'offline-full');
    const added = addCustomFeedSource('New Gym', 'https://gym.example/feed');
    hideFeedSourceRow('sport-hyrox');
    setFeedSubscribed(added.id, true);
    setFeedAutoSync(added.id, true);
    unsub();
    expect(onChange).toHaveBeenCalled();
    await flushFeedStatePersistence();

    const storedReg = await storage.getMeta(FEED_REGISTRY_META_KEY);
    const storedSubs = await storage.getMeta(FEED_SUBSCRIPTIONS_META_KEY);
    expect(storedReg).toBeTruthy();
    expect(storedSubs).toBeTruthy();

    // Clear localStorage completely and wipe in-memory caches (simulating cold worker/CLI/tab reload)
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);

    // IStorage still restores everything — including explicit opt-out on samples-movement!
    expect(customFeedSources().map((f) => f.id)).toEqual(['coach-jane', added.id]);
    expect(hiddenFeedSourceIds().sort()).toEqual(['sport-hyrox', 'sport-yoga']);
    expect(isFeedSubscribed('coach-jane')).toBe(true);
    expect(getFeedOfflinePolicy('coach-jane')).toBe('offline-full');
    expect(isFeedSubscribed('samples-movement')).toBe(false);

    // Bootstrap respects IStorage opt-out for samples-movement while defaulting samples-results offline-full
    const seeded = ensurePlaygroundDefaultSubscriptions([
      { id: 'samples-movement' },
      { id: 'samples-results' },
    ]);
    expect(seeded).toEqual(['samples-results']);
    expect(getFeedOfflinePolicy('samples-results')).toBe('offline-full');
    expect(isFeedSubscribed('samples-movement')).toBe(false);
  });

  it('protects session-pinned and sessions-attached cached workouts on unsubscribe and notebook toggle', async () => {
    const storage = new InMemoryFeedStorage();
    const uuidPinned = '01950000-0000-7000-8000-000000002001';
    const uuidFree = '01950000-0000-7000-8000-000000002002';

    const nbIndex: NotebookIndex = {
      notebookId: 'notebook.girls',
      label: 'The Girls',
      indexPath: 'indexes/notebooks/notebook.girls.json',
      version: 1,
      commit: 'c1',
      builtAt: '2026-11-21T00:00:00.000Z',
      sha256: '5'.repeat(64),
      bytes: 400,
      count: 2,
      records: [
        {
          uuid: uuidPinned,
          path: 'markdown/notebooks/girls/fran.md',
          rawUrl: 'raw/fran.md',
          commit: 'c1',
          version: 1,
          sha256: '6'.repeat(64),
          title: 'Fran',
        },
        {
          uuid: uuidFree,
          path: 'markdown/notebooks/girls/cindy.md',
          rawUrl: 'raw/cindy.md',
          commit: 'c1',
          version: 1,
          sha256: '7'.repeat(64),
          title: 'Cindy',
        },
      ],
    };

    const nbSummary = {
      notebookId: nbIndex.notebookId,
      label: nbIndex.label,
      indexPath: nbIndex.indexPath,
      version: nbIndex.version,
      commit: nbIndex.commit,
      builtAt: nbIndex.builtAt,
      sha256: nbIndex.sha256,
      bytes: nbIndex.bytes,
      count: nbIndex.count,
    };
    const source: IFeedSource = {
      fetchManifest: async () => ({
        name: 'Benchmark Girls',
        schema: 10,
        version: 1,
        builtAt: '2026-11-21T00:00:00.000Z',
        chunks: [],
        notebooks: [nbSummary],
      }),
      fetchChunk: async () => nbIndex,
      fetchText: async (path) =>
        path === 'raw/fran.md'
          ? '# Fran\n\n```time\n21-15-9\n  Thrusters\n  Pull-ups\n```\n'
          : '# Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n```\n',
    };
    const sources = [makeSpec(source, 'girls-feed')];

    await subscribeFeed('girls-feed', { sources, storage, isEnabled: () => true });
    const franResolved = await resolveRemoteWorkout(`remote:girls-feed:${uuidPinned}`, {
      storage: storage.storageInstance,
      source,
    });
    await resolveRemoteWorkout(`remote:girls-feed:${uuidFree}`, {
      storage: storage.storageInstance,
      source,
    });

    const franBlockId = Object.keys(franResolved!.note.blocks)[0]!;

    // Attach a session row to Fran (even while retention is still 'cached')
    const session: Session = {
      id: 'fran-run-1',
      noteId: uuidPinned,
      blockId: franBlockId,
      blockVersion: 1,
      status: 'completed',
      startTime: 100,
      endTime: 200,
      duration: 100,
      completed: true,
      createdAt: 200,
    };
    await storage.storageInstance.readwrite('sessions').put(session);

    // Unsubscribing notebook cleans Cindy, preserves Fran + stamps upstreamStatus: 'unsubscribed'
    const nbRes = await toggleNotebookSubscription('girls-feed', 'notebook.girls', false, {
      sources,
      storage,
      isEnabled: () => true,
    });
    expect(nbRes.deleted).toBe(1);
    expect(nbRes.preservedPinned).toBe(1);
    expect(await storage.storageInstance.readonly('notes').get(uuidFree)).toBeUndefined();

    const kept = (await storage.storageInstance.readonly('notes').get(uuidPinned)) as {
      retention?: string;
      upstreamStatus?: string;
    };
    expect(kept.retention).toBe('session-pinned');
    expect(kept.upstreamStatus).toBe('unsubscribed');

    // Feed-wide unsubscribe preserves pinned copy cleanly too
    const unsubFeedRes = await unsubscribeFeedSource('girls-feed', { storage });
    expect(unsubFeedRes.preservedPinned).toBe(1);
    expect(await storage.storageInstance.readonly('notes').get(uuidPinned)).toBeTruthy();
  });
});
