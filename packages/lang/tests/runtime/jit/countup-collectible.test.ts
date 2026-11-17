/**
 * Count-up and Collectible Timer — Output Statement Integration Tests
 *
 * Validates that count-up override (^), collectible timer (:?),
 * and collectible metrics produce correct output statements.
 *
 * @see docs/whiteboard-language/core-syntax.md
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TestScript, assertions } from '@wod-wiki/lang-harness/script';

describe('Count-up Override (^5:00 Row) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('should produce paired outputs on manual completion', async () => {
        script = await TestScript.compile('^5:00 Row');
        await script.next(); // start
        await script.tick(180_000); // 3 minutes elapsed
        await script.next(); // complete

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('should emit segment and completion for the timer block', async () => {
        script = await TestScript.compile('^5:00 Row');
        await script.next();
        await script.tick(180_000);
        await script.next();

        const outputs = assertions(await script.snapshot()).outputs().all();
        expect(outputs.length).toBeGreaterThanOrEqual(2);
    });

    it('should end with stack empty after manual completion', async () => {
        script = await TestScript.compile('^5:00 Row');
        await script.next();
        await script.tick(300_000); // 5 minutes (duration target)
        await script.next();

        expect((await script.snapshot()).depth).toBe(0);
    });
});

describe('Collectible Timer (:? Sprint) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('should produce paired outputs when manually completed', async () => {
        script = await TestScript.compile(':? Sprint');
        await script.next(); // start
        await script.tick(45_000); // 45 seconds elapsed
        await script.next(); // complete

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('should emit at least segment + completion outputs', async () => {
        script = await TestScript.compile(':? Sprint');
        await script.next();
        await script.tick(45_000);
        await script.next();

        const outputs = assertions(await script.snapshot()).outputs().all();
        expect(outputs.length).toBeGreaterThanOrEqual(2);
    });
});

describe('Collectible Reps (? Pushups) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('should produce paired outputs on manual completion', async () => {
        script = await TestScript.compile('? Pushups');
        await script.next(); // start effort
        await script.next(); // complete effort

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('should emit effort segment and completion', async () => {
        script = await TestScript.compile('? Pushups');
        await script.next();
        await script.next();

        const outputs = assertions(await script.snapshot()).outputs().all();
        expect(outputs.length).toBeGreaterThanOrEqual(2);
    });
});

describe('Collectible Reps in Timed Context (10:00 ? KB Snatch 24kg) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('should produce paired outputs when timer expires', async () => {
        script = await TestScript.compile('10:00 ? KB Snatch 24kg');
        await script.next(); // start
        await script.tick(600_000); // 10 minutes

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('should end with stack empty after timer expiry', async () => {
        script = await TestScript.compile('10:00 ? KB Snatch 24kg');
        await script.next();
        await script.tick(600_000);

        expect((await script.snapshot()).depth).toBe(0);
    });
});

describe('Parenthesized Protocol (20:00 (AMRAP)) — Output Statements', () => {
    let script: TestScript;

    afterEach(async () => { if (script) await script.dispose(); });

    it('should produce paired outputs when AMRAP timer expires', async () => {
        script = await TestScript.compile('20:00 (AMRAP)\n  5 Pullups\n  10 Pushups');
        await script.next(); // start
        await script.tick(1_200_000); // 20 minutes

        const unpaired = assertions(await script.snapshot()).outputs().assertPairedOutputs();
        expect(unpaired).toEqual([]);
    });

    it('should end with stack empty after timer expiry', async () => {
        script = await TestScript.compile('20:00 (AMRAP)\n  5 Pullups\n  10 Pushups');
        await script.next();
        await script.tick(1_200_000);

        expect((await script.snapshot()).depth).toBe(0);
    });
});
