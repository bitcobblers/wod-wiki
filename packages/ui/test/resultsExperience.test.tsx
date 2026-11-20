import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseQueryBlock, type QueryResult, type RowsRun } from '@bitcobblers/wod-wiki-wql';
import {
  PRBadge,
  QueryBlockView,
  ResultsSpreadsheetGrid,
  SessionSummaryCard,
  WidgetChart,
  promoteFindToChartObject,
  type QueryExecutor,
} from '../src';

afterEach(cleanup);

function makeSampleRun(overrides: Partial<RowsRun> = {}): RowsRun {
  return {
    resultId: 'res-fran-1',
    noteId: 'note-fran',
    timestamp: 1_735_689_600_000,
    durationMs: 185_000,
    events: [
      {
        id: 'ev-1',
        resultId: 'res-fran-1',
        noteId: 'note-fran',
        timestamp: 1_735_689_600_000,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'thruster',
        blockContentId: 'blk-fran',
        sourceBlockKey: 'seg-thruster-1',
        sourceStatementId: 1,
        stackLevel: 1,
        timeSpan: { started: 1_735_689_600_000, ended: 1_735_689_660_000 },
        metrics: [
          { type: 'effort', value: 'thruster', image: 'Thruster', origin: 'parser', metadata: { effortSlug: 'thruster' } },
          { type: 'rep', value: 21, unit: 'reps', origin: 'user', image: '21', metadata: { canonicalKey: 'reps' } },
          { type: 'resistance', value: 45, unit: 'kg', origin: 'parser', image: '45 kg', metadata: { canonicalKey: 'resistance' } },
          { type: 'calc.e1rm', value: 76.5, unit: 'kg', origin: 'analyzed', metadata: { canonicalKey: 'calc.e1rm' } },
          { type: 'rounds', value: 1, origin: 'runtime', metadata: { canonicalKey: 'rounds' } },
        ],
      },
      {
        id: 'ev-2',
        resultId: 'res-fran-1',
        noteId: 'note-fran',
        timestamp: 1_735_689_660_000,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'pull-up',
        blockContentId: 'blk-fran',
        sourceBlockKey: 'seg-pullup-1',
        sourceStatementId: 2,
        stackLevel: 1,
        timeSpan: { started: 1_735_689_660_000, ended: 1_735_689_715_000 },
        metrics: [
          { type: 'effort', value: 'pull-up', image: 'Pull-Up', origin: 'parser', metadata: { effortSlug: 'pull-up' } },
          { type: 'rep', value: 9, unit: 'reps', origin: 'runtime', image: '9', metadata: { canonicalKey: 'reps' } },
          { type: 'rounds', value: 1, origin: 'runtime', metadata: { canonicalKey: 'rounds' } },
        ],
      },
      {
        id: 'ev-sum',
        resultId: 'res-fran-1',
        noteId: 'note-fran',
        timestamp: 1_735_689_785_000,
        grain: 'summary',
        outputType: 'analytics',
        blockContentId: 'blk-fran',
        metrics: [
          { type: 'totalWork', value: 945, unit: 'kg', origin: 'analyzed', metadata: { canonicalKey: 'totalWork' } },
          { type: 'tis', value: 82, unit: 'pts', origin: 'analyzed', metadata: { canonicalKey: 'tis' } },
        ],
      },
    ],
    summary: {
      elapsedMs: 185_000,
      totalReps: 30,
      totalVolume: 2850,
      volumeUnit: 'kg',
      totalDistance: 0,
      tis: 82,
      sessionLoad: 140,
      roundsCompleted: 3,
      splitCount: 2,
      efforts: ['thruster', 'pull-up', 'row', 'box-jump'],
      blockContentId: 'blk-fran',
      noteTitle: 'Fran Benchmark',
      notebooks: ['notebook/benchmarks'],
      completed: true,
      movementRollup: [
        { effortSlug: 'thruster', label: 'Thruster', splits: 1, totalReps: 21, totalVolume: 945, volumeUnit: 'kg', totalDistance: 0, totalElapsedMs: 60_000, bestWeight: 45, bestE1rm: 76.5 },
        { effortSlug: 'pull-up', label: 'Pull-Up', splits: 1, totalReps: 9, totalVolume: 0, totalDistance: 0, totalElapsedMs: 55_000 },
        { effortSlug: 'row', label: 'Row', splits: 1, totalReps: 0, totalVolume: 0, totalDistance: 500, distanceUnit: 'm', totalElapsedMs: 45_000 },
        { effortSlug: 'box-jump', label: 'Box Jump', splits: 1, totalReps: 15, totalVolume: 0, totalDistance: 0, totalElapsedMs: 25_000 },
      ],
    },
    ...overrides,
  } as unknown as RowsRun;
}

