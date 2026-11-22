/**
 * WW-030 / late finding #6 — uniform numeric presentation across dashboard
 * surfaces: Y-axis ticks carry a space before the unit (`5,000 kg`), and
 * table cells round to at most 1 fraction digit exactly like chart tooltips
 * (`11,362.5 kg`, never `11,362.489 kg`).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import { WqlTable } from '../src/widgets/WqlTable';
import {
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
});
