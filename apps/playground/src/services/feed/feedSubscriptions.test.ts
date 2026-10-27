import { describe, expect, it, beforeEach } from 'bun:test';
import {
  getFeedSubscriptionMode,
  getSubscribedNotebooks,
  isNotebookSubscribed,
  resetFeedSubscriptionsForTest,
  setFeedSubscribed,
  setNotebookSubscribed,
} from './feedSubscriptions';
import { syncNotebook, toggleNotebookSubscription } from './feedSync';
import { InMemoryFeedStorage } from './FeedImportStorage';
import { InMemoryFeedSource } from './InMemoryFeedSource';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { seedMetaKey, SEED_SCHEMA } from '@/types/seed';

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
});
