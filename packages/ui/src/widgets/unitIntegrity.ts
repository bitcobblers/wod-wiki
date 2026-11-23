import { dimensionKeyOf, type QueryResult } from '@bitcobblers/wod-wiki-wql';

const isMassUnit = (unit: string): boolean => dimensionKeyOf(unit) === 'mass';

const INTRINSIC_METRIC_UNITS: Record<string, string> = {
  'calc.hrv': 'ms',
  hrv: 'ms',
  totalvolume: 'kg',
  volume: 'kg',
  resistance: 'kg',
  weight: 'kg',
  e1rm: 'kg',
  'calc.e1rm': 'kg',
  totalwork: 'kg',
  work: 'kg',
  tis: 'pts',
  sessionload: 'AU',
  reps: 'reps',
  rep: 'reps',
  totalreps: 'reps',
  'calc.adherence': '',
  'calc.acwr': '',
  'calc.strain': 'AU',
  'calc.readiness': '',
  'calc.sends': '',
  'calc.sleep': 'h',
  sleep: 'h',
};

const INTRINSIC_MASS_METRICS = new Set([
  'totalvolume',
  'volume',
  'resistance',
  'weight',
  'e1rm',
  'calc.e1rm',
  'totalwork',
  'work',
]);

/**
 * Resolve the effective display unit for an analytics widget without letting a
 * host `kg`/`lb` mass preference overwrite unitless, ratio, score, or count
 * series (e.g. `calc.adherence`, `tis`, `sessionLoad`, `reps`, `%`).
 */
export function resolveWidgetDisplayUnit(
  result: Pick<QueryResult, 'unit' | 'parsed' | 'series'> | undefined,
  preferredUnit?: string,
  explicitSeriesUnit?: string,
): string {
  const resultUnit = (explicitSeriesUnit ?? result?.series?.[0]?.unit ?? result?.unit ?? '').trim();
  const metric = (result?.parsed?.family === 'aggregate' ? result.parsed.metric : '')
    .trim()
    .toLowerCase();

  if (resultUnit !== '') {
    return resultUnit;
  }

  if (preferredUnit) {
    if (!isMassUnit(preferredUnit) || INTRINSIC_MASS_METRICS.has(metric)) {
      return preferredUnit;
    }
    if (metric in INTRINSIC_METRIC_UNITS) {
      return INTRINSIC_METRIC_UNITS[metric]!;
    }
    return '';
  }

  if (metric && metric in INTRINSIC_METRIC_UNITS && !INTRINSIC_MASS_METRICS.has(metric)) {
    return INTRINSIC_METRIC_UNITS[metric]!;
  }

  return '';
}
