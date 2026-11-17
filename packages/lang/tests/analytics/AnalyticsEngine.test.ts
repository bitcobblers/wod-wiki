import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalyticsEngine } from '../../src/analytics/AnalyticsEngine';
import { IOutputStatement, OutputStatement } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { IRealtimeProcessor } from '../../src/analytics/IRealtimeProcessor';
import { ISummaryProcessor } from '../../src/analytics/ISummaryProcessor';
import { ProjectionResult } from '../../src/analytics/ProjectionResult';
import { MetricType } from '@bitcobblers/wod-wiki-core';

function makeSegmentOutput(id: string, extraMetrics?: { type: MetricType; value: unknown }[]): IOutputStatement {
  const metrics = MetricContainer.empty(id);
  if (extraMetrics) {
    for (const m of extraMetrics) {
      metrics.add({
        type: m.type,
        image: String(m.value),
        value: m.value,
        origin: 'runtime',
        timestamp: new Date(0),
      });
    }
  }
  return new OutputStatement({
    outputType: 'segment',
    sourceBlockKey: id,
    stackLevel: 0,
    timeSpan: { started: 0, ended: 1000 },
    metrics,
    isLeaf: true,
  });
}

function makeSystemOutput(id: string): IOutputStatement {
  return new OutputStatement({
    outputType: 'system',
    sourceBlockKey: id,
    stackLevel: 0,
    timeSpan: { started: 0, ended: 1000 },
    metrics: MetricContainer.empty(id),
    isLeaf: true,
  });
}

