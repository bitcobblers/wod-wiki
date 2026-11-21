import { describe, expect, it, vi, afterEach   } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { QueryBlockView, type QueryExecutor } from '../src';

afterEach(cleanup);

function mockScalarResult(raw: string, value = 42): QueryResult {
  return {
    parsed: { family: 'aggregate', raw, agg: 'sum', metric: 'reps', filters: [], groupBy: [] },
    series: [{ key: 'scalar', label: 'reps', points: [{ ts: 1000, value }], unit: 'reps' }],
    stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
    matched: [],
    scalar: value,
    unit: 'reps',
  };
}

describe('QueryBlockView with injected QueryExecutor and onResultSaved', () => {
  it('executes scalar query via injected QueryExecutor and renders result', async () => {
    const runQuery = vi.fn(async (q: string) => mockScalarResult(q, 84));
    const executor: QueryExecutor = {
      runQuery,
      runFind: vi.fn(async () => ({} as any)),
      runRows: vi.fn(async () => ({} as any)),
    };

    render(<QueryBlockView query="sum:reps{}" executor={executor} />);

    await waitFor(() => {
      expect(runQuery).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('84')).toBeDefined();
    });
  });

  it('invokes the optional dashboard action', () => {
    const onAddToDashboard = vi.fn();
    render(<QueryBlockView query="sum:reps{}" onAddToDashboard={onAddToDashboard} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));

    expect(onAddToDashboard).toHaveBeenCalledTimes(1);
  });

  it('subscribes to onResultSaved callback prop for refresh notifications', async () => {
    let savedCallback: (() => void) | undefined;
    const onResultSaved = vi.fn((cb: () => void) => {
      savedCallback = cb;
      return () => {
        savedCallback = undefined;
      };
    });

    const runQuery = vi.fn(async (q: string) => mockScalarResult(q, 10));
    const executor: QueryExecutor = {
      runQuery,
      runFind: vi.fn(async () => ({} as any)),
      runRows: vi.fn(async () => ({} as any)),
    };

    render(
      <QueryBlockView
        query="sum:reps{}"
        executor={executor}
        onResultSaved={onResultSaved}
      />,
    );

    expect(onResultSaved).toHaveBeenCalled();
    expect(savedCallback).toBeDefined();
  });

  it('renders :note results as interactive links with noteHref and onOpenNote', async () => {
    const onOpenNote = vi.fn();
    const noteHref = vi.fn((note: { id: string }) => `/note/${note.id}`);
    const executor: QueryExecutor = {
      runQuery: vi.fn(async () => ({} as never)),
      runFind: vi.fn(async () => ({
        parsed: { family: 'find', raw: ':note', target: 'note', filters: [] },
        notes: [{ id: 'note-1', title: 'Fran Benchmark' }],
        blocks: [],
        stages: { selected: 1, matched: 1 },
      } as never)),
      runRows: vi.fn(async () => ({} as never)),
    };

    render(
      <QueryBlockView
        query=":note"
        executor={executor}
        onOpenNote={onOpenNote}
        noteHref={noteHref}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Fran Benchmark')).toBeDefined();
    });

    const link = screen.getByText('Fran Benchmark').closest('a');
    expect(link).toBeDefined();
    expect(link?.getAttribute('href')).toBe('/note/note-1');
  });

  it('evaluates multi-line Query Documents with defaults and formulas through SharedQueryDocumentRunner', async () => {
    const runQuery = vi.fn(async (q: string) => {
      if (q.startsWith('sum:tis')) return mockScalarResult(q, 200);
      return mockScalarResult(q, 50);
    });
    const executor: QueryExecutor = {
      runQuery,
      runFind: vi.fn(async () => ({} as never)),
      runRows: vi.fn(async () => ({} as never)),
    };

    const docQuery = [
      'defaults last 4w',
      'work = sum:tis{}',
      'load = sum:sessionLoad{}',
      'ratio = work / load',
      'show ratio',
    ].join('\n');

    render(<QueryBlockView query={docQuery} widgetType="value" executor={executor} />);

    await waitFor(() => {
      expect(screen.getByText('4')).toBeDefined();
    });
  });

  it('reserves realistic loading height and preserves previous rendered result while recalculating', async () => {
    // Chart placeholder reserves 220px height on initial load before settling.
    const pendingChartExecutor: QueryExecutor = {
      runQuery: vi.fn(() => new Promise<QueryResult>(() => {})),
      runFind: vi.fn(async () => ({} as never)),
      runRows: vi.fn(async () => ({} as never)),
    };
    const chartRender = render(
      <QueryBlockView query="sum:reps{}" widgetType="timeseries" executor={pendingChartExecutor} />,
    );
    expect(chartRender.container.querySelector('.min-h-\\[220px\\]')).not.toBeNull();
    chartRender.unmount();

    let resolveNext: ((res: QueryResult) => void) | undefined;
    let callCount = 0;
    const runQuery = vi.fn((q: string) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(mockScalarResult(q, 42));
      }
      return new Promise<QueryResult>((resolve) => {
        resolveNext = resolve;
      });
    });
    const executor: QueryExecutor = {
      runQuery,
      runFind: vi.fn(async () => ({} as never)),
      runRows: vi.fn(async () => ({} as never)),
    };

    const { rerender, container } = render(
      <QueryBlockView query="sum:reps{}" widgetType="value" executor={executor} />,
    );

    // Initial KPI loading state reserves 64px height rather than collapsing.
    expect(container.querySelector('.min-h-\\[64px\\]')).not.toBeNull();

    // First scalar settles.
    await waitFor(() => {
      expect(screen.getByText('42')).toBeDefined();
    });

    // Trigger recalculation with an updated query that stays pending.
    rerender(<QueryBlockView query="sum:reps{effort:squat}" widgetType="value" executor={executor} />);

    // Previous result remains visible; no Loading… flash occurs while pending.
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.queryByText('Loading…')).toBeNull();
    const busyEl = container.querySelector('[data-recalculating="true"]');
    expect(busyEl).not.toBeNull();
    expect(busyEl?.getAttribute('aria-busy')).toBe('true');

    // Complete pending execution -> swaps cleanly to updated result and clears busy state.
    resolveNext?.(mockScalarResult('sum:reps{effort:squat}', 99));
    await waitFor(() => {
      expect(screen.getByText('99')).toBeDefined();
    });
    expect(container.querySelector('[data-recalculating="true"]')).toBeNull();
  });
});
