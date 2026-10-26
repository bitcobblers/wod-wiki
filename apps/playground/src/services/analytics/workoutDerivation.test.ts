/**
 * workoutDerivation tests — the unified derivation + replay seam (C4/C5),
 * single-stream shape (CONTEXT.md 2026-07-20: no data.analytics split;
 * Tier 2 lives in logs, discriminated by outputType).
 *
 * Defends the observable contracts:
 *   1. Stale Tier-2 ('analytics') outputs in the input are DISCARDED and
 *      regenerated — appended to the same logs stream.
 *   2. Tier-1 annotations (origin 'analyzed') are stripped before re-run so
 *      processors never double-apply; runtime/parser metrics and predictions
 *      ('analyzed-estimated') are preserved (frozen at recording time).
 *   3. Replay produces summary projections headlessly — no runtime, no
 *      OutputEmitter.
 *   4. resolveCanonicalMetricKey maps projection names to canonical keys.
 */
import { describe, expect, it } from 'bun:test';

import {
  deriveWorkoutFromLogs,
  normalizeSummaryFacts,
  replayResultAnalytics,
  resolveCanonicalMetricKey,
} from './workoutDerivation';
import type { ScriptBlock, StoredOutputStatement } from '@/components/Editor/types';
import { toEventRows } from '@bitcobblers/wod-wiki-wql';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

const T0 = 1_700_000_000_000;

const BLOCK: ScriptBlock = {
  id: 'wod-2-test',
  contentId: 'bc-test',
  dialect: 'time',
  startLine: 2,
  endLine: 5,
  content: '21 Deadlift 60kg',
  state: 'idle',
  version: 1,
  createdAt: 0,
  widgetIds: {},
};

function segmentLog(extraMetrics: StoredOutputStatement['metrics'] = []): StoredOutputStatement {
  return {
    id: 1,
    outputType: 'segment',
    timeSpan: { started: T0, ended: T0 + 60_000 },
    metrics: [
      { type: MetricType.Rep, value: 21, image: '21', origin: 'runtime' },
      { type: MetricType.Resistance, value: 60, image: '60 kg', origin: 'parser' },
      { type: MetricType.Effort, value: 'Deadlift', image: 'Deadlift', origin: 'parser' },
      { type: MetricType.Elapsed, value: 60_000, origin: 'runtime' },
      { type: MetricType.Total, value: 60_000, origin: 'runtime' },
      ...extraMetrics,
    ],
    sourceBlockKey: 'block-1',
    stackLevel: 0,
  };
}

const STALE_SUMMARY: StoredOutputStatement = {
  id: 99,
  outputType: 'analytics',
  timeSpan: { started: T0, ended: T0 },
  metrics: [{ type: MetricType.Label, value: 'Stale Projection', image: 'Stale Projection', origin: 'analyzed' }],
  sourceBlockKey: 'analytics-summary',
  stackLevel: 0,
};

