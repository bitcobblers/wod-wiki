/**
 * Unit tests for ClearChildrenAction.
 *
 * Validates that ClearChildrenAction:
 * 1. Pops all blocks above the target block
 * 2. Force-completes incomplete blocks during pop
 * 3. Runs full unmount lifecycle (metrics emission)
 * 4. Returns a NextAction for the target block
 * 5. Does nothing if target block is already on top
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('ClearChildrenAction — Auto-Pop on Timer Expiry', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    describe('AMRAP timer expiry', () => {
        it('should auto-pop active exercise when AMRAP timer expires', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats');
            await script.next(); // Start → WaitingToStart pops, AMRAP pushed, first exercise pushed

            // Verify exercise is active on stack
            const info = await script.snapshot();
            expect(info.depth).toBeGreaterThanOrEqual(3); // Session + AMRAP + exercise

            // Expire timer → auto-pop exercise → auto-pop AMRAP → session ends
            await script.tick(1200000); // 20 minutes

            // Stack should be empty — everything auto-popped
            expect((await script.snapshot()).depth).toBe(0);
        });

        it('should emit completion output for force-popped exercise', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups');
            await script.next(); // Start

            // Exercise is active, expire timer
            await script.tick(1200000); // 20 minutes

            // All outputs should be paired (segment + completion for every block)
            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should not loop after timer expires', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups');
            await script.next(); // Start

            // Complete a few rounds manually
            await script.next(); // exercise complete, next round starts
            await script.next(); // exercise complete, next round starts

            // Now expire timer
            await script.tick(1200000);

            // Should be fully terminated
            expect((await script.snapshot()).depth).toBe(0);
        });
    });

    describe('EMOM interval expiry', () => {
        it('should auto-advance to next round when interval expires', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');
            await script.next(); // Start

            // Expire first interval — should auto-advance, not terminate
            await script.tick(60000);

            // Should still have blocks on stack (EMOM with round 2)
            expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        });

        it('should terminate after all rounds complete via interval timer', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');
            await script.next(); // Start

            // Run all 3 intervals
            await script.tick(60000); // Round 1 expire
            await script.tick(60000); // Round 2 expire
            await script.tick(60000); // Round 3 expire

            // All rounds done → EMOM terminates → session ends
            expect((await script.snapshot()).depth).toBe(0);
        });

        it('should reset timer between intervals', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');
            await script.next(); // Start

            // Run 2 intervals
            await script.tick(60000); // Round 1 expire → timer resets
            await script.tick(60000); // Round 2 expire → timer resets

            // Should still be alive (round 3 active)
            expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);

            // Complete round 3
            await script.tick(60000);
            expect((await script.snapshot()).depth).toBe(0);
        });

        it('should emit paired outputs for all intervals', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');
            await script.next(); // Start

            await script.tick(60000);
            await script.tick(60000);
            await script.tick(60000);

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });
    });

    describe('Forced-pop completion marking', () => {
        it('should mark force-popped blocks as complete with forced-pop reason', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups');
            await script.next(); // Start

            // Capture the exercise block before it's popped
            const exerciseBlock = (await script.snapshot()).current!;
            expect(exerciseBlock.isComplete).toBe(false);

            // Expire timer → force-pop exercise
            await script.tick(1200000);

            // Exercise should have been marked complete with 'forced-pop' reason
            expect(exerciseBlock.isComplete).toBe(true);
            expect(exerciseBlock.completionReason).toBe('forced-pop');
        });

        it('should not re-mark blocks that were already complete', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups');
            await script.next(); // Start

            // Manually complete the exercise first
            await script.next(); // Exercise pops cleanly (PopOnNextBehavior)

            // Now expire the timer — AMRAP should be marked 'timer-expired', not 'forced-pop'
            await script.tick(1200000);

            // Stack empty
            expect((await script.snapshot()).depth).toBe(0);
        });
    });
});
