import { describe, it, expect, afterEach } from 'vitest';
import { ScriptRuntime } from '../../src/runtime/ScriptRuntime';
import { RuntimeStack } from '../../src/runtime/RuntimeStack';
import { EventBus } from '../../src/runtime/events/EventBus';
import { createMockClock, type MockClock } from '../../src/runtime/RuntimeClock';
import { createParser } from '../../src/parser/parserInstance';
import { createCompiler } from '../../src/runtime/services/runtimeServices';
import { StartSessionAction } from '../../src/runtime/actions/stack/StartSessionAction';
import { NextEvent } from '../../src/runtime/events/NextEvent';
import { TickEvent } from '../../src/runtime/events/TickEvent';
import { RestBlock } from '../../src/runtime/blocks/RestBlock';
import type { WhiteboardScript } from '../../src/parser/WhiteboardScript';

/**
 * Finding 7 — *:30 Rest reaches 00:00 but the session stays on rest, and Next
 * still reports "Timer can't be skipped" after overrun (partial-result exit).
 *
 * Existing rest coverage drives expiry with one coarse `tick` that jumps the
 * clock straight to (or past) the boundary. The deployed app streams ~20ms
 * TickEvents and expects:
 *   1. automatic advancement on the tick that lands EXACTLY at zero,
 *   2. automatic advancement when ticks overrun the duration,
 *   3. no `timer:skip-attempt` once the timer has expired (Next must work),
 *   4. a full two-round fixture with forced rest inside the loop.
 *
 * This file pins that contract at the runtime seam with a controlled clock,
 * using the same event classes the app dispatches (TickEvent / NextEvent).
 */

const BOUNDARY_MS = 30_000;

interface Fixture {
    runtime: ScriptRuntime;
    clock: MockClock;
    script: WhiteboardScript;
    skipAttempts: number[];
}

function createFixture(scriptText: string): Fixture {
    const script = createParser().read(scriptText) as WhiteboardScript;
    const clock = createMockClock(new Date('2024-01-01T12:00:00Z'));
    const runtime = new ScriptRuntime(
        script,
        createCompiler(),
        { stack: new RuntimeStack(), clock, eventBus: new EventBus() },
        {},
        // Mirror the app: events carry timestamps from the runtime's nowProvider.
        { now: () => new Date(clock.currentDate.getTime()), nowMs: () => clock.currentDate.getTime() },
    );

    const skipAttempts: number[] = [];
    runtime.eventBus.on('timer:skip-attempt', () => { skipAttempts.push(1); }, 'test-recorder');

    return { runtime, clock, script, skipAttempts };
}

/** Stream ticks like useRuntimeExecution: advance the clock, dispatch a TickEvent. */
function pump(fixture: Fixture, totalMs: number, stepMs: number): void {
    let remaining = totalMs;
    while (remaining > 0) {
        const step = Math.min(stepMs, remaining);
        fixture.clock.advance(step);
        fixture.runtime.handle(new TickEvent(undefined, fixture.runtime.nowProvider));
        remaining -= step;
    }
}

/** User Next, the way every surface host dispatches it. */
function userNext(fixture: Fixture): void {
    fixture.runtime.handle(new NextEvent(undefined, fixture.runtime.nowProvider));
}

/** Start a compiled session and leave WaitingToStart (first user Next). */
function startSession(fixture: Fixture): void {
    fixture.runtime.do(new StartSessionAction());
    userNext(fixture);
}

