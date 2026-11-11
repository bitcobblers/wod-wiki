/**
 * WQL-4 — multi-output widget results: `show a, b | :chart{…}` renders
 * EVERY shown series (not just outputs[0]), and the document's chart sink
 * reaches the renderer.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  buildDashboardDocument,
  parseQuery,
  type DocumentResult,
  type DashboardDocument,
  type QueryResult,
} from '@bitcobblers/wod-wiki-wql';
import { DashboardView, QueryBlockView, outputsToRunResult, type QueryExecutor } from '../src';

afterEach(cleanup);

const AGG: QueryResult['parsed'] = {
  family: 'aggregate',
  raw: 'sum:reps{}',
  agg: 'sum',
  metric: 'reps',
  filters: [],
  groupBy: [],
};

function seriesDoc(): DocumentResult {
  return {
    outputs: [
      {
        name: 'kb',
        kind: 'aggregate',
        unit: 'reps',
        series: [{ key: 'kb', label: 'kb', points: [{ ts: 1000, value: 30 }] }],
      },
      {
        name: 'bb',
        kind: 'aggregate',
        unit: 'reps',
        series: [{ key: 'bb', label: 'bb', points: [{ ts: 1000, value: 12 }] }],
      },
    ],
    diagnostics: [],
    showChart: parseQuery(':stacked-bar{unit:reps}').sink,
  };
}

describe('WQL-4 — outputsToRunResult merges every shown output', () => {
  it('merges all shown series instead of dropping outputs after the first', () => {
    const merged = outputsToRunResult(AGG, seriesDoc());
    expect(merged.series?.map((s) => s.label)).toEqual(['kb', 'bb']);
    expect(merged.series?.map((s) => s.points[0]!.value)).toEqual([30, 12]);
  });

  it('carries the document show sink onto the merged result', () => {
    const merged = outputsToRunResult(AGG, seriesDoc());
    expect(merged.chart?.head).toBe('stacked-bar');
  });

  it('surfaces the first output error rather than hiding it behind a healthy sibling', () => {
    const res: DocumentResult = {
      outputs: [
        { name: 'a', kind: 'aggregate', series: [] },
        { name: 'b', kind: 'aggregate', error: 'metric:reps is unknown' },
      ],
      diagnostics: [],
    };
    const merged = outputsToRunResult(AGG, res);
    expect(merged.error).toBe('metric:reps is unknown');
  });
});

describe('WQL-4 — a multi-series document renders every band', () => {
  it('QueryBlockView renders both series of `show kb, bb | :stacked-bar{}`', async () => {
    const executor: QueryExecutor = {
      runQuery: vi.fn(async () => ({ ...AGG } as QueryResult)),
      runFind: vi.fn(async () => ({} as never)),
      runRows: vi.fn(async () => ({} as never)),
      // The document's two aggregate bindings resolve through the pipeline
      // seam — each binding is its own aggregate query.
      runPipeline: vi.fn(async () => ({
        parsed: parseQuery(':sum{metric:reps}'),
        series: [{ key: 'kb', label: 'kb', points: [{ ts: 1000, value: 30 }] }],
        stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
        matched: [],
      })),
    };

    render(
      <QueryBlockView
        query={'kb = sum:reps{}\nbb = sum:tis{}\nshow kb, bb | :stacked-bar{}'}
        executor={executor}
        widgetType="stacked-bar"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('query-block-view')).toBeDefined();
    });
    // Both bindings ran — the document was not truncated to one output.
    await waitFor(() => {
      expect(executor.runQuery).toHaveBeenCalledTimes(2);
    });
  });

  it('DashboardView renders both series of a multi-binding widget', async () => {
    const runQueryMock = vi.fn(async (query: string) => ({
      parsed: AGG,
      series: [{ key: 's', label: 's', points: [{ ts: 1000, value: 30 }] }],
      stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
      matched: [],
      unit: 'reps',
    }));
    const executor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({} as never)),
      runRows: vi.fn(async () => ({} as never)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'kb = sum:reps{}\nbb = sum:tis{}\nshow kb, bb | :stacked-bar{}',
          widgetType: 'stacked-bar',
        },
      ],
      {},
    );

    render(<DashboardView document={doc} executor={executor} />);

    // Both bindings evaluated — the widget kept every shown series.
    await waitFor(() => {
      expect(runQueryMock).toHaveBeenCalledTimes(2);
    });
  });
});
