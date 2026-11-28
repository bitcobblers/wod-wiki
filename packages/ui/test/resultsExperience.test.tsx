import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseQueryBlock, type QueryResult, type RowsRun } from '@bitcobblers/wod-wiki-wql';
import {
  OutputStatementsTable,
  PRBadge,
  QueryBlockView,
  ResultsSpreadsheetGrid,
  SessionSummaryCard,
  WidgetChart,
  formatAnalyticsFloat,
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
    expect(screen.getByText('82.0 pts')).toBeDefined();
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

    expect(screen.getByTestId('custom-summaries-strip').textContent).toContain('Total Work');
    expect(screen.getByTestId('custom-summaries-strip').textContent).toContain('82.0 pts');
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

  it('WW-078 & WW-092: formatAnalyticsFloat enforces 1dp consistency and OutputStatementsTable avoids uppercase badges', () => {
    expect(formatAnalyticsFloat(82)).toBe('82.0');
    expect(formatAnalyticsFloat(64.852)).toBe('64.9');

    const { container } = render(
      <OutputStatementsTable
        outputs={[
          {
            id: 'row-1',
            outputType: 'segment',
            timeSpan: { started: 1000, ended: 15000 },
            sourceBlockKey: 'blk-1',
            metrics: [
              { type: 'effort', value: 'thruster', image: 'Thrusters', origin: 'parser' },
              { type: 'rep', value: 21, image: '21', origin: 'runtime' },
            ],
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('Segment');
    expect(container.querySelector('.uppercase')?.textContent).not.toBe('Segment');
    expect(container.querySelector('[aria-label="Effort: Thrusters"]')).not.toBeNull();
  });

  it('WW-125: normalizes pace units (min/km, sec/km, min/mi, m/s) and ignores reps/min in ResultsSpreadsheetGrid', () => {
    const run = makeSampleRun({
      resultId: 'res-pace-1',
      events: [
        {
          id: 'ev-run',
          resultId: 'res-pace-1',
          noteId: 'note-run',
          timestamp: 1_735_689_600_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'running',
          sourceBlockKey: 'seg-run-1',
          stackLevel: 1,
          timeSpan: { started: 1_735_689_600_000, ended: 1_735_689_706_560 },
          metrics: [
            { type: 'effort', value: 'running', image: 'Running', origin: 'parser', metadata: { effortSlug: 'running' } },
            { type: 'distance', value: 200, unit: 'm', origin: 'parser' },
            { type: 'pace', value: 1.88, unit: 'm/s', origin: 'analyzed', metadata: { canonicalKey: 'pace' } },
            { type: 'pace', value: 8.88, unit: 'min/km', origin: 'analyzed', metadata: { canonicalKey: 'pace' } },
          ],
        },
        {
          id: 'ev-run-sec',
          resultId: 'res-pace-1',
          noteId: 'note-run',
          timestamp: 1_735_689_706_560,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'rowing',
          sourceBlockKey: 'seg-row-1',
          stackLevel: 1,
          timeSpan: { started: 1_735_689_706_560, ended: 1_735_689_856_560 },
          metrics: [
            { type: 'effort', value: 'rowing', image: 'Rowing', origin: 'parser', metadata: { effortSlug: 'rowing' } },
            { type: 'pace', value: 300, unit: 'sec/km', origin: 'analyzed', metadata: { canonicalKey: 'pace' } },
          ],
        },
        {
          id: 'ev-run-mi',
          resultId: 'res-pace-1',
          noteId: 'note-run',
          timestamp: 1_735_689_856_560,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'jogging',
          sourceBlockKey: 'seg-jog-1',
          stackLevel: 1,
          timeSpan: { started: 1_735_689_856_560, ended: 1_735_689_956_560 },
          metrics: [
            { type: 'effort', value: 'jogging', image: 'Jogging', origin: 'parser', metadata: { effortSlug: 'jogging' } },
            { type: 'pace', value: 8, unit: 'min/mi', origin: 'analyzed', metadata: { canonicalKey: 'pace' } },
          ],
        },
        {
          id: 'ev-kb',
          resultId: 'res-pace-1',
          noteId: 'note-run',
          timestamp: 1_735_689_956_560,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'kettlebell-swing',
          sourceBlockKey: 'seg-kb-1',
          stackLevel: 1,
          timeSpan: { started: 1_735_689_956_560, ended: 1_735_689_964_560 },
          metrics: [
            { type: 'effort', value: 'kettlebell-swing', image: 'Kettlebell Swings', origin: 'parser', metadata: { effortSlug: 'kettlebell-swing' } },
            { type: 'rep', value: 15, unit: 'reps', origin: 'runtime' },
            { type: 'resistance', value: 24, unit: 'kg', origin: 'parser' },
            { type: 'pace', value: 112.5, unit: 'reps/min', origin: 'analyzed', metadata: { canonicalKey: 'pace' } },
          ],
        },
      ],
    });

    const { container } = render(<ResultsSpreadsheetGrid run={run} />);
    expect(container.textContent).toContain('8:53 /km');
    expect(container.textContent).not.toContain('0:09 /km');
    expect(container.textContent).toContain('5:00 /km');
    expect(container.textContent).toContain('4:58 /km');
    // reps/min must not be rendered as a distance pace (1:53 /km)
    expect(container.textContent).not.toContain('1:53 /km');
  });

  it('WW-051: SessionSummaryCard split count agrees with ResultsSpreadsheetGrid Splits tab header (4 splits === Splits (4))', () => {
    const t0 = 1_735_689_600_000;
    const run = makeSampleRun({
      resultId: 'res-ww051-parity',
      timestamp: t0 + 30_000,
      durationMs: 18_000,
      summary: undefined,
      events: [
        {
          id: 'ev-wait',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0,
          grain: 'event',
          outputType: 'segment',
          sourceBlockKey: 'waiting-to-start',
          stackLevel: 1,
          timeSpan: { started: t0, ended: t0 + 12_000 },
          metrics: [{ type: 'label', value: 'Ready to Start', origin: 'runtime' }],
        },
        {
          id: 'ev-1',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0 + 12_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'burpees',
          sourceBlockKey: 'stmt-1',
          stackLevel: 2,
          timeSpan: { started: t0 + 12_000, ended: t0 + 16_000 },
          metrics: [{ type: 'effort', value: 'burpees', image: 'Burpees', origin: 'parser' }, { type: 'rep', value: 5, origin: 'parser' }],
        },
        {
          id: 'ev-2',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0 + 16_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'squats',
          sourceBlockKey: 'stmt-2',
          stackLevel: 2,
          timeSpan: { started: t0 + 16_000, ended: t0 + 21_000 },
          metrics: [{ type: 'effort', value: 'squats', image: 'Squats', origin: 'parser' }, { type: 'rep', value: 10, origin: 'parser' }],
        },
        {
          id: 'ev-3',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0 + 21_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'burpees',
          sourceBlockKey: 'stmt-1',
          stackLevel: 2,
          timeSpan: { started: t0 + 21_000, ended: t0 + 25_000 },
          metrics: [{ type: 'effort', value: 'burpees', image: 'Burpees', origin: 'parser' }, { type: 'rep', value: 5, origin: 'parser' }],
        },
        {
          id: 'ev-4',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0 + 25_000,
          grain: 'event',
          outputType: 'segment',
          effortSlug: 'squats',
          sourceBlockKey: 'stmt-2',
          stackLevel: 2,
          timeSpan: { started: t0 + 25_000, ended: t0 + 30_000 },
          metrics: [{ type: 'effort', value: 'squats', image: 'Squats', origin: 'parser' }, { type: 'rep', value: 10, origin: 'parser' }],
        },
        {
          id: 'ev-rounds',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0 + 12_000,
          grain: 'event',
          outputType: 'segment',
          sourceBlockKey: 'rounds-container',
          stackLevel: 1,
          timeSpan: { started: t0 + 12_000, ended: t0 + 30_000 },
          metrics: [{ type: 'rounds', value: 2, origin: 'runtime' }],
        },
        {
          id: 'ev-root',
          resultId: 'res-ww051-parity',
          noteId: 'note-1',
          timestamp: t0 + 12_000,
          grain: 'event',
          outputType: 'segment',
          sourceBlockKey: 'session-root',
          stackLevel: 0,
          timeSpan: { started: t0 + 12_000, ended: t0 + 30_000 },
          metrics: [],
        },
      ],
    });

    const { container } = render(
      <>
        <SessionSummaryCard run={run} />
        <ResultsSpreadsheetGrid run={run} />
      </>,
    );

    expect(container.textContent).toContain('4 splits');
    expect(container.textContent).not.toContain('7 splits');
    expect(container.textContent).toContain('Splits (4)');
    // Raw Events tab count matches the active filter (default Segments = 7 segment rows here)
    expect(container.textContent).toContain('Raw Events (7)');
  });

  it('WW-092: OutputStatementsTable renders meaningful row labels and consistent offset/elapsed pairs', () => {
    const t0 = 1_735_689_600_000;
    const { container } = render(
      <OutputStatementsTable
        // Intentionally pass a completion timestamp (post-dating all rows) to verify defensive origin resolution
        timeOrigin={t0 + 30_000}
        outputs={[
          {
            id: 'r0',
            outputType: 'segment',
            sourceBlockKey: 'waiting-to-start',
            timeSpan: { started: t0, ended: t0 + 13_000 },
            metrics: [],
          },
          {
            id: 'r1',
            outputType: 'segment',
            effortSlug: 'kettlebell-swing',
            sourceBlockKey: 'stmt-1',
            timeSpan: { started: t0 + 13_000, ended: t0 + 13_000 },
            // Zero-width span with explicit elapsed metric (4000ms) should render (00:04), not (00:00)
            metrics: [{ type: 'elapsed', value: 4_000, origin: 'runtime' }],
          },
          {
            id: 'r2',
            outputType: 'segment',
            sourceBlockKey: 'rounds-1',
            timeSpan: { started: t0 + 13_000, ended: t0 + 30_000 },
            metrics: [{ type: 'rounds', value: 2, origin: 'runtime' }],
          },
          {
            id: 'r3',
            outputType: 'segment',
            sourceBlockKey: 'session-root',
            timeSpan: { started: t0 + 13_000, ended: t0 + 30_000 },
            metrics: [],
          },
        ]}
      />,
    );

    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(4);

    // Meaningful labels instead of homogenized 'Segment'
    expect(rows[0]!.textContent).toContain('Start');
    expect(rows[1]!.textContent).toContain('Kettlebell Swing');
    expect(rows[2]!.textContent).toContain('2 Rounds');
    expect(rows[3]!.textContent).toContain('Session');

    // Consistent offsets (not clamped to +00:00 by completion timestamp) and split Offset/Time columns (no composite '+00:00 (00:13)')
    expect(rows[0]!.textContent).toContain('+00:00');
    expect(rows[0]!.textContent).toContain('00:13');
    expect(rows[0]!.textContent).not.toContain('(00:13)');
    expect(rows[1]!.textContent).toContain('+00:13');
    expect(rows[1]!.textContent).toContain('00:04');
    expect(rows[1]!.textContent).not.toContain('(00:00)');
    expect(rows[2]!.textContent).toContain('+00:13');
    expect(rows[2]!.textContent).toContain('00:17');
  });

  it('WW-092: OutputStatementsTable clamps mid-stream timeOrigin to earliest row (no negative offsets) and excludes analytics from type:segment', () => {
    const t0 = 1_735_689_600_000;
    const { container } = render(
      <OutputStatementsTable
        // Passing active start (86s after waiting-to-start) must never produce -01:26
        timeOrigin={t0 + 86_000}
        filter="type:segment"
        outputs={[
          {
            id: 'r0',
            outputType: 'segment',
            sourceBlockKey: 'waiting-to-start',
            timeSpan: { started: t0, ended: t0 + 86_000 },
            metrics: [],
          },
          {
            id: 'r1',
            outputType: 'segment',
            effortSlug: 'pull-ups',
            sourceBlockKey: 'stmt-1',
            timeSpan: { started: t0 + 86_000, ended: t0 + 116_000 },
            metrics: [{ type: 'effort', value: 'pull-ups', image: 'Pull-ups', origin: 'parser' }],
          },
          {
            id: 'r-analytics',
            outputType: 'analytics',
            sourceBlockKey: 'analytics-1',
            timeSpan: { started: t0 + 86_000, ended: t0 + 116_000 },
            metrics: [{ type: 'calculated', value: 14.73, unit: 'MET-min', origin: 'runtime', metadata: { canonicalKey: 'calc.metMinutes' } }],
          },
        ]}
      />,
    );

    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(container.textContent).not.toContain('-01:26');
    expect(container.textContent).not.toContain('MET Minutes');
    expect(rows[0]!.textContent).toContain('+00:00');
    expect(rows[1]!.textContent).toContain('+01:26');
  });

  it('WW-092: OutputStatementsTable humanizes analytics keys, separates Load from MET-min, omits elapsed from Target, and formats Pace cleanly', () => {
    const t0 = 1_735_689_600_000;
    const { container } = render(
      <OutputStatementsTable
        timeOrigin={t0}
        defaultFilter="all"
        outputs={[
          {
            id: 'ev-run',
            outputType: 'segment',
            effortSlug: 'run',
            sourceBlockKey: 'stmt-run',
            timeSpan: { started: t0, ended: t0 + 31_000 },
            metrics: [
              { type: 'effort', value: 'run', origin: 'parser' },
              { type: 'resistance', value: 24, unit: 'kg', origin: 'parser' },
              { type: 'work', value: 1.98, unit: 'MET-min', origin: 'runtime' },
              { type: 'duration', value: 1_200_000, origin: 'parser' },
              { type: 'elapsed', value: 51_000, origin: 'runtime' },
              { type: 'pace', value: 15.45, unit: 'm/s', origin: 'runtime' },
              { type: 'pace', value: 1.08, unit: 'min/km', origin: 'runtime' },
            ],
          },
          {
            id: 'ev-analytics',
            outputType: 'analytics',
            sourceBlockKey: 'analytics-1',
            timeSpan: { started: t0, ended: t0 + 51_000 },
            metrics: [
              {
                type: 'calculated',
                value: 4.29,
                unit: 'MET-min',
                origin: 'runtime',
                metadata: { canonicalKey: 'calc.metMinutes', originalKey: 'calc.metMinutes' },
              },
            ],
          },
          {
            id: 'ev-analytics-vol',
            outputType: 'analytics',
            sourceBlockKey: 'analytics-2',
            timeSpan: { started: t0, ended: t0 + 51_000 },
            metrics: [
              {
                type: 'totalVolume',
                value: 360,
                origin: 'runtime',
                metadata: { canonicalKey: 'totalVolume', originalKey: 'totalVolume' },
              },
            ],
          },
        ]}
      />,
    );

    const text = container.textContent ?? '';
    // Analytics key humanized via computeColumnLabel instead of raw 'calc.metMinutes'
    expect(text).toContain('MET Minutes');
    expect(text).not.toContain('calc.metMinutes');
    // No mashed text composites
    expect(text).not.toContain('24 kg1.98');
    expect(text).not.toContain('15.45 m/s1.08');
    expect(text).not.toContain('20:0000:51');
    expect(text).toContain('1:05 /km');

    // WW-092 follow-up:
    // 1. Time cell does not append composite wall-clock '· HH:MM:SS' text
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
    const timeColIdx = headers.findIndex((h) => h.includes('Time'));
    const loadColIdx = headers.findIndex((h) => h.includes('Load'));
    const summaryColIdx = headers.findIndex((h) => h.includes('Summary'));
    expect(timeColIdx).toBeGreaterThanOrEqual(0);
    expect(loadColIdx).toBeGreaterThanOrEqual(0);
    expect(summaryColIdx).toBeGreaterThanOrEqual(0);

    const bodyRows = Array.from(container.querySelectorAll('tbody tr'));
    const runCells = Array.from(bodyRows[0]!.querySelectorAll('td')).map((td) => td.textContent ?? '');
    expect(runCells[timeColIdx]).not.toContain('·');
    // 2. MET-min never lands in the Load column
    expect(runCells[loadColIdx]).toContain('24 kg');
    expect(runCells[loadColIdx]).not.toContain('MET-min');
    // 3. Analytics summary rows consolidate into Summary column with inferred units (no bare unitless 360)
    const volCells = Array.from(bodyRows[2]!.querySelectorAll('td')).map((td) => td.textContent ?? '');
    expect(volCells[summaryColIdx]).toContain('360 kg');
  });
});
