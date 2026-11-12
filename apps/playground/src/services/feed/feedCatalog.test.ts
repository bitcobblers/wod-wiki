import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeedManifest } from '@bitcobblers/wod-wiki-engine';
import {
  setupPlaygroundTestHost,
  type PlaygroundHostHandle,
} from '@/testing/host';
import {
  addCustomFeedSource,
  removeCustomFeedSource,
} from './feedSources';
import { resetFeedSubscriptionsForTest } from './feedSubscriptions';
import {
  playgroundFeedCatalogStore,
  saveFeedCatalogManifest,
} from './feedCatalog';

describe('feedCatalog display label precedence (WW-015)', () => {
  let host: PlaygroundHostHandle | null = null;
  const customIds: string[] = [];

  beforeEach(async () => {
    localStorage.removeItem('wodwiki.seedSources');
    localStorage.removeItem('wodwiki.seedSources.hidden');
    localStorage.removeItem('wodwiki.seedSubscriptions');
    resetFeedSubscriptionsForTest();
    host = await setupPlaygroundTestHost();
  });

  afterEach(async () => {
    for (const id of customIds.splice(0)) {
      removeCustomFeedSource(id);
    }
    localStorage.removeItem('wodwiki.seedSources');
    localStorage.removeItem('wodwiki.seedSources.hidden');
    localStorage.removeItem('wodwiki.seedSubscriptions');
    resetFeedSubscriptionsForTest();
    if (host) {
      await host.cleanup();
      host = null;
    }
  });

  it('keeps curated built-in label "HYROX" before and after manifest cache population', async () => {
    const beforeFeeds = await playgroundFeedCatalogStore.getAllFeeds();
    const beforeHyrox = beforeFeeds.find((row) => row.id === 'sport-hyrox');
    expect(beforeHyrox?.label).toBe('HYROX');

    const cachedManifest: SeedManifest = {
      schema: 9,
      version: 1731400000000,
      builtAt: '2026-11-12T07:00:00.000Z',
      name: 'wod-wiki-sport-hyrox',
      description: 'Published HYROX workouts',
      chunks: [
        {
          id: 'notebook.hyrox',
          path: 'chunks/notebook.hyrox.json',
          sha256: 'abc123',
          count: 14,
          bytes: 4096,
        },
      ],
      notebooks: [
        {
          notebookId: 'notebook.hyrox',
          label: 'HYROX',
          category: 'workouts',
          count: 14,
          bytes: 4096,
          version: 1731400000000,
          commit: 'deadbeef',
          sha256: 'abc123',
          builtAt: '2026-11-12T07:00:00.000Z',
          indexPath: 'indexes/notebooks/notebook.hyrox.json',
        },
      ],
    };

    await saveFeedCatalogManifest('sport-hyrox', cachedManifest);

    const afterFeeds = await playgroundFeedCatalogStore.getAllFeeds();
    const afterHyrox = afterFeeds.find((row) => row.id === 'sport-hyrox');
    expect(afterHyrox?.label).toBe('HYROX');
    expect(afterHyrox?.remoteVersion).toBe(1731400000000);

    const afterNotebooks = await playgroundFeedCatalogStore.getAllNotebooks();
    const hyroxNotebook = afterNotebooks.find((nb) => nb.feedId === 'sport-hyrox');
    expect(hyroxNotebook?.feedLabel).toBe('HYROX');
  });

  it('falls back to manifest.name for custom feeds registered with blank/hostname label while keeping explicit custom labels', async () => {
    const unnamedCustom = addCustomFeedSource('', 'https://feeds.example.org/kb/');
    customIds.push(unnamedCustom.id);
    const namedCustom = addCustomFeedSource('Coach Jane', 'https://feeds.example.org/jane/');
    customIds.push(namedCustom.id);

    await saveFeedCatalogManifest(unnamedCustom.id, {
      schema: 9,
      version: 2,
      builtAt: '2026-11-12T07:00:00.000Z',
      name: 'Kettlebell Archive',
      chunks: [],
    });
    await saveFeedCatalogManifest(namedCustom.id, {
      schema: 9,
      version: 3,
      builtAt: '2026-11-12T07:00:00.000Z',
      name: 'wod-wiki-jane-repo-slug',
      chunks: [],
    });

    const feeds = await playgroundFeedCatalogStore.getAllFeeds();
    expect(feeds.find((row) => row.id === unnamedCustom.id)?.label).toBe('Kettlebell Archive');
    expect(feeds.find((row) => row.id === namedCustom.id)?.label).toBe('Coach Jane');
  });
});
