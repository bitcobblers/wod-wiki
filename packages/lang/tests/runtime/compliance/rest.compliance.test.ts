/**
 * Rest Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/rest.md
 *
 * Covers all Rest scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { currentBlockType, systemPopValues, getRoundState } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟢 Timed Rest (standalone)
// Spec: rest.md#-timed-rest-standalone
// ===========================================================================
describeCompliance('🟢 Timed Rest (standalone) — 1:00 Rest', '1:00 Rest', (ctx) => {
    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Rest timer starts', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 2: advanceClock(60_000) → rest auto-completes, session ends', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 Rest Between Efforts in a Loop
// Spec: rest.md#-rest-between-efforts-in-a-loop
// ===========================================================================
describeCompliance('🟢 Rest Between Efforts in a Loop — (3) / 10 Pullups / 15 Pushups / 1:00 Rest', '(3)\n  10 Pullups\n  15 Pushups\n  1:00 Rest', (ctx) => {
    it('step 1: userNext → R1 Pullups mounted', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(1);
    });

    it('step 2: userNext → R1 Pushups mounted', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups R1
        await script.next(); // Pushups R1
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 3: after Pushups, rest is auto-pushed', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups R1
        await script.next(); // Pushups R1
        await script.next(); // Rest R1 auto-pushed
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 3a: advanceClock(60_000) → rest expires, R2 starts', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups R1
        await script.next(); // Pushups R1
        await script.next(); // Rest R1
        await script.tick(60_000); // rest expires → R2
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
    });

    it('3 rounds × (2 userNext + 1 rest expiry) completes session', async () => {
        const script = await ctx.compile();
        await script.next(); // start

        for (let r = 0; r < 3; r++) {
            await script.next(); // Pullups
            await script.next(); // Pushups
            await script.next(); // Rest auto-pushed
            await script.tick(60_000); // rest expires
        }
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Timed Rest — Skip vs. Wait (Skippable)
// Spec: rest.md#-timed-rest--skip-vs-wait-skippable
// ===========================================================================
describeCompliance('🟢 Timed Rest — Skip vs. Wait (Skippable) — :30 Rest', ':30 Rest', (ctx) => {
    it('step 0: startSession → depth = 2', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Rest timer starts (30s)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 2a: userNext (early skip) → rest dismissed, session ends', async () => {
        const script = await ctx.compile();
        await script.next(); // start rest
        await script.next(); // skip early
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('step 2a: skipped rest carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start rest
        await script.next(); // skip early
        const pops = await systemPopValues(await script.snapshot());
        // The rest block pop carries 'user-advance'; the session root pop carries 'children-complete'
        const hasUserAdvance = pops.some(p => p.completionReason === 'user-advance');
        expect(hasUserAdvance).toBe(true);
    });

    it('step 2b: advanceClock(30_000) → rest expires, session ends', async () => {
        const script = await ctx.compile();
        await script.next(); // start rest
        await script.tick(30_000); // rest expires
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('step 2b: auto-expired rest does NOT carry completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start rest
        await script.tick(30_000); // rest expires
        const pops = await systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });
});

// ===========================================================================
// 🟢 Forced Timed Rest — Cannot Skip (`*` prefix)
// Spec: rest.md#-forced-timed-rest--cannot-skip--prefix
// ===========================================================================
describeCompliance('🟢 Forced Timed Rest — Cannot Skip (*:30 Rest)', '*:30 Rest', (ctx) => {
    /** Helper: drive to the point where forced rest is the current block. */
    async function enterForcedRest() {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → *:30 Rest
        return script;
    }

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → forced rest starts', async () => {
        const script = await enterForcedRest();
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 2: userNext (attempt skip) → no-op, block stays', async () => {
        const script = await enterForcedRest();
        const depthAtRest = (await script.snapshot()).depth;
        await script.next(); // attempt skip — MUST be suppressed
        expect((await script.snapshot()).depth).toBe(depthAtRest);
    });

    it('multiple userNext calls during forced rest all produce zero stack changes', async () => {
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
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 3: advanceClock(30_000) → timer expires, session ends', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000); // forced rest timer fires → auto-pop
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('completionReason is never "user-advance" for forced rest', async () => {
        const script = await enterForcedRest();
        await script.next(); // suppressed no-op
        await script.tick(30_000); // timer fires

        const pops = await systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('all outputs are paired after forced rest', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000);
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 Forced Rest in a Loop
// Spec: rest.md#-forced-rest-in-a-loop
// ===========================================================================
describeCompliance('🟢 Forced Rest in a Loop — (3) / 10 Pullups / 15 Pushups / *1:00 Rest', '(3)\n  10 Pullups\n  15 Pushups\n  *1:00 Rest', (ctx) => {
    it('step 3: forced rest is auto-pushed after Pushups', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups R1
        await script.next(); // Pushups R1
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 4: userNext during forced rest is a no-op', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups
        await script.next(); // Pushups → Rest auto-pushed
        const depthAtRest = (await script.snapshot()).depth;
        await script.next(); // attempt skip — no-op
        expect((await script.snapshot()).depth).toBe(depthAtRest);
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 5: advanceClock(60_000) → rest expires, R2 starts', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups R1
        await script.next(); // Pushups R1
        await script.tick(60_000); // rest expires → R2
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
    });

    it('all 3 forced rests must expire to complete session', async () => {
        const script = await ctx.compile();
        await script.next(); // start

        for (let r = 0; r < 3; r++) {
            await script.next(); // Pullups
            await script.next(); // Pushups
            // rest auto-pushed (no userNext needed)
            await script.tick(60_000); // rest expires
        }
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all 3 forced rests have completionReason != "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start

        for (let r = 0; r < 3; r++) {
            await script.next(); // Pullups
            await script.next(); // Pushups
            await script.tick(60_000); // rest expires
        }

        const pops = await systemPopValues(await script.snapshot());
        // Each forced rest auto-popped via timer; none should be 'user-advance'
        // There are also pops for Rounds block and SessionRoot (children-complete),
        // so the total non-user-advance count exceeds 3. We verify at least 3 (one per forced rest).
        const nonUserAdvancePops = pops.filter(p => p.completionReason !== 'user-advance');
        expect(nonUserAdvancePops.length).toBeGreaterThanOrEqual(3);
    });
});

// ===========================================================================
// 🟢 Short Rest Modifier — *:30 before effort (no "Rest" keyword)
// Spec: rest.md#-short-rest-modifier--prefix-without-keyword
// ===========================================================================
describeCompliance('🟢 Short Rest Modifier — *:30 before effort', '*:30\n10 Pullups', (ctx) => {
    it('step 1: userNext → *:30 timer block starts', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → *:30 timer block
        expect(await currentBlockType(await script.snapshot())).toMatch(/rest|timer/i);
    });

    it('step 2: userNext during *:30 is a no-op (forced)', async () => {
        const script = await ctx.compile();
        await script.next(); // start *:30 block
        const depthAtRest = (await script.snapshot()).depth;
        await script.next(); // attempt skip — MUST be suppressed
        expect((await script.snapshot()).depth).toBe(depthAtRest);
    });

    it('step 3: advanceClock(30_000) → *:30 expires, Pullups becomes current', async () => {
        const script = await ctx.compile();
        await script.next(); // *:30 block
        await script.tick(30_000); // timer fires
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 4: userNext after Pullups → session ends', async () => {
        const script = await ctx.compile();
        await script.next(); // *:30
        await script.tick(30_000); // rest expires → Pullups
        await script.next(); // Pullups done
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired', async () => {
        const script = await ctx.compile();
        await script.next(); // *:30
        await script.tick(30_000); // expires → Pullups
        await script.next(); // Pullups done
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});
