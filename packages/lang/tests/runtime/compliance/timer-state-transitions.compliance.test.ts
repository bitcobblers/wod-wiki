/**
 * Timer State Transitions Compliance Tests
 *
 * Covers pause/resume, boundary expiry, and state transitions
 * for count-up, collectible, and interval timer patterns.
 */
import { it, expect } from 'vitest';
import { describeCompliance } from '@wod-wiki/lang-harness/script';
import { currentTimerElapsedMs, isTimerPaused } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟡 Pause / Resume — Count-up Override (^5:00 Row)
// Spec: state-transitions.md#-pause--resume-skip
// ===========================================================================
describeCompliance('🟡 Pause / Resume — Count-up Override (^5:00 Row)', '^5:00 Row', (ctx) => {

    it('timer starts running and reports elapsed time', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);

        const elapsed = await currentTimerElapsedMs(script);
        expect(elapsed).toBeGreaterThanOrEqual(60_000);
    });

    it('pause event stops elapsed time accumulation', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);

        await script.userEvent('timer:pause');
        expect(await isTimerPaused(script)).toBe(true);

        await script.tick(60_000);
        const elapsed = await currentTimerElapsedMs(script);
        expect(elapsed).toBeGreaterThanOrEqual(60_000);
        expect(elapsed).toBeLessThan(90_000);
    });

    it('resume event resumes elapsed time accumulation', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);

        await script.userEvent('timer:pause');
        await script.tick(60_000); // paused period

        await script.userEvent('timer:resume');
        await script.tick(30_000);

        const elapsed = await currentTimerElapsedMs(script);
        expect(elapsed).toBeGreaterThanOrEqual(90_000);
    });

    it('manual completion after pause/resume ends session', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await script.userEvent('timer:pause');
        await script.tick(60_000);
        await script.userEvent('timer:resume');
        await script.tick(30_000);
        await script.next();

        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟡 Pause / Resume — Collectible Timer (:? Sprint)
// ===========================================================================
describeCompliance('🟡 Pause / Resume — Collectible Timer (:? Sprint)', ':? Sprint', (ctx) => {

    it('timer starts running and reports elapsed time', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(30_000);

        const elapsed = await currentTimerElapsedMs(script);
        expect(elapsed).toBeGreaterThanOrEqual(30_000);
    });

    it('pause event stops elapsed accumulation', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(30_000);

        await script.userEvent('timer:pause');
        await script.tick(30_000); // should not count

        const elapsed = await currentTimerElapsedMs(script);
        expect(elapsed).toBeGreaterThanOrEqual(30_000);
        expect(elapsed).toBeLessThan(50_000);
    });

    it('resume event resumes accumulation and completes correctly', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(30_000);
        await script.userEvent('timer:pause');
        await script.tick(30_000); // paused period
        await script.userEvent('timer:resume');
        await script.tick(15_000);

        // Before completion, elapsed should include running + pre-pause time
        const elapsed = await currentTimerElapsedMs(script);
        expect(elapsed).toBeGreaterThanOrEqual(45_000);

        await script.next(); // complete
        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟡 Boundary Expiry — EMOM Interval
// ===========================================================================
describeCompliance('🟡 Boundary Expiry — EMOM Interval', '(3) :60 EMOM\n  5 Pullups', (ctx) => {

    it('child auto-pops exactly at :60 boundary', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);

        const state = await script.snapshot();
        expect(state.depth).toBeGreaterThan(0);
    });

    it('past-boundary tick still advances to next round', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(65_000); // 5 seconds past boundary

        const state = await script.snapshot();
        expect(state.depth).toBeGreaterThan(0);
    });

    it('bulk advance through all 3 intervals completes session', async () => {
        const script = await ctx.compile();
        await script.next();
        // 3 rounds × 1 child × 60s = 3 ticks
        for (let i = 0; i < 3; i++) {
            await script.tick(60_000);
        }

        expect((await script.snapshot()).depth).toBe(0);
    });
});

// ===========================================================================
// 🟡 Rapid userNext on Timer — Count-up and Collectible
// ===========================================================================
describeCompliance('🟡 Rapid userNext — Count-up Timer (^5:00 Row)', '^5:00 Row', (ctx) => {

    it('rapid double userNext does not corrupt stack', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(10_000);
        await script.next(); // complete
        await script.next(); // no-op on empty stack

        expect((await script.snapshot()).depth).toBe(0);
    });
});

describeCompliance('🟡 Rapid userNext — Collectible Timer (:? Sprint)', ':? Sprint', (ctx) => {

    it('rapid double userNext does not corrupt stack', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.tick(10_000);
        await script.next(); // complete
        await script.next(); // no-op on empty stack

        expect((await script.snapshot()).depth).toBe(0);
    });
});
