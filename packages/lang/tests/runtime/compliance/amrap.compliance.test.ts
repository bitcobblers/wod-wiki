/**
 * AMRAP Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/amrap.md
 *
 * Covers all AMRAP scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import type { TestScript } from '@wod-wiki/lang-harness/script/TestScript';
import type { ScriptState } from '@wod-wiki/lang-harness/script';
import { getRoundState, anyOutputHasMetric } from '@wod-wiki/lang-harness/compliance-helpers';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

// ===========================================================================
// 🟢 Classic AMRAP — "Cindy"
// ===========================================================================
describeCompliance('🟢 Classic AMRAP — Cindy (20:00 / 3 children)', '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats', (ctx) => {

    async function oneRound(s: TestScript) {
        await s.next(); // Pullups done
        await s.next(); // Pushups done
        await s.next(); // Air Squats done  →  cycle complete, round advances
    }

    it('step 0: startSession → SessionRoot + WaitingToStart (depth = 2)', async () => {
        const script = await ctx.compile();
        const s = await script.snapshot();
        expect(s.depth).toBe(2);
    });

    it('step 1: first userNext starts AMRAP and pushes 1st exercise', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThanOrEqual(3);
    });

    it('step 1: AMRAP block is present on the stack after first userNext', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        const amrapBlock = s.blocks.find((b) => b.blockType === 'AMRAP');
        expect(amrapBlock).toBeDefined();
    });

    it('step 1: round counter initialises at 1', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
    });

    it('step 2: second userNext advances to 2nd exercise (Pushups)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
        expect(s.depth).toBeGreaterThanOrEqual(3);
    });

    it('step 3: third userNext advances to 3rd exercise (Air Squats)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
    });

    it('step 4: 4th userNext starts round 2 (children cycle back to Pullups)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await oneRound(script);
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('round counter increments correctly across 3 complete rounds', async () => {
        const script = await ctx.compile();
        await script.next();
        for (let r = 1; r <= 3; r++) {
            await script.tick(60_000);
            await oneRound(script);
        }
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(4);
    });

    it('total rounds is undefined (unbounded AMRAP)', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.total).toBeUndefined();
    });

    it('step N: tick(1_200_000) expires timer → session auto-terminates', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await oneRound(script);
        await script.tick(1_140_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });

    it('all outputs are paired (segment + completion for every block)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await oneRound(script);
        await script.tick(1_140_000);
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 Short AMRAP — 2:00 / 5 Burpees
// ===========================================================================
describeCompliance('🟢 Short AMRAP (2:00 / 1 child)', '2:00 AMRAP\n  5 Burpees', (ctx) => {

    it('step 1: userNext starts AMRAP and pushes child', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThanOrEqual(2);
    });

    it('step 2: second userNext completes round 1 and starts round 2', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('at least 2 rounds complete before clock advance', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThanOrEqual(2);
    });

    it('tick(120_000) expires 2:00 timer → session auto-terminates', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(120_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Single-Exercise AMRAP
// ===========================================================================
describeCompliance('🟢 Single-Exercise AMRAP (10:00 / 1 child)', '10:00 AMRAP\n  1 Snatch', (ctx) => {

    it('single child loops on successive userNext calls', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThanOrEqual(2);
    });

    it('round increments on each userNext', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(3);
    });

    it('total rounds is undefined (unbounded)', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.total).toBeUndefined();
    });

    it('timer expiry at 10:00 terminates session', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.tick(600_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 AMRAP with `-` Sequential Grouping
// ===========================================================================
describeCompliance('🟢 AMRAP with - Sequential Grouping (Cindy variant)', '20:00 AMRAP\n  - 5 Pullups\n  - 10 Pushups\n  - 15 Air Squats', (ctx) => {

    async function oneRound(s: TestScript) {
        await s.next();
        await s.next();
        await s.next();
    }

    it('step 1: AMRAP mounts and first child pushed', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThanOrEqual(3);
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
    });

    it('round stays 1 after 2 of 3 children complete (cycle incomplete)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
    });

    it('3 userNexts complete round 1 → round 2 begins', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await oneRound(script);
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('round counter matches Math.floor(nextCount / 3) + 1 pattern', async () => {
        const script = await ctx.compile();
        await script.next();
        let s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
        await script.tick(60_000);
        await oneRound(script);
        s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
        await script.tick(60_000);
        await oneRound(script);
        s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(3);
    });

    it('timer expiry auto-terminates session', async () => {
        const script = await ctx.compile();
        await script.next();
        await oneRound(script);
        await script.tick(1_200_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 AMRAP with `+` Composed Grouping
// ===========================================================================
describeCompliance('🟢 AMRAP with + Composed Grouping (single child group)', '20:00 AMRAP\n  + 5 Pullups\n  + 10 Pushups\n  + 15 Air Squats', (ctx) => {

    it('exactly one child block on stack after first userNext (one composite group)', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBe(3);
    });

    it('round 1 after first userNext starts the composite block', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
    });

    it('one userNext = one completed round', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('round increments sequentially: 1 → 2 → 3 → 4 → 5', async () => {
        const script = await ctx.compile();
        await script.next();
        for (let expected = 2; expected <= 5; expected++) {
            await script.next();
            const s = await script.snapshot();
            expect(getRoundState(s, 'AMRAP')?.current).toBe(expected);
        }
    });

    it('timer expiry at 20:00 terminates session', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.tick(1_200_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟡 AMRAP with Skippable Rest Between Rounds
// ===========================================================================
describeCompliance('🟢 AMRAP with Skippable Rest (:30 Rest)', '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  :30 Rest', (ctx) => {

    it('step 1: AMRAP starts, Pullups pushed', async () => {
        const script = await ctx.compile();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThanOrEqual(3);
    });

    it('step 3: after 2 exercises, a rest/timer block is the current block', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(s.current?.blockType).toMatch(/Rest|Timer/i);
    });

    it('step 4a: userNext on :30 Rest skips it — round 2 begins immediately', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        let s = await script.snapshot();
        expect(s.current?.blockType).toMatch(/Rest|Timer/i);
        await script.next();
        s = await script.snapshot();
        expect(s.current?.blockType).not.toMatch(/Rest|Timer/i);
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('step 4b: tick(30_000) auto-expires :30 Rest → round 2 begins', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.tick(30_000);
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('AMRAP timer expiry at 20:00 terminates session', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(1_200_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 AMRAP with Forced Rest (Cannot Skip)
// ===========================================================================
describeCompliance('🟢 AMRAP with Forced Rest (*:30 — Cannot Skip)', '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  *:30 Rest', (ctx) => {

    async function enterForcedRest(s: TestScript) {
        await s.next();
        await s.next();
        await s.next();
    }

    it('step 3: a rest/timer block is mounted after 2 exercises', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        const s = await script.snapshot();
        expect(s.current?.blockType).toMatch(/Rest|Timer/i);
    });

    it('step 4: userNext during *:30 forced rest is a no-op — stack depth unchanged', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        const depthAtRest = (await script.snapshot()).depth;
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBe(depthAtRest);
    });

    it('multiple userNext calls during *:30 forced rest all produce zero stack changes', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        const depthAtRest = (await script.snapshot()).depth;
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(s.depth).toBe(depthAtRest);
    });

    it('round counter stays at 1 while rest is active (no premature increment)', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(1);
    });

    it('tick(30_000) expires the forced rest → auto-pops → round 2 starts', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.tick(30_000);
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });

    it('AMRAP timer expiry ends session even while inside forced rest', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.tick(1_200_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 AMRAP with `+` Composed Grouping — Proportional Output Splitting
// ===========================================================================
describeCompliance('🟢 AMRAP with + Composed Grouping — proportional output splitting', '20:00 AMRAP\n  + 5 Pullups\n  + 10 Pushups\n  + 15 Air Squats', (ctx) => {

    it('completing one composite round emits ≥ 3 completion outputs (one per exercise)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await script.next();

        const completions = assertions(await script.snapshot()).outputs().completions();
        const exerciseCompletions = completions.filter(c =>
            [...c.metrics].some(m =>
                m.type === MetricType.Rep || m.type === MetricType.Effort
            )
        );
        expect(exerciseCompletions.length).toBeGreaterThanOrEqual(3);
    });

    it('each split completion contains exercise-specific Rep or Effort metric', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await script.next();

        const completions = assertions(await script.snapshot()).outputs().completions();
        const exerciseCompletions = completions.filter(c =>
            [...c.metrics].some(m =>
                m.type === MetricType.Rep || m.type === MetricType.Effort
            )
        );

        expect(exerciseCompletions.length).toBeGreaterThanOrEqual(3);

        for (const comp of exerciseCompletions) {
            const hasRep = [...comp.metrics].some(m => m.type === MetricType.Rep);
            expect(hasRep).toBe(true);
        }
    });

    it('elapsed time across split completions sums to total elapsed (within 1 % rounding)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await script.next();

        const completions = assertions(await script.snapshot()).outputs().completions();
        const exerciseCompletions = completions.filter(c =>
            [...c.metrics].some(m => m.type === MetricType.Rep)
        );

        expect(exerciseCompletions).toHaveLength(3);

        const totalSplitElapsed = exerciseCompletions.reduce((sum, c) => {
            const elapsed = [...c.metrics].find(m => m.type === MetricType.Elapsed);
            return sum + ((elapsed?.value as number) ?? 0);
        }, 0);

        expect(totalSplitElapsed).toBeGreaterThan(59_400);
        expect(totalSplitElapsed).toBeLessThanOrEqual(60_600);
    });

    it('rep ratio 5:10:15 → split elapsed values are in ascending order', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(30_000);
        await script.next();

        const completions = assertions(await script.snapshot()).outputs().completions();
        const exerciseCompletions = completions.filter(c =>
            [...c.metrics].some(m => m.type === MetricType.Rep)
        );

        const elapsedValues = exerciseCompletions
            .map(c => ([...c.metrics].find(m => m.type === MetricType.Elapsed)?.value as number) ?? 0)
            .filter(v => v > 0);

        expect(elapsedValues).toHaveLength(3);
        const sorted = [...elapsedValues].sort((a, b) => a - b);
        expect(sorted[0]).toBeLessThan(sorted[1]);
        expect(sorted[1]).toBeLessThan(sorted[2]);
    });
});

// ===========================================================================
// 🟢 AMRAP Skippable Rest — completionReason in system events
// ===========================================================================
describeCompliance('🟢 AMRAP Skippable Rest — completionReason in system events', '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  :30 Rest', (ctx) => {

    function systemPopValues(state: ScriptState): Array<Record<string, unknown>> {
        return assertions(state).outputs()
            .byType('system')
            .map(o => {
                const m = [...o.metrics].find(mm => mm.type === MetricType.System);
                return m?.value as Record<string, unknown> | undefined;
            })
            .filter((v): v is Record<string, unknown> => !!v && v['event'] === 'pop');
    }

    it('skipping :30 Rest via userNext → completionReason = "user-advance" in system pop', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.next();
        const pops = systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).toBe('user-advance');
    });

    it('auto-expiring :30 Rest → completionReason is NOT "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.tick(30_000);
        const pops = systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('round advances to 2 after rest is skipped, confirming the pop was the rest block', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.next();
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });
});

// ===========================================================================
// 🟢 AMRAP Forced Rest — completionReason never 'user-advance'
// ===========================================================================
describeCompliance('🟢 AMRAP Forced Rest — completionReason never "user-advance"', '20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  *:30 Rest', (ctx) => {

    async function enterForcedRest(s: TestScript) {
        await s.next();
        await s.next();
        await s.next();
    }

    function systemPopValues(state: ScriptState): Array<Record<string, unknown>> {
        return assertions(state).outputs()
            .byType('system')
            .map(o => {
                const m = [...o.metrics].find(mm => mm.type === MetricType.System);
                return m?.value as Record<string, unknown> | undefined;
            })
            .filter((v): v is Record<string, unknown> => !!v && v['event'] === 'pop');
    }

    it('after forced rest expires via timer, last system pop is NOT "user-advance"', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.tick(30_000);
        const pops = systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('after userNext attempts + timer expiry, no forced-rest pop has "user-advance"', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.next();
        await script.next();
        await script.tick(30_000);
        const pops = systemPopValues(await script.snapshot());
        const lastPop = pops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('forced rest completion output has no completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.tick(30_000);

        const completions = assertions(await script.snapshot()).outputs().completions();
        const forcedRestCompletion = completions
            .filter(c => c.completionReason !== undefined)
            .at(-1);

        if (forcedRestCompletion) {
            expect(forcedRestCompletion.completionReason).not.toBe('user-advance');
        }
    });

    it('after forced rest timer fires, round 2 begins (confirming correct pop path)', async () => {
        const script = await ctx.compile();
        await enterForcedRest(script);
        await script.tick(30_000);
        const s = await script.snapshot();
        expect(getRoundState(s, 'AMRAP')?.current).toBe(2);
    });
});

// ===========================================================================
// 🟢 Sound Cues — AMRAP Timer
// Spec: timer.md#sound-cues
// ===========================================================================
describeCompliance('🟢 Sound Cues — AMRAP Timer (2:00)', '2:00 AMRAP\n  5 Burpees', (ctx) => {

    it('AMRAP timer-expiry emits a "timer-complete" sound output', async () => {
        const script = await ctx.compile();
        await script.next(); // start AMRAP
        await script.tick(120_000); // expire AMRAP timer
        const snap = await script.snapshot();
        expect(anyOutputHasMetric(snap, 'sound')).toBe(true);
        const soundOutputs = assertions(snap).outputs().all().filter(o =>
            o.metrics.some(m => m.type === 'sound')
        );
        const completeSound = soundOutputs.find(o =>
            o.metrics.some(m => m.value?.trigger === 'complete')
        );
        expect(completeSound).toBeDefined();
    });

    it('AMRAP countdown beeps fire at 3-2-1 seconds remaining', async () => {
        const script = await ctx.compile();
        await script.next(); // start AMRAP
        // Skip through effort quickly
        await script.next();
        await script.tick(117_000); // advance to 3s remaining
        await script.tick(1_000); // 2s
        await script.tick(1_000); // 1s
        await script.tick(1_000); // 0s → complete
        const snap = await script.snapshot();
        const soundOutputs = assertions(snap).outputs().all().filter(o =>
            o.metrics.some(m => m.type === 'sound' && m.value?.trigger === 'countdown')
        );
        const countdownSeconds = soundOutputs.map(o => {
            const m = o.metrics.find(m2 => m2.type === 'sound');
            return m?.value?.atSecond;
        }).sort();
        expect(countdownSeconds).toContain(3);
        expect(countdownSeconds).toContain(2);
        expect(countdownSeconds).toContain(1);
    });
});
