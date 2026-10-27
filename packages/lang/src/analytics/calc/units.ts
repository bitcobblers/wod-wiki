/**
 * Unit registry for the composed calculations layer.
 *
 * Every unit maps to a dimension vector plus a conversion factor to the
 * vector's canonical base unit (ms, m, kg, reps, cal, and products thereof).
 * `convert(x, u)` is vector-checked: source and target vectors must match,
 * then the scalar rescales by `factor(from) / factor(to)`.
 *
 * Named zero-vector units (AU, pts, MET-min, ratio) are **authoritative
 * casts** (spec §5.3): declaring them as an output unit overrides the
 * computed vector instead of failing validation.
 */

import { DimVector, DIM_ZERO, DIM_TIME, DIM_LENGTH, DIM_MASS, DIM_COUNT, DIM_ENERGY, dimEquals } from './dimensions';

export interface UnitDef {
  readonly dim: DimVector;
  /** Multiply a value in this unit by `factor` to get the base-unit value. */
  readonly factor: number;
}

export const AUTHORITATIVE_CASTS: Record<string, true> = { AU: true, pts: true, 'MET-min': true, ratio: true };

const KG_PER_LB = 0.45359237;
const M_PER_MI = 1609.344;

export const UNITS: Record<string, UnitDef> = {
  // time — base ms
  ms: { dim: DIM_TIME, factor: 1 },
  s: { dim: DIM_TIME, factor: 1000 },
  sec: { dim: DIM_TIME, factor: 1000 },
  min: { dim: DIM_TIME, factor: 60_000 },
  h: { dim: DIM_TIME, factor: 3_600_000 },
  hr: { dim: DIM_TIME, factor: 3_600_000 },
  // length — base m
  m: { dim: DIM_LENGTH, factor: 1 },
  km: { dim: DIM_LENGTH, factor: 1000 },
  mi: { dim: DIM_LENGTH, factor: M_PER_MI },
  // mass — base kg
  kg: { dim: DIM_MASS, factor: 1 },
  lb: { dim: DIM_MASS, factor: KG_PER_LB },
  lbs: { dim: DIM_MASS, factor: KG_PER_LB },
  // count — base reps
  rep: { dim: DIM_COUNT, factor: 1 },
  reps: { dim: DIM_COUNT, factor: 1 },
  // energy — base cal
  cal: { dim: DIM_ENERGY, factor: 1 },
  kcal: { dim: DIM_ENERGY, factor: 1000 },
  // dimensionless
  MET: { dim: DIM_ZERO, factor: 1 },
  // resilience / score display units — DIM_ZERO keep the store-scope
  // (dimensionless) series valid; 'count' is genuinely count-dimensioned
  // (sends, sessions) so segment facts can carry it.
  '%': { dim: DIM_ZERO, factor: 1 },
  rating: { dim: DIM_ZERO, factor: 1 },
  bpm: { dim: DIM_ZERO, factor: 1 },
  count: { dim: DIM_COUNT, factor: 1 },
  // speed — base m/ms
  'm/s': { dim: [1, 0, -1, 0, 0], factor: 0.001 },
  'km/h': { dim: [1, 0, -1, 0, 0], factor: 1000 / 3_600_000 },
  // pace — base ms/m
  'sec/km': { dim: [-1, 0, 1, 0, 0], factor: 1 },
  'min/km': { dim: [-1, 0, 1, 0, 0], factor: 60 },
  'min/mi': { dim: [-1, 0, 1, 0, 0], factor: 60_000 / M_PER_MI },
  // rep rate — base reps/ms
  'reps/min': { dim: [0, 0, -1, 1, 0], factor: 1 / 60_000 },
  // power — base kg·reps/ms
  'kg/s': { dim: [0, 1, -1, 1, 0], factor: 0.001 },
  'lb/s': { dim: [0, 1, -1, 1, 0], factor: KG_PER_LB / 1000 },
};

/** Authoritative casts are also valid output units (zero-vector override). */
export function getUnit(name: string): UnitDef | undefined {
  const def = UNITS[name];
  if (def) return def;
  if (AUTHORITATIVE_CASTS[name]) return { dim: DIM_ZERO, factor: 1 };
  return undefined;
}

/**
 * Convert a scalar between units. Vectors must match (static checking catches
 * mismatches at registration; this is the runtime guard). A value with no
 * recorded unit is treated as already being in the vector's base unit.
 */
export function convertScalar(value: number, fromUnit: string | undefined, toUnit: string): number {
  const to = UNITS[toUnit];
  if (!to) throw new CalcUnitError(`Unknown unit: ${toUnit}`);
  if (!fromUnit) return value / to.factor;
  const from = UNITS[fromUnit];
  if (!from) throw new CalcUnitError(`Unknown unit: ${fromUnit}`);
  if (!dimEquals(from.dim, to.dim)) {
    throw new CalcUnitError(`Cannot convert from ${fromUnit} to ${toUnit}: dimension mismatch`);
  }
  return (value * from.factor) / to.factor;
}

export class CalcUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalcUnitError';
  }
}

/**
 * Compose units through `*`. Dimensionless sides contribute nothing; count
 * units (`reps`) drop when any non-count unit is present — the domain
 * convention behind `kg` (volume) and `kg/s` (power) rather than `kg·reps`.
 */
export function composeMulUnit(a: string | undefined, aDim: DimVector, b: string | undefined, bDim: DimVector, resultDim: DimVector): string | undefined {
  // Scalar multiplication must not erase an authored unit when the
  // resulting vector is dimensionless (e.g. sum(work) * 2).
  if (dimEquals(resultDim, DIM_ZERO)) {
    if (a && !b) return a;
    if (b && !a) return b;
    return dimEquals(aDim, bDim) ? a ?? b : undefined;
  }
  const parts: string[] = [];
  for (const [u, d] of [[a, aDim], [b, bDim]] as const) {
    if (!u || dimEquals(d, DIM_ZERO)) continue;
    parts.push(u);
  }
  const nonCount = parts.filter((u) => !dimEquals(UNITS[u]?.dim ?? DIM_ZERO, DIM_COUNT));
  const kept = nonCount.length > 0 ? nonCount : parts;
  return kept.length > 0 ? kept.join('·') : undefined;
}

/** Compose units through `/` (`m` ÷ `s` → `m/s`). */
export function composeDivUnit(a: string | undefined, b: string | undefined, bDim: DimVector, resultDim: DimVector): string | undefined {
  if (dimEquals(resultDim, DIM_ZERO)) return undefined;
  if (!b || dimEquals(bDim, DIM_ZERO)) return a;
  if (!a) return undefined;
  return `${a}/${b}`;
}
