import { describe, expect, it } from 'vitest';
import { MetricContainer, MetricType, type ScriptBlock } from '@bitcobblers/wod-wiki-core';
import { MdTimerRuntime } from '../../src/parser/md-timer';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { RuntimeFactory } from '../../src/runtime/compiler/RuntimeFactory';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import { OutputEmitter } from '../../src/runtime/OutputEmitter';
import { TimeSpan } from '../../src/runtime/models/TimeSpan';
import { SpansMetric } from '../../src/runtime/compiler/metrics/SpansMetric';
import type { IRuntimeBlock } from '../../src/runtime/contracts/IRuntimeBlock';
import type { IRuntimeClock } from '../../src/runtime/contracts/IRuntimeClock';
import type { IRuntimeStack } from '../../src/runtime/contracts/IRuntimeStack';
import type { INowProvider } from '../../src/runtime/INowProvider';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

function createSteppedNowProvider(initialMs: number): {
  nowProvider: INowProvider;
  advanceBy: (ms: number) => void;
} {
  let currentMs = initialMs;
  return {
    nowProvider: {
      now: () => new Date(currentMs),
      nowMs: () => currentMs,
    },
    advanceBy: (ms: number) => {
      currentMs += ms;
    },
  };
}

describe('WW-051: split TimeSpans & OutputEmitter span preservation', () => {
  it('persists non-zero, monotonically increasing timeSpans for movement splits and excludes gate wait from SessionRoot', () => {
    const t0 = 1_700_000_000_000;
    const { nowProvider, advanceBy } = createSteppedNowProvider(t0);
    const content = '(2)\n  5 Burpees\n  10 Squats';
    const parsed = new MdTimerRuntime().read(content);
    const factory = new RuntimeFactory(createCompiler(), nowProvider);
    const blockInput: ScriptBlock = {
      id: 'ww051-splits',
      content,
      statements: parsed.statements,
      startLine: 0,
      endLine: 3,
      state: 'idle',
      version: 1,
      createdAt: t0,
    };
    const runtime = factory.createRuntime(blockInput);
    if (!runtime) throw new Error('Expected runtime');

    try {
      // Idle on WaitingToStart gate for 5,000 ms before athlete presses Start
      advanceBy(5_000);
      const gatePoppedAt = nowProvider.nowMs();
      runtime.handle(new NextEvent(undefined, nowProvider)); // pops WaitingToStart -> R1 5 Burpees

      // Movement 1 takes 3,000 ms
      advanceBy(3_000);
      runtime.handle(new NextEvent(undefined, nowProvider)); // pops 5 Burpees -> 10 Squats

      // Movement 2 takes 4,000 ms
      advanceBy(4_000);
      runtime.handle(new NextEvent(undefined, nowProvider)); // pops 10 Squats -> R2 5 Burpees

      // Complete Round 2 movements
      advanceBy(2_000);
      runtime.handle(new NextEvent(undefined, nowProvider));
      advanceBy(2_000);
      runtime.handle(new NextEvent(undefined, nowProvider));

      const outputs = runtime.getOutputStatements();
      const nonStructuralSegments = outputs.filter((o) => {
        if (o.outputType !== 'segment') return false;
        const key = (o.sourceBlockKey ?? '').toLowerCase();
        return !key.startsWith('waiting-to-start') && !key.startsWith('session-root');
      });

      const effortSplits = nonStructuralSegments.filter((o) =>
        o.metrics.toArray().some((m) => m.type === MetricType.Effort || m.type === MetricType.Rep),
      );
      expect(effortSplits.length).toBeGreaterThanOrEqual(2);

      for (const seg of effortSplits) {
        expect(seg.timeSpan.started).toBeDefined();
        expect(seg.timeSpan.ended).toBeDefined();
        expect(seg.timeSpan.ended!).toBeGreaterThan(seg.timeSpan.started);
        const spansMetric = seg.metrics.toArray().find((m) => m.type === MetricType.Spans);
        if (spansMetric && Array.isArray(spansMetric.value)) {
          for (const rawSpan of spansMetric.value as Array<{ started: number; ended?: number }>) {
            expect(rawSpan.ended).toBeDefined();
            expect(rawSpan.ended!).toBeGreaterThanOrEqual(rawSpan.started);
          }
        }
      }

      for (let i = 1; i < effortSplits.length; i++) {
        expect(effortSplits[i]!.timeSpan.started).toBeGreaterThan(effortSplits[i - 1]!.timeSpan.started);
      }

      const sessionRootSegment = outputs.find(
        (o) =>
          o.outputType === 'segment' &&
          (o.sourceBlockKey ?? '').toLowerCase().startsWith('session-root') &&
          (o.timeSpan.ended ?? o.timeSpan.started) > o.timeSpan.started,
      );
      if (sessionRootSegment) {
        expect(sessionRootSegment.timeSpan.started).toBeGreaterThanOrEqual(gatePoppedAt);
      }
    } finally {
      runtime.dispose();
    }
  });

  it('preserves distinct MetricType.Spans per result group in OutputEmitter.emitSegmentFromResultMemory', () => {
    const emitter = new OutputEmitter();
    const now = new Date(7_000);
    const clock = {
      now,
      currentDate: now,
      elapsed: 0,
      isRunning: false,
      spans: [],
      start: () => now,
      stop: () => now,
    } as unknown as IRuntimeClock;

    const group1 = MetricContainer.empty('split-block').add(
      { type: MetricType.System, image: 'G1', value: 'g1', origin: 'runtime', timestamp: new Date(3_000) },
      new SpansMetric([new TimeSpan(1_000, 3_000)], 'split-block', new Date(3_000)),
    );
    const group2 = MetricContainer.empty('split-block').add(
      { type: MetricType.System, image: 'G2', value: 'g2', origin: 'runtime', timestamp: new Date(7_000) },
      new SpansMetric([new TimeSpan(3_000, 7_000)], 'split-block', new Date(7_000)),
    );

    const block = {
      key: { toString: () => 'split-block' },
      blockType: 'Loop',
      sourceIds: [1, 2],
      executionTiming: { startTime: new Date(500) },
      completionReason: 'normal',
      getMemoryByTag: (tag: string) =>
        tag === 'metric:result'
          ? [{ metrics: group1 }, { metrics: group2 }]
          : [],
    } as unknown as IRuntimeBlock;

    emitter.attach({
      clock,
      stack: { blocks: [] } as unknown as IRuntimeStack,
      script: { source: '', statements: [], getId: () => undefined } as unknown as WhiteboardScript,
    });
    emitter.emitSegmentFromResultMemory(block, 1);

    const emitted = emitter.getAll();
    expect(emitted).toHaveLength(2);
    expect(emitted[0]!.timeSpan.started).toBe(1_000);
    expect(emitted[0]!.timeSpan.ended).toBe(3_000);
    expect(emitted[1]!.timeSpan.started).toBe(3_000);
    expect(emitted[1]!.timeSpan.ended).toBe(7_000);
  });

  it('WW-105: ReportOutputBehavior records completed rounds honestly on user-abort or timer-expired', () => {
    const t0 = 1_700_000_000_000;
    const { nowProvider, advanceBy } = createSteppedNowProvider(t0);
    const content = '3 Rounds\n  10 Burpees';
    const parsed = new MdTimerRuntime().read(content);
    const factory = new RuntimeFactory(createCompiler(), nowProvider);
    const blockInput: ScriptBlock = {
      id: 'ww105-rounds',
      content,
      statements: parsed.statements,
      startLine: 0,
      endLine: 2,
      state: 'idle',
      version: 1,
      createdAt: t0,
    };
    const runtime = factory.createRuntime(blockInput);
    if (!runtime) throw new Error('Expected runtime');

    try {
      // Pop gate -> starts Round 1 of 3
      runtime.handle(new NextEvent(undefined, nowProvider));
      advanceBy(5_000);
      // Finish Round 1 -> starts Round 2 of 3
      runtime.handle(new NextEvent(undefined, nowProvider));
      advanceBy(3_000);
      // Abort while in Round 2 (only 1 round completed, not 3 and not 2)
      runtime.handle({ name: 'abort', timestamp: nowProvider.now(), data: {} });

      const outputs = runtime.getOutputStatements();
      const roundSegments = outputs.filter(
        (o) =>
          o.outputType === 'segment' &&
          o.metrics.toArray().some((m) => m.type === MetricType.CurrentRound),
      );
      // The enclosing Loop/Rounds block emits honest completedRounds (1 completed when aborted mid-Round 2).
      const roundsBlockSeg = roundSegments.find(
        (o) =>
          o.completionReason === 'user-abort' &&
          !o.metrics.toArray().some((m) => m.type === MetricType.Effort),
      );
      expect(roundsBlockSeg).toBeDefined();
      const roundMetric = roundsBlockSeg!.metrics
        .toArray()
        .find((m) => m.type === MetricType.CurrentRound);
      expect(roundMetric?.value).toBe(1);
    } finally {
      runtime.dispose();
    }
  });
});
