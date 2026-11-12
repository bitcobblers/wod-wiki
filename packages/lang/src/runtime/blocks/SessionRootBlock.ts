import type { IRuntimeContext } from '../contracts/IRuntimeContext';
import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { BlockLifecycleOptions } from '../contracts/IRuntimeBlock';
import { RuntimeBlock } from '../RuntimeBlock';
import { BlockContext } from '../BlockContext';
import { BlockKey } from '@bitcobblers/wod-wiki-core';

// Aspect-based behaviors
import {
    CountupTimerBehavior,
    ChildSelectionBehavior,
    LabelingBehavior,
    ButtonBehavior,
    ReportOutputBehavior
} from '../behaviors';
import { WaitingToStartInjectorBehavior } from '../behaviors/WaitingToStartInjectorBehavior';

/**
 * Configuration for the session root block.
 */
export interface SessionRootConfig {
    /** Session label (e.g., "Morning WOD") */
    label?: string;
    /** Child statement ID groups to execute */
    childGroups: number[][];
    /** Total rounds for the workout (default: 1) */
    totalRounds?: number;
}

/**
 * SessionRootBlock is the top-level container for a workout session.
 *
 * ## Lifecycle
 *
 * 1. Mount: Emits 'segment' output with session label, starts elapsed timer,
 *    pushes WaitingToStart block as first child (index 0)
 * 2. First next(): WaitingToStart pops → ChildRunner pushes first workout block
 * 3. Subsequent next(): ChildRunner pushes remaining workout blocks in sequence
 * 4. Final next(): All children done → marks complete and pops
 * 5. Pop: emits a 'segment' output carrying the completion reason, records history
 *
 * ## Behavior Chain Order
 *
 * Behaviors are order-independent for correctness. ChildSelectionBehavior
 * handles round advancement internally, and RuntimeBlock.next() auto-pops
 * when any behavior marks the block complete.
 *
 * - CountupTimerBehavior (elapsed workout timer)
 * - ChildSelectionBehavior (child dispatch + round init + advancement + safety net)
 * - WaitingToStartInjectorBehavior (pushes WaitingToStart gate on mount)
 * - ReportOutputBehavior (output on mount/unmount)
 * - LabelingBehavior (display)
 * - ButtonBehavior (controls)
 *
 * History persistence is the responsibility of the workbench — all data
 * needed for history is available in the output stream (ReportOutputBehavior).
 */
export class SessionRootBlock extends RuntimeBlock {
    constructor(
        runtime: IRuntimeContext,
        config: SessionRootConfig
    ) {
        const sessionLabel = config.label ?? 'Session';
        const blockKey = new BlockKey('session-root');
        const context = new BlockContext(runtime, blockKey.toString(), 'Session');

        const behaviors = SessionRootBlock.buildBehaviors(config, runtime);

        super({
            runtime,
            sourceIds: config.childGroups.flat(), // Flatten child groups to provide identity
            behaviors,
            context,
            key: blockKey,
            blockType: 'SessionRoot',
            label: sessionLabel,
        });
    }

    /**
     * Builds the behavior list for a session root block.
     * @param config Session configuration
     * @param runtime Script runtime (needed for WaitingToStartInjectorBehavior)
     */
    static buildBehaviors(config: SessionRootConfig, runtime: IRuntimeContext): IRuntimeBehavior[] {
        const behaviors: IRuntimeBehavior[] = [];
        const totalRounds = config.totalRounds ?? 1;
        const sessionLabel = config.label ?? 'Session';

        // ====================================================================
        // Time Aspect - Track total session elapsed time
        // ====================================================================
        behaviors.push(new CountupTimerBehavior({
            label: sessionLabel,
            role: 'auto',
            // The session clock starts when the WaitingToStart gate pops —
            // not at mount — so idle wait time never counts as workout time.
            resetOnFirstNext: true,
        }));

        // =====================================================================
        // Children Aspect - Execute child blocks
        // skipOnMount: true because WaitingToStartInjectorBehavior handles
        // the first mount push. Child selection begins on the first onNext()
        // (triggered when WaitingToStart pops).
        // startRound/totalRounds: absorbed from ReEntryBehavior + RoundsEndBehavior.
        // =====================================================================
        behaviors.push(new ChildSelectionBehavior({
            childGroups: config.childGroups,
            loop: totalRounds > 1 ? { condition: 'rounds-remaining' } : false,
            skipOnMount: true,
            startRound: 1,
            totalRounds,
        }));

        // =====================================================================
        // Gate Aspect - WaitingToStart idle gate
        // Pushes a WaitingToStartBlock on mount. User must click "Start"
        // before ChildSelectionBehavior begins pushing workout children.
        // =====================================================================
        behaviors.push(new WaitingToStartInjectorBehavior(runtime));

        // =====================================================================
        // Output Aspect - Segment tracking
        // =====================================================================
        behaviors.push(new ReportOutputBehavior({ label: sessionLabel }));

        // =====================================================================
        // Display Aspect
        // =====================================================================
        behaviors.push(new LabelingBehavior({
            mode: 'clock',
            label: sessionLabel
        }));

        // =====================================================================
        // Controls Aspect - Session control buttons
        // =====================================================================
        behaviors.push(new ButtonBehavior({
            buttons: [
                {
                    id: 'pause',
                    label: 'Pause',
                    variant: 'secondary' as const,
                    visible: true,
                    enabled: true,
                    eventName: 'timer:pause'
                },
                {
                    id: 'next',
                    label: 'Next',
                    variant: 'primary' as const,
                    visible: true,
                    enabled: true,
                    eventName: 'next'
                },
                {
                    id: 'stop',
                    label: 'Stop',
                    variant: 'danger' as const,
                    visible: true,
                    enabled: true,
                    eventName: 'workout:stop'
                }
            ]
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
