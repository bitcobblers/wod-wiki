import { describe, expect, it, beforeEach } from 'bun:test';
import {
  flushFeedStatePersistence,
  getFeedOfflinePolicy,
  getFeedSubscriptionMode,
  getSubscribedNotebooks,
  hydrateFeedStateFromStorage,
  isFeedSubscribed,
  isNotebookSubscribed,
  migrateFeedSubscriptions,
  resetFeedSubscriptionsForTest,
  setFeedAutoSync,
  setFeedOfflinePolicy,
  setFeedSubscribed,
  setNotebookSubscribed,
  subscribeFeedSubscriptions,
} from './feedSubscriptions';
import { PENDING_SUBSCRIPTIONS_KEY } from './feedRegistryStore';
import { subscribeFeed, syncNotebook, toggleNotebookSubscription } from './feedSync';
import type { IStorage } from '@/services/storage/IStorage';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { InMemoryFeedSource } from './InMemoryFeedSource';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { emptySeedMeta, seedMetaKey, SEED_SCHEMA } from '@/types/seed';

describe('feedSubscriptions (Slice 2)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFeedSubscriptionsForTest();
  });

  it('reports correct FeedSubscriptionMode and getSubscribedNotebooks', () => {
    // core is always full
    expect(getFeedSubscriptionMode('core')).toBe('full');
    expect(getSubscribedNotebooks('core')).toBeNull();

    // unconfigured/unsubscribed feed
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('unsubscribed');
    expect(getSubscribedNotebooks('wod-crossfit')).toEqual([]);

    // full feed subscription
    setFeedSubscribed('wod-crossfit', true);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('full');
    expect(getSubscribedNotebooks('wod-crossfit')).toBeNull();

    // unsubscribed feed
    setFeedSubscribed('wod-crossfit', false);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('unsubscribed');
    expect(getSubscribedNotebooks('wod-crossfit')).toEqual([]);
  });

  it('supports partial subscription when subscribing individual notebook', () => {
    setNotebookSubscribed('wod-crossfit', 'notebook.girls', true);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('partial');
    expect(getSubscribedNotebooks('wod-crossfit')).toEqual(['notebook.girls']);
    expect(isNotebookSubscribed('wod-crossfit', 'notebook.girls')).toBe(true);
    expect(isNotebookSubscribed('wod-crossfit', 'notebook.heroes')).toBe(false);
  });

  it('unsubscribing a notebook from a full feed unpacks siblings into partial state', () => {
    setFeedSubscribed('wod-crossfit', true);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('full');

    const known = ['notebook.girls', 'notebook.heroes', 'notebook.open'];
    setNotebookSubscribed('wod-crossfit', 'notebook.heroes', false, known);

    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('partial');
    expect(isNotebookSubscribed('wod-crossfit', 'notebook.heroes')).toBe(false);
    expect(isNotebookSubscribed('wod-crossfit', 'notebook.girls')).toBe(true);
    expect(isNotebookSubscribed('wod-crossfit', 'notebook.open')).toBe(true);
    expect(getSubscribedNotebooks('wod-crossfit')?.sort()).toEqual(['notebook.girls', 'notebook.open']);
  });

  it('folds partial subscriptions back into full feed when all known chunks are subscribed', () => {
    const known = ['notebook.girls', 'notebook.heroes'];
    setNotebookSubscribed('wod-crossfit', 'notebook.girls', true, known);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('partial');

    setNotebookSubscribed('wod-crossfit', 'notebook.heroes', true, known);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('full');
    expect(getSubscribedNotebooks('wod-crossfit')).toBeNull();
  });

  it('setFeedSubscribed clears partial keys', () => {
    setNotebookSubscribed('wod-crossfit', 'notebook.girls', true);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('partial');

    setFeedSubscribed('wod-crossfit', true);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('full');

    // Unsubscribing feed clears all
    setFeedSubscribed('wod-crossfit', false);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('unsubscribed');
    expect(getSubscribedNotebooks('wod-crossfit')).toEqual([]);
  });

  it('syncNotebook syncs only target chunk and preserves partial subscription mode', async () => {
    const storage = new InMemoryFeedStorage();
    const rowGirls = compileSeedRow('markdown/notebooks/crossfit-girls/fran.md', '# Fran\n\n```time\n21-15-9 Thrusters\n```\n');
    const rowHeroes = compileSeedRow('markdown/notebooks/crossfit-heroes/murph.md', '# Murph\n\n```time\n1 Mile Run\n```\n');
    const manifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: new Date(1).toISOString(),
      chunks: [
        { id: 'notebook.crossfit-girls', path: 'chunks/girls.json', sha256: 'a'.repeat(64), bytes: 10, count: 1 },
        { id: 'notebook.crossfit-heroes', path: 'chunks/heroes.json', sha256: 'b'.repeat(64), bytes: 10, count: 1 },
      ],
    };
    const source = new InMemoryFeedSource(manifest, {
      'chunks/girls.json': [rowGirls],
      'chunks/heroes.json': [rowHeroes],
    });
    const sources = [{ id: 'wod-crossfit', label: 'CrossFit', source, url: 'https://test/seed/', embeddedVersion: 0 }];

    // Set partial subscription on girls only
    setNotebookSubscribed('wod-crossfit', 'notebook.crossfit-girls', true);
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('partial');

    const outcome = await syncNotebook('wod-crossfit', 'notebook.crossfit-girls', { sources, storage, isEnabled: () => true });
    expect(outcome).toBe('imported');

    // Feed remains partial, not promoted to full!
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('partial');
    const meta = await storage.getSeedMeta(seedMetaKey('wod-crossfit'));
    expect(meta?.chunks['notebook.crossfit-girls']).toBeDefined();
    expect(meta?.chunks['notebook.crossfit-heroes']).toBeUndefined();
  });

  it('toggleNotebookSubscription removes chunk notes and drops checkpoint when empty', async () => {
    const storage = new InMemoryFeedStorage();
    const rowGirls = compileSeedRow('markdown/notebooks/crossfit-girls/fran.md', '# Fran\n\n```time\n21-15-9 Thrusters\n```\n');
    const manifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: new Date(1).toISOString(),
      chunks: [
        { id: 'notebook.crossfit-girls', path: 'chunks/girls.json', sha256: 'a'.repeat(64), bytes: 10, count: 1 },
      ],
    };
    const source = new InMemoryFeedSource(manifest, {
      'chunks/girls.json': [rowGirls],
    });
    const sources = [{ id: 'wod-crossfit', label: 'CrossFit', source, url: 'https://test/seed/', embeddedVersion: 0 }];

    // Subscribe via toggle
    const subRes = await toggleNotebookSubscription('wod-crossfit', 'notebook.crossfit-girls', true, { sources, storage, isEnabled: () => true });
    expect(subRes.outcome).toBe('imported');
    expect((await storage.storageInstance.readonly('notes').getAll()).length).toBe(1);

    // Add a user-owned note to ensure user content survives
    await storage.storageInstance.transaction(['notes'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        id: 'user-note-1',
        title: 'My Workout',
        rawContent: '# My Workout',
        sourceRevision: 1,
        createdAt: Date.now(),
        seedOrigin: 'user',
        blocks: {},
      });
    });

    // Unsubscribe via toggle
    const unsubRes = await toggleNotebookSubscription('wod-crossfit', 'notebook.crossfit-girls', false, { sources, storage, isEnabled: () => true });
    expect(unsubRes.deleted).toBe(1);

    // User note survived!
    const remaining = await storage.storageInstance.readonly('notes').getAll();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('user-note-1');

    // Checkpoint deleted because no chunks remain!
    expect(await storage.getSeedMeta(seedMetaKey('wod-crossfit'))).toBeUndefined();
    expect(getFeedSubscriptionMode('wod-crossfit')).toBe('unsubscribed');
  });

  it('setFeedSubscribed keeps an explicit subscription written to localStorage by another writer while the cache was stale', () => {
    // Populate the cache with an empty map, then have another writer (other
    // tab / sync) persist an explicit subscription behind the cache's back.
    resetFeedSubscriptionsForTest();
    getFeedSubscriptionMode('sport-hyrox');
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({ 'sport-hyrox': true }));

    setFeedSubscribed('sport-crossfit', true);

    // The stale-cache write must not shrink the explicit hyrox verdict.
    resetFeedSubscriptionsForTest();
    expect(getFeedSubscriptionMode('sport-hyrox')).toBe('full');
    expect(getFeedSubscriptionMode('sport-crossfit')).toBe('full');
  });

  it('migrateFeedSubscriptions preserves an explicit subscription missing from the stale cache', async () => {
    resetFeedSubscriptionsForTest();
    getFeedSubscriptionMode('sport-hyrox');
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({ 'sport-hyrox': true }));

    const storage = new InMemoryFeedStorage();
    await storage.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        ...emptySeedMeta(seedMetaKey('sport-crossfit')),
        key: seedMetaKey('sport-crossfit'),
        seedVersion: 1,
        builtAt: new Date(1).toISOString(),
        importedAt: 1,
        tier: 'imported',
        chunks: { 'notebook.crossfit-girls': { sha256: 'a'.repeat(64) } },
      });
    });
    const migrated = await migrateFeedSubscriptions([{ id: 'sport-crossfit' }], storage);

    expect(migrated).toContain('sport-crossfit');
    resetFeedSubscriptionsForTest();
    expect(getFeedSubscriptionMode('sport-hyrox')).toBe('full');
    expect(getFeedSubscriptionMode('sport-crossfit')).toBe('full');
    // Repeated reads keep the explicit verdict — it never shrinks.
    expect(getFeedSubscriptionMode('sport-hyrox')).toBe('full');
  });

  it('migrateFeedSubscriptions never downgrades an existing canonical true via a legacy record', async () => {
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({
      'sport-hyrox': true,
      'seed-hyrox': false,
    }));
    resetFeedSubscriptionsForTest();

    const migrated = await migrateFeedSubscriptions([{ id: 'sport-hyrox' }], new InMemoryFeedStorage());

    expect(migrated).toEqual([]);
    resetFeedSubscriptionsForTest();
    expect(getFeedSubscriptionMode('sport-hyrox')).toBe('full');
    expect(JSON.parse(localStorage.getItem('wodwiki.seedSubscriptions')!)['sport-hyrox']).toBe(true);
    expect(localStorage.getItem('wodwiki.seedSubscriptions')!).not.toContain('seed-hyrox');
  });

  it('invalidates the cache and notifies listeners when a storage event changes the keys', () => {
    const notified: number[] = [];
    const unsubscribe = subscribeFeedSubscriptions(() => notified.push(notified.length + 1));

    // Another tab writes an explicit subscription; the same-tab cache is stale.
    localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify({ 'sport-hyrox': true }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'wodwiki.seedSubscriptions' }));

    expect(notified).toEqual([1]);
    // Cache was invalidated: the external value is visible without a reset.
    expect(getFeedSubscriptionMode('sport-hyrox')).toBe('full');

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: 'wodwiki.seedSubscriptions' }));
    expect(notified).toEqual([1]);
  });

  it('WW-119: pre-hydration subscribe and auto-sync writes survive hydrateFeedStateFromStorage and migrateFeedSubscriptions', async () => {
    const storage = new InMemoryFeedStorage();
    // Simulate an already-migrated IndexedDB storage where sport-crossfit was not subscribed yet.
    await storage.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        key: 'feed:subscriptions',
        entries: { core: { subscribed: true, notebookIds: null, updatedAt: 1 } },
        checks: {},
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
      await tx.readwrite('meta').put({
        ...emptySeedMeta(seedMetaKey('sport-hyrox')),
        key: seedMetaKey('sport-hyrox'),
        seedVersion: 1,
        builtAt: new Date(1).toISOString(),
        importedAt: 1,
        tier: 'imported',
        chunks: { 'notebook.hyrox-races': { sha256: 'b'.repeat(64) } },
      });
    });

    // User subscribes via /subscribe before BootGate hydration settles.
    setFeedSubscribed('sport-crossfit', true);
    setFeedOfflinePolicy('sport-crossfit', 'index-only');
    setFeedAutoSync('sport-crossfit', true);

    await hydrateFeedStateFromStorage(storage.storageInstance);
    await migrateFeedSubscriptions([{ id: 'sport-hyrox' }, { id: 'sport-crossfit' }], storage);

    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);
    expect(getFeedSubscriptionMode('sport-crossfit')).toBe('full');
    expect(getFeedOfflinePolicy('sport-crossfit')).toBe('index-only');
  });

  it('WW-119: uncommitted mirror subscription survives reload and hydrates into canonical IStorage instead of being clobbered', async () => {
    const storage = new InMemoryFeedStorage();
    // Canonical IStorage already migrated with only core subscribed.
    await storage.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        key: 'feed:subscriptions',
        entries: { core: { subscribed: true, notebookIds: null, updatedAt: 1 } },
        checks: {},
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
    });

    // User subscribes to sport-yoga and a partial notebook before canonical
    // persistence lands, then immediately reloads the page (in-memory state
    // wiped, localStorage retained, canonical IStorage still lacks sport-yoga).
    setFeedSubscribed('sport-yoga', true);
    setNotebookSubscribed('sport-crossfit', 'notebook.girls', true);
    expect(localStorage.getItem(PENDING_SUBSCRIPTIONS_KEY)).toBeTruthy();

    // Simulate page reload before canonical IDB persistence landed.
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);

    expect(isFeedSubscribed('sport-yoga')).toBe(true);
    expect(getFeedSubscriptionMode('sport-yoga')).toBe('full');
    expect(getFeedSubscriptionMode('sport-crossfit')).toBe('partial');
    expect(isNotebookSubscribed('sport-crossfit', 'notebook.girls')).toBe(true);
    // Pending journal is cleared once canonical IStorage commits.
    expect(localStorage.getItem(PENDING_SUBSCRIPTIONS_KEY)).toBeNull();

    // Verify canonical IStorage meta now holds both subscriptions and survives
    // a subsequent reload + route navigation re-hydration even with localStorage wiped.
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);
    expect(isFeedSubscribed('sport-yoga')).toBe(true);
    expect(getFeedSubscriptionMode('sport-crossfit')).toBe('partial');
    expect(isNotebookSubscribed('sport-crossfit', 'notebook.girls')).toBe(true);
  });

  it('WW-119: feed-card Subscribe during an in-flight re-hydration is never clobbered by stale canonical snapshot', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        key: 'feed:subscriptions',
        entries: { core: { subscribed: true, notebookIds: null, updatedAt: 1 } },
        checks: {},
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
    });

    // Initial boot hydration completes.
    await hydrateFeedStateFromStorage(storage.storageInstance);
    expect(isFeedSubscribed('sport-yoga')).toBe(false);

    // Pause a second hydration read (e.g., feedReadiness / route re-hydration)
    // right after reading the stale canonical meta.
    let releaseRead!: () => void;
    const readPaused = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let hitGet = false;
    const base = storage.storageInstance;
    const delayedStorage: IStorage = {
      ...base,
      readonly(storeName) {
        const ro = base.readonly(storeName);
        if (storeName !== 'meta') return ro;
        return {
          ...ro,
          async get(key) {
            const val = await ro.get(key);
            if (key === 'feed:subscriptions' && !hitGet) {
              hitGet = true;
              await readPaused;
            }
            return val;
          },
        };
      },
      readwrite: base.readwrite.bind(base),
      transaction: base.transaction.bind(base),
      wipe: base.wipe.bind(base),
      close: base.close.bind(base),
    };

    const rehydratePromise = hydrateFeedStateFromStorage(delayedStorage);
    // Wait a microtask so delayedStorage.readonly('meta').get('feed:subscriptions') is paused.
    await Promise.resolve();
    await Promise.resolve();

    // User clicks feed-card Subscribe while re-hydration is in flight.
    setFeedSubscribed('sport-yoga', true);
    releaseRead();
    await rehydratePromise;
    await flushFeedStatePersistence();

    expect(isFeedSubscribed('sport-yoga')).toBe(true);
    expect(JSON.parse(localStorage.getItem('wodwiki.seedSubscriptions')!)['sport-yoga']).toBe(true);

    // Reload + re-hydrate confirms canonical IStorage persisted sport-yoga.
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);
    expect(isFeedSubscribed('sport-yoga')).toBe(true);
  });

  it('WW-119: /subscribe intake (subscribeFeed) persists durably across reload and navigation re-hydration', async () => {
    const storage = new InMemoryFeedStorage();
    await storage.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        key: 'feed:subscriptions',
        entries: { core: { subscribed: true, notebookIds: null, updatedAt: 1 } },
        checks: {},
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
    });

    const rowYoga = compileSeedRow('markdown/notebooks/yoga/sun.md', '# Sun Salutation\n\n```time\n10:00 Flow\n```\n');
    const manifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: new Date(1).toISOString(),
      chunks: [
        { id: 'notebook.yoga', path: 'chunks/yoga.json', sha256: 'c'.repeat(64), bytes: 10, count: 1 },
      ],
    };
    const source = new InMemoryFeedSource(manifest, { 'chunks/yoga.json': [rowYoga] });
    const sources = [{ id: 'sport-yoga', label: 'Yoga', source, url: 'https://test/yoga/', embeddedVersion: 0 }];

    const outcome = await subscribeFeed('sport-yoga', {
      sources,
      storage,
      offlinePolicy: 'index-only',
      isEnabled: () => true,
    });
    expect(outcome).toBe('imported');
    expect(isFeedSubscribed('sport-yoga')).toBe(true);

    // Simulate reload + navigating /feeds -> /notebooks (multiple hydrations).
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);
    await hydrateFeedStateFromStorage(storage.storageInstance);

    expect(isFeedSubscribed('sport-yoga')).toBe(true);
    expect(getFeedSubscriptionMode('sport-yoga')).toBe('full');
    expect(JSON.parse(localStorage.getItem('wodwiki.seedSubscriptions')!)['sport-yoga']).toBe(true);

    // Once committed with no pending local journal, an authoritative external
    // IStorage unsubscribe still wins cleanly on reload.
    await storage.storageInstance.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        key: 'feed:subscriptions',
        entries: {
          core: { subscribed: true, notebookIds: null, updatedAt: 1 },
          'sport-yoga': { subscribed: false, notebookIds: [], updatedAt: 2 },
        },
        checks: {},
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
    });
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);
    expect(isFeedSubscribed('sport-yoga')).toBe(false);
  });

  it('WW-119: concurrent subscribe during cold-boot hydration write transaction survives without stranding pending overrides', async () => {
    const storage = new InMemoryFeedStorage();
    // Unmigrated storage triggers a readwrite transaction inside hydrateFeedStateFromStorage.
    let releaseTx!: () => void;
    const txPaused = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });
    let pausedOnce = false;
    const base = storage.storageInstance;
    const delayedTxStorage: IStorage = {
      ...base,
      readonly: base.readonly.bind(base),
      readwrite: base.readwrite.bind(base),
      async transaction(stores, mode, fn) {
        return base.transaction(stores, mode, async (tx) => {
          const result = await fn(tx);
          if (mode === 'readwrite' && !pausedOnce) {
            pausedOnce = true;
            await txPaused;
          }
          return result;
        });
      },
      wipe: base.wipe.bind(base),
      close: base.close.bind(base),
    };

    const hydratePromise = hydrateFeedStateFromStorage(delayedTxStorage);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // User subscribes while the initial migration transaction is still in flight.
    setFeedSubscribed('sport-yoga', true);
    releaseTx();
    await hydratePromise;
    await flushFeedStatePersistence();

    expect(isFeedSubscribed('sport-yoga')).toBe(true);
    expect(localStorage.getItem(PENDING_SUBSCRIPTIONS_KEY)).toBeNull();

    // Full reload from storage confirms canonical persistence.
    localStorage.clear();
    resetFeedSubscriptionsForTest();
    await hydrateFeedStateFromStorage(storage.storageInstance);
    expect(isFeedSubscribed('sport-yoga')).toBe(true);
  });
});
