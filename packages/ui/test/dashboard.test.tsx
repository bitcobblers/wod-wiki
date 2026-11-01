import { describe, expect, it, vi, afterEach   } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildDashboardDocument, type DashboardDocument, type FindQueryResult, type QueryResult, type RowsQueryResult } from '@bitcobblers/wod-wiki-wql';
import {
  DashboardView,
  type QueryExecutor,
} from '../src';

afterEach(cleanup);

function mockQueryResult(raw: string, value = 100): QueryResult {
  return {
    parsed: { family: 'aggregate', raw, agg: 'sum', metric: 'reps', filters: [], groupBy: [] },
    series: [{ key: 'scalar', label: 'reps', points: [{ ts: 1000, value }], unit: 'reps' }],
    stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
    matched: [],
    scalar: value,
    unit: 'reps',
  };
}

describe('DashboardView and useAnalyticsQueries with injected QueryExecutor', () => {
  it('DashboardView renders widgets using injected QueryExecutor without singleton queryService', async () => {
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query, 250));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({} as any)),
      runRows: vi.fn(async () => ({} as any)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'sum:reps{}',
          widgetType: 'value',
        },
      ],
      {},
    );

    render(<DashboardView document={doc} executor={mockExecutor} />);

    await waitFor(() => {
      expect(runQueryMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('250')).toBeDefined();
    });
  });

  it('substitutes token values into widget queries at execution time', async () => {
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query, 300));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({} as any)),
      runRows: vi.fn(async () => ({} as any)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'sum:totalVolume{effort:$exercise}',
          widgetType: 'value',
        },
      ],
      {
        exercise: ['back-squat', 'deadlift'],
      },
    );

    render(
      <DashboardView
        document={doc}
        executor={mockExecutor}
        tokenValues={{ exercise: 'deadlift' }}
      />,
    );

    await waitFor(() => {
      expect(runQueryMock).toHaveBeenCalledWith(
        'sum:totalVolume{effort:deadlift}',
        expect.anything(),
      );
    });
  });

  it('substitutes token values into widget fence-tag attributes', async () => {
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query, 42));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({}) as unknown as FindQueryResult),
      runRows: vi.fn(async () => ({}) as unknown as RowsQueryResult),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'max:calc.e1rm{}',
          widgetType: 'goal-rings',
          attributes: { goal: '$goal' },
        },
      ],
      {
        'dashboard.goal': ['150'],
      },
    );

    render(<DashboardView document={doc} executor={mockExecutor} />);

    await waitFor(() => {
      expect(screen.getByText('Goal: 150 reps')).toBeDefined();
    });
  });

  it('blocks a widget whose attribute references an unknown token', async () => {
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query, 42));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({}) as unknown as FindQueryResult),
      runRows: vi.fn(async () => ({}) as unknown as RowsQueryResult),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'max:calc.e1rm{}',
          widgetType: 'goal-rings',
          attributes: { goal: '$missing' },
        },
      ],
      {},
    );

    render(<DashboardView document={doc} executor={mockExecutor} />);

    await waitFor(() => {
      expect(screen.getByText('unknown token: $missing')).toBeDefined();
    });
    expect(runQueryMock).not.toHaveBeenCalled();
  });

  it('edit mode surfaces the arrangement affordances and reports widget actions to the host', async () => {
    const onEditWidget = vi.fn();
    const onRemoveWidget = vi.fn();
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({}) as unknown as FindQueryResult),
      runRows: vi.fn(async () => ({}) as unknown as RowsQueryResult),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'sum:reps{effort:$exercise}',
          widgetType: 'value',
        },
      ],
      { exercise: ['fran'] },
    );

    render(
      <DashboardView
        document={doc}
        executor={mockExecutor}
        tokenValues={{ exercise: 'fran' }}
        editMode
        onEditWidget={onEditWidget}
        onRemoveWidget={onRemoveWidget}
      />,
    );

    // Card renders the result view; view mode keeps the raw WQL off the card.
    await waitFor(() => expect(screen.getByText('100')).toBeDefined());

    // Edit mode: the toolbar's edit affordance reports the widget identity.
    fireEvent.click(screen.getByRole('button', { name: /Edit widget/ }));
    expect(onEditWidget).toHaveBeenCalledWith(expect.objectContaining({ key: 'w0' }));

    // Remove reports the same identity.
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onRemoveWidget).toHaveBeenCalledWith(expect.objectContaining({ key: 'w0' }));
  });

  it('view mode renders no arrangement chrome; prebuilt sources get an inspect affordance instead', async () => {
    const onInspectWidget = vi.fn();
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({}) as unknown as FindQueryResult),
      runRows: vi.fn(async () => ({}) as unknown as RowsQueryResult),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [
        {
          type: 'query',
          content: 'sum:reps{}',
          widgetType: 'value',
        },
      ],
      {},
    );

    render(
      <DashboardView
        document={doc}
        executor={mockExecutor}
        onInspectWidget={onInspectWidget}
      />,
    );

    await waitFor(() => expect(screen.getByText('100')).toBeDefined());

    // No edit toolbar in view mode…
    expect(screen.queryByRole('button', { name: /Edit widget/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    // …but a read-only source can still inspect the query.
    fireEvent.click(screen.getByRole('button', { name: /Inspect query for/ }));
    expect(onInspectWidget).toHaveBeenCalledWith(expect.objectContaining({ key: 'w0' }));
  });

  it('#1049 — a table widget runs a :segment query and renders rows', async () => {
    const runFindMock = vi.fn(async () => ({
      parsed: { family: 'find', raw: '', target: 'segment', filters: [] },
      notes: [],
      blocks: [],
      stages: { selected: 5, matched: 5 },
      table: {
        columns: [
          { name: 'date', type: 'date' },
          { name: 'elapsed', type: 'number' },
        ],
        rows: [
          { date: '2026-09-01', elapsed: 320 },
          { date: '2026-09-08', elapsed: 300 },
          { date: '2026-09-15', elapsed: 295 },
          { date: '2026-09-22', elapsed: 290 },
          { date: '2026-09-29', elapsed: 285 },
        ],
        totalCount: 5,
      },
    }) as any);
    const mockExecutor: QueryExecutor = {
      runQuery: vi.fn(async (q: string) => mockQueryResult(q, 100)),
      runFind: runFindMock,
      runRows: vi.fn(async () => ({} as any)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [{ type: 'query', content: ':segment{effort:fran} last 26w | select date, elapsed | order by elapsed | limit 5', widgetType: 'table' }],
      {},
    );

    render(<DashboardView document={doc} executor={mockExecutor} />);

    await waitFor(() => expect(runFindMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('tabular-table')).toBeDefined());
    expect(screen.getByText('285')).toBeDefined();
    expect(screen.getByText('320')).toBeDefined();
  });

  it('#1049 — a content query inside a timeseries widget shows an error naming table/list', async () => {
    const mockExecutor: QueryExecutor = {
      runQuery: vi.fn(async (q: string) => mockQueryResult(q, 100)),
      runFind: vi.fn(async () => ({} as never)),
      runRows: vi.fn(async () => ({} as never)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [{ type: 'query', content: ':segment{effort:fran} last 26w', widgetType: 'timeseries' }],
      {},
    );

    render(<DashboardView document={doc} executor={mockExecutor} />);

    await waitFor(() =>
      expect(screen.getByText('content queries return things — use a table or list widget instead')).toBeDefined(),
    );
  });

  it('#1049 — aggregate queries keep rendering unchanged', async () => {
    const runQueryMock = vi.fn(async (query: string) => mockQueryResult(query, 250));
    const mockExecutor: QueryExecutor = {
      runQuery: runQueryMock,
      runFind: vi.fn(async () => ({} as any)),
      runRows: vi.fn(async () => ({} as any)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [{ type: 'query', content: 'sum:reps{}', widgetType: 'value' }],
      {},
    );

    render(<DashboardView document={doc} executor={mockExecutor} />);
    await waitFor(() => expect(screen.getByText('250')).toBeDefined());
  });

  it('renders a content-plane :note query as an interactive table when widgetType is table (or bare ```query)', async () => {
    const runFindMock = vi.fn(async () => ({
      parsed: { family: 'find', raw: ':note{domain:crossfit}', target: 'note', filters: [] },
      notes: [
        { id: 'note-fran', title: 'Fran', type: 'wod', tags: ['benchmark', 'crossfit'], date: '2026-10-15' },
        { id: 'note-cindy', title: 'Cindy', type: 'wod', tags: ['amrap'], date: '2026-10-16' },
      ],
      blocks: [],
      stages: { selected: 2, matched: 2 },
    }) as unknown as FindQueryResult);
    const mockExecutor: QueryExecutor = {
      runQuery: vi.fn(async (q: string) => mockQueryResult(q, 0)),
      runFind: runFindMock,
      runRows: vi.fn(async () => ({} as unknown as RowsQueryResult)),
    };

    const doc: DashboardDocument = buildDashboardDocument(
      [{ type: 'query', content: ':note{domain:crossfit}', widgetType: 'table' }],
      {},
    );

    render(
      <DashboardView
        document={doc}
        executor={mockExecutor}
        noteHref={(item) => `/note/${item.id}`}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('content-records-table')).toBeDefined());
    const franLink = screen.getByText('Fran').closest('a');
    expect(franLink?.getAttribute('href')).toBe('/note/note-fran');
    expect(screen.getByText('#benchmark #crossfit')).toBeDefined();
  });
});
