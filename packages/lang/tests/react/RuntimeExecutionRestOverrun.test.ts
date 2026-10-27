// @vitest-environment happy-dom
/**
 * Finding 7 — the app-side seam the runtime tests cannot see: the tick pump
 * vs the live display.
 *
 * `useRuntimeExecution` expires timers ONLY while its 20ms TickEvent interval
 * runs. The timer surfaces (`useTimerSurfaceModel` → TimerHero) count down
 * from the block's open timer spans via requestAnimationFrame — independent of
 * the pump. When the pump is idle or stopped while a span is open, the display
 * reaches 00:00 but no tick ever fires expiry: the rest block stays
 * `required && !isComplete`, so Next emits `timer:skip-attempt`
 * ("Timer can't be skipped!") and the user is forced into a partial-result
 * exit. That is exactly the dogfooded Finding 7 symptom.
 *
 * Consumer-visible contract pinned here (RED today, green after the fix):
 * a `*:30 Rest` whose spans show a full duration of elapsed wall time must be
 * drainable by Next — with zero skip-attempts — regardless of pump state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useRuntimeExecution } from '../../src/react/hooks/useRuntimeExecution';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createMockClock, type MockClock } from '../../src/runtime/RuntimeClock';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { StartSessionAction } from '../../src/runtime/actions/stack/StartSessionAction';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

const BOUNDARY_MS = 30_000;

interface Fixture {
    runtime: ScriptRuntime;
    clock: MockClock;
    script: WhiteboardScript;
    skipAttempts: number[];
}

function createFixture(): Fixture {
    const script = createParser().read('*:30 Rest') as WhiteboardScript;
    const clock = createMockClock(new Date('2024-01-01T12:00:00Z'));
    const runtime = new ScriptRuntime(
        script,
        createCompiler(),
        { stack: new RuntimeStack(), clock, eventBus: new EventBus() },
        {},
        { now: () => new Date(clock.currentDate.getTime()), nowMs: () => clock.currentDate.getTime() },
    );
    runtime.do(new StartSessionAction());
    runtime.handle(new NextEvent(undefined, runtime.nowProvider)); // leave WaitingToStart → *:30 Rest

    const skipAttempts: number[] = [];
    runtime.eventBus.on('timer:skip-attempt', () => { skipAttempts.push(1); }, 'test-recorder');
    return { runtime, clock, script, skipAttempts };
}

/** One pump beat: wall time passes, then the 20ms interval fires a single tick. */
function beat(f: Fixture, wallMs: number, timerMs = 20): void {
    act(() => {
        f.clock.advance(wallMs);
        vi.advanceTimersByTime(timerMs);
    });
}

function userNext(f: Fixture): void {
    act(() => { f.runtime.handle(new NextEvent(undefined, f.runtime.nowProvider)); });
}

describe('Finding 7 — tick pump vs live display (rest overrun)', () => {
    let fixtures: Fixture[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        for (const f of fixtures) f.runtime.dispose();
        fixtures = [];
    });

    function track(f: Fixture): Fixture {
        fixtures.push(f);
        return f;
    }

    it('control: a running pump expires *:30 Rest and reports completed', () => {
        const f = track(createFixture());
        const { result } = renderHook(() => useRuntimeExecution(f.runtime));

        act(() => { result.current.start(); });
        expect(result.current.status).toBe('running');

        beat(f, BOUNDARY_MS); // wall time passes, one 20ms tick fires expiry
        expect(f.runtime.stack.count).toBe(0);
        expect(f.skipAttempts).toHaveLength(0);
        expect(result.current.status).toBe('completed');
    });

    it('idle pump + 30s of wall time leaves Next working at zero (no skip-attempt)', () => {
        const f = track(createFixture());
        const { result } = renderHook(() => useRuntimeExecution(f.runtime));

        // The display half: spans stay open while the pump is idle, so the hero
        // clock reaches 00:00 from wall time alone — yet no tick ever fired.
        act(() => { f.clock.advance(BOUNDARY_MS); });
        expect(result.current.status).not.toBe('running');
        expect(f.runtime.stack.count).toBe(2); // SessionRoot + rest, still on rest…

        // …so the user presses Next at zero. Contract: it drains, no flash.
        userNext(f);
        expect(f.skipAttempts).toHaveLength(0);          // "Timer can't be skipped!" must NOT fire
        expect(f.runtime.stack.count).toBe(0);           // session must drain
    });

    it('stop() leaves spans open — Next at zero still drains (no skip-attempt)', () => {
        const f = track(createFixture());
        const { result } = renderHook(() => useRuntimeExecution(f.runtime));

        act(() => { result.current.start(); });
        act(() => { result.current.stop(); }); // clears the interval, closes nothing
        expect(result.current.status).toBe('idle');

        act(() => { f.clock.advance(BOUNDARY_MS); }); // display reaches 00:00
        userNext(f);
        expect(f.skipAttempts).toHaveLength(0);
        expect(f.runtime.stack.count).toBe(0);
    });
});
