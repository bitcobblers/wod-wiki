import type { IRuntimeContext } from '../contracts/IRuntimeContext';
import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { BlockLifecycleOptions } from '../contracts/IRuntimeBlock';
import type { RuntimeStackOptions } from '../contracts/IRuntimeOptions';
import { RuntimeBlock } from '../RuntimeBlock';
import { BlockContext } from '../BlockContext';
import { BlockKey } from '@bitcobblers/wod-wiki-core';

// Aspect-based behaviors
import {
    ReportOutputBehavior,
    CountdownTimerBehavior,
    ExitBehavior,
    LabelingBehavior,
    SoundProfileBehavior
} from '../behaviors';
import { resolveSoundProfile } from '../sound/resolveSoundProfile';

/**
 * Configuration for the rest block.
 */
export interface RestBlockConfig {
    /** Duration of the rest period in milliseconds */
    durationMs: number;
    /** Label for the rest period (default: "Rest") */
    label?: string;
}

/**
 * RestBlock is a timer-based block for rest periods between exercises.
 *
 * Timer-based parents (AMRAP, EMOM) can auto-generate Rest blocks between exercises.
 * The rest block counts down from the configured duration and auto-pops when the timer expires.
 *
 * ## Lifecycle
 *
 * 1. Mount: Emits 'segment' output with rest label and duration, starts countdown timer
 * 2. Timer counts down via CountdownTimerBehavior span tracking
 * 3. CountdownTimerBehavior marks complete when elapsed >= durationMs
 * 4. Pop: emits a 'segment' output carrying the completion reason, plays rest-over sound cue
 *
 * ## Behavior Chain
 *
 * - ReportOutputBehavior (output on mount/unmount)
 * - CountdownTimerBehavior (countdown timer + pause/resume + auto-complete)
 * - LabelingBehavior (show rest countdown)
 * - SoundProfileBehavior (the block's sound profile)
 */
export class RestBlock extends RuntimeBlock {
    constructor(
        runtime: IRuntimeContext,
        config: RestBlockConfig
    ) {
        if (config.durationMs < 0) {
            throw new RangeError(`RestBlock durationMs must be >= 0, got: ${config.durationMs}`);
        }

        const restLabel = config.label ?? 'Rest';
        const blockKey = new BlockKey('rest');
        const context = new BlockContext(runtime, blockKey.toString(), 'Rest');
        const behaviors = RestBlock.buildBehaviors(config, runtime.options?.soundOptions);

        super({
            runtime,
            sourceIds: [], // No source IDs for auto-generated block
            behaviors,
            context,
            key: blockKey,
            blockType: 'Rest',
            label: restLabel,
        });
    }

    /**
     * Builds the behavior list for a rest block.
     */
    static buildBehaviors(config: RestBlockConfig, soundOptions?: RuntimeStackOptions['soundOptions']): IRuntimeBehavior[] {
        const behaviors: IRuntimeBehavior[] = [];
        const restLabel = config.label ?? 'Rest';

        // =====================================================================
        // Output Aspect - Segment tracking
        // =====================================================================
        behaviors.push(new ReportOutputBehavior({ label: restLabel }));

        // ====================================================================
        // Time Aspect - Countdown timer (self-contained lifecycle)
        // ====================================================================
        behaviors.push(new CountdownTimerBehavior({
            durationMs: config.durationMs,
            label: restLabel,
            role: 'primary',
            mode: 'complete-block'
        }));

        // =====================================================================
        // Completion Aspect - Rest should end on timer completion.
        // Ignore generic next events to prevent accidental fast-skipping
        // (e.g., rapid user/input next events during EMOM).
        // =====================================================================
        behaviors.push(new ExitBehavior({
            mode: 'immediate',
            onNext: false,
            onEvents: ['timer:complete']
        }));

        // =====================================================================
        // Display Aspect
        // =====================================================================
        behaviors.push(new LabelingBehavior({
            mode: 'timer',
            label: restLabel
        }));

        // =====================================================================
        // Sound Aspect - the block's sound profile
        // =====================================================================
        behaviors.push(new SoundProfileBehavior({
            profile: resolveSoundProfile([], soundOptions),
        }));

        return behaviors;
    }

    mount(runtime: IRuntimeContext, options?: BlockLifecycleOptions): IRuntimeAction[] {
        return super.mount(runtime, options);
    }

    unmount(runtime: IRuntimeContext, options?: BlockLifecycleOptions): IRuntimeAction[] {
        return super.unmount(runtime, options);
    }

    dispose(runtime: IRuntimeContext): void {
        super.dispose(runtime);
        if (this.context) {
            this.context.release();
        }
    }
}
