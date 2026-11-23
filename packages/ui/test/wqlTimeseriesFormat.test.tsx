/**
 * WW-030 / late finding #6 — uniform numeric presentation across dashboard
 * surfaces: Y-axis ticks carry a space before the unit (`5,000 kg`), and
 * table cells round to at most 1 fraction digit exactly like chart tooltips
 * (`11,362.5 kg`, never `11,362.489 kg`).
 */
import React from 'react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { WqlTable } from '../src/widgets/WqlTable';
import {
  WqlTimeseries,
  formatTimeseriesTick,
  formatTimeseriesTooltipValue,
} from '../src/widgets/WqlTimeseries';
import {
  formatAxisTick,
  formatMetricValue,
  formatCompactMetricValue,
} from '../src/widgets/chartFormat';
import { StackedBar } from '../src/widgets/StackedBar';
import { WqlBars } from '../src/widgets/WqlBars';
import { WqlEmptyState } from '../src/widgets/WqlEmptyState';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
      <div className="recharts-responsive-container">
        {React.cloneElement(children, { width: 640, height: 320 } as Record<string, unknown>)}
      </div>
    ),
  };
});

const Y_AXIS_TICK_SELECTOR =
  '.recharts-yAxis-tick-labels text, .recharts-yAxis .recharts-cartesian-axis-tick text';

afterEach(cleanup);

function scalarResult(raw: string, value: number, unit?: string): QueryResult {
  return {
    parsed: { family: 'aggregate', raw, agg: 'sum', metric: 'totalVolume', filters: [], groupBy: [] },
    series: [{ key: 'scalar', label: 'Total volume', points: [{ ts: 1000, value }], unit }],
    stages: { selected: 1, buckets: 1, aggregated: 1, groups: 1 },
    matched: [],
    scalar: value,
    unit,
  } as unknown as QueryResult;
}

function timeseriesResult(raw: string, unit?: string): QueryResult {
  return {
    parsed: { family: 'aggregate', raw, agg: 'sum', metric: 'totalVolume', filters: [], groupBy: [] },
    series: [
      {
        key: 'totalVolume',
        label: 'Total volume',
        unit,
        points: [
          { ts: 1000, value: 11362.489 },
          { ts: 2000, value: 12000 },
        ],
      },
    ],
    stages: { selected: 2, buckets: 2, aggregated: 2, groups: 1 },
    matched: [],
    unit,
  } as unknown as QueryResult;
}

describe('formatTimeseriesTick / tooltipValue', () => {
  it('puts a space before the unit and groups thousands on Y-axis ticks', () => {
    expect(formatTimeseriesTick(5000, 'kg')).toBe('5,000 kg');
    expect(formatTimeseriesTick(0, 'kg')).toBe('0 kg');
    expect(formatTimeseriesTick(12.5, 'pts')).toBe('12.5 pts');
  });

  it('rounds tooltip values to at most 1 fraction digit with unit spacing', () => {
    expect(formatTimeseriesTooltipValue(11362.489, 'kg')).toBe('11,362.5 kg');
    expect(formatTimeseriesTooltipValue(12000, 'kg')).toBe('12,000 kg');
    expect(formatTimeseriesTooltipValue(7)).toBe('7');
  });
});

describe('WqlTable cell formatting', () => {
  it('rounds scalar cells to 1 fraction digit with a space before the unit', () => {
    render(<WqlTable result={scalarResult('sum:totalVolume{}', 11362.489, 'kg')} />);
    expect(screen.getByText('11,362.5 kg')).toBeDefined();
  });

  it('formats timeseries cells like chart tooltips', () => {
    render(<WqlTable result={timeseriesResult('sum:totalVolume{} every day', 'kg')} />);
    expect(screen.getByText('11,362.5 kg')).toBeDefined();
    expect(screen.getByText('12,000 kg')).toBeDefined();
  });
});

