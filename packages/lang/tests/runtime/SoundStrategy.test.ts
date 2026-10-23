import { describe, it, expect } from 'vitest';
import { apply, stmtWith, stubRuntime } from '../harness/harness/StrategyTestHarness';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { BlockBuilder } from '../../src/runtime/compiler/BlockBuilder';
import { SoundStrategy } from '../../src/runtime/compiler/strategies/enhancements/SoundStrategy';
import { SoundProfileBehavior } from '../../src/runtime/behaviors';
import { DEFAULT_SOUND_PROFILE } from '../../src/runtime/sound/SoundProfile';

const runtime = stubRuntime();

describe('SoundStrategy', () => {
    it('matches non-empty statements', () => {
        expect(apply(new SoundStrategy(), [stmtWith(MetricType.Reps, 5)], runtime).matched).toBe(true);
    });

    it('does not match empty statements', () => {
        expect(apply(new SoundStrategy(), [], runtime).matched).toBe(false);
    });

    it('skips when a sound behavior is already present', () => {
        const builder = new BlockBuilder(runtime);
        builder.addBehavior(new SoundProfileBehavior({ profile: DEFAULT_SOUND_PROFILE }));
        new SoundStrategy().apply(builder, [stmtWith(MetricType.Reps, 5)], runtime);
        expect(builder.getBehavior(SoundProfileBehavior)).toBeDefined();
    });

    it('adds sound behavior when a countdown timer is present', () => {
        const builder = new BlockBuilder(runtime);
        builder.asTimer({ direction: 'down', durationMs: 60000 });
        new SoundStrategy().apply(builder, [stmtWith(MetricType.Reps, 5)], runtime);
        expect(builder.hasBehavior(SoundProfileBehavior)).toBe(true);
    });

    it('adds sound behavior when a countup timer is present', () => {
        const builder = new BlockBuilder(runtime);
        builder.asTimer({ direction: 'up' });
        new SoundStrategy().apply(builder, [stmtWith(MetricType.Reps, 5)], runtime);
        expect(builder.hasBehavior(SoundProfileBehavior)).toBe(true);
    });

    it('does nothing when no timer present', () => {
        const result = apply(new SoundStrategy(), [stmtWith(MetricType.Reps, 5)], runtime);
        expect(result.hasBehavior(SoundProfileBehavior)).toBe(false);
    });

    it('uses the default profile when nothing selects one', () => {
        const builder = new BlockBuilder(runtime);
        builder.asTimer({ direction: 'down', durationMs: 60000 });
        new SoundStrategy().apply(builder, [stmtWith(MetricType.Reps, 5)], runtime);
        const behavior = builder.getBehavior(SoundProfileBehavior);
        expect(behavior).toBeDefined();
    });
});
