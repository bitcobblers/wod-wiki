/**
 * Finding 7 — *:30 Rest reaches 00:00 but the session remains on rest; Next
 * still reports "Timer can't be skipped" after overrun, forcing a
 * partial-result exit. Expected: automatic advancement (or a working Next) at
 * zero, and full two-set completion.
 *
 * Why this file exists: rest.compliance.test.ts drives expiry with ONE coarse
 * `script.tick(ms)` that jumps the clock straight to the boundary. The live app
 * instead streams repeated ticks (useRuntimeExecution's ~20ms TickEvent) and
 * must expire on the tick that lands exactly at zero, stay healthy when ticks
 * overrun, and never emit `timer:skip-attempt` once expired. No existing test
 * streams ticks across the boundary, presses Next after expiry, or runs the
 * forced-rest two-round fixture to full completion.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { TestScript, assertions } from '@/testing/script';
import { currentBlockType, getRoundState } from '../helpers/compliance-helpers';

const BOUNDARY_MS = 30_000;

/** Stream ticks across the boundary like the live pump, landing exactly on elapsedMs. */
async function pump(script: TestScript, totalMs: number, stepMs: number): Promise<void> {
    let remaining = totalMs;
    while (remaining > 0) {
        const step = Math.min(stepMs, remaining);
        await script.advance(step);
        script.runtime.handle({
            name: 'tick',
            timestamp: script.runtime.clock.currentDate,
            data: undefined,
        });
        remaining -= step;
    }
}

describe('Finding 7 — forced rest overrun (streamed ticks, controlled clock)', () => {
    let script: TestScript;

    afterEach(async () => {
        if (script) await script.dispose();
    });

    it('auto-completes *:30 Rest on the tick landing exactly at zero', async () => {
        script = await TestScript.compile('*:30 Rest');
        const skipAttempts: number[] = [];
        script.runtime.eventBus.on('timer:skip-attempt', () => skipAttempts.push(1), 'test-recorder');

        await script.next(); // WaitingToStart → *:30 Rest
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);

        await pump(script, BOUNDARY_MS - 100, 100);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);

        await pump(script, 100, 100); // elapsed === 30_000 exactly
        expect((await script.snapshot()).depth).toBe(0);
        expect(skipAttempts).toHaveLength(0);
    });

    it('drains after overrun without user next and closes all rest segments', async () => {
        script = await TestScript.compile('*:30 Rest');
        const skipAttempts: number[] = [];
        script.runtime.eventBus.on('timer:skip-attempt', () => skipAttempts.push(1), 'test-recorder');

        await script.next(); // start rest
        await pump(script, 45_000, 1_000); // 15s overrun
        expect((await script.snapshot()).depth).toBe(0);

        await pump(script, 5_000, 1_000); // ticks past the drain are inert
        expect((await script.snapshot()).depth).toBe(0);
        expect(skipAttempts).toHaveLength(0);

        // Consumer-visible completion evidence: every rest segment the session
        // opened is closed by a matching output (mount/unmount paired).
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('still suppresses Next before zero (skip-attempt contract preserved)', async () => {
        script = await TestScript.compile('*:30 Rest');
        const skipAttempts: number[] = [];
        script.runtime.eventBus.on('timer:skip-attempt', () => skipAttempts.push(1), 'test-recorder');

        await script.next(); // start rest
        await pump(script, 10_000, 1_000);

        const depthBefore = (await script.snapshot()).depth;
        await script.next(); // skip attempt on a required, unexpired timer

        expect((await script.snapshot()).depth).toBe(depthBefore);
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
        expect(skipAttempts).toHaveLength(1);
    });

    it('unforced :30 Rest also drains on overrun (rest never sticks)', async () => {
        script = await TestScript.compile(':30 Rest');
        const skipAttempts: number[] = [];
        script.runtime.eventBus.on('timer:skip-attempt', () => skipAttempts.push(1), 'test-recorder');

        await script.next(); // start rest
        await pump(script, 45_000, 1_000);
        expect((await script.snapshot()).depth).toBe(0);
        expect(skipAttempts).toHaveLength(0);
    });

    it('two rounds with *:30 rest inside the loop complete fully', async () => {
        script = await TestScript.compile('(2)\n  10 Pullups\n  *:30 Rest');
        const skipAttempts: number[] = [];
        script.runtime.eventBus.on('timer:skip-attempt', () => skipAttempts.push(1), 'test-recorder');

        await script.next(); // start → R1 Pullups
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);

        await script.next(); // Pullups R1 → rest R1 auto-pushed
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);

        await pump(script, BOUNDARY_MS, 100); // rest R1 expires at zero → R2
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
        expect(getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);

        await script.next(); // Pullups R2 → rest R2 auto-pushed
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);

        await pump(script, BOUNDARY_MS, 100); // rest R2 expires → session done
        expect((await script.snapshot()).depth).toBe(0);
        expect(skipAttempts).toHaveLength(0);
    });
});
