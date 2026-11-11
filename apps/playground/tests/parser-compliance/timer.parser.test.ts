/**
 * Parser Compliance: Timer Statements
 *
 * Tests the parser's ability to produce correct CodeStatement trees
 * for timer-based whiteboard language constructs.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

describe('🟢 Parser: Countdown Timer', () => {
    it('"5:00 Run" → Duration + Effort', () => {
        parse('5:00 Run')
            .hasStatementCount(1)
            .hasNoErrors()
            .roots()[0]
                .hasMetric(MetricType.Duration)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('":30 Plank" → Duration + Effort (short format)', () => {
        parse(':30 Plank')
            .hasStatementCount(1)
            .roots()[0]
                .hasMetric(MetricType.Duration)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Plank');
    });

    it('"20:00" → Duration only (bare timer)', () => {
        parse('20:00')
            .hasStatementCount(1)
            .roots()[0]
                .hasMetric(MetricType.Duration);
    });
});

describe('🟢 Parser: Action (Bracket Syntax)', () => {
    it('"[:Rest]" → Action metric', () => {
        parse('[:Rest]')
            .hasStatementCount(1)
            .roots()[0]
                .hasMetric(MetricType.Action)
                .hasMetricValue(MetricType.Action, 'Rest');
    });

    it('"[: Rest]" → Action metric (space variant)', () => {
        parse('[: Rest]')
            .hasStatementCount(1)
            .roots()[0]
                .hasMetric(MetricType.Action)
                .hasMetricValue(MetricType.Action, 'Rest');
    });
});

describe('🟢 Parser: Forced Timer', () => {
    it('"*5:00 Run" → Duration + Effort with forced marker', () => {
        const root = parse('*5:00 Run').roots()[0];
        root
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('"*:30 Rest" → Duration + Effort with forced marker', () => {
        const root = parse('*:30 Rest').roots()[0];
        root
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Rest');
    });
});

describe('🟢 Parser: Sequential Timers', () => {
    it('"5:00 Run / 3:00 Row" → 2 root statements', () => {
        parse('5:00 Run\n3:00 Row')
            .hasStatementCount(2)
            .hasRootCount(2);
    });
});
