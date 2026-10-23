import { describe, it, expect } from 'vitest';
import { apply, stmtWith, stubRuntime, makeStatement } from '../harness/harness/StrategyTestHarness';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { IntervalLogicStrategy } from '../../src/runtime/compiler/strategies/logic/IntervalLogicStrategy';
import { CountdownTimerBehavior, LabelingBehavior, SoundProfileBehavior, MetricPromotionBehavior } from '../../src/runtime/behaviors';

const runtime = stubRuntime();
const strategy = new IntervalLogicStrategy();

describe('IntervalLogicStrategy', () => {
    describe('match', () => {
        it('returns true for Duration + repeating_interval hint', () => {
            const result = apply(strategy, [
                stmtWith(MetricType.Duration, 60000),
                stmtWith(MetricType.Hint, 'behavior.repeating_interval'),
            ], runtime);
            expect(result.matched).toBe(true);
        });

        it('returns true for Duration + emom keyword', () => {
            const result = apply(strategy, [
                stmtWith(MetricType.Duration, 60000),
                stmtWith(MetricType.Effort, 'emom'),
            ], runtime);
            expect(result.matched).toBe(true);
        });

        it('returns false for Duration-only statements', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 60000)], runtime);
            expect(result.matched).toBe(false);
        });

        it('returns false for hint-only statements', () => {
            const result = apply(strategy, [stmtWith(MetricType.Hint, 'behavior.repeating_interval')], runtime);
            expect(result.matched).toBe(false);
        });
    });

    describe('apply', () => {
        it('sets blockType EMOM and adds timer and label behaviors', () => {
            const stmt = makeStatement([
                { type: MetricType.Duration, value: 60000, origin: 'parser' },
                { type: MetricType.Hint, value: 'behavior.repeating_interval', origin: 'parser' },
            ]);
            const result = apply(strategy, [stmt], runtime);
            expect(result.blockType).toBe('EMOM');
            expect(result.hasBehavior(CountdownTimerBehavior)).toBe(true);
            expect(result.hasBehavior(LabelingBehavior)).toBe(true);
        });

        it('adds no sound behavior of its own — SoundStrategy owns cues', () => {
            const stmt = makeStatement([
                { type: MetricType.Duration, value: 60000, origin: 'parser' },
                { type: MetricType.Hint, value: 'behavior.repeating_interval', origin: 'parser' },
            ]);
            const result = apply(strategy, [stmt], runtime);
            expect(result.hasBehavior(SoundProfileBehavior)).toBe(false);
        });

        it('adds MetricPromotionBehavior when Resistance is present', () => {
            const stmt = makeStatement([
                { type: MetricType.Duration, value: 60000, origin: 'parser' },
                { type: MetricType.Hint, value: 'behavior.repeating_interval', origin: 'parser' },
                { type: MetricType.Resistance, value: 135, origin: 'parser' },
            ]);
            const result = apply(strategy, [stmt], runtime);
            expect(result.hasBehavior(MetricPromotionBehavior)).toBe(true);
        });

        it('does not add MetricPromotionBehavior without Resistance or Distance', () => {
            const stmt = makeStatement([
                { type: MetricType.Duration, value: 60000, origin: 'parser' },
                { type: MetricType.Hint, value: 'behavior.repeating_interval', origin: 'parser' },
            ]);
            const result = apply(strategy, [stmt], runtime);
            expect(result.hasBehavior(MetricPromotionBehavior)).toBe(false);
        });
    });
});
