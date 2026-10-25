/**
 * Parser Compliance: Metrics Edge Cases
 *
 * Tests metric parsing for weight formats, distance variants, rep schemes,
 * group markers, forced timers, and metric origins.
 */
import { describe, it, expect } from 'bun:test';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

// ── Weight / Resistance Formats ──────────────────────────────────

describe('🟢 Parser: Weight Formats', () => {
    it('"5x5 Back Squat @ 225 lb" → Rounds+Rep parent, Effort + Resistance child', () => {
        const tree = parse('5x5 Back Squat @ 225 lb');
        // Inline NxM splits into a rounds parent and an exercise child
        // (docs/language/syntax-reference.md, "Inline Strength Sets").
        tree.hasStatementCount(2);
        tree.roots()[0]
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rep, 5);
        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Back Squat')
            .hasMetric(MetricType.Resistance);
    });

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

// ── Distance Variants ────────────────────────────────────────────

describe('🟢 Parser: Distance Formats', () => {
    it('"1 mile Run" → Distance + Effort', () => {
        parse('1 mile Run')
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('"2km Row" → Distance + Effort (compact)', () => {
        parse('2km Row')
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasMetricValue(MetricType.Effort, 'Row');
    });
});

// ── Rep Schemes ───────────────────────────────────────────────────

describe('🟢 Parser: Rep Schemes', () => {
    it('"21-15-9" → multiple Rep+Effort pairs (no Rounds wrapper)', () => {
        const root = parse('21-15-9').roots()[0];
        const reps = root.raw().rawMetrics.filter(m => m.type === MetricType.Rep);
        expect(reps.length).toBeGreaterThanOrEqual(1);
    });

    it('"5x5 Squat" → Rounds+Rep parent, Effort child (set/rep notation)', () => {
        const tree = parse('5x5 Squat');
        tree.hasStatementCount(2);
        tree.roots()[0]
            .hasMetric(MetricType.Rounds)
            .hasMetricValue(MetricType.Rep, 5);
        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Squat');
    });
});
// ── Group Markers (+ / - prefix) ──────────────────────────────────

describe('🟢 Parser: Group Markers (Lap Primitives)', () => {
    it('"+ 5 Pullups" → compose group marker on child', () => {
        const tree = parse('(3)\n  + 5 Pullups\n  + 10 Pushups');
        tree.hasStatementCount(3);

        const children = tree.roots()[0].children();
        // Children with + prefix get a 'compose' Group metric
        children[0].hasGroupMarker('compose');
        children[1].hasGroupMarker('compose');
    });

    it('children with + prefix are grouped together', () => {
        const tree = parse('(3)\n  + 5 Pullups\n  + 10 Pushups');
        const parent = tree.roots()[0];

        // groupChildrenByLap puts compose children in the same group
        const childGroups = parent.raw().children;
        expect(childGroups).toHaveLength(1); // Both + children in one group
        expect(childGroups[0]).toHaveLength(2);
    });

    it('"- 5 Pullups" → round group marker on child', () => {
        const tree = parse('(3)\n  - 5 Pullups\n  - 10 Pushups');
        const children = tree.roots()[0].children();
        children[0].hasGroupMarker('round');
        children[1].hasGroupMarker('round');
    });

    it('children without prefix get no Group metric', () => {
        const tree = parse('(3)\n  5 Pullups\n  10 Pushups');
        const children = tree.roots()[0].children();
        // No group marker — children are each their own group
        const raw = children[0].raw().rawMetrics;
        const hasGroup = raw.some(m => m.type === MetricType.Group);
        expect(hasGroup).toBe(false);
    });
});

// ── Forced Timer (* prefix) ───────────────────────────────────────

describe('🟢 Parser: Required Timer Hint (* prefix)', () => {
    it('"*5:00 Run" → behavior.required_timer hint', () => {
        parse('*5:00 Run')
            .roots()[0]
                .isRequiredTimer()
                .hasMetric(MetricType.Duration)
                .hasMetric(MetricType.Effort)
                .hasMetricValue(MetricType.Effort, 'Run');
    });

    it('"5:00 Run" (no *) → no required_timer hint', () => {
        parse('5:00 Run')
            .roots()[0]
                .hasMetric(MetricType.Duration)
                .lacksHint('behavior.required_timer');
    });

    it('"*:30 Rest" → required_timer + Duration', () => {
        parse('*:30 Rest')
            .roots()[0]
                .isRequiredTimer()
                .hasMetric(MetricType.Duration);
    });
});

// ── Metric Origins ────────────────────────────────────────────────

describe('🟢 Parser: Metric Origins', () => {
    it('parser metrics have origin "parser"', () => {
        const root = parse('10 Pullups').roots()[0];
        root
            .hasMetricOrigin(MetricType.Rep, 'parser')
            .hasMetricOrigin(MetricType.Effort, 'parser');
    });

    it('dialect hints have origin "dialect"', () => {
        const root = parse('Strength').roots()[0];
        root.hasMetricOrigin(MetricType.Hint, 'dialect');
    });

    it('required_timer hint has origin "parser"', () => {
        parse('*5:00 Run')
            .roots()[0]
                .hasMetricOrigin(MetricType.Hint, 'parser');
    });
});
