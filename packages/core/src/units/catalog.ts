/**
 * Unit catalog — the shared home for unit recognition, conversion evidence,
 * and the system default output table (wayfinder decision ticket 21;
 * consumed by wql's arithmetic rewrite, ticket 13).
 *
 * Recognition spellings are case-insensitive through canonical spellings and
 * aliases. Every entry carries its conversion evidence: the physical
 * dimension it measures and the fixed factor converting it to that
 * dimension's base unit. Compound units (speed, pace) convert through their
 * own scale factors to the compound base.
 *
 * `bw` (body-weight-relative load) is deliberately NOT a fixed-factor entry:
 * it requires genuine measurement-time context persisted with the value
 * (ticket 14's conversion evidence) — never a constant kg conversion, never
 * today's body mass reinterpreting history (missing-context limitation).
 */

/** Named result dimensions — the keys of the system default table. */
export type DimensionKey =
  | 'mass'
  | 'distance'
  | 'duration'
  | 'count'
  | 'count-rate'
  | 'energy'
  | 'speed'
  | 'pace'
  | 'ratio';

/** Error taxonomy (decision ticket 21). */
export type UnitErrorCode =
  | 'unknown-unit'
  | 'dimension-mismatch'
  | 'scale-mismatch'
  | 'missing-context'
  | 'non-finite'
  | 'non-convertible';

export class UnitConversionError extends Error {
  readonly code: UnitErrorCode;
  constructor(code: UnitErrorCode, message: string) {
    super(message);
    this.name = 'UnitConversionError';
    this.code = code;
  }
}

export interface UnitDefinition {
  /** Canonical spelling (e.g. `kg`, `mi`, `min/km`). */
  readonly canonical: string;
  /** Named result dimension. */
  readonly dimension: DimensionKey;
  /** Fixed factor converting a value of this unit to the dimension's base
   *  unit (conversion evidence). */
  readonly factor: number;
  /** Registered alternate spellings (case-insensitive at lookup). */
  readonly aliases?: readonly string[];
}

/**
 * Base units per dimension: mass `kg`, distance `m`, duration `s`,
 * count `count`, energy `cal`, speed `m/s`, pace `min/km`; ratio is
 * unitless (factor 1).
 */
export const UNIT_CATALOG: readonly UnitDefinition[] = [
  // Distance — base m
  { canonical: 'm', dimension: 'distance', factor: 1, aliases: ['meter', 'meters', 'metre', 'metres'] },
  { canonical: 'km', dimension: 'distance', factor: 1000, aliases: ['kilometer', 'kilometers', 'kilometre', 'kilometres'] },
  { canonical: 'cm', dimension: 'distance', factor: 0.01, aliases: ['centimeter', 'centimeters'] },
  { canonical: 'mm', dimension: 'distance', factor: 0.001, aliases: ['millimeter', 'millimeters'] },
  { canonical: 'ft', dimension: 'distance', factor: 0.3048, aliases: ['foot', 'feet'] },
  { canonical: 'in', dimension: 'distance', factor: 0.0254, aliases: ['inch', 'inches'] },
  { canonical: 'yd', dimension: 'distance', factor: 0.9144, aliases: ['yard', 'yards'] },
  { canonical: 'mi', dimension: 'distance', factor: 1609.344, aliases: ['mile', 'miles'] },
  // Mass — base kg
  { canonical: 'kg', dimension: 'mass', factor: 1, aliases: ['kilogram', 'kilograms', 'kilo', 'kilos'] },
  { canonical: 'g', dimension: 'mass', factor: 0.001, aliases: ['gram', 'grams'] },
  { canonical: 'lb', dimension: 'mass', factor: 0.45359237, aliases: ['lbs', 'pound', 'pounds'] },
  // Duration — base s
  { canonical: 'ms', dimension: 'duration', factor: 0.001, aliases: ['millisecond', 'milliseconds'] },
  { canonical: 's', dimension: 'duration', factor: 1, aliases: ['sec', 'secs', 'second', 'seconds'] },
  { canonical: 'min', dimension: 'duration', factor: 60, aliases: ['mins', 'minute', 'minutes'] },
  { canonical: 'h', dimension: 'duration', factor: 3600, aliases: ['hr', 'hrs', 'hour', 'hours'] },
  // Count — base count. Test-result scales ("pull-up", "thruster",
  // "problem") are count-dimension scales: one of their units is one rep.
  { canonical: 'count', dimension: 'count', factor: 1 },
  { canonical: 'rep', dimension: 'count', factor: 1, aliases: ['reps'] },
  { canonical: 'pull-up', dimension: 'count', factor: 1 },
  { canonical: 'thruster', dimension: 'count', factor: 1 },
  { canonical: 'problem', dimension: 'count', factor: 1 },
  // Count-rate — base count/s; bpm (beats per minute) is its registered scale
  { canonical: 'count/s', dimension: 'count-rate', factor: 1 },
  { canonical: 'bpm', dimension: 'count-rate', factor: 1 / 60 },
  // Energy — base cal
  { canonical: 'cal', dimension: 'energy', factor: 1, aliases: ['calorie', 'calories'] },
  { canonical: 'kcal', dimension: 'energy', factor: 1000, aliases: ['kilocalorie', 'kilocalories'] },
  // Speed — base m/s
  { canonical: 'm/s', dimension: 'speed', factor: 1 },
  { canonical: 'km/h', dimension: 'speed', factor: 1000 / 3600, aliases: ['kmh', 'kph'] },
  { canonical: 'mph', dimension: 'speed', factor: 1609.344 / 3600 },
  // Pace — base min/km
  { canonical: 'min/km', dimension: 'pace', factor: 1 },
  { canonical: 'min/mi', dimension: 'pace', factor: 1000 / 1609.344 },
  { canonical: 's/m', dimension: 'pace', factor: 1 / 60 },
  // Ratio — unitless base (factor 1); percent via 100% = 1.
  // Dimensionless named scales (arbitrary units, points) share the ratio
  // dimension but are convertible only to the base — never to each other.
  { canonical: 'ratio', dimension: 'ratio', factor: 1, aliases: ['x'] },
  { canonical: '%', dimension: 'ratio', factor: 0.01, aliases: ['pct', 'percent'] },
  { canonical: 'au', dimension: 'ratio', factor: 1, aliases: ['AU'] },
  { canonical: 'pts', dimension: 'ratio', factor: 1, aliases: ['point', 'points'] },
  { canonical: 'rating', dimension: 'ratio', factor: 1, aliases: ['ratings'] },
];
const bySpelling = (() => {
  const map = new Map<string, UnitDefinition>();
  for (const def of UNIT_CATALOG) {
    map.set(def.canonical.toLowerCase(), def);
    for (const alias of def.aliases ?? []) {
      if (!map.has(alias.toLowerCase())) map.set(alias.toLowerCase(), def);
    }
  }
  return map;
})();

