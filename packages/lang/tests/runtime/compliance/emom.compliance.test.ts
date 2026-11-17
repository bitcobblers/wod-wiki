/**
 * EMOM Compliance Tests
 *
 * Based on: docs/finishline/compliance-scenarios/emom.md
 *
 * Covers all EMOM scenarios, step-by-step, matching the spec tables.
 *
 * Legend:
 *   🟢 Expected to pass — behaviour is fully implemented
 */
import { it, expect } from 'vitest';
import { describeCompliance, assertions } from '@wod-wiki/lang-harness/script';
import { getRoundState, anyOutputHasMetric } from '@wod-wiki/lang-harness/compliance-helpers';

// ===========================================================================
// 🟢 Basic EMOM — 3 Rounds
// (3) :60 EMOM  5 Pullups
// Spec: docs/finishline/compliance-scenarios/emom.md#-basic-emom--3-rounds
// ===========================================================================
describeCompliance('🟢 Basic EMOM — 3 Rounds', '(3) :60 EMOM\n  5 Pullups', (ctx) => {
    it('step 0: startSession → SessionRoot + WaitingToStart (depth = 2)', async () => {
        const script = await ctx.compile();
        expect((await script.snapshot()).depth).toBe(2);
    });

    it('step 1: userNext starts EMOM and pushes 1st exercise (R1)', async () => {
        const script = await ctx.compile();
        await script.next();
        // WaitingToStart popped; EMOM block + first exercise now on stack
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(3);
        const emomBlock = (await script.snapshot()).blocks.find(b => b.blockType === 'EMOM');
        expect(emomBlock).toBeDefined();
    });

    it('step 1: round counter initialises at 1', async () => {
        const script = await ctx.compile();
        await script.next();
        expect((await getRoundState(await script.snapshot(), 'EMOM'))?.current).toBe(1);
        expect((await getRoundState(await script.snapshot(), 'EMOM'))?.total).toBe(3);
    });

    it('step 2: advanceClock(60_000) → R1 timer expires, child auto-pops, R2 starts', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        // EMOM still on stack, round 2 in progress
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect((await getRoundState(await script.snapshot(), 'EMOM'))?.current).toBe(2);
    });

    it('step 3: advanceClock(60_000) → R2 expires, R3 starts', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000); // R1
        await script.tick(60_000); // R2
        expect((await getRoundState(await script.snapshot(), 'EMOM'))?.current).toBe(3);
    });

    it('step 4: advanceClock(60_000) → R3 expires → rounds exhausted → session ends', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000); // R1
        await script.tick(60_000); // R2
        await script.tick(60_000); // R3
        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs are paired (segment + completion) through 3 timer-driven rounds', async () => {
        const script = await ctx.compile();
        await script.next();
        await script.tick(60_000);
        await script.tick(60_000);
        await script.tick(60_000);
        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });
});

