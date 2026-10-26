/** Pure version-decision table + the bun-test fallback for the embedded stamps. */
import { describe, expect, it } from 'bun:test';
import type { SeedMetaRecord } from '@/types/seed';
import { SEED_SCHEMA, seedMetaKey } from '@/types/seed';
import { decideFeedImport, EMBEDDED_FEED_VERSIONS, storedFeedIsCurrent } from './feedVersion';

describe('decideFeedImport', () => {
  it('imports when nothing stored or stored is pre-seed', () => {
    expect(decideFeedImport(undefined, 1000)).toBe('import');
    expect(decideFeedImport(0, 1000)).toBe('import');
  });

  it('imports when remote is newer, holds when equal, refuses rollback', () => {
    expect(decideFeedImport(1000, 2000)).toBe('import');
    expect(decideFeedImport(2000, 2000)).toBe('current');
    expect(decideFeedImport(2000, 1000)).toBe('server-stale');
  });
});

describe('storedFeedIsCurrent (skip-fetch fast path)', () => {
  const meta = (seedVersion: number | undefined, schema?: number): SeedMetaRecord | undefined =>
    seedVersion === undefined
      ? undefined
      : {
          key: seedMetaKey('core'),
          seedVersion,
          schema: schema ?? SEED_SCHEMA,
          builtAt: '',
          importedAt: 0,
          chunks: {},
          claim: null,
        };

  it('requires a positive stored version equal to the embedded stamp', () => {
    expect(storedFeedIsCurrent(undefined, 1000)).toBe(false);
    expect(storedFeedIsCurrent(meta(0), 1000)).toBe(false);
    expect(storedFeedIsCurrent(meta(1000), 1000)).toBe(true);
    expect(storedFeedIsCurrent(meta(2000), 1000)).toBe(false);
  });

  it('never skips a stored checkpoint from any other schema', () => {
    expect(storedFeedIsCurrent(meta(1000, SEED_SCHEMA), 1000)).toBe(true);
    expect(storedFeedIsCurrent(meta(1000, SEED_SCHEMA - 1), 1000)).toBe(false);
    expect(storedFeedIsCurrent(meta(1000, SEED_SCHEMA + 1), 1000)).toBe(false);
    expect(storedFeedIsCurrent(meta(1000, 5), 1000)).toBe(false);
  });
});

describe('EMBEDDED_FEED_VERSIONS', () => {
  it('falls back to an empty map where the Vite define is absent (bun test)', () => {
    expect(EMBEDDED_FEED_VERSIONS).toEqual({});
  });
});
