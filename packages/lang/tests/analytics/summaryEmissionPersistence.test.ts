import { describe, expect, it } from 'vitest';
import {
  MetricContainer,
  MetricType,
  OutputStatement,
  type IMetric,
  type IOutputStatement,
} from '@bitcobblers/wod-wiki-core';
import { AnalyticsEngine } from '../../src/analytics/AnalyticsEngine';
import { createCalcEngine } from '../../src/analytics/calc/factory';
import { extractPropertyRulesFromMeta } from '../../src/analytics/calc/shakeOutQueue';
import type { IEffort, IEffortResolver, ResolvedEffort } from '../../src/effort-registry/types';
import { OutputEmitter } from '../../src/runtime/OutputEmitter';

/**
 * Dogfood finding #2 — the saved-summary seam. A note's
 * `summaries.totalWork: sum(work)` must materialize a valued, canonicalKey-
 * stamped 'analytics' output in the persisted log stream (the exact shape
 * WQL's summary fold requires: one label metric + one numeric value metric
 * with metadata.canonicalKey). Worked example: 10 reps @ 24 kg → work 240,
 * totalWork 240; two sets → 480.
 */

const EFFORT: ResolvedEffort = {
  effort: { slug: 'swing' } as unknown as IEffort,
  definition: { slug: 'swing' } as unknown as IEffort,
  slug: 'swing',
  label: 'Kettlebell Swing',
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

const resolver: IEffortResolver = {
  resolveBySlug: () => null,
  resolveByAlias: () => null,
  resolveFuzzy: () => EFFORT.effort,
  resolveEffort: () => EFFORT,
  resolveDefinition: () => EFFORT,
  list: () => [EFFORT.effort],
};

const NOTE_RULES = extractPropertyRulesFromMeta(
  {
    'metrics.work': 'reps * resistance',
    'summaries.totalWork': 'sum(work)',
  },
  'note',
  'note-frontmatter',
);

function swingSet(repsCount: number, resistanceKg: number): OutputStatement {
  return new OutputStatement({
    outputType: 'segment',
    isLeaf: true,
    timeSpan: { started: 0, ended: 1000 },
    sourceBlockKey: 'blk',
    stackLevel: 1,
    metrics: MetricContainer.from([
      { type: MetricType.Rep, value: repsCount, origin: 'parser', image: String(repsCount) },
      { type: MetricType.Resistance, value: resistanceKg, unit: 'kg', origin: 'parser', image: `${resistanceKg} kg` },
    ]),
  });
}

function engineWithCalcChain(): AnalyticsEngine {
  const engine = new AnalyticsEngine();
  const calc = createCalcEngine('time', { effortResolver: resolver, propertySources: [NOTE_RULES] });
  engine.addRealtimeProcessor(calc);
  engine.addSummaryProcessor(calc);
  return engine;
}

function findTotalWorkRow(outputs: readonly IOutputStatement[]): IOutputStatement | undefined {
  return outputs.find(
    (o) =>
      o.outputType === 'analytics' &&
      o.metrics.rawMetrics.some((m) => m.type === MetricType.Label && m.value === 'totalWork'),
  );
}

function totalWorkValueMetric(row: IOutputStatement): IMetric | undefined {
  return row.metrics.rawMetrics.find((m) => m.type !== MetricType.Label && typeof m.value === 'number');
}

describe('saved summary lifecycle (dogfood finding #2)', () => {
  it('one 10 @ 24 kg set: finalize persists a valued totalWork analytics row with canonicalKey', () => {
    const emitter = new OutputEmitter();
    emitter.setAnalyticsEngine(engineWithCalcChain());

    const set = swingSet(10, 24);
    emitter.add(set);
    expect(set.metrics.rawMetrics.find((m) => m.type === 'work')?.value).toBe(240);

    emitter.finalizeAnalytics();

    const row = findTotalWorkRow(emitter.getAll());
    expect(row).toBeDefined();
    const valueMetric = totalWorkValueMetric(row!);
    expect(valueMetric?.value).toBe(240);
    expect(valueMetric?.metadata).toMatchObject({ canonicalKey: 'totalWork' });
  });

  it('two sets: finalize persists totalWork 480 even when live projections already matched', () => {
    const engine = engineWithCalcChain();
    const emitter = new OutputEmitter();
    emitter.setAnalyticsEngine(engine);

    const setA = swingSet(10, 24);
    const setB = swingSet(10, 24);
    emitter.add(setA);
    emitter.add(setB);

    // Live emission already carried the running total; the finalize-dedupe
    // path must still materialize the finals into the persisted buffer.
    const finalized = emitter.finalizeAnalytics();
    const persistedRow = findTotalWorkRow(emitter.getAll());
    expect(finalized.some((o) => findTotalWorkRow([o])) || persistedRow).toBeTruthy();
    expect(totalWorkValueMetric(persistedRow!)?.value).toBe(480);
  });
});