// ===========================================================================
// 🟢 EMOM — Overrun Scenario
// (3) :30 EMOM  10 Heavy Deadlifts
// Timer is authoritative — auto-pops child if user has not called next.
// Spec: docs/finishline/compliance-scenarios/emom.md#-emom--overrun-scenario-skip
// ===========================================================================
describeCompliance('🟢 EMOM — Overrun Scenario', '(3) :30 EMOM\n  10 Heavy Deadlifts', (ctx) => {
    it('timer auto-pops child when :30 expires without user calling next', async () => {
        const script = await ctx.compile();
        await script.next(); // Start session — R1 child mounted

        // Do NOT call userNext — simulate overrun: 30s elapses before user acts
        await script.tick(30_000); // R1 interval expires

        // EMOM must still be alive and on round 2 (child was auto-popped)
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect((await getRoundState(await script.snapshot(), 'EMOM'))?.current).toBe(2);
    });

    it('round advances even if exercise was not "completed" by user', async () => {
        const script = await ctx.compile();
        await script.next();

        // R1: user never calls next → timer forces advancement
        await script.tick(30_000);

        // Round must have advanced to 2
        expect((await getRoundState(await script.snapshot(), 'EMOM'))?.current).toBe(2);
    });

    it('no stuck state — timer is authoritative through all 3 rounds', async () => {
        const script = await ctx.compile();
        await script.next();

        // Never call userNext — let timers drive everything
        await script.tick(30_000); // R1 expires
        await script.tick(30_000); // R2 expires
        await script.tick(30_000); // R3 expires → EMOM done → session ends

        expect((await script.snapshot()).depth).toBe(0);
    });

    it('all outputs paired even when child is auto-popped via overrun', async () => {
        const script = await ctx.compile();
        await script.next();

        await script.tick(30_000);
        await script.tick(30_000);
        await script.tick(30_000);

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('force-popped child has completionReason "forced-pop"', async () => {
        const script = await ctx.compile();
        await script.next(); // R1 child mounted

        // Capture the child block before the timer auto-pops it
        const childBlock = (await script.snapshot()).current!;

        await script.tick(30_000); // timer fires → child auto-popped

        // The child should have been marked complete with the forced-pop reason
        expect(childBlock.isComplete).toBe(true);
        expect((childBlock as unknown as { completionReason: string }).completionReason).toBe('forced-pop');
    });

    it('EMOM continues to next round after overrun, new child is pushed for R2', async () => {
        const script = await ctx.compile();
        await script.next();

        await script.tick(30_000); // R1 overrun → auto-advance → R2 child pushed

        // A new child block should now be on the stack
        const topBlock = (await script.snapshot()).current;
        expect(topBlock).toBeDefined();
        // The EMOM block is still present below the child
        const emomBlock = (await script.snapshot()).blocks.find(b => b.blockType === 'EMOM');
        expect(emomBlock).toBeDefined();
    });
});


// ===========================================================================
// 🟢 Sound Cues — EMOM Timer
// Spec: timer.md#sound-cues
// ===========================================================================
describeCompliance('🟢 Sound Cues — EMOM Timer (3 rounds)', '(3) :60 EMOM\n  5 Pullups', (ctx) => {

    it('EMOM completion emits a "timer-complete" sound output', async () => {
        const script = await ctx.compile();
        await script.next(); // start EMOM → first child
        await script.next(); // complete child
        await script.tick(60_000); // R1 timer expires → R2
        await script.next(); // complete child
        await script.tick(60_000); // R2 expires → R3
        await script.next(); // complete child
        await script.tick(60_000); // R3 expires → session ends
        const snap = await script.snapshot();
        expect(anyOutputHasMetric(snap, 'sound')).toBe(true);
        const soundOutputs = assertions(snap).outputs().all().filter(o =>
            o.metrics.some(m => m.type === 'sound')
        );
        const completeSounds = soundOutputs.filter(o =>
            o.metrics.some(m => m.value?.trigger === 'complete')
        );
        // At least one timer-complete sound should be emitted (for the final round at minimum)
        expect(completeSounds.length).toBeGreaterThan(0);
    });

    it('EMOM countdown beeps fire during interval countdown', async () => {
        const script = await ctx.compile();
        await script.next(); // start EMOM → first child
        await script.next(); // complete child early
        // Now waiting for interval timer. Advance to last 3 seconds.
        await script.tick(57_000); // 3s remaining
        await script.tick(1_000); // 2s remaining
        await script.tick(1_000); // 1s remaining
        await script.tick(1_000); // 0s → complete
        const snap = await script.snapshot();
        const countdownSounds = assertions(snap).outputs().all().filter(o =>
            o.metrics.some(m => m.type === 'sound' && m.value?.trigger === 'countdown')
        );
        const countdownSeconds = countdownSounds.map(o => {
            const m = o.metrics.find(m2 => m2.type === 'sound');
            return m?.value?.atSecond;
        }).sort();
        expect(countdownSeconds).toContain(3);
        expect(countdownSeconds).toContain(2);
        expect(countdownSeconds).toContain(1);
    });
});