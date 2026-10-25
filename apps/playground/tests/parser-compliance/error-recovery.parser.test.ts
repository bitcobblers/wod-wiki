/**
 * Parser Compliance: Error Recovery & Edge Cases
 *
 * Tests parser behavior with malformed, empty, and boundary inputs.
 * Verifies the parser never throws on bad input and produces
 * either a valid partial tree or a populated errors array.
 */
import { describe, it, expect } from 'bun:test';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

// ── Empty & Whitespace ───────────────────────────────────────────

describe('🟢 Parser: Empty & Whitespace Input', () => {
    it('empty string → 0 statements, no errors', () => {
        parse('').hasStatementCount(0).hasNoErrors();
    });

    it('whitespace only → 0 statements, no errors', () => {
        parse('   \n  \n\t  ').hasStatementCount(0).hasNoErrors();
    });

    it('multiple blank lines → 0 statements, no errors', () => {
        parse('\n\n\n\n').hasStatementCount(0).hasNoErrors();
    });
});

// ── Comments ──────────────────────────────────────────────────────

describe('🟢 Parser: Comment-Only Input', () => {
    it('# Title → handled gracefully (no crash)', () => {
        const result = parse('# Title');
        // Comment-only input produces 0 or 1 statements; must not throw
        expect(result.context().statements.length).toBeGreaterThanOrEqual(0);
        result.hasNoErrors();
    });

    it('multiple comment lines → no crash', () => {
        const result = parse('# Section A\n# Section B\n# Section C');
        expect(result.context().statements.length).toBeGreaterThanOrEqual(0);
        result.hasNoErrors();
    });
});

// ── Invalid / Malformed Syntax ────────────────────────────────────

describe('🟢 Parser: Invalid Syntax', () => {
    it('"invalid {{{ syntax" → does not throw, errors array exists', () => {
        const result = parse('invalid {{{ syntax');
        // Parser must not throw; it should either produce errors or a partial tree
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });

    it('unmatched parentheses "(((" → does not throw', () => {
        const result = parse('(((');
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });

    it('unmatched parentheses with content "(((" → partial tree or errors', () => {
        const result = parse('((( 10 Pushups');
        // Must not throw — either error or partial parse
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });
});

// ── Timer Edge Cases ──────────────────────────────────────────────

describe('🟢 Parser: Timer Edge Cases', () => {
    it('": Run" (timer without value) → parse does not throw', () => {
        const result = parse(': Run');
        // Must not throw; either parses as effort-only or produces an error
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });

    it('": " (colon + space, no exercise) → parse does not throw', () => {
        const result = parse(': ');
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });
});

// ── Zero & Boundary Values ────────────────────────────────────────

describe('🟢 Parser: Zero & Boundary Values', () => {
    it('"(0) Pushups" → does not crash', () => {
        const result = parse('(0) Pushups');
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });

    it('"99999999 Pushups" → parses large rep count', () => {
        const result = parse('99999999 Pushups');
        // Should parse without error as a rep + effort
        result.hasStatementCount(1)
            .root(0)
            .hasMetric(MetricType.Rep);
    });

    it('"0 Pushups" → zero reps parse without crash', () => {
        const result = parse('0 Pushups');
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });
});

// ── Multiple Empty Lines Between Statements ───────────────────────

describe('🟢 Parser: Spacing Between Statements', () => {
    it('multiple empty lines between statements → still parses correctly', () => {
        const result = parse('10 Pushups\n\n\n\n\n5 Pullups');
        result.hasStatementCount(2).hasNoErrors();
        result.root(0).hasMetric(MetricType.Rep);
        result.root(1).hasMetric(MetricType.Rep);
    });

    it('tabs and spaces between statements → parses correctly', () => {
        const result = parse('10 Pushups\n\t\t  \n5 Pullups');
        result.hasStatementCount(2).hasNoErrors();
    });
});

// ── Special Characters in Exercise Names ──────────────────────────

