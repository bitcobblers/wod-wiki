import { describe, expect, it } from 'vitest';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import { parseDocument, serializeDocument } from '../src/document';
import { QueryDocumentRunner } from '../src/documentRunner';
import { parseQuery, isPipelineQuery } from '../src/wql';

describe('WQL-3 named list pipes — parse', () => {
  it('parses `<ident> | <pipeline>` into sourceRef + transformsText', () => {
    const text = [
      'bench = :journal{note:note-1}',
      'kb = bench | :sum{metric:reps, equipment:kettlebell}',
      'show kb',
    ].join('\n');
    const { doc, diagnostics } = parseDocument(text);
    expect(diagnostics).toEqual([]);
    const bench = doc.assignments.find((a) => a.name === 'bench')!;
    const kb = doc.assignments.find((a) => a.name === 'kb')!;
    expect(bench.kind).toBe('query');
    expect(kb.kind).toBe('query');
    expect(kb.sourceRef).toBe('bench');
    expect(kb.transformsText).toBe(':sum{metric:reps, equipment:kettlebell}');
  });

  it('keeps colon-head pipelines parsing as plain query assignments', () => {
    const { doc, diagnostics } = parseDocument('y = :journal{} | :sum{metric:tis}\nshow y');
    expect(diagnostics).toEqual([]);
    expect(doc.assignments[0]!.kind).toBe('query');
    expect(doc.assignments[0]!.sourceRef).toBeUndefined();
  });

  it('still reports formulas referencing unknown names', () => {
    const { diagnostics } = parseDocument('x = a + b\nshow x');
    expect(diagnostics.join(' ')).toContain('unknown name');
  });
});

describe('WQL-3 show sink — parse + serialization round-trip', () => {
  const parsedSink = parseQuery(':stacked-bar{unit:reps}');
  const SINK = isPipelineQuery(parsedSink) ? parsedSink.sink : undefined;

  it('splits `show a, b | :chart{}` into names + showChart', () => {
    const { doc, diagnostics } = parseDocument('a = sum:reps{}\nb = sum:tis{}\nshow a, b | :stacked-bar{unit:reps}');
    expect(diagnostics).toEqual([]);
    expect(doc.show).toEqual(['a', 'b']);
    expect(doc.showChart).toEqual(SINK);
  });

  it('leaves a bare show list without a chart', () => {
    const { doc } = parseDocument('a = sum:reps{}\nshow a');
    expect(doc.show).toEqual(['a']);
    expect(doc.showChart).toBeUndefined();
  });

  it('round-trips parse → serialize → parse losslessly (names, sourceRef, showChart)', () => {
    const text = [
      'bench = :journal{note:note-1}',
      'kb = bench | :sum{metric:reps, equipment:kettlebell}',
      'bb = bench | :sum{metric:reps, equipment:barbell}',
      'show kb, bb | :stacked-bar{unit:reps}',
    ].join('\n');
    const once = parseDocument(text);
    expect(once.diagnostics).toEqual([]);
    const again = parseDocument(serializeDocument(once.doc));
    expect(again.diagnostics).toEqual([]);
    expect(serializeDocument(again.doc)).toBe(serializeDocument(once.doc));
    expect(again.doc.show).toEqual(once.doc.show);
    expect(again.doc.showChart).toEqual(once.doc.showChart);
    for (const name of ['bench', 'kb', 'bb']) {
      const a = once.doc.assignments.find((x) => x.name === name)!;
      const b = again.doc.assignments.find((x) => x.name === name)!;
      expect(b.kind).toBe(a.kind);
      expect(b.sourceRef).toBe(a.sourceRef);
      expect(b.transformsText).toBe(a.transformsText);
    }
  });
});

