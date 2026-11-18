import { IRuntimeBehavior } from '../contracts/IRuntimeBehavior';
import { IBehaviorContext } from '../contracts/IBehaviorContext';
import { IRuntimeAction } from '../contracts/IRuntimeAction';
import { PopBlockAction } from '../actions/stack/PopBlockAction';
import { UpdateNextPreviewAction } from '../actions/stack/UpdateNextPreviewAction';
import { CompileAndPushBlockAction } from '../actions/stack/CompileAndPushBlockAction';
import { PushRestBlockAction } from '../actions/stack/PushRestBlockAction';
import { ChildrenStatusState, RoundState, TimerState } from '../memory/MemoryTypes';
import { calculateElapsed } from '../time/calculateElapsed';
import { CurrentRoundMetric } from '../compiler/metrics/CurrentRoundMetric';

export type ChildSelectionLoopCondition = 'always' | 'timer-active' | 'rounds-remaining';

export interface ChildSelectionConfig {
    /** Groups of statement indices to compile and dispatch */
    childGroups: number[][];
    /** Enable looping when all children complete */
    loop?: boolean | {
        /** Loop condition: always, while timer running, or while rounds remain */
        condition?: ChildSelectionLoopCondition;
    };
    /** Inject rest blocks between loop iterations */
    injectRest?: boolean;
    /** Skip first child dispatch on mount (e.g., for deferred start) */
    skipOnMount?: boolean;
    /**
     * If set, initializes round state on mount (absorbs ReEntryBehavior).
     * Use 1 for the first round. When provided, round memory is written
     * at mount time so display and loop logic can read it immediately.
     */
    startRound?: number;
    /**
     * Total rounds for completion checking (undefined = unbounded).
     * Only used when startRound is also provided.
     */
    totalRounds?: number;
}

export class ChildSelectionBehavior implements IRuntimeBehavior {
    private static readonly DEFAULT_MIN_REST_MS = 1000;

    private childIndex = 0;
    private dispatchedOnLastNext = false;
    private restState: 'idle' | 'pending' | 'active' = 'idle';

    constructor(private readonly config: ChildSelectionConfig) { }

