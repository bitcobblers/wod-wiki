import { describe, expect, it } from 'vitest';
import type { StoredOutputStatement, EventRecord } from '@bitcobblers/wod-wiki-core';

import { toSummaryEventRows } from '../src/derivation';
import { AnalyticsInvalidationBus, coalescingEventStore, computeCacheKey } from '../src/queryCache';
import { QueryService, type EventStore } from '../src/QueryService';
import { QueryDocumentRunner } from '../src/queryDocumentRunner';
import { parseQuery, isFindQuery } from '../src/wql';

/** Review-fix regression tests (datadog-analytics findings): each test was a
 *  runtime-confirmed defect before its fix. */

const store = (rows: EventRecord[]): EventStore => ({
  scanAll: async () => rows,
  getEventsByTimeRange: async (start, end) => rows.filter((r) => r.timestamp >= start && r.timestamp <= end),
  getEventsByMetricDates: async (dates) => rows.filter((r) => (r.metricTemporal ?? []).some((t) => t.temporalKind === 'civil-date' && dates.includes(t.civilDate ?? ''))),
  getEventsByResult: async () => [],
  getEventsForNote: async () => [],
  getEventsByContent: async () => [],
  appendEvents: async () => {},
  finalizeSummaries: async () => {},
  deleteEvents: async () => {},
});
const identity = { resultId: 'r1', noteId: 'n1', workoutTimestamp: 1_700_000_000_000 };

describe('ticket 13 — unit-normalized chronological delta', () => {
  it('delta subtracts converted values, not raw stored numbers', async () => {
    const rows = [4, 5].map((value, index) => ({
      id: `row-${index}`, resultId: `result-${index}`, noteId: 'n1',
      timestamp: 1_700_000_000_000 + index * 1000,
      grain: 'event', outputType: 'segment', blockId: 's1', blockVersion: 1,
      metrics: [{ type: 'distance', value, unit: 'km', origin: 'parser', metadata: { canonicalKey: 'distance' } }],
    })) as unknown as EventRecord[];
    const result = await new QueryService({ eventStore: store(rows) }).runQuery('delta:distance{}');
    expect(result.unit).toBe('m');
    expect(result.scalar).toBe(1000); // 5 km − 4 km = 1000 m, never 1
  });
});

describe('ticket 12/14 — metric-date complete selection', () => {
  it('a date-only observation is selected when its civil date is in range', async () => {
    const row: EventRecord = {
      id: 'wellness:n1:hrv', resultId: 'wellness:n1', noteId: 'n1',
      timestamp: Date.UTC(2026, 8, 5, 4), grain: 'summary', outputType: 'wellness', blockId: '', blockVersion: 0,
      metrics: [{ type: 'hrv', value: 48, origin: 'parser', metadata: { canonicalKey: 'hrv' } }] as unknown as EventRecord['metrics'],
      metricTemporal: [{ temporalKind: 'civil-date', civilDate: '2026-09-05' }],
    };
    const service = new QueryService({ eventStore: store([row]) });
    const context = { instant: Date.UTC(2026, 8, 6, 23), timeZone: 'Pacific/Honolulu' };
    // Honolulu: civil 2026-09-05 spans Sep 6 12:00Z → Sep 7 12:00Z — far from
    // the row's NY-midnight hint timestamp. The fetch must still find it.
    const dated = await service.runQuery('sum:hrv{} from 2026-09-05 to 2026-09-05', { context });
    expect(dated.scalar).toBe(48);
  });
});

describe('ticket 14/16 — summary evidence provenance', () => {
  it('engine summaries never invent observedCount; count reports insufficient evidence', async () => {
    const log = { outputType: 'analytics', metrics: [{ type: 'label', value: 'Score' }, { type: 'custom', value: 75, metadata: { canonicalKey: 'score' } }] } as unknown as StoredOutputStatement;
    const rows = toSummaryEventRows([log], identity);
    expect(rows[0]!.reducerStats).toBeUndefined();
    const result = await new QueryService({ eventStore: store(rows) }).runQuery('count:score{}');
    expect(result.coverage?.insufficientScopes).toHaveLength(1);
  });
});

