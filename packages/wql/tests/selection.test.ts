import { describe, expect, it } from 'vitest';
import type { AnalyticsDataPoint, EventRecord } from '@bitcobblers/wod-wiki-core';
import { QueryService, type EventStore } from '../src/QueryService';
import { resolveContextualPath, type ContextualAssignment } from '../src/context';

/** A stored summary row (post-V14 shape: calculated, with proof stats). */
function summaryRow(id: string, resultId: string, metricKey: string, value: number, extra: {
  effortSlug?: string; representationKind?: 'direct' | 'calculated'; withoutStats?: boolean;
} = {}): EventRecord {
  return {
    id, resultId, noteId: 'n1', timestamp: 1_700_000_000_000,
    grain: 'summary', outputType: 'analytics', blockId: '', blockVersion: 0,
    ...(extra.representationKind === undefined && extra.withoutStats !== true
      ? { representationKind: 'calculated' as const, reducerStats: { observedCount: 1, sum: value } }
      : {}),
    metrics: [{
      type: metricKey, value,
      metadata: { canonicalKey: metricKey },
    }],
  } as unknown as EventRecord;
}

/** A stored event row (detail observation). */
function detailRow(id: string, resultId: string, metricKey: string, value: number, effortSlug?: string): EventRecord {
  return {
    id, resultId, noteId: 'n1', timestamp: 1_700_000_000_000,
    grain: 'event', outputType: 'segment', blockId: '', blockVersion: 0,
    metrics: [{
      type: metricKey, value,
      ...(effortSlug ? { metadata: { canonicalKey: metricKey, effortSlug } } : { metadata: { canonicalKey: metricKey } }),
    }],
  } as unknown as EventRecord;
}

function store(rows: EventRecord[]): EventStore {
  return {
    getEventsByTimeRange: async () => rows,
    getEventsByResult: async () => [],
    getEventsForNote: async () => [],
    getEventsByContent: async () => [],
    scanAll: async () => rows,
    appendEvents: async () => {},
    finalizeSummaries: async () => {},
    deleteEvents: async () => {},
  };
}

describe('ticket 16 — coverage selection and grain integrity', () => {
  it('a finalized workout’s summary answers the aggregate with no grain filter (acceptance 1, kills 3.2)', async () => {
    const service = new QueryService({ eventStore: store([
      summaryRow('r1:summary:totalVolume', 'r1', 'totalVolume', 200),
    ]) });
    const result = await service.runQuery('sum:totalVolume{}');
    expect(result.scalar).toBe(200);
    expect(result.coverage?.selectedSummaries).toHaveLength(1);
  });

  it('a count-less mean reports insufficient evidence instead of being omitted (acceptance 2)', async () => {
    const service = new QueryService({ eventStore: store([
      summaryRow('r1:summary:speed', 'r1', 'speed', 1, { withoutStats: true }),
      summaryRow('r2:summary:speed', 'r2', 'speed', 2, { withoutStats: true }),
    ]) });
    const result = await service.runQuery('avg:speed{}');
    expect(result.error).toContain('Insufficient evidence');
    const sum = await service.runQuery('sum:speed{}');
    expect(sum.scalar).toBe(3);
  });

  it('two disjoint session-load summaries average to their mean (acceptance 3)', async () => {
    const service = new QueryService({ eventStore: store([
      summaryRow('r1:summary:sessionLoad', 'r1', 'sessionLoad', 200),
      summaryRow('r2:summary:sessionLoad', 'r2', 'sessionLoad', 400),
    ]) });
    const result = await service.runQuery('avg:sessionLoad{}');
    expect(result.scalar).toBe(300);
  });

  it('detail and substitute summaries of one population never both aggregate (kills 3.2)', async () => {
    const service = new QueryService({ eventStore: store([
      detailRow('d1', 'r1', 'distance', 1000),
      detailRow('d2', 'r1', 'distance', 2000),
      summaryRow('r1:summary:distance', 'r1', 'distance', 6000),
    ]) });
    const result = await service.runQuery('sum:distance{}');
    expect(result.scalar).toBe(3000);
    expect(result.coverage?.ignoredDuplicates).toHaveLength(1);
  });

  it('unattributed observations group under the structural unassigned value (acceptance 5, kills 3.5 and 3.8)', async () => {
    const service = new QueryService({ eventStore: store([
      detailRow('r1:distance', 'r1', 'distance', 5, 'running'),
      detailRow('r2:distance', 'r2', 'distance', 3),
    ]) });

    const total = await service.runQuery('sum:distance{}');
    expect(total.scalar).toBe(8);

    const grouped = await service.runQuery('sum:distance{} by {effort}');
    const labels = grouped.series.map((s) => s.label).sort();
    expect(labels).toEqual(['running', 'unassigned']);
    expect(grouped.series.find((s) => s.label === 'unassigned')!.points[0]!.value).toBe(3);
    expect(grouped.series.find((s) => s.label === 'running')!.points[0]!.value).toBe(5);

    const filtered = await service.runQuery('sum:distance{effort:running}');
    expect(filtered.scalar).toBe(5);
  });
});

describe('ticket 16 — contextual metadata precedence (acceptance 9)', () => {
  it('segment overrides workout overrides note overrides effort default; explicit null clears', () => {
    const candidates: ContextualAssignment[] = [
      { source: 'effort', path: 'shoe', value: 'default-shoe' },
      { source: 'note', path: 'shoe', value: null },
      { source: 'workout', path: 'shoe', value: 'workout-shoe' },
      { source: 'segment', path: 'surface', value: 'road' },
    ];
    expect(resolveContextualPath(candidates, 'shoe')).toMatchObject({ value: 'workout-shoe', source: 'workout' });

    const cleared: ContextualAssignment[] = [
      { source: 'effort', path: 'shoe', value: 'default-shoe' },
      { source: 'note', path: 'shoe', value: 'note-shoe' },
      { source: 'segment', path: 'shoe', value: null },
    ];
    const resolved = resolveContextualPath(cleared, 'shoe');
    expect(resolved).toMatchObject({ source: 'segment', cleared: true, value: undefined });
    expect(resolved!.value).toBeUndefined();
  });
});
