import { describe, expect, it } from 'vitest';
import {
  MetricContainer,
  MetricType,
  OutputStatement,
  createTagIndex,
  type IMetric,
  type IOutputStatement,
} from '@bitcobblers/wod-wiki-core';
import { createCalcEngine } from '../../../src/analytics/calc/factory';
import type { CalcEngine } from '../../../src/analytics/calc/engine';
import { extractPropertyRulesFromMeta, extractTagPropertyRules } from '../../../src/analytics/calc/shakeOutQueue';
import type { IEffort, IEffortResolver, ResolvedEffort } from '../../../src/effort-registry/types';
import { ElapsedMetric } from '../../../src/runtime/compiler/metrics/ElapsedMetric';

/**
 * Dogfood regression coverage for Property Note metrics/summaries findings
 * #1, #3, and #6 — the consumer-visible seams a note author hits on Run.
 *
 * Worked examples (10 reps @ 24 kg kettlebell, 5 reps @ 100 kg barbell):
 *   work per set = 240 / 500, tag totalWork = 240 / 480 (two sets),
 *   note override ×2 = 480 / 960, power @ 1 s = 500 W.
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

/** The built-in `tonnage` tag exactly as the app's tag catalogue seeds it. */
const TONNAGE_TAG = {
  slug: 'tonnage',
  contributions: [
    { kind: 'metric' as const, type: 'resistance', value: 24, unit: 'kg' },
    { kind: 'metric' as const, type: 'work', value: 'reps * resistance' },
    { kind: 'metric' as const, type: 'summaries.totalWork', value: 'sum(work)' },
  ],
};

const tonnageIndex = createTagIndex([TONNAGE_TAG]);

function segment(metrics: IMetric[], timeSpan = { started: 0, ended: 1000 }): OutputStatement {
  return new OutputStatement({
    outputType: 'segment',
    isLeaf: true,
    timeSpan,
    sourceBlockKey: 'blk',
    stackLevel: 1,
    metrics: MetricContainer.from(metrics),
  });
}

const reps = (count: number): IMetric => ({ type: MetricType.Rep, value: count, origin: 'parser', image: String(count) });

const workAnnotationOf = (output: IOutputStatement): IMetric | undefined =>
  output.metrics.rawMetrics.find((m) => m.type === 'work');

