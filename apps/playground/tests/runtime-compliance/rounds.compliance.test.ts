/**
 * Rounds Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/rounds.md
 *
 * Covers all Rounds scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { describe, it, expect } from 'bun:test';
import { TestScript, assertions, describeCompliance } from '@/testing/script';
import { MetricType, NextEvent } from '@bitcobblers/wod-wiki-engine';
import { getRoundState, blockDisplayMetrics } from '../helpers/compliance-helpers';

// ===========================================================================
// 🟢 Fixed Rounds — (3) 10 Pullups
// Spec: rounds.md#-fixed-rounds
// ===========================================================================
describeCompliance('🟢 Fixed Rounds — (3) 10 Pullups', '(3)\n  10 Pullups', (ctx) => {
    it('step 0: startSession → SessionRoot + WaitingToStart', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: first userNext starts round 1', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(1);
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.total).toBe(3);
        expect((await script.snapshot()).current?.blockType).toMatch(/effort/i);
    });

    it('step 2-3: userNext cycles through rounds 2 and 3', async () => {
        const script = await ctx.compile();
        await script.next(); // start r1
        await script.next(); // r1 done -> r2
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
        await script.next(); // r2 done -> r3
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(3);
    });

    it('step 4: final userNext terminates session', async () => {
        const script = await ctx.compile();
        await script.next(); // start r1
        await script.next(); // r1 done -> r2
        await script.next(); // r2 done -> r3
        await script.next(); // r3 done -> session end
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('child was pushed exactly 3 times (verified via tracer completions)', async () => {
        const script = await ctx.compile();
        await script.next(); // start r1
        await script.next(); // r2
        await script.next(); // r3
        await script.next(); // end
        
        // Filter for Pullups segments (have Rep metric)
        const pullupsSegments = assertions(await script.snapshot()).outputs().segments().filter(s =>
            [...s.metrics].some(m => m.type === MetricType.Rep)
        );
        expect(pullupsSegments).toHaveLength(3);
    });
});

// ===========================================================================
// 🟢 Rep Scheme Sequence — (21-15-9) Thrusters
// Spec: rounds.md#-rep-scheme-sequence
// ===========================================================================
describeCompliance('🟢 Rep Scheme Sequence — (21-15-9) Thrusters', '(21-15-9)\n  Thrusters', (ctx) => {
    it('round 1 has 21 reps', async () => {
        const script = await ctx.compile();
        await script.next();
        const reps = await blockDisplayMetrics(await script.snapshot()).find(m => m.type === MetricType.Rep);
        expect(reps?.value).toBe(21);
    });

    it('round 2 has 15 reps', async () => {
        const script = await ctx.compile();
        await script.next(); // r1
        await script.next(); // r2
        const reps = await blockDisplayMetrics(await script.snapshot()).find(m => m.type === MetricType.Rep);
        expect(reps?.value).toBe(15);
    });

    it('round 3 has 9 reps', async () => {
        const script = await ctx.compile();
        await script.next(); // r1
        await script.next(); // r2
        await script.next(); // r3
        const reps = await blockDisplayMetrics(await script.snapshot()).find(m => m.type === MetricType.Rep);
        expect(reps?.value).toBe(9);
    });

    it('session ends after 3 rounds', async () => {
        const script = await ctx.compile();
        await script.next(); // r1
        await script.next(); // r2
        await script.next(); // r3
        await script.next(); // end
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Single Round — (1) 10 Pullups
// Spec: rounds.md#-single-round
// ===========================================================================
describeCompliance('🟢 Single Round — (1) 10 Pullups', '(1)\n  10 Pullups', (ctx) => {
    it('completes after one userNext', async () => {
        const script = await ctx.compile();
        await script.next(); // start r1
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        await script.next(); // end
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Rounds with Multiple Children
// Spec: rounds.md#-rounds-with-multiple-children
// ===========================================================================
describeCompliance('🟢 Rounds with Multiple Children — (3) 10 Pullups / 15 Pushups', '(3)\n  10 Pullups\n  15 Pushups', (ctx) => {
    it('cycles through all children in each round', async () => {
        const script = await ctx.compile();
        await script.next(); // r1, child 1
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(1);
        expect((await script.snapshot()).current?.blockType).toMatch(/effort/i);
        
        await script.next(); // r1, child 2
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(1);
        
        await script.next(); // r1 done -> r2, child 1
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
    });

    it('presents correct exercises in order', async () => {
        const script = await ctx.compile();
        await script.next(); // r1 Pullups
        await script.next(); // r1 Pushups
        await script.next(); // r2 Pullups
        await script.next(); // r2 Pushups
        await script.next(); // r3 Pullups
        await script.next(); // r3 Pushups
        await script.next(); // end
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Large Round Count
// Spec: rounds.md#-large-round-count-skip
// ===========================================================================
describe('🟢 Large Round Count — (100) 5 Burpees', () => {
    it('compiles without error', async () => {
        const script = await TestScript.compile('(100)\n  5 Burpees');
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        await script.dispose();
    });

    it('10000 iterations complete without memory issues and within performance target', async () => {
        // Drive the runtime dispatch path directly instead of TestScript.next():
        // next() awaits a macrotask flush per call (~1ms under bun), which is
        // observation bookkeeping rather than runtime work and would dominate a
        // 20 000-iteration loop (~21s, blowing the test timeout). snapshot()
        // flushes deferred observers before the assertions below, so final
        // state is identical.
        const perf = await TestScript.compile('(20000)\n  5 Burpees');
        const dispatchNext = (): void =>
            perf.runtime.handle(new NextEvent(undefined, perf.runtime.nowProvider));

        dispatchNext(); // advance WaitingToStart → first child

        // Warm-up phase (un-timed): 10 000 rounds
        for (let i = 0; i < 10000; i++) {
            dispatchNext();
        }

        // Measured phase: 10 000 rounds must complete in < 500 ms
        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            dispatchNext();
        }
        const end = performance.now();

        expect((await perf.snapshot()).depth).toBe(0);
        expect(end - start).toBeLessThan(500); // 10,000 steady-state iterations in < 500ms
        await perf.dispose();
    });
});

// ===========================================================================
// 🟢 Rounds with Skippable Rest
// Spec: rounds.md#-rounds-with-skippable-rest
// ===========================================================================
describeCompliance('🟢 Rounds with Skippable Rest', '(3)\n  10 Pullups\n  15 Pushups\n  1:00 Rest', (ctx) => {
    it('step 3: rest is auto-pushed after pushups', async () => {
        const script = await ctx.compile();
        await script.next(); // start -> Pullups (R1)
        await script.next(); // Pullups done -> Pushups (R1)
        await script.next(); // Pushups done -> Rest (R1)
        
        // Rest should be on top
        expect((await script.snapshot()).current?.blockType).toMatch(/rest|timer/i);
    });

    it('step 4a: rest can be skipped via userNext', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups
        await script.next(); // Pushups
        await script.next(); // skip Rest
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
    });

    it('step 4b: rest can be waited out', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups
        await script.next(); // Pushups
        await script.tick(60_000);
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
    });
});

// ===========================================================================
// 🟢 Rounds with Forced Rest (Cannot Skip)
// Spec: rounds.md#-rounds-with-forced-rest-cannot-skip
// ===========================================================================
describeCompliance('🟢 Rounds with Forced Rest (Cannot Skip)', '(3)\n  10 Pullups\n  15 Pushups\n  *1:00 Rest', (ctx) => {
    it('userNext during forced rest is a no-op', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups
        await script.next(); // Pushups
        
        const depthBeforeSkip = (await script.snapshot()).depth;
        await script.next(); // attempt skip
        expect((await script.snapshot()).depth).toBe(depthBeforeSkip);
        expect((await script.snapshot()).current?.blockType).toMatch(/rest|timer/i);
    });

    it('rest auto-pops after timer expiry', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // Pullups
        await script.next(); // Pushups
        await script.tick(60_000);
        expect(await getRoundState(await script.snapshot(), 'Rounds')?.current).toBe(2);
    });

    it('final forced rest must also expire to end session', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        
        for (let r = 0; r < 3; r++) {
            await script.next(); // Pullups
            await script.next(); // Pushups
            if (r < 2) await script.tick(60_000); // Wait rest for R1, R2
        }
        
        // Now at final rest of R3
        expect((await script.snapshot()).current?.blockType).toMatch(/rest|timer/i);
        await script.next(); // skip attempt
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
        
        await script.tick(60_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});
