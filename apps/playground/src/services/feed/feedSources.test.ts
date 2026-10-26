/** feedSources — the feed registry: validation, id minting, persistence. */
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addCustomFeedSource,
  builtInFeedSourceIds,
  CORE_FEED_URL,
  customFeedSources,
  feedSourceById,
  hiddenFeedSourceIds,
  hideFeedSourceRow,
  listNotebooks,
  listFeedSources,
  NOTEBOOKS,
  notebookById,
  notebooksOfFeed,
  removeCustomFeedSource,
  FEED_SOURCES,
  feedIdForLegacyId,
  toAbsoluteFeedUrl,
} from './feedSources';

beforeEach(() => {
  localStorage.clear();
});

describe('addCustomFeedSource', () => {
  it('normalizes the URL to a trailing slash and slugs the label', () => {
    const added = addCustomFeedSource('My Library', 'https://example.com/seed/lib');
    expect(added.id).toBe('my-library');
    expect(added.url).toBe('https://example.com/seed/lib/');
    expect(customFeedSources()).toEqual([added]);
  });

  it('rejects relative URLs and duplicate registrations', () => {
    expect(() => addCustomFeedSource('x', '/seed/local')).toThrow(/absolute http/);
    addCustomFeedSource('Same', 'https://a.example/seed/');
    expect(() => addCustomFeedSource('Other', 'https://a.example/seed')).toThrow(/already registered/);
    expect(customFeedSources()).toHaveLength(1);
  });

  it('defaults the label to the host name and mints unique ids', () => {
    const first = addCustomFeedSource('', 'https://mirror_one.example/seed/x/');
    expect(first.label).toBe('mirror_one.example');
    // Same label, different library — the slug collides, the id gets a
    // suffix so the checkpoint namespace stays unique.
    addCustomFeedSource('mirror one', 'https://a.example/seed/y/');
    const second = addCustomFeedSource('mirror one', 'https://b.example/seed/z/');
    expect(second.id).toBe('mirror-one-2');
  });

  it('normalizes host and scheme case and rejects credentials and query strings', () => {
    const added = addCustomFeedSource('A', 'HTTPS://Example.com/Seed');
    expect(added.url).toBe('https://example.com/Seed/');
    // Same URL, differently spelled — one source, not two.
    expect(() => addCustomFeedSource('B', 'https://example.com/Seed/')).toThrow(/already registered/);
    expect(() => addCustomFeedSource('C', 'https://user:pw@example.com/Seed/')).toThrow(/absolute http/);
    expect(() => addCustomFeedSource('D', 'https://example.com/Seed/?x=1#y')).toThrow(/absolute http/);
  });

  it('records a validated https repositoryUrl and rejects unsafe links', () => {
    const added = addCustomFeedSource('R', 'https://r.example/seed/', { repositoryUrl: 'https://github.com/x/y' });
    expect(added.repositoryUrl).toBe('https://github.com/x/y');
    expect(() => addCustomFeedSource('R2', 'https://r2.example/seed/', { repositoryUrl: 'http://github.com/x/y' })).toThrow(/https repository/);
    expect(() => addCustomFeedSource('R3', 'https://r3.example/seed/', { repositoryUrl: 'javascript:alert(1)' })).toThrow(/https repository/);
    expect(() => addCustomFeedSource('R4', 'https://r4.example/seed/', { repositoryUrl: 'https://u:pw@github.com/x/y' })).toThrow(/https repository/);
  });

  it('drops invalid persisted repositoryUrl links instead of exposing them', () => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([
      { id: 'x', label: 'X', url: 'https://x.example/seed/', repositoryUrl: 'javascript:alert(1)' },
      { id: 'y', label: 'Y', url: 'https://y.example/seed/', repositoryUrl: 'https://github.com/y/z' },
    ]));
    expect(customFeedSources()).toEqual([
      { id: 'x', label: 'X', url: 'https://x.example/seed/' },
      { id: 'y', label: 'Y', url: 'https://y.example/seed/', repositoryUrl: 'https://github.com/y/z' },
    ]);
  });

  it('never registers a URL a built-in source already serves', () => {
    // A split seed repo's Pages dir is that seed — not a second source.
    expect(() => addCustomFeedSource('CrossFit mirror', 'https://bitcobblers.github.io/wod-wiki-seed-crossfit')).toThrow(/already registered/);
    expect(() => addCustomFeedSource('Core mirror', 'https://seed.example/seed/')).not.toThrow();
  });
});

