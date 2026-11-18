import { describe, expect, it } from 'vitest';
import { MetricType, OutputStatement, type IMetric } from '@bitcobblers/wod-wiki-core';
import { createCalcEngine } from '../../src/analytics/calc/factory';
import type { IEffort, IEffortResolver, ResolvedEffort } from '../../src/effort-registry/types';

const KB_SWING: ResolvedEffort = {
  effort: { slug: 'kettlebell-swing' } as unknown as IEffort,
  definition: { slug: 'kettlebell-swing' } as unknown as IEffort,
  slug: 'kettlebell-swing',
  label: 'Kettlebell Swing',
  met: 6.2,
  baseAttributes: { met: 6.2 },
  discipline: 'strength',
  disciplineFactor: 1.15,
  intensityTier: 'moderate',
  modifiers: {},
  registrySource: 'bundled',
  resolvedFrom: 'bundled',
  isEstimated: false,
};

const resolver: IEffortResolver = {
  resolveBySlug: () => KB_SWING.effort,
  resolveByAlias: () => KB_SWING.effort,
  resolveFuzzy: () => KB_SWING.effort,
  resolveEffort: () => KB_SWING,
  getAllEfforts: () => [KB_SWING.effort],
  isLoaded: () => true,
} as unknown as IEffortResolver;

describe('WW-078 — analytics engine float precision preservation', () => {
  it('emits finite un-truncated float metrics for pace, MET-min, and points', () => {
    const engine = createCalcEngine('crossfit', { effortResolver: resolver });
    const started = 1_700_000_000_000;
    // 10.46 min = 627,600 ms
    const ended = started + 627_600;
    const metrics: IMetric[] = [
      { type: MetricType.Effort, value: 'kettlebell-swing', origin: 'parser' },
      {
        type: 'effort-data',
        origin: 'analyzed',
        value: { slug: 'kettlebell-swing', label: 'Kettlebell Swing', aliases: [], baseAttributes: { met: 6.2, discipline: 'strength' }, registrySource: 'bundled' },
      },
      { type: MetricType.Rep, value: 225, origin: 'parser' },
      { type: MetricType.Resistance, value: 24, unit: 'kg', origin: 'parser' },
      { type: MetricType.Elapsed, value: 627_600, unit: 'ms', origin: 'runtime' },
    ];
    const stmt = new OutputStatement({
      id: 1,
      outputType: 'segment',
      timeSpan: { started, ended },
      metrics,
    });

    engine.process(stmt);
    const projections = engine.summarize([stmt]);
    const outMetrics = [...stmt.metrics.rawMetrics, ...projections];
    const metMin = outMetrics.find((m) => m.unit === 'MET-min');
    const pace = outMetrics.find((m) => m.unit === 'reps/min');

    expect(metMin).toBeDefined();
    expect(typeof metMin?.value).toBe('number');
    expect(Number.isFinite(metMin!.value as number)).toBe(true);
    // MET-min = 6.2 * 10.46 = 64.852 — must not be truncated to an integer in the engine
    expect(Number.isInteger(metMin!.value)).toBe(false);

    expect(pace).toBeDefined();
    expect(typeof pace?.value).toBe('number');
    expect(Number.isFinite(pace!.value as number)).toBe(true);
  });
});