describe('deriveWorkoutFromLogs', () => {
  it('discards stale Tier-2 outputs and appends regenerated summaries to the same stream', () => {
    const derived = deriveWorkoutFromLogs([segmentLog(), STALE_SUMMARY], { block: BLOCK });

    // No stale output survives; everything lives in one logs array.
    expect(derived.some(o => o.id === 99)).toBe(false);
    const summaries = derived.filter(o => o.outputType === 'analytics');
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.every(o => o.sourceBlockKey === 'analytics-summary')).toBe(true);
    // Tier 2 comes after the segment stream.
    expect(derived[derived.length - 1]!.outputType).toBe('analytics');
  });

  it('strips analyzed annotations but preserves runtime/parser metrics and predictions', () => {
    const annotated = segmentLog([
      { type: 'power' as MetricType, value: 500, unit: 'W', origin: 'analyzed' },
      { type: 'est.totalReps' as MetricType, value: 21, origin: 'analyzed-estimated' },
    ]);
    const derived = deriveWorkoutFromLogs([annotated], { block: BLOCK });

    const segment = derived.find(o => o.outputType === 'segment')!;
    // Runtime + parser metrics survive untouched.
    expect(segment.metrics.some(m => m.type === MetricType.Rep && m.value === 21)).toBe(true);
    expect(segment.metrics.some(m => m.type === MetricType.Effort && m.value === 'Deadlift')).toBe(true);
    // Predictions are frozen — preserved as recorded, never re-derived.
    expect(segment.metrics.some(m => m.type === 'est.totalReps' && m.value === 21 && m.origin === 'analyzed-estimated')).toBe(true);
    // The stale analyzed power metric does not double up: at most one power
    // entry, and only if a realtime processor re-derived it.
    const powerMetrics = segment.metrics.filter(m => m.type === 'power');
    expect(powerMetrics.length).toBeLessThanOrEqual(1);
    expect(powerMetrics.every(m => m.value !== 500 || m.origin === 'analyzed')).toBe(true);
  });

  it('passes non-segment outputs through untouched', () => {
    const milestone: StoredOutputStatement = {
      id: 7,
      outputType: 'milestone',
      timeSpan: { started: T0 + 1000 },
      metrics: [],
      sourceBlockKey: 'block-1',
      stackLevel: 0,
    };
    const derived = deriveWorkoutFromLogs([segmentLog(), milestone], { block: BLOCK });
    expect(derived).toContainEqual(milestone);
  });

  it('re-derives TIS through the composed engine while freezing estimated predictions (#876)', () => {
    const derived = deriveWorkoutFromLogs([
      segmentLog([
        // A frozen prediction from recording time — never re-derived.
        { type: 'metMinutes', value: 5, origin: 'analyzed-estimated' },
      ]),
    ], { block: BLOCK });

    // The composed engine re-derives the full Tier-2 suite (strip rule:
    // legacy 'analytics' outputs are gone, fresh ones are appended).
    const summaries = derived.filter((o) => o.outputType === 'analytics');
    const keys = summaries.map((o) => {
      const value = o.metrics.find((m) => m.type !== MetricType.Label && typeof m.value === 'number');
      return (value?.metadata as Record<string, unknown> | undefined)?.canonicalKey;
    });
    expect(keys).toContain('tis');
    expect(keys).toContain('sessionLoad');
    expect(keys).toContain('calc.metMinutes');
    expect(keys).toContain('reps');

    // The frozen prediction survives exactly once — no double-counted
    // re-derivation beside it.
    const segment = derived.find((o) => o.outputType === 'segment')!;
    const metMinutes = segment.metrics.filter((m) => m.type === 'metMinutes');
    expect(metMinutes).toHaveLength(1);
    expect(metMinutes[0]).toMatchObject({ value: 5, origin: 'analyzed-estimated' });
  });
});