describe('AnalyticsEngine', () => {
  beforeEach(() => {
    OutputStatement.resetIdCounter();
  });

  it('should run realtime processors in order on run()', () => {
    const engine = new AnalyticsEngine();
    const order: string[] = [];

    const p1: IRealtimeProcessor = {
      id: 'p1',
      process: (out: IOutputStatement) => {
        order.push('p1');
        return out;
      },
    };
    const p2: IRealtimeProcessor = {
      id: 'p2',
      process: (out: IOutputStatement) => {
        order.push('p2');
        return out;
      },
    };

    engine.addRealtimeProcessor(p1);
    engine.addRealtimeProcessor(p2);
    engine.run(makeSegmentOutput('test'));

    expect(order).toEqual(['p1', 'p2']);
  });

  it('should run summary processors on finalize()', () => {
    const engine = new AnalyticsEngine();
    let summarized = false;

    const summary: ISummaryProcessor = {
      id: 'sum1',
      summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => {
        summarized = true;
        return [{
          name: 'Total Reps',
          value: 42,
          unit: 'reps',
          timeSpan: { started: 0, ended: 1000 },
        }];
      },
    };

    engine.addSummaryProcessor(summary);
    engine.run(makeSegmentOutput('s1'));
    const results = engine.finalize();

    expect(summarized).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].outputType).toBe('analytics');
  });

  describe('live/finalize deduplication', () => {
    it('finalize returns empty when projections were already emitted live', () => {
      const engine = new AnalyticsEngine();
      const summary: ISummaryProcessor = {
        id: 'sum-dedup',
        summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => [
          {
            name: 'Total Reps',
            value: 42,
            unit: 'reps',
            timeSpan: { started: 0, ended: 1000 },
            metricType: MetricType.Rep,
          },
        ],
      };
      engine.addSummaryProcessor(summary);

      const live: IOutputStatement[] = [];
      engine.setLiveOutputEmitter((batch) => live.push(...batch));

      engine.run(makeSegmentOutput('s1'));
      expect(live).toHaveLength(1);
      expect(live[0].outputType).toBe('analytics');

      const finalized = engine.finalize();
      expect(finalized).toHaveLength(0);
      expect(live).toHaveLength(1);
    });

    it('finalize still emits when no live output was emitted', () => {
      const engine = new AnalyticsEngine();
      const summary: ISummaryProcessor = {
        id: 'sum-dedup',
        summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => [
          {
            name: 'Total Reps',
            value: 42,
            unit: 'reps',
            timeSpan: { started: 0, ended: 1000 },
            metricType: MetricType.Rep,
          },
        ],
      };
      engine.addSummaryProcessor(summary);

      engine.run(makeSegmentOutput('s1'));
      const finalized = engine.finalize();
      expect(finalized).toHaveLength(1);
      expect(finalized[0].outputType).toBe('analytics');
    });

    it('run skips the live emission when projections are unchanged (completion block-pop cascade)', () => {
      const engine = new AnalyticsEngine();
      const summary: ISummaryProcessor = {
        id: 'sum-static',
        summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => [
          {
            name: 'Total Reps',
            value: 75,
            unit: 'reps',
            timeSpan: { started: 0, ended: 1000 },
            metricType: MetricType.Rep,
          },
        ],
      };
      engine.addSummaryProcessor(summary);

      const live: IOutputStatement[] = [];
      engine.setLiveOutputEmitter((batch) => live.push(...batch));

      // Several blocks popping at completion each trigger run(); aggregates
      // don't change between them, so only the first may emit.
      engine.run(makeSegmentOutput('s1'));
      engine.run(makeSegmentOutput('s2'));
      engine.run(makeSegmentOutput('s3'));
      expect(live).toHaveLength(1);
    });

    it('run emits again once projections actually change', () => {
      const engine = new AnalyticsEngine();
      let reps = 10;
      const summary: ISummaryProcessor = {
        id: 'sum-growing',
        summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => [
          {
            name: 'Total Reps',
            value: reps,
            unit: 'reps',
            timeSpan: { started: 0, ended: 1000 },
            metricType: MetricType.Rep,
          },
        ],
      };
      engine.addSummaryProcessor(summary);

      const live: IOutputStatement[] = [];
      engine.setLiveOutputEmitter((batch) => live.push(...batch));

      engine.run(makeSegmentOutput('s1'));
      reps = 25;
      engine.run(makeSegmentOutput('s2'));
      expect(live).toHaveLength(2);
    });
  });

  describe('processor split behavior', () => {
    it('realtime processors enrich per-segment outputs', () => {
      const engine = new AnalyticsEngine();
      const enricher: IRealtimeProcessor = {
        id: 'enrich-reps',
        process: (out: IOutputStatement) => {
          if (out.outputType === 'segment') {
            out.metrics.add({
              type: MetricType.Rep,
              image: '10',
              value: 10,
              origin: 'analyzed',
              timestamp: new Date(0),
            });
          }
          return out;
        },
      };

      engine.addRealtimeProcessor(enricher);
      const result = engine.run(makeSegmentOutput('seg1'));

      expect(result.getMetric(MetricType.Rep)?.value).toBe(10);
    });

    it('summary processors receive accumulated segment history', () => {
      const engine = new AnalyticsEngine();
      let receivedOutputs: IOutputStatement[] = [];

      const summarizer: ISummaryProcessor = {
        id: 'count-segments',
        summarize: (outputs: IOutputStatement[]): ProjectionResult[] => {
          receivedOutputs = outputs;
          return [{
            name: 'Segment Count',
            value: outputs.length,
            unit: 'segments',
            timeSpan: { started: 0, ended: 1000 },
          }];
        },
      };

      engine.addSummaryProcessor(summarizer);
      engine.run(makeSegmentOutput('s1'));
      engine.run(makeSegmentOutput('s2'));
      engine.run(makeSegmentOutput('s3'));
      engine.finalize();

      expect(receivedOutputs).toHaveLength(3);
    });

    it('does not accumulate non-segment outputs in history', () => {
      const engine = new AnalyticsEngine();
      let receivedOutputs: IOutputStatement[] = [];

      const summarizer: ISummaryProcessor = {
        id: 'count-segments',
        summarize: (outputs: IOutputStatement[]): ProjectionResult[] => {
          receivedOutputs = outputs;
          return [];
        },
      };

      engine.addSummaryProcessor(summarizer);
      engine.run(makeSegmentOutput('s1'));
      engine.run(makeSystemOutput('sys1'));
      engine.run(makeSegmentOutput('s2'));
      engine.finalize();

      expect(receivedOutputs).toHaveLength(2);
      expect(receivedOutputs.every(o => o.outputType === 'segment')).toBe(true);
    });

    it('isolates realtime processor errors so others continue', () => {
      const engine = new AnalyticsEngine();
      const order: string[] = [];
      const errorSpy = vi.fn(() => {});
      const originalError = console.error;
      console.error = errorSpy as unknown as typeof console.error;

      try {
        const bad: IRealtimeProcessor = {
          id: 'bad',
          process: () => {
            order.push('bad');
            throw new Error('intentional failure');
          },
        };
        const good: IRealtimeProcessor = {
          id: 'good',
          process: (out: IOutputStatement) => {
            order.push('good');
            return out;
          },
        };

        engine.addRealtimeProcessor(bad);
        engine.addRealtimeProcessor(good);
        engine.run(makeSegmentOutput('s1'));

        expect(order).toEqual(['bad', 'good']);
        expect(errorSpy).toHaveBeenCalledTimes(1);
      } finally {
        console.error = originalError;
      }
    });

    it('isolates summary processor errors so others continue', () => {
      const engine = new AnalyticsEngine();
      const errorSpy = vi.fn(() => {});
      const originalError = console.error;
      console.error = errorSpy as unknown as typeof console.error;

      try {
        const bad: ISummaryProcessor = {
          id: 'bad-sum',
          summarize: () => {
            throw new Error('intentional failure');
          },
        };
        const good: ISummaryProcessor = {
          id: 'good-sum',
          summarize: (): ProjectionResult[] => [{
            name: 'Good',
            value: 1,
            unit: 'x',
            timeSpan: { started: 0, ended: 1000 },
          }],
        };

        engine.addSummaryProcessor(bad);
        engine.addSummaryProcessor(good);
        engine.run(makeSegmentOutput('s1'));
        const results = engine.finalize();

        expect(results).toHaveLength(1);
        expect(results[0].outputType).toBe('analytics');
        expect(errorSpy).toHaveBeenCalledTimes(1);
      } finally {
        console.error = originalError;
      }
    });

    it('emits a live analytics output after each segment', () => {
      const engine = new AnalyticsEngine();
      const emitted: IOutputStatement[] = [];
      engine.setLiveOutputEmitter((batch) => emitted.push(...batch));

      const summary: ISummaryProcessor = {
        id: 'live-sum',
        summarize: (outputs: IOutputStatement[]): ProjectionResult[] => [{
          name: 'Count',
          value: outputs.length,
          unit: 'segments',
          timeSpan: { started: 0, ended: 1000 },
        }],
      };

      engine.addSummaryProcessor(summary);
      engine.run(makeSegmentOutput('s1'));
      engine.run(makeSegmentOutput('s2'));

      // One live 'analytics' output per segment, each carrying the projection.
      expect(emitted).toHaveLength(2);
      expect(emitted[0].outputType).toBe('analytics');
      const valueMetric = emitted[0].metrics.find(m => m.value === 1);
      expect(valueMetric?.unit).toBe('segments');
    });

    it('finalize produces analytics OutputStatements with metrics', () => {
      const engine = new AnalyticsEngine();
      const summary: ISummaryProcessor = {
        id: 'sum',
        summarize: (): ProjectionResult[] => [{
          name: 'Total',
          value: 99,
          unit: 'reps',
          metricType: MetricType.Rep,
          timeSpan: { started: 0, ended: 1000 },
        }],
      };

      engine.addSummaryProcessor(summary);
      engine.run(makeSegmentOutput('s1'));
      const results = engine.finalize();

      expect(results).toHaveLength(1);
      expect(results[0].outputType).toBe('analytics');
      expect(results[0].sourceBlockKey).toBe('analytics-summary');
      expect(results[0].getMetric(MetricType.Label)?.value).toBe('Total');
      expect(results[0].getMetric(MetricType.Rep)?.value).toBe(99);
    });

    it('passes through analyzed-estimated origin from ProjectionResult', () => {
      const engine = new AnalyticsEngine();
      const summary: ISummaryProcessor = {
        id: 'est-sum',
        summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => {
          return [{
            name: 'Estimated Metric',
            value: 50,
            unit: 'pts',
            origin: 'analyzed-estimated',
            timeSpan: { started: 0, ended: 1000 },
          }];
        },
      };

      engine.addSummaryProcessor(summary);
      engine.run(makeSegmentOutput('s1'));
      const results = engine.finalize();

      expect(results).toHaveLength(1);
      const metrics = results[0].metrics?.rawMetrics ?? [];
      const valueMetric = metrics.find((m: any) => m.type !== 'label');
      expect(valueMetric?.origin).toBe('analyzed-estimated');
    });

    it('defaults to analyzed origin when ProjectionResult has no origin', () => {
      const engine = new AnalyticsEngine();
      const summary: ISummaryProcessor = {
        id: 'normal-sum',
        summarize: (_outputs: IOutputStatement[]): ProjectionResult[] => {
          return [{
            name: 'Normal Metric',
            value: 42,
            unit: 'x',
            timeSpan: { started: 0, ended: 1000 },
          }];
        },
      };

      engine.addSummaryProcessor(summary);
      engine.run(makeSegmentOutput('s1'));
      const results = engine.finalize();

      const metrics = results[0].metrics?.rawMetrics ?? [];
      const valueMetric = metrics.find((m: any) => m.type !== 'label');
      expect(valueMetric?.origin).toBe('analyzed');
    });
  });
});
