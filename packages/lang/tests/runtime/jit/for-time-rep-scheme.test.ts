/**
 * Phase 4: For Time Rep-Scheme (Fran) — Output Statement Integration Tests
 *
 * Validates that a rep-scheme loop (21-15-9) with multiple exercises
 * produces the correct output statements.
 *
 * Workout: Fran — (21-15-9) Thrusters 95lb / Pullups
 * Pattern: SessionRoot > WaitingToStart > Loop(21-15-9) > [Thrusters, Pullups]×3
 *
 * Key difference from fixed-round: rep count changes per round via repScheme metrics.
 *
 * @see docs/planning-output-statements/for-time-rep-scheme.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('For Time Rep-Scheme (Fran) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    describe('Fran — (21-15-9) Thrusters 95lb / Pullups', () => {
        /**
         * Advance through one complete round (2 exercises).
         */
        async function advanceOneRound() {
            await script.next(); // Thrusters complete
            await script.next(); // Pullups complete
        }

        it('should produce correct lifecycle through 3 rep-scheme rounds', async () => {
            script = await TestScript.compile('(21-15-9)\n  Thrusters 95lb\n  Pullups');

            // SessionRoot + WaitingToStart
            expect((await script.snapshot()).depth).toBe(2);

            // User starts
            await script.next();
            expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);

            // 3 rounds × 2 exercises = 6 next calls
            for (let round = 0; round < 3; round++) {
                await advanceOneRound();
            }

            // Session should be complete
            expect((await script.snapshot()).depth).toBe(0);
        });

        it('should emit paired segment/completion outputs', async () => {
            script = await TestScript.compile('(21-15-9)\n  Thrusters 95lb\n  Pullups');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await advanceOneRound();
            }

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should have outputs for all 3 rounds', async () => {
            script = await TestScript.compile('(21-15-9)\n  Thrusters 95lb\n  Pullups');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await advanceOneRound();
            }

            // root-segment + waiting pair + loop + 3×(2 exercises×2) = ~18 minimum
            assertions(await script.snapshot()).outputs().assertMinCount(16);
        });
    });
});
