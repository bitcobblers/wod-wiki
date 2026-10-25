/**
 * Parser Compliance: Effort Statements
 *
 * Tests the parser's ability to produce correct CodeStatement trees
 * for effort-based whiteboard language constructs.
 */
import { describe, it, expect } from 'bun:test';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describe('🟢 Parser: Single Effort', () => {
    it('"10 Pullups" → Rep + Effort metrics', () => {
        parse('10 Pullups')
            .hasStatementCount(1)
            .hasRootCount(1)
            .hasNoErrors()
            .roots()[0]
                .isLeaf()
                .isRoot()
                .hasMetric(MetricType.Rep)
                .hasMetricValue(MetricType.Rep, 10)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Pullups');
    });

    it('"20 Pushups bw" → Rep + Effort + bodyweight Resistance', () => {
        parse('20 Pushups bw')
            .roots()[0]
                .hasMetric(MetricType.Rep)
                .hasMetricValue(MetricType.Rep, 20)
                .hasMetricValue(MetricType.Effort, 'Pushups')
                .hasMetric(MetricType.Resistance);
    });

    it('"400m Run" → Distance + Effort metrics', () => {
        parse('400m Run')
            .hasStatementCount(1)
            .hasNoErrors()
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Run');
    });
});

describe('🟢 Parser: Effort with Weight', () => {
    it('"10 Clean & Jerk @ 135 lb" → Rep + Effort + Resistance', () => {
        const root = parse('10 Clean & Jerk @ 135 lb').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Clean & Jerk')
            .hasMetric(MetricType.Resistance);
    });
});

describe('🟢 Parser: Sequential Efforts', () => {
    it('"10 Pullups / 15 Pushups" → 2 root statements', () => {
        parse('10 Pullups\n15 Pushups')
            .hasStatementCount(2)
            .hasRootCount(2);
    });
});
