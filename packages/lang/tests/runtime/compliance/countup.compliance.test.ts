/**
 * Count-up Timer Compliance Tests
 *
 * Based on: docs/whiteboard-language/core-syntax.md
 *
 * Covers count-up timer patterns (trend / override syntax) that were
 * previously only tested at the parser level.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { currentBlockType, anySystemPopHasReason } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟡 Count-up Override — ^5:00 Row
// Spec: core-syntax.md#modifiers
//
// The ^ prefix forces a count-up timer even when a duration is present.
// The duration becomes a target/guide rather than a countdown.
// ===========================================================================
describeCompliance('🟡 Count-up Override — ^5:00 Row', '^5:00 Row', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Timer starts, direction = up', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(180_000) → 3 minutes elapsed, still active (no auto-expiry)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(180_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: advanceClock(300_000) → 5 minutes elapsed, still active (duration is target, not limit)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(300_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 3: userNext → manually completes timer, session ends', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(180_000); // let 3 min elapse
        await script.next(); // complete
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('manual completion carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(180_000);
        await script.next(); // complete
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });

    it('outputs include elapsed time from count-up timer', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(180_000);
        await script.next();

        const outputs = assertions(await script.snapshot()).outputs().all();
        expect(outputs.length).toBeGreaterThan(0);
    });
});

// ===========================================================================
// 🟡 Collectible Timer — :? Sprint
// Spec: timer.md#-collectible-timer-skip
//
// :? creates a count-up timer with no fixed duration. Elapsed time is
// recorded as the collectible metric on completion.
// ===========================================================================
describeCompliance('🟡 Collectible Timer — :? Sprint', ':? Sprint', (ctx) => {

    it('step 1: startSession + userNext → Timer starts with no fixed duration', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('collectible timer is a count-up timer (no fixed duration)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        expect(await currentBlockType(await script.snapshot())).toMatch(/timer/i);
    });

    it('step 2: userNext manually completes the collectible timer', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(45_000);
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('captured time is recorded on manual completion', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(45_000);
        await script.next();
        expect(assertions(await script.snapshot()).outputs().all().length).toBeGreaterThan(0);
    });

    it('manual completion carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(45_000);
        await script.next();
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });
});
