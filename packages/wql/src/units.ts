/**
 * WQL unit policy (wayfinder ticket 13, home per decision ticket 21).
 *
 * Recognition and conversion evidence live in the core catalog — this module
 * adds the wql application policy: strict conversion before arithmetic, the
 * system-default output table applied when the query has no `in <unit>`
 * directive, and errors (never pass-through) for unknown units and
 * dimension-incompatible conversions.
 *
 * Cutover notes (ticket 13): the old first-record-unit fallback and the
 * unknown/incompatible pass-through in `resolveDisplayUnit` are gone. The
 * host `kg | lb` widget preference is no longer a tier in the default chain —
 * `useAnalyticsUnitPreference` callers migrate to the system defaults under
 * ticket 19; no new callers allowed.
 */

import {
  SYSTEM_DEFAULT_OUTPUT_UNIT,
  UnitConversionError,
  convertViaCatalog,
  dimensionKeyOf,
  lookupUnit,
  systemDefaultUnit,
} from '@bitcobblers/wod-wiki-core';

export {
  SYSTEM_DEFAULT_OUTPUT_UNIT,
  UnitConversionError,
  convertViaCatalog,
  dimensionKeyOf,
  lookupUnit,
  systemDefaultUnit,
};

/** Legacy 2-family vocabulary kept only as a type alias for existing
 *  callers of the display seam; arithmetic dimensions come from the catalog. */
export type UnitFamily = 'mass' | 'distance';

/** The fact-unit shape resolveOutputUnit reads. */
export interface UnitBearingFact {
  unit?: string;
  metricUnit?: string;
}

/** Display conversion for UI surfaces (RawPointsTable etc.): converts
 *  within a shared dimension through the catalog, passes unknown or
 *  cross-dimension values through unchanged instead of throwing. Arithmetic
 *  must use {@link convertViaCatalog}. Ticket 19 migrates the remaining
 *  display callers onto renderer formatting. */
export function convertDisplay(value: number, from: string | undefined, to: string | undefined): number {
  if (from === undefined || to === undefined || from === to) return value;
  const fromDim = dimensionKeyOf(from);
  if (!fromDim || fromDim !== dimensionKeyOf(to)) return value;
  try {
    return convertViaCatalog(value, from, to);
  } catch {
    return value;
  }
}

/** Dimension compatibility probe for display surfaces. */
export function getUnitFamily(unit: string | undefined): string | undefined {
  return unit ? dimensionKeyOf(unit) : undefined;
}

export interface OutputUnitResolution {
  /** The resolved output unit — undefined means unitless / no conversion. */
  unit?: string;
  /** Whether fact values must be converted into `unit` before aggregation. */
  convert: boolean;
  /** Diagnostic when the directive is unusable for this result (unknown
   *  unit, or dimension-incompatible with the selected observations). */
  error?: string;
}

const METRIC_INTRINSIC_DIMENSIONS: Readonly<Record<string, string>> = {
  totalvolume: 'mass',
  volume: 'mass',
  resistance: 'mass',
  weight: 'mass',
  e1rm: 'mass',
  'calc.e1rm': 'mass',
  reps: 'count',
  totalreps: 'count',
  rounds: 'count',
  duration: 'duration',
  elapsed: 'duration',
  tis: 'duration',
  'calc.sleep': 'duration',
  distance: 'distance',
  totaldistance: 'distance',
  speed: 'speed',
  pace: 'pace',
  energy: 'energy',
  calories: 'energy',
  'calc.metminutes': 'ratio',
  sessionload: 'ratio',
  'calc.adherence': 'ratio',
  'calc.acwr': 'ratio',
  'calc.readiness': 'ratio',
  'calc.monotony': 'ratio',
  'calc.strain': 'ratio',
  'calc.ctl': 'ratio',
  'calc.atl': 'ratio',
  'calc.tsb': 'ratio',
  'calc.hrv': 'duration',
  'calc.soreness': 'ratio',
  'calc.pct1rm': 'ratio',
  'calc.mvcbw': 'ratio',
  'calc.sends': 'count',
};

const NATURAL_DURATION_METRIC_UNITS: Readonly<Record<string, string>> = {
  'calc.hrv': 'ms',
  'calc.sleep': 'h',
};

function intrinsicMetricDimension(metric: string | undefined): string | undefined {
  if (!metric) return undefined;
  return METRIC_INTRINSIC_DIMENSIONS[metric.trim().toLowerCase()];
}

