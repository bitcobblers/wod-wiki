import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestSession, resetTestingVocabulary } from '@bitcobblers/wod-wiki-core/testing';
import {
  DomainScenarioHarness,
  HARNESS_EPOCH,
  type ShakeOutSourceInput,
} from '../harness/DomainScenarioHarness';
import {
  MetricType,
  compilePropertySummaryCalcs,
  extractPropertyRulesFromMeta,
} from '../../src/index';

describe('Domain — Property Notes, Scoped Overrides & the Metric Shake-Out Queue', () => {
  let harness: DomainScenarioHarness;
  beforeEach(() => resetTestingVocabulary());
  afterEach(() => harness?.dispose());

  const rep = (value: number) => ({ type: MetricType.Rep, value });

  it('resolves Notebook-scoped Property Overrides across defaults, subscribed Feed Notebooks, and custom runtime precedence', async () => {
    harness = await DomainScenarioHarness.create();

    // `notebook/defaults`: a bundled Effort primitive for `thruster` at MET 6.0.
    await harness.definePropertyNote({
      kind: 'effort',
      slug: 'thruster',
      label: 'Thruster',
      aliases: ['thrusters'],
      baseAttributes: { met: 6.0 },
    });

    // A subscribed Feed Notebook publishes its own `thruster` override at MET 9.5.
    const feedOverride = await harness.definePropertyNote({
      kind: 'effort',
      slug: 'thruster',
      label: 'Double KB Thruster',
      aliases: ['thrusters'],
      baseAttributes: { met: 9.5 },
      notebookId: 'notebook/kettlebell-wod',
      feedSourceId: 'coach-kb',
      seedOrigin: 'seed',
    });
    expect(feedOverride.override?.id).toBe('notebook/kettlebell-wod:effort:thruster');
    const storedOverrides = await harness.storage
      .readonly('property_overrides')
      .getAllFromIndex('by-notebook', 'notebook/kettlebell-wod');
    expect(storedOverrides.map((o) => `${o.kind}:${o.slug}`)).toEqual(['effort:thruster']);

    // The user also carries a personal `notebook/custom` override at MET 7.5.
    await harness.definePropertyNote({
      kind: 'effort',
      slug: 'thruster',
      label: 'Barbell Thruster (My Custom)',
      aliases: ['thrusters'],
      baseAttributes: { met: 7.5 },
      notebookId: 'notebook/custom',
      asOverride: true,
    });

    // Pure defaults scope -> MET 6.0.
    const defaultsResult = await harness.evaluateShakeOut({
      metrics: [rep(21)],
      scope: { notebookId: 'notebook/defaults' },
    });
    expect(defaultsResult.values.met).toEqual({ value: 6.0 });

    // An ordinary Journal workout resolves `source-first`: the Feed Notebook's override wins -> MET 9.5.
    const feedNote = await harness.authorNote({
      id: 'note-kb-fran',
      title: 'KB Fran',
      rawContent: '# KB Fran\n\n```time\n21-15-9\n  Thrusters\n```\n',
      feedOrigin: 'feed',
      feedSourceId: 'coach-kb',
      sourcePath: 'markdown/notebooks/kettlebell-wod/kb-fran.md',
      notebookIds: ['notebook/kettlebell-wod'],
    });
    const sourceFirst = await harness.evaluateShakeOut({
      metrics: [rep(21)],
      scope: { note: feedNote.note },
      mode: 'source-first',
    });
    expect(sourceFirst.values.met).toEqual({ value: 9.5 });

    // Choosing `custom-runtime` processes the same workout with the personal override -> MET 7.5.
    const customRuntime = await harness.evaluateShakeOut({
      metrics: [rep(21)],
      scope: { note: feedNote.note },
      mode: 'custom-runtime',
    });
    expect(customRuntime.values.met).toEqual({ value: 7.5 });
  });

  it('stacks property layers across Statement > Tag > Effort > Equipment > Note > Tag Category precedence', async () => {
    harness = await DomainScenarioHarness.create();

    const sources: ShakeOutSourceInput[] = [
      { layer: 'category', slug: 'equipment', metrics: { resistance: '16 kg', met: 4 } },
      { layer: 'note', slug: 'note-1', metrics: { resistance: '20 kg', work: 'reps * resistance' } },
      { layer: 'equipment', slug: 'kettlebell', metrics: { resistance: '24 kg' } },
      { layer: 'effort', slug: 'swing', metrics: { met: 8 } },
      { layer: 'tag', slug: 'heavy', metrics: { resistance: '32 kg' } },
    ];

    const result = await harness.evaluateShakeOut({ metrics: [rep(10)], sources });

    // Tag (32 kg) outranks Equipment (24 kg), Note (20 kg), and the Category default (16 kg).
    expect(result.values.resistance).toEqual({ value: 32, unit: 'kg' });
    // Effort (MET 8) outranks the Category default (MET 4).
    expect(result.values.met).toEqual({ value: 8 });
    // The Note's `work` equation shakes out against the winning Tag resistance: 10 reps * 32 kg.
    expect(result.values.work).toEqual({ value: 320, unit: 'kg' });
    expect(result.result.resolved).toContain('work');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('resolves dependent equations in topological waves and defers runtime atoms at plan stage', async () => {
    harness = await DomainScenarioHarness.create();

    const barbell: ShakeOutSourceInput[] = [
      {
        layer: 'equipment',
        slug: 'barbell',
        // Authored out of order: power depends on work, which depends on resistance.
        metrics: {
          power: 'work / convert(elapsed, s)',
          work: 'reps * resistance',
          resistance: '100 kg',
        },
      },
    ];

    const plan = await harness.evaluateShakeOut({ metrics: [rep(5)], stage: 'plan', sources: barbell });
    expect(plan.values.resistance).toEqual({ value: 100, unit: 'kg' });
    expect(plan.values.work).toEqual({ value: 500, unit: 'kg' });
    expect(plan.values.power).toBeUndefined();
    expect(plan.result.deferredRuntime).toEqual(['power']);
    expect(plan.diagnostics).toHaveLength(0);

    // At log stage the runtime `elapsed` atom (10 s) lands and power resolves: 500 / 10.
    const log = await harness.evaluateShakeOut({ metrics: [rep(5)], stage: 'log', elapsedMs: 10_000, sources: barbell });
    expect(log.values.work).toEqual({ value: 500, unit: 'kg' });
    expect(log.values.power).toEqual({ value: 50, unit: 'kg/s' });
    expect(log.diagnostics).toHaveLength(0);
  });

  it('emits a Skipped-Dependency Diagnostic when a required runtime input never arrives', async () => {
    harness = await DomainScenarioHarness.create();

    const result = await harness.evaluateShakeOut({
      metrics: [rep(12)],
      stage: 'log',
      sources: [{ layer: 'effort', slug: 'thruster', metrics: { work: 'reps * resistance' } }],
    });

    expect(result.values.work).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      target: 'work',
      sourceLayer: 'effort',
      sourceSlug: 'thruster',
      missing: ['resistance'],
    });

    // The diagnostic itself is a Metric on the container, origin `diagnostic`.
    const diagnosticMetrics = result.container.getByOrigin('diagnostic');
    expect(diagnosticMetrics).toHaveLength(1);
    expect(diagnosticMetrics[0].type).toBe(MetricType.Diagnostic);
    expect(diagnosticMetrics[0].metadata).toMatchObject({
      diagnostic: 'skipped-dependency',
      target: 'work',
      missing: ['resistance'],
    });
  });

  it('compiles Summary Metric rules alongside resolved property metrics', async () => {
    harness = await DomainScenarioHarness.create();

    const result = await harness.evaluateShakeOut({
      metrics: [rep(10)],
      sources: [
        {
          layer: 'tag',
          slug: 'heavy',
          metrics: { work: 'reps * resistance', resistance: '24 kg' },
          summaries: { totalWork: 'sum(work)' },
        },
      ],
    });

    expect(result.values.work).toEqual({ value: 240, unit: 'kg' });
    expect(result.result.resolved).toContain('work');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('evaluates Note summary overrides over Tag defaults, inherits Tag Category metrics, and surfaces totalWork via WQL', async () => {
    harness = await DomainScenarioHarness.create();

    // 1. Tag Category `domain` (`12 kg` resistance) reaches child-tagged statements (`10 * 12 = 120 kg`)
    const categoryResult = await harness.evaluateShakeOut({
      metrics: [rep(10)],
      sources: [
        { layer: 'category', slug: 'domain', metrics: { resistance: '12 kg' } },
        { layer: 'note', slug: 'metric-category-contribution', metrics: { work: 'reps * resistance' } },
      ],
    });
    expect(categoryResult.values.resistance).toEqual({ value: 12, unit: 'kg' });
    expect(categoryResult.values.work).toEqual({ value: 120, unit: 'kg' });

    // 2. Note `summaries.totalWork: sum(work) * 2` outranks `#tonnage` Tag `summaries.totalWork: sum(work)`
    const tonnageRule = extractPropertyRulesFromMeta(
      {
        metrics: { resistance: '24 kg', work: 'reps * resistance' },
        summaries: { totalWork: 'sum(work)' },
      },
      'tag',
      'tonnage',
    );
    const noteOverrideRule = extractPropertyRulesFromMeta(
      { summaries: { totalWork: 'sum(work) * 2' } },
      'note',
      'metric-summary-override',
    );

    const baseDefs = compilePropertySummaryCalcs([tonnageRule]);
    expect(baseDefs.map((d) => d.id)).toContain('totalWork');

    const overrideDefs = compilePropertySummaryCalcs([noteOverrideRule, tonnageRule]);
    expect(overrideDefs.map((d) => d.id)).toContain('totalWork');

    const setShakeOut = await harness.evaluateShakeOut({
      metrics: [rep(10)],
      sources: [
        {
          layer: 'tag',
          slug: 'tonnage',
          metrics: { resistance: '24 kg', work: 'reps * resistance' },
          summaries: { totalWork: 'sum(work)' },
        },
        {
          layer: 'note',
          slug: 'metric-summary-override',
          metrics: {},
          summaries: { totalWork: 'sum(work) * 2' },
        },
      ],
    });
    expect(setShakeOut.values.work).toEqual({ value: 240, unit: 'kg' });

    // 3. Persist base (240) and overridden (480) summary EventRecords and verify WQL `sum:totalWork{} by {session}`
    const note = await harness.authorNote({
      id: 'note-total-work-wql',
      title: 'Metric Note Summary',
      rawContent: '# Metric Note Summary\n\n```time\n10 Kettlebell Swings 24kg\n```\n',
    });
    const sessBase = buildTestSession({
      id: 'sess-work-240',
      noteId: note.note.id,
      startedAt: HARNESS_EPOCH,
      events: [
        {
          grain: 'summary',
          outputType: 'completion',
          metrics: [{ type: 'totalWork' as MetricType, value: 240, unit: 'kg', metadata: { canonicalKey: 'totalWork' } }],
        },
      ],
    });
    const sessOverride = buildTestSession({
      id: 'sess-work-480',
      noteId: note.note.id,
      startedAt: HARNESS_EPOCH + 3_600_000,
      events: [
        {
          grain: 'summary',
          outputType: 'completion',
          metrics: [{ type: 'totalWork' as MetricType, value: 480, unit: 'kg', metadata: { canonicalKey: 'totalWork' } }],
        },
      ],
    });
    await harness.storage.transaction(['sessions', 'events'], 'readwrite', async (tx) => {
      await tx.readwrite('sessions').putMany([sessBase.session, sessOverride.session]);
      await tx.readwrite('events').putMany([...sessBase.events, ...sessOverride.events]);
    });

    const wql = await harness.queryAggregate('sum:totalWork{} by {session}', { anchorNow: HARNESS_EPOCH + 7_200_000 });
    const bySession = new Map(wql.series.map((s) => [s.label, s.points[0]?.value]));
    expect(bySession.get('sess-work-240')).toBe(240);
    expect(bySession.get('sess-work-480')).toBe(480);
  });
});
