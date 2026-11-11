import { describe, expect, it } from 'vitest';
import {
  computeCatalogDeltas,
  extractContributionsFromResult,
  extractContributionsFromNote,
  fieldSourceId,
} from './fieldCatalog';
import type { FieldContribution, Session, Note } from '@bitcobblers/wod-wiki-core';

function result(logs: unknown[]): Session & { data?: { logs?: unknown } } {
  return {
    id: 'r1',
    noteId: 'n1',
    origin: 'journal',
    startTime: 0,
    endTime: 0,
    duration: 0,
    completed: true,
    createdAt: 0,
    data: { logs },
  };
}

describe('field catalog — contribution extraction (ticket 14)', () => {
  it('extracts typed identities from result logs via fieldRef', () => {
    const contributions = extractContributionsFromResult(result([
      {
        outputType: 'segment',
        metrics: [
          { type: 'custom', value: 48, metadata: { fieldRef: { path: 'hrv', kind: 'number' }, originalKey: 'hrv' } },
          { type: 'custom', value: 'deep', metadata: { fieldRef: { path: 'sleep.quality', kind: 'string' }, originalKey: 'Sleep Quality' } },
        ],
      },
    ]));
    expect(contributions.map((c) => `${c.path}|${c.kind}`).sort()).toEqual(['hrv|number', 'sleep.quality|string']);
    const stringC = contributions.find((c) => c.kind === 'string')!;
    expect(stringC.spelling).toBe('Sleep Quality');
    expect(stringC.value).toBe('deep'); // categorical value recorded
  });

  it('falls back to canonicalKey paths for engine-authored metrics', () => {
    const contributions = extractContributionsFromResult(result([
      { outputType: 'analytics', metrics: [{ type: 'totalVolume', value: 3000, unit: 'kg', metadata: { canonicalKey: 'totalVolume', effortSlug: 'fran' } }] },
    ]));
    expect(contributions).toHaveLength(1);
    expect(contributions[0]!.path).toBe('totalVolume');
    expect(contributions[0]!.unit).toBe('kg');
  });

  it('never invents catalog entries for unkeyed custom metrics', () => {
    const contributions = extractContributionsFromResult(result([
      { outputType: 'segment', metrics: [{ type: 'custom', value: 5 }] },
    ]));
    expect(contributions).toEqual([]);
  });

  it('extracts frontmatter scalars from notes as contributions', () => {
    const note = {
      id: 'n1',
      rawContent: '---\nshoe: Alphafly\ncoach: Perry\ncustom: {nested: true}\n---\n\n# body',
    } as unknown as Note;
    const contributions = extractContributionsFromNote(note);
    expect(contributions.map((c) => c.path).sort()).toEqual(['coach', 'shoe']);
    expect(contributions.find((c) => c.path === 'shoe')!.value).toBe('Alphafly');
  });
});

describe('field catalog — idempotent delta math (ticket 14)', () => {
  const A: FieldContribution = { fieldId: 'f(a)', path: 'a', kind: 'number' };
  const B: FieldContribution = { fieldId: 'f(b)', path: 'b', kind: 'number' };

  it('identical re-save produces no delta', () => {
    const deltas = computeCatalogDeltas([A, B], [B, A]);
    expect(deltas.added).toEqual([]);
    expect(deltas.removed).toEqual([]);
  });

  it('edit computes added and removed sides', () => {
    const deltas = computeCatalogDeltas([A], [B]);
    expect(deltas.added).toEqual([B]);
    expect(deltas.removed).toEqual([A]);
  });

  it('counts multiplicity — two observations of one field vs one', () => {
    const deltas = computeCatalogDeltas([A], [A, A]);
    expect(deltas.added).toHaveLength(1);
    expect(deltas.removed).toEqual([]);
  });

  it('changed unit evidence is a delta', () => {
    const deltas = computeCatalogDeltas(
      [{ fieldId: 'f(w)', path: 'weight', kind: 'number', unit: 'lb', spelling: 'weight' }],
      [{ fieldId: 'f(w)', path: 'weight', kind: 'number', unit: 'kg', spelling: 'weight' }],
    );
    expect(deltas.added).toHaveLength(1);
    expect(deltas.removed).toHaveLength(1);
  });

  it('source ids distinguish entity kind and record', () => {
    expect(fieldSourceId('result', 'r1')).toBe('result:r1');
    expect(fieldSourceId('note', 'r1')).toBe('note:r1');
  });
});