function preserveNamedScale(dimension: string, spellings: ReadonlySet<string>): string | undefined {
  if (spellings.size === 0) return undefined;
  if (dimension === 'ratio') {
    const canonicals = new Set<string>();
    let firstSpelling: string | undefined;
    for (const s of spellings) {
      if (firstSpelling === undefined) firstSpelling = s;
      canonicals.add(lookupUnit(s)?.canonical ?? s);
    }
    if (canonicals.size === 1) {
      const only = [...canonicals][0]!;
      if (only === 'au') return [...spellings].some((s) => s === 'AU') ? 'AU' : 'au';
      if (only === 'pts' || only === '%' || only === 'ratio' || only === 'rating') {
        return only;
      }
      return firstSpelling;
    }
  }
  if (dimension === 'count') {
    const canonicals = new Set<string>();
    for (const s of spellings) canonicals.add(lookupUnit(s)?.canonical ?? s);
    if (canonicals.size === 1 && canonicals.has('rep')) {
      return 'reps';
    }
  }
  return undefined;
}

/**
 * Resolve the output unit for an aggregate result (arithmetic contract §5):
 *
 * 1. an explicit `in <unit>` directive wins when it is a known unit and
 *    dimensionally compatible with the observations (and intrinsic metric dimension);
 *    incompatible → error for the affected calculation;
 * 2. otherwise a consistent named scale inside `ratio`/`count` (`pts`, `AU`,
 *    `%`, `reps`) is preserved, else `preferred` applies ONLY when its catalog
 *    dimension matches the observations' dimension, else system default;
 * 3. observations with no unit at all stay unitless — no first-record
 *    fallback, no reinterpretation of stored measurements.
 */
export function resolveOutputUnit(
  facts: ReadonlyArray<UnitBearingFact>,
  {
    directive,
    preferred,
    metric,
  }: { directive?: string; preferred?: string; metric?: string },
): OutputUnitResolution {
  const spellings = new Set<string>();
  for (const fact of facts) {
    const unit = fact.unit ?? fact.metricUnit;
    if (unit) spellings.add(unit);
  }

  // Determine the observations' shared dimension; unknown spellings are
  // errors — an explicit unknown unit is never passed through.
  let dimension: string | undefined;
  for (const spelling of spellings) {
    const dim = dimensionKeyOf(spelling);
    if (!dim) {
      return { error: `Unknown unit "${spelling}"`, convert: false };
    }
    if (dimension && dim !== dimension) {
      return { error: `Incompatible units in one calculation (${[...spellings].join(', ')})`, convert: false };
    }
    dimension = dim;
  }

  if (directive) {
    const directiveDim = dimensionKeyOf(directive);
    if (!directiveDim) {
      return { error: `Unknown unit "${directive}"`, convert: false };
    }
    if (dimension && directiveDim !== dimension) {
      return { error: `Output unit "${directive}" is not compatible with this result's dimension`, convert: false };
    }
    if (!dimension) {
      const metricDim = intrinsicMetricDimension(metric);
      if (metricDim && directiveDim !== metricDim) {
        return { error: `Output unit "${directive}" is not compatible with metric "${metric}" (${metricDim})`, convert: false };
      }
      return { unit: directive, convert: false };
    }
    return { unit: directive, convert: true };
  }

  if (dimension) {
    if (preferred) {
      const prefDim = dimensionKeyOf(preferred);
      if (prefDim === dimension) {
        const prefCanon = lookupUnit(preferred)?.canonical ?? preferred;
        return { unit: prefCanon, convert: true };
      }
    }
    const naturalDurationUnit = dimension === 'duration' && metric
      ? NATURAL_DURATION_METRIC_UNITS[metric.trim().toLowerCase()]
      : undefined;
    if (naturalDurationUnit) {
      const allInNaturalUnit = Array.from(spellings).every(
        (s) => (lookupUnit(s)?.canonical ?? s.toLowerCase()) === naturalDurationUnit,
      );
      return { unit: naturalDurationUnit, convert: !allInNaturalUnit };
    }
    const preserved = preserveNamedScale(dimension, spellings);
    if (preserved !== undefined) {
      return { unit: preserved, convert: false };
    }
    const fallback = systemDefaultUnit(dimension as Parameters<typeof systemDefaultUnit>[0]);
    return { unit: fallback, convert: fallback !== undefined };
  }
  return { unit: undefined, convert: false };
}
