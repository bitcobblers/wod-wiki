import { describe, expect, it } from 'vitest';
import {
  SEED_SCHEMA,
  assertSeedManifest,
  assertNotebookIndex,
  assertSeedRows,
  assertSeedRow,
  type SeedManifest,
  type NotebookIndex,
  type NotebookIndexSummary,
} from '../src/index';

describe('Seed validation & two-tier index contract', () => {
  const validSummary: NotebookIndexSummary = {
    notebookId: 'notebook.test',
    label: 'Test Notebook',
    category: 'test',
    indexPath: 'indexes/notebooks/notebook.test.json',
    version: 3,
    commit: '0123456789abcdef0123456789abcdef01234567',
    updatedAt: '2026-01-01T00:00:00.000Z',
    builtAt: '2026-01-01T00:00:00.000Z',
    sha256: 'a'.repeat(64),
    bytes: 1234,
    count: 2,
  };

  it('validates a lightweight SeedManifest with NotebookIndexSummary entries', () => {
    const manifest: SeedManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: new Date(1).toISOString(),
      chunks: [
        { id: 'notebook.test', path: 'chunks/test.12345678.json', sha256: 'b'.repeat(64), bytes: 50, count: 2 },
      ],
      notebooks: [validSummary],
    };

    const validated = assertSeedManifest(manifest);
    expect(validated.notebooks?.[0].notebookId).toBe('notebook.test');
    expect(validated.notebooks?.[0].version).toBe(3);
  });

  it('rejects SeedManifest when notebooks contain inline records', () => {
    const invalidManifest = {
      schema: SEED_SCHEMA,
      version: 1,
      builtAt: new Date(1).toISOString(),
      chunks: [
        { id: 'notebook.test', path: 'chunks/test.12345678.json', sha256: 'b'.repeat(64), bytes: 50, count: 2 },
      ],
      notebooks: [
        {
          ...validSummary,
          records: [{ uuid: 'u1', path: 'p1', recordPath: 'rp1', commit: 'c1', version: 1, sha256: 's1' }],
        },
      ],
    };

    expect(() => assertSeedManifest(invalidManifest)).toThrow(/records/i);
  });

  it('assertNotebookIndex validates full NotebookIndex with records', () => {
    const fullIndex: NotebookIndex = {
      ...validSummary,
      records: [
        {
          uuid: '11111111-1111-1111-1111-111111111111',
          path: 'markdown/notebooks/test/workout.md',
          recordPath: 'markdown/notebooks/test/workout.json',
          commit: '0123456789abcdef0123456789abcdef01234567',
          version: 2,
          sha256: 'c'.repeat(64),
          title: 'Workout 1',
        },
      ],
    };

    const validated = assertNotebookIndex(fullIndex);
    expect(validated.notebookId).toBe('notebook.test');
    expect(validated.records).toHaveLength(1);
    expect(validated.records[0].uuid).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('assertNotebookIndex rejects missing records', () => {
    expect(() => assertNotebookIndex(validSummary)).toThrow(/records/i);
  });
});