    onMount(ctx: IBehaviorContext): IRuntimeAction[] {
        this.restState = 'idle';
        this.dispatchedOnLastNext = false;

        // Declare capability so peer behaviors (e.g. CountdownTimerBehavior) can
        // coordinate without inspecting `behaviors[i].constructor.name`.
        ctx.declareCapability('childSelection');

        const actions: IRuntimeAction[] = [];
        // Initialize round state if configured (absorbed from ReEntryBehavior)
        if (this.config.startRound !== undefined) {
            const blockId = ctx.block.key.toString();
            ctx.pushMemory('round', [new CurrentRoundMetric(
                this.config.startRound,
                this.config.totalRounds,
                blockId,
                ctx.clock.currentDate,
            )]);
        }

        // Handle interval timer resets for EMOM synchronization
        if (this.config.injectRest) {
            ctx.subscribe('timer:complete', (_event, _ctx) => {
                // While a rest block is pending/active, the rest-pop path in
                // onNext owns the round advance — never advance twice for one
                // interval boundary.
                if (this.restState !== 'idle') return [];
                // Interval over — advance round and reset for the next cycle
                const advanceActions = this.advanceRound(ctx);
                this.childIndex = 0;
                this.restState = 'idle';
                this.writeChildrenStatus(ctx);
                return advanceActions;
            }, { scope: 'active' });
        }

        if (this.config.skipOnMount) {
            if (this.totalChildren > 0) {
                actions.push(this.createNextPreview(ctx, this.config.childGroups[0]));
            }
            this.writeChildrenStatus(ctx);
            return actions;
        }

        if (this.totalChildren === 0) {
            this.writeChildrenStatus(ctx);
            return actions;
        }

        const dispatchActions = this.dispatchNext(ctx);
        this.writeChildrenStatus(ctx);
        return [...actions, ...dispatchActions];
    }
    onNext(ctx: IBehaviorContext): IRuntimeAction[] {
        this.dispatchedOnLastNext = false;

        if (ctx.block.isComplete) {
            const actions = [this.createNextPreview(ctx)];
            this.writeChildrenStatus(ctx);
            return actions;
        }

        const actions: IRuntimeAction[] = [];

        // Safety net: catch round overshot (absorbed from RoundsEndBehavior).
        // ChildSelectionBehavior.shouldLoop() handles the normal exhaustion path;
        // this guard catches the edge case where current advances past total externally.
        if (this.config.startRound !== undefined) {
            const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
            if (round?.total !== undefined && round.current > round.total) {
                ctx.markComplete('rounds-exhausted');
                this.writeChildrenStatus(ctx);
                return [new PopBlockAction()];
            }
        }

        if (this.restState === 'active') {
            this.restState = 'idle';

            // For EMOM (injectRest = true), we only advance the round AFTER the rest block pops.
            // This keeps us in the correct round during the rest period.
            if (this.config.injectRest) {
                actions.push(...this.advanceRound(ctx));
                this.childIndex = 0;

                // If this next was manual (rest timer didn't expire yet),
                // we should reset the parent timer for the next interval.
                ctx.emitEvent({
                    name: 'timer:reset',
                    timestamp: ctx.clock.currentDate,
                    data: { blockKey: ctx.block.key.toString() }
                });
            }
        }
        if (this.childIndex >= this.totalChildren) {
            if (!this.shouldLoop(ctx)) {
                // All children done, no more loops — mark block complete.
                // RuntimeBlock.next() auto-pop ensures the block is popped.
                this.writeChildrenStatus(ctx);
                ctx.markComplete(
                    this.isLoopEnabled() ? 'rounds-exhausted' : 'children-complete'
                );
                return [this.createNextPreview(ctx)];
            }

            // If we have rest injection (EMOM), we push a Rest block and STAY in the current round.
            // We will advance the round when the Rest block is done (either Naturally or via manual Next).
            if (this.shouldInjectRest(ctx)) {
                this.restState = 'pending';
                const restDurationMs = this.getRemainingCountdownMs(ctx);
                const loopActions: IRuntimeAction[] = [
                    new PushRestBlockAction(restDurationMs, 'Rest'),
                    this.createNextPreview(ctx, this.config.childGroups[0])
                ];
                this.restState = 'active';
                this.writeChildrenStatus(ctx);
                return [...actions, ...loopActions];
            }

            // No rest, so advance round and reset index immediately for the next cycle (AMRAP pattern).
            actions.push(...this.advanceRound(ctx));
            this.childIndex = 0;
        }

        const dispatchActions = this.dispatchNext(ctx);
        this.writeChildrenStatus(ctx);
        return [...actions, ...dispatchActions];
    }

    onUnmount(_ctx: IBehaviorContext): IRuntimeAction[] {
        return [];
    }

    onDispose(_ctx: IBehaviorContext): void {
        this.restState = 'idle';
    }

    get allChildrenExecuted(): boolean {
        return this.childIndex >= this.totalChildren;
    }

    get allChildrenCompleted(): boolean {
        return this.allChildrenExecuted && !this.dispatchedOnLastNext;
    }

    get totalChildren(): number {
        return this.config.childGroups.length;
    }

    private dispatchNext(ctx: IBehaviorContext): IRuntimeAction[] {
        if (this.childIndex >= this.totalChildren) {
            return [this.createNextPreview(ctx)];
        }

        const nextGroup = this.config.childGroups[this.childIndex];
        this.childIndex++;
        this.dispatchedOnLastNext = true;

        const upcomingGroup =
            this.config.childGroups[this.childIndex]
            ?? (this.shouldLoop(ctx) ? this.config.childGroups[0] : undefined);
        return [
            new CompileAndPushBlockAction(nextGroup),
            this.createNextPreview(ctx, upcomingGroup),
        ];
    }