describe('WQL-3 runner — shared source DAG', () => {
  const repsEvent = (value: number, equipment: string): EventRecord => ({
    id: `ev-${equipment}`,
    resultId: 'res-1',
    noteId: 'note-1',
    grain: 'event',
    outputType: 'segment',
    blockId: 'b1',
    blockVersion: 1,
    timestamp: 1_700_000_000_000,
    representationKind: 'calculated',
    metrics: [{ type: 'reps', value, metadata: { canonicalKey: 'reps', groupTags: { equipment } } }],
  } as unknown as EventRecord);

  it('executes runFind once, reuses the cached event array, and attaches the show sink', async () => {
    const EVENTS: EventRecord[] = [repsEvent(30, 'kettlebell'), repsEvent(12, 'barbell')];
    let findCalls = 0;
    const aggCalls: Array<{ text: string; events: readonly EventRecord[] }> = [];
    const runner = new QueryDocumentRunner(
      async () => ({ series: [] }),
      {
        runFind: async () => {
          findCalls += 1;
          return { notes: [], events: EVENTS };
        },
        runAggregateEvents: async (text: string, events: readonly EventRecord[]) => {
          aggCalls.push({ text, events });
          const equipment = /equipment:([\w-]+)/.exec(text)?.[1];
          let sum = 0;
          for (const e of events) {
            for (const m of e.metrics ?? []) {
              if (typeof m === 'object' && m !== null && 'type' in m && m.type === 'reps' && 'value' in m && typeof m.value === 'number') {
                const meta = 'metadata' in m && typeof m.metadata === 'object' && m.metadata !== null ? m.metadata as Record<string, unknown> : undefined;
                const gt = meta && typeof meta.groupTags === 'object' && meta.groupTags !== null ? meta.groupTags as Record<string, unknown> : undefined;
                if (gt?.equipment === equipment) sum += m.value;
              }
            }
          }
          return { series: [{ key: 'reps', label: 'reps', points: [{ ts: 1_700_000_000_000, value: sum }] }], unit: 'reps' };
        },
      },
    );
    const text = [
      'bench = :journal{note:note-1}',
      'kb = bench | :sum{metric:reps, equipment:kettlebell}',
      'bb = bench | :sum{metric:reps, equipment:barbell}',
      'show kb, bb | :stacked-bar{unit:reps}',
    ].join('\n');
    const result = await runner.run(text);
    expect(result.diagnostics).toEqual([]);
    expect(findCalls).toBe(1);
    expect(aggCalls).toHaveLength(2);
    expect(aggCalls[0]!.events).toBe(EVENTS);
    expect(aggCalls[1]!.events).toBe(EVENTS);
    const kb = result.outputs.find((o) => o.name === 'kb');
    const bb = result.outputs.find((o) => o.name === 'bb');
    expect(kb?.series?.[0]?.points[0]?.value).toBe(30);
    expect(bb?.series?.[0]?.points[0]?.value).toBe(12);
    expect(result.showChart?.head).toBe('stacked-bar');
  });
});

describe('WQL-3 runner — scalar-to-series broadcast', () => {
  it('broadcasts a single-point scalar across every bucket of the series', async () => {
    const runner = new QueryDocumentRunner(async (queryText: string) => {
      if (queryText.includes('by {week}')) {
        return {
          series: [{ key: 'reps', label: 'reps', points: [{ ts: 1, value: 10 }, { ts: 2, value: 20 }, { ts: 3, value: 30 }] }],
          unit: 'reps',
        };
      }
      return { series: [{ key: 'reps', label: 'reps', points: [{ ts: 999, value: 100 }] }], unit: 'reps' };
    });
    const text = [
      'weekly = sum:reps{} by {week}',
      'best = sum:reps{}',
      'pct = (weekly / best) * 100 -> %',
      'show pct',
    ].join('\n');
    const result = await runner.run(text);
    expect(result.diagnostics).toEqual([]);
    const pct = result.outputs.find((o) => o.name === 'pct');
    expect(pct?.series?.[0]?.points.map((p) => p.ts)).toEqual([1, 2, 3]);
    expect(pct?.series?.[0]?.points.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(pct?.series?.[0]!.points.some((p) => p.ts === 999)).toBe(false);
    expect(pct?.unit).toBe('%');
  });

  it('broadcasts a scalar even when its timestamp overlaps a series bucket', async () => {
    const runner = new QueryDocumentRunner(async (queryText: string) => {
      if (queryText.includes('by {week}')) {
        return {
          series: [{ key: 'reps', label: 'reps', points: [{ ts: 1000, value: 20 }, { ts: 2000, value: 40 }] }],
          unit: 'reps',
        };
      }
      return { series: [{ key: 'reps', label: 'reps', points: [{ ts: 1000, value: 10 }] }], unit: 'reps' };
    });
    const text = [
      'weekly = sum:reps{} by {week}',
      'baseline = sum:reps{}',
      'pct = (weekly / baseline) * 100 -> %',
      'show pct',
    ].join('\n');
    const result = await runner.run(text);
    expect(result.diagnostics).toEqual([]);
    const pct = result.outputs.find((o) => o.name === 'pct');
    expect(pct?.error).toBeUndefined();
    expect(pct?.series?.[0]!.points.map((p) => p.ts)).toEqual([1000, 2000]);
    expect(pct?.series?.[0]!.points.map((p) => p.value)).toEqual([200, 400]);
  });

  it('treats a grouped one-point series as a series, never as a broadcast scalar', async () => {
    const runner = new QueryDocumentRunner(async (queryText: string) => {
      if (queryText.includes('by {week}')) {
        return { series: [{ key: 'reps', label: 'reps', points: [{ ts: 2000, value: 10 }] }], unit: 'reps' };
      }
      return { series: [{ key: 'reps', label: 'reps', points: [{ ts: 1000, value: 5 }] }], unit: 'reps' };
    });
    const text = [
      'grouped = sum:reps{} by {week}',
      'scalar = sum:reps{}',
      'ratio = scalar * grouped',
      'show ratio',
    ].join('\n');
    const result = await runner.run(text);
    expect(result.diagnostics).toEqual([]);
    const ratio = result.outputs.find((o) => o.name === 'ratio');
    expect(ratio?.error).toBeUndefined();
    // The grouped series anchors the domain (ts 2000); the scalar broadcasts.
    expect(ratio?.series?.[0]!.points).toEqual([{ ts: 2000, value: 50 }]);
  });
});
