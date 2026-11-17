/**
 * Phase 4: Sequential Timers — Output Statement Integration Tests
 *
 * Validates that a flat sequence of independent timer/effort blocks
 * produces the correct output statements.
 *
 * Workouts: Simple & Sinister style (multiple timed segments)
 * Pattern: SessionRoot > WaitingToStart > Timer1 > Timer2 > ...
 *
 * @see docs/planning-output-statements/sequential-timers.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('Sequential Timers — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => {
        if (script) await script.dispose();
    });

    describe('Two-segment workout: 5:00 Run / 1:00 Rest', () => {
        it('should produce correct lifecycle through full session', async () => {
            script = await TestScript.compile('5:00 Run\n1:00 Rest');

            // SessionRoot + WaitingToStart on stack
            const s0 = await script.snapshot();
            expect(s0.depth).toBe(2);

            // User starts
            await script.next();
            // WaitingToStart pops → first exercise pushed
            const s1 = await script.snapshot();
            expect(s1.depth).toBe(2); // SessionRoot + Timer(5:00 Run)

            // User advances past first segment
            await script.next();
            // Timer(5:00) pops → Rest(1:00) pushed
            const s2 = await script.snapshot();
            expect(s2.depth).toBe(2); // SessionRoot + Rest(1:00)

            // User advances past rest
            await script.next();
            // Rest pops → no more children → SessionRoot pops
            const s3 = await script.snapshot();
            expect(s3.depth).toBe(0);
        });

        it('should emit paired segment/completion outputs', async () => {
            script = await TestScript.compile('5:00 Run\n1:00 Rest');
            await script.next(); // Start
            await script.next(); // Complete first
            await script.next(); // Complete rest

            const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should have at least 8 outputs (4 segments + 4 completions)', async () => {
            script = await TestScript.compile('5:00 Run\n1:00 Rest');
            await script.next();
            await script.next();
            await script.next();

            // root-segment, waiting-segment, waiting-completion,
            // timer1-segment, timer1-completion,
            // timer2-segment, timer2-completion,
            // root-completion
            assertions(await script.snapshot()).outputs().assertMinCount(8);
        });
    });

    describe('Three-segment workout: Run / Rest / Turkish Getups', () => {
        it('should sequence three children correctly', async () => {
            script = await TestScript.compile(
                '5:00 100 KB Swings 70lb\n1:00 Rest\n10:00 10 Turkish Getups 70lb'
            );

            const s0 = await script.snapshot();
            expect(s0.depth).toBe(2); // Root + WaitingToStart

            await script.next(); // Start → first exercise
            const s1 = await script.snapshot();
            expect(s1.depth).toBe(2);

            await script.next(); // Complete first → push rest
            const s2 = await script.snapshot();
            expect(s2.depth).toBe(2);

            await script.next(); // Complete rest → push TGU
            const s3 = await script.snapshot();
            expect(s3.depth).toBe(2);

            await script.next(); // Complete TGU → session ends
            const s4 = await script.snapshot();
            expect(s4.depth).toBe(0);

            const unpaired = assertions(s4).outputs().assertPairedOutputs();
            expect(unpaired).toEqual([]);
        });

        it('should have at least 10 outputs for 3-child session', async () => {
            script = await TestScript.compile(
                '5:00 100 KB Swings 70lb\n1:00 Rest\n10:00 10 Turkish Getups 70lb'
            );
            await script.next(); // Start
            await script.next(); // KB Swings done
            await script.next(); // Rest done
            await script.next(); // TGU done

            // root + waiting + 3 children × 2 + root completion = 10 minimum
            assertions(await script.snapshot()).outputs().assertMinCount(10);
        });
    });
});