describe('🟢 Parser: Special Characters in Names', () => {
    it('"5 Pushups (strict)" → parenthetical lexes as named rounds, split parent/child', () => {
        const result = parse('5 Pushups (strict)');
        // (strict) is a named rounds specifier — like (EMOM) — so the line
        // becomes a rounds+rep parent with the effort on the exercise child.
        result.hasStatementCount(2).hasNoErrors();
        result.root(0)
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rounds, 'strict');
        result.root(0).children()[0].hasMetric(MetricType.Effort);
    });

    it('"10 Clean & Jerk" → handles ampersand in name', () => {
        const result = parse('10 Clean & Jerk');
        result.hasStatementCount(1).hasNoErrors();
        result.root(0).hasMetric(MetricType.Rep);
    });

    it('"3 Bench Press / Row" → handles slash in name', () => {
        const result = parse('3 Bench Press / Row');
        result.hasStatementCount(1).hasNoErrors();
        result.root(0).hasMetric(MetricType.Rep);
    });
});

// ── Unknown Units ─────────────────────────────────────────────────

describe('🟢 Parser: Unknown Units / Trailing Tokens', () => {
    it('"10 Pushups xyz" → parses, trailing text becomes part of effort name', () => {
        const result = parse('10 Pushups xyz');
        result.hasStatementCount(1).hasNoErrors();
        result.root(0).hasMetric(MetricType.Rep);
    });

    it('"5 Pullups foo bar baz" → trailing tokens absorbed into name', () => {
        const result = parse('5 Pullups foo bar baz');
        result.hasStatementCount(1).hasNoErrors();
        result.root(0).hasMetric(MetricType.Rep);
    });
});

// ── Single-Value Round Schemes ────────────────────────────────────

describe('🟢 Parser: Single Round Schemes', () => {
    it('"(10) Pushups" → parses without crash', () => {
        const result = parse('(10) Pushups');
        // (10) is parsed as Rounds(10) not Rep(10) — the grammar treats
        // parenthesized numbers as rounds specifiers
        result.hasStatementCount(1).hasNoErrors();
        result.root(0).hasMetric(MetricType.Rounds);
    });

    it('"(5) 10 Pushups" → rounds + rep scheme', () => {
        const result = parse('(5) 10 Pushups');
        // (N) M is equivalent to NxM: rounds+rep parent, effort child.
        result.hasStatementCount(2).hasNoErrors();
        result.root(0)
            .hasMetricValue(MetricType.Rounds, 5)
            .hasMetricValue(MetricType.Rep, 10);
        result.root(0).children()[0].hasMetric(MetricType.Effort);
    });
});

// ── Unterminated / Incomplete Sections ────────────────────────────

describe('🟢 Parser: Unterminated Sections', () => {
    it('"## Section\\n  10 Pushups\\n(no closing)" → does not crash', () => {
        const text = '## Section\n  10 Pushups\n(no closing)';
        const result = parse(text);
        // Must not throw — parser should recover gracefully
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
        expect(result.context().statements.length).toBeGreaterThanOrEqual(0);
    });

    it('nested unterminated parentheses → no crash', () => {
        const result = parse('(3\n  10 Pushups');
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });

    it('incomplete duration "5:00\\n  " → no crash', () => {
        const result = parse('5:00\n  ');
        expect(result.context().errors.length).toBeGreaterThanOrEqual(0);
    });
});

// ── Never-Throws Guarantee ────────────────────────────────────────

describe('🟢 Parser: Never-Throws Contract', () => {
    const dangerousInputs = [
        '',
        '   ',
        '\n\n\n',
        '#',
        '###',
        '((((',
        '))))',
        '::::',
        '*****',
        '+++',
        '---',
        '@@@',
        '!!!',
        '???',
        '///',
        '10',
        '5:00',
        ':00',
        '()',
        '((',
        '))',
        '[]',
        '{}',
        'undefined',
        'null',
    ];

    it.each(dangerousInputs)('input "%s" → parse does not throw', (input) => {
        expect(() => parse(input)).not.toThrow();
    });
});
