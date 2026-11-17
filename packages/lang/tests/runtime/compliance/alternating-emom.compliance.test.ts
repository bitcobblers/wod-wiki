/**
 * Alternating EMOM Compliance Tests
 *
 * Covers EMOM protocols where the interval rotates between
 * different exercises (alternating lap markers).
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { getRoundState } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟡 Alternating EMOM — (3) :60 EMOM / - 5 Pullups / - 8 Pushups
// Spec: basic-emom.md (alternating variant)
//
// 3 intervals of 60 seconds. Each minute alternates between Pullups and Pushups.
// Round 1: Pullups, Round 1: Pushups, Round 2: Pullups, Round 2: Pushups, etc.
// Note: with 2 children, each round consumes 2 ticks (2 minutes).
// ===========================================================================
describeCompliance('🟡 Alternating EMOM — (3) :60 / - 5 Pullups / - 8 Pushups', '(3) :60 EMOM\n  - 5 Pullups\n  - 8 Pushups', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → EMOM block starts, first child active (Pullups)', async () => {
        const script = await ctx.compile();
        await script.next();
        const state = await script.snapshot();
        expect(state.depth).toBeGreaterThan(0);
    });

    it('round 1: :60 timer counts down for Pullups', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(30_000);
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });

    it('after :60, timer auto-pops → round 1 Pushups starts', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        const state = await script.snapshot();
        expect(state.depth).toBeGreaterThan(0);
    });
    it('completes all 3 rounds automatically (6 ticks = 3 rounds × 2 children)', async () => {
        const script = await ctx.compile();
        await script.next();
        // 3 rounds × 2 children = 6 ticks
        for (let i = 0; i < 6; i++) {
            await script.tick(60_000);
        }
        expect((await script.snapshot()).depth).toBe(0);
    });
    it('emits paired outputs through all 3 rounds', async () => {
        const script = await ctx.compile();
        await script.next();
        for (let i = 0; i < 6; i++) {
            await script.tick(60_000);
        }
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
    it('round counter reaches 3/3 before final completion tick', async () => {
        const script = await ctx.compile();
        await script.next();
        for (let i = 0; i < 5; i++) {
            await script.tick(60_000);
        }
        // After 5 ticks: round 3, 2nd child is active (depth still 3)
        const state = await script.snapshot();
        const roundState = getRoundState(state, 'EMOM');
        expect(roundState?.current).toBe(3);
    });
});

// ===========================================================================
// 🟡 Open EMOM — :60 EMOM / 5 Air Squats
// Spec: core-syntax.md
//
// No explicit round count — defaults to 10 rounds.
// ===========================================================================
describeCompliance('🟡 Open EMOM — :60 EMOM / 5 Air Squats', ':60 EMOM\n  5 Air Squats', (ctx) => {

    it('step 1: userNext → EMOM block starts', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });
    it('timer resets every :60 for default 10 rounds', async () => {
        const script = await ctx.compile();
        await script.next();
        // Default is 10 rounds; run 9 ticks to stay active
        for (let i = 0; i < 9; i++) {
            await script.tick(60_000);
        }
        // Still running after 9 ticks (10th tick will complete)
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });

    it('session ends after default 10 rounds', async () => {
        const script = await ctx.compile();
        await script.next();
        for (let i = 0; i < 10; i++) {
            await script.tick(60_000);
        }
        expect((await script.snapshot()).depth).toBe(0);
    });
});
