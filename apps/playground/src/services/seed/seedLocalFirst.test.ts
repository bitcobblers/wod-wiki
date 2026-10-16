/**
 * Local-first contract checks — one focused suite over FeedBoot seams:
 * sync-activity parallel/idempotent accounting, feed subscriptions
 * (core always on, persisted off stays off, migration, manual commit),
 * boot policy (return visit refreshes manifests despite the embedded
 * fast path and only subscribed feeds; fresh visit runs core only), and
 * committed NEW vs UPDATED record counting (user-owned rows excluded).
 */
import { describe, expect, it, beforeEach, spyOn } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { emptySeedMeta, seedMetaKey, SEED_SCHEMA } from '@/types/seed';
import { InMemorySeedStorage } from './SeedImportStorage';
import { CountingSeedSource, InMemorySeedSource } from './InMemorySeedSource';
import type { ISeedSource, SeedChunkPayload } from './ISeedSource';
import { seedFixture as fixture } from './seedFixture';
import { runBootSeedSync, runSeedSync, syncSeedSource, getCatalogUpdates, type SeedSourceSpec } from './seedSync';
import { getSeedReadiness, resetSeedReadinessForTest, startSeedBootstrap } from './seedReadiness';
import { seedNoteId } from './SeedImporter';
import {
  isSeedSubscribed,
  migrateSeedSubscriptions,
  resetSeedSubscriptionsForTest,
  setSeedAutoSync,
  setSeedSubscribed,
} from './seedSubscriptions';
import {
  beginSyncActivity,
  getSyncActivity,
  reportSyncError,
  reportSyncResult,
  resetSyncActivityForTest,
  subscribeSyncActivity,
} from '@/services/syncActivity';

function spec(source: SeedSourceSpec['source'], id: string, embeddedVersion = 0, autoImport?: boolean): SeedSourceSpec {
  return { source, id, label: id, url: `https://seed.test/${id}/`, embeddedVersion, ...(autoImport === undefined ? {} : { autoImport }) };
}
const row = (path: string, content: string) => compileSeedRow(path, content);

beforeEach(() => {
  localStorage.clear();
  resetSeedSubscriptionsForTest();
  resetSyncActivityForTest();
  resetSeedReadinessForTest();
});

describe('syncActivity store', () => {
  it('counts parallel activity, ends idempotently, and notifies subscribers', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeSyncActivity(() => seen.push(getSyncActivity().label ?? '-'));
    const endA = beginSyncActivity('download', 'Core');
    const endB = beginSyncActivity('download', 'Community');
    const endC = beginSyncActivity('upload', 'Backup');
    expect(getSyncActivity()).toMatchObject({ uploading: 1, downloading: 2, label: 'Backup' });
    endB();
    endB(); // idempotent: second call is a no-op
    expect(getSyncActivity()).toMatchObject({ uploading: 1, downloading: 1, label: 'Backup' });
    endA();
    expect(getSyncActivity()).toMatchObject({ uploading: 1, downloading: 0, label: 'Backup' });
    endC();
    expect(getSyncActivity()).toMatchObject({ uploading: 0, downloading: 0, label: null });
    expect(getSyncActivity().result).toBeNull();
    unsubscribe();
    expect(seen.length).toBeGreaterThan(0);
  });

  it('keeps stable snapshots with incrementing result ids and safe errors', () => {
    resetSyncActivityForTest(); // sibling suites share the module singleton
    const snapBefore = getSyncActivity();
    reportSyncResult({ source: 'Core', added: 3, updated: 1 });
    reportSyncResult({ source: 'Community', added: 0, updated: 2 });
    reportSyncError('manifest fetch failed: HTTP 503');
    const snap = getSyncActivity();
    expect(snapBefore.result).toBeNull();
    expect(snap.error).toBe('manifest fetch failed: HTTP 503');
    expect(snap.result).toEqual({ id: 2, source: 'Community', added: 0, updated: 2 });
    const notified: number[] = [];
    const unsubscribe = subscribeSyncActivity(() => notified.push(getSyncActivity().result?.id ?? -1));
    reportSyncResult({ source: 'Core', added: 1, updated: 0 });
    expect(getSyncActivity().result?.id).toBe(3);
    expect(notified).toEqual([3]);
    unsubscribe();
  });
});

