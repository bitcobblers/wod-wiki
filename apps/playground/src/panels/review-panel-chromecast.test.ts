import { describe, expect, it } from 'bun:test';
import {
  aggregateProjections,
  aggregatedName,
} from './review-panel-chromecast';

describe('aggregateProjections', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateProjections([])).toEqual([]);
  });

  it('keeps projections without metricType as-is', () => {
    const projections = [
      { name: 'Custom Metric', value: 42, unit: 'pts' },
      { name: 'Another One', value: 7, unit: 'pts' },
    ];
    expect(aggregateProjections(projections)).toEqual(projections);
  });

  it('aggregates projections by metricType, summing values', () => {
    const projections = [
      { name: 'Thruster Volume', value: 1000, unit: 'lb', metricType: 'volume' },
      { name: 'Pull-up Volume', value: 500, unit: 'lb', metricType: 'volume' },
      { name: 'Deadlift Volume', value: 2000, unit: 'lb', metricType: 'volume' },
    ];
    const result = aggregateProjections(projections);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'Total Volume',
      value: 3500,
      unit: 'lb',
      metricType: 'volume',
    });
  });

  it('preserves order of first appearance per metricType', () => {
    const projections = [
      { name: 'Reps A', value: 10, unit: 'reps', metricType: 'rep' },
      { name: 'Vol A', value: 100, unit: 'kg', metricType: 'volume' },
      { name: 'Reps B', value: 20, unit: 'reps', metricType: 'rep' },
      { name: 'Vol B', value: 200, unit: 'kg', metricType: 'volume' },
    ];
    const result = aggregateProjections(projections);
    expect(result[0].metricType).toBe('rep');
    expect(result[0].value).toBe(30);
    expect(result[1].metricType).toBe('volume');
    expect(result[1].value).toBe(300);
  });

  it('uses the most common unit within a group', () => {
    const projections = [
      { name: 'A', value: 100, unit: 'kg', metricType: 'volume' },
      { name: 'B', value: 200, unit: 'kg', metricType: 'volume' },
      { name: 'C', value: 50, unit: 'lb', metricType: 'volume' },
    ];
    const result = aggregateProjections(projections);
    expect(result[0].unit).toBe('kg');
  });

  it('is case-insensitive on metricType', () => {
    const projections = [
      { name: 'A', value: 10, unit: 'reps', metricType: 'Rep' },
      { name: 'B', value: 20, unit: 'reps', metricType: 'REP' },
      { name: 'C', value: 30, unit: 'reps', metricType: 'rep' },
    ];
    const result = aggregateProjections(projections);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(60);
    expect(result[0].metricType).toBe('rep');
  });

  it('mixes grouped and ungrouped projections preserving order', () => {
    const projections = [
      { name: 'Ungrouped A', value: 1, unit: 'x' },
      { name: 'Vol A', value: 100, unit: 'kg', metricType: 'volume' },
      { name: 'Vol B', value: 200, unit: 'kg', metricType: 'volume' },
      { name: 'Ungrouped B', value: 2, unit: 'x' },
    ];
    const result = aggregateProjections(projections);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: 'Ungrouped A', value: 1, unit: 'x' });
    expect(result[1].metricType).toBe('volume');
    expect(result[1].value).toBe(300);
    expect(result[2]).toEqual({ name: 'Ungrouped B', value: 2, unit: 'x' });
  });

  it('deduplicates metricTypes even when they appear interleaved', () => {
    const projections = [
      { name: 'Reps A', value: 10, unit: 'reps', metricType: 'rep' },
      { name: 'Vol A', value: 100, unit: 'kg', metricType: 'volume' },
      { name: 'Reps B', value: 20, unit: 'reps', metricType: 'rep' },
      { name: 'Vol B', value: 200, unit: 'kg', metricType: 'volume' },
      { name: 'Reps C', value: 30, unit: 'reps', metricType: 'rep' },
    ];
    const result = aggregateProjections(projections);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(60); // reps
    expect(result[1].value).toBe(300); // volume
  });
});

describe('aggregatedName', () => {
  it('returns known aggregated names', () => {
    expect(aggregatedName('volume', 'fallback')).toBe('Total Volume');
    expect(aggregatedName('rep', 'fallback')).toBe('Total Reps');
    expect(aggregatedName('repetitions', 'fallback')).toBe('Total Reps');
    expect(aggregatedName('distance', 'fallback')).toBe('Total Distance');
    expect(aggregatedName('work', 'fallback')).toBe('Total Energy');
    expect(aggregatedName('load', 'fallback')).toBe('Total Load');
    expect(aggregatedName('elapsed', 'fallback')).toBe('Total Time');
    expect(aggregatedName('duration', 'fallback')).toBe('Total Duration');
  });

  it('falls back to the provided name for unknown metric types', () => {
    expect(aggregatedName('custom', 'My Custom')).toBe('My Custom');
  });
});
