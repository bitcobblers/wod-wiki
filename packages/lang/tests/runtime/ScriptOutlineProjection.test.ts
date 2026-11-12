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
import {
  projectScriptOutline,
  synthesizeWorkoutFormat,
} from '../../src/runtime/projection/ScriptOutlineProjection';

describe('ScriptOutlineProjection alongside lazy JIT compilation', () => {
  const disposables: ScriptRuntime[] = [];

  afterEach(() => {
    while (disposables.length > 0) {
      disposables.pop()?.dispose();
    }
  });

  function boot(scriptText: string) {
    const script = createParser().read(scriptText) as WhiteboardScript;
    const clock = createMockClock(new Date('2026-03-01T10:00:00Z'));
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
    return { runtime, clock, script };
  }

  it('projects authored statement tree with completed, active, and upcoming statuses without pre-compiling AMRAP loops', () => {
    const { runtime, clock, script } = boot(
      '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats',
    );

    expect(synthesizeWorkoutFormat(script)).toBe('20:00 AMRAP');

    // Step 1: 5 Pullups active, Pushups & Air Squats upcoming
    const first = projectScriptOutline(runtime);
    expect(first).toHaveLength(4);
    expect(first[0]?.status).toBe('active');
    expect(first[1]?.label).toContain('5');
    expect(first[1]?.status).toBe('active');
    expect(first[2]?.status).toBe('upcoming');
    expect(first[3]?.status).toBe('upcoming');

    // Advance past 5 Pullups into 10 Pushups
    clock.advance(12_000);
    runtime.handle(new NextEvent(undefined, runtime.nowProvider));

    const second = projectScriptOutline(runtime);
    expect(second[1]?.status).toBe('completed');
    expect(second[2]?.status).toBe('active');
    expect(second[3]?.status).toBe('upcoming');
  });

  it('WW-007: renders "15 Kettlebell Swings (24kg)" as a single outline line matching unparenthesized load', () => {
    const withParens = boot('15 Kettlebell Swings (24kg)');
    const withoutParens = boot('15 Kettlebell Swings 24kg');

    const parensNodes = projectScriptOutline(withParens.runtime);
    const plainNodes = projectScriptOutline(withoutParens.runtime);

    expect(parensNodes).toHaveLength(1);
    expect(parensNodes[0]?.depth).toBe(0);
    expect(parensNodes[0]?.label).toBe(plainNodes[0]?.label);
    expect(parensNodes[0]?.label).not.toContain('Rounds');
  });
});
