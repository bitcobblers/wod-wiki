import { BlockKey } from '@bitcobblers/wod-wiki-core';
import type { IRuntimeContext } from './contracts/IRuntimeContext';
import { IRuntimeBehavior } from './contracts/IRuntimeBehavior';
import { BlockLifecycleOptions, CompletionDecision, IRuntimeBlock } from './contracts/IRuntimeBlock';
import { IRuntimeAction } from './contracts/IRuntimeAction';
import { IBlockContext } from './contracts/IBlockContext';
import { BlockContext } from './BlockContext';
import { BehaviorContext } from './BehaviorContext';
import { RuntimeLogger } from './RuntimeLogger';
import { IMemoryLocation, MemoryLocation, MemoryTag } from './memory/MemoryLocation';
import { MetricVisibility, getMetricVisibility } from './memory/MetricVisibility';
import { IMetric, MetricOrigin, MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { OutputStatement } from '@bitcobblers/wod-wiki-core';
import type { TagReferenceMetadata } from '@bitcobblers/wod-wiki-core';
import { TimeSpan } from './models/TimeSpan';
import { IRuntimeClock } from './contracts/IRuntimeClock';
import { PopBlockAction } from './actions/stack/PopBlockAction';

/**
 * Options for constructing a {@link RuntimeBlock}.
 *
 * Construction goes through a single options object — there is no positional
 * overload. The sanctioned way to build a block is {@link BlockBuilder.build},
 * and the four block subclasses (RestBlock, EffortBlock, SessionRootBlock,
 * WaitingToStartBlock) forward their own config into this shape.
 */
export interface RuntimeBlockOptions {
    /** The owning runtime. */
    runtime: IRuntimeContext;
    /** Source statement ids this block was compiled from. Defaults to `[]`. */
    sourceIds?: number[];
    /** Behaviors composed onto this block. Defaults to `[]`. */
    behaviors?: IRuntimeBehavior[];
    /** Block context. A {@link BlockContext} is created from the key when omitted. */
    context?: IBlockContext;
    /** Block key. A fresh {@link BlockKey} is created when omitted. */
    key?: BlockKey;
    /** Stable type tag (e.g. 'Rest', 'SessionRoot'). */
    blockType?: string;
    /** Optional label, stored as a `metric:label` memory location. */
    label?: string;
    /** Optional display metric groups, each stored as a `metric:display` location. */
    metrics?: MetricContainer[] | IMetric[][];
    /** The tags this block's statements referenced, resolved at compile time. */
    tagComposition?: readonly TagReferenceMetadata[];
}

/**
 * RuntimeBlock represents an executable unit in the workout runtime.
 * 
 * Blocks are composed of behaviors that handle specific aspects (time, iteration, completion, etc.)
 * Behaviors receive an IBehaviorContext that provides access to memory, events, and output emission.
 * 
 * ## Lifecycle
 * 
 * 1. Block is created by a strategy with behaviors attached
 * 2. mount() is called when pushed onto stack - behaviors receive onMount(ctx)
 * 3. next() is called when child completes or user advances - behaviors receive onNext(ctx)
 * 4. unmount() is called when popped from stack - behaviors receive onUnmount(ctx)
 * 5. dispose() is called for cleanup - behaviors receive onDispose(ctx)
 */
export class RuntimeBlock implements IRuntimeBlock {
    public readonly behaviors: IRuntimeBehavior[] = [];
    public readonly key: BlockKey;
    public readonly blockType?: string;
    public readonly context: IBlockContext;
    public readonly sourceIds: number[];
    /** The tags this block's statements referenced, resolved at compile time. */
    public readonly tagComposition?: readonly TagReferenceMetadata[];

    // List-based memory storage
    private _memory: IMemoryLocation[] = [];

    /**
     * Computed label derived from the block's Label metrics.
     * Priority: Label metric in memory → blockType → 'Block'
     */
    get label(): string {
        // Check all memory locations for a Label metrics
        for (const loc of this._memory) {
            for (const frag of loc.metrics) {
                if (frag.type === MetricType.Label) {
                    return frag.image || frag.value?.toString() || this.blockType || 'Block';
                }
            }
        }
        return this.blockType || 'Block';
    }

    // Behavior context (created on mount)
    protected _behaviorContext?: BehaviorContext;

    // Execution timing
    public readonly executionTiming: { startTime?: Date; endTime?: Date } = {};

    // Completion state
    private _isComplete: boolean = false;
    private _completionReason?: string;

    // Event unsubscribers
    private _eventUnsubscribers: Array<() => void> = [];

    // Runtime reference (set during mount)
    protected _runtime?: IRuntimeContext;

    constructor(options: RuntimeBlockOptions) {
        const {
            runtime,
            sourceIds = [],
            behaviors = [],
            context,
            key,
            blockType,
            label,
            metrics,
            tagComposition,
        } = options;

        this._runtime = runtime;
        this.sourceIds = sourceIds;
        this.behaviors = behaviors;
        this.key = key ?? new BlockKey();
        this.blockType = blockType;
        this.tagComposition = tagComposition;
        this.context = context ?? new BlockContext(runtime, this.key.toString());

        // Store label as a Label metrics in memory (only if explicitly provided)
        if (label) {
            this._memory.push(new MemoryLocation('metric:label', [{
                type: MetricType.Label,
                image: label,
                origin: 'compiler',
                value: label,
            } as IMetric]));
        }

        if (metrics) {
            for (const group of metrics) {
                this._memory.push(new MemoryLocation('metric:display', group));
            }
        }
    }

    // ============================================================================
    // List-Based Memory API
    // ============================================================================

    /**
     * Push a new memory location onto the block's memory list.
     * Multiple locations with the same tag can coexist.
     */
    pushMemory(location: IMemoryLocation): void {
        this._memory.push(location);
    }

    /**
     * Merge a set of compiler hints (e.g. from an effort markdown file) into
     * a `metric:hint` memory location. Hints are surfaced to strategies
     * exactly the same way dialect-emitted hints are. Duplicate keys are
     * overwritten (the effort hint wins, matching the doc's
     * "more specific wins" precedence).
     */
    mergeHints(hints: Readonly<Record<string, unknown>>): void {
        if (!hints || Object.keys(hints).length === 0) return;
        const existing = this._memory.find(loc => loc.tag === 'metric:hint');
        const newMetrics: IMetric[] = Object.entries(hints).map(([key, _value]) => ({
            type: MetricType.Hint,
            value: key,
            image: key,
            origin: 'compiler' as MetricOrigin,
            timestamp: new Date(),
        }));
        if (existing) {
            const newKeys = new Set(newMetrics.map(m => m.value as string));
            const kept = existing.metrics.toArray().filter(m => !(m.type === MetricType.Hint && newKeys.has(m.value as string)));
            existing.update([...kept, ...newMetrics]);
        } else {
            this._memory.push(new MemoryLocation('metric:hint', newMetrics));
        }
    }

    /**
     * Get all memory locations matching the given tag.
     * Returns an empty array if no locations match.
     */
    getMemoryByTag(tag: MemoryTag): IMemoryLocation[] {
        return this._memory.filter(loc => loc.tag === tag);
    }

    /**
     * Get all memory locations owned by this block.
     * Returns the full memory list in insertion order.
     */
    getAllMemory(): IMemoryLocation[] {
        return [...this._memory];
    }

    /**
     * Get all metrics memory locations matching a given visibility tier.
     *
     * @param visibility The visibility tier: 'display' | 'promote' | 'private'
     * @returns Memory locations whose tags belong to the requested tier
     */
    getMetricMemoryByVisibility(visibility: MetricVisibility): IMemoryLocation[] {
        return this._memory.filter(loc => getMetricVisibility(loc.tag) === visibility);
    }

    // ============================================================================
    // Backward-Compatible Memory API (shims over list-based memory)
    // ============================================================================

    // ============================================================================
    // Lifecycle Methods
    // ============================================================================

    /**
     * Register default event handlers for block-level events.
     * 
     * Note: 'next' events are handled globally by NextEventHandler
     * registered in ScriptRuntime. Per-block 'next' handlers are not
     * needed and were removed to avoid unnecessary handler registrations.
     */
    protected registerDefaultHandler(): void {
        // No per-block handlers currently needed.
        // The global NextEventHandler in ScriptRuntime handles 'next' events.
    }

    /**
     * Called when this block is pushed onto the runtime stack.
     */
    mount(runtime: IRuntimeContext, options?: BlockLifecycleOptions): IRuntimeAction[] {
        this._runtime = runtime;

        // Use provided clock or fall back to runtime clock
        const clock = options?.clock ?? runtime.clock;
        this.executionTiming.startTime = options?.startTime ?? clock.currentDate;

        // Register default event handlers
        this.registerDefaultHandler();

        // Create behavior context with the appropriate clock
        const stackLevel = Math.max(0, runtime.stack.count - 1);
        this._behaviorContext = new BehaviorContext(this, clock, stackLevel, runtime);

        // Call behavior onMount hooks
        const actions: IRuntimeAction[] = [];
        for (const behavior of this.behaviors) {
            if (behavior.onMount) {
                const result = behavior.onMount(this._behaviorContext);
                if (result) {
                    actions.push(...result);
                }
            }
        }

        return actions;
    }

    /**
     * Inspect what the next() call would do, WITHOUT dispatching.
     *
     * PURE READ for completion state. Runs the behavior onNext chain against
     * a temporary BehaviorContext, captures the decision, and restores the
     * block's completion flag so the caller can inspect without side effects.
     *
     * The decision is DETERMINISTIC given the same runtime state: the same
     * behaviors, the same block memory, and the same clock always produce
     * the exact same decision (behaviors are assumed to be pure functions
     * of their context).
     *
     * @param runtime The script runtime context
     * @param options Lifecycle options including optional clock for timing consistency
     */
    inspectNext(runtime: IRuntimeContext, options?: BlockLifecycleOptions): CompletionDecision {
        if (!this._behaviorContext) {
            // Mirror next()'s no-context behavior: return an empty decision.
            // DO NOT warn — inspectNext is a pure read; calling before mount
            // is a valid test scenario.
            return { complete: false, actions: [] };
        }
        const clock = options?.clock ?? this._behaviorContext.clock;
        // Share the persistent context's capability registry so capabilities
        // declared in onMount remain visible to behavior chains in
        // inspectNext (which constructs a fresh per-call BehaviorContext).
        const nextContext = new BehaviorContext(
            this,
            clock,
            this._behaviorContext.stackLevel,
            runtime,
            this._behaviorContext.getCapabilities(),
        );
        // Snapshot completion state so we can restore it after inspection.
        // Behaviors may call ctx.markComplete() during the chain; we capture
        // the result without leaving a permanent mutation.
        const wasComplete = this._isComplete;
        const wasReason = this._completionReason;

        // Same per-call state reset as next() so behaviors that depend on
        // prepareForNextCycle see consistent state.
        for (const behavior of this.behaviors) {
            const behaviorWithPrepare = behavior as { prepareForNextCycle?: () => void };
            if (typeof behaviorWithPrepare.prepareForNextCycle === 'function') {
                behaviorWithPrepare.prepareForNextCycle();
            }
        }

        const actions: IRuntimeAction[] = [];
        for (const behavior of this.behaviors) {
            if (behavior.onNext) {
                const result = behavior.onNext(nextContext);
                if (result) {
                    actions.push(...result);
                }
            }
        }

        // Dispose the temporary context immediately. The dispatch path (next())
        // does this too, so the lifecycle is identical.
        nextContext.dispose();

        // Auto-pop: if the chain marked the block complete and no PopBlockAction
        // was already queued, add one. This mirrors next()'s auto-pop logic.
        // Done before constructing the `decision` object so the captured
        // `actions` array reflects the full set the dispatcher will see.
        if (this._isComplete && !actions.some(a => a.type === 'pop-block')) {
            actions.push(new PopBlockAction());
        }

        // Capture the decision before restoring state.
        const decision: CompletionDecision = {
            complete: this._isComplete,
            reason: this._completionReason,
            actions,
        };

        // Restore completion state — inspectNext must not mutate the block.
        this._isComplete = wasComplete;
        this._completionReason = wasReason;

        return decision;
    }

    /**
     * Called when a child block completes or user advances.
     *
     * @param runtime The script runtime context
     * @param options Lifecycle options including optional clock for timing consistency
     */
    next(runtime: IRuntimeContext, options?: BlockLifecycleOptions): IRuntimeAction[] {
        if (!this._behaviorContext) {
            RuntimeLogger.logAlways('warn', 'RuntimeBlock', 'next() called before mount()');
            return [];
        }

        // Use provided clock or fall back to existing context clock
        const clock = options?.clock ?? this._behaviorContext.clock;

        // Emit system output for next lifecycle event
        this.emitNextSystemOutput(runtime, clock);

        // Delegate the behavior chain to inspectNext. The actions and the
        // decision come back together; we just dispatch.
        const decision = this.inspectNext(runtime, options);

        // Apply the completion state from the decision. inspectNext restored
        // the original state, so we re-apply the mutation the behavior chain
        // intended. This keeps next() the single source of truth for stateful
        // side effects while inspectNext remains a pure read.
        if (decision.complete && !this._isComplete) {
            this.markComplete(decision.reason);
        }

        // Log the next call with resulting actions (preserves the existing log line)
        RuntimeLogger.logNext(this, [...decision.actions]);

        return decision.actions as IRuntimeAction[];
    }

    /**
     * Called when this block is popped from the runtime stack.
     * 
     * @param runtime The script runtime context
     * @param options Lifecycle options including optional clock for timing consistency
     */
    unmount(runtime: IRuntimeContext, options?: BlockLifecycleOptions): IRuntimeAction[] {
        // Use provided clock or fall back to runtime clock
        const clock = options?.clock ?? runtime.clock;
        this.executionTiming.endTime = options?.createdAt ?? clock.currentDate;

        const actions: IRuntimeAction[] = [];

        // Create a fresh context for this unmount() call with the appropriate clock
        // This ensures all behaviors in this unmount() chain see the same frozen time
        const unmountContext = new BehaviorContext(
            this,
            clock,
            this._behaviorContext?.stackLevel ?? 0,
            runtime,
            this._behaviorContext?.getCapabilities(),
        );

        // Call behavior onUnmount hooks
        for (const behavior of this.behaviors) {
            if (behavior.onUnmount) {
                const result = behavior.onUnmount(unmountContext);
                if (result) {
                    actions.push(...result);
                }
            }
        }

        // Dispose temporary context
        unmountContext.dispose();

        // Emit unmount event and capture any resulting actions
        const unmountEventActions = runtime.eventBus.dispatch({
            name: 'unmount',
            timestamp: runtime.clock.currentDate,
            data: { blockKey: this.key.toString() }
        }, runtime);
        if (unmountEventActions.length > 0) {
            actions.push(...unmountEventActions);
        }

        // Unregister event handlers
        for (const unsub of this._eventUnsubscribers) {
            try {
                unsub();
            } catch (err) {
                RuntimeLogger.logAlways('error', 'RuntimeBlock', 'Error unsubscribing event handler', { error: err });
            }
        }
        this._eventUnsubscribers = [];

        // Dispose behavior context (cleans up subscriptions)
        if (this._behaviorContext) {
            this._behaviorContext.dispose();
            this._behaviorContext = undefined;
        }

        return actions;
    }

    /**
     * Called for final cleanup.
     */
    dispose(runtime: IRuntimeContext): void {
        // Create a temporary context if needed for dispose
        const ctx = this._behaviorContext ?? new BehaviorContext(
            this,
            runtime.clock,
            0,
            runtime
        );

        for (const behavior of this.behaviors) {
            if (behavior.onDispose) {
                behavior.onDispose(ctx);
            }
        }

        // Clean up temporary context if we created one
        if (!this._behaviorContext && ctx) {
            ctx.dispose();
        }

        // Dispose list-based memory locations
        for (const location of this._memory) {
            location.dispose();
        }
        this._memory = [];
    }

    // ============================================================================
    // Completion
    // ============================================================================

    get isComplete(): boolean {
        return this._isComplete;
    }

    get completionReason(): string | undefined {
        return this._completionReason;
    }

    markComplete(reason?: string): void {
        this._isComplete = true;
        this._completionReason = reason;
    }

    // ============================================================================
    // Utilities
    // ============================================================================

    /**
     * Gets a specific behavior by type from the behaviors array.
     */
    getBehavior<T extends IRuntimeBehavior>(behaviorType: new (...args: unknown[]) => T): T | undefined {
        return this.behaviors.find(b => b instanceof behaviorType) as T | undefined;
    }

    /**
     * Emit a system output for next lifecycle event.
     * Called directly from next() to ensure accurate timing.
     */
    private emitNextSystemOutput(runtime: IRuntimeContext, clock: IRuntimeClock): void {
        const now = clock.currentDate;

        // Build structured data for the metrics value
        interface SystemOutputValue {
            event: 'next';
            blockKey: string;
            blockLabel?: string;
            actionType?: string;
            [key: string]: unknown;
        }

        const value: SystemOutputValue = {
            event: 'next',
            blockKey: this.key.toString(),
            blockLabel: this.label,
            // Include action type for debugging - helps trace what triggered this next() call
            actionType: 'next',
        };

        // Create the metrics
        const metric: IMetric = {
            type: MetricType.System,
            image: `next: ${this.label ?? this.blockType ?? 'Block'} [${this.key.toString().slice(0, 8)}]`,
            value,
            origin: 'runtime',
            timestamp: now,
        };

        // Create and emit the output statement
        const output = new OutputStatement({
            outputType: 'system',
            timeSpan: new TimeSpan(now.getTime(), now.getTime()),
            sourceBlockKey: this.key.toString(),
            stackLevel: runtime.stack.count,
            metrics: [metric],
        });

        runtime.addOutput(output);
    }
}
