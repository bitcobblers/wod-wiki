import { describe, it, expect } from 'bun:test';
import { getAnalyticsFromRuntime, getAnalyticsFromLogs, AnalyticsTransformer, type SegmentWithMetadata } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { TimeSpan } from '@bitcobblers/wod-wiki-engine';
import { IOutputStatement, OutputStatementType } from '@bitcobblers/wod-wiki-engine';
import type { StoredOutputStatement } from '../components/Editor/types';
import { MetricType, IMetric } from '@bitcobblers/wod-wiki-engine';
import { hintMetric } from '@bitcobblers/wod-wiki-engine';

// Helper to create mock output statements. Generic so tests can type the
// result as the plain stored shape (getAnalyticsFromLogs input) or the live
// IOutputStatement shape; the fabricated object satisfies both structurally.
function createMockOutput<T = IOutputStatement>(options: {
  id?: number;
  outputType?: OutputStatementType;
  started?: number;
  ended?: number;
  sourceBlockKey?: string;
  stackLevel?: number;
  completionReason?: string;
  metrics?: Array<Partial<IMetric> & { type: MetricType | string; key?: string; metadata?: Record<string, unknown> }>;
  hints?: string[];
}): T {
  const now = Date.now();
  const timeSpan = new TimeSpan(options.started ?? now, options.ended ?? now + 60000);
  // Hints now travel as Hint metrics within the metric list.
  const metrics = [
    ...(options.metrics ?? []),
    ...((options.hints ?? []).map(h => hintMetric(h, 'runtime'))),
  ];
  return {
    id: options.id ?? 1,
    outputType: options.outputType ?? 'segment',
    timeSpan,
    sourceBlockKey: options.sourceBlockKey ?? 'block-1',
    stackLevel: options.stackLevel ?? 0,
    metrics,
    sourceStatementId: undefined,
    meta: { line: 0, columnStart: 0, columnEnd: 0, startOffset: 0, endOffset: 0, length: 0, raw: '' },
    isLeaf: true,
    completionReason: options.completionReason,
  } as unknown as T;
}

