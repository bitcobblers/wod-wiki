/**
 * Parity test harness (#879) — replays fixture workout logs through the
 * composed calculation engine and diffs Tier-1 annotations and Tier-2
 * projections against GOLDEN records of the legacy processors' outputs
 * (parity.golden.ts, captured from the verified legacy run before the
 * eight processor classes were deleted): values, units, origins, and fact
 * identity (via slot mapping; timestamps normalized).
 *
 * The legacy↔composed diff ran live as the cutover gate; the harness now
 * persists as the permanent regression suite (#849) — the dual system was
 * never shipped. Every intentional delta lands on the signed accept-list
 * below — the behavioral changelog of the migration, each entry tied to a
 * §10 requirement or a closed-ticket decision. The accept-list is minimal
 * by construction: an entry that never fires fails the suite.
 *
 * Difficulty ladder: distance → reps → pace/power → volume (pairing proof)
 * → metMinutes → sessionLoad → TIS.
 */
import { describe, expect, it } from 'vitest';
import { IMetric, MetricOrigin, MetricType } from '@bitcobblers/wod-wiki-core';
import { IOutputStatement, OutputStatement } from '@bitcobblers/wod-wiki-core';
import { AnalyticsEngine } from '../../src/analytics/AnalyticsEngine';
import { TwoPassEffortResolutionProcess } from '../../src/analytics/TwoPassEffortResolutionProcess';
import { ProjectionResult } from '../../src/analytics/ProjectionResult';
import { InMemoryEffortRegistry } from '../../src/effort-registry/InMemoryEffortRegistry';
import { EffortResolver } from '../../src/effort-registry/EffortResolver';
import type { IEffort, IEffortResolver } from '../../src/effort-registry/types';
import { createCalcEngine } from '../../src/analytics/calc/factory';
import { LEGACY_GOLDEN } from '../../src/analytics/calc/parity.golden';

// ── Resolver fixture ─────────────────────────────────────────────────────

const seedEffort = (slug: string, label: string, met: number, discipline: string): IEffort => ({
  id: `effort-${slug}`,
  slug,
  label,
  aliases: [],
  baseAttributes: { met, discipline: discipline as IEffort['baseAttributes']['discipline'] },
  registrySource: 'bundled',
});

function makeResolver(): IEffortResolver {
  const registry = new InMemoryEffortRegistry();
  registry.seed([
    seedEffort('thruster', 'Thruster', 8.5, 'strength'),
    seedEffort('rowing', 'Rowing', 7.0, 'rowing'),
    seedEffort('burpee', 'Burpee', 10.0, 'bodyweight'),
    seedEffort('rest', 'Rest', 2.0, 'recovery'),
  ]);
  return new EffortResolver(registry);
}

// ── Log fixtures ─────────────────────────────────────────────────────────

const seg = (metrics: IMetric[], stackLevel = 1): OutputStatement =>
  new OutputStatement({
    outputType: 'segment',
    timeSpan: { started: 0, ended: 0 },
    sourceBlockKey: 'blk',
    stackLevel,
    metrics,
  });

const effort = (label: string): IMetric => ({ type: MetricType.Effort, value: label, origin: 'parser' });
const elapsed = (ms: number): IMetric => ({ type: MetricType.Elapsed, value: ms, origin: 'runtime' });
const repN = (n: number): IMetric => ({ type: MetricType.Rep, value: n, origin: 'runtime' });
const resistanceN = (kg: number): IMetric => ({ type: MetricType.Resistance, value: kg, origin: 'runtime' });
const distanceM = (m: number): IMetric => ({ type: MetricType.Distance, value: { amount: m, units: 'm' }, origin: 'runtime' });
const sessionRpe = (n: number): IMetric => ({ type: MetricType.SessionRPE, value: n, origin: 'user' });

// ── Engine paths ─────────────────────────────────────────────────────────

function runComposed(segments: IOutputStatement[], vo2max?: number): PathResult {
  const resolver = makeResolver();
  const engine = new AnalyticsEngine();
  engine.addRealtimeProcessor(new TwoPassEffortResolutionProcess(resolver));
  const calc = createCalcEngine('time', { effortResolver: resolver, userProfile: vo2max === undefined ? undefined : { vo2max } });
  engine.addRealtimeProcessor(calc);
  engine.addSummaryProcessor(calc);
  return runPath(engine, segments);
}

