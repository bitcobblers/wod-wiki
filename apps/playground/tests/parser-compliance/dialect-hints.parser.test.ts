/**
 * Parser Compliance: Dialect Hints
 *
 * Tests that dialect processing correctly attaches semantic hints
 * to parsed CodeStatements through the full dialect stack.
 */
import { describe, it } from 'vitest';
import { parse } from '../helpers/parser-test-utils';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { CardioDialect } from '@bitcobblers/wod-wiki-engine';

describe('🟢 Parser: FenceDialect Hints', () => {
    it('"Strength" → workout.strength + domain.wod hints', () => {
        parse('Strength')
            .roots()[0]
                .hasHint('domain.wod')
                .hasHint('workout.strength')
                .hasHint('behavior.load_bearing');
    });

    it('"Metcon" → workout.metcon hint', () => {
        parse('Metcon')
            .roots()[0]
                .hasHint('domain.wod')
                .hasHint('workout.metcon');
    });

    it('"Skills Double Unders" → workout.skills hint', () => {
        parse('Skills Double Unders')
            .roots()[0]
                .hasHint('domain.wod')
                .hasHint('workout.skills');
    });

    it('"WOD" → domain.wod hint only', () => {
        parse('WOD')
            .roots()[0]
                .hasHint('domain.wod')
                .lacksHint('workout.strength');
    });

    it('"Superset Bench Press Rows" → workout.superset hint', () => {
        parse('Superset Bench Press Rows')
            .roots()[0]
                .hasHint('domain.wod')
                .hasHint('workout.superset');
    });
});

describe('🟢 Parser: CardioDialect Hints', () => {
    it('"400m Run" → domain.cardio + workout.run', () => {
        parse('400m Run')
            .roots()[0]
                .hasHint('domain.cardio')
                .hasHint('workout.run');
    });

    it('"500m Row" → domain.cardio + workout.row', () => {
        parse('500m Row')
            .roots()[0]
                .hasHint('domain.cardio')
                .hasHint('workout.row');
    });

    it('"5km Bike" → workout.bike hint', () => {
        parse('5km Bike')
            .roots()[0]
                .hasHint('domain.cardio')
                .hasHint('workout.bike');
    });
});

describe('🟢 Parser: CrossFitDialect Hints', () => {
    it('"AMRAP 20 mins" → workout.amrap + behavior.time_bound', () => {
        parse('AMRAP 20 mins')
            .roots()[0]
                .hasHint('workout.amrap')
                .hasHint('behavior.time_bound');
    });

    it('"EMOM 10 mins" → workout.emom + behavior.repeating_interval', () => {
        parse('EMOM 10 mins')
            .roots()[0]
                .hasHint('workout.emom')
                .hasHint('behavior.repeating_interval');
    });

    it('"For Time" → workout.for_time + behavior.time_bound', () => {
        parse('For Time')
            .roots()[0]
                .hasHint('workout.for_time')
                .hasHint('behavior.time_bound');
    });
});

describe('🟢 Parser: No-Dialect Mode', () => {
    it('"400m Run" with empty dialects → no hints', () => {
        parse('400m Run', { dialects: [] })
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasMetric(MetricType.Effort)
                .lacksHint('domain.cardio')
                .lacksHint('workout.run');
    });

    it('"Strength" with only CardioDialect → no strength hint', () => {
        parse('Strength', { dialects: [new CardioDialect()] })
            .roots()[0]
                .lacksHint('workout.strength')
                .lacksHint('domain.wod');
    });
});

describe('🟢 Parser: Cross-Dialect Interaction', () => {
    it('"5km Run" → UnitsDialect fuses distance, CardioDialect adds hints', () => {
        parse('5km Run')
            .roots()[0]
                .hasMetric(MetricType.Distance)
                .hasHint('domain.cardio')
                .hasHint('behavior.distance_based')
                .hasHint('behavior.pace_based');
    });

    it('"10 Pullups" → no dialect hints for generic effort', () => {
        parse('10 Pullups')
            .roots()[0]
                .hasMetric(MetricType.Rep)
                .hasMetric(MetricType.Effort)
                .lacksHint('domain.cardio')
                .lacksHint('domain.wod');
    });

    it('"5:00" bare timer → no dialect hints', () => {
        parse('5:00')
            .roots()[0]
                .hasMetric(MetricType.Duration)
                .lacksHint('domain.cardio')
                .lacksHint('domain.wod');
    });
});
