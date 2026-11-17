/**
 * Phase 4: Loop with Rest (Barbara) — Output Statement Integration Tests
 *
 * Validates that a multi-round workout with an explicit rest period
 * produces the correct output statements.
 *
 * Workout: Barbara (simplified) — (3) 10 Pullups / 15 Pushups / 1:00 Rest
 * Pattern: SessionRoot > WaitingToStart > Loop(3) > [exercises + rest]×3
 *
 * Using 3 rounds instead of 5 and fewer exercises for practical testing.
 *
 * Key differences from fixed-round-loop: includes a Rest segment as an
 * explicit child in the loop, producing a timer countdown child.
 *
 * @see docs/planning-output-statements/loop-with-rest.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('Loop-with-Rest — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => {
        if (script) await script.dispose();
    });

    describe('Barbara-style: (3) 10 Pullups / 15 Pushups / 1:00 Rest', () => {
        it('should start workout with correct initial stack', async () => {
            script = await TestScript.compile('(3)\n  10 Pullups\n  15 Pushups\n  1:00 Rest');

            // SessionRoot + WaitingToStart
            const s0 = await script.snapshot();
            expect(s0.depth).toBe(2);

            // User starts
            await script.next();

            // WaitingToStart pops → loop pushed → first exercise pushed
            const s1 = await script.snapshot();
            expect(s1.depth).toBeGreaterThanOrEqual(2);
        });

        it('should complete after 3 rounds of 3 children each', async () => {
            script = await TestScript.compile('(3)\n  10 Pullups\n  15 Pushups\n  1:00 Rest');
            await script.next(); // Start

            // Advance through 3 rounds of (Pullups, Pushups, Rest)
            // Rest uses an interval timer that auto-advances
            for (let round = 0; round < 3; round++) {
                await script.next(); // Pullups complete
                await script.next(); // Pushups complete
                // Rest timer is 1:00 — advance past it
                await script.tick(60000); // 1:00 Rest expires → auto-advance
            }

            const s = await script.snapshot();
            expect(s.depth).toBe(0);
        });

        it('should emit paired outputs through completion', async () => {
            script = await TestScript.compile('(3)\n  10 Pullups\n  15 Pushups\n  1:00 Rest');
            await script.next(); // Start

            // Advance through 3 rounds
            for (let round = 0; round < 3; round++) {
                await script.next(); // Pullups
                await script.next(); // Pushups
                await script.tick(60000); // Rest
            }

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should emit at least 20 output statements', async () => {
            script = await TestScript.compile('(3)\n  10 Pullups\n  15 Pushups\n  1:00 Rest');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await script.next(); // Pullups
                await script.next(); // Pushups
                await script.tick(60000); // Rest
            }

            // 3 rounds × 3 children × ~2 outputs each + session/loop outputs
            assertions(await script.snapshot()).outputs().assertMinCount(20);
        });
    });
});
