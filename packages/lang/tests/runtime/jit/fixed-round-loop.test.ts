/**
 * Phase 4: Fixed-Round Loop (Helen) — Output Statement Integration Tests
 *
 * Validates that a fixed-round loop with multiple exercises
 * produces the correct output statements.
 *
 * Workout: Helen — (3) 400m Run / 21 KB Swings 53lb / 12 Pullups
 * Pattern: SessionRoot > WaitingToStart > Loop(3) > [Run, KB Swings, Pullups]×3
 *
 * @see docs/planning-output-statements/fixed-round-loop.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('Fixed-Round Loop (Helen) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    describe('Helen — (3) 400m Run / 21 KB Swings / 12 Pullups', () => {
        /**
         * Helper to advance through one complete round of Helen.
         * Each round has 3 exercises that need to be manually advanced.
         */
        async function advanceOneRound() {
            await script.next(); // Exercise 1 (Run) complete
            await script.next(); // Exercise 2 (KB Swings) complete
            await script.next(); // Exercise 3 (Pullups) complete
        }

        it('should produce correct lifecycle through 3 rounds', async () => {
            script = await TestScript.compile('(3)\n  400m Run\n  21 KB Swings 53lb\n  12 Pullups');

            // SessionRoot + WaitingToStart
            expect((await script.snapshot()).depth).toBe(2);

            // User starts — WaitingToStart pops, Loop block pushed
            await script.next();
            expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2); // SessionRoot + Loop (+ possibly first exercise)

            // Advance through 3 rounds (3 exercises × 3 rounds = 9 userNext calls)
            for (let round = 0; round < 3; round++) {
                // At start of each round, we need to advance through 3 exercises
                await advanceOneRound();
            }

            // After 3 rounds, loop should be complete → SessionRoot should pop
            expect((await script.snapshot()).depth).toBe(0);
        });

        it('should emit paired segment/completion outputs across all rounds', async () => {
            script = await TestScript.compile('(3)\n  400m Run\n  21 KB Swings 53lb\n  12 Pullups');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await advanceOneRound();
            }

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should have many outputs across 3 rounds', async () => {
            script = await TestScript.compile('(3)\n  400m Run\n  21 KB Swings 53lb\n  12 Pullups');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await advanceOneRound();
            }

            // At minimum: root-segment + waiting pair + loop-segment/completion +
            // 3 rounds × 3 exercises × 2 (segment+completion) = ~24
            assertions(await script.snapshot()).outputs().assertMinCount(20);
        });

        it('should end with stack empty', async () => {
            script = await TestScript.compile('(3)\n  400m Run\n  21 KB Swings 53lb\n  12 Pullups');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await advanceOneRound();
            }

            expect((await script.snapshot()).depth).toBe(0);
        });
    });
});
