import { describe, expect, it } from 'vitest';
import type { EventRecord, Note } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { QueryService, type EventStore, type NoteQueryStore } from '../src/QueryService';
import { parseQuery } from '../src/wql';
import { parseQueryBlock, serializeQueryBlock } from '../src/queryBlockCodec';
import { buildWorkoutDashboardScaffold } from '../src/dashboard/scaffold';
import { buildDashboardDocument } from '../src/dashboard/model';
import { parseDashboardNote } from '../src/dashboard/parser';
import { resolveOutputUnit } from '../src/units';
import { resolveQueryExecutionScope } from '../src/entityScope';

const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const DAY = 86_400_000;

function makeSegment(id: string, opts: {
  resultId: string;
  noteId: string;
  blockContentId: string;
  effortSlug: string;
  reps?: number;
  resistance?: number;
  unit?: string;
  round?: number;
  elapsedMs?: number;
  timestamp?: number;
  origin?: 'parser' | 'runtime' | 'user';
  sourceBlockKey?: string;
}): EventRecord {
  const started = opts.timestamp ?? T0;
  const ended = started + (opts.elapsedMs ?? 45_000);
  const metrics: EventRecord['metrics'] = [
    { type: MetricType.Effort, value: opts.effortSlug, origin: 'parser', metadata: { effortSlug: opts.effortSlug } },
  ];
  if (opts.reps !== undefined) {
    metrics.push({ type: MetricType.Rep, value: opts.reps, unit: 'reps', origin: opts.origin ?? 'runtime', metadata: { canonicalKey: 'reps' } });
  }
  if (opts.resistance !== undefined) {
    metrics.push({ type: MetricType.Resistance, value: opts.resistance, unit: opts.unit ?? 'lb', origin: opts.origin ?? 'runtime', metadata: { canonicalKey: 'resistance' } });
  }
  if (opts.round !== undefined) {
    metrics.push({ type: 'current-round' as MetricType, value: opts.round, origin: 'runtime', metadata: { canonicalKey: 'currentRound' } });
  }
  return {
    id,
    resultId: opts.resultId,
    noteId: opts.noteId,
    blockId: 'wod-1',
    blockVersion: 1,
    blockContentId: opts.blockContentId,
    timestamp: started,
    grain: 'event',
    outputType: 'segment',
    effortSlug: opts.effortSlug,
    sourceBlockKey: opts.sourceBlockKey ?? id,
    sourceStatementId: 1,
    stackLevel: 1,
    line: 3,
    timeSpan: { started, ended },
    origin: opts.origin ?? 'runtime',
    metrics,
  } as unknown as EventRecord;
}

function makeSummary(id: string, opts: {
  resultId: string;
  noteId: string;
  blockContentId: string;
  metricKey: string;
  value: number;
  unit?: string;
  timestamp?: number;
}): EventRecord {
  return {
    id,
    resultId: opts.resultId,
    noteId: opts.noteId,
    blockId: 'wod-1',
    blockVersion: 1,
    blockContentId: opts.blockContentId,
    timestamp: opts.timestamp ?? T0,
    grain: 'summary',
    outputType: 'analytics',
    representationKind: 'calculated',
    reducerStats: { observedCount: 1 },
    metrics: [{ type: opts.metricKey as MetricType, value: opts.value, ...(opts.unit ? { unit: opts.unit } : {}), metadata: { canonicalKey: opts.metricKey } }],
  } as unknown as EventRecord;
}

function makeStores(events: EventRecord[], notes: Note[]): { eventStore: EventStore; noteStore: NoteQueryStore } {
  return {
    eventStore: {
      scanAll: async () => events,
      getEventsByTimeRange: async (start, end) => events.filter((e) => e.timestamp >= start && e.timestamp <= end),
      getEventsByResult: async (id) => events.filter((e) => e.resultId === id),
      getEventsForNote: async (id) => events.filter((e) => e.noteId === id),
      getEventsByContent: async (cid) => events.filter((e) => e.blockContentId === cid),
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    },
    noteStore: {
      getAllNotes: async () => notes,
      getNotesByIds: async (ids) => notes.filter((n) => ids.includes(n.id)),
      getNoteIdsForTag: async () => new Set<string>(),
      getNoteTagLabels: async () => [],
    },
  };
}