/** Look up a unit by canonical spelling or alias (case-insensitive). Stored
 *  event rows are a trust boundary — a missing/legacy unit arrives as
 *  undefined at runtime despite the static type. */
export function lookupUnit(spelling: string): UnitDefinition | undefined {
  if (typeof spelling !== 'string') return undefined;
  return bySpelling.get(spelling.trim().toLowerCase());
}

/** The named result dimension of a unit spelling, or undefined when the
 *  spelling is not in the catalog. */
export function dimensionKeyOf(spelling: string): DimensionKey | undefined {
  return lookupUnit(spelling)?.dimension;
}

/** System default output unit per result dimension (arithmetic contract §5;
 *  values agreed in ticket 13, home resolved in ticket 21). Ratio defaults
 *  to unitless — `undefined`, never a fabricated unit label. */
export const SYSTEM_DEFAULT_OUTPUT_UNIT: Readonly<Record<DimensionKey, string | undefined>> = Object.freeze({
  mass: 'kg',
  distance: 'm',
  duration: 's',
  count: 'count',
  'count-rate': 'count/s',
  energy: 'cal',
  speed: 'm/s',
  pace: 'min/km',
  ratio: undefined,
});

/** Default output unit for a result dimension — undefined means unitless. */
export function systemDefaultUnit(dimension: DimensionKey): string | undefined {
  return SYSTEM_DEFAULT_OUTPUT_UNIT[dimension];
}

/**
 * Strict conversion through the catalog's conversion evidence.
 *
 * Errors (`UnitConversionError`) on unknown units (`unknown-unit`) and
 * cross-dimension conversions (`dimension-mismatch`) — an explicit unknown
 * unit is never passed through and never replaced by a default.
 */
export function convertViaCatalog(value: number, from: string, to: string): number {
  const fromDef = lookupUnit(from);
  if (!fromDef) throw new UnitConversionError('unknown-unit', `Unknown unit "${from}"`);
  const toDef = lookupUnit(to);
  if (!toDef) throw new UnitConversionError('unknown-unit', `Unknown unit "${to}"`);
  if (fromDef.dimension !== toDef.dimension) {
    throw new UnitConversionError(
      'dimension-mismatch',
      `Cannot convert ${from} (${fromDef.dimension}) to ${to} (${toDef.dimension})`,
    );
  }
  // A shared zero dimension vector is not proof that arbitrary named scales
  // are interchangeable (arithmetic contract §5): dimensionless scales are
  // convertible only to the ratio base, never directly to another scale.
  if (fromDef.dimension === 'ratio' && fromDef.canonical !== toDef.canonical) {
    if (fromDef.canonical !== 'ratio' && toDef.canonical !== 'ratio') {
      throw new UnitConversionError(
        'scale-mismatch',
        `Named scales ${from} and ${to} are not interchangeable`,
      );
    }
  }
  if (!Number.isFinite(value)) {
    throw new UnitConversionError('non-finite', `Non-finite value cannot be converted`);
  }
  return (value * fromDef.factor) / toDef.factor;
}
