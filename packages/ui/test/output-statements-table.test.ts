import { describe, expect, it } from 'vitest';
import { extractMetricsByCategory } from '../src';

describe('extractMetricsByCategory — Property Note metrics, summaries & diagnostics', () => {
  it('places calculated work, power, and workout summary metrics into loads so rows are never blank', () => {
    const segmentCats = extractMetricsByCategory([
      { type: 'effort', value: 'Kettlebell Swings', origin: 'parser' },
      { type: 'rep', value: 10, origin: 'runtime' },
      { type: 'resistance', value: 24, unit: 'kg', origin: 'parser' },
      { type: 'work', value: 240, unit: 'kg', origin: 'analyzed', metadata: { canonicalKey: 'work' } },
      { type: 'power', value: 500, unit: 'kg/s', origin: 'analyzed', metadata: { canonicalKey: 'power' } },
    ]);

    expect(segmentCats.loads.map((m) => m.type)).toEqual(['resistance', 'work', 'power']);

    const summaryCats = extractMetricsByCategory([
      { type: 'label', value: 'totalWork', origin: 'analyzed' },
      { type: 'totalWork', value: 480, unit: 'kg', origin: 'analyzed', metadata: { canonicalKey: 'totalWork' } },
      { type: 'totalVolume', value: 480, unit: 'kg', origin: 'analyzed', metadata: { canonicalKey: 'totalVolume' } },
      { type: 'tis', value: 25, unit: 'pts', origin: 'analyzed', metadata: { canonicalKey: 'tis' } },
      { type: 'sessionLoad', value: 120, unit: 'AU', origin: 'analyzed', metadata: { canonicalKey: 'sessionLoad' } },
      { type: 'calc.metMinutes', value: 14, unit: 'MET-min', origin: 'analyzed', metadata: { canonicalKey: 'calc.metMinutes' } },
    ]);

    expect(summaryCats.efforts.map((m) => m.value)).toEqual(['totalWork']);
    expect(summaryCats.loads.map((m) => m.type)).toEqual([
      'totalWork',
      'totalVolume',
      'tis',
      'sessionLoad',
      'calc.metMinutes',
    ]);
  });
  it('places skipped-dependency diagnostics into hints so missing inputs surface in the table', () => {
    const cats = extractMetricsByCategory([
      { type: 'effort', value: 'Thrusters', origin: 'parser' },
      { type: 'rep', value: 12, origin: 'runtime' },
      {
        type: 'diagnostic',
        value: 'Skipped work: missing resistance',
        origin: 'analyzed',
        metadata: { metricKey: 'work', missing: ['resistance'] },
      },
    ]);

    expect(cats.hints.map((m) => m.value)).toEqual(['Skipped work: missing resistance']);
  });
});