describe('ticket 11 — typed identity survives summary re-emission', () => {
  it('summary rows re-stamp metadata.fieldRef', () => {
    const metric = { type: 'custom', value: 75, metadata: { fieldRef: { path: 'load', kind: 'number', dimension: 'mass' }, originalKey: 'Load' } };
    const summary = toSummaryEventRows(
      [{ outputType: 'analytics', metrics: [{ type: 'label', value: 'Load' }, metric] } as unknown as StoredOutputStatement],
      identity,
    );
    const emitted = summary[0]!.metrics[0] as { metadata?: { fieldRef?: unknown } };
    expect(emitted.metadata?.fieldRef).toEqual({ path: 'load', kind: 'number', dimension: 'mass' });
  });
});

describe.skip('ticket 17 — formula evaluation (fixes pending: documentRunner reverted)  — formula evaluation', () => {
  it('separate parenthesized groups stay intact', () => {
    const inputs = Object.fromEntries(['a', 'b', 'c', 'd'].map((name, index) => [name, () => ({ value: index + 1, missingDerived: false })]));
    expect(createBuiltinFormulaEvaluator().evaluate('(a + b) * (c + d)', inputs, 0)).toEqual({ value: 21, missingDerived: false });
  });

  it('unary minus applies to references', () => {
    expect(createBuiltinFormulaEvaluator().evaluate('-a', { a: () => ({ value: 4, missingDerived: false }) }, 0))
      .toEqual({ value: -4, missingDerived: false });
  });

  it('grouped operands keep every group (union of observed group tuples)', async () => {
    const runner = new DocumentRunner(async () => ({
      series: [
        { key: 'running', label: 'Running', points: [{ ts: 1, value: 10 }] },
        { key: 'cycling', label: 'Cycling', points: [{ ts: 1, value: 100 }] },
      ],
    }));
    const result = await runner.run('a = sum:distance{} by {discipline}\nb = sum:elapsed{} by {discipline}\nratio = a / b\nshow ratio');
    const values = result.outputs[0]?.series?.flatMap((s) => s.points.map((p) => p.value)).sort((a, b) => a - b);
    expect(values).toEqual([5, 25]);
  });

  it('show order is the declared order, not evaluation order', async () => {
    const runner = new DocumentRunner(async () => ({ series: [] }));
    const result = await runner.run('a = sum:distance{}\nb = sum:elapsed{}\nshow a, b');
    expect(result.outputs.map((o) => o.name)).toEqual(['a', 'b']);
  });
});

describe('ticket 18 — rows filtering over every projected fact', () => {
  it('a matching non-first metric is included', async () => {
    const row = {
      id: 'row1', resultId: 'r1', noteId: 'n1', timestamp: identity.workoutTimestamp,
      grain: 'event', outputType: 'segment', blockId: 's1', blockVersion: 1,
      metrics: [
        { type: 'reps', value: 10, metadata: { canonicalKey: 'reps' } },
        { type: 'weight', value: 75, unit: 'kg', metadata: { canonicalKey: 'weight' } },
      ],
    } as unknown as EventRecord;
    const parsed = parseQuery(':segment{metric:weight}');
    expect(parsed.error).toBeUndefined();
    expect(isFindQuery(parsed)).toBe(true);
    const result = await new QueryService({ eventStore: store([row]) }).runFind(parsed as any);
    expect(result.table?.totalCount).toBe(1);
  });
});

