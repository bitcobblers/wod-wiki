import { describe, expect, it } from 'vitest';
import { createTagIndex, MetricType, type IMetric } from '@bitcobblers/wod-wiki-core';
import { OutputStatement, type IOutputStatement } from '@bitcobblers/wod-wiki-core';
import { createCalcEngine } from '../../src/analytics/calc/factory';
import type { CalculationDefinition } from '../../src/analytics/calc/types';
import type { IEffort, IEffortResolver, ResolvedEffort } from '../../src/effort-registry/types';
import { tagMarkerType } from '../../src/tags/TagContributions';

const EFFORT: ResolvedEffort = {
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

const resolver: IEffortResolver = {
  resolveBySlug: () => null,
  resolveByAlias: () => null,
  resolveFuzzy: () => EFFORT.effort,
  resolveEffort: () => EFFORT,
  resolveDefinition: () => EFFORT,
  list: () => [EFFORT.effort],
};

/** A calculation that only a tag carries. */
const segmentCalc: CalculationDefinition = {
  id: 'tag-fn',
  kind: 'output',
  scope: 'segment',
  variants: [
    {
      id: 'default',
      priority: 10,
      origin: 'analyzed',
      nodes: { value: { id: 'value', kind: 'expr', expression: 'reps * 2' } },
    },
  ],
  output: { nodeId: 'value', emitType: 'calc.tag-fn' },
};

/** A workout-scope calculation that only a tag carries. */
const workoutCalc: CalculationDefinition = {
  id: 'tag-summary',
  kind: 'output',
  scope: 'workout',
  variants: [
    {
      id: 'default',
      priority: 10,
      origin: 'analyzed',
      nodes: { value: { id: 'value', kind: 'expr', expression: 'sum(reps)' } },
    },
  ],
  output: { nodeId: 'value', emitType: 'calc.tag-summary' },
};

const tags = createTagIndex([
  { slug: 'heavy', contributions: [{ kind: 'function', name: 'tag-fn' }] },
  { slug: 'summarised', contributions: [{ kind: 'function', name: 'tag-summary' }] },
  {
    slug: 'composite',
    contributions: [
      { kind: 'tag', slug: 'heavy' },
      { kind: 'metric', type: 'intensity', value: 'composite' },
    ],
  },
]);

function engineWith(calcs: CalculationDefinition[], activeTags?: readonly string[]) {
  return createCalcEngine('time', {
    effortResolver: resolver,
    calcs,
    tags,
    ...(activeTags ? { activeTags } : {}),
  });
}

function segment(metrics: IMetric[]): OutputStatement {
  return new OutputStatement({
    outputType: 'segment',
    timeSpan: { started: 0, ended: 0 },
    sourceBlockKey: 'blk',
    stackLevel: 1,
    metrics,
  });
}

const marker = (slug: string): IMetric => ({
  type: tagMarkerType(slug),
  value: slug,
  origin: 'parser',
});

const reps = (count: number): IMetric => ({
  type: MetricType.Rep,
  value: count,
  origin: 'runtime',
});

const annotations = (output: IOutputStatement, type: string): IMetric[] =>
  output.metrics.rawMetrics.filter((m) => m.type === type);

describe('tag-carried functions', () => {
  it('runs a carried function on the segments the tag applies to', () => {
    const engine = engineWith([segmentCalc]);
    const tagged = segment([reps(5), marker('heavy')]);
    engine.process(tagged);
    expect(annotations(tagged, 'calc.tag-fn')).toHaveLength(1);
  });

  it('does not run a carried function where the tag does not apply', () => {
    const engine = engineWith([segmentCalc]);
    const untagged = segment([reps(5)]);
    engine.process(untagged);
    expect(annotations(untagged, 'calc.tag-fn')).toHaveLength(0);
  });

  it('runs a function no tag carries as it always did', () => {
    const engine = createCalcEngine('time', { effortResolver: resolver, calcs: [segmentCalc] });
    const untagged = segment([reps(5)]);
    engine.process(untagged);
    expect(annotations(untagged, 'calc.tag-fn')).toHaveLength(1);
  });

  it('runs a workout-scope carried function when the tag applied in the workout', () => {
    const engine = engineWith([workoutCalc]);
    engine.process(segment([reps(5), marker('summarised')]));
    const projections = engine.summarize([segment([reps(5), marker('summarised')])]);
    expect(projections.map(p => p.metricType)).toContain('calc.tag-summary');
  });

  it('leaves a workout-scope carried function off when the tag never applied', () => {
    const engine = engineWith([workoutCalc]);
    const untagged = segment([reps(5)]);
    engine.process(untagged);
    const projections = engine.summarize([untagged]);
    expect(projections.map(p => p.metricType)).not.toContain('calc.tag-summary');
  });

  it('runs a function a tag carries through a tag it applies', () => {
    const engine = engineWith([segmentCalc]);
    const tagged = segment([reps(5), marker('composite')]);
    engine.process(tagged);
    expect(annotations(tagged, 'calc.tag-fn')).toHaveLength(1);
  });

  it('runs a carried function on every segment when the run activates the tag', () => {
    const engine = engineWith([segmentCalc], ['heavy']);
    const untagged = segment([reps(5)]);
    engine.process(untagged);
    expect(annotations(untagged, 'calc.tag-fn')).toHaveLength(1);
  });

  it('runs a workout-scope carried function the run activates', () => {
    const engine = engineWith([workoutCalc], ['summarised']);
    const untagged = segment([reps(5)]);
    engine.process(untagged);
    const projections = engine.summarize([untagged]);
    expect(projections.map(p => p.metricType)).toContain('calc.tag-summary');
  });
});
