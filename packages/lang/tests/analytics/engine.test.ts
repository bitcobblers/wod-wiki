import { describe, expect, it } from 'vitest';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { OutputStatement, IOutputStatement } from '@bitcobblers/wod-wiki-core';
import { createCalcEngine } from '../../src/analytics/calc/factory';
import type { IEffort, IEffortResolver, ResolvedEffort } from '../../src/effort-registry/types';

// ── Fixtures ─────────────────────────────────────────────────────────────

const THRUSTER: ResolvedEffort = {
  effort: { slug: 'thruster' } as unknown as IEffort,
  definition: { slug: 'thruster' } as unknown as IEffort,
  slug: 'thruster',
  label: 'Thruster',
  met: 8.5,
  baseAttributes: { met: 8.5 },
  discipline: 'strength',
  disciplineFactor: 1.2,
  intensityTier: 'high',
  modifiers: {},
  registrySource: 'bundled',
  resolvedFrom: 'bundled',
  isEstimated: false,
};

const fakeResolver: IEffortResolver = {
  resolveBySlug: () => null,
  resolveByAlias: () => null,
  resolveFuzzy: () => THRUSTER.effort,
  resolveEffort: (label) =>
    label === 'thruster'
      ? THRUSTER
      : {
          ...THRUSTER,
          slug: 'unresolved', label, met: 5.0, discipline: undefined, disciplineFactor: 1.0,
          intensityTier: undefined, registrySource: 'synthetic-unresolved', resolvedFrom: 'default', isEstimated: true,
        },
  resolveDefinition: () => THRUSTER,
  list: () => [THRUSTER.effort],
};

const engine = (vo2max?: number, dialect = 'time') =>
  createCalcEngine(dialect, { effortResolver: fakeResolver, userProfile: vo2max === undefined ? undefined : { vo2max } });

function segment(metrics: IMetric[], stackLevel = 1): OutputStatement {
  return new OutputStatement({
    outputType: 'segment',
    timeSpan: { started: 0, ended: 0 },
    sourceBlockKey: 'blk',
    stackLevel,
    metrics,
  });
}

const effortData = (slug: string, label: string, met: number, discipline?: string): IMetric => ({
  type: 'effort-data',
  origin: 'analyzed',
  value: { slug, label, aliases: [], baseAttributes: { met, discipline }, registrySource: 'bundled' },
});

const annotations = (output: IOutputStatement, type: string): IMetric[] =>
  output.metrics.rawMetrics.filter((m) => m.type === type);

// ── Phase 1: segment scope (#874) ────────────────────────────────────────

