/**
 * Parser Compliance: Cross-Dialect Interaction
 *
 * Tests the full dialect stack applied in sequence: UnitsDialect → CrossFitDialect
 * → FenceDialect → CardioDialect → YogaDialect → HabitsDialect → ClimbDialect.
 * Validates that multiple dialects can attach hints to the same statement and that
 * selective dialect stacks produce the expected partial output.
 */
import { describe, it, expect } from 'bun:test';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { UnitsDialect } from '@bitcobblers/wod-wiki-engine';
import { CardioDialect } from '@bitcobblers/wod-wiki-engine';
import { FenceDialect } from '@bitcobblers/wod-wiki-engine';
import { CrossFitDialect } from '@bitcobblers/wod-wiki-engine';
import { YogaDialect } from '@bitcobblers/wod-wiki-engine';

// ── Full Stack ────────────────────────────────────────────────────

describe('🟢 Parser: Full Dialect Stack', () => {
    it('"10:00 Metcon\\n  5 Pullups\\n  10 Pushups" → metcon + timed parent with children', () => {
        const tree = parse('10:00 Metcon\n  5 Pullups\n  10 Pushups');
        tree.hasStatementCount(3);

        const parent = tree.roots()[0];
        parent
            .hasMetric(MetricType.Duration)
            .hasMetric(MetricType.Effort)
            .hasMetricValue(MetricType.Effort, 'Metcon')
            .hasHint('domain.wod')
            .hasHint('workout.metcon');

        parent.children()[0]
            .hasMetricValue(MetricType.Rep, 5)
            .hasMetricValue(MetricType.Effort, 'Pullups');
    });

    it('"Strength\\n  5x5 Back Squat @ 225 lb" → strength hint, scheme parent, load child', () => {
        const tree = parse('Strength\n  5x5 Back Squat @ 225 lb');
        // Strength heading + inline NxM split (rounds parent → exercise child).
        tree.hasStatementCount(3);

        tree.roots()[0]
            .hasHint('domain.wod')
            .hasHint('workout.strength')
            .hasHint('behavior.load_bearing');

        // The scheme parent carries Rounds+Rep; the exercise child carries
        // the actual effort + resistance.
        const scheme = tree.roots()[0].children()[0];
        scheme
            .hasMetric(MetricType.Rounds)
            .hasMetric(MetricType.Rep);
        scheme.children()[0]
            .hasMetric(MetricType.Effort)
            .hasMetric(MetricType.Resistance);
    });

    it('"AMRAP 20 mins\\n  400m Run\\n  10 Pullups" → amrap + cardio on child', () => {
        const tree = parse('AMRAP 20 mins\n  400m Run\n  10 Pullups');
        tree.hasStatementCount(3);

        tree.roots()[0]
            .hasHint('workout.amrap')
            .hasHint('behavior.time_bound');

        // First child is a cardio movement
        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Distance)
            .hasHint('domain.cardio')
            .hasHint('workout.run');
    });
});

// ── Selective Stacks ──────────────────────────────────────────────

describe('🟢 Parser: Selective Dialect Stacks', () => {
    it('only UnitsDialect: "5km Run" fuses distance but no hints', () => {
        parse('5km Run', { dialects: [new UnitsDialect()] })
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasMetric(MetricType.Effort)
                .lacksHint('domain.cardio')
                .lacksHint('workout.run');
    });

    it('only CardioDialect: "400m Run" adds cardio hints', () => {
        parse('400m Run', { dialects: [new CardioDialect()] })
            .roots()[0]
                .hasHint('domain.cardio')
                .hasHint('workout.run');
    });

    it('UnitsDialect + CardioDialect: full cardio pipeline', () => {
        parse('5km Run', { dialects: [new UnitsDialect(), new CardioDialect()] })
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasHint('domain.cardio')
                .hasHint('behavior.distance_based')
                .hasHint('behavior.pace_based');
    });

    it('only CrossFitDialect: "AMRAP 20 mins" → amrap hint', () => {
        parse('AMRAP 20 mins', { dialects: [new CrossFitDialect()] })
            .roots()[0]
                .hasHint('workout.amrap')
                .hasHint('behavior.time_bound');
    });

    it('empty dialects: no hints on anything', () => {
        const tree = parse('Strength 5x5 Back Squat @ 225 lb', { dialects: [] });
        tree.hasStatementCount(2);
        tree.roots()[0]
            .hasMetric(MetricType.Rep)
            .lacksHint('domain.wod')
            .lacksHint('workout.strength');
        tree.roots()[0].children()[0]
            .hasMetric(MetricType.Effort)
            .hasMetric(MetricType.Resistance)
            .lacksHint('domain.wod')
            .lacksHint('workout.strength');
    });
});

// ── Dialect Hint Isolation ────────────────────────────────────────

describe('🟢 Parser: Dialect Hint Isolation', () => {
    it('"10 Pullups" → no dialect fires (generic effort)', () => {
        parse('10 Pullups')
            .roots()[0]
                .hasMetric(MetricType.Rep)
                .hasMetric(MetricType.Effort)
                .lacksHint('domain.wod')
                .lacksHint('domain.cardio')
                .lacksHint('domain.yoga');
    });

    it('"5:00" bare timer → no dialect fires', () => {
        parse('5:00')
            .roots()[0]
                .hasMetric(MetricType.Duration)
                .lacksHint('domain.wod')
                .lacksHint('domain.cardio');
    });

    it('"Warrior II :30" → YogaDialect fires, others do not', () => {
        parse('Warrior II :30')
            .roots()[0]
                .hasHint('domain.yoga')
                .hasHint('workout.pose')
                .lacksHint('domain.wod')
                .lacksHint('domain.cardio');
    });
});
