/**
 * Seed source lifecycle — behavioral regressions at the public service
 * seam: the grouped catalog-updates snapshot (one per background load
 * check, applied vs pending), manual-vs-auto sync boundaries, exact
 * checkpoint-ownership removal (never catalog/slug matching), Import Once
 * subscription pinning, and removal failure propagation.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { emptySeedMeta, seedMetaKey } from '@/types/seed';
import { InMemorySeedStorage } from './SeedImportStorage';
import { CountingSeedSource } from './InMemorySeedSource';
import { seedFixture as fixture } from './seedFixture';
import {
  deleteSeedSource,
  getCatalogUpdates,
  readSeedStatus,
  runBootSeedSync,
  syncSeedSource,
  unsubscribeSeedSource,
  defaultSeedSources,
  type SeedSourceSpec,
} from './seedSync';
import {
  getSubscribedNotebooks,
  isNotebookSubscribed,
  isSeedAutoSync,
  isSeedSubscribed,
  migrateSeedSubscriptions,
  resetSeedSubscriptionsForTest,
  setNotebookSubscribed,
  setSeedAutoSync,
  setSeedSubscribed,
} from './seedSubscriptions';
import { addCustomSeedSource, customSeedSources, hiddenSeedSourceIds } from './seedSources';
import { resetSyncActivityForTest } from '@/services/syncActivity';
import { feedIdOfSourceId } from '@bitcobblers/wod-wiki-core';

function spec(source: SeedSourceSpec['source'], id: string, embeddedVersion = 0): SeedSourceSpec {
  return { source, id, feedId: feedIdOfSourceId(id), label: id, feedName: id, url: `https://seed.test/${id}/`, embeddedVersion };
}
const row = (path: string, content: string) => compileSeedRow(path, content);

beforeEach(() => {
  localStorage.clear();
  resetSeedSubscriptionsForTest();
  resetSyncActivityForTest();
});

describe('catalog auto-sync preference', () => {
  it('defaults core on and every other source off; the persisted choice wins', () => {
    expect(isSeedAutoSync('core')).toBe(true);
    expect(isSeedAutoSync('community')).toBe(false);
    expect(setSeedAutoSync('beta', true)).toBe(true);
    expect(isSeedAutoSync('beta')).toBe(true);
    setSeedAutoSync('beta', false);
    expect(isSeedAutoSync('beta')).toBe(false);
  });
});

describe('single notebook subscriptions', () => {
  it('supports subscribing to a single notebook within a feed', () => {
    expect(isNotebookSubscribed('feed-1', 'collection.heroes')).toBe(false);
    expect(getSubscribedNotebooks('feed-1')).toBeNull();

    setNotebookSubscribed('feed-1', 'collection.heroes', true);
    expect(isNotebookSubscribed('feed-1', 'collection.heroes')).toBe(true);
    expect(isNotebookSubscribed('feed-1', 'collection.other')).toBe(false);
    expect(getSubscribedNotebooks('feed-1')).toEqual(['collection.heroes']);

    setNotebookSubscribed('feed-1', 'collection.heroes', false);
    expect(isNotebookSubscribed('feed-1', 'collection.heroes')).toBe(false);
    expect(getSubscribedNotebooks('feed-1')).toBeNull();
  });
});

describe('grouped catalog updates', () => {
  it('publishes ONE snapshot per background check — applied vs pending — and a manual sync clears its entry', async () => {
    const storage = new InMemorySeedStorage();
    // Returning browser: the core checkpoint exists, so subscribed
    // catalogs get the background load check.
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const v1: SeedSourceSpec[] = [
      spec(fixture([row('markdown/collections/alpha/a.md', '# A1')], 1, 'collection.alpha'), 'alpha'),
      spec(fixture([row('markdown/collections/beta/b.md', '# B1')], 1, 'collection.beta'), 'beta'),
    ];
    // Manual installs subscribe both checkpoints.
    await syncSeedSource('alpha', { sources: v1, storage, isEnabled: () => true });
    await syncSeedSource('beta', { sources: v1, storage, isEnabled: () => true });
    setSeedAutoSync('alpha', true); // beta stays manual — the default

    const v2: SeedSourceSpec[] = [
      spec(fixture([row('markdown/collections/alpha/a.md', '# A2')], 2, 'collection.alpha'), 'alpha'),
      spec(fixture([row('markdown/collections/beta/b.md', '# B2')], 2, 'collection.beta'), 'beta'),
    ];
    await runBootSeedSync({ sources: v2, storage, isEnabled: () => true });
    expect(getCatalogUpdates()?.updates).toEqual([
      { sourceId: 'alpha', label: 'alpha', state: 'updated' },
      { sourceId: 'beta', label: 'beta', state: 'pending' },
    ]);

    // Manual sync applies the pending catalog and drops it from the group;
    // the applied alpha entry stays until nothing is outstanding.
    expect(await syncSeedSource('beta', { sources: v2, storage, isEnabled: () => true })).toBe('imported');
    expect(getCatalogUpdates()?.updates.map((u) => u.sourceId)).toEqual(['alpha']);
    await unsubscribeSeedSource('alpha', { storage });
    expect(getCatalogUpdates()).toBeNull();
  });

  it('manual sync imports a subscribed catalog even with auto-sync off', async () => {
    const storage = new InMemorySeedStorage();
    const sources = [spec(fixture([row('markdown/collections/alpha/a.md', '# A')], 1, 'collection.alpha'), 'alpha')];
    await syncSeedSource('alpha', { sources, storage, isEnabled: () => true });
    setSeedSubscribed('alpha', true);
    setSeedAutoSync('alpha', false);
    const newer = [spec(fixture([row('markdown/collections/alpha/a.md', '# A2')], 2, 'collection.alpha'), 'alpha')];
    expect(await syncSeedSource('alpha', { sources: newer, storage, isEnabled: () => true })).toBe('imported');
    expect((await storage.getSeedMeta(seedMetaKey('alpha')))?.seedVersion).toBe(2);
  });
});

describe('exact-ownership removal', () => {
  it('unsubscribes exactly its checkpoint content; user notes and sibling sources survive', async () => {
    const storage = new InMemorySeedStorage();
    // The sibling chunk slug CONTAINS alpha's slug — the legacy
    // catalog/substring matching deleted its rows too.
    const sources: SeedSourceSpec[] = [
      spec(fixture([
        row('markdown/collections/alpha/fran.md', '# Fran'),
        row('markdown/collections/alpha/helen.md', '# Helen'),
      ], 1, 'collection.alpha'), 'alpha'),
      spec(fixture([row('markdown/collections/alpha-extra/cluster.md', '# Cluster')], 1, 'collection.alpha-extra'), 'alpha-extra'),
    ];
    await syncSeedSource('alpha', { sources, storage, isEnabled: () => true });
    await syncSeedSource('alpha-extra', { sources, storage, isEnabled: () => true });
    // A user takes ownership of one alpha row and authors a note of their own.
    const notes = await storage.storageInstance.readonly('notes').getAll();
    const fran = notes.find((n) => n.seedChunkId === 'collection.alpha' && n.seedOrigin === 'seed');
    await storage.storageInstance.readwrite('notes').put({ ...fran, seedOrigin: 'user' });
    await storage.storageInstance.readwrite('notes').put({
      id: 'user-note-1', title: 'My log', rawContent: '# My log', sourceRevision: 1, blocks: {}, createdAt: 1, seedOrigin: 'user',
    });

    const { deleted } = await unsubscribeSeedSource('alpha', { storage });
    expect(deleted).toBe(1); // helen only — exact checkpoint membership
    const after = await storage.storageInstance.readonly('notes').getAll();
    expect(after.some((n) => n.id === 'user-note-1')).toBe(true);
    expect(after.find((n) => n.seedChunkId === 'collection.alpha')).toMatchObject({ seedOrigin: 'user' });
    expect(after.some((n) => n.seedChunkId === 'collection.alpha-extra')).toBe(true);
    expect(await storage.getSeedMeta(seedMetaKey('alpha'))).toBeUndefined();
    expect(isSeedSubscribed('alpha')).toBe(false);
    expect(isSeedAutoSync('alpha')).toBe(false);
  });

  it('an unsubscribed source is not checked, imported, or snapshotted at boot', async () => {
    const storage = new InMemorySeedStorage();
    await storage.putSeedMeta({ ...emptySeedMeta(seedMetaKey('core')), seedVersion: 1, builtAt: new Date(1).toISOString() });
    const counting = new CountingSeedSource(fixture([row('markdown/collections/alpha/a.md', '# A')], 2, 'collection.alpha'));
    const sources = [spec(counting, 'alpha')];
    await syncSeedSource('alpha', { sources, storage, isEnabled: () => true });
    await unsubscribeSeedSource('alpha', { storage });
    counting.fetchManifestCalls = 0;
    expect(await runBootSeedSync({ sources, storage, isEnabled: () => true })).toBe('current');
    expect(counting.fetchManifestCalls).toBe(0);
    expect(getCatalogUpdates()).toBeNull();
  });

  it('a failing removal propagates and never leaves a half-unsubscribed source', async () => {
    class FailingRemovalStorage extends InMemorySeedStorage {
      async removeSourceContent(): Promise<number> {
        throw new Error('provider unavailable');
      }
    }
    const storage = new FailingRemovalStorage();
    const sources = [spec(fixture([row('markdown/collections/alpha/a.md', '# A')], 1, 'collection.alpha'), 'alpha')];
    await syncSeedSource('alpha', { sources, storage, isEnabled: () => true });
    await expect(unsubscribeSeedSource('alpha', { storage })).rejects.toThrow('provider unavailable');
    // Checkpoint and subscription untouched — no reimport/data-loss window.
    expect(await storage.getSeedMeta(seedMetaKey('alpha'))).toBeTruthy();
    expect(isSeedSubscribed('alpha')).toBe(true);
  });
  it('resolves collisions by precedence (core < community < imported < user) and falls back cleanly on unsubscribe', async () => {
    const storage = new InMemorySeedStorage();
    const eqDoc = (label: string) =>
      `---\ntype: equipment\nid: equipment-dumbbell\nslug: dumbbell\nlabel: ${label}\naliases: []\nregistrySource: bundled\n---\n# ${label}\n`;
    const sources: SeedSourceSpec[] = [
      spec(fixture([row('markdown/equipment/dumbbell.md', eqDoc('Core Dumbbell'))], 1, 'equipment'), 'core'),
      spec(fixture([row('markdown/equipment/dumbbell.md', eqDoc('Community Dumbbell'))], 1, 'equipment'), 'community'),
      spec(fixture([row('markdown/equipment/custom/dumbbell.md', eqDoc('Imported Dumbbell'))], 1, 'equipment'), 'custom-pack'),
    ];

    await syncSeedSource('core', { sources, storage, isEnabled: () => true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Core Dumbbell');

    await syncSeedSource('community', { sources, storage, isEnabled: () => true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Community Dumbbell');

    await syncSeedSource('custom-pack', { sources, storage, isEnabled: () => true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Imported Dumbbell');

    // Re-syncing lower tiers (core, community) does not overwrite imported tier.
    await syncSeedSource('core', { sources, storage, isEnabled: () => true, force: true });
    await syncSeedSource('community', { sources, storage, isEnabled: () => true, force: true });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Imported Dumbbell');

    // Unsubscribing imported tier restores the community tier projection.
    await unsubscribeSeedSource('custom-pack', { storage });
    expect((await storage.storageInstance.readonly('equipment').get('dumbbell'))?.label).toBe('Community Dumbbell');

    // Unsubscribing community tier preserves the shared note claimed by core.
    await unsubscribeSeedSource('community', { storage });
    expect(await storage.storageInstance.readonly('equipment').get('dumbbell')).toBeTruthy();
  });
});

describe('delete source', () => {
  it('removes the custom registry entry or hides the built-in row; core is protected', async () => {
    const added = addCustomSeedSource('My Catalog', 'https://catalog.example/seed/');
    const storage = new InMemorySeedStorage();
    const sources = [spec(fixture([row('markdown/collections/x/a.md', '# A')], 1), added.id)];
    await syncSeedSource(added.id, { sources, storage, isEnabled: () => true });
    expect(await deleteSeedSource(added.id, { storage })).toEqual({ deleted: 1 });
    expect(customSeedSources()).toEqual([]);
    expect(await storage.getSeedMeta(seedMetaKey(added.id))).toBeUndefined();

    // A built-in SEED row is hidden (its config lives in code, not storage).
    await deleteSeedSource('seed-crossfit', { storage });
    expect(hiddenSeedSourceIds()).toEqual(['seed-crossfit']);
    expect(defaultSeedSources().some((s) => s.id === 'seed-crossfit')).toBe(false);
    // Pre-seed-unit notebook ids fold onto the seed that publishes them.
    await deleteSeedSource('community-crossfit-girls', { storage });
    expect(hiddenSeedSourceIds()).toEqual(['seed-crossfit']);
    // ...but an id no built-in seed owns is ignored.
    await deleteSeedSource('nobody-home', { storage });
    expect(hiddenSeedSourceIds()).toEqual(['seed-crossfit']);

    expect(await deleteSeedSource('core', { storage })).toEqual({ deleted: 0 });
    expect(defaultSeedSources().some((s) => s.id === 'core')).toBe(true);
  });
});

describe('import once boundary', () => {
  it('imports without subscribing, pins the explicit choice, and never downgrades a live subscription', async () => {
    const storage = new InMemorySeedStorage();
    const sources = [
      spec(fixture([row('markdown/collections/x/a.md', '# A')], 1), 'once'),
      spec(fixture([row('markdown/collections/y/b.md', '# B')], 1), 'sub'),
    ];
    expect(await syncSeedSource('once', { sources, storage, isEnabled: () => true, subscribe: false })).toBe('imported');
    expect(isSeedSubscribed('once')).toBe(false);
    expect(await storage.getSeedMeta(seedMetaKey('once'))).toBeTruthy();
    // A reload runs the checkpoint migration — the explicit choice wins.
    expect(await migrateSeedSubscriptions([{ id: 'once' }], storage)).toEqual([]);
    expect(isSeedSubscribed('once')).toBe(false);

    setSeedSubscribed('sub', true);
    await syncSeedSource('sub', { sources, storage, isEnabled: () => true, subscribe: false });
    expect(isSeedSubscribed('sub')).toBe(true);
  });
});

describe('seed status', () => {
  it('respects deps.storage and reports counts, bytes, url, checks, and choices', async () => {
    const storage = new InMemorySeedStorage();
    const rows = [row('markdown/collections/alpha/a.md', '# A')];
    const sources = [spec(fixture(rows, 3, 'collection.alpha'), 'alpha')];
    await syncSeedSource('alpha', { sources, storage, isEnabled: () => true });
    const status = await readSeedStatus({ sources, storage, now: () => 1234 });
    expect(status.sources[0]).toMatchObject({
      id: 'alpha',
      url: 'https://seed.test/alpha/',
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
