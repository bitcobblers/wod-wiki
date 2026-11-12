import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext, Unsubscribe } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { TimeSpan } from '../models/TimeSpan';
import { TimerState, TimerPolarity } from '../memory/MemoryTypes';
import { startSpan, closeCurrentSpan, openSpan, mutateTimerSpans, type SpanList } from '../time/TimerSpans';

export interface CountupTimerConfig {
    /** Human-readable label shown in the display layer */
    label?: string;
    /** Timer role for display priority */
    role?: 'primary' | 'secondary' | 'hidden' | 'auto';
    polarity?: TimerPolarity;
    /**
     * Reset the initial open mount span to `now` on the first onNext.
     * SessionRootBlock enables this so the session clock starts at the
     * moment the WaitingToStart gate pops, not at session mount — the
     * athlete's idle wait at the gate is not workout time.
     */
    resetOnFirstNext?: boolean;
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
    private firstNextSeen = false;

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

    onNext(ctx: IBehaviorContext): IRuntimeAction[] {
        if (this.config.resetOnFirstNext && !this.firstNextSeen) {
            this.firstNextSeen = true;
            // First onNext of the owning block (the WaitingToStart gate pop
            // for SessionRootBlock): restart the untouched initial mount span
            // so elapsed time starts now, excluding the idle gate wait.
            mutateTimerSpans(ctx, (spans: SpanList, nowMs: number): TimeSpan[] =>
                spans.length === 1 && spans[0].ended === undefined ? [new TimeSpan(nowMs)] : [...spans],
            );
        }
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