describe('seed subscriptions', () => {
  it('never reports a session-only subscription as persisted on repeated writes', () => {
    const unavailable = spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    try {
      expect(setSeedSubscribed('community', true)).toBe(false);
      expect(isSeedSubscribed('community')).toBe(true);
      expect(setSeedSubscribed('community', true)).toBe(false);
    } finally {
      unavailable.mockRestore();
    }
  });

  it('core is always on; persisted off survives migration; imported checkpoints migrate', async () => {
    const storage = new InMemorySeedStorage();
    expect(isSeedSubscribed('core')).toBe(true);
    setSeedSubscribed('core', false); // no-op
    expect(isSeedSubscribed('core')).toBe(true);

    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('community')), seedVersion: 1 });
    expect(await migrateSeedSubscriptions([{ id: 'core' }, { id: 'community' }, { id: 'never-imported' }], storage))
      .toEqual(['community']);
    expect(isSeedSubscribed('community')).toBe(true);

    // Explicit opt-out stays off even though the checkpoint still exists.
    setSeedSubscribed('community', false);
    expect(await migrateSeedSubscriptions([{ id: 'community' }], storage)).toEqual([]);
    expect(isSeedSubscribed('community')).toBe(false);
  });

  it('a manual sync subscribes on imported or current; server-stale/error never subscribe', async () => {
    const storage = new InMemorySeedStorage();
    const src = () => fixture([row('markdown/collections/x/a.md', '# A')], 1);
    expect(await syncSeedSource('community', { sources: [spec(src(), 'community')], storage, isEnabled: () => true })).toBe('imported');
    expect(isSeedSubscribed('community')).toBe(true);
    setSeedSubscribed('community', false);
    // 'current' after an explicit manual choice re-subscribes — an existing
    // restored checkpoint the user just asked to sync is a subscription.
    expect(await syncSeedSource('community', { sources: [spec(src(), 'community')], storage, isEnabled: () => true })).toBe('current');
    expect(isSeedSubscribed('community')).toBe(true);

    // server-stale (published version older than the stored checkpoint).
    setSeedSubscribed('community', false);
    const stale = new InMemorySeedSource(
      { schema: SEED_SCHEMA, version: 0, builtAt: new Date(0).toISOString(), chunks: [] }, {},
    );
    expect(await syncSeedSource('community', { sources: [spec(stale, 'community')], storage, isEnabled: () => true })).toBe('server-stale');
    expect(isSeedSubscribed('community')).toBe(false);

    // error (unreachable source).
    const failing = new CountingSeedSource({
      fetchManifest: () => Promise.reject(new Error('offline')),
      fetchChunk: () => Promise.resolve([]),
    });
    expect(await syncSeedSource('community', { sources: [spec(failing, 'community')], storage, isEnabled: () => true })).toBe('error');
    expect(isSeedSubscribed('community')).toBe(false);
  });
});

