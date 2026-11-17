/**
 * Effort Registry CRUD + Analytics Resolution — Integration Test
 *
 * End-to-end scenario:
 *   1. Create a custom effort via registry upsert
 *   2. Use it in a workout output statement
 *   3. Run analytics engine with two-pass resolution
 *   4. Verify correct MET and origin (user effort → analyzed)
 *   5. Edit the effort (change MET)
 *   6. Re-run analytics → updated MET reflected
 *   7. Delete the effort
 *   8. Re-run analytics → synthetic fallback with default MET 5.0
 *
 * @see docs/adr/effort-resolution-compile-time.md
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { AnalyticsEngine } from '@bitcobblers/wod-wiki-engine';
import { StandardAnalyticsProfile } from '@bitcobblers/wod-wiki-engine';
import type { AnalyticsProfileContext } from '@bitcobblers/wod-wiki-engine';

import { InMemoryEffortRegistry, EffortResolver } from '@bitcobblers/wod-wiki-lang';
import { OutputStatement } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { EFFORT_DATA_METRIC_TYPE } from '@bitcobblers/wod-wiki-engine';
import type { IEffort, IOutputStatement } from '@bitcobblers/wod-wiki-engine';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSegment(
  id: string,
  metrics: { type: MetricType | string; value: unknown; origin?: string }[],
): IOutputStatement {
  const container = MetricContainer.empty(id);
  for (const m of metrics) {
    container.add({
      type: m.type as MetricType,
      image: String(m.value),
      value: m.value,
      origin: (m.origin ?? 'runtime') as import('@bitcobblers/wod-wiki-engine').MetricOrigin,
      timestamp: new Date(0),
    });
  }
  return new OutputStatement({
    outputType: 'segment',
    sourceBlockKey: id,
    stackLevel: 0,
    timeSpan: { started: 0, ended: 60_000 },
    metrics: container,
    isLeaf: true,
  });
}

function buildEngine(context: AnalyticsProfileContext): AnalyticsEngine {
  const profile = new StandardAnalyticsProfile();
  const { realtime, summary } = profile.build(context);
  const engine = new AnalyticsEngine();
  for (const p of realtime) engine.addRealtimeProcessor(p);
  for (const p of summary) engine.addSummaryProcessor(p);
  return engine;
}

function extractEffortData(result: IOutputStatement) {
  return result.metrics.getAllMetricsByType(EFFORT_DATA_METRIC_TYPE as MetricType);
}

function extractWorkMetric(results: IOutputStatement[]) {
  return results.find(r => r.getMetric(MetricType.Work));
}

// ─── test data ──────────────────────────────────────────────────────────────

const customEffort: IEffort = {
  id: 'effort-user-test-hiit',
  slug: 'my-hiit-circuit',
  label: 'My HIIT Circuit',
  aliases: ['hiit', 'circuit'],
  baseAttributes: { met: 8.5, discipline: 'strength', intensityTier: 'high' },
  registrySource: 'user',
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
};

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Effort Registry CRUD + Analytics Resolution', () => {
  let registry: InMemoryEffortRegistry;
  let resolver: EffortResolver;

  beforeEach(() => {
    OutputStatement.resetIdCounter();
    registry = new InMemoryEffortRegistry();
    resolver = new EffortResolver(registry);
  });

  describe('Create → Analytics', () => {
    it('resolves a newly created custom effort with correct MET in analytics', () => {
      // 1. Create custom effort
      registry.upsert(customEffort);

      // 2. Build analytics context with the resolver
      const context: AnalyticsProfileContext = {
        dialect: 'time',
        scriptMetricTypes: new Set([MetricType.Action]),
        analyticsContext: { effortResolver: resolver },
      };
      const engine = buildEngine(context);

      // 3. Workout segment referencing the custom effort
      const output = makeSegment('seg1', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]);

      // 4. Run analytics
      const result = engine.run(output);
      const effortData = extractEffortData(result);

      // 5. Verify
      expect(effortData).toHaveLength(1);
      expect(effortData[0].origin).toBe('analyzed');
      expect((effortData[0].value as any).slug).toBe('my-hiit-circuit');
      expect((effortData[0].value as any).baseAttributes.met).toBe(8.5);
    });

    it('composed met-minutes calc computes MET-minutes from custom effort MET', () => {
      registry.upsert(customEffort);

      const context: AnalyticsProfileContext = {
        dialect: 'time',
        scriptMetricTypes: new Set([MetricType.Action]),
        analyticsContext: { effortResolver: resolver },
      };
      const engine = buildEngine(context);

      engine.run(makeSegment('seg1', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));

      const results = engine.finalize();
      const work = extractWorkMetric(results);
      expect(work).toBeDefined();
      // 8.5 MET × 60 min = 510 MET-minutes
      expect(work!.getMetric(MetricType.Work)?.value).toBe(510);
    });
  });

  describe('Edit → Analytics', () => {
    it('reflects updated MET after editing a custom effort', async () => {
      // 1. Create
      await registry.upsert(customEffort);

      // 2. First analytics run
      const context1: AnalyticsProfileContext = {
        dialect: 'time',
        scriptMetricTypes: new Set([MetricType.Action]),
        analyticsContext: { effortResolver: resolver },
      };
      const engine1 = buildEngine(context1);
      engine1.run(makeSegment('seg1', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));
      const results1 = engine1.finalize();
      const work1 = extractWorkMetric(results1);
      expect(work1!.getMetric(MetricType.Work)?.value).toBe(510);

      // 3. Edit — increase MET from 8.5 to 10.0
      const updatedEffort = { ...customEffort, baseAttributes: { ...customEffort.baseAttributes, met: 10.0 } };
      await registry.upsert(updatedEffort);

      // 4. Second analytics run with same resolver (now sees updated effort)
      const engine2 = buildEngine(context1);
      engine2.run(makeSegment('seg2', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));
      const results2 = engine2.finalize();
      const work2 = extractWorkMetric(results2);

      // 5. Verify updated MET reflected
      expect(work2!.getMetric(MetricType.Work)?.value).toBe(600);
    });
  });

  describe('Delete → Analytics', () => {
    it('falls back to synthetic effort with default MET after deletion', async () => {
      // 1. Create
      await registry.upsert(customEffort);

      // 2. Verify it resolves
      const context: AnalyticsProfileContext = {
        dialect: 'time',
        scriptMetricTypes: new Set([MetricType.Action]),
        analyticsContext: { effortResolver: resolver },
      };
      const engine1 = buildEngine(context);
      engine1.run(makeSegment('seg1', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));
      const results1 = engine1.finalize();
      const work1 = extractWorkMetric(results1);
      expect(work1!.getMetric(MetricType.Work)?.value).toBe(510);

      // 3. Delete
      await registry.delete('my-hiit-circuit');

      // 4. Re-run analytics — resolver now creates synthetic fallback
      const engine2 = buildEngine(context);
      engine2.run(makeSegment('seg2', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));
      const results2 = engine2.finalize();
      const work2 = extractWorkMetric(results2);

      // 5. Verify synthetic fallback with default MET 5.0
      expect(work2).toBeDefined();
      expect(work2!.getMetric(MetricType.Work)?.value).toBe(300); // 5.0 × 60

      // Verify the effort-data metric shows synthetic-unresolved
      const result = engine2.run(makeSegment('seg3', [
        { type: MetricType.Effort, value: 'my-hiit-circuit', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));
      const effortData = extractEffortData(result);
      expect(effortData[0].origin).toBe('analyzed-estimated');
      expect((effortData[0].value as any).registrySource).toBe('synthetic-unresolved');
      expect((effortData[0].value as any).baseAttributes.met).toBe(5.0);
    });
  });

  describe('User override wins over bundled', () => {
    it('analytics uses user-overridden MET instead of bundled MET', async () => {
      // Seed bundled rowing effort
      const bundledRowing: IEffort = {
        id: 'effort-bundled-rowing',
        slug: 'rowing',
        label: 'Rowing',
        aliases: ['row', 'rower'],
        baseAttributes: { met: 7.0, discipline: 'rowing', intensityTier: 'high' },
        registrySource: 'bundled',
      };
      registry.seed([bundledRowing]);

      // Create user override with higher MET
      const userRowing: IEffort = {
        ...bundledRowing,
        id: 'effort-user-rowing',
        registrySource: 'user',
        baseAttributes: { ...bundledRowing.baseAttributes, met: 9.0 },
      };
      await registry.upsert(userRowing);

      const context: AnalyticsProfileContext = {
        dialect: 'time',
        scriptMetricTypes: new Set([MetricType.Action]),
        analyticsContext: { effortResolver: resolver },
      };
      const engine = buildEngine(context);
      engine.run(makeSegment('seg1', [
        { type: MetricType.Effort, value: 'rowing', origin: 'parser' },
        { type: MetricType.Elapsed, value: 3_600_000, origin: 'runtime' },
      ]));
      const results = engine.finalize();
      const work = extractWorkMetric(results);

      // Should use user MET (9.0) not bundled MET (7.0)
      expect(work!.getMetric(MetricType.Work)?.value).toBe(540); // 9.0 × 60
    });
  });
});