describe('replayResultAnalytics', () => {
  it('re-derives a persisted result from its event rows', () => {
    const events = [
      ...toEventRows([segmentLog(), STALE_SUMMARY], {
        noteId: 'n1',
        resultId: 'r1',
        blockId: 'wod-2-test',
        blockVersion: 1,
        blockContentId: 'bc-test',
        origin: 'journal',
        workoutTimestamp: T0 + 60_000,
      }),
    ];

    const derived = replayResultAnalytics(BLOCK, events);
    expect(derived.filter(o => o.outputType === 'analytics').length).toBeGreaterThan(0);
  });

  it('preserves user-origin SessionRPE and re-derives SessionLoad from it', () => {
    const rpeStatement: StoredOutputStatement = {
      id: 2,
      outputType: 'segment',
      timeSpan: { started: T0 + 60_000, ended: T0 + 60_000 },
      metrics: [{ type: MetricType.SessionRPE, value: 9, origin: 'user', image: 'rpe: 9' }],
      sourceBlockKey: 'block-1',
      stackLevel: 0,
    };
    const events = toEventRows([segmentLog(), rpeStatement], {
      noteId: 'n1',
      resultId: 'r1',
      blockId: 'wod-2-test',
      blockVersion: 1,
      blockContentId: 'bc-test',
      origin: 'journal',
      workoutTimestamp: T0 + 60_000,
    });

    const derived = replayResultAnalytics(BLOCK, events);

    // User-origin SessionRPE survives the replay strip (only 'analyzed' is removed).
    const userRpe = derived
      .flatMap((o) => o.metrics)
      .find((m) => m.type === MetricType.SessionRPE && m.origin === 'user');
    expect(userRpe).toBeDefined();
    expect(userRpe!.value).toBe(9);

    // SessionLoad uses the user RPE (9) × 1 minute = 9 AU.
    const sessionLoad = derived
      .filter((o) => o.outputType === 'analytics')
      .flatMap((o) => o.metrics)
      .find((m) => m.type === MetricType.Load);
    expect(sessionLoad).toBeDefined();
    expect(sessionLoad!.value).toBe(9);
  });

  it('evaluates stacked Property Note metrics: and summaries: equations on replay', () => {
    const events = toEventRows([segmentLog()], {
      noteId: 'n1',
      resultId: 'r1',
      blockId: 'wod-2-test',
      blockVersion: 1,
      blockContentId: 'bc-test',
      origin: 'journal',
      workoutTimestamp: T0 + 60_000,
    });

    const derived = replayResultAnalytics(BLOCK, events, {
      propertySources: [
        {
          layer: 'equipment',
          sourceSlug: 'kettlebell',
          metrics: {
            resistance: '24 kg',
            work: 'reps * resistance',
          },
          summaries: {
            totalWork: 'sum(work)',
          },
        },
      ],
    });

    // Statement carries 21 reps @ 60 kg (parser origin), shadowing equipment's 24 kg -> 21 * 60 = 1260
    const segment = derived.find((o) => o.outputType === 'segment');
    expect(segment?.metrics.find((m) => m.type === 'work')?.value).toBe(1260);

    const summaryPoints = normalizeSummaryFacts(derived, { noteId: 'n1', resultId: 'r1' });
    const totalWorkFact = summaryPoints.find((p) => p.metricKey === 'totalWork');
    expect(totalWorkFact?.value).toBe(1260);

    // When statement omits resistance, equipment's 24 kg fills in -> 21 * 24 = 504
    const noLoadSegment: StoredOutputStatement = {
      ...segmentLog(),
      metrics: segmentLog().metrics.filter((m) => m.type !== MetricType.Resistance),
    };
    const noLoadEvents = toEventRows([noLoadSegment], {
      noteId: 'n1',
      resultId: 'r2',
      blockId: 'wod-2-test',
      blockVersion: 1,
      blockContentId: 'bc-test',
      origin: 'journal',
      workoutTimestamp: T0 + 60_000,
    });
    const derivedDefault = replayResultAnalytics(BLOCK, noLoadEvents, {
      propertySources: [
        {
          layer: 'equipment',
          sourceSlug: 'kettlebell',
          metrics: { resistance: '24 kg', work: 'reps * resistance' },
          summaries: { totalWork: 'sum(work)' },
        },
      ],
    });
    expect(derivedDefault.find((o) => o.outputType === 'segment')?.metrics.find((m) => m.type === 'work')?.value).toBe(504);
  });
});

describe('resolveCanonicalMetricKey', () => {
  it('maps projection names to canonical keys', () => {
    expect(resolveCanonicalMetricKey('Total Volume')).toBe('totalVolume');
    expect(resolveCanonicalMetricKey('TIS')).toBe('tis');
    expect(resolveCanonicalMetricKey('Total Reps')).toBe('totalReps');
    expect(resolveCanonicalMetricKey('Session Load')).toBe('sessionLoad');
  });
});