interface AnnotationRow {
  segment: number;
  type: string;
  unit?: string;
  origin: MetricOrigin;
  value: unknown;
}

interface PathResult {
  annotations: AnnotationRow[];
  projections: ProjectionResult[];
}

/** Types emitted by the two-phase composed library calcs (new Tier-1 surface). */
const LIBRARY_ANNOTATION_TYPES = new Set(['segmentVolume', 'effortRpe', 'metMinutes', 'metMinutesEstimated']);

function runPath(engine: AnalyticsEngine, segments: IOutputStatement[]): PathResult {
  // Snapshot by reference: TwoPass rebuilds the container (clear+add) around
  // the inserted effort-data metric, so index-slicing is unreliable.
  const before = segments.map((s) => new Set(s.metrics.rawMetrics));
  for (const segment of segments) engine.run(segment);
  const annotations: AnnotationRow[] = [];
  segments.forEach((segment, i) => {
    for (const metric of segment.metrics.rawMetrics) {
      if (before[i].has(metric)) continue;
      if (metric.type === 'effort-data') continue; // shared infrastructure, both paths
      annotations.push({ segment: i, type: metric.type as string, unit: metric.unit, origin: metric.origin, value: metric.value });
    }
  });
  const outputs = engine.finalize();
  const projections = outputs.map((output) => {
    const label = output.metrics.rawMetrics.find((m) => m.type === MetricType.Label);
    const value = output.metrics.rawMetrics.find((m) => m.type !== MetricType.Label && typeof m.value === 'number');
    return {
      name: String(label?.value ?? ''),
      value: value?.value as number,
      unit: value?.unit ?? '',
      metricType: value?.type,
      timeSpan: output.timeSpan,
      origin: value?.origin ?? 'analyzed',
      metadata: value?.metadata,
    } satisfies ProjectionResult;
  });
  return { annotations, projections };
}

// ── Slot mapping (fact identity across the key rename) ───────────────────

function legacySlot(p: ProjectionResult): string {
  const slug = p.metadata?.effortSlug as string | undefined;
  switch (p.name) {
    case 'Total Reps': return slug ? `reps:${slug}` : 'reps';
    case 'Total Distance': return 'distance';
    case 'Volume Load': return 'totalVolume';
    case 'Total Volume': return `totalVolume:${slug}`;
    case 'Energy': return 'calc.metMinutes';
    case 'Training Load': return 'sessionLoad';
    case 'Training Intensity Score': return 'tis';
    default: return `unknown:${p.name}`;
  }
}

function composedSlot(p: ProjectionResult): string {
  const key = (p.metadata?.canonicalKey as string) ?? p.name;
  const slug = p.metadata?.effortSlug as string | undefined;
  return slug ? `${key}:${slug}` : key;
}

// ── Diff + signed accept-list ────────────────────────────────────────────

interface Delta {
  kind:
    | 'annotation-mismatch'
    | 'annotation-only-composed'
    | 'annotation-only-legacy'
    | 'projection-mismatch'
    | 'projection-only-composed'
    | 'projection-only-legacy'
    | 'metadata-mismatch';
  where: string;
  field: string;
  legacy: unknown;
  composed: unknown;
}

interface AcceptEntry {
  id: string;
  reason: string;
  match: (d: Delta) => boolean;
  used: number;
}

const close = (a: unknown, b: unknown, tolerance: number): boolean =>
  typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance;

/** Legacy stored values were pre-rounded (1dp for reps/min + power, 2dp for m/s + min/km). */
const roundingTolerance = (unit: string | undefined): number =>
  unit === 'm/s' || unit === 'min/km' ? 0.005 : 0.05;

