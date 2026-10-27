import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext, Unsubscribe } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { TimerState, ChildrenStatusState, RoundState } from '../memory/MemoryTypes';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-core';
import { ClearChildrenAction } from '../actions/stack/ClearChildrenAction';
import { PopBlockAction } from '../actions/stack/PopBlockAction';
import { calculateElapsed } from '../time/calculateElapsed';
import { startSpan, closeCurrentSpan, openSpan, readTimer, mutateTimerSpans } from '../time/TimerSpans';
import { CurrentRoundMetric } from '../compiler/metrics/CurrentRoundMetric';

/**
 * Controls what happens when the countdown reaches zero.
 *
 * - `complete-block`: marks the block complete and clears children.
 *   Use for timers that own the block's lifecycle (AMRAP cap, timed effort).
 * - `reset-interval`: resets spans and children state for the next round.
 *   Use for repeating-interval timers where the block lives across many rounds (EMOM).
 */
export type CountdownMode = 'complete-block' | 'reset-interval';

export interface CountdownTimerConfig {
    /** Duration in milliseconds — required for a countdown */
    durationMs: number;
    /** Human-readable label shown in the display layer */
    label?: string;
    /** Timer role for display priority */
    role?: 'primary' | 'secondary' | 'hidden' | 'auto';
    /**
     * What happens when elapsed >= durationMs.
     * Defaults to `'complete-block'`.
     */
    mode?: CountdownMode;
    /** Factory to create a rest block for "next" transitions */
    restBlockFactory?: (durationMs: number, label?: string) => IRuntimeAction[];
    /**
     * If true, the user cannot skip this timer. Pressing "Next" emits a
     * `timer:skip-attempt` event instead of advancing the block.
     */
    required?: boolean;
}

/**
 * CountdownTimerBehavior manages the full lifecycle of a count-down timer.
 *
 * ## Aspect: Time (Count-down)
 *
 * Covers the complete lifecycle for blocks with a fixed duration:
 * - **mount**: opens an initial TimeSpan; checks immediate expiry
 * - **tick events**: monitors elapsed time and fires `timer:complete` on expiry
 * - **pause/resume events**: closes/opens spans to exclude paused time
 * - **unmount**: closes the current span to finalise elapsed time
 *
 * Strategies assign this one behavior instead of composing the old quartet
 * (TimerInitBehavior + TimerTickBehavior + TimerEndingBehavior + TimerPauseBehavior).
 */
export class CountdownTimerBehavior implements IRuntimeBehavior {
    constructor(public readonly config: CountdownTimerConfig) { }

    private subscriptions: Unsubscribe[] = [];
    private isPaused = false;

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        const now = ctx.clock.currentDate.getTime();
        const label = this.config.label ?? ctx.block.label;
        const role = this.config.role === 'hidden' ? 'auto' : (this.config.role ?? 'primary');
        const mode = this.config.mode ?? 'complete-block';

        ctx.pushMemory('time', [this.createFragment(ctx, {
            spans: startSpan(now),
            direction: 'down',
            durationMs: this.config.durationMs,
            label,
            role
        })]);

        // Immediate expiry check (e.g. duration was already 0 when compiled)
        if (this.config.durationMs <= 0) {
            this.handleExpiry(ctx, mode);
            return [new ClearChildrenAction(ctx.block.key.toString())];
        }

        // Tick subscription — monitors elapsed and triggers expiry
        this.subscriptions.push(
            ctx.subscribe('tick', (_event, tickCtx) => {
                // Once block is complete in complete-block mode, stop monitoring
                if (mode === 'complete-block' && tickCtx.block.isComplete) {
                    return [];
                }
                if (!this.hasExpired(tickCtx)) return [];

                this.handleExpiry(tickCtx, mode);
                return [new ClearChildrenAction(tickCtx.block.key.toString())];
            }, { scope: 'bubble' })
        );

        // Timer Reset — for EMOM manual skip or synchronization
        this.subscriptions.push(
            ctx.subscribe('timer:reset', (_event, rCtx) => {
                if (mode !== 'reset-interval') return [];
                mutateTimerSpans(rCtx, (_spans, nowMs) => startSpan(nowMs));
                return [];
            })
        );

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
        // Reconcile a missed expiry BEFORE skip restrictions. The timer surfaces
        // count down from open timer spans even while the tick pump is idle or
        // stopped, so the user can face 00:00 without any tick having delivered
        // expiry. A Next at/after the real boundary finishes the timer exactly
        // as the missed tick would have (expiry → pop → parent next), never a
        // skip attempt. complete-block only: interval timers (reset-interval)
        // cycle through the pump's event coordination and keep their skip
        // semantics. When the pump already expired this block, isComplete
        // short-circuits — no double fire.
        if ((this.config.mode ?? 'complete-block') === 'complete-block'
            && !ctx.block.isComplete
            && this.hasExpired(ctx)) {
            ctx.markComplete('timer-expired');
            return [new PopBlockAction(), new ClearChildrenAction(ctx.block.key.toString())];
        }