describe('removeCustomFeedSource', () => {
  it('removes only the named source', () => {
    const a = addCustomFeedSource('A', 'https://a.example/seed/');
    addCustomFeedSource('B', 'https://b.example/seed/');
    removeCustomFeedSource(a.id);
    expect(customFeedSources().map(s => s.id)).toEqual(['b']);
  });
});

describe('built-in row hiding', () => {
  it('hides built-in feed ids only, idempotently; core is never hideable', () => {
    hideFeedSourceRow('seed-hyrox');
    hideFeedSourceRow('seed-hyrox');
    // A pre-feed-unit notebook id folds onto the feed that publishes it —
    // notebooks are no longer independent sync units, so nothing narrower
    // can be hidden.
    hideFeedSourceRow('community-crossfit-girls');
    hideFeedSourceRow('core');
    hideFeedSourceRow('never-registered');
    expect(hiddenFeedSourceIds()).toEqual(['seed-hyrox', 'seed-crossfit']);
    expect(builtInFeedSourceIds()).toContain('seed-hyrox');
    expect(builtInFeedSourceIds()).not.toContain('core');
  });
});

describe('feeds and their notebooks', () => {
  it('keys every built-in notebook to the feed that publishes it', () => {
    const feedIds = new Set(FEED_SOURCES.map((s) => s.id));
    expect(NOTEBOOKS.length).toBeGreaterThan(0);
    for (const notebook of NOTEBOOKS) {
      expect(feedIds.has(notebook.feedId)).toBe(true);
      expect(notebooksOfFeed(notebook.feedId)).toContainEqual(notebook);
    }
    // The split corpus: 14 feeds, one checkpoint and one Subscribe each.
    expect(FEED_SOURCES).toHaveLength(14);
    expect(listFeedSources().map((s) => s.id)).toEqual([...feedIds]);
  });

  it('a custom feed is its own source and its own (whole-manifest) notebook', () => {
    const added = addCustomFeedSource('My Garage', 'https://garage.example/feed/');
    expect(listFeedSources().at(-1)).toMatchObject({ id: added.id, url: added.url, tier: 'imported' });
    expect(listNotebooks().at(-1)).toMatchObject({ id: added.id, feedId: added.id, chunkId: added.id });
    expect(notebooksOfFeed(added.id)).toHaveLength(1);
  });

  it('folds pre-feed-unit notebook ids onto their feed, and leaves feed ids alone', () => {
    expect(feedIdForLegacyId('community-crossfit-girls')).toBe('seed-crossfit');
    expect(feedIdForLegacyId('seed-crossfit')).toBe('seed-crossfit');
    expect(feedIdForLegacyId('some-custom-source')).toBe('some-custom-source');
    expect(notebookById('community-yoga')?.feedId).toBe('example-yoga');
  });

  it('built-in notebook and feed ids are reserved from custom registration', () => {
    // A slug colliding with a built-in notebook gets a suffix instead of
    // hijacking its checkpoint namespace.
    const notebook = NOTEBOOKS[0];
    const slug = notebook.id.replace(/^community-/, ''); // → 'crossfit-games'
    const added = addCustomFeedSource(`community ${slug.replace(/-/g, ' ')}`, 'https://custom.example/seed/');
    expect(added.id).not.toBe(notebook.id);
    expect(customFeedSources().some((s) => s.id === notebook.id)).toBe(false);
    // Retired checkpoint namespaces never become new sources either.
    const legacy = addCustomFeedSource('seed core', 'https://legacy.example/seed/');
    expect(legacy.id).not.toBe('seed-core');
  });
});