    private shouldLoop(ctx: IBehaviorContext): boolean {
        if (ctx.block.isComplete || !this.isLoopEnabled()) {
            return false;
        }

        const condition = this.getLoopCondition();
        if (condition === 'always') {
            return true;
        }

        if (condition === 'timer-active') {
            const timer = ctx.getMemoryByTag('time')[0]?.metrics[0]?.value as TimerState | undefined;
            if (!timer) {
                return false;
            }

            if (timer.direction === 'down' && timer.durationMs) {
                return this.getRemainingCountdownMs(ctx) > 0;
            }

            return true;
        }

        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
        if (!round) {
            return false;
        }
        if (round.total === undefined) {
            return true;
        }
        return round.current < round.total;
    }

    private shouldInjectRest(ctx: IBehaviorContext): boolean {
        if (!this.config.injectRest) {
            return false;
        }

        const timer = ctx.getMemoryByTag('time')[0]?.metrics[0]?.value as TimerState | undefined;
        if (!timer || timer.direction !== 'down' || !timer.durationMs) {
            return false;
        }

        const remainingMs = this.getRemainingCountdownMs(ctx);
        if (remainingMs < ChildSelectionBehavior.DEFAULT_MIN_REST_MS) {
            return false;
        }

        if (remainingMs >= timer.durationMs) {
            return false;
        }

        return true;
    }

    private getRemainingCountdownMs(ctx: IBehaviorContext): number {
        const timer = ctx.getMemoryByTag('time')[0]?.metrics[0]?.value as TimerState | undefined;
        if (!timer || timer.direction !== 'down' || !timer.durationMs) {
            return 0;
        }

        const now = ctx.clock.currentDate.getTime();
        const elapsed = calculateElapsed(timer, now);
        return Math.max(0, timer.durationMs - elapsed);
    }

    private writeChildrenStatus(ctx: IBehaviorContext): void {
        const status: ChildrenStatusState = {
            childIndex: this.childIndex,
            totalChildren: this.totalChildren,
            allExecuted: this.allChildrenExecuted,
            allCompleted: this.allChildrenCompleted,
        };
        const childLoc = ctx.getMemoryByTag('children:status')[0];
        if (childLoc?.metrics[0]) {
            ctx.updateMemory('children:status', [{...childLoc.metrics[0], value: status}]);
        } else {
            ctx.pushMemory('children:status', [{type: 'status', image: '', origin: 'runtime', value: status}]);
        }
    }

    /**
     * Advance the round counter in block memory and emit tracker action.
     *
     * Called by this behavior when a complete cycle of children finishes
     * and shouldLoop() returns true. This keeps round tracking
     * self-contained within ChildSelectionBehavior — no dependency on
     * ReEntryBehavior's onNext() or behavior execution ordering.
     */
    private advanceRound(ctx: IBehaviorContext): IRuntimeAction[] {
        const round = ctx.getMemoryByTag('round')[0]?.metrics[0] as unknown as RoundState | undefined;
        if (!round) return [];

        // Total guard: never advance past the configured total (AMRAP leaves
        // total undefined = unbounded). Prevents overshoot (e.g. "4/3") when
        // advance paths interleave; completion is surfaced via markComplete so
        // the RuntimeBlock.next() auto-pop / safety-net paths can pop the block.
        if (round.total !== undefined && round.current >= round.total) {
            ctx.markComplete('rounds-exhausted');
            return [];
        }

        const blockId = ctx.block.key.toString();
        const nextRound = round.current + 1;
        const total = round.total;

        const roundFragment = new CurrentRoundMetric(
            nextRound,
            total,
            blockId,
            ctx.clock.currentDate,
        );

        ctx.updateMemory('round', [roundFragment]);
        return [];
    }

    private createNextPreview(ctx: IBehaviorContext, nextGroup?: number[]): UpdateNextPreviewAction {
        return new UpdateNextPreviewAction(
            ctx.block.key.toString(),
            nextGroup ?? []
        );
    }

    private isLoopEnabled(): boolean {
        if (this.config.loop === undefined) {
            return false;
        }
        if (typeof this.config.loop === 'boolean') {
            return this.config.loop;
        }
        return true;
    }

    private getLoopCondition(): ChildSelectionLoopCondition {
        if (typeof this.config.loop === 'object' && this.config.loop.condition) {
            return this.config.loop.condition;
        }
        return 'timer-active';
    }
}
