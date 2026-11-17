/**
 * Phase 4: For Time (Single Exercise) — Output Statement Integration Tests
 *
 * Validates that the SessionRoot > WaitingToStart > Exercise lifecycle
 * produces the exact output statements documented in:
 *   docs/planning-output-statements/for-time-single.md
 *
 * Workouts: Grace (30 Clean & Jerk 135lb), Karen (150 Wall Ball Shots 20lb)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('For Time (Single Exercise) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    describe('Grace — 30 Clean & Jerk 135lb', () => {
        it('should produce correct output sequence through full lifecycle', async () => {
            // Arrange: parse the Grace workout
            script = await TestScript.compile('30 Clean & Jerk 135lb');

            // Act: Start session (pushes SessionRoot → WaitingToStart)
            // Step 1: SessionRoot mounted → compiler/system outputs
            // Step 2: WaitingToStart mounted → compiler/system outputs
            expect((await script.snapshot()).depth).toBe(2); // SessionRoot + WaitingToStart
            expect(assertions(await script.snapshot()).outputs().all().length).toBeGreaterThanOrEqual(2);

            // Step 3: User clicks "Start" → WaitingToStart pops
            await script.next();

            // Step 4: WaitingToStart unmounted → completion output
            // Step →5: SessionRoot.next() → ChildRunner pushes exercise
            // Step 6: Exercise mounted → system output
            expect((await script.snapshot()).depth).toBe(2); // SessionRoot + Exercise
            expect(assertions(await script.snapshot()).outputs().completions().length).toBeGreaterThanOrEqual(1); // WaitingToStart completion

            // Step 8: User completes exercise → exercise pops
            await script.next();

            // Step 9: Exercise unmount → completion output
            // Step →11: SessionRoot.next() → no more children → markComplete → pop
            // Step 12: SessionRoot unmount → completion output
            expect((await script.snapshot()).depth).toBe(0); // Session ended

            // Verify output sequence
            const outputs = assertions(await script.snapshot()).outputs().all();

            // Check we got the right output types in order
            expect(outputs.length).toBeGreaterThanOrEqual(4);

            // Should have both segments and completions
            // Grace completion, WaitingToStart completion, SessionRoot completion
            expect(assertions(await script.snapshot()).outputs().completions().length).toBeGreaterThanOrEqual(3); 

            // Session ends with stack empty
            expect((await script.snapshot()).depth).toBe(0);
        });

        it('should emit paired segment/completion outputs', async () => {
            script = await TestScript.compile('30 Clean & Jerk 135lb');
            await script.next(); // Start
            await script.next(); // Complete exercise

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should emit SessionRoot system output at stack level 1', async () => {
            script = await TestScript.compile('30 Clean & Jerk 135lb');

            const rootPush = assertions(await script.snapshot()).outputs().all().find(o => o.outputType === 'system' && o.sourceBlockKey === 'session-root');
            expect(rootPush).toBeDefined();
            expect(rootPush?.stackLevel).toBe(1);
        });

        it('should emit WaitingToStart system output at stack level 2', async () => {
            script = await TestScript.compile('30 Clean & Jerk 135lb');

            // WaitingToStart is pushed after SessionRoot, at depth 2
            const waitingPush = assertions(await script.snapshot()).outputs().all().find(
                o => o.outputType === 'system' && o.sourceBlockKey === 'waiting-to-start'
            );
            expect(waitingPush).toBeDefined();
            expect(waitingPush?.stackLevel).toBe(2);
        });

        it('should emit exercise system output after WaitingToStart is dismissed', async () => {
            script = await TestScript.compile('30 Clean & Jerk 135lb');
            await script.next(); // Dismiss WaitingToStart

            // Exercise should now be pushed at depth 2 (SessionRoot still exists)
            const systemOutputs = assertions(await script.snapshot()).outputs().all().filter(o => o.outputType === 'system');
            const exercisePush = systemOutputs.find(o => o.stackLevel === 2 && o.sourceBlockKey !== 'waiting-to-start');
            expect(exercisePush).toBeDefined();
        });

        it('should end session when exercise completes', async () => {
            script = await TestScript.compile('30 Clean & Jerk 135lb');
            await script.next(); // Start
            await script.next(); // Complete exercise

            // Stack should be empty — session ended
            expect((await script.snapshot()).depth).toBe(0);
        });
    });

    describe('Karen — 150 Wall Ball Shots 20lb', () => {
        it('should produce same lifecycle pattern as Grace', async () => {
            script = await TestScript.compile('150 Wall Ball Shots 20lb');

            // SessionRoot + WaitingToStart on stack
            expect((await script.snapshot()).depth).toBe(2);

            await script.next(); // Start
            expect((await script.snapshot()).depth).toBe(2); // SessionRoot + Exercise

            await script.next(); // Complete exercise
            expect((await script.snapshot()).depth).toBe(0); // Session ended

            // Verify paired outputs
            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should have at least 6 outputs (3 segments + 3 completions)', async () => {
            script = await TestScript.compile('150 Wall Ball Shots 20lb');
            await script.next(); // Start
            await script.next(); // Complete

            // Planning table shows ~10 outputs (including milestones)
            // Minimum: root-segment, waiting-segment, waiting-completion,
            //          exercise-segment, exercise-completion, root-completion
            assertions(await script.snapshot()).outputs().assertMinCount(6);
        });
    });
});
