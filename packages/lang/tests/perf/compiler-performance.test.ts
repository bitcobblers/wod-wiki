/**
 * Compiler Performance Benchmarks
 *
 * Systematic performance tests for the JIT compiler + session runtime.
 * These test the compile → start → run lifecycle at various scales.
 */
import { describe, it, expect } from 'vitest';
import { TestScript } from '@wod-wiki/lang-harness/script';

function generateRounds(roundCount: number, exercises: number): string {
    const exNames = ['Pushups', 'Pullups', 'Air Squats', 'Burpees', 'Situps'];
    const children = Array.from({ length: exercises }, (_, i) =>
        `  ${(i % 20) + 5} ${exNames[i % exNames.length]}`
    ).join('\n');
    return `(${roundCount})\n${children}`;
}

function generateSuperset(exercises: number): string {
    const exNames = ['Pushups', 'Pullups', 'Air Squats', 'Burpees', 'Situps'];
    return Array.from({ length: exercises }, (_, i) =>
        `+ ${(i % 20) + 5} ${exNames[i % exNames.length]}`
    ).join('\n');
}

describe('Compiler + Runtime Performance', () => {
    it('compiles and starts a simple effort in <250ms', async () => {
        const start = performance.now();
        const script = await TestScript.compile('10 Pushups');
        const duration = performance.now() - start;
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect(duration).toBeLessThan(250);
        await script.dispose();
    });

    it('compiles and starts a 10-round loop in <300ms', async () => {
        const text = generateRounds(10, 3);
        const start = performance.now();
        const script = await TestScript.compile(text);
        const duration = performance.now() - start;
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect(duration).toBeLessThan(300);
        await script.dispose();
    });

    it('compiles and starts a 50-round loop in <1000ms', async () => {
        const text = generateRounds(50, 3);
        const start = performance.now();
        const script = await TestScript.compile(text);
        const duration = performance.now() - start;
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect(duration).toBeLessThan(1000);
        await script.dispose();
    });

    it('runs 5 rounds of 3 exercises through completion in <1000ms', async () => {
        const text = generateRounds(5, 3);
        const script = await TestScript.compile(text);
        const start = performance.now();
        // Start
        await script.next();
        // 5 rounds × 3 exercises
        for (let r = 0; r < 5; r++) {
            for (let e = 0; e < 3; e++) {
                await script.next();
            }
        }
        const duration = performance.now() - start;
        expect((await script.snapshot()).depth).toBe(0);
        expect(duration).toBeLessThan(1000);
        await script.dispose();
    });

    it('compiles an AMRAP with timer expiry in <300ms total', async () => {
        const text = '2:00 AMRAP\n  5 Pushups\n  10 Situps';
        const start = performance.now();
        const script = await TestScript.compile(text);
        await script.next(); // start
        await script.next(); // Pushups
        await script.next(); // Situps
        await script.tick(120_000); // timer expires
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(300);
        await script.dispose();
    });

    it('compiles a grouped superset in <250ms', async () => {
        const text = generateSuperset(5);
        const start = performance.now();
        const script = await TestScript.compile(text);
        const duration = performance.now() - start;
        expect((await script.snapshot()).depth).toBeGreaterThanOrEqual(2);
        expect(duration).toBeLessThan(250);
        await script.dispose();
    });
});
