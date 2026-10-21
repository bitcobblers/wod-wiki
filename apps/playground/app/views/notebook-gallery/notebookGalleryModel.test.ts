/**
 * notebookGalleryModel tests — catalog join, filter, sort, monograms.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildNotebookCatalog,
  filterNotebooks,
  sortNotebooks,
  parseNotebookChunkId,
  monogramTint,
  monogramLetter,
  MONOGRAM_TINTS,
} from './notebookGalleryModel';
import type { SyncPackage } from '@/services/seed/seedSources';

const PACKAGES: SyncPackage[] = [
  {
    id: 'community-crossfit-programming',
    chunkId: 'feed.crossfit-programming',
    label: 'CrossFit Programming',
    category: 'feeds',
    description: 'Weekly CrossFit programming.',
    sourceId: 'common',
    sourceLabel: 'Common',
  },
  {
    id: 'community-crossfit-girls',
    chunkId: 'collection.crossfit-girls',
    label: 'CrossFit Girls',
    category: 'collections',
    description: 'Classic benchmark workouts.',
    sourceId: 'common',
    sourceLabel: 'Common',
  },
  {
    id: 'community-dashboards',
    chunkId: 'dashboards',
    label: 'Common Dashboards',
    category: 'dashboards',
    description: 'Prebuilt dashboards.',
    sourceId: 'common',
    sourceLabel: 'Common',
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
    const catalog = buildNotebookCatalog(PACKAGES, null);
    expect(catalog).toHaveLength(2); // dashboards excluded
    const feed = catalog.find(n => n.slug === 'crossfit-programming')!;
    expect(feed.installed).toBe(false);
    expect(feed.itemCount).toBe(0);
    expect(feed.description).toBe('Weekly CrossFit programming.');
    expect(feed.href).toBe('/feeds/crossfit-programming');
    const collection = catalog.find(n => n.slug === 'crossfit-girls')!;
    expect(collection.href).toBe('/collections/crossfit-girls');
  });

  it('enriches installed packages with local stats, categories, cover and dates', () => {
    const catalog = buildNotebookCatalog(PACKAGES, feedFiles('feeds', 'crossfit-programming'));
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
    const catalog = buildNotebookCatalog(PACKAGES, files);
    const local = catalog.find(n => n.slug === 'custom-strength')!;
    expect(local.sourceLabel).toBe('Local');
    expect(local.installed).toBe(true);
    expect(local.itemCount).toBe(1);
    expect(local.description).toBe('Home-brew strength collection.');
  });
});

describe('filterNotebooks', () => {
  const catalog = buildNotebookCatalog(PACKAGES, null);

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
    const catalog = buildNotebookCatalog(PACKAGES, feedFiles('feeds', 'crossfit-programming'));
    const sorted = sortNotebooks(catalog, 'updated');
    expect(sorted[0]!.slug).toBe('crossfit-programming');
    expect(sorted[1]!.slug).toBe('crossfit-girls');
  });

  it('name sorts alphabetically and size sorts by item count', () => {
    const catalog = buildNotebookCatalog(PACKAGES, feedFiles('feeds', 'crossfit-programming'));
    expect(sortNotebooks(catalog, 'name').map(n => n.label)).toEqual(['CrossFit Girls', 'CrossFit Programming']);
    expect(sortNotebooks(catalog, 'size')[0]!.slug).toBe('crossfit-programming');
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
