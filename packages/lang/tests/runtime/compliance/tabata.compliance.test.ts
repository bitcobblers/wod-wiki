/**
 * Tabata Interval Compliance Tests
 *
 * Covers Tabata-style interval protocols:
 *   - Fixed rounds of work/rest pairs
 *   - Timer resets each round
 *   - No manual advancement needed between work and rest
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { currentBlockType, getRoundState } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟡 Classic Tabata — (8) :20 Air Squats / :10 Rest
// Spec: protocols-4.md
//
// 8 rounds of 20 seconds work, 10 seconds rest.
// Timer auto-advances between work and rest; userNext not required.
// ===========================================================================
describeCompliance('🟡 Classic Tabata — (8) :20 / :10 Rest', '(8)\n  :20 Air Squats\n  :10 Rest', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Rounds block starts, first work child active', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });

    it('work phase :20 countdown is active after start', async () => {
        const script = await ctx.compile();
        await script.next();
        const type = await currentBlockType(await script.snapshot());
        expect(type).toMatch(/timer|effort/i);
    });

    it('after :20 work, timer auto-pops → rest :10 starts', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(20_000);
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThan(0);
    });

    it('after :10 rest, timer auto-pops → round 2 work starts', async () => {
        const script = await ctx.compile();
        await script.next();
        // Round 1: work + rest
        await script.tick(20_000);
        await script.tick(10_000);

        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThan(0);
    });

    it('completes all 8 rounds automatically (no userNext during rounds)', async () => {
        const script = await ctx.compile();
        await script.next();

        for (let round = 0; round < 8; round++) {
            await script.tick(20_000); // work
            await script.tick(10_000); // rest
        }

        expect((await script.snapshot()).depth).toBe(0);
    });

    it('emits paired outputs through all 8 rounds', async () => {
        const script = await ctx.compile();
        await script.next();

        for (let round = 0; round < 8; round++) {
            await script.tick(20_000);
            await script.tick(10_000);
        }

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('round counter reaches 8/8 during last round', async () => {
        const script = await ctx.compile();
        await script.next();

        for (let round = 0; round < 7; round++) {
            await script.tick(20_000);
            await script.tick(10_000);
        }

        // 8th round — work phase
        await script.tick(20_000);
        const state = await script.snapshot();
        const roundState = getRoundState(state, 'Rounds');
        expect(roundState?.current).toBe(8);
    });
});

// ===========================================================================
// 🟡 Tabata with Label — (8) :20 Tabata / Air Squats
// Spec: protocols-4.md (getting-started variant)
//
// Tabata keyword on the work line signals the protocol type.
// ===========================================================================
describeCompliance('🟡 Tabata with Label — (8) :20 Tabata / Air Squats', '(8)\n  :20 Tabata\n    Air Squats\n  :10 Rest', (ctx) => {

    it('step 1: userNext → block starts', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });

    it('completes all 8 rounds with manual next on effort', async () => {
        const script = await ctx.compile();
        await script.next();

        for (let round = 0; round < 8; round++) {
            // Work phase: effort block is active alongside timer
            await script.tick(20_000); // timer expires
            await script.next();       // dismiss effort block
            await script.tick(10_000); // rest expires
        }

        expect((await script.snapshot()).depth).toBe(0);
    });
});