describe('Phase 1: segment-scope pipeline', () => {
  it('annotates pace from reps (unrounded — rounding moves to display, §10.9)', () => {
    const seg = segment([
      { type: MetricType.Elapsed, value: 120_000, origin: 'runtime' },
      { type: MetricType.Rep, value: 21, origin: 'runtime' },
    ]);
    engine().process(seg);
    const pace = annotations(seg, 'pace');
    expect(pace).toHaveLength(1);
    expect(pace[0]).toMatchObject({ value: 10.5, unit: 'reps/min', origin: 'analyzed' });
  });

  it('annotates speed and runner pace from distance', () => {
    const seg = segment([
      { type: MetricType.Elapsed, value: 120_000, origin: 'runtime' },
      { type: MetricType.Distance, value: { amount: 400, units: 'm' }, origin: 'runtime' },
    ]);
    engine().process(seg);
    const pace = annotations(seg, 'pace');
    const speed = pace.find((m) => m.unit === 'm/s');
    const runner = pace.find((m) => m.unit === 'min/km');
    expect(speed?.value).toBeCloseTo(3.333, 3);
    expect(runner?.value).toBeCloseTo(5, 3);
  });

  it('annotates power with unit following the resistance source unit', () => {
    const seg = segment([
      { type: MetricType.Elapsed, value: 30_000, origin: 'runtime' },
      { type: MetricType.Rep, value: 10, origin: 'runtime' },
      { type: MetricType.Resistance, value: { amount: 60, units: 'kg' }, origin: 'runtime' },
    ]);
    engine().process(seg);
    const power = annotations(seg, 'power');
    expect(power).toHaveLength(1);
    expect(power[0]).toMatchObject({ value: 20, unit: 'kg/s', origin: 'analyzed' });
    // segmentVolume library annotation lands too (workout scope scans it)
    expect(annotations(seg, 'segmentVolume')[0]).toMatchObject({ value: 600, unit: 'kg' });
  });

  it('annotates calc.e1rm via Epley, tagged with the segment effort (#904)', () => {
    const seg = segment([
      effortData('thruster', 'Thruster', 8.5, 'strength'),
      { type: MetricType.Rep, value: 5, origin: 'runtime' },
      { type: MetricType.Resistance, value: { amount: 100, units: 'kg' }, origin: 'runtime' },
    ]);
    engine().process(seg);
    const e1rm = annotations(seg, 'calc.e1rm');
    expect(e1rm).toHaveLength(1);
    // Epley: 100 × (1 + 5/30) = 116.666… → 116.7
    expect(e1rm[0]).toMatchObject({ value: 116.7, unit: 'kg', origin: 'analyzed' });
    // Effort identity tags feed WQL `by {effort}` grouping on segment facts.
    expect(e1rm[0].metadata).toMatchObject({
      effortSlug: 'thruster',
      effortDiscipline: 'strength',
      effortIntensityTier: 'high',
    });
  });

  it('emits no calc.e1rm for bodyweight segments (no resistance)', () => {
    const seg = segment([
      effortData('thruster', 'Thruster', 8.5, 'strength'),
      { type: MetricType.Rep, value: 15, origin: 'runtime' },
    ]);
    engine().process(seg);
    expect(annotations(seg, 'calc.e1rm')).toHaveLength(0);
  });

  it('computes metMinutes from the effort table (resolved variant, analyzed)', () => {
    const seg = segment([
      { type: MetricType.Elapsed, value: 600_000, origin: 'runtime' },
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);
    engine().process(seg);
    expect(annotations(seg, 'metMinutes')[0]).toMatchObject({ value: 85, origin: 'analyzed' });
    expect(annotations(seg, 'metMinutesEstimated')).toHaveLength(0);
  });

  it('flags unresolved effort: default MET 5.0, estimated origin, companion count', () => {
    const seg = segment([{ type: MetricType.Elapsed, value: 600_000, origin: 'runtime' }]);
    engine().process(seg);
    expect(annotations(seg, 'metMinutes')[0]).toMatchObject({ value: 50, origin: 'analyzed-estimated' });
    expect(annotations(seg, 'metMinutesEstimated')[0]).toMatchObject({ value: 1, origin: 'analyzed-estimated' });
  });

  it('carries last-seen effort across segments (MetMinute scan parity)', () => {
    const e = engine();
    const first = segment([
      { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' },
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);
    const second = segment([{ type: MetricType.Elapsed, value: 60_000, origin: 'runtime' }]);
    e.process(first);
    e.process(second);
    // Second segment has no effort of its own: inherits thruster's 8.5 MET.
    expect(annotations(second, 'metMinutes')[0]).toMatchObject({ value: 8.5, origin: 'analyzed' });
  });

  it('skips non-leaf and non-segment outputs', () => {
    const parent = new OutputStatement({
      outputType: 'segment',
      timeSpan: { started: 0, ended: 0 },
      sourceBlockKey: 'blk',
      stackLevel: 0,
      metrics: [{ type: MetricType.Elapsed, value: 60_000, origin: 'runtime' }],
      children: [[1]],
    });
    const e = engine();
    e.process(parent);
    expect(annotations(parent, 'metMinutes')).toHaveLength(0);
  });
});

// ── Phase 2: workout scope (#875) ────────────────────────────────────────

describe('Phase 2: workout-scope running totals', () => {
  const thrusterSeg = (reps: number, kg?: number) =>
    segment([
      { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' },
      { type: MetricType.Rep, value: reps, origin: 'runtime' },
      ...(kg === undefined ? [] : [{ type: MetricType.Resistance, value: { amount: kg, units: 'kg' }, origin: 'runtime' as const }]),
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);

  it('recomputes totals over history with grouped per-effort emission', () => {
    const e = engine();
    const a = thrusterSeg(10, 60);
    const rest = segment([
      { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' },
      { type: MetricType.Rep, value: 3, origin: 'runtime' },
      effortData('rest', 'Rest', 2.0, 'recovery'),
    ]);
    const b = thrusterSeg(5, 60);
    e.process(a);
    e.process(rest);
    e.process(b);

    const projections = e.summarize([a, rest, b]);
    const byKey = (key: string) => projections.filter((p) => p.metadata?.canonicalKey === key);

    // Overall reps include rest (today's overall pass has no exclusion).
    expect(byKey('reps').find((p) => !p.metadata?.effortSlug)).toMatchObject({ value: 18, unit: 'reps' });
    // Grouped reps exclude rest/pause/rest-* (§10.6).
    const grouped = byKey('reps').filter((p) => p.metadata?.effortSlug);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ value: 15, metadata: { effortSlug: 'thruster', exerciseName: 'Thruster' } });
    // Group dims auto-tag; effort context tags populate store indexes (#878).
    expect(grouped[0].metadata).toMatchObject({
      groupTags: { effort: 'thruster' },
      effortDiscipline: 'strength',
      effortIntensityTier: 'high',
    });

    // Volume: pairing proof (§10.10) — per-segment has(reps) and has(resistance).
    expect(byKey('totalVolume').find((p) => !p.metadata?.effortSlug)).toMatchObject({ value: 900, unit: 'kg' });
    const volGrouped = byKey('totalVolume').filter((p) => p.metadata?.effortSlug);
    expect(volGrouped[0]).toMatchObject({ value: 900, metadata: { effortSlug: 'thruster', totalSets: 2 } });
  });

  it('counts measured reps instead of adding them to the planned target', () => {
    const e = engine();
    const measured = segment([
      { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' },
      { type: MetricType.Rep, value: 10, origin: 'parser' },
      { type: MetricType.Rep, value: 7, origin: 'user' },
    ]);
    const zero = segment([
      { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' },
      { type: MetricType.Rep, value: 10, origin: 'user-plan' },
      { type: MetricType.Rep, value: 0, origin: 'user' },
    ]);
    e.process(measured);
    e.process(zero);
    expect(e.summarize([measured, zero]).find(
      (p) => p.metadata?.canonicalKey === 'reps' && !p.metadata?.effortSlug,
    )?.value).toBe(7);
  });

  it('session.duration prefers root elapsed (no parent+child double count, §10.2)', () => {
    const e = engine();
    const root = segment([
      { type: MetricType.Elapsed, value: 600_000, origin: 'runtime' },
      { type: MetricType.SessionRPE, value: 7, origin: 'user' },
    ], 0);
    const leaf = thrusterSeg(10);
    e.process(leaf);
    const projections = e.summarize([root, leaf]);
    const load = projections.find((p) => p.metadata?.canonicalKey === 'sessionLoad');
    // 7 RPE × 10 min (root only — not 10 + 1).
    expect(load).toMatchObject({ value: 70, unit: 'AU', origin: 'analyzed' });
    expect(load?.metadata).toMatchObject({ sRPE: 7, durationMinutes: 10 });
  });

  it('sessionLoad falls back to max effort-label RPE, then default 5 (estimated)', () => {
    const e = engine();
    const labeled = segment([
      { type: MetricType.Elapsed, value: 600_000, origin: 'runtime' },
      { type: MetricType.Effort, value: 'Hard', origin: 'parser' },
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);
    e.process(labeled);
    let projections = e.summarize([labeled]);
    // Label variant: rpe 7 × 10 min, analyzed.
    expect(projections.find((p) => p.metadata?.canonicalKey === 'sessionLoad')).toMatchObject({ value: 70, origin: 'analyzed' });

    const e2 = engine();
    const plain = segment([{ type: MetricType.Elapsed, value: 600_000, origin: 'runtime' }]);
    e2.process(plain);
    projections = e2.summarize([plain]);
    // Default 5 — today silent, now explicitly estimated (#849 resolution).
    expect(projections.find((p) => p.metadata?.canonicalKey === 'sessionLoad')).toMatchObject({ value: 50, origin: 'analyzed-estimated' });
  });

  it('metMinutes total rounds; last-seen effort carries into effort-less segments', () => {
    const e = engine();
    const resolved = segment([
      { type: MetricType.Elapsed, value: 600_000, origin: 'runtime' },
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);
    const unresolved = segment([{ type: MetricType.Elapsed, value: 600_000, origin: 'runtime' }]);
    e.process(resolved);
    e.process(unresolved);
    const projections = e.summarize([resolved, unresolved]);
    // 85 + 85 (thruster MET carries) = 170, fully analyzed — today's scan.
    expect(projections.find((p) => p.metadata?.canonicalKey === 'calc.metMinutes')).toMatchObject({
      value: 170, unit: 'MET-min', origin: 'analyzed',
    });
  });

  it('metMinutes propagates estimated origin via companion count', () => {
    const e = engine();
    const unresolved = segment([{ type: MetricType.Elapsed, value: 600_000, origin: 'runtime' }]);
    const resolved = segment([
      { type: MetricType.Elapsed, value: 600_000, origin: 'runtime' },
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);
    // Estimated segment FIRST: no effort seen yet → default MET + companion.
    e.process(unresolved);
    e.process(resolved);
    const projections = e.summarize([unresolved, resolved]);
    // 50 + 85 = 135, one estimated segment flags the whole workout.
    expect(projections.find((p) => p.metadata?.canonicalKey === 'calc.metMinutes')).toMatchObject({
      value: 135, unit: 'MET-min', origin: 'analyzed-estimated',
    });
  });
});

// ── TIS composite (#876) ─────────────────────────────────────────────────

describe('TIS composite calculation', () => {
  const tisSegment = () =>
    segment([
      { type: MetricType.Elapsed, value: 600_000, origin: 'runtime' },
      { type: MetricType.SessionRPE, value: 7, origin: 'user' },
      effortData('thruster', 'Thruster', 8.5, 'strength'),
    ]);

  it('evaluates the full weighted formula with personalized metMax', () => {
    const e = engine(42.5);
    const seg = tisSegment();
    e.process(seg);
    const tis = e.summarize([seg]).find((p) => p.metadata?.canonicalKey === 'tis');
    // metMax = 42.5/3.5 ≈ 12.143; avgMets = 8.5 → metScore = 70; rpeScore = 70;
    // durationScore = 10/60 × 70 ≈ 11.667; discipline = 1.2
    // TIS = 0.3×70 + 0.35×70 + 0.2×11.667 + 0.15×1.2 = 48.013 → 48.0
    expect(tis).toMatchObject({ value: 48.0, unit: 'pts', origin: 'analyzed' });
    expect(tis?.metadata).toMatchObject({ metScore: 70, rpeScore: 70, disciplineFactor: 1.2 });
    expect(tis?.metadata?.metMax).toBeCloseTo(12.143, 2);
  });

  it('population variant uses metMax 11.4 when vo2max is absent', () => {
    const e = engine();
    const seg = tisSegment();
    e.process(seg);
    const tis = e.summarize([seg]).find((p) => p.metadata?.canonicalKey === 'tis');
    // avgMets 8.5 / 11.4 × 100 ≈ 74.56 → metScore; durationScore = 10/60 × 74.56 ≈ 12.427
    // TIS = 0.3×74.56 + 0.35×70 + 0.2×12.427 + 0.15×1.2 ≈ 49.53 → 49.5
    expect(tis?.metadata?.metMax).toBe(11.4);
    expect(tis?.value).toBeCloseTo(49.5, 1);
  });

  it('estimated variant fires when any segment was unresolved (companion count)', () => {
    const e = engine(42.5);
    const seg = segment([{ type: MetricType.Elapsed, value: 600_000, origin: 'runtime' }]);
    e.process(seg);
    const tis = e.summarize([seg]).find((p) => p.metadata?.canonicalKey === 'tis');
    expect(tis?.origin).toBe('analyzed-estimated');
  });
});
