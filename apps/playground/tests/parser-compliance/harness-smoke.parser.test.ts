/**
 * Smoke test: verify the parser-test-utils harness compiles and parses correctly.
 */
import { describe, it, expect } from 'vitest';
import { parse, createParserContext } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describe('Parser Test Harness — smoke', () => {
    it('parses empty input with no errors', () => {
        parse('').hasStatementCount(0).hasNoErrors();
    });

    it('parses a single effort with metrics', () => {
        const tree = parse('10 Pullups');
        tree.hasStatementCount(1).hasRootCount(1).hasNoErrors();

        tree.roots()[0]
            .isLeaf()
            .isRoot()
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pullups');
    });

    it('parses a timer with duration', () => {
        const tree = parse('5:00 Run');
        tree.hasStatementCount(1);

        tree.roots()[0]
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('creates context with dialect registry', () => {
        const ctx = createParserContext('10 Pullups');
        expect(ctx.source).toBe('10 Pullups');
        expect(ctx.statements).toHaveLength(1);
        expect(ctx.errors).toHaveLength(0);
    });

    it('creates context with empty dialects (pure parser)', () => {
        const ctx = createParserContext('400m Run', { dialects: [] });
        const root = ctx.statements[0];

        // Parser emits Distance metric
        expect(root.hasMetric(MetricType.Distance)).toBe(true);

        // No dialect hints applied
        expect(root.rawMetrics.filter(m => m.type === MetricType.Hint)).toHaveLength(0);
    });
});