describe('AnalyticsTransformer', () => {
  describe('getAnalyticsFromRuntime', () => {
    it('returns empty result when runtime is null', () => {
      const result = getAnalyticsFromRuntime(null);
      expect(result.segments).toEqual([]);
      expect(result.groups).toEqual([]);
    });

    it('returns empty result when runtime has no output statements', () => {
      const runtime = {
        getOutputStatements: () => [],
      } as unknown as IScriptRuntime;

      const result = getAnalyticsFromRuntime(runtime);
      expect(result.segments).toEqual([]);
      expect(result.groups).toEqual([]);
    });

    it('transforms output statements into segments', () => {
      const startTime = Date.now();
      const outputs: IOutputStatement[] = [
        createMockOutput({
          id: 1,
          outputType: 'segment',
          started: startTime,
          ended: startTime + 60000,
          metrics: [
            { type: MetricType.Effort, value: 'Warmup', image: 'Warmup' },
            { type: MetricType.Elapsed, value: 60000, origin: 'runtime' },
          ]
        })
      ];

      const runtime = {
        getOutputStatements: () => outputs,
      } as unknown as IScriptRuntime;

      const result = getAnalyticsFromRuntime(runtime);

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].name).toBe('Warmup');
      expect(result.segments[0].elapsed).toBe(60);
    });

    it('retains calculated and custom metric keys when available', () => {
      const startTime = Date.now();
      const outputs: IOutputStatement[] = [
        createMockOutput({
          id: 1,
          outputType: 'segment',
          started: startTime,
          ended: startTime + 30000,
          metrics: [
            { type: MetricType.Custom, key: 'custom_metric', value: 7, unit: 'pts', image: 'Custom Metric', origin: 'runtime' },
            { type: MetricType.Calculated, value: 420, unit: 'pts', image: '420 pts', origin: 'runtime', metadata: { target: 'totalLoad' } },
          ],
        }),
      ];

      const runtime = {
        getOutputStatements: () => outputs,
      } as unknown as IScriptRuntime;

      const result = getAnalyticsFromRuntime(runtime);
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].metric).toMatchObject({
        custom_metric: 7,
        totalLoad: 420,
      });
    });

    it('ignores non-segment output types (load, system, etc.)', () => {
      const startTime = Date.now();
      const outputs: IOutputStatement[] = [
        createMockOutput({
          id: 1,
          outputType: 'load',
          started: startTime,
          ended: startTime,
          metrics: [{ type: MetricType.Label, value: 'Load', image: 'Load' }]
        }),
        createMockOutput({
          id: 2,
          outputType: 'segment',
          started: startTime,
          ended: startTime + 60000,
          metrics: [{ type: MetricType.Effort, value: 'Work', image: 'Work' }]
        }),
        createMockOutput({
          id: 3,
          outputType: 'system',
          started: startTime + 60000,
          ended: startTime + 60000,
          metrics: [{ type: MetricType.System, value: 'pop', image: 'pop' }]
        })
      ];

      const runtime = {
        getOutputStatements: () => outputs,
      } as unknown as IScriptRuntime;

      const result = getAnalyticsFromRuntime(runtime);

      // Should ONLY include the 'segment' output
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].name).toBe('Work');
    });
  });

  describe('AnalyticsTransformer Class', () => {
    const transformer = new AnalyticsTransformer();

    describe('fromOutputStatements', () => {
      it('returns empty array for empty outputs', () => {
        const segments = transformer.fromOutputStatements([]);
        expect(segments).toEqual([]);
      });

      it('transforms outputs to segments with hints as tags', () => {
        const startTime = Date.now();
        const output = createMockOutput({
          id: 1,
          outputType: 'segment',
          started: startTime,
          ended: startTime + 1200000,
          metrics: [{ type: MetricType.Duration, value: '20:00 AMRAP', image: '20:00 AMRAP' }],
          hints: ['amrap', 'time_bound']
        });

        const segments = transformer.fromOutputStatements([output]);

        expect(segments).toHaveLength(1);
        expect(segments[0].name).toBe('20:00 AMRAP');
        expect(segments[0].tags).toContain('amrap');
        expect(segments[0].tags).toContain('time_bound');
      });

      it('should transfer spans and absoluteStartTime from output to segment', () => {
        const workoutStart = 1000000;
        const spanStart = 1002000; // 2s after workout start
        const spanEnd = 1005000;   // 5s after workout start
        const output = createMockOutput({
          started: spanStart,
          ended: spanEnd,
          sourceBlockKey: 'timed-block',
          metrics: [
            { type: MetricType.Effort, value: 'Run', image: 'Run' },
            { type: MetricType.Spans, value: [new TimeSpan(spanStart, spanEnd)], origin: 'runtime' },
            { type: MetricType.Elapsed, value: spanEnd - spanStart, origin: 'runtime' },
          ],
        });

        const segments = transformer.fromOutputStatements([output], workoutStart);

        expect(segments).toHaveLength(1);
        const seg = segments[0];

        // absoluteStartTime should be preserved in ms
        expect(seg.absoluteStartTime).toBe(spanStart);

        // spans should be in seconds relative to workout start
        expect(seg.spans).toBeDefined();
        expect(seg.spans!.length).toBe(1);
        expect(seg.spans![0].started).toBe((spanStart - workoutStart) / 1000); // 2s
        expect(seg.spans![0].ended).toBe((spanEnd - workoutStart) / 1000);     // 5s

        // Elapsed should reflect pause-aware active time (3s)
        expect(seg.elapsed).toBe(3);
      });

      it('should include sourceBlockKey and completionReason in context', () => {
        const startTime = Date.now();
        const output = createMockOutput({
          started: startTime,
          ended: startTime + 10000,
          sourceBlockKey: 'my-block-uuid',
          metrics: [],
          completionReason: 'timer-expired',
        });

        const segments = transformer.fromOutputStatements([output]);

        expect(segments).toHaveLength(1);
        const ctx = (segments[0] as SegmentWithMetadata).context;
        expect(ctx?.sourceBlockKey).toBe('my-block-uuid');
        expect(ctx?.completionReason).toBe('timer-expired');
      });

      it('should handle missing metrics images by defaulting to sourceBlockKey', () => {
        const startTime = Date.now();
        const output = createMockOutput({
          started: startTime,
          ended: startTime + 1000,
          sourceBlockKey: 'test-block',
          metrics: []
        });

        const segments = transformer.fromOutputStatements([output]);
        expect(segments[0].name).toBe('test-block');
        expect(segments[0].duration).toBeUndefined();
      });
    });

    describe('toAnalyticsGroup', () => {
      it('creates performance group from metrics', () => {
        const segments: SegmentWithMetadata[] = [
          {
            id: 1,
            name: 'Test',
            type: 'effort',
            startTime: 0,
            endTime: 60,
            duration: 60,
            elapsed: 60,
            total: 60,
            parentId: null,
            depth: 0,
            metric: { reps: 10, resistance: 50 },
            lane: 0
          }
        ];

        const groups = transformer.toAnalyticsGroup(segments);

        expect(groups).toHaveLength(1);
        expect(groups[0].id).toBe('performance');
        expect(groups[0].graphs.some(g => g.id === 'reps')).toBe(true);
        expect(groups[0].graphs.some(g => g.id === 'resistance')).toBe(true);
      });
    });

    describe('filterByTags', () => {
      it('returns all segments when no tags provided', () => {
        const segments: SegmentWithMetadata[] = [
          { id: 1, name: 'A', type: 'a', startTime: 0, endTime: 1, duration: 1, elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0, tags: ['amrap'] },
          { id: 2, name: 'B', type: 'b', startTime: 0, endTime: 1, duration: 1, elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0, tags: ['emom'] }
        ];

        const filtered = transformer.filterByTags(segments, []);
        expect(filtered).toHaveLength(2);
      });

      it('filters segments by single tag', () => {
        const segments: SegmentWithMetadata[] = [
          { id: 1, name: 'AMRAP', type: 'amrap', startTime: 0, endTime: 1, duration: 1, elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0, tags: ['amrap', 'time_bound'] },
          { id: 2, name: 'EMOM', type: 'emom', startTime: 0, endTime: 1, duration: 1, elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0, tags: ['emom', 'interval'] }
        ];

        const filtered = transformer.filterByTags(segments, ['amrap']);
        expect(filtered).toHaveLength(1);
        expect(filtered[0].name).toBe('AMRAP');
      });
    });

    describe('filterByType', () => {
      it('filters segments by span type', () => {
        const segments: SegmentWithMetadata[] = [
          { id: 1, name: 'AMRAP', type: 'amrap', startTime: 0, endTime: 1, duration: 1, elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0, spanType: 'amrap' },
          { id: 2, name: 'EMOM', type: 'emom', startTime: 0, endTime: 1, duration: 1, elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0, spanType: 'emom' }
        ];

        const amrapSegments = transformer.filterByType(segments, 'amrap');
        expect(amrapSegments).toHaveLength(1);
        expect(amrapSegments[0].name).toBe('AMRAP');
      });
    });

    describe('isFromStrategy', () => {
      it('returns true when segment matches strategy', () => {
        const segment: SegmentWithMetadata = {
          id: 1, name: 'Test', type: 'test', startTime: 0, endTime: 1, duration: 1,
          elapsed: 1, total: 1, parentId: null, depth: 0, metric: {}, lane: 0,
          context: { strategyUsed: 'TimeBoundRoundsStrategy' }
        };

        expect(transformer.isFromStrategy(segment, 'TimeBoundRoundsStrategy')).toBe(true);
        expect(transformer.isFromStrategy(segment, 'IntervalLogicStrategy')).toBe(false);
      });
    });

    describe('getAnalyticsFromLogs', () => {
      it('drops duplicate analytics outputs with identical label/value/unit/timeSpan but keeps legitimate progressions', () => {
        const startTime = Date.now();
        const outputs: StoredOutputStatement[] = [
          createMockOutput<StoredOutputStatement>({
            id: 1,
            outputType: 'segment',
            started: startTime,
            ended: startTime + 60000,
            metrics: [{ type: MetricType.Effort, value: 'Work', image: 'Work' }],
          }),
          // Live + finalize pair from the legacy write path: identical values,
          // timestamps a few hundred ms apart inside the same second.
          createMockOutput<StoredOutputStatement>({
            id: 2,
            outputType: 'analytics',
            started: startTime + 60000,
            ended: startTime + 60000,
            metrics: [
              { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
              { type: MetricType.Rep, value: 42, unit: 'reps', image: '42 reps' },
            ],
          }),
          createMockOutput<StoredOutputStatement>({
            id: 3,
            outputType: 'analytics',
            started: startTime + 60300,
            ended: startTime + 60300,
            metrics: [
              { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
              { type: MetricType.Rep, value: 42, unit: 'reps', image: '42 reps' },
            ],
          }),
          // Legitimate progression: same label, new value, seconds later.
          createMockOutput<StoredOutputStatement>({
            id: 4,
            outputType: 'analytics',
            started: startTime + 90000,
            ended: startTime + 90000,
            metrics: [
              { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
              { type: MetricType.Rep, value: 43, unit: 'reps', image: '43 reps' },
            ],
          }),
          // Legitimate repeat: same value as id 2/3 but seconds apart (per-round row).
          createMockOutput<StoredOutputStatement>({
            id: 5,
            outputType: 'analytics',
            started: startTime + 120000,
            ended: startTime + 120000,
            metrics: [
              { type: MetricType.Label, value: 'Total Reps', image: 'Total Reps' },
              { type: MetricType.Rep, value: 42, unit: 'reps', image: '42 reps' },
            ],
          }),
        ];

        const result = getAnalyticsFromLogs(outputs);

        expect(result.segments).toHaveLength(4);
        const analyticsSegments = result.segments.filter(s => s.context?.outputType === 'analytics');
        expect(analyticsSegments).toHaveLength(3);
        expect(analyticsSegments.filter(s => s.metric.reps === 42)).toHaveLength(2);
        expect(analyticsSegments.some(s => s.metric.reps === 43)).toBe(true);
      });
    });
  });
});
