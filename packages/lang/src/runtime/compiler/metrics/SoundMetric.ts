import { IMetric, MetricType, MetricOrigin } from '@bitcobblers/wod-wiki-core';
/**
 * Trigger types for when a sound should play.
 */
export type SoundTrigger = 'mount' | 'unmount' | 'countdown' | 'complete';

/**
 * SoundMetric represents an audio cue to be played during workout execution.
 * 
 * Used by SoundProfileBehavior to emit output records that audio systems can process.
 * 
 * @example
 * ```typescript
 * // A countdown beep at 3 seconds remaining
 * new SoundMetric('countdown-beep', 'countdown', { atSecond: 3 })
 * 
 * // A completion chime
 * new SoundMetric('complete-chime', 'complete')
 * ```
 */
export class SoundMetric implements IMetric {
    readonly type = MetricType.Sound;
    readonly origin: MetricOrigin;
    readonly value: SoundMetricValue;
    readonly image: string;

    constructor(
        /** Sound identifier or URL */
        public readonly sound: string,
        /** When this sound was triggered */
        public readonly trigger: SoundTrigger,
        /** Additional options */
        options: {
            /** For countdown triggers, the second at which this played */
            atSecond?: number;
            /** Origin of this metrics */
            origin?: MetricOrigin;
        } = {}
    ) {
        this.origin = options.origin ?? 'tracked';
        this.value = {
            sound,
            trigger,
            atSecond: options.atSecond
        };
        this.image = options.atSecond !== undefined 
            ? `${sound}@${options.atSecond}s` 
            : sound;
    }
}

/**
 * Value structure for SoundMetric
 */
export interface SoundMetricValue {
    /** Sound identifier or URL */
    readonly sound: string;
    /** Trigger type */
    readonly trigger: SoundTrigger;
    /** For countdown triggers, the second at which this played */
    readonly atSecond?: number;
}
