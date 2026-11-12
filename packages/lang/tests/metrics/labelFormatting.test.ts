/**
 * Column label formatting for analytics metrics: canonical names for derived
 * columns (`Calc.met Minutes` → `MET Minutes`) and humanized fallbacks that
 * strip the `calc.` namespace and uppercase known acronyms.
 */
import { describe, expect, it } from 'vitest';
import { computeColumnLabel, humanizeMetricKey } from '../../src/metrics/presentation/labelFormatting';

describe('metric label formatting', () => {
  it('maps calc.metMinutes and known derived columns to canonical labels', () => {
    expect(computeColumnLabel('calc.metMinutes')).toBe('MET Minutes');
    expect(computeColumnLabel('calc.metminutes')).toBe('MET Minutes');
    expect(computeColumnLabel('metMinutes')).toBe('MET Minutes');
    expect(computeColumnLabel('metMinutesEstimated')).toBe('MET Minutes Est.');
    expect(computeColumnLabel('sessionLoad')).toBe('Session Load');
    expect(computeColumnLabel('totalVolume')).toBe('Total Volume');
    expect(computeColumnLabel('totalReps')).toBe('Total Reps');
    expect(computeColumnLabel('totalDistance')).toBe('Total Distance');
    expect(computeColumnLabel('calc.acwr')).toBe('ACWR');
    expect(computeColumnLabel('calc.monotony')).toBe('Monotony');
    expect(computeColumnLabel('calc.strain')).toBe('Strain');
    expect(computeColumnLabel('calc.readiness')).toBe('Readiness');
    expect(computeColumnLabel('calc.hrv')).toBe('HRV');
    expect(computeColumnLabel('calc.sleep')).toBe('Sleep');
    expect(computeColumnLabel('calc.soreness')).toBe('Soreness');
    expect(computeColumnLabel('session-load')).toBe('Session Load');
  });

  it('humanizes unknown calc-prefixed keys without the namespace', () => {
    expect(humanizeMetricKey('calc.customMetric')).toBe('Custom Metric');
    expect(humanizeMetricKey('calc.custom_hr_key')).toBe('Custom Hr Key');
  });

  it('uppercases known acronyms in humanized keys', () => {
    expect(humanizeMetricKey('metMinutes')).toBe('MET Minutes');
    expect(humanizeMetricKey('avg_hrv')).toBe('Avg HRV');
    expect(humanizeMetricKey('session-rpe')).toBe('Session RPE');
    expect(humanizeMetricKey('tis')).toBe('TIS');
    expect(humanizeMetricKey('acwr')).toBe('ACWR');
    expect(humanizeMetricKey('vo2max')).toBe('VO2max');
    expect(humanizeMetricKey('calc.vo2maxEstimate')).toBe('VO2max Estimate');
  });

  it('leaves plain words and existing labels untouched', () => {
    expect(humanizeMetricKey('customMetric')).toBe('Custom Metric');
    expect(humanizeMetricKey('')).toBe('');
    expect(computeColumnLabel('rep')).toBe('Reps');
  });
});
