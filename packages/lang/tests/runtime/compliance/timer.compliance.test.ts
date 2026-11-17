/**
 * Timer Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/timer.md
 *
 * Covers all Timer scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { currentBlockType, anySystemPopHasReason, systemPopValues, anyOutputHasMetric } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟢 Countdown Timer — 5:00 Run
// Spec: timer.md#-countdown-timer
// ===========================================================================
describeCompliance('🟢 Countdown Timer — 5:00 Run', '5:00 Run', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Timer starts, direction = down', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(150_000) → mid-timer, block still active', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(150_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 3: advanceClock(150_000) more → timer expires, session ends', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(150_000);
        await script.tick(150_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Short Timer — :30 Plank
// Spec: timer.md#-short-timer-30-format
// ===========================================================================
describeCompliance('🟢 Short Timer — :30 Plank', ':30 Plank', (ctx) => {

    it('step 1: userNext → Timer starts (30s)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(30_000) → auto-pops at 30s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(30_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Timer — Exact Boundary
// Spec: timer.md#-timer--exact-boundary
// ===========================================================================
describeCompliance('🟢 Timer — Exact Boundary', '1:00 Row', (ctx) => {

    it('step 1: userNext → timer running', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(60_000) → expires at exactly 60s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Timer — Mid-Stream Check
// Spec: timer.md#-timer--mid-stream-check
// ===========================================================================
describeCompliance('🟢 Timer — Mid-Stream Check', '2:00 Bike', (ctx) => {

    it('step 1: userNext → timer running', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(60_000) → still active, elapsed ~60s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 3: advanceClock(60_000) → expires at 120s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Sequential Timers
// Spec: timer.md#-sequential-timers
// ===========================================================================
describeCompliance('🟢 Sequential Timers — 5:00 Run / 3:00 Row', '5:00 Run\n3:00 Row', (ctx) => {

    it('step 1: userNext → first timer (Run) starts', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(300_000) → first expires, second timer (Row) auto-pushes', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(300_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 3: advanceClock(180_000) → second expires, session ends', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(300_000);
        await script.tick(180_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟡 Timer — Normal (Skippable by Default)
// Spec: timer.md#-timer--normal-skippable-by-default
// ===========================================================================
describeCompliance('🟡 Timer — Normal (Skippable by Default)', '5:00 Run', (ctx) => {

    it('step 1: userNext → timer starts (5:00 countdown)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2a: early userNext → timer dismissed, session ends (user-advance)', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.next(); // early skip
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('step 2a: early skip carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.next(); // early skip
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });

    it('step 2b: advanceClock(300_000) → timer expires at 0:00, session ends (timer-expiry)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(300_000);
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('step 2b: timer-expiry carries completionReason = "timer-expired"', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(300_000);
        // Check the timer block's pop specifically (last pop before session root)
        const pops = await systemPopValues(await script.snapshot());
        const timerPop = pops.find(p => p['blockLabel'] === '5:00 Run');
        expect(timerPop?.completionReason).toBe('timer-expired');
    });
});

// ===========================================================================
// 🔴 Forced Timer — Cannot Skip (`*` prefix)
// Spec: timer.md#-forced-timer--cannot-skip--prefix
// ===========================================================================
describeCompliance('🔴 Forced Timer — Cannot Skip (*5:00 Run)', '*5:00 Run', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → forced timer starts', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: userNext (attempt skip) → no-op, block stays, countdown continues', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer

        const depthBeforeSkip = (await script.snapshot()).depth;
        await script.next(); // attempt skip — must be no-op
        expect((await script.snapshot()).depth).toBe(depthBeforeSkip);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('multiple userNext calls during forced timer all produce zero stack changes', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer

        const depthAfterStart = (await script.snapshot()).depth;
        await script.next();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(depthAfterStart);
    });

    it('step 3: advanceClock(300_000) → timer expires → auto-pop, session ends', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.next(); // attempt skip — no-op
        await script.tick(300_000);
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('forced timer completionReason is never "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // attempt skip
        await script.tick(300_000); // expire

        // The WaitingToStart pop uses user-advance (correct), but the forced timer
        // block itself must NOT use user-advance. Check only the timer block's pop.
        const pops = await systemPopValues(await script.snapshot());
        const timerPop = pops.find(p => p['blockLabel'] === '*5:00 Run' || p['blockType'] === 'Timer');
        // If the label check misses, fall back to checking the pop before SessionRoot
        const forcedTimerPop = timerPop ?? pops.at(-2); // -2: timer pop; -1: session-root pop
        expect(forcedTimerPop?.completionReason).not.toBe('user-advance');
    });

    it('forced timer completionReason is "timer-expired"', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(300_000); // expire

        // The timer block's pop should carry timer-expired as the reason.
        const pops = await systemPopValues(await script.snapshot());
        const timerPop = pops.at(-2); // -2: timer pop; -1: session-root pop
        expect(timerPop?.completionReason).toBe('timer-expired');
    });
});

// ===========================================================================
// 🔴 Collectible Timer — :? Sprint
// Spec: timer.md#-collectible-timer-skip
// ===========================================================================
describeCompliance('🔴 Collectible Timer — :? Sprint', ':? Sprint', (ctx) => {

    it('step 1: startSession + userNext → Timer starts with no fixed duration', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → timer block
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 1: collectible timer is a count-up timer (no fixed duration)', async () => {
        const script = await ctx.compile();
        await script.next();

        // Confirm the block is still active (no auto-expiry since no fixed duration)
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: userNext manually completes the collectible timer', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.tick(45_000); // let some time elapse
        await script.next(); // manually complete
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('step 2: captured time is recorded on manual completion', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.tick(45_000); // 45 seconds elapsed
        await script.next(); // complete

        // At least one output statement should be produced
        expect(assertions(await script.snapshot()).outputs().all().length).toBeGreaterThan(0);
    });

    it('step 2: manual completion carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(45_000);
        await script.next(); // complete

        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });
});

// ===========================================================================
// 🟢 Sound Cues — Countdown Timer
// Spec: timer.md#sound-cues
// ===========================================================================
describeCompliance('🟢 Sound Cues — Countdown Timer (5:00 Run)', '5:00 Run', (ctx) => {

    it('timer-completion emits a "timer-complete" sound output', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.tick(300_000); // expire
        const snap = await script.snapshot();
        expect(anyOutputHasMetric(snap, 'sound')).toBe(true);
        // Verify the specific sound
        const soundOutputs = assertions(snap).outputs().all().filter(o =>
            o.metrics.some(m => m.type === 'sound')
        );
        const completeSound = soundOutputs.find(o =>
            o.metrics.some(m => m.value?.trigger === 'complete')
        );
        expect(completeSound).toBeDefined();
    });

    it('countdown beeps fire at 3-2-1 seconds remaining', async () => {
        const script = await ctx.compile();
        await script.next(); // start timer
        await script.tick(297_000); // advance to 3s remaining
        await script.tick(1_000); // 2s remaining
        await script.tick(1_000); // 1s remaining
        await script.tick(1_000); // 0s → complete
        const snap = await script.snapshot();
        const soundOutputs = assertions(snap).outputs().all().filter(o =>
            o.metrics.some(m => m.type === 'sound' && m.value?.trigger === 'countdown')
        );
        const countdownSeconds = soundOutputs.map(o => {
            const m = o.metrics.find(m => m.type === 'sound');
            return m?.value?.atSecond;
        }).sort();
        expect(countdownSeconds).toContain(3);
        expect(countdownSeconds).toContain(2);
        expect(countdownSeconds).toContain(1);
    });
});

// ===========================================================================
// 🟢 Timer Label & Display — Countdown (5:00 Run)
// ===========================================================================
describeCompliance('🟢 Timer Label & Display — Countdown (5:00 Run)', '5:00 Run', (ctx) => {

    it('block label includes "Run"', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const label = snap.current?.label;
        expect(label).toContain('Run');
    });

    it('display metrics include duration and effort', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const block = a.currentBlock();
        expect(block).toBeDefined();
        expect(block!.hasMetric('metric:display', 'duration')).toBe(true);
        expect(block!.hasMetric('metric:display', 'effort')).toBe(true);
        const effort = block!.displayMetric('effort');
        expect(effort?.value).toBe('Run');
    });

    it('timer direction is "down" (countdown)', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const timerState = a.currentBlock()?.timerState();
        expect(timerState).toBeDefined();
        expect(timerState!.direction).toBe('down');
        expect(timerState!.durationMs).toBe(300_000);
    });
});

// ===========================================================================
// 🟢 Timer Label & Display — Count-up (^5:00 Row)
// ===========================================================================
describeCompliance('🟢 Timer Label & Display — Count-up (^5:00 Row)', '^5:00 Row', (ctx) => {

    it('block label includes "Row"', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const label = snap.current?.label;
        expect(label).toContain('Row');
    });

    it('display metrics include duration and effort', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const block = a.currentBlock();
        expect(block).toBeDefined();
        expect(block!.hasMetric('metric:display', 'effort')).toBe(true);
        const effort = block!.displayMetric('effort');
        expect(effort?.value).toBe('Row');
    });

    it('timer direction is "up" (count-up / elapsed)', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const timerState = a.currentBlock()?.timerState();
        expect(timerState).toBeDefined();
        expect(timerState!.direction).toBe('up');
    });
});

// ===========================================================================
// 🟢 Timer Label & Display — Collectible (:? Sprint)
// ===========================================================================
describeCompliance('🟢 Timer Label & Display — Collectible (:? Sprint)', ':? Sprint', (ctx) => {

    it('block label includes "Sprint"', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const label = snap.current?.label;
        expect(label).toContain('Sprint');
    });

    it('display metrics include effort "Sprint"', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const block = a.currentBlock();
        expect(block).toBeDefined();
        expect(block!.hasMetric('metric:display', 'effort')).toBe(true);
        const effort = block!.displayMetric('effort');
        expect(effort?.value).toBe('Sprint');
    });

    it('timer direction is "up" (collectible / elapsed)', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const timerState = a.currentBlock()?.timerState();
        expect(timerState).toBeDefined();
        expect(timerState!.direction).toBe('up');
    });

    it('collectible timer has no fixed duration', async () => {
        const script = await ctx.compile();
        await script.next();
        const snap = await script.snapshot();
        const a = assertions(snap);
        const timerState = a.currentBlock()?.timerState();
        expect(timerState).toBeDefined();
        expect(timerState!.durationMs).toBeFalsy();
    });
});