const ACCEPT_LIST: AcceptEntry[] = [
  {
    id: 'pace-power-unrounded-storage',
    reason: '§10.9 — rounding moves to the display layer; stored values are no longer pre-rounded.',
    match: (d) =>
      d.kind === 'annotation-mismatch' && d.field === 'value'
      && close(d.legacy, d.composed, roundingTolerance(d.where.split(':')[1])),
    used: 0,
  },
  {
    id: 'metminutes-unrounded-storage',
    reason: 'WW-078 / §10.9 — rounding moves to the display layer; calc.metMinutes preserves float precision.',
    match: (d) =>
      d.kind === 'projection-mismatch' && d.where === 'calc.metMinutes' && d.field === 'value'
      && typeof d.composed === 'number' && Math.round(d.composed) === d.legacy,
    used: 0,
  },
  {
    id: 'tier1-library-annotations-new',
    reason: 'spec §1.1 — phase-1 library annotations (segmentVolume, effortRpe, metMinutes, metMinutesEstimated) are the new Tier-1 surface feeding workout aggregates; legacy computed them workout-side only.',
    match: (d) => d.kind === 'annotation-only-composed' && LIBRARY_ANNOTATION_TYPES.has(d.where.split(':')[0]),
    used: 0,
  },
  {
    id: 'power-raw-resistance-restored',
    reason: 'legacy PowerEnrichmentProcess reads only {amount,units} resistance and silently emits nothing for the raw-number shape real logs carry; the composed power calc reads both.',
    match: (d) => d.kind === 'annotation-only-composed' && d.where.startsWith('power:'),
    used: 0,
  },
  {
    id: 'e1rm-annotation-new',
    reason: '#904 — calc.e1rm (Epley estimated 1RM from segment load × reps) is a new segment metric; legacy never computed it.',
    match: (d) => d.kind === 'annotation-only-composed' && d.where.startsWith('calc.e1rm:'),
    used: 0,
  },
  {
    id: 'pct1rm-annotation-new',
    reason: '%1RM intensity (Epley inverse — 100/(1+reps/30)) is a new segment metric derived from logged sets; legacy never computed it.',
    match: (d) => d.kind === 'annotation-only-composed' && d.where.startsWith('calc.pct1rm:'),
    used: 0,
  },
  {
    id: 'per-exercise-volume-amount-shape',
    reason: '§10.10 — legacy per-exercise volume ignores {amount,units} resistance (workout-level accepts it); composed emits per-effort volume for both shapes.',
    match: (d) =>
      (d.kind === 'projection-only-composed' || d.kind === 'projection-mismatch' || d.kind === 'metadata-mismatch')
      && d.where.startsWith('totalVolume:'),
    used: 0,
  },
  {
    id: 'sessionload-default-rpe-origin-explicit',
    reason: '#849 resolution — the silent default-5 RPE fallback becomes an explicit analyzed-estimated variant.',
    match: (d) =>
      d.kind === 'projection-mismatch' && d.where === 'sessionLoad' && d.field === 'origin'
      && d.legacy === 'analyzed' && d.composed === 'analyzed-estimated',
    used: 0,
  },
  {
    id: 'sessionload-sessionrpe-strictly-authoritative',
    reason: 'spec §6 — user-captured SessionRPE is authoritative by variant priority; legacy let a later, higher effort-label RPE override it.',
    match: (d) =>
      (d.kind === 'projection-mismatch' && (d.where === 'sessionLoad' || d.where === 'tis') && d.field === 'value')
      || (d.kind === 'metadata-mismatch' && d.field === 'sRPE'),
    used: 0,
  },
  {
    id: 'tis-metadata-unrounded',
    reason: '§10.9 — TIS component metadata (metScore, durationScore, metMax) is no longer pre-rounded; the published TIS value is unchanged.',
    match: (d) => d.kind === 'metadata-mismatch' && d.where === 'tis',
    used: 0,
  },
  {
    id: 'legacy-provenance-metadata-dropped',
    reason: '#849 resolution 3 — provenance moves to author-managed companion counts; legacy metadata payload (usedResolvedEffort, effortOrigin, isEstimated, vo2max, …) is not reproduced.',
    match: (d) => d.kind === 'metadata-mismatch' && d.field === 'legacy-only-keys',
    used: 0,
  },
];

interface ParityReport {
  accepted: Delta[];
  rejected: Delta[];
}

