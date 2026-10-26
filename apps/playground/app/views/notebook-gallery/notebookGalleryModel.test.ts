/**
 * notebookGalleryModel tests — catalog join, filter, sort, monograms.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildNotebookCatalog,
  buildFeedCatalog,
  filterNotebooks,
  filterFeeds,
  groupNotebooksByFeed,
  sortNotebooks,
  sortFeeds,
  parseNotebookChunkId,
  monogramTint,
  monogramLetter,
  MONOGRAM_TINTS,
} from './notebookGalleryModel';
import { FEED_SOURCES, type NotebookDef } from '@/services/feed/feedSources';

const NOTEBOOK_FIXTURES: NotebookDef[] = [
  {
    id: 'community-crossfit-programming',
    feedId: 'sport-crossfit',
    chunkId: 'notebook.crossfit-programming',
    label: 'CrossFit Programming',
    category: 'programs',
    description: 'Weekly CrossFit programming.',
  },
  {
    id: 'community-crossfit-girls',
    feedId: 'sport-crossfit',
    chunkId: 'notebook.crossfit-girls',
    label: 'CrossFit Girls',
    category: 'workouts',
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

function feedFiles(slug: string): Record<string, string> {
  return {
    [`markdown/notebooks/${slug}/README.md`]: FEED_README,
    [`markdown/notebooks/${slug}/2026-10-05/monday.md`]: '# Monday\n```wod\n5x5 back squat\n```\n',
    [`markdown/notebooks/${slug}/2026-10-03/friday.md`]: '# Friday\n```wod\nFran\n```\n',
  };
}

describe('parseNotebookChunkId', () => {
  it('parses notebook chunk ids to their notebook slug', () => {
    expect(parseNotebookChunkId('notebook.crossfit-programming')).toEqual({ slug: 'crossfit-programming' });
    expect(parseNotebookChunkId('notebook.crossfit-girls')).toEqual({ slug: 'crossfit-girls' });
  });

  it('rejects non-notebook chunk ids', () => {
    expect(parseNotebookChunkId('dashboards')).toBeNull();
    expect(parseNotebookChunkId('feed.crossfit-girls')).toBeNull();
    expect(parseNotebookChunkId('collection.crossfit-girls')).toBeNull();
  });
});

describe('buildNotebookCatalog', () => {
  it('lists registry packages even without local corpus, marked not installed', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);
    // both crossfit notebooks plus the three app-owned core notebooks
    expect(catalog).toHaveLength(5);
    expect(catalog.slice(-3).map(n => n.slug)).toEqual(['efforts', 'equipment', 'dashboards']);
    expect(catalog[2]!.installed).toBe(false);
    expect(catalog[2]!.itemCount).toBe(0);
    expect(catalog[2]!.sourceLabel).toBe('Core');
    expect(catalog[2]!.href).toBe('/efforts');
    const feed = catalog.find(n => n.slug === 'crossfit-programming')!;
    expect(feed.installed).toBe(false);
    expect(feed.itemCount).toBe(0);
    expect(feed.description).toBe('Weekly CrossFit programming.');
    expect(feed.href).toBe('/notebook/crossfit-programming');
    const collection = catalog.find(n => n.slug === 'crossfit-girls')!;
    expect(collection.href).toBe('/notebook/crossfit-girls');
  });

  it('enriches installed packages with local stats, categories, cover and dates', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('crossfit-programming'));
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
      ...feedFiles('my-garage-gym'),
      'markdown/notebooks/custom-strength/README.md': '# Custom\n\nHome-brew strength collection.\n',
      'markdown/notebooks/custom-strength/squat-day.md': '# Squat Day\n',
    };
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, files);
    const local = catalog.find(n => n.slug === 'custom-strength')!;
    expect(local.sourceLabel).toBe('Local');
    expect(local.installed).toBe(true);
    expect(local.itemCount).toBe(1);
    expect(local.description).toBe('Home-brew strength collection.');
  });
});

describe('groupNotebooksByFeed', () => {
  it('groups notebooks under the feed that publishes them, registry order', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);
    const groups = groupNotebooksByFeed(catalog, FEED_SOURCES);
    expect(groups.map(group => group.feed?.id)).toEqual(['sport-crossfit', undefined]);
    expect(groups[0]!.label).toBe('CrossFit');
    expect(groups[0]!.repositoryUrl).toContain('wod-wiki-sport-crossfit');
    expect(groups[0]!.notebooks.map(n => n.packageId))
      .toEqual(['community-crossfit-programming', 'community-crossfit-girls']);
    // The app-owned core notebooks ride the Local group here — no passed
    // feed claims them (the core feed is not a library entry).
    expect(groups[1]!.notebooks.map(n => n.slug)).toEqual(['efforts', 'equipment', 'dashboards']);
    // The card's source line names the seed, not a package source.
    expect(catalog[0]!.sourceLabel).toBe('CrossFit');
  });

  it('keeps local content and the core notebooks in the trailing Local group', () => {
    const withLocal = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('my-garage-gym'));
    const groups = groupNotebooksByFeed(withLocal, FEED_SOURCES);
    expect(groups.at(-1)!.label).toBe('Local');
    expect(groups.at(-1)!.feed).toBeUndefined();
    expect(groups.at(-1)!.notebooks.map(n => n.slug)).toEqual(['my-garage-gym', 'efforts', 'equipment', 'dashboards']);
  });
});

describe('filterNotebooks', () => {
  const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, null);

  it('matches text over label and description, case-insensitively', () => {
    expect(filterNotebooks(catalog, { text: 'crossfit' })).toHaveLength(2);
    expect(filterNotebooks(catalog, { text: 'BENCHMARK' })).toHaveLength(1);
    expect(filterNotebooks(catalog, { text: 'zzz-nothing' })).toHaveLength(0);
  });
});

describe('sortNotebooks', () => {
  it('updated puts dated notebooks first, newest first, undated last by name', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('crossfit-programming'));
    const sorted = sortNotebooks(catalog, 'updated');
    expect(sorted[0]!.slug).toBe('crossfit-programming');
    expect(sorted[1]!.slug).toBe('crossfit-girls');
  });

  it('name sorts alphabetically and size sorts by item count', () => {
    const catalog = buildNotebookCatalog(NOTEBOOK_FIXTURES, feedFiles('crossfit-programming'));
    expect(sortNotebooks(catalog, 'name').slice(0, 2).map(n => n.label)).toEqual(['CrossFit Girls', 'CrossFit Programming']);
    expect(sortNotebooks(catalog, 'size')[0]!.slug).toBe('crossfit-programming');
  });
});

describe('buildFeedCatalog', () => {
  it('builds one card per seed, holding its notebooks and local totals', () => {
    const catalog = buildFeedCatalog(NOTEBOOK_FIXTURES, feedFiles('crossfit-programming'), FEED_SOURCES);
    expect(catalog.map(card => card.feedId)).toEqual(['sport-crossfit', undefined]);
    expect(catalog[0]).toMatchObject({ label: 'CrossFit', slug: 'sport-crossfit', itemCount: 2, href: '/notebooks' });
    expect(catalog[0]!.notebooks.map(n => n.packageId))
      .toEqual(['community-crossfit-programming', 'community-crossfit-girls']);
    expect(catalog[0]!.latestDate).toBe('2026-10-05');
    // The girls collection is missing locally, so the seed is not installed.
    expect(catalog[0]!.installed).toBe(false);
  });

  it('marks a seed installed only when every notebook it publishes is present', () => {
    const files = {
      ...feedFiles('crossfit-programming'),
      'markdown/notebooks/crossfit-girls/README.md': '# CrossFit Girls\n',
    };
    const catalog = buildFeedCatalog(NOTEBOOK_FIXTURES, files, FEED_SOURCES);
    expect(catalog[0]!.installed).toBe(true);
  });

  it('keeps locally discovered content as a Local card', () => {
    const catalog = buildFeedCatalog(NOTEBOOK_FIXTURES, feedFiles('my-garage-gym'), FEED_SOURCES);
    const local = catalog.at(-1)!;
    expect(local.feedId).toBeUndefined();
    expect(local.label).toBe('Local');
    expect(local.notebooks.map(notebook => notebook.slug)).toEqual(['my-garage-gym', 'efforts', 'equipment', 'dashboards']);
  });
});

describe('filterFeeds / sortFeeds', () => {
  const catalog = buildFeedCatalog(NOTEBOOK_FIXTURES, null, FEED_SOURCES);

  it('matches the seed copy and the notebooks it publishes', () => {
    expect(filterFeeds(catalog, { text: 'crossfit' })).toHaveLength(1);
    expect(filterFeeds(catalog, { text: 'BENCHMARK' })).toHaveLength(1);
    expect(filterFeeds(catalog, { text: 'zzz-nothing' })).toHaveLength(0);
  });

  it('filters feeds by feedId and subscribedOnly', () => {
    const isSubscribed = (feedId: string, chunkId: string) => chunkId === 'notebook.crossfit-programming';
    const subCatalog = buildFeedCatalog(NOTEBOOK_FIXTURES, null, FEED_SOURCES, isSubscribed);
    expect(filterFeeds(subCatalog, { feedId: 'sport-crossfit' })).toHaveLength(1);
    expect(filterFeeds(subCatalog, { feedId: 'other-seed' })).toHaveLength(0);
    // The Local card (core notebooks delivered with the app) is always subscribed.
    expect(filterFeeds(subCatalog, { subscribedOnly: true })).toHaveLength(2);

    const noneSubscribed = buildFeedCatalog(NOTEBOOK_FIXTURES, null, FEED_SOURCES, () => false);
    expect(filterFeeds(noneSubscribed, { subscribedOnly: true })).toHaveLength(1);
    expect(filterFeeds(noneSubscribed, { subscribedOnly: false })).toHaveLength(2);
  });

  it('sorts by name and by local size', () => {
    const withLocal = buildFeedCatalog(NOTEBOOK_FIXTURES, feedFiles('my-garage-gym'), FEED_SOURCES);
    expect(sortFeeds(withLocal, 'name').map(seed => seed.label)).toEqual(['CrossFit', 'Local']);
    // The local group out-counts the registry card here (its rows + the
    // core notebooks), so it leads on size.
    expect(sortFeeds(withLocal, 'size').map(seed => seed.label)).toEqual(['Local', 'CrossFit']);
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
