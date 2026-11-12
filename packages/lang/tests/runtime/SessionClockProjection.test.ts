import { describe, it, expect, afterEach } from 'vitest';
import { MemoryLocation } from '../../src/runtime/memory/MemoryLocation';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createMockClock } from '../../src/runtime/RuntimeClock';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { StartSessionAction } from '../../src/runtime/actions/stack/StartSessionAction';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';
import {
  projectSessionClock,
  interpolateSessionClockFrame,
} from '../../src/runtime/projection/SessionClockProjection';

describe('SessionClockProjection at runtime seam', () => {
  const disposables: ScriptRuntime[] = [];

  afterEach(() => {
    while (disposables.length > 0) {
      disposables.pop()?.dispose();
    }
  });

  function boot(scriptText: string) {
    const script = createParser().read(scriptText) as WhiteboardScript;
    const clock = createMockClock(new Date('2026-01-01T12:00:00Z'));
    const runtime = new ScriptRuntime(
      script,
      createCompiler(),
      { stack: new RuntimeStack(), clock, eventBus: new EventBus() },
      {},
      { now: () => new Date(clock.currentDate.getTime()), nowMs: () => clock.currentDate.getTime() },
    );
    disposables.push(runtime);
    runtime.do(new StartSessionAction());
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    return { runtime, clock };
  }

  it('deduplicates active leaf and session clocks from secondaryTimers and projects round + lookahead + rep targets', () => {
    const { runtime, clock } = boot('(3 Rounds)\n  10 Kettlebell Swings 24kg\n  12 Pullups');
    clock.advance(15_000);

    const frame = projectSessionClock(runtime, {
      nowMs: clock.currentDate.getTime(),
      executionStatus: 'running',
    });

    expect(frame.mainLabel).toBe('Round 1 of 3');
    expect(frame.subLabels?.[0]).toContain('10');
    expect(frame.displayMs).toBe(15_000);
    expect(frame.sessionElapsedMs).toBe(15_000);
    expect(frame.roundCurrent).toBe(1);
    expect(frame.roundTotal).toBe(3);
    expect(frame.secondaryTimers).toEqual([]);
    expect(frame.upNext).toContain('12');
    expect(frame.polarity).toBe('work');
    expect(frame.isRequiredLockActive).toBe(false);
    expect(frame.repTargets).toHaveLength(1);
    expect(frame.repTargets[0]?.target).toBe(10);
    expect(frame.repTargets[0]?.actual).toBeNull();

    // Commit user-origin actual reps onto leaf block memory and re-project
    const leaf = runtime.stack.current!;
    leaf.pushMemory(
      new MemoryLocation('metric:result', [
        {
          type: MetricType.Rep,
          value: 8,
          origin: 'user',
          image: '8',
          sourceBlockKey: leaf.key.toString(),
          timestamp: clock.currentDate,
        },
      ]),
    );

    const updated = projectSessionClock(runtime, {
      nowMs: clock.currentDate.getTime(),
      executionStatus: 'running',
    });
    expect(updated.repTargets[0]?.actual).toBe(8);
  });

  it('projects rest, final5, overrun, and paused polarities plus proactive required-timer lock', () => {
    const { runtime, clock } = boot('20:00 AMRAP\n  10 Burpees\n  *:30 Rest');
    // Advance from 10 Burpees into *:30 Rest
    clock.advance(20_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    // 8s into *:30 Rest -> 22s remaining ('rest', required lock active, Next still clickable to trigger flash)
    clock.advance(8_000);
    const restFrame = projectSessionClock(runtime, {
      nowMs: clock.currentDate.getTime(),
      executionStatus: 'running',
    });
    expect(restFrame.displayMs).toBe(22_000);
    expect(restFrame.sessionElapsedMs).toBe(28_000);
    expect(restFrame.polarity).toBe('rest');
    expect(restFrame.isRequiredLockActive).toBe(true);
    expect(restFrame.isNextDisabled).toBe(false);

    // Pure span interpolation (used on stateless Cast receiver) transitions to final5 and overrun without runtime
    const baseMs = clock.currentDate.getTime();
    const final4Frame = interpolateSessionClockFrame(restFrame, baseMs + 18_000);
    expect(final4Frame.displayMs).toBe(4_000);
    expect(final4Frame.polarity).toBe('final5');
    expect(final4Frame.isRequiredLockActive).toBe(true);

    const zeroFrame = interpolateSessionClockFrame(restFrame, baseMs + 22_000);
    expect(zeroFrame.displayMs).toBe(0);
    expect(zeroFrame.polarity).toBe('overrun');
    expect(zeroFrame.isRequiredLockActive).toBe(false);

    // Paused overrides polarity and disables Next
    const pausedFrame = projectSessionClock(runtime, {
      nowMs: clock.currentDate.getTime(),
      executionStatus: 'paused',
    });
    expect(pausedFrame.polarity).toBe('paused');
    expect(pausedFrame.isPaused).toBe(true);
    expect(pausedFrame.isNextDisabled).toBe(true);
  });
});