describe('field catalog — atomic StorageService wiring & backfill (Milestone 5)', () => {
  it('updates field_catalog and field_values on note/event writes and prunes at zero on delete', async () => {
    const { InMemoryStorage } = await import('@/services/storage/InMemoryStorage');
    const { StorageService } = await import('@/services/storage/StorageService');
    const { IndexedDbFieldCatalog } = await import('../../../app/services/fieldCatalog');

    const mem = new InMemoryStorage();
    const service = new StorageService(mem);
    const catalog = new IndexedDbFieldCatalog(mem);

    let notifications = 0;
    const unsub = catalog.subscribe(() => {
      notifications += 1;
    });

    await service.saveNoteSource({
      noteId: 'note-cat-1',
      rawContent: '---\ncoach: Greg\nshoe: Metcon\n---\n# Session',
      expectedSourceRevision: 0,
      metadata: { title: 'Session' },
    });

    expect((await catalog.lookup('coach')).map((c) => c.path)).toEqual(['coach']);
    expect((await catalog.listValues('coach', 'gr')).map((v) => v.value)).toEqual(['Greg']);
    expect(notifications).toBeGreaterThanOrEqual(1);

    await service.appendEvents([
      {
        id: 'res-1:0',
        resultId: 'res-1',
        noteId: 'note-cat-1',
        grain: 'event',
        outputType: 'segment',
        timestamp: 1000,
        metrics: [
          {
            type: 'custom' as never,
            value: 52,
            unit: 'ms',
            origin: 'user',
            metadata: { fieldRef: { path: 'hrv', kind: 'number' }, originalKey: 'HRV' },
          },
        ],
      },
    ]);

    const hrvLookup = await catalog.lookup('hrv');
    expect(hrvLookup).toHaveLength(1);
    expect(hrvLookup[0]!.units).toEqual(['ms']);
    expect(hrvLookup[0]!.spellings).toEqual(['HRV']);

    // Deleting event & note prunes catalog entries cleanly back to zero
    await service.deleteEvents(['res-1:0']);
    expect(await catalog.lookup('hrv')).toEqual([]);

    await service.deleteNote('note-cat-1');
    expect(await catalog.lookup('coach')).toEqual([]);
    expect(await catalog.listValues('coach', '')).toEqual([]);

    unsub();
    catalog.dispose();
  });

  it('backfills existing notes and events idempotently via startFieldCatalogBackfill', async () => {
    const { InMemoryStorage } = await import('@/services/storage/InMemoryStorage');
    const { IndexedDbFieldCatalog, startFieldCatalogBackfill } = await import('../../../app/services/fieldCatalog');

    const mem = new InMemoryStorage();
    // Seed raw rows directly (simulating pre-existing DB rows before catalog wiring)
    await mem.readwrite('notes').put({
      id: 'pre-note-1',
      title: 'Morning',
      rawContent: '---\nsleepQuality: Great\n---\n# Morning',
      sourceRevision: 1,
      blocks: {},
      createdAt: 100,
    });
    await mem.readwrite('events').put({
      id: 'pre-res-1:summary:tis',
      resultId: 'pre-res-1',
      noteId: 'pre-note-1',
      grain: 'summary',
      outputType: 'analytics',
      timestamp: 200,
      metrics: [{ type: 'tis' as never, value: 42, origin: 'analyzed', metadata: { canonicalKey: 'tis' } }],
    });

    await startFieldCatalogBackfill(mem);
    // Second run is a no-op because field_catalog_meta is marked complete
    await startFieldCatalogBackfill(mem);

    const catalog = new IndexedDbFieldCatalog(mem);
    expect((await catalog.lookup('sleepQuality')).map((c) => c.path)).toEqual(['sleepQuality']);
    expect((await catalog.listValues('sleepQuality', '')).map((v) => v.value)).toEqual(['Great']);
    expect((await catalog.lookup('tis')).map((c) => c.path)).toEqual(['tis']);
    catalog.dispose();
  });
});
