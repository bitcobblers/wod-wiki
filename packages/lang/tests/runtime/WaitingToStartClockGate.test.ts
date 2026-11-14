/**
 * WaitingToStart clock gate: while the idle gate is the leaf block, the hero
 * and session clocks must stay at 00:00 regardless of how long the athlete
 * waits, and the session elapsed clock must start from 0 at the gate pop —
 * not from session mount (so a 7s wait + 5s workout reads 00:05, not 00:12).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createMockClock } from '../../src/runtime/RuntimeClock';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { StartSessionAction } from '../../src/runtime/actions/stack/StartSessionAction';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';
import { projectSessionClock } from '../../src/runtime/projection/SessionClockProjection';

describe('WaitingToStart clock gate', () => {
  const disposables: ScriptRuntime[] = [];

  afterEach(() => {
    while (disposables.length > 0) {
      disposables.pop()?.dispose();
    }
  });

  /** Mounts the session and leaves the WaitingToStart gate as the leaf. */
  function bootAtGate(scriptText: string) {
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
    return { runtime, clock };
  }

  it('holds hero and session clocks at 00:00 while WaitingToStart is the leaf block', () => {
    const { runtime, clock } = bootAtGate('10 Kettlebell Swings 24kg\n12 Pullups');
    expect(runtime.stack.blocks[0]?.blockType).toBe('WaitingToStart');

    clock.advance(7_000);
    const frame = projectSessionClock(runtime, {
      nowMs: clock.currentDate.getTime(),
      executionStatus: 'running',
    });

    expect(frame.displayMs).toBe(0);
    expect(frame.activeSpans).toEqual([]);
    expect(frame.sessionElapsedMs).toBe(0);
    expect(frame.sessionSpans).toEqual([]);
    expect(frame.isRunning).toBe(false);
  });

  it('starts session elapsed from 00:00 at the gate pop after an idle wait', () => {
    const { runtime, clock } = bootAtGate('10 Kettlebell Swings 24kg\n12 Pullups');

    // Athlete waits 7s at the gate, then presses Next.
    clock.advance(7_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    expect(runtime.stack.blocks[0]?.blockType).not.toBe('WaitingToStart');

    clock.advance(5_000);
    const frame = projectSessionClock(runtime, { nowMs: clock.currentDate.getTime() });

    // 7s of idle gate wait must not leak into the session clock: 5s, not 12s.
    expect(frame.sessionElapsedMs).toBe(5_000);
    expect(frame.displayMs).toBe(5_000);
  });

  it('behaves identically when Next is pressed immediately with no clock advance', () => {
    const { runtime, clock } = bootAtGate('10 Kettlebell Swings 24kg\n12 Pullups');

    runtime.handle(new NextEvent(undefined, runtime.nowProvider));
    clock.advance(5_000);
    const frame = projectSessionClock(runtime, { nowMs: clock.currentDate.getTime() });

    expect(frame.sessionElapsedMs).toBe(5_000);
    expect(frame.displayMs).toBe(5_000);
  });
});