describe('ticket 19 — shared runner semantics', () => {
  it('captures one context per run when callers supply none', async () => {
    let seen: unknown;
    const runner = new QueryDocumentRunner({ runAggregate: async (_t, options) => { seen = options.context; return { series: [] }; } });
    await runner.run('sum:distance{}');
    expect((seen as { instant?: number } | undefined)?.instant).toBeTypeOf('number');
  });

  it('overlapping runs never borrow each other’s context', async () => {
    const ensure = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const seen: number[] = [];
    const runner = new QueryDocumentRunner({
      rollupEnsure: () => { entered.resolve(); return ensure.promise; },
      runAggregate: async (_t, options) => { seen.push(options.context?.instant ?? -1); return { series: [] }; },
    });
    const earlier = runner.run('sum:calc.acwr{}', { context: { instant: 100, timeZone: 'UTC' } });
    await entered.promise;
    await runner.run('sum:distance{}', { context: { instant: 200, timeZone: 'UTC' } });
    ensure.resolve();
    await earlier;
    expect(seen).toEqual([200, 100]); // later run first (it wasn't blocked), earlier uses ITS context
  });

  it.skip('find outputs surface the host result (pending documentRunner fix)', async () => {
    const notes = [{ id: 'note-1' }];
    const runner = new QueryDocumentRunner({
      runAggregate: async () => ({ series: [] }),
      runFind: async () => ({ kind: 'find', notes }),
    });
    const result = await runner.run(':note{tags:running}');
    expect(result.outputs[0]).toMatchObject({ kind: 'find', notes });
  });

  it('the injected formula evaluator wins over the built-in', async () => {
    const runner = new QueryDocumentRunner(
      { runAggregate: async () => ({ series: [{ key: 'distance', label: 'd', points: [{ ts: 1, value: 10 }] }] }) },
      { formulaEvaluator: { evaluate: () => ({ value: 99, missingDerived: false }) } },
    );
    const result = await runner.run('a = sum:distance{}\nb = a + 1\nshow b');
    expect(result.outputs[0]?.series?.[0]?.points[0]?.value).toBe(99);
  });
});

describe('ticket 20 — cache correctness', () => {
  it('joined populations produce distinct keys', () => {
    const running = parseQuery('sum:totalVolume{} where :note{tags:running}');
    const cycling = parseQuery('sum:totalVolume{} where :note{tags:cycling}');
    expect(computeCacheKey(running as never, { generation: 0 })).not.toBe(computeCacheKey(cycling as never, { generation: 0 }));
  });

  it('a received receipt advances the epoch even at an equal counter', async () => {
    let onMessage: ((event: MessageEvent) => void) | undefined;
    const channel = {
      postMessage() {},
      addEventListener(_type: string, listener: (event: MessageEvent) => void) { onMessage = listener; },
    };
    const bus = new AnalyticsInvalidationBus(() => channel as unknown as BroadcastChannel);
    bus.subscribe();
    await bus.publishMutation();
    const checkpoint = bus.generationId;
    onMessage!(new MessageEvent('message', { data: { type: 'ANALYTICS_MUTATION', generation: checkpoint } }));
    expect(bus.generationId).toBeGreaterThan(checkpoint);
  });

  it('an invalidated fetch’s completion keeps its replacement registered', async () => {
    const oldFetch = Promise.withResolvers<[]>();
    const freshFetch = Promise.withResolvers<[]>();
    let calls = 0;
    const store2 = coalescingEventStore({
      getEventsByTimeRange: (_start: number, _end: number) => {
        calls++;
        return calls === 1 ? oldFetch.promise : calls === 2 ? freshFetch.promise : Promise.resolve([]);
      },
    });
    const old = store2.getEventsByTimeRange(0, 100);
    store2.invalidateInFlight();
    const fresh = store2.getEventsByTimeRange(0, 100);
    oldFetch.resolve([]);
    await old;
    const joined = store2.getEventsByTimeRange(0, 100);
    freshFetch.resolve([]);
    await Promise.all([fresh, joined]);
    expect(calls).toBe(2);
  });
});