describe('WQL 8 Results Critique Extensions', () => {
  const notes: Note[] = [
    { id: 'note-bench', title: 'Fran Benchmark', createdAt: T0, type: 'note', rawContent: '', sourceRevision: 1, blocks: {}, notebookId: 'notebook/benchmarks', seedOrigin: 'user' },
    { id: 'note-strength', title: 'Squat Day', createdAt: T0 - DAY, type: 'note', rawContent: '', sourceRevision: 1, blocks: {}, notebookId: 'notebook/strength', seedOrigin: 'user' },
  ];

  const events: EventRecord[] = [
    makeSegment('r1:s1', { resultId: 'res-fran-1', noteId: 'note-bench', blockContentId: 'blk-fran', effortSlug: 'thruster', reps: 21, resistance: 95, round: 1, elapsedMs: 42_000, timestamp: T0 }),
    makeSegment('r1:s2', { resultId: 'res-fran-1', noteId: 'note-bench', blockContentId: 'blk-fran', effortSlug: 'pull-up', reps: 21, round: 1, elapsedMs: 36_000, timestamp: T0 + 42_000 }),
    makeSummary('r1:sum:vol', { resultId: 'res-fran-1', noteId: 'note-bench', blockContentId: 'blk-fran', metricKey: 'totalVolume', value: 1995, unit: 'lb', timestamp: T0 }),
    makeSummary('r1:sum:tis', { resultId: 'res-fran-1', noteId: 'note-bench', blockContentId: 'blk-fran', metricKey: 'tis', value: 78, unit: 'pts', timestamp: T0 }),
    makeSegment('r0:s1', { resultId: 'res-fran-0', noteId: 'note-bench', blockContentId: 'blk-fran', effortSlug: 'thruster', reps: 21, resistance: 95, round: 1, elapsedMs: 50_000, timestamp: T0 - 7 * DAY }),
    makeSegment('r0:s2', { resultId: 'res-fran-0', noteId: 'note-bench', blockContentId: 'blk-fran', effortSlug: 'pull-up', reps: 15, round: 2, elapsedMs: 40_000, timestamp: T0 - 7 * DAY + 50_000 }),
    makeSummary('r0:sum:vol', { resultId: 'res-fran-0', noteId: 'note-bench', blockContentId: 'blk-fran', metricKey: 'totalVolume', value: 1995, unit: 'lb', timestamp: T0 - 7 * DAY }),
    makeSegment('sq:s1', { resultId: 'res-squat-1', noteId: 'note-strength', blockContentId: 'blk-squat', effortSlug: 'back-squat', reps: 5, resistance: 225, round: 1, elapsedMs: 60_000, timestamp: T0 - DAY }),
    makeSummary('sq:sum:vol', { resultId: 'res-squat-1', noteId: 'note-strength', blockContentId: 'blk-squat', metricKey: 'totalVolume', value: 1125, unit: 'lb', timestamp: T0 - DAY }),
  ];

  it('1. filters and groups aggregates, sessions, and segments by notebook:', async () => {
    const service = new QueryService(makeStores(events, notes));

    const agg = await service.runQuery('sum:totalVolume{notebook:benchmarks} in lb');
    expect(agg.error).toBeUndefined();
    expect(agg.scalar).toBeCloseTo(3990, 1);

    const grouped = await service.runQuery('sum:totalVolume{} by {notebook} in lb');
    const byNb = new Map(grouped.series.map((s) => [s.label, s.points[0]?.value]));
    expect(byNb.get('benchmarks')).toBeCloseTo(3990, 1);
    expect(byNb.get('strength')).toBeCloseTo(1125, 1);

    const sessions = await service.runFind(parseQuery(':session{notebook:strength}') as Parameters<typeof service.runFind>[0]);
    expect(sessions.runs?.map((r) => r.resultId)).toEqual(['res-squat-1']);
  });

  it('2. excludes sessions & rows cleanly with negated scope filters (!result:, !block:, !note:)', async () => {
    const service = new QueryService(makeStores(events, notes));
    const parsed = parseQuery(':session{block:blk-fran, !result:res-fran-1}');
    expect(parsed.advisories ?? []).toEqual([]);
    const res = await service.runFind(parsed as Parameters<typeof service.runFind>[0]);
    expect(res.runs?.map((r) => r.resultId)).toEqual(['res-fran-0']);

    const tableRes = await service.runFind(parseQuery(':segment{block:blk-fran, !result:res-fran-0}') as Parameters<typeof service.runFind>[0]);
    expect(tableRes.table?.rows.every((r) => r.__resultId === 'res-fran-1')).toBe(true);
  });

  it('3. projects spreadsheet columns (elapsed, offset, round, split, origin, notebook, noteTitle) and edit provenance in runFindTable', async () => {
    const service = new QueryService(makeStores(events, notes));
    const q = ':segment{result:res-fran-1} | select split, effort, reps, resistance, elapsed, offset, origin, noteTitle, notebook';
    const res = await service.runFind(parseQuery(q) as Parameters<typeof service.runFind>[0]);
    const rows = res.table?.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      split: 1,
      effort: 'thruster',
      reps: 21,
      resistance: 95,
      elapsed: 42_000,
      offset: 0,
      origin: 'runtime',
      noteTitle: 'Fran Benchmark',
      notebook: 'notebook/benchmarks',
      __resultId: 'res-fran-1',
      __sourceBlockKey: 'r1:s1',
    });
    expect(rows[1]).toMatchObject({
      split: 2,
      offset: 42_000,
    });
  });

  it('4. aligns cross-run splits ordinally via by {split, session} and emits human-readable session labels', async () => {
    const service = new QueryService(makeStores(events, notes));
    const res = await service.runQuery('sum:reps{block:blk-fran} by {split, session}');
    expect(res.series).toHaveLength(2);
    expect(res.series[0]?.axisKind).toBe('ordinal');
    expect(res.series[0]?.axisDimension).toBe('split');
    expect(res.series[0]?.label).toContain('Fran Benchmark');
    expect(res.series[0]?.label).not.toContain('res-fran-');
    expect(res.series[0]?.points.map((p) => p.label)).toEqual(['Split 1', 'Split 2']);
  });

  it('5 & 6. supports contextual @block/@notebook datasets and where :session{...} joins', async () => {
    const service = new QueryService(makeStores(events, notes));
    const joined = await service.runQuery('sum:totalVolume{} in lb where :session{block:blk-fran, !result:res-fran-0}');
    expect(joined.error).toBeUndefined();
    expect(joined.unit).toBe('lb');
    expect(joined.scalar).toBeCloseTo(1995, 1);

    const scope = resolveQueryExecutionScope({
      noteId: 'note-bench',
      resultId: 'res-fran-1',
      sessionEvents: events.filter((e) => e.resultId === 'res-fran-1'),
      blockContentId: 'blk-fran',
      blockEvents: events.filter((e) => e.blockContentId === 'blk-fran'),
      notebookSlug: 'benchmarks',
      notebookEvents: events.filter((e) => e.noteId === 'note-bench'),
    });
    expect(scope.tokens.result).toBe('res-fran-1');
    expect(scope.tokens.block).toBe('blk-fran');
    expect(scope.tokens.notebook).toBe('benchmarks');
    expect(scope.pageSources.has('@session')).toBe(true);
    expect(scope.pageSources.has('@block')).toBe(true);
    expect(scope.pageSources.has('@notebook')).toBe(true);
  });

  it('7. preserves named ratio/count scales and prevents cross-dimension unit leakage', async () => {
    const service = new QueryService(makeStores(events, notes));
    const tisRes = await service.runQuery('sum:tis{}', { preferredUnit: 'lb' });
    expect(tisRes.unit).toBe('pts');

    const volRes = await service.runQuery('sum:totalVolume{notebook:benchmarks}', { preferredUnit: 'lb' });
    expect(volRes.unit).toBe('lb');
    expect(volRes.scalar).toBeCloseTo(3990, 1);

    expect(resolveOutputUnit([{ }], { directive: 'kg', metric: 'reps' }).error).toContain('not compatible');
    expect(resolveOutputUnit([{ unit: 'au' }], { preferred: 'kg' })).toEqual({ unit: 'au', convert: false });
    expect(resolveOutputUnit([{ unit: '%' }], { preferred: 'kg' })).toEqual({ unit: '%', convert: false });
  });

  it('8. computes RowsRun.summary, supports view: summary codec, and scaffolds 4-widget workout dashboards', async () => {
    const service = new QueryService(makeStores(events, notes));
    const res = await service.runFind(parseQuery(':session{result:res-fran-1}') as Parameters<typeof service.runFind>[0]);
    const run = res.runs?.[0];
    expect(run?.summary).toBeDefined();
    expect(run?.summary?.totalReps).toBe(42);
    expect(run?.summary?.totalVolume).toBe(1995);
    expect(run?.summary?.tis).toBe(78);
    expect(run?.summary?.splitCount).toBe(2);
    expect(run?.summary?.movementRollup.map((m) => m.effortSlug)).toEqual(['thruster', 'pull-up']);

    const yamlBlock = parseQueryBlock('view: summary\nquery: :session{result:res-fran-1}');
    expect(yamlBlock.view).toBe('summary');
    expect(yamlBlock.rawViewType).toBeUndefined();
    expect(serializeQueryBlock(yamlBlock)).toContain('view: summary');

    const legacyBlock = parseQueryBlock(':session{result:res-fran-1}');
    expect(legacyBlock.view).toBe('table');

    const md = buildWorkoutDashboardScaffold({
      title: 'Fran Progress',
      resultId: 'res-fran-1',
      blockContentId: 'blk-fran',
      notebookSlug: 'benchmarks',
      metric: 'totalVolume',
    });
    const { meta, sections } = parseDashboardNote(md);
    const doc = buildDashboardDocument(sections, meta);
    expect(doc.widgets).toHaveLength(4);
    expect(doc.widgets[0]?.type).toBe('summary');
  });
});
