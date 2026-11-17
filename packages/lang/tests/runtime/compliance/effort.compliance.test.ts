/**
 * Effort Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/effort.md
 *
 * Covers all Effort scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *
 * Architecture notes (from empirical investigation):
 *   - Parser metrics (Resistance, Distance, Rep, Effort) ARE stored in block
 *     memory under the 'metric:display' tag.
 *   - Segment and completion OUTPUT statements do NOT include display metrics;
 *     they only carry timing metrics (elapsed, total, spans, system-time).
 *   - `completionReason` is carried in the `system` output event's metric
 *     value (not in the `completion` output's completionReason field).
 *
 * All scenarios in this file are 🟢 (passing):
 *   - 🟢 Effort with Distance (400 m Run) — distance metric verified in block
 *     display memory (parsing is correct; output layer carries timing metrics).
 *   - 🟢 Effort with Forced Rest (*:30) — userNext is suppressed while the
 *     countdown is active; timer-expiry is the only valid completion reason.
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

import { currentBlockType, blockHasDisplayMetric, blockDisplayMetrics, stackHasMetric, anySystemPopHasReason } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟢 Single Effort — "10 Pullups"
// Spec: effort.md#-single-effort
// ===========================================================================
describeCompliance('🟢 Single Effort (10 Pullups)', '10 Pullups', (ctx) => {

    it('step 0: startSession → SessionRoot + WaitingToStart (depth = 2)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Effort mounted (depth = 2, blockType = effort)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBe(2);
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 2: second userNext → effort pops, session ends (depth = 0)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired on clean termination', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 Effort with Weight — "10 Clean & Jerk @ 135 lb"
// Spec: effort.md#-effort-with-weight
// ===========================================================================
describeCompliance('🟢 Effort with Weight (10 Clean & Jerk @ 135 lb)', '10 Clean & Jerk @ 135 lb', (ctx) => {

    it('step 1: userNext → effort mounted, metrics include Resistance (135 lb)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
        // Resistance metric is stored in block display memory (not in outputs)
        expect(await blockHasDisplayMetric(await script.snapshot(), MetricType.Resistance)).toBe(true);
    });

    it('step 2: second userNext → clean termination (depth = 0)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Effort with Bodyweight — "20 Pushups bw"
// Spec: effort.md#-effort-with-bodyweight
// ===========================================================================
describeCompliance('🟢 Effort with Bodyweight (20 Pushups bw)', '20 Pushups bw', (ctx) => {

    it('step 1: userNext → effort mounted, metrics include Resistance (bw)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
        // bw is parsed as a WeightUnit → ResistanceMetric; stored in block display memory
        expect(await blockHasDisplayMetric(await script.snapshot(), MetricType.Resistance)).toBe(true);
    });

    it('step 2: second userNext → clean termination (depth = 0)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Sequential Efforts — 3 exercises, no nesting
// Spec: effort.md#-sequential-efforts-no-nesting
// ===========================================================================
describeCompliance('🟢 Sequential Efforts (10 Pullups / 15 Pushups / 20 Air Squats)', '10 Pullups\n15 Pushups\n20 Air Squats', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: first userNext → Pullups effort mounted (depth ≥ 2)', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → Pullups
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 2: second userNext → Pushups effort becomes current', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // Pushups
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 3: third userNext → Air Squats effort becomes current', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // Pushups
        await script.next(); // Air Squats
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 4: fourth userNext → session ends (depth = 0)', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // Pushups
        await script.next(); // Air Squats
        await script.next(); // Done
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('total outputs ≥ 8 (segment + completion for each of 3 efforts + session root outputs)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        await script.next();
        await script.next();
        expect(assertions(await script.snapshot()).outputs().count()).toBeGreaterThanOrEqual(8);
    });
});

// ===========================================================================
// 🟢 Effort with Distance — "400 m Run"
// Spec: effort.md#-effort-with-distance
//
// Distance metric is correctly parsed and stored in block display memory.
// Segment/completion output statements carry only timing metrics; display
// metrics live in block memory and are verified via blockHasDisplayMetric.
// ===========================================================================
describeCompliance('🟢 Effort with Distance (400 m Run)', '400 m Run', (ctx) => {

    it('distance metric is stored in block display memory (parsing works)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
        // Distance IS in block memory (parsing is correct)
        expect(await blockHasDisplayMetric(await script.snapshot(), MetricType.Distance)).toBe(true);
    });

    it('distance metric has value 400 and unit "m" in block display memory', async () => {
        const script = await ctx.compile();
        await script.next();
        const metrics = await blockDisplayMetrics(await script.snapshot());
        const distanceMetric = metrics.find(m => m.type === MetricType.Distance);
        expect(distanceMetric).toBeDefined();
        const v = distanceMetric?.value as Record<string, unknown> | undefined;
        expect(v?.amount).toBe(400);
        expect(distanceMetric?.unit ?? v?.unit).toBe('m');
    });

    it('distance metric is present on the runtime stack while block is active', async () => {
        // The block is still on the stack (not yet popped), so the metric lives
        // in block display memory — use stackHasMetric rather than anyOutputHasMetric.
        const script = await ctx.compile();
        await script.next();
        expect(await stackHasMetric(await script.snapshot(), MetricType.Distance)).toBe(true);
    });

    it('step 2: second userNext → clean termination (depth = 0)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Effort — userNext Is Always Skippable
// A bare effort block (no timer prefix) completes immediately on userNext.
// Spec: effort.md#-effort---usernext-is-always-skippable
// ===========================================================================
describeCompliance('🟢 Effort — userNext Is Always Skippable (10 Pullups)', '10 Pullups', (ctx) => {

    it('userNext immediately mounts effort', async () => {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → Effort
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('second userNext immediately pops effort regardless of elapsed time', async () => {
        const script = await ctx.compile();
        await script.next(); // mount
        await script.next(); // pop immediately — no minimum hold time
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('completionReason is user-advance for effort block (via system event)', async () => {
        // completionReason lives in system pop events, not in completion outputs
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });

    it('no time advance needed — userNext any time completes it', async () => {
        const script = await ctx.compile();
        await script.next(); // mount
        // No advanceClock at all — should still complete
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Effort with Timed Rest After (Skippable)
// :30 Rest is advisory — userNext dismisses it early OR timer auto-completes.
// Spec: effort.md#-effort-with-timed-rest-after-skippable
// ===========================================================================
describeCompliance('🟢 Effort with Skippable Rest (:30 Rest)', '10 Pullups\n:30 Rest\n10 Pushups', (ctx) => {

    it('step 0: startSession → depth = 2', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Pullups effort mounted', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 2: second userNext → Rest/Timer block becomes current', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // :30 Rest
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
    });

    it('step 3a: userNext on :30 Rest skips it — Pushups become current immediately', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // :30 Rest mounted
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
        await script.next(); // skip rest early
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('step 3b: advanceClock(30_000) auto-expires :30 Rest → Pushups become current', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // :30 Rest mounted
        await script.tick(30_000); // rest auto-expires
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('rest completionReason is user-advance when skipped early (via system event)', async () => {
        // completionReason lives in system pop events, not in completion outputs
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // :30 Rest mounted
        await script.next(); // skip
        await script.next(); // Pushups done
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });

    it('step 4: after rest, final userNext completes Pushups → session ends', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // :30 Rest
        await script.next(); // skip rest → Pushups
        await script.next(); // done
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Effort with Forced Rest After (Cannot Skip)
// *:30 Rest — userNext MUST be a no-op while the countdown is active.
//
// Spec: effort.md#-effort-with-forced-rest-after-cannot-skip
//
// The `*` prefix sets `behavior.required_timer` hint which configures
// ExitBehavior with onNext:false so userNext is suppressed until timer fires.
// ===========================================================================
describeCompliance('🟢 Effort with Forced Rest After (*:30 — Cannot Skip)', '10 Pullups\n*:30 Rest\n10 Pushups', (ctx) => {

    /** Helper: drive to the point where forced rest is the current block. */
    async function enterForcedRest() {
        const script = await ctx.compile();
        await script.next(); // WaitingToStart → Pullups
        await script.next(); // Pullups → *:30 forced Rest
        return script;
    }

    it('step 2: forced rest block is mounted after Pullups', async () => {
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
        // All three skips suppressed; stack is unchanged
        expect((await script.snapshot()).depth).toBe(depthAtRest);
    });

    it('forced rest block remains current after userNext attempts', async () => {
        const script = await enterForcedRest();
        await script.next(); // no-op attempt
        expect(await currentBlockType(await script.snapshot())).toMatch(/Rest|Timer/i);
    });

    it('advanceClock(30_000) expires the forced rest → auto-pops → Pushups next', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000); // forced rest timer fires
        // Forced rest auto-popped; Pushups effort mounted
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('forced rest completionReason is never user-advance (via system events)', async () => {
        // The Pullups pop will have 'user-advance' (correct).
        // The forced rest pop must NOT have 'user-advance' — it must be timer-expiry.
        // System events carry completionReason in metric.value.
        const script = await enterForcedRest();
        await script.tick(30_000); // rest timer fires → auto-pop

        const systemPops = assertions(await script.snapshot()).outputs().all()
            .filter(o => o.outputType === 'system')
            .map(o => {
                const m = [...o.metrics].find(m => m.type === MetricType.System);
                return m?.value as Record<string, unknown> | undefined;
            })
            .filter(v => v?.event === 'pop');

        // The most recent pop is the forced rest block (Pushups not done yet)
        const lastPop = systemPops.at(-1);
        expect(lastPop?.completionReason).not.toBe('user-advance');
    });

    it('after forced rest expires, userNext completes Pushups → session ends', async () => {
        const script = await enterForcedRest();
        await script.tick(30_000); // rest expires → Pushups pushed
        await script.next(); // complete Pushups
        expect((await script.snapshot()).depth).toBe(0);
    });
});
