import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext, Unsubscribe } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { TimerState, TimerPolarity } from '../memory/MemoryTypes';
import { startSpan, closeCurrentSpan, openSpan, mutateTimerSpans } from '../time/TimerSpans';

export interface CountupTimerConfig {
    /** Human-readable label shown in the display layer */
    label?: string;
    /** Timer role for display priority */
    role?: 'primary' | 'secondary' | 'hidden' | 'auto';
    polarity?: TimerPolarity;
}

/**
 * CountupTimerBehavior manages the full lifecycle of a count-up timer.
 *
 * ## Aspect: Time (Count-up)
 *
 * Covers the complete lifecycle for blocks without a fixed duration:
 * - **mount**: opens an initial TimeSpan to start tracking
 * - **pause/resume events**: closes/opens spans to exclude paused time
 * - **unmount**: closes the current span to finalise elapsed time
 *
 * There is no tick subscription and no completion signal — the block
 * advances only when the user (or a parent) calls `next()`.
 *
 * Strategies: assign this directly instead of composing TimerInitBehavior
 * + TimerTickBehavior + TimerPauseBehavior.
 */
export class CountupTimerBehavior implements IRuntimeBehavior {
    constructor(public readonly config: CountupTimerConfig = {}) { }

    private subscriptions: Unsubscribe[] = [];
    private isPaused = false;

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        const now = ctx.clock.currentDate.getTime();
        const label = this.config.label ?? ctx.block.label;
        const role = this.config.role === 'hidden' ? 'auto' : (this.config.role ?? 'primary');

        ctx.pushMemory('time', [this.createFragment(ctx, {
            spans: startSpan(now),
            direction: 'up',
            durationMs: undefined,
            label,
            role,
            required: false,
            polarity: this.config.polarity ?? 'work',
        })]);

        // Pause — close current span
        this.subscriptions.push(
            ctx.subscribe('timer:pause', (_event, pCtx) => {
                if (this.isPaused) return [];
                if (mutateTimerSpans(pCtx, closeCurrentSpan)) this.isPaused = true;
                return [];
            })
        );

        // Resume — open a new span
        this.subscriptions.push(
            ctx.subscribe('timer:resume', (_event, rCtx) => {
                if (!this.isPaused) return [];
                if (mutateTimerSpans(rCtx, openSpan)) this.isPaused = false;
                return [];
            })
        );

        return [];
    }

    onNext(_ctx: IBehaviorContext): IRuntimeAction[] {
        return [];
    }

    onUnmount(ctx: IBehaviorContext): IRuntimeAction[] {
        mutateTimerSpans(ctx, closeCurrentSpan);
        return [];
    }

    onDispose(_ctx: IBehaviorContext): void {
        for (const unsub of this.subscriptions) {
            try { unsub(); } catch { /* no-op */ }
        }
        this.subscriptions.length = 0;
    }

    private createFragment(ctx: IBehaviorContext, state: TimerState): IMetric {
        return {
            type: MetricType.Time,
            image: '0:00',
            origin: 'runtime',
            value: state,
            sourceBlockKey: ctx.block.key.toString(),
            timestamp: ctx.clock.currentDate,
        };
    }
}