describe('Finding 7 — rest reaches 00:00 (controlled clock, streamed ticks)', () => {
    let fixtures: Fixture[] = [];

    afterEach(() => {
        for (const f of fixtures) f.runtime.dispose();
        fixtures = [];
    });

    function track(fixture: Fixture): Fixture {
        fixtures.push(fixture);
        return fixture;
    }

    it('RestBlock auto-pops on the tick that lands exactly at zero', () => {
        const f = track(createFixture(''));
        const rest = new RestBlock(f.runtime, { durationMs: BOUNDARY_MS });
        f.runtime.pushBlock(rest);
        expect(f.runtime.stack.count).toBe(1);

        pump(f, BOUNDARY_MS - 100, 100);
        expect(f.runtime.stack.count).toBe(1);
        expect(rest.isComplete).toBe(false);

        pump(f, 100, 100); // elapsed === durationMs exactly
        expect(rest.isComplete).toBe(true);
        expect(f.runtime.stack.count).toBe(0);
        expect(rest.completionReason).not.toBe('user-advance');
        expect(f.skipAttempts).toHaveLength(0);
    });

    it('RestBlock is gone after overrun without any user next', () => {
        const f = track(createFixture(''));
        const rest = new RestBlock(f.runtime, { durationMs: BOUNDARY_MS });
        f.runtime.pushBlock(rest);

        pump(f, 45_000, 1_000); // 15s overrun, coarse stream
        expect(rest.isComplete).toBe(true);
        expect(f.runtime.stack.count).toBe(0);

        pump(f, 5_000, 1_000); // ticks after the pop are inert, not fatal
        expect(f.runtime.stack.count).toBe(0);
        expect(f.skipAttempts).toHaveLength(0);
    });

    it('compiled *:30 Rest still suppresses Next before zero (one skip-attempt)', () => {
        const f = track(createFixture('*:30 Rest'));
        startSession(f);
        const currentKey = f.runtime.stack.current?.key.toString();
        expect(f.runtime.stack.current?.blockType).toMatch(/rest|timer/i);

        pump(f, 10_000, 1_000);
        userNext(f); // skip attempt on a required, unexpired timer

        expect(f.runtime.stack.current?.key.toString()).toBe(currentKey);
        expect(f.skipAttempts).toHaveLength(1);
    });

    it('compiled *:30 Rest drains at zero and stays silent through overrun', () => {
        const f = track(createFixture('*:30 Rest'));
        startSession(f);
        expect(f.runtime.stack.current?.blockType).toMatch(/rest|timer/i);

        pump(f, BOUNDARY_MS, 100); // exact boundary via streamed ticks
        expect(f.runtime.stack.count).toBe(0);

        pump(f, 5_000, 1_000); // overrun after drain: session stays drained
        expect(f.runtime.stack.count).toBe(0);
        expect(f.skipAttempts).toHaveLength(0);
    });

    it('two rounds with *:30 rest inside the loop complete by clock alone', () => {
        const f = track(createFixture('(2)\n  10 Pullups\n  *:30 Rest'));
        startSession(f);
        expect(f.runtime.stack.current?.blockType).toMatch(/effort/i); // R1 Pullups

        userNext(f); // Pullups R1 → rest R1 auto-pushed
        expect(f.runtime.stack.current?.blockType).toMatch(/rest|timer/i);

        pump(f, BOUNDARY_MS, 100); // rest R1 expires at zero → round 2
        expect(f.runtime.stack.current?.blockType).toMatch(/effort/i); // R2 Pullups

        userNext(f); // Pullups R2 → rest R2 auto-pushed
        expect(f.runtime.stack.current?.blockType).toMatch(/rest|timer/i);

        pump(f, BOUNDARY_MS, 100); // rest R2 expires → loop exhausted → session ends
        expect(f.runtime.stack.count).toBe(0);
        expect(f.skipAttempts).toHaveLength(0); // never "Timer can't be skipped"
    });

    it('Next uses the live nowProvider when the execution snapshot clock is stale', () => {
        const script = createParser().read('*:30 Rest') as WhiteboardScript;
        const start = Date.parse('2024-01-01T12:00:00Z');
        const snapshotClock = createMockClock(new Date(start));
        let liveNow = start;
        const runtime = new ScriptRuntime(
            script,
            createCompiler(),
            { stack: new RuntimeStack(), clock: snapshotClock, eventBus: new EventBus() },
            {},
            { now: () => new Date(liveNow), nowMs: () => liveNow },
        );
        const skipAttempts: number[] = [];
        runtime.eventBus.on('timer:skip-attempt', () => { skipAttempts.push(1); }, 'test-recorder');
        try {
            runtime.do(new StartSessionAction());
            runtime.handle(new NextEvent(undefined, runtime.nowProvider));
            liveNow += BOUNDARY_MS + 5_000;
            // No TickEvent: RuntimeClock.currentDate remains at mount time.
            runtime.handle(new NextEvent(undefined, runtime.nowProvider));
            expect(runtime.stack.count).toBe(0);
            expect(skipAttempts).toHaveLength(0);
        } finally {
            runtime.dispose();
        }
    });
});
