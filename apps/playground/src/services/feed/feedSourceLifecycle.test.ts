/**
 * Seed source lifecycle — behavioral regressions at the public service
 * seam: the grouped feed-updates snapshot (one per background load
 * check, applied vs pending), manual-vs-auto sync boundaries, exact
 * checkpoint-ownership removal (never catalog/slug matching), Import Once
 * subscription pinning, and removal failure propagation.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { emptySeedMeta, seedMetaKey } from '@/types/seed';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { CountingFeedSource } from './InMemoryFeedSource';
import { feedFixture as fixture } from './feedFixture';
import {
  deleteFeedSource,
  getFeedUpdates,
  readFeedStatus,
  runBootFeedSync,
  syncFeedSource,
  unsubscribeFeedSource,
  defaultFeedSources,
  type FeedSourceSpec,
} from './feedSync';
import {
  getSubscribedNotebooks,
  isNotebookSubscribed,
  isFeedAutoSync,
  isFeedSubscribed,
  migrateFeedSubscriptions,
  resetFeedSubscriptionsForTest,
  setNotebookSubscribed,
  setFeedAutoSync,
  setFeedSubscribed,
} from './feedSubscriptions';
import { addCustomFeedSource, customFeedSources, hiddenFeedSourceIds } from './feedSources';
import { resetSyncActivityForTest } from '@/services/syncActivity';

function spec(source: FeedSourceSpec['source'], id: string, embeddedVersion = 0): FeedSourceSpec {
  return { source, id, label: id, url: `https://feed.test/${id}/`, embeddedVersion };
}
const row = (path: string, content: string) => compileSeedRow(path, content);

beforeEach(() => {
  localStorage.clear();
  resetFeedSubscriptionsForTest();
  resetSyncActivityForTest();
});

describe('catalog auto-sync preference', () => {
  it('defaults core on and every other source off; the persisted choice wins', () => {
    expect(isFeedAutoSync('core')).toBe(true);
    expect(isFeedAutoSync('community')).toBe(false);
    expect(setFeedAutoSync('beta', true)).toBe(true);
    expect(isFeedAutoSync('beta')).toBe(true);
    setFeedAutoSync('beta', false);
    expect(isFeedAutoSync('beta')).toBe(false);
  });
});

describe('single notebook subscriptions', () => {
  it('supports subscribing to a single notebook within a feed', () => {
    expect(isNotebookSubscribed('feed-1', 'notebook.heroes')).toBe(false);
    expect(getSubscribedNotebooks('feed-1')).toBeNull();

    setNotebookSubscribed('feed-1', 'notebook.heroes', true);
    expect(isNotebookSubscribed('feed-1', 'notebook.heroes')).toBe(true);
    expect(isNotebookSubscribed('feed-1', 'notebook.other')).toBe(false);
    expect(getSubscribedNotebooks('feed-1')).toEqual(['notebook.heroes']);

    setNotebookSubscribed('feed-1', 'notebook.heroes', false);
    expect(isNotebookSubscribed('feed-1', 'notebook.heroes')).toBe(false);
    expect(getSubscribedNotebooks('feed-1')).toBeNull();
  });
});

describe('legacy per-notebook subscription migration', () => {
  it('renames collection./feed. chunk-id keys to notebook., preserving the value', async () => {
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({
      'seed-crossfit#collection.crossfit-girls': true,
      'seed-crossfit#feed.crossfit-programming': false,
    }));
    resetFeedSubscriptionsForTest();
    await migrateFeedSubscriptions([{ id: 'core' }], new InMemoryFeedStorage());
    expect(isNotebookSubscribed('seed-crossfit', 'notebook.crossfit-girls')).toBe(true);
    expect(isNotebookSubscribed('seed-crossfit', 'notebook.crossfit-programming')).toBe(false);
    const persisted = JSON.parse(localStorage.getItem('wodwiki.seedSubscriptions')!);
    expect(persisted['seed-crossfit#collection.crossfit-girls']).toBeUndefined();
    expect(persisted['seed-crossfit#feed.crossfit-programming']).toBeUndefined();
    expect(persisted['seed-crossfit#notebook.crossfit-girls']).toBe(true);
    expect(persisted['seed-crossfit#notebook.crossfit-programming']).toBe(false);
  });

  it('current-key verdict wins over the legacy key, and the rewrite is idempotent', async () => {
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({
      'seed-crossfit#collection.crossfit-girls': true,
      'seed-crossfit#notebook.crossfit-girls': false,
    }));
    resetFeedSubscriptionsForTest();
    await migrateFeedSubscriptions([{ id: 'core' }], new InMemoryFeedStorage());
    expect(isNotebookSubscribed('seed-crossfit', 'notebook.crossfit-girls')).toBe(false);
    resetFeedSubscriptionsForTest();
    // Second run: nothing left to rename, no drift.
    await migrateFeedSubscriptions([{ id: 'core' }], new InMemoryFeedStorage());
    expect(isNotebookSubscribed('seed-crossfit', 'notebook.crossfit-girls')).toBe(false);
    const persisted = JSON.parse(localStorage.getItem('wodwiki.seedSubscriptions')!);
    expect(persisted).toEqual({ 'seed-crossfit#notebook.crossfit-girls': false });
    expect(Object.keys(persisted)).toEqual(['seed-crossfit#notebook.crossfit-girls']);
  });

  it('a migrated per-notebook subscription selects the feed for sync', async () => {
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({
      'seed-crossfit#collection.crossfit-girls': true,
    }));
    resetFeedSubscriptionsForTest();
    const storage = new InMemoryFeedStorage();
    await migrateFeedSubscriptions([{ id: 'core' }, { id: 'seed-crossfit' }], storage);
    expect(getSubscribedNotebooks('seed-crossfit')).toEqual(['notebook.crossfit-girls']);
    // The background sync selector admits the feed on its notebook verdict.
    const sources: FeedSourceSpec[] = [
      spec(fixture([row('markdown/notebooks/crossfit-girls/fran.md', '# Fran\n\n```time\n21-15-9 Thrusters\n```')], 1, 'notebook.crossfit-girls'), 'seed-crossfit'),
    ];
    expect(await runBootFeedSync({ sources, storage, isEnabled: () => true })).toBe('imported');
    expect((await storage.getSeedMeta(seedMetaKey('seed-crossfit')))?.seedVersion).toBe(1);
  });
});

describe('grouped catalog updates', () => {
  it('publishes ONE snapshot per background check — applied vs pending — and a manual sync clears its entry', async () => {
    const storage = new InMemoryFeedStorage();
    // Returning browser: the core checkpoint exists, so subscribed
    // catalogs get the background load check.
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const v1: FeedSourceSpec[] = [
      spec(fixture([row('markdown/notebooks/alpha/a.md', '# A1')], 1, 'notebook.alpha'), 'alpha'),
      spec(fixture([row('markdown/notebooks/beta/b.md', '# B1')], 1, 'notebook.beta'), 'beta'),
    ];
    // Manual installs subscribe both checkpoints.
    await syncFeedSource('alpha', { sources: v1, storage, isEnabled: () => true });
    await syncFeedSource('beta', { sources: v1, storage, isEnabled: () => true });
    setFeedAutoSync('alpha', true); // beta stays manual — the default

    const v2: FeedSourceSpec[] = [
      spec(fixture([row('markdown/notebooks/alpha/a.md', '# A2')], 2, 'notebook.alpha'), 'alpha'),
      spec(fixture([row('markdown/notebooks/beta/b.md', '# B2')], 2, 'notebook.beta'), 'beta'),
    ];
    await runBootFeedSync({ sources: v2, storage, isEnabled: () => true });
    expect(getFeedUpdates()?.updates).toEqual([
      { sourceId: 'alpha', label: 'alpha', state: 'updated' },
      { sourceId: 'beta', label: 'beta', state: 'pending' },
    ]);

    // Manual sync applies the pending catalog and drops it from the group;
    // the applied alpha entry stays until nothing is outstanding.
    expect(await syncFeedSource('beta', { sources: v2, storage, isEnabled: () => true })).toBe('imported');
    expect(getFeedUpdates()?.updates.map((u) => u.sourceId)).toEqual(['alpha']);
    await unsubscribeFeedSource('alpha', { storage });
    expect(getFeedUpdates()).toBeNull();
  });

  it('manual sync imports a subscribed catalog even with auto-sync off', async () => {
    const storage = new InMemoryFeedStorage();
    const sources = [spec(fixture([row('markdown/notebooks/alpha/a.md', '# A')], 1, 'notebook.alpha'), 'alpha')];
    await syncFeedSource('alpha', { sources, storage, isEnabled: () => true });
    setFeedSubscribed('alpha', true);
    setFeedAutoSync('alpha', false);
    const newer = [spec(fixture([row('markdown/notebooks/alpha/a.md', '# A2')], 2, 'notebook.alpha'), 'alpha')];
    expect(await syncFeedSource('alpha', { sources: newer, storage, isEnabled: () => true })).toBe('imported');
    expect((await storage.getSeedMeta(seedMetaKey('alpha')))?.seedVersion).toBe(2);
  });
});

describe('exact-ownership removal', () => {
  it('unsubscribes exactly its checkpoint content; user notes and sibling sources survive', async () => {
    const storage = new InMemoryFeedStorage();
    // The sibling chunk slug CONTAINS alpha's slug — the legacy
    // catalog/substring matching deleted its rows too.
    const sources: FeedSourceSpec[] = [
      spec(fixture([
        row('markdown/notebooks/alpha/fran.md', '# Fran'),
        row('markdown/notebooks/alpha/helen.md', '# Helen'),
      ], 1, 'notebook.alpha'), 'alpha'),
      spec(fixture([row('markdown/notebooks/alpha-extra/cluster.md', '# Cluster')], 1, 'notebook.alpha-extra'), 'alpha-extra'),
    ];
    await syncFeedSource('alpha', { sources, storage, isEnabled: () => true });
    await syncFeedSource('alpha-extra', { sources, storage, isEnabled: () => true });
    // A user takes ownership of one alpha row and authors a note of their own.
    const notes = await storage.storageInstance.readonly('notes').getAll();
    const fran = notes.find((n) => n.seedChunkId === 'notebook.alpha' && n.seedOrigin === 'seed');
    await storage.storageInstance.readwrite('notes').put({ ...fran, seedOrigin: 'user' });
    await storage.storageInstance.readwrite('notes').put({
      id: 'user-note-1', title: 'My log', rawContent: '# My log', sourceRevision: 1, blocks: {}, createdAt: 1, seedOrigin: 'user',
    });

    const { deleted } = await unsubscribeFeedSource('alpha', { storage });
    expect(deleted).toBe(1); // helen only — exact checkpoint membership
    const after = await storage.storageInstance.readonly('notes').getAll();
    expect(after.some((n) => n.id === 'user-note-1')).toBe(true);
    expect(after.find((n) => n.seedChunkId === 'notebook.alpha')).toMatchObject({ seedOrigin: 'user' });
    expect(after.some((n) => n.seedChunkId === 'notebook.alpha-extra')).toBe(true);
    expect(await storage.getSeedMeta(seedMetaKey('alpha'))).toBeUndefined();
    expect(isFeedSubscribed('alpha')).toBe(false);
    expect(isFeedAutoSync('alpha')).toBe(false);
  });

  it('an unsubscribed source is not checked, imported, or snapshotted at boot', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const counting = new CountingFeedSource(fixture([row('markdown/notebooks/alpha/a.md', '# A')], 2, 'notebook.alpha'));
    const sources = [spec(counting, 'alpha')];
    await syncFeedSource('alpha', { sources, storage, isEnabled: () => true });
    await unsubscribeFeedSource('alpha', { storage });
    counting.fetchManifestCalls = 0;
    expect(await runBootFeedSync({ sources, storage, isEnabled: () => true })).toBe('current');
    expect(counting.fetchManifestCalls).toBe(0);
    expect(getFeedUpdates()).toBeNull();
  });

  it('a failing removal propagates and never leaves a half-unsubscribed source', async () => {
    class FailingRemovalStorage extends InMemoryFeedStorage {
      async removeSourceContent(): Promise<number> {
        throw new Error('provider unavailable');
      }
    }
    const storage = new FailingRemovalStorage();
    const sources = [spec(fixture([row('markdown/notebooks/alpha/a.md', '# A')], 1, 'notebook.alpha'), 'alpha')];
    await syncFeedSource('alpha', { sources, storage, isEnabled: () => true });
    await expect(unsubscribeFeedSource('alpha', { storage })).rejects.toThrow('provider unavailable');
    // Checkpoint and subscription untouched — no reimport/data-loss window.
    expect(await storage.getSeedMeta(seedMetaKey('alpha'))).toBeTruthy();
    expect(isFeedSubscribed('alpha')).toBe(true);
  });
  it('resolves collisions by precedence (core < community < imported < user) and falls back cleanly on unsubscribe', async () => {
    const storage = new InMemoryFeedStorage();
    const eqDoc = (label: string) =>
      `---\ntype: equipment\nid: equipment-dumbbell\nslug: dumbbell\nlabel: ${label}\naliases: []\nregistrySource: bundled\n---\n# ${label}\n`;
    const sources: FeedSourceSpec[] = [
      spec(fixture([row('markdown/equipment/dumbbell.md', eqDoc('Core Dumbbell'))], 1, 'equipment'), 'core'),
      spec(fixture([row('markdown/equipment/dumbbell.md', eqDoc('Community Dumbbell'))], 1, 'equipment'), 'community'),
      spec(fixture([row('markdown/equipment/custom/dumbbell.md', eqDoc('Imported Dumbbell'))], 1, 'equipment'), 'custom-pack'),
    ];

    await syncFeedSource('core', { sources, storage, isEnabled: () => true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Core Dumbbell');

    await syncFeedSource('community', { sources, storage, isEnabled: () => true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Community Dumbbell');

    await syncFeedSource('custom-pack', { sources, storage, isEnabled: () => true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Imported Dumbbell');

    // Re-syncing lower tiers (core, community) does not overwrite imported tier.
    await syncFeedSource('core', { sources, storage, isEnabled: () => true, force: true });
    await syncFeedSource('community', { sources, storage, isEnabled: () => true, force: true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Imported Dumbbell');

    // Unsubscribing imported tier restores the community tier projection.
    await unsubscribeFeedSource('custom-pack', { storage });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Community Dumbbell');

    // Unsubscribing community tier preserves the shared note claimed by core.
    await unsubscribeFeedSource('community', { storage });
    expect(await storage.storageInstance.readonly('equipment').get('dumbbell')).toBeTruthy();
  });
});

describe('delete source', () => {
  it('removes the custom registry entry or hides the built-in row; core is protected', async () => {
    const added = addCustomFeedSource('My Catalog', 'https://catalog.example/seed/');
    const storage = new InMemoryFeedStorage();
    const sources = [spec(fixture([row('markdown/notebooks/x/a.md', '# A')], 1), added.id)];
    await syncFeedSource(added.id, { sources, storage, isEnabled: () => true });
    expect(await deleteFeedSource(added.id, { storage })).toEqual({ deleted: 1 });
    expect(customFeedSources()).toEqual([]);
    expect(await storage.getSeedMeta(seedMetaKey(added.id))).toBeUndefined();

    // A built-in SEED row is hidden (its config lives in code, not storage).
    await deleteFeedSource('seed-crossfit', { storage });
    expect(hiddenFeedSourceIds()).toEqual(['seed-crossfit']);
    expect(defaultFeedSources().some((s) => s.id === 'seed-crossfit')).toBe(false);
    // Pre-seed-unit notebook ids fold onto the seed that publishes them.
    await deleteFeedSource('community-crossfit-girls', { storage });
    expect(hiddenFeedSourceIds()).toEqual(['seed-crossfit']);
    // ...but an id no built-in seed owns is ignored.
    await deleteFeedSource('nobody-home', { storage });
    expect(hiddenFeedSourceIds()).toEqual(['seed-crossfit']);

    expect(await deleteFeedSource('core', { storage })).toEqual({ deleted: 0 });
    expect(defaultFeedSources().some((s) => s.id === 'core')).toBe(true);
  });
});

describe('import once boundary', () => {
  it('imports without subscribing, pins the explicit choice, and never downgrades a live subscription', async () => {
    const storage = new InMemoryFeedStorage();
    const sources = [
      spec(fixture([row('markdown/notebooks/x/a.md', '# A')], 1), 'once'),
      spec(fixture([row('markdown/notebooks/y/b.md', '# B')], 1), 'sub'),
    ];
    expect(await syncFeedSource('once', { sources, storage, isEnabled: () => true, subscribe: false })).toBe('imported');
    expect(isFeedSubscribed('once')).toBe(false);
    expect(await storage.getSeedMeta(seedMetaKey('once'))).toBeTruthy();
    // A reload runs the checkpoint migration — the explicit choice wins.
    expect(await migrateFeedSubscriptions([{ id: 'once' }], storage)).toEqual([]);
    expect(isFeedSubscribed('once')).toBe(false);

    setFeedSubscribed('sub', true);
    await syncFeedSource('sub', { sources, storage, isEnabled: () => true, subscribe: false });
    expect(isFeedSubscribed('sub')).toBe(true);
  });
});

describe('feed status', () => {
  it('respects deps.storage and reports counts, bytes, url, checks, and choices', async () => {
    const storage = new InMemoryFeedStorage();
    const rows = [row('markdown/notebooks/alpha/a.md', '# A')];
    const sources = [spec(fixture(rows, 3, 'notebook.alpha'), 'alpha')];
    await syncFeedSource('alpha', { sources, storage, isEnabled: () => true });
    const status = await readFeedStatus({ sources, storage, now: () => 1234 });
    expect(status.sources[0]).toMatchObject({
      id: 'alpha',
      url: 'https://feed.test/alpha/',
      count: 1,
      bytes: new TextEncoder().encode(JSON.stringify(rows)).length,
      checkedAt: 1234,
      subscribed: true,
      autoSync: false,
      upToDate: true,
      remoteError: null,
    });
    expect(status.sources[0].repositoryUrl).toBeUndefined();
  });
});
