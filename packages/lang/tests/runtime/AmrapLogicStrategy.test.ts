import { describe, it, expect } from 'vitest';
import { apply, stmtWith, stubRuntime } from '../harness/harness/StrategyTestHarness';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { AmrapLogicStrategy } from '../../src/runtime/compiler/strategies/logic/AmrapLogicStrategy';
import { CountdownTimerBehavior, LabelingBehavior, SoundProfileBehavior, ChildSelectionBehavior } from '../../src/runtime/behaviors';

const runtime = stubRuntime();
const strategy = new AmrapLogicStrategy();

describe('AmrapLogicStrategy', () => {
    describe('match', () => {
        it('returns true for Duration + Rounds', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 600000), stmtWith(MetricType.Rounds, 5)], runtime);
            expect(result.matched).toBe(true);
        });

        it('returns true for Duration + amrap keyword in Effort', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 600000), stmtWith(MetricType.Effort, 'AMRAP')], runtime);
            expect(result.matched).toBe(true);
        });

        it('returns true for Duration + rounds keyword in Action', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 600000), stmtWith(MetricType.Action, 'rounds')], runtime);
            expect(result.matched).toBe(true);
        });

        it('returns false for empty statements', () => {
            const result = apply(strategy, [], runtime);
            expect(result.matched).toBe(false);
        });

        it('returns false for timer-only statements', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 600000)], runtime);
            expect(result.matched).toBe(false);
        });

        it('returns false for rounds-only statements', () => {
            const result = apply(strategy, [stmtWith(MetricType.Rounds, 5)], runtime);
            expect(result.matched).toBe(false);
        });
    });

    describe('apply', () => {
        it('sets blockType AMRAP and adds expected behaviors', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 600000), stmtWith(MetricType.Rounds, 5)], runtime);
            expect(result.blockType).toBe('AMRAP');
            expect(result.hasBehavior(CountdownTimerBehavior)).toBe(true);
            expect(result.hasBehavior(LabelingBehavior)).toBe(true);
            expect(result.hasBehavior(ChildSelectionBehavior)).toBe(false);
        });

        it('adds no sound behavior of its own — SoundStrategy owns cues', () => {
            const result = apply(strategy, [stmtWith(MetricType.Duration, 600000), stmtWith(MetricType.Rounds, 5)], runtime);
            expect(result.hasBehavior(SoundProfileBehavior)).toBe(false);
        });

        it('sets sourceIds, label, and fragments via compose', () => {
            const s1 = stmtWith(MetricType.Duration, 600000);
            const s2 = stmtWith(MetricType.Rounds, 5);
            const result = apply(strategy, [s1, s2], runtime);
            expect(result.sourceIds).toEqual([s1.id, s2.id]);
            expect(result.label).toBeTruthy();
            expect(result.fragments).toBeDefined();
        });
    });
});
