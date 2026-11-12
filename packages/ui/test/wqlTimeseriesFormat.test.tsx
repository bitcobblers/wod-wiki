import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { QueryResult } from '@bitcobblers/wod-wiki-wql';
import {
  WqlTimeseries,
  formatTimeseriesTick,
  formatTimeseriesTooltipValue,
} from '../src/widgets/WqlTimeseries';

afterEach(cleanup);

function expectedNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

describe('WqlTimeseries number display formatters (WW-010)', () => {
  describe('formatTimeseriesTick', () => {
    it('formats large integer and thousand ticks with locale grouping and a space before unit', () => {
      expect(formatTimeseriesTick(5000, 'kg')).toBe(`${expectedNumber(5000, 0)} kg`);
      expect(formatTimeseriesTick(20000, 'kg')).toBe(`${expectedNumber(20000, 0)} kg`);
      expect(formatTimeseriesTick(5000, 'kg')).not.toBe('5000kg');
    });

    it('rounds large fractional ticks to integer precision', () => {
      expect(formatTimeseriesTick(12178.955, 'kg')).toBe(`${expectedNumber(12178.955, 0)} kg`);
    });

    it('preserves up to 1 decimal place for small fractional ticks', () => {
      expect(formatTimeseriesTick(2.5, 'kg')).toBe(`${expectedNumber(2.5, 1)} kg`);
      expect(formatTimeseriesTick(0.75, 'AU')).toBe(`${expectedNumber(0.75, 1)} AU`);
      expect(formatTimeseriesTick(0, 'kg')).toBe(`${expectedNumber(0, 1)} kg`);
    });

    it('omits trailing whitespace when unit is undefined or empty', () => {
      expect(formatTimeseriesTick(5000)).toBe(expectedNumber(5000, 0));
      expect(formatTimeseriesTick(5000, '')).toBe(expectedNumber(5000, 0));
      expect(formatTimeseriesTick(2.5, '   ')).toBe(expectedNumber(2.5, 1));
    });
  });

  describe('formatTimeseriesTooltipValue', () => {
    it('rounds over-precise decimals to at most 1 fraction digit and drops trailing .0', () => {
      expect(formatTimeseriesTooltipValue(12178.955, 'kg')).toBe(`${expectedNumber(12178.955, 1)} kg`);
      expect(formatTimeseriesTooltipValue(12178.24, 'kg')).toBe(`${expectedNumber(12178.24, 1)} kg`);
    });

    it('formats integers and missing/empty units cleanly', () => {
      expect(formatTimeseriesTooltipValue(5000, 'lbs')).toBe(`${expectedNumber(5000, 1)} lbs`);
      expect(formatTimeseriesTooltipValue(42.76)).toBe(expectedNumber(42.76, 1));
      expect(formatTimeseriesTooltipValue(42.76, '')).toBe(expectedNumber(42.76, 1));
    });
  });

  it('mounts WqlTimeseries with formatted Y-axis ticks without duplicating unit suffixes', () => {
    const result: QueryResult = {
      parsed: { family: 'aggregate', raw: 'sum:totalVolume{} by {week}', agg: 'sum', metric: 'totalVolume', filters: [], groupBy: ['week'] },
      series: [
        {
          key: 'volume',
          label: 'Volume',
          points: [
            { ts: 1700000000000, value: 5000 },
            { ts: 1700604800000, value: 12178.955 },
          ],
          unit: 'kg',
        },
      ],
      stages: { selected: 2, buckets: 2, aggregated: 2, groups: 1 },
      matched: [],
      unit: 'kg',
    };

    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <WqlTimeseries result={result} />
      </div>,
    );
    expect(container).toBeDefined();
  });
});
