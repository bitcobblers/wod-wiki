import { describe, expect, it } from 'vitest';
import { parseQuery, isPipelineQuery, type DocumentOutput, type DocumentResult } from '@bitcobblers/wod-wiki-wql';
import { outputsToRunResult } from '../src/widgets/chartData';

describe('WQL-4 outputsToRunResult multi-series merge', () => {
  const parsed = parseQuery('sum:reps{}');
  const out = (name: string, series: DocumentOutput['series'], extra: Partial<DocumentOutput> = {}): DocumentOutput =>
    ({ name, kind: 'aggregate', ...(series ? { series } : {}), ...extra }) as DocumentOutput;
  const kb = out('kb', [{ key: 'reps', label: 'kb', points: [{ ts: 1, value: 30 }] }], { unit: 'reps' });
  const bb = out('bb', [{ key: 'reps', label: 'bb', points: [{ ts: 2, value: 12 }] }], { unit: 'reps' });

  it('merges every shown series instead of dropping outputs after the first', () => {
    const merged = outputsToRunResult(parsed, { outputs: [kb, bb], diagnostics: [] });
    expect(merged.series?.map((s) => s.label)).toEqual(['kb', 'bb']);
    expect(merged.series?.[0]?.points[0]?.value).toBe(30);
    expect(merged.series?.[1]?.points[0]?.value).toBe(12);
  });

  it('prefers the document showChart sink over per-output charts', () => {
    const parsedStacked = parseQuery(':stacked-bar{unit:reps}');
    const sink = isPipelineQuery(parsedStacked) ? parsedStacked.sink : undefined;
    const parsedBar = parseQuery(':bar{}');
    const barSink = isPipelineQuery(parsedBar) ? parsedBar.sink : undefined;
    const withOutputChart = out('kb', kb.series, { chart: barSink });
    const merged = outputsToRunResult(parsed, {
      outputs: [withOutputChart, bb],
      diagnostics: [],
      showChart: sink,
    } as DocumentResult);
    expect(merged.chart).toEqual(sink);

    // Without a document sink, the first per-output chart wins.
    const fallback = outputsToRunResult(parsed, { outputs: [withOutputChart, bb], diagnostics: [] });
    expect(fallback.chart?.head).toBe('bar');
  });

  it('keeps the first defined unit', () => {
    const noUnitFirst = out('kb', kb.series);
    const merged = outputsToRunResult(parsed, { outputs: [noUnitFirst, bb], diagnostics: [] });
    expect(merged.unit).toBe('reps');
  });

  it('surfaces the first error — a failed stage is not swallowed by a healthy sibling', () => {
    const failed = out('kb', undefined, { error: 'kb failed' });
    const merged = outputsToRunResult(parsed, { outputs: [failed, bb], diagnostics: [] });
    expect(merged.error).toBe('kb failed');

    const diagOnly = outputsToRunResult(parsed, { outputs: [bb], diagnostics: ['doc-level problem'] });
    expect(diagOnly.error).toBe('doc-level problem');
  });

  it('merges an empty-output document without crashing, surfacing diagnostics', () => {
    const merged = outputsToRunResult(parsed, { outputs: [], diagnostics: ['nothing parsed'] });
    expect(merged.error).toBe('nothing parsed');
  });

  it('matches outputToRunResult for a single-output document', () => {
    const merged = outputsToRunResult(parsed, { outputs: [kb], diagnostics: [] });
    expect(merged.series).toEqual(kb.series);
    expect(merged.unit).toBe('reps');
  });

  it('acceptance shape: show kb, bb | :stacked-bar{unit:reps} renders both bands under the sink', () => {
    const parsedStacked = parseQuery(':stacked-bar{unit:reps}');
    const sink = isPipelineQuery(parsedStacked) ? parsedStacked.sink : undefined;
    const merged = outputsToRunResult(parsed, { outputs: [kb, bb], diagnostics: [], showChart: sink } as DocumentResult);
    expect(merged.series).toHaveLength(2);
    expect(merged.chart?.head).toBe('stacked-bar');
    expect(merged.unit).toBe('reps');
    expect(merged.error).toBeUndefined();
  });
});