describe('WW-106 unified chartFormat, WqlEmptyState fallback, and WqlBars', () => {
  it('formats shared axis, tooltip, and compact values consistently', () => {
    expect(formatAxisTick(62, 'ms')).toBe('62 ms');
    expect(formatAxisTick(7.5, 'h')).toBe('7.5 h');
    expect(formatMetricValue(11362.489, 'kg')).toBe('11,362.5 kg');
    expect(formatCompactMetricValue(12500, 'kg')).toBe('12.5k kg');
  });

  it('renders WqlEmptyState fallbackMessage for unrenderable non-empty series', () => {
    render(
      <WqlEmptyState
        result={timeseriesResult('sum:totalVolume{}', 'kg')}
        fallbackMessage="No bar data available for this query."
      />,
    );
    expect(screen.getByText('No bar data available for this query.')).toBeDefined();
  });

  it('renders timeseries and ordinal series inside WqlBars instead of an empty state', () => {
    const { container } = render(
      <div style={{ width: 640, height: 320 }}>
        <WqlBars result={timeseriesResult('sum:totalVolume{} every day', 'kg')} />
      </div>,
    );
    expect(screen.queryByText('No data for this range.')).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('renders StackedBar with shared chart container cleanly', () => {
    const { container } = render(
      <div style={{ width: 640, height: 320 }}>
        <StackedBar result={timeseriesResult('sum:totalVolume{} by {intensity}', 'kg')} />
      </div>,
    );
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('WW-106: renders real bars and units for Recovery & Readiness Sleep and Soreness daily queries', () => {
    const sleepResult = {
      parsed: { family: 'aggregate', raw: 'avg:calc.sleep{} by {day}', agg: 'avg', metric: 'calc.sleep', filters: [], groupBy: ['day'] },
      series: [
        {
          key: 'calc.sleep',
          label: 'calc.sleep',
          unit: 'h',
          points: [
            { ts: Date.UTC(2026, 5, 1), value: 7.2 },
            { ts: Date.UTC(2026, 5, 2), value: 7.8 },
            { ts: Date.UTC(2026, 5, 3), value: 8.1 },
          ],
        },
      ],
      stages: { selected: 3, buckets: 3, aggregated: 3, groups: 1 },
      matched: [],
      unit: 'h',
    } as unknown as QueryResult;

    const sorenessResult = {
      parsed: { family: 'aggregate', raw: 'avg:calc.soreness{} by {day}', agg: 'avg', metric: 'calc.soreness', filters: [], groupBy: ['day'] },
      series: [
        {
          key: 'calc.soreness',
          label: 'calc.soreness',
          unit: 'rating',
          points: [
            { ts: Date.UTC(2026, 5, 1), value: 3 },
            { ts: Date.UTC(2026, 5, 2), value: 5 },
            { ts: Date.UTC(2026, 5, 3), value: 4 },
          ],
        },
      ],
      stages: { selected: 3, buckets: 3, aggregated: 3, groups: 1 },
      matched: [],
      unit: 'rating',
    } as unknown as QueryResult;

    const sleepRender = render(<WqlBars result={sleepResult} />);
    expect(sleepRender.container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThanOrEqual(3);
    const sleepTicks = Array.from(sleepRender.container.querySelectorAll(Y_AXIS_TICK_SELECTOR))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);
    expect(sleepTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of sleepTicks) {
      expect(tick).toMatch(/^\d+(?:\.\d)? h$/);
    }

    cleanup();

    const sorenessRender = render(<WqlBars result={sorenessResult} />);
    expect(sorenessRender.container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThanOrEqual(3);
    const sorenessTicks = Array.from(sorenessRender.container.querySelectorAll(Y_AXIS_TICK_SELECTOR))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);
    expect(sorenessTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of sorenessTicks) {
      expect(tick).toMatch(/^\d+(?:\.\d)? rating$/);
    }
  });

  it('WW-106: always renders WqlEmptyState (never a silent blank box) when series are empty or all-missing', () => {
    const emptySeries = {
      parsed: { family: 'aggregate', raw: 'avg:calc.sleep{} by {day}', agg: 'avg', metric: 'calc.sleep', filters: [], groupBy: ['day'] },
      series: [],
      stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
      matched: [],
    } as unknown as QueryResult;

    const zeroPointSeries = {
      parsed: { family: 'aggregate', raw: 'avg:calc.soreness{} by {day}', agg: 'avg', metric: 'calc.soreness', filters: [], groupBy: ['day'] },
      series: [{ key: 'calc.soreness', label: 'calc.soreness', unit: 'rating', points: [] }],
      stages: { selected: 0, buckets: 0, aggregated: 0, groups: 1 },
      matched: [],
    } as unknown as QueryResult;

    const allMissingSeries = {
      parsed: { family: 'aggregate', raw: 'avg:calc.soreness{} by {day}', agg: 'avg', metric: 'calc.soreness', filters: [], groupBy: ['day'] },
      series: [
        {
          key: 'calc.soreness',
          label: 'calc.soreness',
          unit: 'rating',
          points: [
            { ts: 1000, value: 0, missing: true },
            { ts: 2000, value: 0, missing: true },
          ],
        },
      ],
      stages: { selected: 0, buckets: 2, aggregated: 0, groups: 1 },
      matched: [],
    } as unknown as QueryResult;

    for (const emptyResult of [emptySeries, zeroPointSeries, allMissingSeries]) {
      const { unmount } = render(<WqlBars result={emptyResult} />);
      expect(screen.getByText('No data for this range.')).toBeDefined();
      unmount();

      const emptyStateRender = render(<WqlEmptyState result={emptyResult} />);
      expect(screen.getByText('No data for this range.')).toBeDefined();
      emptyStateRender.unmount();

      const tsRender = render(<WqlTimeseries result={emptyResult} />);
      expect(screen.getByText('No data for this range.')).toBeDefined();
      tsRender.unmount();

      const stackedRender = render(<StackedBar result={emptyResult} />);
      expect(screen.getByText('No data for this range.')).toBeDefined();
      stackedRender.unmount();
    }
  });
});

describe('WW-030 consistent chart tick unit spacing across kg, pts, and ratio', () => {
  it('spaces ratio, kg, and pts consistently across zero, fractional, and grouped ticks', () => {
    expect(formatAxisTick(0, 'kg')).toBe('0 kg');
    expect(formatAxisTick(6500, 'kg')).toBe('6,500 kg');
    expect(formatAxisTick(0.5, 'ratio')).toBe('0.5 ratio');
    expect(formatAxisTick(0, 'ratio')).toBe('0 ratio');
    expect(formatAxisTick(20, 'pts')).toBe('20 pts');
    expect(formatAxisTick(0, 'pts')).toBe('0 pts');
    expect(formatAxisTick('', 'kg')).toBe('');
    expect(formatMetricValue(0.5, 'ratio')).toBe('0.5 ratio');
    expect(formatMetricValue(6500, 'kg')).toBe('6,500 kg');
  });

  it('renders WqlTimeseries ACWR ratio ticks with a separating space (never 0.5ratio)', () => {
    const acwrResult = {
      parsed: { family: 'aggregate', raw: 'avg:calc.acwr{} by {day}', agg: 'avg', metric: 'calc.acwr', filters: [], groupBy: ['day'] },
      series: [
        {
          key: 'calc.acwr',
          label: 'calc.acwr',
          unit: 'ratio',
          points: [
            { ts: Date.UTC(2026, 5, 1), value: 0.5 },
            { ts: Date.UTC(2026, 5, 2), value: 1.0 },
            { ts: Date.UTC(2026, 5, 3), value: 1.3 },
          ],
        },
      ],
      stages: { selected: 3, buckets: 3, aggregated: 3, groups: 1 },
      matched: [],
      unit: 'ratio',
    } as unknown as QueryResult;

    const { container } = render(<WqlTimeseries result={acwrResult} />);
    const ticks = Array.from(container.querySelectorAll(Y_AXIS_TICK_SELECTOR))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);

    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const tick of ticks) {
      expect(tick).toMatch(/^\d+(?:\.\d)? ratio$/);
      expect(tick).not.toMatch(/\dratio$/);
    }
  });

  it('renders WqlTimeseries and StackedBar kg ticks with uniform space across 0 and thousands', () => {
    const volumeResult = {
      parsed: { family: 'aggregate', raw: 'sum:totalVolume{} by {week}', agg: 'sum', metric: 'totalVolume', filters: [], groupBy: ['week'] },
      series: [
        {
          key: 'totalVolume',
          label: 'Total volume',
          unit: 'kg',
          points: [
            { ts: Date.UTC(2026, 5, 1), value: 0 },
            { ts: Date.UTC(2026, 5, 8), value: 6500 },
          ],
        },
      ],
      stages: { selected: 2, buckets: 2, aggregated: 2, groups: 1 },
      matched: [],
      unit: 'kg',
    } as unknown as QueryResult;

    const ts = render(<WqlTimeseries result={volumeResult} />);
    const tsTicks = Array.from(ts.container.querySelectorAll(Y_AXIS_TICK_SELECTOR))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);
    expect(tsTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of tsTicks) {
      expect(tick).toMatch(/^\d{1,3}(?:,\d{3})*(?:\.\d)? kg$/);
      expect(tick).not.toMatch(/\dkg$/);
    }
    ts.unmount();

    const stacked = render(<StackedBar result={volumeResult} />);
    const stackedTicks = Array.from(stacked.container.querySelectorAll(Y_AXIS_TICK_SELECTOR))
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean);
    expect(stackedTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of stackedTicks) {
      expect(tick).toMatch(/^\d{1,3}(?:,\d{3})*(?:\.\d)? kg$/);
      expect(tick).not.toMatch(/\dkg$/);
    }
  });
});
