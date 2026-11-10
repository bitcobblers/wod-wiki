import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RowsQueryResult, RowsRun } from '@bitcobblers/wod-wiki-wql';
import { RowsTable, computeSessionPrHighlights } from '../src';

afterEach(cleanup);

const segmentEvent = {
  id: 'test-run-1:1',
  grain: 'event',
  outputType: 'segment',
  sourceBlockKey: 'seg-burpees',
  sourceStatementId: 2,
  stackLevel: 1,
  timeSpan: { started: 0, ended: 60_000 },
  metrics: [{ type: 'effort', value: 'Burpees' }, { type: 'rep', value: 20 }],
};

const soundEvent = {
  id: 'test-run-1:2',
  grain: 'event',
  outputType: 'event',
  timeSpan: { started: 60_000, ended: 66_000 },
  metrics: [{ type: 'sound', value: 'beep' }],
};

function rowsResultWith(...eventSets: Array<Array<Record<string, unknown>>>): RowsQueryResult {
  return {
    parsed: {
      family: 'rows',
      raw: 'rows:{result:test-run-1}',
      filters: [{ key: 'result', negate: false, values: [{ value: 'test-run-1', wildcard: false }] }],
    },
    runs: eventSets.map((events, i) => ({
      resultId: `test-run-${i + 1}`,
      noteId: 'note-1',
      timestamp: 1_700_000_000_000 + i * 86_400_000,
      events,
    })),
  } as unknown as RowsQueryResult;
}