        // Required timers cannot be skipped — emit a skip-attempt event instead.
        if (this.config.required && !ctx.block.isComplete) {
            ctx.emitEvent({
                name: 'timer:skip-attempt',
                timestamp: ctx.clock.currentDate,
                data: { blockKey: ctx.block.key.toString() }
            });
            return [];
        }
        // Parent blocks (those with child selection) should NEVER push their own rest.
        // ChildSelectionBehavior handles rest injection (EMOM) or sibling transitions.
        // Coordination is via the `'childSelection'` capability declared by
        // ChildSelectionBehavior — avoids both circular imports and
        // `behaviors[i].constructor.name` string inspection.
        if (ctx.hasCapability('childSelection')) {
            return [];
        }
        if (!this.config.restBlockFactory) {
            return [];
        }

        const timer = readTimer(ctx);
        if (!timer || timer.direction !== 'down' || !timer.durationMs) {
            return [];
        }

        const remainingMs = this.getRemainingCountdownMs(ctx);

        // Only inject rest if more than 1s remaining (matching ChildSelectionBehavior logic)
        if (remainingMs > 1000) {
            return this.config.restBlockFactory(remainingMs, 'Rest');
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

    // -------------------------------------------------------------------------

    private handleExpiry(ctx: IBehaviorContext, mode: CountdownMode): void {
        ctx.emitEvent({
            name: 'timer:complete',
            timestamp: ctx.clock.currentDate,
            data: { blockKey: ctx.block.key.toString() }
        });

        if (mode === 'complete-block') {
            ctx.markComplete('timer-expired');
        } else {
            // reset-interval: new span starting now, reset child cursor
            mutateTimerSpans(ctx, (_spans, nowMs) => startSpan(nowMs));

            // If ChildSelectionBehavior is present, it will handle round/status advancement
            // via its own logic (coordinated with Rest block popping or manual next).
            // We use the `'childSelection'` capability to avoid coupling on the
            // concrete class identity.
            if (ctx.hasCapability('childSelection')) {
                return;
            }

            // Cycle complete — advance round counter directly before
            // resetting for the next cycle. This keeps round tracking
            // self-contained for simple repeating timers without children.
            const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
            if (round) {
                const roundFragment = new CurrentRoundMetric(
                    round.current + 1,
                    round.total,
                    ctx.block.key.toString(),
                    ctx.clock.currentDate,
                );
                ctx.updateMemory('round', [roundFragment]);
            }

            const childLoc = ctx.getMemoryByTag('children:status')[0];
            const childStatus = childLoc?.metrics[0]?.value as ChildrenStatusState | undefined;
            const newChildStatus = { childIndex: 0, totalChildren: childStatus?.totalChildren ?? 0, allExecuted: false, allCompleted: false };
            if (childLoc?.metrics[0]) {
                ctx.updateMemory('children:status', [{...childLoc.metrics[0], value: newChildStatus}]);
            } else {
                ctx.pushMemory('children:status', [{type: 'status', image: '', origin: 'runtime', value: newChildStatus}]);
            }
        }
    }

    /**
     * True when the countdown has fully elapsed against the context's clock.
     * Single definition of "expired" shared by the tick subscription and the
     * Next-time reconcile, so display (spans) and runtime cannot diverge.
     */
    private hasExpired(ctx: IBehaviorContext): boolean {
        const timer = readTimer(ctx);
        if (!timer || timer.direction !== 'down' || timer.durationMs === undefined) {
            return false;
        }
        return calculateElapsed(timer, ctx.nowProvider.nowMs()) >= timer.durationMs;
    }

    private getRemainingCountdownMs(ctx: IBehaviorContext): number {
        const timer = readTimer(ctx);
        if (!timer || timer.direction !== 'down' || !timer.durationMs) {
            return 0;
        }

        const now = ctx.clock.currentDate.getTime();
        const elapsed = calculateElapsed(timer, now);
        return Math.max(0, timer.durationMs - elapsed);
    }

    private createFragment(ctx: IBehaviorContext, state: TimerState): IMetric {
        return {
            type: MetricType.Time,
            image: formatDuration(state.durationMs),
            origin: 'runtime',
            value: state,
            sourceBlockKey: ctx.block.key.toString(),
            timestamp: ctx.clock.currentDate,
        };
    }
}

function formatDuration(durationMs: number | undefined): string {
    if (!durationMs || durationMs === 0) return '0:00';
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