describe('boot seed policy', () => {
  it('return visit checks every subscribed catalog; only auto-sync-on sources import', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreCounting = new CountingSeedSource(fixture([row('markdown/canvas/a.md', '# A')], 1, 'canvas'));
    const communityCounting = new CountingSeedSource(fixture([row('markdown/collections/x/b.md', '# B')], 1));
    const sources = [spec(coreCounting, 'core', 1), spec(communityCounting, 'community', 0, false)];

    // Not subscribed: community is not touched, but the embedded core fast
    // path is bypassed — the manifest is consulted on a return visit.
    expect(await runBootSeedSync({ sources, storage, isEnabled: () => true })).toBe('current');
    expect(coreCounting.fetchManifestCalls).toBe(1);
    expect(coreCounting.fetchChunkCalls).toEqual([]);
    expect(communityCounting.fetchManifestCalls).toBe(0);

    // Subscribed with auto-sync OFF (the default): check-only — the manifest
    // is consulted, no chunk fetches, no checkpoint, and the detected update
    // lands in the grouped snapshot as pending instead of importing.
    setSeedSubscribed('community', true);
    expect(await runBootSeedSync({ sources, storage, isEnabled: () => true })).toBe('update-pending');
    expect(communityCounting.fetchManifestCalls).toBe(1);
    expect(communityCounting.fetchChunkCalls).toEqual([]);
    expect(await storage.getSeedMeta(seedMetaKey('community'))).toBeUndefined();
    expect(getCatalogUpdates()?.updates).toEqual([{ sourceId: 'community', label: 'community', state: 'pending' }]);

    // Auto-sync ON: the same background check applies the update (a first
    // import is not an "update" — it does not join the grouped snapshot),
    // then refreshes by probe alone.
    setSeedAutoSync('community', true);
    expect(await runBootSeedSync({ sources, storage, isEnabled: () => true })).toBe('imported');
    expect((await storage.getSeedMeta(seedMetaKey('community')))?.seedVersion).toBe(1);
    expect(getCatalogUpdates()).toBeNull();
    expect(await runBootSeedSync({ sources, storage, isEnabled: () => true })).toBe('current');
    expect(communityCounting.fetchManifestCalls).toBe(4);
  });

  it('fresh visit imports core only, before any subscription exists', async () => {
    const storage = new InMemorySeedStorage();
    const coreCounting = new CountingSeedSource(fixture([row('markdown/canvas/a.md', '# A')], 1, 'canvas'));
    const communityCounting = new CountingSeedSource(fixture([row('markdown/collections/x/b.md', '# B')], 1));
    setSeedSubscribed('community', true); // even an explicit choice waits for the first core import
    const outcome = await runBootSeedSync({
      sources: [spec(coreCounting, 'core', 1), spec(communityCounting, 'community', 0, false)],
      storage,
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');
    // Two manifest reads: the boot decision probe, then the importer's own
    // fetch as it applies the chunk plan.
    expect(coreCounting.fetchManifestCalls).toBe(2);
    expect(communityCounting.fetchManifestCalls).toBe(0);
  });
});

describe('boot orchestrator (startSeedBootstrap)', () => {
  it('returning visitor ungates immediately; the background refresh never re-gates or flips the gate to error', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreCounting = new CountingSeedSource(fixture([row('markdown/canvas/a.md', '# A')], 1, 'canvas'));
    const failingFeed = new CountingSeedSource({
      fetchManifest: () => Promise.reject(new Error('offline')),
      fetchChunk: () => Promise.resolve([]),
    });
    setSeedSubscribed('community-crossfit-programming', true);
    const sources = [
      spec(coreCounting, 'core', 1),
      spec(failingFeed, 'community-crossfit-programming', 0, false),
    ];

    const done = startSeedBootstrap({ sources, storage, isEnabled: () => true });
    await done;
    // Ungated without ever passing through 'preparing', even though the
    // subscribed background feed failed. Background runs stay silent in
    // sync activity (no toast flood) — the grouped snapshot carries the
    // failure instead.
    expect(getSeedReadiness()).toBe('ready');
    expect(getSyncActivity().error).toBeNull();
    expect(getCatalogUpdates()?.updates).toEqual([
      { sourceId: 'community-crossfit-programming', label: 'community-crossfit-programming', state: 'error' },
    ]);
    // ...and the returning probe still consulted the core manifest.
    expect(coreCounting.fetchManifestCalls).toBe(1);
  });

  it('fresh visit gates until the canvas chunk commits, then ungates while the rest imports', async () => {
    const storage = new InMemorySeedStorage();
    const coreSrc = fixture(
      [row('markdown/canvas/a.md', '# A'), row('markdown/collections/x/b.md', '# B')], 1, 'canvas',
    );
    // Hold the canvas chunk fetch open so the gate state is observable
    // mid-import without any wall-clock waiting.
    const heldCanvas = Promise.withResolvers<SeedChunkPayload>();
    const heldSource: ISeedSource = {
      fetchManifest: () => coreSrc.fetchManifest(),
      fetchChunk: (path) => (path === 'chunks/canvas.json' ? heldCanvas.promise : coreSrc.fetchChunk(path)),
    };
    const done = startSeedBootstrap({ sources: [spec(heldSource, 'core', 1)], storage, isEnabled: () => true });
    // Drain the bootstrap's microtask chain (every storage/sync hop resolves
    // synchronously-created promises) until it parks on the held canvas
    // fetch — no wall-clock timers involved.
    for (let i = 0; i < 100 && getSeedReadiness() !== 'preparing'; i++) await null;
    expect(getSeedReadiness()).toBe('preparing');
    heldCanvas.resolve(await coreSrc.fetchChunk('chunks/canvas.json'));
    await done;
    expect(getSeedReadiness()).toBe('ready');
  });

  it('is single-flight: a StrictMode double start runs one sync', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const coreCounting = new CountingSeedSource(fixture([row('markdown/canvas/a.md', '# A')], 1, 'canvas'));
    const sources = [spec(coreCounting, 'core', 1)];
    const first = startSeedBootstrap({ sources, storage, isEnabled: () => true });
    const second = startSeedBootstrap({ sources, storage, isEnabled: () => true });
    expect(second).toBe(first);
    await first;
    expect(coreCounting.fetchManifestCalls).toBe(1);
  });
});

