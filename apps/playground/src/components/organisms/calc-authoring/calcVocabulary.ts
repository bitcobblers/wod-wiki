/**
 * Vocabulary for the calc-line editor — atoms, functions, units, lookup
 * tables, and scope-aware context nodes. Shared by the CM6 highlighting
 * language, the typeahead completion source, and diagnostics so the surface
 * never drifts from the engine's static environment (atoms.ts, units.ts).
 *
 * No editor dependencies — pure data + helpers (unit-testable).
 */

import { CONTEXT_ATOMS, STREAM_ATOMS, AGGREGATE_BUILTINS } from '@bitcobblers/wod-wiki-engine';
import { UNITS } from '@bitcobblers/wod-wiki-engine';
import { DimVector } from '@bitcobblers/wod-wiki-engine';

/** Scope keywords (highlighting). */
export const SCOPE_WORDS = ['segment', 'workout', 'store'] as const;

/** Line-structure keywords (highlighting). */
export const CLAUSE_WORDS = [
  'when', 'where', 'key', 'grouped', 'label', 'emit', 'meta', 'estimated',
  'library', 'on', 'by', 'without', 'and', 'or', 'not',
] as const;

/** Scalar + stream + series builtin function names. */
export const FUNCTION_NAMES: readonly string[] = [
  'convert', 'lookup', 'has',
  'round', 'floor', 'ceil', 'abs', 'clamp', 'min', 'max',
  'sum', 'avg', 'count', 'last',
  'windowMean', 'windowSum', 'windowSd', 'mean',
];

/** Segment-scope atoms: current segment metrics + context. */
export const SEGMENT_ATOMS: readonly { name: string; dim: DimVector; detail: string }[] = [
  { name: 'elapsed', dim: STREAM_ATOMS.elapsed.dim, detail: 's (time)' },
  { name: 'reps', dim: STREAM_ATOMS.reps.dim, detail: 'count' },
  { name: 'resistance', dim: STREAM_ATOMS.resistance.dim, detail: 'kg (mass)' },
  { name: 'distance', dim: STREAM_ATOMS.distance.dim, detail: 'm (length)' },
  { name: 'effort', dim: CONTEXT_ATOMS.effort, detail: 'resolved effort slug' },
  { name: 'effortLabel', dim: CONTEXT_ATOMS.effortLabel, detail: 'raw effort label' },
];

/** Workout-scope context atoms. */
export const WORKOUT_CONTEXT_ATOMS: readonly { name: string; dim: DimVector; detail: string }[] = [
  { name: 'sessionRpe', dim: CONTEXT_ATOMS.sessionRpe, detail: 'captured session RPE' },
  { name: 'session.duration', dim: CONTEXT_ATOMS['session.duration'], detail: 'workout duration' },
  { name: 'profile.vo2max', dim: CONTEXT_ATOMS['profile.vo2max'], detail: 'user VO₂max (mL/kg/min)' },
];

/** Known stream aggregate metric names (they scan segment annotations). */
export const STREAM_METRICS: readonly string[] = Object.keys(STREAM_ATOMS);

/** Aggregate builtin names usable in workout scope. */
export const AGGREGATE_NAMES: readonly string[] = Object.keys(AGGREGATE_BUILTINS);

/** Lookup tables exposed by the registry adapters. */
export const LOOKUP_TABLES: readonly { name: string; detail: string; fields: readonly string[] }[] = [
  { name: 'effort', detail: 'effort library', fields: ['met', 'disciplineFactor', 'discipline', 'intensityTier', 'resolvedFrom'] },
  { name: 'rpe-labels', detail: 'effort label → RPE', fields: ['rpe'] },
  { name: 'profile', detail: 'user profile', fields: ['vo2max'] },
  { name: 'disciplines', detail: 'canonical disciplines', fields: ['disciplineFactor'] },
];

/** All unit names (from the unit registry). */
export const UNIT_NAMES: readonly string[] = Object.keys(UNITS);

/** WQL atom aggregators (store scope). */
export const WQL_AGGREGATORS: readonly string[] = Object.keys(AGGREGATE_BUILTINS);

/** Units whose dimension matches the given vector (or all, when unknown). */
export function unitsForDimension(dim: DimVector | undefined): readonly string[] {
  if (!dim) return UNIT_NAMES;
  return UNIT_NAMES.filter((u) => {
    const def = UNITS[u];
    if (!def) return false;
    return def.dim.every((x, i) => x === dim[i]);
  });
}
