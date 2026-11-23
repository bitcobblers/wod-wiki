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
  resolveFeedDisplayDescription,
  saveFeedCatalogManifest,
} from './feedCatalog';
import { feedSourceById } from './feedSources';

const HYROX_CURATED_DESCRIPTION = 'HYROX race preparation and simulation workouts.';
const CLI_BOILERPLATE_DESCRIPTION =
  'wod-wiki-sport-hyrox — a Wod.Wiki community seed source: grouped notebooks validated and compiled into versioned seed artifacts by the wod CLI from @bitcobblers/wod-wiki-tools.';

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

  it('preserves curated HYROX label and description when a cached manifest ships CLI boilerplate copy (WW-015)', async () => {
    const cachedManifest: SeedManifest = {
      schema: 9,
      version: 1731400000001,
      builtAt: '2026-11-12T07:00:00.000Z',
      name: 'wod-wiki-sport-hyrox',
      description: CLI_BOILERPLATE_DESCRIPTION,
      chunks: [],
    };

    await saveFeedCatalogManifest('sport-hyrox', cachedManifest);

    const feeds = await playgroundFeedCatalogStore.getAllFeeds();
    const hyrox = feeds.find((row) => row.id === 'sport-hyrox');
    expect(hyrox?.label).toBe('HYROX');
    expect(hyrox?.description).toBe(HYROX_CURATED_DESCRIPTION);
    expect(hyrox?.description).not.toContain('a Wod.Wiki community seed source');
  });

  it('resolveFeedDisplayDescription prefers curated copy over CLI boilerplate and falls back to the manifest', () => {
    const sportHyrox = feedSourceById('sport-hyrox');
    expect(sportHyrox).toBeDefined();

    // Curated copy beats generic CLI boilerplate from the manifest.
    expect(resolveFeedDisplayDescription(sportHyrox!, { description: CLI_BOILERPLATE_DESCRIPTION } as SeedManifest)).toBe(
      HYROX_CURATED_DESCRIPTION,
    );
    // A non-generic manifest description still loses to curated copy.
    expect(resolveFeedDisplayDescription(sportHyrox!, { description: 'Published HYROX workouts' } as SeedManifest)).toBe(
      HYROX_CURATED_DESCRIPTION,
    );

    // A custom source without curated copy takes the manifest description.
    const custom = { id: 'custom-x', url: 'https://feeds.example.org/x/', label: 'X' } as Parameters<typeof resolveFeedDisplayDescription>[0];
    expect(resolveFeedDisplayDescription(custom, { description: '  Archived kettlebell library  ' } as SeedManifest)).toBe(
      'Archived kettlebell library',
    );
    // No curated copy, no manifest copy → undefined.
    expect(resolveFeedDisplayDescription(custom)).toBeUndefined();
  });

  it('counts distinct non-landing member notes across notebookId, notebookIds, notebook_links, and sourceId/tags consistently with /notebook/:slug (WW-047)', async () => {
    const db = host!.storage;
    await db.transaction(['notes', 'notebook_links'], 'readwrite', async (tx) => {
      // User notebook landing note (excluded from count consistently with /notebook/:slug)
      await tx.readwrite('notes').put({
        id: 'notebook/hyrox-prep',
        title: 'HYROX Prep',
        rawContent: '# HYROX Prep\n\nOverview notes.\n',
        sourceRevision: 1,
        blocks: {},
        createdAt: 1000,
        notebookId: 'notebook/hyrox-prep',
        seedOrigin: 'user',
      });
      // Member 1: legacy notebookId + notebook_links (should count once, deduplicated)
      await tx.readwrite('notes').put({
        id: 'note-1',
        title: 'Sled Push Intervals',
        rawContent: '# Sled Push Intervals\n',
        sourceRevision: 1,
        blocks: {},
        createdAt: 1001,
        notebookId: 'notebook/hyrox-prep',
        notebookIds: ['notebook/hyrox-prep'],
        seedOrigin: 'user',
      });
      await tx.readwrite('notebook_links').put({
        id: 'notebook/hyrox-prep:note:note-1',
        notebookId: 'notebook/hyrox-prep',
        targetKind: 'note',
        targetId: 'note-1',
        noteId: 'note-1',
        createdAt: 1001,
      });
      // Member 2: linked via N:M notebookIds only
      await tx.readwrite('notes').put({
        id: 'note-2',
        title: 'Wall Balls & Erg',
        rawContent: '# Wall Balls & Erg\n',
        sourceRevision: 1,
        blocks: {},
        createdAt: 1002,
        notebookIds: ['notebook/journal', 'notebook/hyrox-prep'],
        seedOrigin: 'user',
      });
      // Member 3: linked via notebook: tag (resolved by notebooksOfItem on /notebook/:slug)
      await tx.readwrite('notes').put({
        id: 'note-3',
        title: 'Burpee Broad Jumps',
        rawContent: '# Burpee Broad Jumps\n',
        sourceRevision: 1,
        blocks: {},
        createdAt: 1003,
        tags: ['notebook:hyrox-prep'],
        seedOrigin: 'user',
      });
    });

    const notebooks = await playgroundFeedCatalogStore.getAllNotebooks();
    const hyroxPrep = notebooks.find((nb) => nb.slug === 'hyrox-prep' && nb.origin === 'user');
    expect(hyroxPrep).toBeDefined();
    expect(hyroxPrep?.count).toBe(3);
  });
});