function diff(legacy: PathResult, composed: PathResult): ParityReport {
  const deltas: Delta[] = [];

  // Tier-1 annotations, aligned by (segment, type, unit).
  const keyOf = (a: AnnotationRow) => `${a.segment}|${a.type}|${a.unit ?? ''}`;
  const legacyAnn = new Map(legacy.annotations.map((a) => [keyOf(a), a]));
  const composedAnn = new Map(composed.annotations.map((a) => [keyOf(a), a]));
  for (const [key, l] of legacyAnn) {
    const c = composedAnn.get(key);
    const where = `${l.type}:${l.unit ?? ''}@seg${l.segment}`;
    if (!c) {
      deltas.push({ kind: 'annotation-only-legacy', where, field: '*', legacy: l.value, composed: undefined });
    } else if (l.value !== c.value || l.origin !== c.origin) {
      if (l.value !== c.value) deltas.push({ kind: 'annotation-mismatch', where, field: 'value', legacy: l.value, composed: c.value });
      if (l.origin !== c.origin) deltas.push({ kind: 'annotation-mismatch', where, field: 'origin', legacy: l.origin, composed: c.origin });
    }
  }
  for (const [key, c] of composedAnn) {
    if (!legacyAnn.has(key)) {
      deltas.push({ kind: 'annotation-only-composed', where: `${c.type}:${c.unit ?? ''}@seg${c.segment}`, field: '*', legacy: undefined, composed: c.value });
    }
  }

  // Tier-2 projections, aligned by slot.
  const legacyProj = new Map(legacy.projections.map((p) => [legacySlot(p), p]));
  const composedProj = new Map(composed.projections.map((p) => [composedSlot(p), p]));
  for (const [slot, l] of legacyProj) {
    const c = composedProj.get(slot);
    if (!c) {
      deltas.push({ kind: 'projection-only-legacy', where: slot, field: '*', legacy: l.value, composed: undefined });
      continue;
    }
    if (l.value !== c.value) deltas.push({ kind: 'projection-mismatch', where: slot, field: 'value', legacy: l.value, composed: c.value });
    if (l.unit !== c.unit) deltas.push({ kind: 'projection-mismatch', where: slot, field: 'unit', legacy: l.unit, composed: c.unit });
    if ((l.origin ?? 'analyzed') !== (c.origin ?? 'analyzed')) {
      deltas.push({ kind: 'projection-mismatch', where: slot, field: 'origin', legacy: l.origin ?? 'analyzed', composed: c.origin ?? 'analyzed' });
    }
    // Metadata: shared keys compared loosely; legacy-only keys are accepted provenance drops.
    const sharedKeys = ['totalSets', 'sRPE', 'durationMinutes', 'metScore', 'rpeScore', 'durationScore', 'disciplineFactor', 'metMax'];
    for (const key of sharedKeys) {
      const lv = l.metadata?.[key];
      if (lv === undefined) continue;
      const cv = c.metadata?.[key];
      if (lv !== cv) deltas.push({ kind: 'metadata-mismatch', where: slot, field: key, legacy: lv, composed: cv });
    }
    const legacyOnly = Object.keys(l.metadata ?? {}).filter(
      (k) => !sharedKeys.includes(k) && !['exerciseName', 'effortSlug', 'source'].includes(k),
    );
    if (legacyOnly.length > 0) {
      deltas.push({ kind: 'metadata-mismatch', where: slot, field: 'legacy-only-keys', legacy: legacyOnly, composed: undefined });
    }
  }
  for (const [slot, c] of composedProj) {
    if (!legacyProj.has(slot)) {
      deltas.push({ kind: 'projection-only-composed', where: slot, field: '*', legacy: undefined, composed: c.value });
    }
  }

  const accepted: Delta[] = [];
  const rejected: Delta[] = [];
  for (const delta of deltas) {
    const entry = ACCEPT_LIST.find((e) => e.match(delta));
    if (entry) {
      entry.used++;
      accepted.push(delta);
    } else {
      rejected.push(delta);
    }
  }
  return { accepted, rejected };
}

// ── Fixtures (fresh copies per path — both mutate their inputs) ──────────

/** Ladder 1: distance — rowing + running segments with distance. */
const distanceLog = (): IOutputStatement[] => [
  seg([effort('Rowing'), elapsed(120_000), distanceM(500)]),
  seg([effort('Rowing'), elapsed(180_000), distanceM(600)]),
];

/** Ladder 2: reps — burpee clusters with a rest segment. */
const repsLog = (): IOutputStatement[] => [
  seg([effort('Burpee'), elapsed(60_000), repN(10)]),
  seg([effort('Rest'), elapsed(30_000)]),
  seg([effort('Burpee'), elapsed(60_000), repN(12)]),
];

/** Ladder 3: pace + power — raw-number resistance (real log shape) and the {amount,units} shape. */
const pacePowerLog = (): IOutputStatement[] => [
  seg([effort('Thruster'), elapsed(90_000), repN(21), resistanceN(43)]),
  seg([effort('Thruster'), elapsed(60_000), repN(10), { type: MetricType.Resistance, value: { amount: 43, units: 'kg' }, origin: 'runtime' }]),
  seg([effort('Rowing'), elapsed(120_000), distanceM(400)]),
];

