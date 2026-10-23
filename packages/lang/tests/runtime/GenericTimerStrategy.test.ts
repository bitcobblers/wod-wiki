import { describe, it, expect } from 'vitest';
import { apply, stmtWith, makeStatement, stubRuntime } from '../harness/harness/StrategyTestHarness';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { BlockBuilder } from '../../src/runtime/compiler/BlockBuilder';
import { DurationMetric } from '../../src/runtime/compiler/metrics/DurationMetric';
import { hintMetric } from '../../src/metrics/hints';
import { GenericTimerStrategy } from '../../src/runtime/compiler/strategies/components/GenericTimerStrategy';
import {
    CountdownTimerBehavior,
    CountupTimerBehavior,
    ExitBehavior,
    type ExitConfig,
    SoundProfileBehavior,
    LabelingBehavior,
} from '../../src/runtime/behaviors';
import type { IRuntimeBehavior } from '../../src/runtime/contracts/IRuntimeBehavior';

const runtime = stubRuntime();

describe('GenericTimerStrategy', () => {
    const strategy = new GenericTimerStrategy();

    describe('match', () => {
        it('returns true when any statement has a Duration metric with parser origin', () => {
            const stmts = [makeStatement([new DurationMetric('5:00')])];
            expect(strategy.match(stmts, runtime)).toBe(true);
        });
        it('returns false when only runtime-generated durations are present', () => {
            const stmts = [stmtWith(MetricType.Duration, 300_000, { origin: 'runtime' })];
            expect(strategy.match(stmts, runtime)).toBe(false);
        });
        it('returns false when no durations are present', () => {
            const stmts = [stmtWith(MetricType.Rep, 10)];
            expect(strategy.match(stmts, runtime)).toBe(false);
        });
    });

    describe('apply', () => {
        it('returns early when builder already has a timer behavior', () => {
            const builder = new BlockBuilder(runtime);
            builder.asTimer({ direction: 'down', durationMs: 60_000 });
            const stmts = [makeStatement([new DurationMetric('3:00')])];
            strategy.apply(builder, stmts, runtime);
            expect(builder.getBlockType()).toBe('Block');
        });
        it('with countdown duration, adds CountdownTimerBehavior, ExitBehavior, and LabelingBehavior', () => {
            const stmts = [makeStatement([new DurationMetric('3:00')])];
            const result = apply(strategy, stmts, runtime);
            expect(result.hasBehavior(CountdownTimerBehavior)).toBe(true);
            expect(result.hasBehavior(ExitBehavior)).toBe(true);
            expect(result.hasBehavior(LabelingBehavior)).toBe(true);
        });
        it('with countup (no duration), adds CountupTimerBehavior, ExitBehavior, and LabelingBehavior', () => {
            const stmts = [makeStatement([new DurationMetric(':?')])];
            const result = apply(strategy, stmts, runtime);
            expect(result.hasBehavior(CountupTimerBehavior)).toBe(true);
            expect(result.hasBehavior(ExitBehavior)).toBe(true);
            expect(result.hasBehavior(LabelingBehavior)).toBe(true);
        });
        it('adds no sound behavior of its own — SoundStrategy owns cues', () => {
            const stmts = [makeStatement([new DurationMetric('3:00')])];
            const result = apply(strategy, stmts, runtime);
            expect(result.hasBehavior(SoundProfileBehavior)).toBe(false);
        });
        it('required countdown timer gives ExitBehavior onEvents timer:complete', () => {
            const stmts = [
                makeStatement([
                    new DurationMetric('2:00', false, true),
                    hintMetric('behavior.required_timer'),
                ]),
            ];
            const result = apply(strategy, stmts, runtime);
            const exit = result.getBehavior(ExitBehavior);
            expect(exit).toBeDefined();
            const exitWithConfig = exit as unknown as IRuntimeBehavior & { config: ExitConfig };
            expect(exitWithConfig.config.onEvents).toEqual(['timer:complete']);
            expect(exitWithConfig.config.onNext).toBe(false);
            expect(result.hasBehavior(CountdownTimerBehavior)).toBe(true);
        });
    });
});
