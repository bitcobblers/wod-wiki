/**
 * Collectible Metrics Compliance Tests
 *
 * Covers patterns where the athlete records a value during execution
 * (reps, weight, distance) rather than following a prescribed value.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🟡 Potentially borderline — implementation may differ
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance } from '@wod-wiki/lang-harness/script';
import { currentBlockType, anySystemPopHasReason, blockDisplayMetrics } from '@wod-wiki/lang-harness/compliance-helpers';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

// ===========================================================================
// 🟡 Collectible Reps — ? Pushups
// Spec: core-syntax.md#modifiers
//
// The ? placeholder on reps means the athlete chooses/fills in the count.
// No timer is involved — purely user-driven effort block.
// ===========================================================================
describeCompliance('🟡 Collectible Reps — ? Pushups', '? Pushups', (ctx) => {

    it('step 0: startSession → depth = 2 (SessionRoot + WaitingToStart)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Effort block is active', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockType(await script.snapshot())).toMatch(/effort/i);
    });

    it('effort with collectible reps has no prescribed rep count in display', async () => {
        const script = await ctx.compile();
        await script.next();
        const metrics = blockDisplayMetrics(await script.snapshot());
        const repMetric = metrics.find(m => m.type === MetricType.Rep);
        // Rep metric may be present as a placeholder or absent entirely
        expect(repMetric?.value).toBeUndefined();
    });

    it('step 2: userNext → completes effort, session ends', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('completion carries completionReason = "user-advance"', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.next();
        expect(await anySystemPopHasReason(await script.snapshot(), 'user-advance')).toBe(true);
    });
});

// ===========================================================================
// 🟡 Collectible Reps in Timed Context — 10:00 ? KB Snatch 24kg
// Spec: core-syntax.md#worked-examples
//
// A time-capped effort where the athlete records reps completed.
// Timer counts down; rep count is collected.
// ===========================================================================
describeCompliance('🟡 Collectible Reps in Timed Context — 10:00 ? KB Snatch 24kg', '10:00 ? KB Snatch 24kg', (ctx) => {

    it('step 0: startSession → depth = 2', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext → Timer/Effort block starts', async () => {
        const script = await ctx.compile();
        await script.next();
        const type = await currentBlockType(await script.snapshot());
        expect(type).toMatch(/timer|effort/i);
    });

    it('timer counts down from 10:00', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(300_000); // 5 minutes
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });

    it('timer expires at 10:00, session ends automatically', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(600_000); // 10 minutes
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('timer expiry carries completionReason = "timer-expired"', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(600_000);
        expect(await anySystemPopHasReason(await script.snapshot(), 'timer-expired')).toBe(true);
    });
});

// ===========================================================================
// 🟡 Collectible Reps with Weight — 10:00 ? KB Snatch ?kg
// Spec: core-syntax.md#modifiers
//
// Both reps and weight are athlete-chosen values.
// ===========================================================================
describeCompliance('🟡 Collectible Reps & Weight — 10:00 ? KB Snatch ?kg', '10:00 ? KB Snatch ?kg', (ctx) => {

    it('step 1: userNext → Timer/Effort block starts', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await script.snapshot()).depth).toBeGreaterThan(0);
    });

    it('timer expires at 10:00, session ends', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(600_000);
        expect((await script.snapshot()).depth).toBe(0);
    });
});
