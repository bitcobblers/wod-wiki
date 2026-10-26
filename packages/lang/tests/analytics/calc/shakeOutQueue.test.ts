import { describe, expect, it } from 'vitest';
import { MetricContainer, MetricType } from '@bitcobblers/wod-wiki-core';
import {
  compilePropertySummaryCalcs,
  extractPropertyRulesFromMeta,
  runMetricShakeOutQueue,
} from '../../../src/analytics/calc/shakeOutQueue';
import { CalcEngine } from '../../../src/analytics/calc/engine';
import { CalculationRegistry } from '../../../src/analytics/calc/registry';
import { LookupRegistry } from '../../../src/analytics/calc/lookup';
import { OutputStatement } from '@bitcobblers/wod-wiki-core';

describe('MetricShakeOutQueue', () => {
  it('stacks static and dynamic metrics across specificity precedence (Statement > Tag > Effort > Equipment > Note > Category)', () => {
    const container = MetricContainer.from([
      { type: MetricType.Rep, value: 10, origin: 'parser' },
    ]);

    const result = runMetricShakeOutQueue(container, {
      stage: 'log',
      sources: [
        {
          layer: 'category',
          sourceSlug: 'equipment',
          metrics: { resistance: '16 kg', met: 4 },
        },
        {
          layer: 'note',
          sourceSlug: 'note-1',
          metrics: { resistance: '20 kg', work: 'reps * resistance' },
        },
        {
          layer: 'equipment',
          sourceSlug: 'kettlebell',
          metrics: { resistance: '24 kg' },
        },
        {
          layer: 'effort',
          sourceSlug: 'swing',
          metrics: { met: 8 },
        },
        {
          layer: 'tag',
          sourceSlug: 'heavy',
          metrics: { resistance: '32 kg' },
        },
      ],
    });

    // Tag (32 kg) wins over Equipment (24 kg), Note (20 kg), and Category (16 kg)
    expect(container.get('resistance')?.value).toBe(32);
    expect(container.get('resistance')?.unit).toBe('kg');
    // Effort (8) wins over Category (4)
    expect(container.get('met')?.value).toBe(8);
    // Note's `work = reps * resistance` shakes out using reps (10) * Tag's resistance (32 kg) = 320
    expect(container.get('work')?.value).toBe(320);
    expect(result.resolved).toContain('work');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('resolves multi-wave dependent equations in topological shake-out order and defers runtime atoms during plan stage', () => {
    const planContainer = MetricContainer.from([
      { type: MetricType.Rep, value: 5, origin: 'parser' },
    ]);

    const planResult = runMetricShakeOutQueue(planContainer, {
      stage: 'plan',
      sources: [
        {
          layer: 'equipment',
          sourceSlug: 'barbell',
          metrics: {
            // Defined out of order: power depends on work, which depends on resistance
            power: 'work / convert(elapsed, s)',
            work: 'reps * resistance',
            resistance: '100 kg',
          },
        },
      ],
    });

    // At plan stage, resistance and work resolve, while power is deferred waiting for runtime elapsed
    expect(planContainer.get('resistance')?.value).toBe(100);
    expect(planContainer.get('work')?.value).toBe(500);
    expect(planContainer.get('power')).toBeUndefined();
    expect(planResult.deferredRuntime).toEqual(['power']);
    expect(planResult.diagnostics).toHaveLength(0);

    // At log stage with elapsed = 10_000 ms (10 s), power resolves to 500 / 10 = 50
    const logContainer = MetricContainer.from([
      { type: MetricType.Rep, value: 5, origin: 'parser' },
      { type: MetricType.Elapsed, value: 10_000, unit: 'ms', origin: 'runtime' },
    ]);

    const logResult = runMetricShakeOutQueue(logContainer, {
      stage: 'log',
      sources: [
        {
          layer: 'equipment',
          sourceSlug: 'barbell',
          metrics: {
            power: 'work / convert(elapsed, s)',
            work: 'reps * resistance',
            resistance: '100 kg',
          },
        },
      ],
    });

    expect(logContainer.get('work')?.value).toBe(500);
    expect(logContainer.get('power')?.value).toBe(50);
    expect(logResult.diagnostics).toHaveLength(0);
  });

  it('emits a Skipped-Dependency Diagnostic metric when a required input remains absent at log stage', () => {
    const container = MetricContainer.from([
      { type: MetricType.Rep, value: 12, origin: 'parser' },
    ]);

    const result = runMetricShakeOutQueue(container, {
      stage: 'log',
      sources: [
        {
          layer: 'effort',
          sourceSlug: 'thruster',
          metrics: {
            work: 'reps * resistance',
          },
        },
      ],
    });

    expect(container.get('work')).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      target: 'work',
      sourceLayer: 'effort',
      sourceSlug: 'thruster',
      missing: ['resistance'],
    });

    const diagMetrics = container.getByOrigin('diagnostic');
    expect(diagMetrics).toHaveLength(1);
    expect(diagMetrics[0].type).toBe(MetricType.Diagnostic);
    expect(diagMetrics[0].metadata).toMatchObject({
      diagnostic: 'skipped-dependency',
      target: 'work',
      missing: ['resistance'],
    });
  });

  it('extracts metrics: and summaries: from frontmatter and compiles summaries for CalcEngine', () => {
    const ruleInput = extractPropertyRulesFromMeta(
      {
        'metrics.resistance': '24 kg',
        'metrics.work': 'reps * resistance',
        'summaries.totalWork': 'sum(work)',
      },
      'equipment',
      'kettlebell',
    );

    expect(ruleInput.metrics).toEqual({
      resistance: '24 kg',
      work: 'reps * resistance',
    });
    expect(ruleInput.summaries).toEqual({
      totalWork: 'sum(work)',
    });

    const summaryCalcs = compilePropertySummaryCalcs([ruleInput]);
    expect(summaryCalcs).toHaveLength(1);
    expect(summaryCalcs[0].id).toBe('totalWork');
    expect(summaryCalcs[0].scope).toBe('workout');

    const lookups = new LookupRegistry();
    const registry = new CalculationRegistry(lookups);
    for (const calc of summaryCalcs) {
      registry.register(calc);
    }
    const engine = new CalcEngine(registry, { dialect: 'time', lookups, propertySources: [ruleInput] });

    const seg1 = engine.process(
      new OutputStatement({
        outputType: 'segment',
        isLeaf: true,
        timeSpan: { started: 0, ended: 5000 },
        sourceBlockKey: 'b1',
        metrics: MetricContainer.from([
          { type: MetricType.Rep, value: 10, origin: 'parser' },
        ]),
      }),
    );

    expect(seg1.getMetric('work' as MetricType)?.value).toBe(240);

    const summaries = engine.summarize([seg1]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].name).toBe('totalWork');
    expect(summaries[0].value).toBe(240);
  });
});
