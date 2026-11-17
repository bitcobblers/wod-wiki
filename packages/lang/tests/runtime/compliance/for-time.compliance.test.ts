/**
 * For Time Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/for-time.md
 *
 * Covers all For Time scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 *
 * Architecture notes:
 *   - Parser metrics (Rep, Effort, Resistance) are stored in block display
 *     memory under the 'metric:display' tag.
 *   - Segment and completion OUTPUT statements only carry timing metrics
 *     (elapsed, total, spans, system-time). Display metrics live in block
 *     memory, NOT in output.
 *   - `completionReason` is carried in the `system` output event's metric
 *     value (not in the `completion` output's completionReason field).
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

import { currentBlockType, anySystemPopHasReason, systemPopValues, blockHasDisplayMetric } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟢 Single Movement — "30 Clean & Jerk 135lb"
//
// Spec: for-time.md#-single-movement
//
// No timer involved — purely user-driven. The athlete advances manually.
// Metrics include resistance (135lb).
// ===========================================================================
describeCompliance('🟢 Single Movement (30 Clean & Jerk 135lb)', '30 Clean & Jerk 135lb', (ctx) => {

    it('step 0: startSession → SessionRoot + WaitingToStart (depth = 2)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: first userNext → effort block mounted (WaitingToStart pops)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 1: effort block is at depth ≥ 2 (SessionRoot + Effort)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
    });

    it('step 1: resistance metric (135lb) is stored in block display memory', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await blockHasDisplayMetric(await script.snapshot(), MetricType.Resistance)).toBe(true);
    });

    it('step 2: second userNext → effort pops, session ends (depth = 0)', async () => {
        const script = await ctx.compile();
        await script.next(); // mount effort
        await script.next(); // complete effort
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('no timer involved — no countdown block appears at any point', async () => {
        const script = await ctx.compile();
        await script.next();
        // No timer or countdown block should appear on the stack
        const hasTimer = (await script.snapshot()).blocks.some(b =>
            /timer|countdown/i.test(b.blockType ?? '')
        );
        expect(hasTimer).toBe(false);
    });

    it('completionReason is user-advance for effort (via system event)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });

    it('all outputs are paired (segment + completion for every block)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 Multi-Movement with Rep Scheme — "21-15-9 For Time: Thrusters / Pull-ups"
//
// Spec: for-time.md#-multi-movement-with-rep-scheme
//
// Rep count changes per round: 21 → 15 → 9.
// Total: 3 rounds × 2 exercises = 6 userNext calls after the initial start.
// ===========================================================================
describeCompliance('🟢 Multi-Movement with Rep Scheme (21-15-9 For Time)', '(21-15-9)\n  Thrusters 95lb\n  Pullups', (ctx) => {
    // "(21-15-9)" parentheses format is the canonical parser form for rep-scheme loops.
    // The spec also documents "21-15-9 For Time" as equivalent — the parser normalises both.

    async function oneRound(s: Awaited<ReturnType<typeof ctx.compile>>) {
        await s.next(); // Thrusters
        await s.next(); // Pullups
    }

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: first userNext → loop/rounds block and first exercise pushed', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → Round 1 / Thrusters
        // Stack should be at least: SessionRoot + Loop + Effort
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(3);
    });

    it('step 1: current block is an effort type (Thrusters)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('steps 1-2: round 1 has 2 exercises (Thrusters → Pullups)', async () => {
        const script = await ctx.compile();
        await script.next(); // start → Thrusters R1
        await script.next(); // Thrusters → Pullups R1
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
        // Stack still has loop block
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
    });

    it('completes all 3 rounds with 6 userNexts after start', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await oneRound(script); // R1: 21 reps each
        await oneRound(script); // R2: 15 reps each
        await oneRound(script); // R3: 9 reps each
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('session ends after exactly 3 rounds × 2 exercises = 6 userNexts', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        for (let i = 0; i < 6; i++) {
            expect((await script.snapshot()).depth).toBeGreaterThan(0);
            await script.next();
        }
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired (segment + completion for every block)', async () => {
        const script = await ctx.compile();
        await script.next();
        await oneRound(script);
        await oneRound(script);
        await oneRound(script);
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('total outputs are sufficient for 3 rounds + session overhead', async () => {
        const script = await ctx.compile();
        await script.next();
        await oneRound(script);
        await oneRound(script);
        await oneRound(script);
        // At minimum: SessionRoot(2) + WaitingToStart(2) + Loop(2) + 6 Efforts(12) = 18
        expect(assertions(await script.snapshot()).outputs().count()).toBeGreaterThanOrEqual(18);
    });
});

// ===========================================================================
// 🟢 Classic "Fran" — `21-15-9` without "For Time" keyword
//
// Spec: for-time.md#-classic-fran
//
// Same as the rep-scheme scenario above but without the explicit "For Time"
// text. The parser should compile both identically.
// ===========================================================================
describeCompliance('🟢 Classic Fran (21-15-9 without "For Time" keyword)', '21-15-9\n  Thrusters 95lb\n  Pullups', (ctx) => {

    async function oneRound(s: Awaited<ReturnType<typeof ctx.compile>>) {
        await s.next(); // Thrusters
        await s.next(); // Pullups
    }

    it('startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('first userNext starts the rep-scheme loop and pushes first exercise', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(3);
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('completes all 3 rounds with 6 userNexts after start (identical to For Time variant)', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await oneRound(script); // R1
        await oneRound(script); // R2
        await oneRound(script); // R3
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired', async () => {
        const script = await ctx.compile();
        await script.next();
        await oneRound(script);
        await oneRound(script);
        await oneRound(script);
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 For Time with Skippable Rest
//
//   21 Thrusters @ 95 lb
//   :30 Rest
//   21 Pull-ups
//
// Spec: for-time.md#-for-time-with-skippable-rest
//
// A rest period between movements can be skipped early by the athlete.
// When skipped: completionReason = 'user-advance'.
// When waited: completionReason ≠ 'user-advance' (timer-expiry or omitted).
// ===========================================================================
describeCompliance('🟢 For Time with Skippable Rest (:30 Rest)', '21 Thrusters 95lb\n:30 Rest\n21 Pullups', (ctx) => {

    it('step 0: startSession → depth = 2', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: first userNext → Thrusters effort mounted', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → Thrusters
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 2: second userNext → :30 Rest/Timer block becomes current', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
    });

    it('step 3a: userNext on :30 Rest skips it — Pull-ups become current immediately', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest mounted
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
        await script.next(); // skip rest → Pull-ups
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 3a: rest dismissed via userNext carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest mounted
        await script.next(); // skip rest
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });

    it('step 3b: advanceClock(30_000) auto-expires :30 Rest → Pull-ups become current', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest mounted
        await script.tick(30_000); // rest timer fires
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 3b: auto-expired rest does NOT carry completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest mounted
        await script.tick(30_000); // rest auto-expires
        // The rest block's system pop should NOT be 'user-advance'
        const pops = await systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('session ends cleanly after skipping rest and completing Pull-ups', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest
        await script.next(); // skip rest → Pull-ups
        await script.next(); // Pull-ups done → session ends
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('session ends cleanly after waiting for rest to expire and completing Pull-ups', async () => {
        const script = await ctx.compile();
        await script.next(); // Thrusters
        await script.next(); // :30 Rest
        await script.tick(30_000); // rest auto-expires → Pull-ups
        await script.next(); // Pull-ups done
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired when rest is skipped', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.next();
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 For Time with Forced Rest (Cannot Skip)
//
//   21 Thrusters @ 95 lb
//   *:30 Rest
//   21 Pull-ups
//
// Spec: for-time.md#-for-time-with-forced-rest-cannot-skip
//
// The `*` prefix marks the rest as required — userNext is IGNORED while the
// countdown is active. The block only exits when the timer fires.
// ===========================================================================
describeCompliance('🟢 For Time with Forced Rest (*:30 — Cannot Skip)', '21 Thrusters 95lb\n*:30 Rest\n21 Pullups', (ctx) => {

    /** Helper: drive to the point where *:30 forced Rest is the current block. */
    async function enterForcedRest() {
        const s = await ctx.compile();
        await s.next(); // WaitingToStart → Thrusters
        await s.next(); // Thrusters → *:30 forced Rest
        return s;
    }

    it('step 2: forced rest/timer block is mounted after Thrusters', async () => {
        const script = await enterForcedRest();
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
    });

    it('step 3: userNext during *:30 forced rest is a no-op — stack depth unchanged', async () => {
        const script = await enterForcedRest();
        const depthAtRest = (await script.snapshot()).depth;
        await script.next(); // attempt skip — MUST be suppressed
        expect((await script.snapshot()).depth).toBe(depthAtRest);
    });

    it('multiple userNext calls during *:30 forced rest all produce zero stack changes', async () => {
        const script = await enterForcedRest();
        const depthAtRest = (await script.snapshot()).depth;
        await script.next();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(depthAtRest);
    });

    it('forced rest remains the current block after userNext attempt', async () => {
        const script = await enterForcedRest();
        await script.next(); // attempt skip — suppressed
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
    });

    it('advanceClock(30_000) expires forced rest → auto-pops → Pull-ups become current', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000); // forced rest timer fires
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('forced rest completionReason is never "user-advance" (via system events)', async () => {
        const script = await enterForcedRest();
        await script.next(); // suppressed no-op
        await script.tick(30_000); // rest auto-pops

        const pops = await systemPopValues(await script.snapshot());
        // Last pop is the forced rest auto-completing
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('userNext attempts + timer expiry: no forced-rest pop has "user-advance"', async () => {
        const script = await enterForcedRest();
        await script.next(); // suppressed
        await script.next(); // suppressed
        await script.tick(30_000); // timer fires

        // The Thrusters pop IS 'user-advance' (correct for a skippable effort).
        // The forced rest pop must NOT be 'user-advance'.
        // We verify the last pop — the forced rest auto-pop — is not user-advance.
        const pops = await systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('after forced rest expires, userNext completes Pull-ups → session ends', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000); // forced rest auto-pops → Pull-ups
        await script.next(); // Pull-ups done
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired after complete run including forced rest', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000); // forced rest auto-pops
        await script.next(); // Pull-ups
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});