describe('RowsTable — the Unified Session Results Table', () => {
  it('renders the shared statement table, defaulting to segment rows', () => {
    render(<RowsTable result={rowsResultWith([segmentEvent, soundEvent])} />);
    expect(screen.getByTestId('rows-table')).toBeDefined();
    const table = screen.getByTestId('output-statements-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders all 9 base column headers aligning with row cells when no custom metrics exist', () => {
    render(<RowsTable result={rowsResultWith([segmentEvent])} />);
    const table = screen.getByTestId('output-statements-table');
    const headers = table.querySelectorAll('thead th');
    expect(headers).toHaveLength(9);
    const cells = table.querySelectorAll('tbody tr td');
    expect(cells).toHaveLength(9);
  });

  it('automatically discovers dynamic custom & Property Note metric columns', () => {
    const customSegment = {
      id: 'test-run-1:sq1',
      grain: 'event',
      outputType: 'segment',
      sourceBlockKey: 'seg-squat',
      timeSpan: { started: 0, ended: 30_000 },
      metrics: [
        { type: 'effort', value: 'Back Squat', image: 'Back Squat' },
        { type: 'rep', value: 5 },
        { type: 'resistance', value: 140, unit: 'kg', image: '140 kg' },
        { type: 'calc.e1rm', value: 163.3, unit: 'kg', image: '163.3 kg' },
        { type: 'watts', value: 420, unit: 'W', image: '420 W' },
      ],
    };
    render(<RowsTable result={rowsResultWith([customSegment])} />);
    const table = screen.getByTestId('output-statements-table');
    // 9 base columns + 2 dynamic columns (calc.e1rm, watts) = 11 columns
    expect(table.querySelectorAll('thead th')).toHaveLength(11);
    expect(screen.getByTestId('sort-col-calc.e1rm')).toBeDefined();
    expect(screen.getByTestId('sort-col-watts')).toBeDefined();
    expect(table.querySelectorAll('tbody tr td')).toHaveLength(11);
  });

  it('supports explicit YAML columns whitelist & column header sorting', () => {
    const set1 = {
      id: 'r:1',
      grain: 'event',
      outputType: 'segment',
      sourceBlockKey: 'set-1',
      timeSpan: { started: 0, ended: 20_000 },
      metrics: [
        { type: 'effort', value: 'Back Squat', image: 'Back Squat' },
        { type: 'rep', value: 5, image: '5' },
        { type: 'calc.e1rm', value: 150, image: '150 kg' },
      ],
    };
    const set2 = {
      id: 'r:2',
      grain: 'event',
      outputType: 'segment',
      sourceBlockKey: 'set-2',
      timeSpan: { started: 30_000, ended: 50_000 },
      metrics: [
        { type: 'effort', value: 'Back Squat', image: 'Back Squat' },
        { type: 'rep', value: 3, image: '3' },
        { type: 'calc.e1rm', value: 175, image: '175 kg' },
      ],
    };

    render(
      <RowsTable
        result={rowsResultWith([set1, set2])}
        columns={['effort', 'reps', 'calc.e1rm']}
      />,
    );
    const table = screen.getByTestId('output-statements-table');
    expect(table.querySelectorAll('thead th')).toHaveLength(3);

    const e1rmHeader = screen.getByTestId('sort-col-calc.e1rm');
    // 1st click -> asc (150 first)
    fireEvent.click(e1rmHeader);
    expect(e1rmHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(table.querySelectorAll('tbody tr')[0]?.textContent).toContain('150');

    // 2nd click -> desc (175 first)
    fireEvent.click(e1rmHeader);
    expect(e1rmHeader.getAttribute('aria-sort')).toBe('descending');
    expect(table.querySelectorAll('tbody tr')[0]?.textContent).toContain('175');
  });

  it('supports inline actuals editing via onEditMetric', async () => {
    const onEditMetric = vi.fn().mockResolvedValue(undefined);
    render(
      <RowsTable
        result={rowsResultWith([segmentEvent])}
        onEditMetric={onEditMetric}
      />,
    );

    fireEvent.click(screen.getByTestId('edit-cell-reps-0'));
    const input = screen.getByTestId('inline-metric-input') as HTMLInputElement;
    expect(input.value).toBe('20');
    fireEvent.change(input, { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('inline-metric-save'));

    await waitFor(() => expect(onEditMetric).toHaveBeenCalledTimes(1));
    expect(onEditMetric).toHaveBeenCalledWith('test-run-1', {
      occurrence: {
        blockKey: 'seg-burpees',
        sourceStatementId: 2,
        stackLevel: 1,
      },
      metric: {
        type: 'rep',
        value: 24,
        image: '24',
      },
    });
  });

  it('computes and renders PRBadge highlights when a lift beats prior runs', () => {
    const priorRun: RowsRun = {
      resultId: 'run-old',
      noteId: 'n1',
      timestamp: 1_700_000_000_000,
      events: [
        {
          id: 'run-old:1',
          grain: 'event',
          outputType: 'segment',
          sourceBlockKey: 'sq-1',
          metrics: [
            { type: 'effort', value: 'back-squat', image: 'Back Squat' },
            { type: 'calc.e1rm', value: 150, unit: 'kg' } as never,
          ],
        } as never,
      ],
    };
    const newRun: RowsRun = {
      resultId: 'run-new',
      noteId: 'n1',
      timestamp: 1_700_086_400_000,
      events: [
        {
          id: 'run-new:1',
          grain: 'event',
          outputType: 'segment',
          sourceBlockKey: 'sq-1',
          metrics: [
            { type: 'effort', value: 'back-squat', image: 'Back Squat' },
            { type: 'calc.e1rm', value: 162.5, unit: 'kg', image: '162.5 kg' } as never,
          ],
        } as never,
      ],
    };

    const highlights = computeSessionPrHighlights(newRun, [priorRun, newRun]);
    expect(highlights.get('run-new:1')).toEqual({ improvement: 12.5, unit: 'kg' });

    render(
      <RowsTable
        result={{
          parsed: { family: 'rows', raw: '', filters: [] },
          runs: [newRun],
        } as unknown as RowsQueryResult}
        prHighlights={highlights}
      />,
    );
    expect(screen.getAllByTestId('pr-badge').length).toBeGreaterThan(0);
    expect(screen.getAllByText('(+12.5 kg)').length).toBeGreaterThan(0);
  });

  it('widens to all output types via the All preset pill', () => {
    render(<RowsTable result={rowsResultWith([segmentEvent, soundEvent])} />);
    fireEvent.click(screen.getByTestId('output-filter-preset-all'));
    const table = screen.getByTestId('output-statements-table');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('renders per-run headers and run chrome for multi-run results', () => {
    render(
      <RowsTable
        result={rowsResultWith([segmentEvent], [soundEvent])}
        renderRunHeaderExtra={(run) => <span>extra-{run.resultId}</span>}
      />,
    );
    expect(screen.getByText('extra-test-run-1')).toBeDefined();
    expect(screen.getByText('extra-test-run-2')).toBeDefined();
    expect(screen.getAllByTestId('output-statements-table')).toHaveLength(2);
  });

  it('shows the no-logs empty state when the query matches no runs', () => {
    render(
      <RowsTable
        result={{ parsed: { family: 'rows', raw: 'rows:{}', filters: [] }, runs: [] } as unknown as RowsQueryResult}
      />,
    );
    expect(screen.getByText('No workout logs matched this rows query.')).toBeDefined();
  });

  it('shows the no-statements empty state for a run without events', () => {
    render(<RowsTable result={rowsResultWith([])} />);
    expect(screen.getAllByText('No output statements recorded for this run.').length).toBe(2);
  });
});