const totalWorkProjection = (projections: ReadonlyArray<{ name?: string; value?: unknown }>) =>
  projections.find((p) => p.name === 'totalWork');

  it('emits missing-input diagnostics on exercise statements, not structural outputs', () => {
    const note = extractPropertyRulesFromMeta(
      { 'metrics.work': 'reps * resistance' },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', { effortResolver: resolver, propertySources: [note] });

    const structural = segment([]);
    engine.process(structural);
    expect(structural.metrics.rawMetrics.some((m) => m.type === MetricType.Diagnostic)).toBe(false);

    const exercise = segment([
      reps(12),
      { type: MetricType.Effort, value: 'Thrusters', origin: 'parser' },
    ]);
    engine.process(exercise);
    const diagnostic = exercise.metrics.rawMetrics.find((m) => m.type === MetricType.Diagnostic);
    expect(diagnostic).toBeDefined();
    expect(JSON.stringify(diagnostic?.value)).toContain('resistance');
  });

  it('keeps summary registration diagnostics on workouts without exercise statements', () => {
    const note = extractPropertyRulesFromMeta(
      { 'summaries.totalWork': 'sum(work)' },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', { effortResolver: resolver, propertySources: [note] });
    const structural = segment([]);
    engine.process(structural);
    const diagnostic = structural.metrics.rawMetrics.find((m) => m.type === MetricType.Diagnostic);
    expect(diagnostic).toBeDefined();
    expect(JSON.stringify(diagnostic?.value)).toContain('totalWork');
  });

describe('Property Note lifecycle regressions (dogfood findings #1, #3, #6)', () => {
  it('#1: a note summary referencing an undefined metric must not crash engine creation', () => {
    // Note frontmatter with `summaries.totalWork: sum(work)*2` and no rule
    // defining `work` anywhere — deployed behavior threw
    // CalcRegistrationError: Unknown symbol: work, blanking the whole run.
    const note = extractPropertyRulesFromMeta(
      { 'summaries.totalWork': 'sum(work)*2' },
      'note',
      'note-frontmatter',
    );

    let engine: CalcEngine | undefined;
    expect(() => { engine = createCalcEngine('time', { effortResolver: resolver, propertySources: [note] }); }).not.toThrow();

    // …and the skipped summary is a visible diagnostic on the log stream,
    // never a silent swallow.
    const set = segment([
      reps(10),
      { type: MetricType.Effort, value: 'Kettlebell Swings', origin: 'parser' },
    ]);
    engine!.process(set);
    const diagnostic = set.metrics.rawMetrics.find((m) => m.type === MetricType.Diagnostic);
    expect(diagnostic).toBeDefined();
    expect(JSON.stringify(diagnostic?.value)).toContain('totalWork');
  });

  it('#1: the note summary overrides the tag — one 10 @ 24 kg set totals 480, not 240', () => {
    // Nested YAML map form of the same frontmatter override.
    const note = extractPropertyRulesFromMeta(
      { summaries: { totalWork: 'sum(work)*2' } },
      'note',
      'note-frontmatter',
    );
    // tags:[tonnage] in the note frontmatter activates the tag for the run.
    const engine = createCalcEngine('time', {
      effortResolver: resolver,
      tags: tonnageIndex,
      activeTags: ['tonnage'],
      propertySources: [note],
    });

    const set = segment([reps(10)]); // resistance 24 kg comes from the tag
    engine.process(set);

    // Tag supplies resistance and work: 10 * 24 = 240
    expect(workAnnotationOf(set)?.value).toBe(240);

    const projections = engine.summarize([set]);
    expect(totalWorkProjection(projections)?.value).toBe(480);
  });

  it('#1: two 10 @ 24 kg sets with the ×2 note override total 960', () => {
    const note = extractPropertyRulesFromMeta(
      { 'summaries.totalWork': 'sum(work)*2' },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', {
      effortResolver: resolver,
      tags: tonnageIndex,
      activeTags: ['tonnage'],
      propertySources: [note],
    });

    const setA = segment([reps(10)]);
    const setB = segment([reps(10)]);
    engine.process(setA);
    engine.process(setB);

    const projections = engine.summarize([setA, setB]);
    // sum(work) = 240 + 240 = 480, note override ×2 = 960
    expect(totalWorkProjection(projections)?.value).toBe(960);
  });

  it('#3: the built-in tonnage tag contributes resistance, work, and totalWork from note tags', () => {
    const engine = createCalcEngine('time', {
      effortResolver: resolver,
      tags: tonnageIndex,
      activeTags: ['tonnage'],
    });

    const set = segment([reps(10)]); // no inline resistance — the tag must supply it
    engine.process(set);

    expect(set.metrics.rawMetrics.some((m) => m.type === MetricType.Resistance && m.value === 24)).toBe(true);
    expect(workAnnotationOf(set)?.value).toBe(240);

    const projections = engine.summarize([set]);
    expect(totalWorkProjection(projections)?.value).toBe(240);
  });

  it('#3: an inline #tonnage marker contributes the same metrics on the tagged statement', () => {
    const engine = createCalcEngine('time', {
      effortResolver: resolver,
      tags: tonnageIndex,
    });

    const set = segment([reps(10), { type: 'tag.tonnage', value: 'tonnage', origin: 'parser' }]);
    engine.process(set);

    expect(workAnnotationOf(set)?.value).toBe(240);
    const projections = engine.summarize([set]);
    expect(totalWorkProjection(projections)?.value).toBe(240);
  });

  it('#6: power resolves from work and 1 s of statement elapsed — 500 W, not silent', () => {
    const note = extractPropertyRulesFromMeta(
      {
        'metrics.work': 'reps * resistance',
        'metrics.power': 'work / convert(elapsed, s)',
      },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', { effortResolver: resolver, propertySources: [note] });

    // ElapsedMetric is what ReportOutputBehavior writes for a block that ran 1 s.
    const set = segment([
      reps(5),
      { type: MetricType.Resistance, value: 100, unit: 'kg', origin: 'parser', image: '100 kg' },
      new ElapsedMetric(1000, 'blk', new Date(0)),
    ]);
    engine.process(set);

    expect(workAnnotationOf(set)?.value).toBe(500);
    const power = set.metrics.rawMetrics.find((m) => m.type === 'power');
    expect(power?.value).toBe(500);
  });

  it('#6: a degenerate zero elapsed is replaced by the segment timeSpan — power resolves 500', () => {
    const note = extractPropertyRulesFromMeta(
      {
        'metrics.work': 'reps * resistance',
        'metrics.power': 'work / convert(elapsed, s)',
      },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', { effortResolver: resolver, propertySources: [note] });

    // Rep blocks without a timer still emit ElapsedMetric(0); the segment's
    // own timeSpan is the real active window and must win.
    const set = segment(
      [
        reps(5),
        { type: MetricType.Resistance, value: 100, unit: 'kg', origin: 'parser', image: '100 kg' },
        new ElapsedMetric(0, 'blk', new Date(0)),
      ],
      { started: 0, ended: 1000 },
    );
    engine.process(set);

    expect(workAnnotationOf(set)?.value).toBe(500);
    const power = set.metrics.rawMetrics.find((m) => m.type === 'power');
    expect(power?.value).toBe(500);
  });

  it('#6: a zero-length segment cannot resolve power and is diagnosed, never silent', () => {
    const note = extractPropertyRulesFromMeta(
      {
        'metrics.work': 'reps * resistance',
        'metrics.power': 'work / convert(elapsed, s)',
      },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', { effortResolver: resolver, propertySources: [note] });

    // The block genuinely never ran: no timeSpan span, elapsed stays 0.
    const set = segment(
      [
        reps(5),
        { type: MetricType.Resistance, value: 100, unit: 'kg', origin: 'parser', image: '100 kg' },
        { type: MetricType.Effort, value: 'Deadlifts', origin: 'parser' },
        new ElapsedMetric(0, 'blk', new Date(0)),
      ],
      { started: 0, ended: 0 },
    );
    engine.process(set);

    expect(workAnnotationOf(set)?.value).toBe(500);
    expect(set.metrics.rawMetrics.find((m) => m.type === 'power')).toBeUndefined();
    const diagnostics = set.metrics.rawMetrics.filter((m) => {
      if (m.type !== MetricType.Diagnostic || !m.metadata || typeof m.metadata !== 'object') return false;
      return 'target' in m.metadata && m.metadata.target === 'power';
    });
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostics[0]?.value)).toContain('could not be evaluated');
  });
});

describe('Tag Category contributions (finding #4 contract)', () => {
  const CATEGORY_TAG = {
    slug: 'equipment',
    isCategory: true,
    contributions: [
      { kind: 'metric' as const, type: 'resistance', value: 16, unit: 'kg' },
      { kind: 'metric' as const, type: 'summaries.totalWork', value: 'sum(work)' },
    ],
  };
  const CHILD_TAG = {
    slug: 'kettlebell-swing',
    contributions: [
      { kind: 'tag' as const, slug: 'equipment' },
      { kind: 'metric' as const, type: 'work', value: 'reps * resistance' },
    ],
  };
  const categoryIndex = createTagIndex([CATEGORY_TAG, CHILD_TAG]);

  it('category-sourced rules classify at the category layer, tag rules at the tag layer', () => {
    const rules = extractTagPropertyRules(categoryIndex, ['kettlebell-swing']);
    const categoryRule = rules.find((r) => r.layer === 'category');
    const tagRule = rules.find((r) => r.layer === 'tag');
    expect(categoryRule?.metrics).toMatchObject({ resistance: '16 kg' });
    expect(categoryRule?.summaries).toEqual({ totalWork: 'sum(work)' });
    expect(tagRule?.metrics).toMatchObject({ work: 'reps * resistance' });
  });

  it('a note metric overrides the category default: 10 reps note-resisted = 200', () => {
    const note = extractPropertyRulesFromMeta(
      { 'metrics.resistance': '20 kg', 'metrics.work': 'reps * resistance' },
      'note',
      'note-frontmatter',
    );
    const engine = createCalcEngine('time', { effortResolver: resolver, tags: categoryIndex, propertySources: [note] });
    const set = segment([reps(10), { type: 'tag.kettlebell-swing', value: 'kettlebell-swing', origin: 'parser' }]);
    engine.process(set);

    expect(set.metrics.rawMetrics.some((m) => m.type === MetricType.Resistance && m.value === 20)).toBe(true);
    expect(workAnnotationOf(set)?.value).toBe(200);
  });

  it('the category supplies resistance and its summary stacks when nothing overrides: 160', () => {
    const engine = createCalcEngine('time', { effortResolver: resolver, tags: categoryIndex });
    const set = segment([reps(10), { type: 'tag.kettlebell-swing', value: 'kettlebell-swing', origin: 'parser' }]);
    engine.process(set);

    expect(set.metrics.rawMetrics.some((m) => m.type === MetricType.Resistance && m.value === 16)).toBe(true);
    expect(workAnnotationOf(set)?.value).toBe(160);
    expect(totalWorkProjection(engine.summarize([set]))?.value).toBe(160);
  });
});
