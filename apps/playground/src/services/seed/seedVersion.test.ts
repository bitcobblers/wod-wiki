/** Pure version-decision table + the bun-test fallback for the embedded stamps. */
import { describe, expect, it } from 'bun:test';
import type { SeedMetaRecord } from '@/types/seed';
import { SEED_SCHEMA, seedMetaKey } from '@/types/seed';
import { decideSeedImport, EMBEDDED_SEED_VERSIONS, storedSeedIsCurrent } from './seedVersion';

describe('decideSeedImport', () => {
  it('imports when nothing stored or stored is pre-seed', () => {
    expect(decideSeedImport(undefined, 1000)).toBe('import');
    expect(decideSeedImport(0, 1000)).toBe('import');
  });

  it('imports when remote is newer, holds when equal, refuses rollback', () => {
    expect(decideSeedImport(1000, 2000)).toBe('import');
    expect(decideSeedImport(2000, 2000)).toBe('current');
    expect(decideSeedImport(2000, 1000)).toBe('server-stale');
  });
});

describe('storedSeedIsCurrent (skip-fetch fast path)', () => {
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
    expect(storedSeedIsCurrent(undefined, 1000)).toBe(false);
    expect(storedSeedIsCurrent(meta(0), 1000)).toBe(false);
    expect(storedSeedIsCurrent(meta(1000), 1000)).toBe(true);
    expect(storedSeedIsCurrent(meta(2000), 1000)).toBe(false);
  });

  it('never skips a stored checkpoint from any other schema', () => {
    expect(storedSeedIsCurrent(meta(1000, SEED_SCHEMA), 1000)).toBe(true);
    expect(storedSeedIsCurrent(meta(1000, SEED_SCHEMA - 1), 1000)).toBe(false);
    expect(storedSeedIsCurrent(meta(1000, SEED_SCHEMA + 1), 1000)).toBe(false);
    expect(storedSeedIsCurrent(meta(1000, 5), 1000)).toBe(false);
  });
});

describe('EMBEDDED_SEED_VERSIONS', () => {
  it('falls back to an empty map where the Vite define is absent (bun test)', () => {
    expect(EMBEDDED_SEED_VERSIONS).toEqual({});
  });
});
