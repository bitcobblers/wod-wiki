/**
 * State Transitions Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/state-transitions.md
 *
 * Covers Clock-Driven and User-Driven state transition scenarios,
 * step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 *   🔴 Expected to FAIL (RED) — behaviour is not yet implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance } from '@wod-wiki/lang-harness/script';
import { currentBlockTypeAsync, currentTimerElapsedMs, isTimerPaused } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟢 Pause / Resume
// Spec: state-transitions.md#-pause--resume-skip
// ===========================================================================
describeCompliance('🟢 Pause / Resume', '5:00 Run', (ctx) => {
    it('step 1: userNext → timer running', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockTypeAsync(script)).toMatch(/timer/i);
    });

    it('step 2: advanceClock(120_000) → elapsed = 120s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(120_000);
        expect(await currentTimerElapsedMs(script)).toBe(120_000);
    });

    it('step 3: simulateEvent("timer:pause") → timer paused', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(120_000);
        await script.userEvent('timer:pause');
        expect(await isTimerPaused(script)).toBe(true);
    });

    it('step 4: advanceClock(60_000) while paused → elapsed still 120s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(120_000);
        await script.userEvent('timer:pause');
        await script.tick(60_000);
        // Elapsed should still be 120s — paused time does not count
        expect(await currentTimerElapsedMs(script)).toBe(120_000);
    });

    it('step 5: simulateEvent("timer:resume") → timer resumes (no longer paused)', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(120_000);
        await script.userEvent('timer:pause');
        await script.tick(60_000);
        await script.userEvent('timer:resume');
        expect(await isTimerPaused(script)).toBe(false);
    });

    it('step 6: advanceClock(180_000) after resume → elapsed = 300s and timer expires', async () => {
        const script = await ctx.compile();
        await script.next();                          // start timer
        await script.tick(120_000);                   // run 120s
        await script.userEvent('timer:pause');        // pause at 120s
        await script.tick(60_000);                    // 60s of paused wall time
        await script.userEvent('timer:resume');       // resume
        await script.tick(180_000);                   // run 180s more → 120+180 = 300s = 5:00

        // Timer should have expired (stack empty — only SessionRoot was left and it auto-pops)
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Exact Boundary Expiry
// Spec: state-transitions.md#-exact-boundary-expiry
// ===========================================================================
describeCompliance('🟢 Exact Boundary Expiry', '1:00 Row', (ctx) => {
    it('step 1: userNext → timer running', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockTypeAsync(script)).toMatch(/timer/i);
    });

    it('step 2: advanceClock(60_000) → expires at exactly 60s, no overshoot', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Past-Boundary Expiry
// Spec: state-transitions.md#-past-boundary-expiry
// ===========================================================================
describeCompliance('🟢 Past-Boundary Expiry', '1:00 Row', (ctx) => {
    it('step 1: userNext → timer running', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockTypeAsync(script)).toMatch(/timer/i);
    });

    it('step 2: advanceClock(75_000) → expires, no error from overshooting by 15s', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(75_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Incremental vs. Bulk Advance
// Spec: state-transitions.md#-incremental-vs-bulk-advance
// ===========================================================================
describeCompliance('🟢 Incremental vs. Bulk Advance', '1:00 Row', (ctx) => {
    it('Test A: 10 × advanceClock(6_000) → timer expires after 10th advance', async () => {
        const script = await ctx.compile();
        await script.next();
        for (let i = 0; i < 10; i++) {
            await script.tick(6_000);
        }
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });

    it('Test B: 1 × advanceClock(60_000) → identical outcome to Test A', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 userNext on Effort → Parent Pushes Next Child
// Spec: state-transitions.md#-usernext-on-effort--parent-pushes-next-child
// ===========================================================================
describeCompliance('🟢 userNext on Effort → Parent Pushes Next Child', '(2)\n  10 Pullups\n  15 Pushups', (ctx) => {
    it('step 1: userNext → child 1 (Pullups) on stack', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockTypeAsync(script)).toMatch(/effort/i);
    });

    it('step 2: userNext → parent auto-pushes next child (Pushups)', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // Pushups auto-pushed
        expect(await currentBlockTypeAsync(script)).toMatch(/effort/i);
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThan(1);
    });
});

// ===========================================================================
// 🟢 userNext on Last Child → Round Increments
// Spec: state-transitions.md#-usernext-on-last-child--round-increments
// ===========================================================================
describeCompliance('🟢 userNext on Last Child → Round Increments', '(3)\n  10 Pullups', (ctx) => {
    it('step 1: userNext → R1 (Pullups)', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockTypeAsync(script)).toMatch(/effort/i);
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThan(0);
    });

    it('steps 1-4: 3 rounds cycle through and stack empties', async () => {
        const script = await ctx.compile();
        await script.next(); // R1
        await script.next(); // R2
        await script.next(); // R3
        await script.next(); // exhausted
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 userNext on Empty Stack — Graceful No-Op
// Spec: state-transitions.md#-usernext-on-empty-stack--graceful-no-op
// ===========================================================================
describeCompliance('🟢 userNext on Empty Stack — Graceful No-Op', '10 Pullups', (ctx) => {
    it('userNext on empty stack → no crash, depth stays 0', async () => {
        const script = await ctx.compile();
        await script.next(); // start
        await script.next(); // complete

        const s = await script.snapshot();
        expect(s.depth).toBe(0);

        // Extra userNext on empty stack — must not throw
        await expect(script.next()).resolves.toBe(script);

        const s2 = await script.snapshot();
        expect(s2.depth).toBe(0);
    });
});

// ===========================================================================
// 🟢 Rapid Double userNext
// Spec: state-transitions.md#-rapid-double-usernext
// ===========================================================================
describeCompliance('🟢 Rapid Double userNext', '10 Pullups\n15 Pushups', (ctx) => {
    it('step 1: userNext → Effort("Pullups") on stack', async () => {
        const script = await ctx.compile();
        await script.next();
        expect(await currentBlockTypeAsync(script)).toMatch(/effort/i);
    });

    it('step 2: second userNext → Pullups pops, Pushups pushed', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // Pushups
        expect(await currentBlockTypeAsync(script)).toMatch(/effort/i);
        const s = await script.snapshot();
        expect(s.depth).toBeGreaterThan(0);
    });

    it('step 3: third userNext immediately → clean termination, no duplicate pop', async () => {
        const script = await ctx.compile();
        await script.next(); // Pullups
        await script.next(); // Pushups
        await script.next(); // terminate
        const s = await script.snapshot();
        expect(s.depth).toBe(0);
    });
});