describe('normalizeSummaryFacts', () => {
  it('carries summary-processor effort metadata onto the fact row', () => {
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'Training Intensity Score', image: 'Training Intensity Score' },
          {
            type: MetricType.TIS,
            value: 72,
            unit: 'pts',
            metadata: {
              effortSlug: 'deadlift',
              effortDiscipline: 'strength',
              effortIntensityTier: 'high',
              // Non-string / unrelated metadata never leaks onto the row.
              metScore: 5.4,
            },
          },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1' });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      metricKey: 'trainingIntensityScore',
      effortSlug: 'deadlift',
      discipline: 'strength',
      intensityTier: 'high',
    });
  });

  it('omits effort fields when the projection carries no effort metadata', () => {
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
          { type: MetricType.Rep, value: 90, unit: 'reps' },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1' });

    expect(points).toHaveLength(1);
    expect(points[0].effortSlug).toBeUndefined();
    expect(points[0].discipline).toBeUndefined();
    expect(points[0].intensityTier).toBeUndefined();
  });

  // #878 — generalized fact identity for composed calculation outputs.
  it('prefers the canonicalKey metadata over the name-derived metric key', () => {
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'calc.metMinutes', image: 'calc.metMinutes' },
          { type: 'work', value: 135, unit: 'MET-min', metadata: { canonicalKey: 'calc.metMinutes' } },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1' });

    expect(points[0].metricKey).toBe('calc.metMinutes');
    expect(points[0].type).toBe('calc.metMinutes');
  });

  it('builds row keys from sorted group-tag pairs and dedupes keep-last per row key', () => {
    const output = (value: number, totalSets: number) => ({
      outputType: 'analytics',
      timeSpan: { started: T0, ended: T0 },
      metrics: [
        { type: MetricType.Label, value: 'totalVolume', image: 'totalVolume' },
        {
          type: 'volume',
          value,
          unit: 'kg',
          metadata: {
            canonicalKey: 'totalVolume',
            groupTags: { effort: 'thruster' },
            effortSlug: 'thruster',
            effortDiscipline: 'strength',
            effortIntensityTier: 'high',
            totalSets,
          },
        },
      ],
    });
    // Two emissions for the same row key (live running totals): last wins.
    const points = normalizeSummaryFacts([output(600, 1), output(900, 2)], { noteId: 'n1', resultId: 'r1' });

    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(900);
    expect(points[0].id).toContain('totalVolume:effort=thruster');
    expect(points[0]).toMatchObject({
      metricKey: 'totalVolume',
      effortSlug: 'thruster',
      discipline: 'strength',
      intensityTier: 'high',
    });
  });

  it('sorts multiple group tags deterministically in the row key', () => {
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'reps', image: 'reps' },
          {
            type: 'rep', value: 15, unit: 'reps',
            metadata: { canonicalKey: 'reps', groupTags: { effort: 'thruster', day: 'monday' } },
          },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1' });

    expect(points[0].id).toContain('reps:day=monday:effort=thruster');
  });

  it('stamps the canonical workout time, not the derivation-time output stamp', () => {
    const workoutEnd = T0 + 60_000;
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        // The engine stamps outputs at derivation time — must NOT win.
        timeSpan: { started: T0 + 999_000, ended: T0 + 999_000 },
        metrics: [
          { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
          { type: MetricType.Rep, value: 90, unit: 'reps' },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1', workoutTimestamp: workoutEnd });

    expect(points[0].timestamp).toBe(workoutEnd);
  });

  it('falls back to the output timeSpan when no canonical time is supplied', () => {
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
          { type: MetricType.Rep, value: 90, unit: 'reps' },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1' });

    expect(points[0].timestamp).toBe(T0);
  });

  it('deduplicates duplicate analytics outputs by metricKey, keeping the last occurrence', () => {
    const points = normalizeSummaryFacts([
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
          { type: MetricType.Rep, value: 42, unit: 'reps' },
        ],
      },
      {
        outputType: 'analytics',
        timeSpan: { started: T0 + 1000, ended: T0 + 1000 },
        metrics: [
          { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
          { type: MetricType.Rep, value: 90, unit: 'reps' },
        ],
      },
      {
        outputType: 'analytics',
        timeSpan: { started: T0, ended: T0 },
        metrics: [
          { type: MetricType.Label, value: 'Training Load', image: 'Training Load' },
          { type: MetricType.Load, value: 100, unit: 'au' },
        ],
      },
    ], { noteId: 'n1', resultId: 'r1' });

    expect(points).toHaveLength(2);
    const totalReps = points.find(p => p.metricKey === 'totalReps');
    expect(totalReps).toBeDefined();
    expect(totalReps!.value).toBe(90);
    const trainingLoad = points.find(p => p.metricKey === 'trainingLoad');
    expect(trainingLoad).toBeDefined();
    expect(trainingLoad!.value).toBe(100);
  });
});
