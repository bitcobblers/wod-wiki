/**
 * Phase 4: AMRAP (Cindy) — Output Statement Integration Tests
 *
 * Validates that an AMRAP (As Many Rounds As Possible) workout
 * produces the correct output statements.
 *
 * Workout: Cindy — 20:00 AMRAP: 5 Pullups / 10 Pushups / 15 Air Squats
 * Pattern: SessionRoot > WaitingToStart > AMRAP(20:00) > [exercises]×N
 *
 * Key difference: Timer-terminated unbounded loop. Loop runs until
 * countdown timer expires. Round count is unbounded.
 *
 * @see docs/planning-output-statements/amrap.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('AMRAP (Cindy) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => {
        if (script) await script.dispose();
    });

    describe('Cindy — 20:00 AMRAP 5 Pullups / 10 Pushups / 15 Air Squats', () => {
        /**
         * Advance through one complete round (3 exercises).
         */
        async function advanceOneRound() {
            await script.next(); // Pullups complete
            await script.next(); // Pushups complete
            await script.next(); // Air Squats complete
        }

        it('should start workout with correct stack depth', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats');

            // SessionRoot + WaitingToStart
            const s0 = await script.snapshot();
            expect(s0.depth).toBe(2);

            // User starts
            await script.next();
            // WaitingToStart pops → AMRAP pushed → first exercise pushed
            const s1 = await script.snapshot();
            expect(s1.depth).toBeGreaterThanOrEqual(2);
        });

        it('should allow completing one full round', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats');
            await script.next(); // Start

            // Complete one round without time expiry
            await script.tick(60000); // 1 minute elapsed
            await advanceOneRound();

            // Should still be in the AMRAP (timer hasn't expired)
            // Stack should have SessionRoot + AMRAP + exercise
            const s = await script.snapshot();
            expect(s.depth).toBeGreaterThanOrEqual(2);
        });

        it('should terminate when timer expires during a round', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats');
            await script.next(); // Start

            // Complete 2 rounds (6 minutes simulated)
            await script.tick(180000); // 3 min
            await advanceOneRound();
            await script.tick(180000); // 6 min total
            await advanceOneRound();

            // Now expire the timer (advance to 20+ minutes).
            // TimerCompletionBehavior detects expiry → ClearChildrenAction
            // force-pops the active exercise → NextAction on AMRAP →
            // CompletedBlockPopBehavior pops AMRAP → session ends.
            await script.tick(840000); // 20 min total

            // Session should auto-terminate — no manual next() calls needed
            const s = await script.snapshot();
            expect(s.depth).toBe(0);
        });

        it('should emit paired outputs through completion', async () => {
            script = await TestScript.compile('20:00 AMRAP\n  5 Pullups\n  10 Pushups\n  15 Air Squats');
            await script.next(); // Start

            // Do one round, expire timer
            await script.tick(60000); // 1 min
            await advanceOneRound();
            await script.tick(1140000); // 20 min total — timer expires, auto-clears

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });
    });
});
