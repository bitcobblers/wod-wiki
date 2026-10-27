/**
 * Review Grid preset migration tests.
 *
 * Verifies the legacy preset wrapper now reflects the CDL preset config,
 * and that the new strength/endurance presets exercise fallback, grouping,
 * and derived-column behavior.
 */

import { describe, it, expect } from 'bun:test';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { ColumnSet } from './ColumnSet';
import {
  GRID_COLUMN_SET_CONFIG,
  exerciseColumn,
  loadFocusColumn,
  paceColumn,
} from './cdlColumnDefinitions';
import {
  GRID_PRESETS,
  getPreset,
  DEFAULT_PRESET,
  DEBUG_PRESET,
  STRENGTH_PRESET,
  ENDURANCE_PRESET,
} from './gridPresets';
import { makeGridCell, makeGridRow } from './interpreters/__tests__/test-helpers';

describe('grid presets', () => {
  it('exposes all four presets through the legacy wrapper', () => {
    expect(Object.keys(GRID_PRESETS)).toEqual([
      'default',
      'debug',
      'strength',
      'endurance',
    ]);
    expect(DEFAULT_PRESET.label).toBe('Default');
    expect(DEBUG_PRESET.label).toBe('Debug');
    expect(STRENGTH_PRESET.label).toBe('Strength');
    expect(ENDURANCE_PRESET.label).toBe('Endurance');
  });

  it('preserves default/debug visual parity and filters', () => {
    expect(DEFAULT_PRESET.filters.outputTypes).toEqual([
      'segment',
      'milestone',
      'group',
      'analytics',
    ]);
    expect(DEBUG_PRESET.visibleColumns.slice(0, 7)).toEqual([
      '#',
      'timeSpan',
      'timestamp',
      'spans',
      'blockKey',
      'outputType',
      'stackLevel',
    ]);
  });

  it('defines strength/endurance presets with CDL-specific columns', () => {
    expect(STRENGTH_PRESET.visibleColumns).toContain('exercise');
    expect(STRENGTH_PRESET.visibleColumns).toContain('loadFocus');
    expect(STRENGTH_PRESET.visibleColumns).toContain('volume');

    expect(ENDURANCE_PRESET.visibleColumns).toContain('exercise');
    expect(ENDURANCE_PRESET.visibleColumns).toContain('pace');
    expect(ENDURANCE_PRESET.visibleColumns).toContain('distance');
    expect(ENDURANCE_PRESET.visibleColumns).toContain('duration');
  });

  it('falls back to default for unknown preset ids', () => {
    expect(getPreset('unknown')).toEqual(DEFAULT_PRESET);
  });
});

describe('preset CDL columns', () => {
  const set = new ColumnSet(GRID_COLUMN_SET_CONFIG);

  it('groups effort + text into the exercise column and falls back cleanly', () => {
    const groupedRow = makeGridRow({
      cells: [
        [MetricType.Effort, makeGridCell([{ type: MetricType.Effort, value: 'Heavy' }])],
        [MetricType.Text, makeGridCell([{ type: MetricType.Text, value: 'Back squat' }])],
      ],
    });

    const textOnlyRow = makeGridRow({
      id: 2,
      cells: [[MetricType.Text, makeGridCell([{ type: MetricType.Text, value: 'Tempo run' }])]],
    });

    const groupedValue = set.resolveColumnValue(groupedRow, exerciseColumn.id, [groupedRow], 0);
    const textOnlyValue = set.resolveColumnValue(textOnlyRow, exerciseColumn.id, [textOnlyRow], 0);

    expect(groupedValue).toBeArray();
    expect((groupedValue as unknown[])).toHaveLength(2);
    expect(textOnlyValue).toBeDefined();
  });

  it('uses the load-focused fallback chain for strength metrics', () => {
    const loadRow = makeGridRow({
      cells: [
        [MetricType.Load, makeGridCell([{ type: MetricType.Load, value: 225, image: '225 lb' }])],
        [MetricType.Resistance, makeGridCell([{ type: MetricType.Resistance, value: 100, image: '100 kg' }])],
      ],
    });

    const resistanceOnlyRow = makeGridRow({
      id: 2,
      cells: [[MetricType.Resistance, makeGridCell([{ type: MetricType.Resistance, value: 24, image: '24 kg' }])]],
    });

    const loadValue = set.resolveColumnValue(loadRow, loadFocusColumn.id, [loadRow], 0) as { metrics: { toArray(): Array<{ image?: string }> } };
    const resistanceValue = set.resolveColumnValue(resistanceOnlyRow, loadFocusColumn.id, [resistanceOnlyRow], 0) as { metrics: { toArray(): Array<{ image?: string }> } };

    expect(loadValue.metrics.toArray()[0]?.image).toBe('225 lb');
    expect(resistanceValue.metrics.toArray()[0]?.image).toBe('24 kg');
  });

  it('derives pace for the endurance preset from distance and duration', () => {
    const row = makeGridRow({
      cells: [
        [MetricType.Distance, makeGridCell([{ type: MetricType.Distance, value: 1000 }])],
        [MetricType.Duration, makeGridCell([{ type: MetricType.Duration, value: 300 }])],
      ],
    });

    const pace = set.resolveColumnValue(row, paceColumn.id, [row], 0) as number;
    expect(pace).toBeCloseTo(1000 / 300, 5);
  });
});
