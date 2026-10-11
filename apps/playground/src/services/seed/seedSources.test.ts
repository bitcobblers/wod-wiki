/** seedSources — custom source registry: validation, id minting, persistence. */
import { beforeEach, describe, expect, it } from 'bun:test';
import { addCustomSeedSource, customSeedSources, removeCustomSeedSource } from './seedSources';

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
});

describe('removeCustomSeedSource', () => {
  it('removes only the named source', () => {
    const a = addCustomSeedSource('A', 'https://a.example/seed/');
    addCustomSeedSource('B', 'https://b.example/seed/');
    removeCustomSeedSource(a.id);
    expect(customSeedSources().map(s => s.id)).toEqual(['b']);
  });
});
