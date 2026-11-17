/**
 * Processor Split Validation Test
 *
 * Validates the analytics processor split (ADR-0001) and profile-driven
 * assembly (ADR-0005) end-to-end. Confirms:
 *
 *   1. Realtime processors enrich per-segment as outputs arrive.
 *   2. Summary processors aggregate across the accumulated segment history.
 *   3. StandardAnalyticsProfile drives engine assembly — no hardcoded lists.
 *   4. Error isolation: one failing processor does not break the pipeline.
 *
 * The legacy IAnalyticsStage shim (AnalyticsEngine.addStage) was removed as
 * part of the Tier 1 architectural cleanup (docs/architectural-cleanup-tier-1-deletions.md
 * §1.4) — it had zero production callers. Its parity test was removed with it.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { AnalyticsEngine } from '@bitcobblers/wod-wiki-engine';
import { StandardAnalyticsProfile } from '@bitcobblers/wod-wiki-engine';
import type { AnalyticsProfileContext } from '@bitcobblers/wod-wiki-engine';
import { IRealtimeProcessor } from '@bitcobblers/wod-wiki-engine';
import { ISummaryProcessor } from '@bitcobblers/wod-wiki-engine';
import { ProjectionResult } from '@bitcobblers/wod-wiki-engine';
import { IOutputStatement, OutputStatement } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { MockEffortResolver } from '@wod-wiki/lang-harness/harness/MockEffortResolver';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSegment(id: string, metrics: { type: MetricType; value: unknown }[] = []): IOutputStatement {
  const container = MetricContainer.empty(id);
  for (const m of metrics) {
    container.add({
      type: m.type,
      image: String(m.value),
      value: m.value,
      origin: 'runtime',
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

function makeContext(dialect: AnalyticsProfileContext['dialect'], metricTypes: MetricType[]): AnalyticsProfileContext {
  return { dialect, scriptMetricTypes: new Set(metricTypes) };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('ADR-0001 + ADR-0005 Processor Split Validation', () => {
  beforeEach(() => {
    OutputStatement.resetIdCounter();
  });

  describe('1. Realtime enrichment is per-segment', () => {
    it('adds derived metrics to each segment independently', () => {
      const engine = new AnalyticsEngine();

      const realtime: IRealtimeProcessor = {
        id: 'double-reps',
        process: (out: IOutputStatement) => {
          const rep = out.getMetric(MetricType.Rep);
          if (rep && typeof rep.value === 'number') {
            out.metrics.add({
              type: 'analyzed-reps' as MetricType,
              image: String(rep.value * 2),
              value: rep.value * 2,
              origin: 'analyzed',
              timestamp: new Date(0),
            });
          }
          return out;
        },
      };

      engine.addRealtimeProcessor(realtime);

      const seg1 = engine.run(makeSegment('s1', [{ type: MetricType.Rep, value: 5 }]));
      const seg2 = engine.run(makeSegment('s2', [{ type: MetricType.Rep, value: 10 }]));

      expect(seg1.getMetric('analyzed-reps' as MetricType)?.value).toBe(10);
      expect(seg2.getMetric('analyzed-reps' as MetricType)?.value).toBe(20);
    });

    it('does not mutate non-segment outputs', () => {
      const engine = new AnalyticsEngine();
      const realtime: IRealtimeProcessor = {
        id: 'only-segments',
        process: (out: IOutputStatement) => {
          if (out.outputType !== 'segment') return out;
          out.metrics.add({
            type: 'flag' as MetricType,
            image: 'flagged',
            value: true,
            origin: 'analyzed',
            timestamp: new Date(0),
          });
          return out;
        },
      };

      engine.addRealtimeProcessor(realtime);

      const systemOut = new OutputStatement({
        outputType: 'system',
        sourceBlockKey: 'sys',
        stackLevel: 0,
        timeSpan: { started: 0, ended: 1000 },
        metrics: MetricContainer.empty('sys'),
        isLeaf: true,
      });

      const result = engine.run(systemOut);
      expect(result.hasMetric('flag' as MetricType)).toBe(false);
    });
  });

  describe('2. Summary aggregation is cross-segment', () => {
    it('receives all prior segment outputs on finalize', () => {
      const engine = new AnalyticsEngine();
      let callCount = 0;
      let lastOutputs: IOutputStatement[] = [];

      const summary: ISummaryProcessor = {
        id: 'agg',
        summarize: (outputs: IOutputStatement[]) => {
          callCount++;
          lastOutputs = outputs;
          const totalReps = outputs.reduce((sum, o) => {
            const rep = o.getMetric(MetricType.Rep);
            return sum + (typeof rep?.value === 'number' ? rep.value : 0);
          }, 0);
          return [{
            name: 'Total Reps',
            value: totalReps,
            unit: 'reps',
            timeSpan: { started: 0, ended: 1000 },
          }];
        },
      };

      engine.addSummaryProcessor(summary);
      engine.run(makeSegment('s1', [{ type: MetricType.Rep, value: 5 }]));
      engine.run(makeSegment('s2', [{ type: MetricType.Rep, value: 10 }]));
      const results = engine.finalize();

      expect(callCount).toBe(1);
      expect(lastOutputs).toHaveLength(2);
      // ProjectionResult without metricType falls back to MetricType.Metric in finalize()
      expect(results[0].getMetric(MetricType.Metric)?.value).toBe(15);
    });

    it('runs summary processors only on segment history', () => {
      const engine = new AnalyticsEngine();
      let received: IOutputStatement[] = [];

      const summary: ISummaryProcessor = {
        id: 'type-check',
        summarize: (outputs: IOutputStatement[]) => {
          received = outputs;
          return [];
        },
      };

      engine.addSummaryProcessor(summary);
      engine.run(makeSegment('s1'));
      engine.run(new OutputStatement({
        outputType: 'event',
        sourceBlockKey: 'evt',
        stackLevel: 0,
        timeSpan: { started: 0, ended: 1000 },
        metrics: MetricContainer.empty('evt'),
        isLeaf: true,
      }));
      engine.run(makeSegment('s2'));
      engine.finalize();

      expect(received).toHaveLength(2);
      expect(received.every(o => o.outputType === 'segment')).toBe(true);
    });
  });

  describe('3. Profile-driven assembly (no hardcoded registration)', () => {
    it('builds engine from StandardAnalyticsProfile context', () => {
      const profile = new StandardAnalyticsProfile();
      const context: AnalyticsProfileContext = {
        ...makeContext('time', [MetricType.Rep, MetricType.Resistance]),
        analyticsContext: { effortResolver: new MockEffortResolver() },
      };
      const { realtime, summary } = profile.build(context);

      const engine = new AnalyticsEngine();
      for (const p of realtime) engine.addRealtimeProcessor(p);
      for (const p of summary) engine.addSummaryProcessor(p);

      // Built-ins are the effort-resolution bridge + the composed calc engine.
      expect(realtime.map(p => p.id)).toEqual(['two-pass-effort-resolution', 'composed-calculations']);
      expect(summary.map(p => p.id)).toEqual(['composed-calculations']);

      // Run a segment with reps + resistance — the power calc adds a metric.
      const seg = makeSegment('bench', [
        { type: MetricType.Rep, value: 10 },
        { type: MetricType.Resistance, value: { amount: 100, units: 'kg' } },
        { type: MetricType.Elapsed, value: 30_000 },
      ]);
      const enriched = engine.run(seg);
      expect(enriched.metrics.some(m => m.type === 'power')).toBe(true);

      // Finalize produces the volume projection under its canonical key.
      const analytics = engine.finalize();
      const volume = analytics.find(a =>
        (a.getMetric(MetricType.Volume)?.metadata as Record<string, unknown> | undefined)?.canonicalKey === 'totalVolume'
        && !a.getMetric(MetricType.Volume)?.metadata?.effortSlug);
      expect(volume).toBeDefined();
      expect(volume!.getMetric(MetricType.Volume)?.value).toBe(1000); // 10 reps × 100 kg
    });

    it('applies calcs dynamically: no power without reps/resistance (#848)', () => {
      // The static requiredMetrics tier is gone for built-in calcs —
      // applicability is a `when` predicate evaluated per segment.
      const profile = new StandardAnalyticsProfile();
      const context: AnalyticsProfileContext = {
        ...makeContext('time', [MetricType.Elapsed]),
        analyticsContext: { effortResolver: new MockEffortResolver() },
      };
      const { realtime, summary } = profile.build(context);
      const engine = new AnalyticsEngine();
      for (const p of realtime) engine.addRealtimeProcessor(p);
      for (const p of summary) engine.addSummaryProcessor(p);

      const enriched = engine.run(makeSegment('plank', [{ type: MetricType.Elapsed, value: 30_000 }]));
      expect(enriched.metrics.some(m => m.type === 'power')).toBe(false);

      const analytics = engine.finalize();
      expect(analytics.some(a => a.getMetric(MetricType.Volume))).toBe(false);
      expect(analytics.some(a => a.getMetric(MetricType.Rep))).toBe(false);
    });


  });

  describe('4. Error isolation across the pipeline', () => {
    it('continues when a realtime processor throws', () => {
      const engine = new AnalyticsEngine();

      engine.addRealtimeProcessor({
        id: 'thrower',
        process: () => { throw new Error('boom'); },
      });
      engine.addRealtimeProcessor({
        id: 'marker',
        process: (out: IOutputStatement) => {
          out.metrics.add({ type: 'marked' as MetricType, image: 'marked', value: true, origin: 'analyzed', timestamp: new Date(0) });
          return out;
        },
      });

      const result = engine.run(makeSegment('s1'));
      expect(result.hasMetric('marked' as MetricType)).toBe(true);
    });

    it('continues when a summary processor throws', () => {
      const engine = new AnalyticsEngine();

      engine.addSummaryProcessor({
        id: 'thrower',
        summarize: () => { throw new Error('boom'); },
      });
      engine.addSummaryProcessor({
        id: 'marker',
        summarize: (): ProjectionResult[] => [{
          name: 'Marked',
          value: 1,
          unit: 'x',
          timeSpan: { started: 0, ended: 1000 },
        }],
      });

      engine.run(makeSegment('s1'));
      const results = engine.finalize();

      expect(results.some(r => r.getMetric(MetricType.Label)?.value === 'Marked')).toBe(true);
    });
  });
});