describe('committed record counting', () => {
  it('reports NEW vs UPDATED consumer records, skipping user-owned rows', async () => {
    const storage = new InMemorySeedStorage();
    const sources = (version: number, aContent: string, bContent: string): SeedSourceSpec[] => [
      spec(new InMemorySeedSource({
        schema: SEED_SCHEMA, version, builtAt: new Date(version).toISOString(),
        chunks: [{
          id: 'collection.test', path: 'chunks/collection.test.json',
          sha256: `${version}`.repeat(64), bytes: 1, count: 2,
        }],
      }, { 'chunks/collection.test.json': [row('markdown/collections/x/a.md', aContent), row('markdown/collections/x/b.md', bContent)] }), 'core'),
    ];

    // First import: two NEW committed notes.
    expect(await runSeedSync({ sources: sources(1, '# A1', '# B1'), storage, isEnabled: () => true })).toBe('imported');
    expect(getSyncActivity().result).toMatchObject({ source: 'core', added: 2, updated: 0 });

    // Second import: one changed note, one unchanged — counts visit no rows.
    expect(await runSeedSync({ sources: sources(2, '# A2', '# B1'), storage, isEnabled: () => true })).toBe('imported');
    expect(getSyncActivity().result).toMatchObject({ source: 'core', added: 0, updated: 1 });

    // User takes ownership of note A: its later seed changes are not committed.
    const noteId = await seedNoteId('markdown/collections/x/a.md');
    const owned = await storage.storageInstance.readonly('notes').get(noteId);
    await storage.storageInstance.readwrite('notes').put({ ...owned, seedOrigin: 'user' });
    expect(await runSeedSync({ sources: sources(3, '# A3', '# B3'), storage, isEnabled: () => true })).toBe('imported');
    expect(getSyncActivity().result).toMatchObject({ source: 'core', added: 0, updated: 1 });
    expect((await storage.storageInstance.readonly('notes').get(noteId))!.rawContent).toBe('# A2');
  });

  it('sync errors surface as user-safe activity errors without secrets', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 5 });
    const errorBefore = getSyncActivity().error;
    const stale = new InMemorySeedSource(
      { schema: SEED_SCHEMA, version: 4, builtAt: new Date(4).toISOString(), chunks: [] },
      {},
    );
    expect(await runSeedSync({ sources: [spec(stale, 'core')], storage, isEnabled: () => true })).toBe('server-stale');
    expect(getSyncActivity().error).toBe(errorBefore); // server-stale is not a failure — no error report

    const failing = new CountingSeedSource({
      fetchManifest: () => Promise.reject(new Error('seed manifest fetch failed: HTTP 503')),
      fetchChunk: () => Promise.resolve([]),
    });
    expect(await runSeedSync({ sources: [spec(failing, 'community')], storage, isEnabled: () => true })).toBe('error');
    expect(getSyncActivity().error).toContain('HTTP 503');
    expect(getSyncActivity()).toMatchObject({ uploading: 0, downloading: 0 });
  });
});