describe('Results Experience Phase 2 UI components', () => {
  it('renders SessionSummaryCard KPIs, PRBadge contrast, RPE popover, and actions', async () => {
    const onCaptureRpe = vi.fn().mockResolvedValue(undefined);
    const onOpenResults = vi.fn();
    const onAddToDashboard = vi.fn();
    const onEditSource = vi.fn();
    const run = makeSampleRun();

    render(
      <SessionSummaryCard
        run={run}
        prHighlights={{ 'ev-1': { improvement: 5, unit: 'kg', label: 'Thruster' } }}
        onCaptureRpe={onCaptureRpe}
        onOpenResults={onOpenResults}
        onAddToDashboard={onAddToDashboard}
        onEditSource={onEditSource}
      />,
    );

    expect(screen.getByText('Fran Benchmark')).toBeDefined();
    expect(screen.getByText('3:05')).toBeDefined();
    expect(screen.getByText('2,850 kg')).toBeDefined();
    expect(screen.getByText('82 pts')).toBeDefined();
    expect(screen.getAllByTestId('pr-badge').length).toBeGreaterThan(0);

    // Collapsible movement rollup starts with 3 items then expands to 4
    expect(screen.getByTestId('session-summary-movements').querySelectorAll('li')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('session-summary-movements-toggle'));
    expect(screen.getByTestId('session-summary-movements').querySelectorAll('li')).toHaveLength(4);

    // RPE popover opens and commits
    fireEvent.click(screen.getByTestId(`rpe-chip-${run.resultId}`));
    expect(screen.getByTestId(`rpe-scale-${run.resultId}`)).toBeDefined();
    fireEvent.click(screen.getByTestId(`rpe-option-${run.resultId}-8`));
    await waitFor(() => expect(onCaptureRpe).toHaveBeenCalledWith('res-fran-1', 8));

    fireEvent.click(screen.getByTestId('session-summary-open-results'));
    expect(onOpenResults).toHaveBeenCalledWith(expect.objectContaining({ resultId: 'res-fran-1', blockContentId: 'blk-fran' }));

    fireEvent.click(screen.getByTestId('session-summary-add-dashboard'));
    expect(onAddToDashboard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('session-summary-edit-source'));
    expect(onEditSource).toHaveBeenCalledTimes(1);
  });

  it('uses high-contrast amber tokens on PRBadge for light mode', () => {
    render(<PRBadge isPR improvement={2.5} unit="kg" />);
    const badge = screen.getByTestId('pr-badge');
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-900');
  });

  it('renders ResultsSpreadsheetGrid 4 tabs, sorting, presets, edit & clear override, and custom summaries strip', async () => {
    const run = makeSampleRun();
    const prior = makeSampleRun({
      resultId: 'res-fran-0',
      timestamp: 1_735_600_000_000,
      durationMs: 210_000,
      summary: { ...makeSampleRun().summary!, elapsedMs: 210_000 },
    });
    const onEditMetric = vi.fn().mockResolvedValue(undefined);
    const onClearMetric = vi.fn().mockResolvedValue(undefined);
    const onAddToDashboard = vi.fn();

    render(
      <ResultsSpreadsheetGrid
        run={run}
        compareRuns={[prior]}
        tableTestId="custom-grid-table"
        showCustomSummariesStrip
        onEditMetric={onEditMetric}
        onClearMetric={onClearMetric}
        onAddToDashboard={onAddToDashboard}
      />,
    );

    expect(screen.getByTestId('custom-summaries-strip').textContent).toContain('totalWork');
    expect(screen.getByTestId('custom-grid-table')).toBeDefined();

    // Sort reps ascending
    const repsHeader = screen.getByTestId('spreadsheet-col-reps');
    fireEvent.click(repsHeader.querySelector('button')!);
    expect(repsHeader.getAttribute('aria-sort')).toBe('ascending');

    // Preset switch to Strength reveals e1RM
    fireEvent.click(screen.getByTestId('spreadsheet-preset-strength'));
    expect(screen.getByTestId('spreadsheet-col-e1rm')).toBeDefined();

    // Mobile cards toggle
    fireEvent.click(screen.getByTestId('mobile-view-cards'));
    expect(screen.getByTestId('mobile-split-cards')).toBeDefined();
    fireEvent.click(screen.getByTestId('mobile-view-grid'));

    // Edit & clear user-modified reps cell
    fireEvent.click(screen.getByTestId('spreadsheet-edit-reps-0'));
    const input = screen.getByTestId('spreadsheet-edit-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('spreadsheet-edit-save'));
    await waitFor(() => expect(onEditMetric).toHaveBeenCalledWith('res-fran-1', expect.objectContaining({
      metric: expect.objectContaining({ type: 'rep', value: 25 }),
    })));

    // Tab switching
    fireEvent.click(screen.getByTestId('results-tab-movement'));
    expect(screen.getByTestId('results-tab-panel-movement')).toBeDefined();
    fireEvent.click(screen.getByTestId('results-tab-compare'));
    expect(screen.getByTestId('results-tab-panel-compare').textContent).toContain('-25s');
    fireEvent.click(screen.getByTestId('results-tab-raw'));
    expect(screen.getByTestId('results-tab-panel-raw')).toBeDefined();
  });

  it('dispatches view: summary in QueryBlockView without duplicate shell actions and WidgetChart respects unit integrity', async () => {
    const run = makeSampleRun();
    const executor: QueryExecutor = {
      runQuery: vi.fn(async () => ({} as QueryResult)),
      runFind: vi.fn(async () => ({
        parsed: { family: 'find', raw: ':session{result:res-fran-1}', target: 'session', filters: [] },
        notes: [],
        blocks: [],
        runs: [run],
        stages: { selected: 1, matched: 1 },
      } as never)),
      runRows: vi.fn(async () => ({} as never)),
    };
    const onOpenResults = vi.fn();
    const onAddToDashboard = vi.fn();

    render(
      <QueryBlockView
        query={'view: summary\nquery: :session{result:res-fran-1}'}
        executor={executor}
        onOpenResults={onOpenResults}
        onAddToDashboard={onAddToDashboard}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('session-summary-card')).toBeDefined());
    // Shell should NOT duplicate query-add-dashboard when SessionSummaryCard owns header actions
    expect(screen.queryByTestId('query-add-dashboard')).toBeNull();
    expect(screen.getByTestId('session-summary-add-dashboard')).toBeDefined();

    cleanup();

    // Unit integrity: unit="kg" should not label adherence as kg
    const adherenceRes: QueryResult = {
      parsed: { family: 'aggregate', raw: 'avg:calc.adherence{}', agg: 'avg', metric: 'calc.adherence', filters: [], groupBy: [] },
      series: [{ key: 'calc.adherence', label: 'Adherence', points: [{ ts: 1000, value: 0.938 }] }],
      stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
      matched: [],
      scalar: 0.938,
    };
    const { container } = render(<WidgetChart type="value" result={adherenceRes} label="Adherence" unit="kg" />);
    expect(container.textContent).toContain('0.938');
    expect(container.textContent).not.toContain('kg');

    cleanup();

    // Ordinal WqlTimeseries renders without error
    const ordinalRes: QueryResult = {
      parsed: { family: 'aggregate', raw: 'avg:elapsed{} by {round}', agg: 'avg', metric: 'elapsed', filters: [], groupBy: ['round'] },
      series: [{
        key: 'elapsed',
        label: 'Elapsed',
        unit: 's',
        axisKind: 'ordinal',
        axisDimension: 'round',
        points: [
          { ts: 1, x: 1, label: 'R1', value: 42 },
          { ts: 2, x: 2, label: 'R2', value: 45 },
        ],
      }],
      stages: { selected: 2, buckets: 2, aggregated: 2, groups: 1 },
      matched: [],
    };
    const { container: tsContainer } = render(<WidgetChart type="timeseries" result={ordinalRes} />);
    expect(tsContainer).toBeDefined();
  });

  it('promotes :session find queries directly onto fact filters in promoteFindToChartObject', () => {
    const obj = parseQueryBlock(':session{block:blk-fran, plane:segment}');
    const promoted = promoteFindToChartObject(obj, 'totalVolume');
    expect(promoted.query).toBe('sum:totalVolume{block:blk-fran} by {week}');
    expect(promoted.view).toBe('timeseries');
  });
});
