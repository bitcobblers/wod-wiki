/**
 * Phase 4: EMOM (Chelsea) — Output Statement Integration Tests
 *
 * Validates that an EMOM (Every Minute On the Minute) workout
 * produces the correct output statements.
 *
 * Workout: Chelsea-style — (3) :60 EMOM 5 Pullups
 * Pattern: SessionRoot > WaitingToStart > EMOM(3×:60) > [exercises]×3
 *
 * Using 3 rounds instead of 30 for practical test execution.
 *
 * Key differences: Interval timer per round (countdown :60), resets each round.
 * Bounded rounds (unlike AMRAP).
 *
 * @see docs/planning-output-statements/emom.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('EMOM — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => {
        if (script) await script.dispose();
    });

    describe('3-round EMOM: (3) :60 EMOM 5 Pullups', () => {
        it('should start workout with correct initial stack', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');

            // SessionRoot + WaitingToStart
            const s0 = await script.snapshot();
            expect(s0.depth).toBe(2);

            // User starts
            await script.next();
            // WaitingToStart pops → EMOM pushed → first exercise pushed
            const s1 = await script.snapshot();
            expect(s1.depth).toBeGreaterThanOrEqual(2);
        });

        it('should complete after 3 rounds', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');
            await script.next(); // Start

            // Each round: exercise is active, timer runs for 60s.
            // When interval expires, TimerCompletionBehavior clears children
            // (auto-pops exercise) and resets timer. RoundAdvanceBehavior advances
            // the round, ChildLoopBehavior resets, ChildRunnerBehavior pushes next.
            for (let round = 0; round < 3; round++) {
                await script.tick(60000); // Interval expires → auto-advance
            }

            // After 3 rounds, RoundCompletionBehavior pops EMOM → session ends
            const s = await script.snapshot();
            expect(s.depth).toBe(0);
        });

        it('should emit paired outputs through completion', async () => {
            script = await TestScript.compile('(3) :60 EMOM\n  5 Pullups');
            await script.next(); // Start

            for (let round = 0; round < 3; round++) {
                await script.tick(60000); // Interval expires → auto-advance
            }

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });
    });
});
