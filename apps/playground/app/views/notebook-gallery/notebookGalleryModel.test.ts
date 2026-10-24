/**
 * notebookGalleryModel tests — catalog join, filter, sort, monograms.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildNotebookCatalog,
  buildSeedCatalog,
  filterNotebooks,
  filterSeeds,
  groupNotebooksBySeed,
  sortNotebooks,
  sortSeeds,
  parseNotebookChunkId,
  monogramTint,
  monogramLetter,
  MONOGRAM_TINTS,
} from './notebookGalleryModel';
import { SEED_SOURCES, type NotebookDef } from '@/services/seed/seedSources';

const NOTEBOOK_FIXTURES: NotebookDef[] = [
  {
    id: 'community-crossfit-programming',
    seedId: 'seed-crossfit',
    chunkId: 'feed.crossfit-programming',
    label: 'CrossFit Programming',
    category: 'feeds',
    description: 'Weekly CrossFit programming.',
  },
  {
    id: 'community-crossfit-girls',
    seedId: 'seed-crossfit',
    chunkId: 'collection.crossfit-girls',
    label: 'CrossFit Girls',
    category: 'collections',
    description: 'Classic benchmark workouts.',
  },
];

const FEED_README = `---
template: canvas
description: "Weekly strength and conditioning."
image: /images/covers/crossfit-programming.png
category:
  - crossfit
---
# CrossFit Programming

A weekly CrossFit program with daily workouts.
`;

function feedFiles(root: string, slug: string): Record<string, string> {
  return {
    [`markdown/feeds/${slug}/README.md`]: FEED_README,
    [`markdown/feeds/${slug}/2026-10-05/monday.md`]: '# Monday\n```wod\n5x5 back squat\n```\n',
    [`markdown/feeds/${slug}/2026-10-03/friday.md`]: '# Friday\n```wod\nFran\n```\n',
  };
}

describe('parseNotebookChunkId', () => {
  it('parses feed and collection chunk ids', () => {
    expect(parseNotebookChunkId('feed.crossfit-programming')).toEqual({ kind: 'feed', slug: 'crossfit-programming' });
    expect(parseNotebookChunkId('collection.crossfit-girls')).toEqual({ kind: 'collection', slug: 'crossfit-girls' });
  });

  it('rejects non-notebook chunk ids', () => {
    expect(parseNotebookChunkId('dashboards')).toBeNull();
    expect(parseNotebookChunkId('feed')).toBeNull();
  });
});

describe('buildNotebookCatalog', () => {
  it('lists registry packages even without local corpus, marked not installed', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);
    expect(catalog).toHaveLength(2); // both crossfit notebooks
    const feed = catalog.find(n => n.slug === 'crossfit-programming')!;
    expect(feed.installed).toBe(false);
    expect(feed.itemCount).toBe(0);
    expect(feed.description).toBe('Weekly CrossFit programming.');
    expect(feed.href).toBe('/feeds/crossfit-programming');
    const collection = catalog.find(n => n.slug === 'crossfit-girls')!;
    expect(collection.href).toBe('/collections/crossfit-girls');
  });

  it('enriches installed packages with local stats, categories, cover and dates', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'crossfit-programming'));
    const feed = catalog.find(n => n.slug === 'crossfit-programming')!;
    expect(feed.installed).toBe(true);
    expect(feed.itemCount).toBe(2);
    expect(feed.latestDate).toBe('2026-10-05');
    expect(feed.firstDate).toBe('2026-10-03');
    expect(feed.image).toBe('/images/covers/crossfit-programming.png');
    expect(feed.categories).toEqual(['crossfit']);
    // Registry description wins over the README front matter copy.
    expect(feed.description).toBe('Weekly CrossFit programming.');
    expect(feed.readme).toContain('# CrossFit Programming');
  });

  it('includes local-only groupings (custom sources) as Local notebooks', () => {
    const files = {
      ...feedFiles('feeds', 'my-garage-gym'),
      'markdown/collections/custom-strength/README.md': '# Custom\n\nHome-brew strength collection.\n',
      'markdown/collections/custom-strength/squat-day.md': '# Squat Day\n',
    };
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, files);
    const local = catalog.find(n => n.slug === 'custom-strength')!;
    expect(local.sourceLabel).toBe('Local');
    expect(local.installed).toBe(true);
    expect(local.itemCount).toBe(1);
    expect(local.description).toBe('Home-brew strength collection.');
  });
});

describe('groupNotebooksBySeed', () => {
  it('groups notebooks under the seed that publishes them, registry order', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);
    const groups = groupNotebooksBySeed(catalog, SEED_SOURCES);
    expect(groups.map(group => group.seed?.id)).toEqual(['seed-crossfit']);
    expect(groups[0]!.label).toBe('CrossFit');
    expect(groups[0]!.repositoryUrl).toContain('wod-wiki-seed-crossfit');
    expect(groups[0]!.notebooks.map(n => n.packageId))
      .toEqual(['community-crossfit-programming', 'community-crossfit-girls']);
    // The card's source line names the seed, not a package source.
    expect(catalog[0]!.sourceLabel).toBe('CrossFit');
  });

  it('drops seeds with nothing left after filtering, and keeps local content last', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);
    const feedsOnly = groupNotebooksBySeed(filterNotebooks(catalog, { kind: 'feed' }), SEED_SOURCES);
    expect(feedsOnly[0]!.notebooks.map(n => n.packageId)).toEqual(['community-crossfit-programming']);

    const withLocal = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'my-garage-gym'));
    const groups = groupNotebooksBySeed(withLocal, SEED_SOURCES);
    expect(groups.at(-1)!.label).toBe('Local');
    expect(groups.at(-1)!.seed).toBeUndefined();
    expect(groups.at(-1)!.notebooks.map(n => n.slug)).toEqual(['my-garage-gym']);
  });
});

describe('filterNotebooks', () => {
  const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);

  it('filters by kind', () => {
    expect(filterNotebooks(catalog, { kind: 'feed' }).every(n => n.kind === 'feed')).toBe(true);
    expect(filterNotebooks(catalog, { kind: 'collection' })).toHaveLength(1);
  });

  it('matches text over label and description, case-insensitively', () => {
    expect(filterNotebooks(catalog, { text: 'crossfit' })).toHaveLength(2);
    expect(filterNotebooks(catalog, { text: 'BENCHMARK' })).toHaveLength(1);
    expect(filterNotebooks(catalog, { text: 'zzz-nothing' })).toHaveLength(0);
  });
});

describe('sortNotebooks', () => {
  it('updated puts dated notebooks first, newest first, undated last by name', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'crossfit-programming'));
    const sorted = sortNotebooks(catalog, 'updated');
    expect(sorted[0]!.slug).toBe('crossfit-programming');
    expect(sorted[1]!.slug).toBe('crossfit-girls');
  });

  it('name sorts alphabetically and size sorts by item count', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'crossfit-programming'));
    expect(sortNotebooks(catalog, 'name').map(n => n.label)).toEqual(['CrossFit Girls', 'CrossFit Programming']);
    expect(sortNotebooks(catalog, 'size')[0]!.slug).toBe('crossfit-programming');
  });
});

describe('buildSeedCatalog', () => {
  it('builds one card per seed, holding its notebooks and local totals', () => {
    const catalog = buildSeedCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'crossfit-programming'), SEED_SOURCES);
    expect(catalog.map(card => card.seedId)).toEqual(['seed-crossfit']);
    expect(catalog[0]).toMatchObject({ label: 'CrossFit', slug: 'seed-crossfit', itemCount: 2, href: '/catalogs' });
    expect(catalog[0]!.notebooks.map(n => n.packageId))
      .toEqual(['community-crossfit-programming', 'community-crossfit-girls']);
    expect(catalog[0]!.latestDate).toBe('2026-10-05');
    // The girls collection is missing locally, so the seed is not installed.
    expect(catalog[0]!.installed).toBe(false);
  });

  it('marks a seed installed only when every notebook it publishes is present', () => {
    const files = {
      ...feedFiles('feeds', 'crossfit-programming'),
      'markdown/collections/crossfit-girls/README.md': '# CrossFit Girls\n',
    };
    const catalog = buildSeedCatalog(NOTEBOOK_FIXTURES, files, SEED_SOURCES);
    expect(catalog[0]!.installed).toBe(true);
  });

  it('keeps locally discovered content as a Local card', () => {
    const catalog = buildSeedCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'my-garage-gym'), SEED_SOURCES);
    const local = catalog.at(-1)!;
    expect(local.seedId).toBeUndefined();
    expect(local.label).toBe('Local');
    expect(local.notebooks.map(notebook => notebook.slug)).toEqual(['my-garage-gym']);
  });
});

describe('filterSeeds / sortSeeds', () => {
  const catalog = buildSeedCatalog(NOTEBOOK_FIXTURES, null, SEED_SOURCES);

  it('matches the seed copy and the notebooks it publishes', () => {
    expect(filterSeeds(catalog, { text: 'crossfit' })).toHaveLength(1);
    expect(filterSeeds(catalog, { text: 'BENCHMARK' })).toHaveLength(1);
    expect(filterSeeds(catalog, { text: 'zzz-nothing' })).toHaveLength(0);
    expect(filterSeeds(catalog, { kind: 'collection' })).toHaveLength(1);
    expect(filterSeeds(catalog, { kind: 'feed' })).toHaveLength(1);
  });

  it('filters seeds by seedId and subscribedOnly', () => {
    const isSubscribed = (seedId: string, chunkId: string) => chunkId === 'feed.crossfit-programming';
    const subCatalog = buildSeedCatalog(NOTEBOOK_FIXTURES, null, SEED_SOURCES, isSubscribed);
    expect(filterSeeds(subCatalog, { seedId: 'seed-crossfit' })).toHaveLength(1);
    expect(filterSeeds(subCatalog, { seedId: 'other-seed' })).toHaveLength(0);
    expect(filterSeeds(subCatalog, { subscribedOnly: true })).toHaveLength(1);

    const noneSubscribed = buildSeedCatalog(NOTEBOOK_FIXTURES, null, SEED_SOURCES, () => false);
    expect(filterSeeds(noneSubscribed, { subscribedOnly: true })).toHaveLength(0);
    expect(filterSeeds(noneSubscribed, { subscribedOnly: false })).toHaveLength(1);
  });

  it('sorts by name and by local size', () => {
    const withLocal = buildSeedCatalog(NOTEBOOK_FIXTURES, feedFiles('feeds', 'my-garage-gym'), SEED_SOURCES);
    expect(sortSeeds(withLocal, 'name').map(seed => seed.label)).toEqual(['CrossFit', 'Local']);
    // Only the local feed has rows here, so it leads on size.
    expect(sortSeeds(withLocal, 'size').map(seed => seed.label)).toEqual(['Local', 'CrossFit']);
  });
});

describe('monogram covers', () => {
  it('monogramTint is deterministic and within the palette', () => {
    expect(monogramTint('crossfit-programming')).toBe(monogramTint('crossfit-programming'));
    expect(([...MONOGRAM_TINTS] as string[]).includes(monogramTint('crossfit-programming'))).toBe(true);
  });

  it('monogramLetter picks the first alphanumeric, uppercased', () => {
    expect(monogramLetter('CrossFit Programming')).toBe('C');
    expect(monogramLetter('40-day program')).toBe('4');
  });
});