describe('feed identity in the registry', () => {
  it('gives every registered feed one id', () => {
    for (const source of listFeedSources()) {
      expect(typeof source.id).toBe('string');
      expect(source.id.length).toBeGreaterThan(0);
    }
    expect(feedSourceById('never-registered')).toBeUndefined();
  });

  it('names the owning feed of every notebook', () => {
    for (const notebook of listNotebooks()) {
      expect(typeof notebook.feedId).toBe('string');
      expect(notebook.feedId.length).toBeGreaterThan(0);
    }
  });

  it('gives a user-registered feed an id too', () => {
    const added = addCustomFeedSource('My Library', 'https://example.com/feed/lib');
    const listed = listFeedSources().find((source) => source.id === added.id);
    expect(listed?.id).toBe(added.id);
    expect(feedSourceById(added.id)?.url).toBe('https://example.com/feed/lib/');
  });

  it('resolves the registered source by its id — built-in, core, and custom', () => {
    const custom = addCustomFeedSource('My Library', 'https://example.com/feed/lib');
    for (const id of ['core', 'seed-crossfit', 'yt-dan-john', custom.id]) {
      const source = feedSourceById(id);
      expect(source, id).toBeDefined();
      expect(source!.id, id).toBe(id);
    }
    // The app's own core feed resolves like any other registered source.
    expect(feedSourceById('core')?.url).toBe(CORE_FEED_URL);
    // The library list stays the library list — core publishes no library
    // notebook of its own.
    expect(listFeedSources().map((source) => source.id)).not.toContain('core');
  });

  it('reads a registry record written before the rename', () => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([
      { id: 'legacy', label: 'Legacy', url: 'https://legacy.example/feed/' },
    ]));
    expect(listFeedSources().find((source) => source.id === 'legacy')?.id).toBe('legacy');
  });

  it('leaves the stored registry entries unchanged — no re-keying, no lost sources', () => {
    addCustomFeedSource('My Library', 'https://example.com/feed/lib');
    // The persisted record is exactly what it always was: the feed id lives
    // on the registry entry, not in the user's storage.
    expect(JSON.parse(localStorage.getItem('wodwiki.seedSources')!)).toEqual([
      { id: 'my-library', label: 'My Library', url: 'https://example.com/feed/lib/' },
    ]);
    expect(localStorage.getItem('wodwiki.seedSources.hidden')).toBeNull();
    hideFeedSourceRow('seed-hyrox');
    expect(JSON.parse(localStorage.getItem('wodwiki.seedSources.hidden')!)).toEqual(['seed-hyrox']);
    // The registered source survives the hidden-row write.
    expect(customFeedSources().map((source) => source.id)).toEqual(['my-library']);
  });
});

describe('toAbsoluteFeedUrl', () => {
  it('leaves absolute http/https URLs unchanged', () => {
    expect(toAbsoluteFeedUrl('https://example.com/seed/core/')).toBe('https://example.com/seed/core/');
    expect(toAbsoluteFeedUrl('http://example.com/seed/core/')).toBe('http://example.com/seed/core/');
  });

  it('resolves relative URLs against the provided or document base', () => {
    expect(toAbsoluteFeedUrl('./seed/core/', 'http://127.0.0.1:6006/iframe.html?id=foo')).toBe('http://127.0.0.1:6006/seed/core/');
    expect(toAbsoluteFeedUrl('/seed/core/', 'http://127.0.0.1:6006/sub/page.html')).toBe('http://127.0.0.1:6006/seed/core/');
  });

  it('resolves relative URLs against document.baseURI when base is omitted', () => {
    // unit-setup.ts provides happy-dom with document.baseURI = "http://localhost/"
    expect(toAbsoluteFeedUrl('./seed/core/')).toBe('http://localhost/seed/core/');
  });
});
