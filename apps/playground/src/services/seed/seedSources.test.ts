/** seedSources — custom source registry: validation, id minting, persistence. */
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  addCustomSeedSource,
  builtInSeedSourceIds,
  customSeedSources,
  hiddenSeedSourceIds,
  hideSeedSourceRow,
  listNotebooks,
  listSeedSources,
  NOTEBOOKS,
  notebookById,
  notebooksOfSeed,
  removeCustomSeedSource,
  SEED_SOURCES,
  seedIdForLegacyId,
} from './seedSources';

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
    // A split seed repo's Pages dir is that seed — not a second source.
    expect(() => addCustomSeedSource('CrossFit mirror', 'https://bitcobblers.github.io/wod-wiki-seed-crossfit')).toThrow(/already registered/);
    expect(() => addCustomSeedSource('Core mirror', 'https://seed.example/seed/')).not.toThrow();
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
  it('hides built-in seed ids only, idempotently; core is never hideable', () => {
    hideSeedSourceRow('seed-hyrox');
    hideSeedSourceRow('seed-hyrox');
    // A pre-seed-unit notebook id folds onto the seed that publishes it —
    // notebooks are no longer independent sync units, so nothing narrower
    // can be hidden.
    hideSeedSourceRow('community-crossfit-girls');
    hideSeedSourceRow('core');
    hideSeedSourceRow('never-registered');
    expect(hiddenSeedSourceIds()).toEqual(['seed-hyrox', 'seed-crossfit']);
    expect(builtInSeedSourceIds()).toContain('seed-hyrox');
    expect(builtInSeedSourceIds()).not.toContain('core');
  });
});

describe('seeds and their notebooks', () => {
  it('keys every built-in notebook to the seed that publishes it', () => {
    const seedIds = new Set(SEED_SOURCES.map((s) => s.id));
    expect(NOTEBOOKS.length).toBeGreaterThan(0);
    for (const notebook of NOTEBOOKS) {
      expect(seedIds.has(notebook.seedId)).toBe(true);
      expect(notebooksOfSeed(notebook.seedId)).toContainEqual(notebook);
    }
    // The split corpus: 15 seeds, one checkpoint and one Subscribe each.
    expect(SEED_SOURCES).toHaveLength(15);
    expect(listSeedSources().map((s) => s.id)).toEqual([...seedIds]);
  });

  it('a custom seed is its own source and its own (whole-manifest) notebook', () => {
    const added = addCustomSeedSource('My Garage', 'https://garage.example/seed/');
    expect(listSeedSources().at(-1)).toMatchObject({ id: added.id, url: added.url, tier: 'imported' });
    expect(listNotebooks().at(-1)).toMatchObject({ id: added.id, seedId: added.id, chunkId: added.id });
    expect(notebooksOfSeed(added.id)).toHaveLength(1);
  });

  it('folds pre-seed-unit notebook ids onto their seed, and leaves seed ids alone', () => {
    expect(seedIdForLegacyId('community-crossfit-girls')).toBe('seed-crossfit');
    expect(seedIdForLegacyId('seed-crossfit')).toBe('seed-crossfit');
    expect(seedIdForLegacyId('some-custom-source')).toBe('some-custom-source');
    expect(notebookById('community-yoga')?.seedId).toBe('example-yoga');
  });

  it('built-in notebook and seed ids are reserved from custom registration', () => {
    // A slug colliding with a built-in notebook gets a suffix instead of
    // hijacking its checkpoint namespace.
    const notebook = NOTEBOOKS[0];
    const slug = notebook.id.replace(/^community-/, ''); // → 'efforts'
    const added = addCustomSeedSource(`community ${slug.replace(/-/g, ' ')}`, 'https://custom.example/seed/');
    expect(added.id).not.toBe(notebook.id);
    expect(customSeedSources().some((s) => s.id === notebook.id)).toBe(false);
  });
});