/** Ladder 4: volume — the pairing proof. In-segment pairs across sets and efforts. */
const volumeLog = (): IOutputStatement[] => [
  seg([effort('Thruster'), elapsed(90_000), repN(10), resistanceN(43)]),
  seg([effort('Thruster'), elapsed(90_000), repN(8), resistanceN(43)]),
  seg([effort('Burpee'), elapsed(60_000), repN(15)]),
];

/** Ladder 5: metMinutes — resolved, unresolved (fuzzy miss), and never-seen effort. */
const metMinutesLog = (): IOutputStatement[] => [
  seg([elapsed(300_000)]), // no effort seen yet → default MET, estimated
  seg([effort('Thruster'), elapsed(600_000)]),
  seg([effort('Underwater Basketweaving'), elapsed(300_000)]), // fuzzy unresolved → synthetic, estimated
  seg([elapsed(120_000)]), // last-seen carries (basketweaving's unresolved MET 5.0)
];

/** Ladder 6: sessionLoad — root-vs-leaf duration, label RPE, SessionRPE, default. */
const sessionLoadLog = (): IOutputStatement[] => [
  seg([elapsed(900_000)], 0), // root elapsed wins (no double count of children)
  seg([effort('Thruster'), elapsed(600_000), repN(21), resistanceN(43)]),
  seg([effort('Rest'), elapsed(300_000)]),
];
const sessionLoadLabelLog = (): IOutputStatement[] => [
  seg([effort('Hard'), elapsed(600_000)]),
];
const sessionLoadCapturedLog = (): IOutputStatement[] => [
  seg([sessionRpe(6), effort('Hard'), elapsed(600_000)]),
];
const sessionLoadDefaultLog = (): IOutputStatement[] => [
  seg([elapsed(600_000)]),
];

/** Ladder 7: TIS — the composite stress test. */
const tisLog = (): IOutputStatement[] => [
  seg([effort('Thruster'), elapsed(600_000), repN(21), resistanceN(43), sessionRpe(7)]),
  seg([effort('Rowing'), elapsed(600_000), distanceM(2000)]),
];
const tisUnresolvedLog = (): IOutputStatement[] => [
  seg([effort('Underwater Basketweaving'), elapsed(600_000)]),
];

// ── The ladder ───────────────────────────────────────────────────────────

const FIXTURES: { name: string; log: () => IOutputStatement[]; vo2max?: number }[] = [
  { name: '1 distance', log: distanceLog },
  { name: '2 reps', log: repsLog },
  { name: '3 pace-power', log: pacePowerLog },
  { name: '4 volume-pairing', log: volumeLog },
  { name: '5 metMinutes', log: metMinutesLog },
  { name: '6 sessionLoad-root', log: sessionLoadLog },
  { name: '6 sessionLoad-label-rpe', log: sessionLoadLabelLog },
  { name: '6 sessionLoad-captured-rpe', log: sessionLoadCapturedLog },
  { name: '6 sessionLoad-default-rpe', log: sessionLoadDefaultLog },
  { name: '7 tis-personalized', log: tisLog, vo2max: 42.5 },
  { name: '7 tis-population', log: tisLog },
  { name: '7 tis-unresolved', log: tisUnresolvedLog, vo2max: 42.5 },
];

describe('parity harness: legacy golden records vs composed engine', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name} matches the golden exactly or lands on the signed accept-list`, () => {
      const legacy = LEGACY_GOLDEN[fixture.name] as PathResult;
      const composed = runComposed(fixture.log(), fixture.vo2max);
      const report = diff(legacy, composed);
      if (report.rejected.length > 0) {
        console.log(`REJECTED DELTAS [${fixture.name}]:`, JSON.stringify(report.rejected, null, 2));
      }
      expect(report.rejected).toEqual([]);
    });
  }

  it('accept-list is signed and minimal: every entry fired at least once', () => {
    for (const fixture of FIXTURES) {
      diff(LEGACY_GOLDEN[fixture.name] as PathResult, runComposed(fixture.log(), fixture.vo2max));
    }
    const unused = ACCEPT_LIST.filter((e) => e.used === 0).map((e) => e.id);
    if (unused.length > 0) console.log('UNUSED ACCEPT ENTRIES:', unused);
    expect(unused).toEqual([]);
    console.log('Signed accept-list usage:', ACCEPT_LIST.map((e) => `${e.id}×${e.used}`).join(', '));
  });
});
