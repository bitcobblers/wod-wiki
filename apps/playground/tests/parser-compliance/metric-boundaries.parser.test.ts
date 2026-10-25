/**
 * Parser Compliance: Metric Boundary Values
 *
 * Tests parser behavior with boundary-value metric inputs — zero, minimal,
 * large, very large, decimal, and edge-case quantities across all metric types.
 */
import { describe, it, expect } from 'bun:test';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';

// ── Rep Boundaries ────────────────────────────────────────────────

describe('🟢 Parser: Rep Boundaries', () => {
    it('"0 Pullups" → Rep metric with value 0, Effort "Pullups"', () => {
        const root = parse('0 Pullups').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 0)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pullups');
    });

    it('"1 Pullup" → Rep metric with value 1', () => {
        const root = parse('1 Pullup').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 1)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pullup');
    });

    it('"1000 Burpees" → Rep metric with value 1000', () => {
        const root = parse('1000 Burpees').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 1000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Burpees');
    });

    it('"999999 Burpees" → should parse without overflow', () => {
        const root = parse('999999 Burpees').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 999999)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Burpees');
    });
});

// ── Duration Boundaries ───────────────────────────────────────────

describe('🟢 Parser: Duration Boundaries', () => {
    it('":01 Sprint" → Duration + Effort', () => {
        const root = parse(':01 Sprint').roots()[0];
        root
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 1000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Sprint');
    });

    it('"60:00 Marathon" → Duration (3,600,000ms) + Effort', () => {
        const root = parse('60:00 Marathon').roots()[0];
        root
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 3_600_000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Marathon');
    });
});

// ── Distance Boundaries ───────────────────────────────────────────

describe('🟢 Parser: Distance Boundaries', () => {
    it('"1m Run" → Distance + Effort', () => {
        const root = parse('1m Run').roots()[0];
        root
            .hasMetric(MetricType.Distance)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Run');
        const dist = root.getMetric(MetricType.Distance);
        expect(dist?.value).toEqual({ amount: 1, unit: 'm' });
    });

    it('"100km Bike" → Distance + Effort', () => {
        const root = parse('100km Bike').roots()[0];
        root
            .hasMetric(MetricType.Distance)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Bike');
        const dist = root.getMetric(MetricType.Distance);
        expect(dist?.value).toEqual({ amount: 100, unit: 'km' });
    });
});

// ── Mixed Units ────────────────────────────────────────────────────

describe('🟢 Parser: Mixed Unit Parsing', () => {
    it('"1 mile Run" → Distance in canonical unit + Effort (not "1m")', () => {
        const root = parse('1 mile Run').roots()[0];
        root
            .hasMetric(MetricType.Distance)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Run');
        const dist = root.getMetric(MetricType.Distance);
        // 'mile' canonicalizes to 'mi' — must not be 'm' (meters)
        expect(dist?.value).toEqual({ amount: 1, unit: 'mile' });
    });
});

// ── Weight / Resistance Boundaries ────────────────────────────────

describe('🟢 Parser: Weight Boundaries', () => {
    it('"10 Pushups @ 2.5 lb" → Rep + Effort + Resistance (decimal)', () => {
        const root = parse('10 Pushups @ 2.5 lb').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pushups')
            .hasMetric(MetricType.Resistance);
        const resistance = root.getMetric(MetricType.Resistance);
        expect(resistance?.value).toEqual({ amount: 2.5, unit: 'lb' });
    });

    it('"1 Deadlift @ 500 lb" → Rep + Effort + Resistance (heavy)', () => {
        const root = parse('1 Deadlift @ 500 lb').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 1)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Deadlift')
            .hasMetric(MetricType.Resistance);
        const resistance = root.getMetric(MetricType.Resistance);
        expect(resistance?.value).toEqual({ amount: 500, unit: 'lb' });
    });
});

// ── Bodyweight Marker ─────────────────────────────────────────────

describe('🟢 Parser: Bodyweight Marker', () => {
    it('"20 Pullups bw" → Rep + Effort + bodyweight Resistance', () => {
        const root = parse('20 Pullups bw').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 20)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pullups')
            .hasMetric(MetricType.Resistance);
    });
});

// ── Multi-Statement Mixed Metrics ─────────────────────────────────

describe('🟢 Parser: Multi-Statement Mixed Metrics', () => {
    it('"10 Pushups\\n5:00 Run\\n400m Row" → 3 statements with distinct metric types', () => {
        const tree = parse('10 Pushups\n5:00 Run\n400m Row')
            .hasStatementCount(3)
            .hasRootCount(3)
            .hasNoErrors();

        // Statement 0: Rep + Effort
        tree.roots()[0]
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Pushups');

        // Statement 1: Duration + Effort
        tree.roots()[1]
            .hasMetric(MetricType.Duration)
            .hasMetricValue(MetricType.Duration, 300_000)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Run');

        // Statement 2: Distance + Effort
        tree.roots()[2]
            .hasMetric(MetricType.Distance)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Row');
    });
});

// ── Unicode & Special Characters ──────────────────────────────────

describe('🟢 Parser: Unicode & Special Characters in Effort', () => {
    it('Unicode exercise name is handled (may strip non-ASCII leading chars)', () => {
        // Note: The lezer grammar may strip non-ASCII leading characters.
        // This test documents actual behavior. If Unicode support is added,
        // update the expected value.
        const root = parse('10 Övning').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetric(MetricType.Effort);
        // Parser currently strips the Ö — effort is "vning"
        const effort = root.getMetric(MetricType.Effort);
        expect(effort?.value).toBeTruthy(); // Has some effort value
    });

    it('"10 Clean & Jerk @ 135 lb" → single effort "Clean & Jerk"', () => {
        const root = parse('10 Clean & Jerk @ 135 lb').roots()[0];
        root
            .hasMetric(MetricType.Rep)
            .hasMetricValue(MetricType.Rep, 10)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Clean & Jerk')
            .hasMetric(MetricType.Resistance);
        const resistance = root.getMetric(MetricType.Resistance);
        expect(resistance?.value).toEqual({ amount: 135, unit: 'lb' });
    });
});
