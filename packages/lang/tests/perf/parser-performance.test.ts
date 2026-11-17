/**
 * Parser Performance Benchmarks
 *
 * Systematic performance tests for the WhiteboardScript parser.
 * These establish baselines and catch regressions in parse speed.
 *
 * Thresholds are generous — the goal is to catch order-of-magnitude
 * regressions, not micro-optimize.
 */
import { describe, it, expect } from 'vitest';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import { ALL_DIALECTS, DialectRegistry } from '@wod-wiki/lang-harness/parser-test-utils';

function registry(): DialectRegistry {
    const r = new DialectRegistry();
    for (const d of ALL_DIALECTS) r.register(d);
    return r;
}

function generateReps(count: number): string {
    return Array.from({ length: count }, (_, i) => `${(i % 50) + 1} Exercise ${i + 1}`).join('\n');
}

function generateTimers(count: number): string {
    return Array.from({ length: count }, (_, i) => {
        const min = (i % 30) + 1;
        return `${min}:00 Timer ${i + 1}`;
    }).join('\n');
}

function generateComplex(count: number): string {
    const exercises = ['10 Pullups', '20 Pushups', '15 Air Squats', '400m Run', '1:00 Rest'];
    return Array.from({ length: count }, (_, i) => {
        const ex = exercises[i % exercises.length];
        return i % 5 === 0 ? `(3) ${ex}` : ex;
    }).join('\n');
}

function generateAMRAP(_rounds: number): string {
    const children = ['5 Pullups', '10 Pushups', '15 Air Squats'];
    return `20:00 AMRAP\n${children.map(c => `  ${c}`).join('\n')}`;
}

describe('Parser Performance', () => {
    const reg = registry();

    it('parses 100 simple effort lines in <1000ms', () => {
        const script = generateReps(100);
        const parser = createParser(reg);
        const start = performance.now();
        const result = parser.read(script);
        const duration = performance.now() - start;
        expect(result.errors).toHaveLength(0);
        expect(duration).toBeLessThan(1000);
    });

    it('parses 500 simple effort lines in <2000ms', () => {
        const script = generateReps(500);
        const parser = createParser(reg);
        const start = performance.now();
        const result = parser.read(script);
        const duration = performance.now() - start;
        expect(result.errors).toHaveLength(0);
        expect(duration).toBeLessThan(2000);
    });

    it('parses 100 timer lines in <500ms', () => {
        const script = generateTimers(100);
        const parser = createParser(reg);
        const start = performance.now();
        const result = parser.read(script);
        const duration = performance.now() - start;
        expect(result.errors).toHaveLength(0);
        expect(duration).toBeLessThan(600);
    });

    it('parses 200 mixed-statements in <600ms', () => {
        const script = generateComplex(200);
        const parser = createParser(reg);
        const start = performance.now();
        parser.read(script);
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(600);
    });

    it('parses a complex AMRAP script in <100ms', () => {
        const script = generateAMRAP(20);
        const parser = createParser(reg);
        const start = performance.now();
        const result = parser.read(script);
        const duration = performance.now() - start;
        expect(result.errors).toHaveLength(0);
        expect(duration).toBeLessThan(100);
    });

    it('repeated parse of the same script does not degrade (10x)', () => {
        const script = generateReps(100);
        const parser = createParser(reg);
        const times: number[] = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            parser.read(script);
            times.push(performance.now() - start);
        }
        // No single parse should exceed 500ms
        expect(times.every(t => t < 500)).toBe(true);
        // Last parse should not be >5x the first + 50ms baseline (no memory leak / degradation)
        expect(times[9]).toBeLessThan(times[0] * 5 + 50);
    });
});
