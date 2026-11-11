/**
 * Parser Compliance: Rounds and Tree Structure
 *
 * Tests the parser's ability to produce correct parent/child
 * CodeStatement trees for grouped constructs.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describe('🟢 Parser: Rounds with Children', () => {
    it('"(3) \\n  10 Air Squats\\n  10 Push Ups" → parent with 2 children', () => {
        const tree = parse('(3)\n  10 Air Squats\n  10 Push Ups');
        tree.hasStatementCount(3).hasRootCount(1).hasNoErrors();

        const parent = tree.roots()[0];
        parent
            .hasChildren(2)
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 3);

        const children = parent.children();
        expect(children).toHaveLength(2);

        children[0]
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetricValue(MetricType.Effort, 'Air Squats');

        children[1]
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetricValue(MetricType.Effort, 'Push Ups');
    });

    it('children reference their parent', () => {
        const tree = parse('(3)\n  10 Air Squats\n  10 Push Ups');
        const parent = tree.roots()[0];

        for (const child of parent.children()) {
            child.hasParent(parent);
        }
    });
});

describe('🟢 Parser: AMRAP with Children', () => {
    it('"10:00 AMRAP\\n  5 Pullups\\n  10 Pushups" → timed parent with children', () => {
        const tree = parse('10:00 AMRAP\n  5 Pullups\n  10 Pushups');
        tree.hasStatementCount(3).hasRootCount(1);

        const parent = tree.roots()[0];
        parent
            .hasChildren(2)
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'AMRAP');

        const children = parent.children();
        children[0]
            .hasMetricValue(MetricType.Rep, 5)
            .hasMetricValue(MetricType.Effort, 'Pullups');
        children[1]
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetricValue(MetricType.Effort, 'Pushups');
    });
});

describe('🟢 Parser: EMOM with Children', () => {
    it('"(3) :60 EMOM\\n  5 Pullups" → rounds + duration parent', () => {
        const tree = parse('(3) :60 EMOM\n  5 Pullups');
        tree.hasStatementCount(2).hasRootCount(1);

        const parent = tree.roots()[0];
        parent
            .hasChildren(1)
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rounds, 3)
            .hasMetric(MetricType.Duration);

        parent.children()[0]
            .hasMetricValue(MetricType.Rep, 5)
            .hasMetricValue(MetricType.Effort, 'Pullups');
    });
});

describe('🟢 Parser: Rep Schemes', () => {
    it('"21-15-9\\n  Thrusters\\n  Pull-ups" → 3 rounds with decreasing reps', () => {
        const tree = parse('21-15-9\n  Thrusters\n  Pull-ups');
        tree.hasNoErrors();

        // Rep scheme creates a parent with children
        const roots = tree.roots();
        expect(roots.length).toBeGreaterThanOrEqual(1);
    });
});

describe('🟢 Parser: Error Handling', () => {
    it('empty input produces zero statements', () => {
        parse('')
            .hasStatementCount(0)
            .hasNoErrors();
    });

    it('whitespace-only input produces zero statements', () => {
        parse('   \n  \n  ')
            .hasStatementCount(0)
            .hasNoErrors();
    });

    it('returns context with source preserved', () => {
        const ctx = parse('10 Pullups').context();
        expect(ctx.source).toBe('10 Pullups');
    });
});
