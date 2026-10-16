/** seedSources — custom source registry: validation, id minting, persistence. */
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addCustomSeedSource,
  builtInSeedSourceIds,
  COMMUNITY_FEEDS,
  customSeedSources,
  FeedSeedSource,
  hiddenSeedSourceIds,
  hideSeedSourceRow,
  removeCustomSeedSource,
} from './seedSources';
import { InMemorySeedSource } from './InMemorySeedSource';
import { SEED_SCHEMA } from '@/types/seed';

beforeEach(() => {
  localStorage.clear();
});

describe('addCustomSeedSource', () => {
  it('normalizes the URL to a trailing slash and slugs the label', () => {
    const added = addCustomSeedSource('My Library', 'https://example.com/seed/lib');
    expect(added.id).toBe('my-library');
    expect(added.url).toBe('https://example.com/seed/lib/');
    expect(customSeedSources()).toEqual([added]);
  });

  it('rejects relative URLs and duplicate registrations', () => {
    expect(() => addCustomSeedSource('x', '/seed/local')).toThrow(/absolute http/);
    addCustomSeedSource('Same', 'https://a.example/seed/');
    expect(() => addCustomSeedSource('Other', 'https://a.example/seed')).toThrow(/already registered/);
    expect(customSeedSources()).toHaveLength(1);
  });

  it('defaults the label to the host name and mints unique ids', () => {
    const first = addCustomSeedSource('', 'https://mirror_one.example/seed/x/');
    expect(first.label).toBe('mirror_one.example');
    // Same label, different library — the slug collides, the id gets a
    // suffix so the checkpoint namespace stays unique.
    addCustomSeedSource('mirror one', 'https://a.example/seed/y/');
    const second = addCustomSeedSource('mirror one', 'https://b.example/seed/z/');
    expect(second.id).toBe('mirror-one-2');
  });

  it('normalizes host and scheme case and rejects credentials and query strings', () => {
    const added = addCustomSeedSource('A', 'HTTPS://Example.com/Seed');
    expect(added.url).toBe('https://example.com/Seed/');
    // Same URL, differently spelled — one source, not two.
    expect(() => addCustomSeedSource('B', 'https://example.com/Seed/')).toThrow(/already registered/);
    expect(() => addCustomSeedSource('C', 'https://user:pw@example.com/Seed/')).toThrow(/absolute http/);
    expect(() => addCustomSeedSource('D', 'https://example.com/Seed/?x=1#y')).toThrow(/absolute http/);
  });

  it('records a validated https repositoryUrl and rejects unsafe links', () => {
    const added = addCustomSeedSource('R', 'https://r.example/seed/', { repositoryUrl: 'https://github.com/x/y' });
    expect(added.repositoryUrl).toBe('https://github.com/x/y');
    expect(() => addCustomSeedSource('R2', 'https://r2.example/seed/', { repositoryUrl: 'http://github.com/x/y' })).toThrow(/https repository/);
    expect(() => addCustomSeedSource('R3', 'https://r3.example/seed/', { repositoryUrl: 'javascript:alert(1)' })).toThrow(/https repository/);
    expect(() => addCustomSeedSource('R4', 'https://r4.example/seed/', { repositoryUrl: 'https://u:pw@github.com/x/y' })).toThrow(/https repository/);
  });

  it('drops invalid persisted repositoryUrl links instead of exposing them', () => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([
      { id: 'x', label: 'X', url: 'https://x.example/seed/', repositoryUrl: 'javascript:alert(1)' },
      { id: 'y', label: 'Y', url: 'https://y.example/seed/', repositoryUrl: 'https://github.com/y/z' },
    ]));
    expect(customSeedSources()).toEqual([
      { id: 'x', label: 'X', url: 'https://x.example/seed/' },
      { id: 'y', label: 'Y', url: 'https://y.example/seed/', repositoryUrl: 'https://github.com/y/z' },
    ]);
  });

  it('never registers a URL a built-in source already serves', () => {
    expect(() => addCustomSeedSource('Community mirror', 'https://bitcobblers.github.io/wod-wiki-community')).toThrow(/already registered/);
  });
});

describe('removeCustomSeedSource', () => {
  it('removes only the named source', () => {
    const a = addCustomSeedSource('A', 'https://a.example/seed/');
    addCustomSeedSource('B', 'https://b.example/seed/');
    removeCustomSeedSource(a.id);
    expect(customSeedSources().map(s => s.id)).toEqual(['b']);
  });
});

describe('built-in row hiding', () => {
  it('hides built-in ids only, idempotently; core is never hideable', () => {
    hideSeedSourceRow('community');
    hideSeedSourceRow('community');
    hideSeedSourceRow('core');
    hideSeedSourceRow('never-registered');
    expect(hiddenSeedSourceIds()).toEqual(['community']);
    expect(builtInSeedSourceIds()).not.toContain('core');
  });
});

describe('community demo feeds', () => {

  it('FeedSeedSource filters the manifest to one feed chunk', async () => {
    const manifest = {
      schema: SEED_SCHEMA, version: 14, builtAt: new Date(14).toISOString(),
      chunks: [
        { id: 'feed.crossfit-programming', path: 'chunks/feed.crossfit-programming.json', sha256: 'a'.repeat(64), bytes: 1, count: 8 },
        { id: 'feed.dan-john-40-day', path: 'chunks/feed.dan-john-40-day.json', sha256: 'b'.repeat(64), bytes: 1, count: 6 },
        { id: 'collection.other', path: 'chunks/collection.other.json', sha256: 'c'.repeat(64), bytes: 1, count: 2 },
      ],
    };
    const inner = new InMemorySeedSource(manifest, {});
    const filtered = new FeedSeedSource(inner, 'feed.crossfit-programming');
    const seen = await filtered.fetchManifest();
    expect(seen.chunks.map((c) => c.id)).toEqual(['feed.crossfit-programming']);
    expect(seen.version).toBe(14); // identity/version metadata untouched
  });

  it('built-in feed ids are reserved from custom registration', () => {
    // A slug colliding with a built-in feed gets a suffix instead of
    // hijacking the feed's checkpoint namespace.
    const feed = COMMUNITY_FEEDS[0];
    const slug = feed.id.replace(/^community-/, ''); // → 'crossfit-programming'
    const added = addCustomSeedSource(`community ${slug.replace(/-/g, ' ')}`, 'https://custom.example/seed/');
    expect(added.id).not.toBe(feed.id);
    expect(customSeedSources().some((s) => s.id === feed.id)).toBe(false);
  });
});
