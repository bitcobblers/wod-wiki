import { describe, it, expect, afterEach } from 'vitest';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createMockClock } from '../../src/runtime/RuntimeClock';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { StartSessionAction } from '../../src/runtime/actions/stack/StartSessionAction';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import { RestBlock } from '../../src/runtime/blocks/RestBlock';
import type { TimerState } from '../../src/runtime/memory/MemoryTypes';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

describe('TimerState polarity and required skip-lock at runtime seam', () => {
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
    const skipAttempts: string[] = [];
    runtime.eventBus.on(
      'timer:skip-attempt',
      (ev) => {
        const key = (ev.data as { blockKey?: string } | undefined)?.blockKey ?? 'unknown';
        skipAttempts.push(key);
      },
      'test-skip-listener',
    );
    return { runtime, clock, skipAttempts };
  }

  function startAndStepIntoFirstBlock(runtime: ScriptRuntime) {
    runtime.do(new StartSessionAction());
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
  }

  function readTopTimerState(runtime: ScriptRuntime): TimerState | undefined {
    const top = runtime.stack.current;
    return top?.getMemoryByTag('time')[0]?.metrics[0]?.value as TimerState | undefined;
  }

  it('marks authored *:30 Rest with polarity="rest" and required=true in TimerState', () => {
    const { runtime } = boot('*:30 Rest');
    startAndStepIntoFirstBlock(runtime);

    const timer = readTopTimerState(runtime);
    expect(timer).toBeDefined();
    expect(timer?.direction).toBe('down');
    expect(timer?.durationMs).toBe(30_000);
    expect(timer?.polarity).toBe('rest');
    expect(timer?.required).toBe(true);
  });

  it('marks optional 1:00 Rest with polarity="rest" and required=false while keeping blockType="Timer"', () => {
    const { runtime } = boot('1:00 Rest');
    startAndStepIntoFirstBlock(runtime);

    expect(runtime.stack.current?.blockType).toBe('Timer');
    const timer = readTopTimerState(runtime);
    expect(timer?.polarity).toBe('rest');
    expect(timer?.required).toBe(false);
  });

  it('marks timed movement 5:00 Run 400m with polarity="work" and required=false', () => {
    const { runtime } = boot('5:00 Run 400m');
    startAndStepIntoFirstBlock(runtime);

    const timer = readTopTimerState(runtime);
    expect(timer?.polarity).toBe('work');
    expect(timer?.required).toBe(false);
  });

  it('marks RestBlock with polarity="rest" and required=true and emits timer:skip-attempt on early Next', () => {
    const { runtime, skipAttempts } = boot('');
    const rest = new RestBlock(runtime, { durationMs: 30_000 });
    runtime.pushBlock(rest);

    const timer = readTopTimerState(runtime);
    expect(timer?.polarity).toBe('rest');
    expect(timer?.required).toBe(true);

    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    expect(skipAttempts).toHaveLength(1);
    expect(runtime.stack.current?.blockType).toBe('Rest');
  });
});
