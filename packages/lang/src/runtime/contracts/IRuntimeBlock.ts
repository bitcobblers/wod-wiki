import type { TagReferenceMetadata } from '@bitcobblers/wod-wiki-core';
import { BlockKey } from '@bitcobblers/wod-wiki-core';
import { IRuntimeAction } from './IRuntimeAction';
import { IBlockContext } from './IBlockContext';
import { IRuntimeBehavior } from './IRuntimeBehavior';
import type { IRuntimeActionable } from './primitives/IRuntimeActionable';
import { IMemoryLocation, MemoryTag } from '../memory/MemoryLocation';
import { MetricVisibility } from '../memory/MetricVisibility';
import type { IBlockRef } from './primitives/IBlockRef';
import type { BlockLifecycleOptions as BlockLifecycleOptionsPrimitive } from './primitives/IBlockLifecycle';

/**
 * Re-export of the primitives `BlockLifecycleOptions` for backward
 * compatibility with existing import sites that pull this type from
 * `IRuntimeBlock`.
 */
export type BlockLifecycleOptions = BlockLifecycleOptionsPrimitive;

/**
 * The decision reached by an inspectNext() call.
 *
 * `complete` is true if the behavior chain marked the block complete.
 * `reason` is the human-readable reason (mirrors CompletionReason).
 * `actions` is the action list that a follow-up next() call would dispatch.
 * The actions are exactly the ones the auto-pop in next() would queue.
 */
export interface CompletionDecision {
    readonly complete: boolean;
    readonly reason?: string;
    readonly actions: readonly import('./IRuntimeAction').IRuntimeAction[];
}


/**
 * Represents a runtime block that can be executed within the WOD runtime stack.
 * 
 * ## Lifecycle Management
 * 
 * Lifecycle pattern:
 * - Blocks initialize in constructors and register resources
 * - RuntimeStack.push() validates and stores blocks
 * - RuntimeStack.pop() orchestrates unmount → dispose → context.release → parent.next
 * - Blocks must implement dispose/unmount, but callers no longer manually dispose popped blocks
 * 
 * ## Performance Requirements
 * - All lifecycle methods should complete within 50ms
 * - Stack operations should be optimized for frequent push/pop cycles
 * - Memory usage should be minimized during execution
 */
export interface IRuntimeBlock extends IBlockRef {
    /**
     * The tag composition of this block — the tags its statements referenced,
     * and what each carried (the functions it activates, the sound profile it
     * names).
     *
     * Resolved at compile time, so the runtime and the surfaces that show a
     * block know which tags shaped it without re-reading the catalogue.
     */
    readonly tagComposition?: readonly TagReferenceMetadata[];
    /**
     * Execution timing metadata propagated by the runtime (start/completion timestamps).
     * Implementations can rely on RuntimeStack/PushBlockAction to set this.
     */
    executionTiming?: BlockLifecycleOptions;

    /**
     * Unique identifier for this block instance.
     * Used for tracking and debugging purposes.
     */
    readonly key: BlockKey;

    /**
     * Source code location identifiers.
     * Links block to original workout script positions.
     */
    readonly sourceIds: number[];

    /**
     * Type discriminator for UI display and logging.
     * Enables identification of block types (Timer, Rounds, Effort, etc.).
     */
    readonly blockType?: string;

    /**
     * Human-readable label for the block.
     * Computed from the block's Label metrics in metrics:display memory.
     * Falls back to blockType or 'Block' if no Label metric exists.
     * e.g., "Round 1 of 3", "21 Reps", "For Time"
     */
    readonly label: string;

    /**
     * The execution context for this block.
     * Manages memory allocation and cleanup.
     */
    readonly context: IBlockContext;

    /**
     * Called when this block is pushed onto the runtime stack.
     * Sets up initial state and registers event listeners.
     * 
     * Note: Event registration and resource allocation should happen here,
     * not in the constructor, to ensure they are active only while mounted.
     * 
     * @param runtime The runtime context (typed as the IRuntimeActionable primitive
     *                to break the cycle through IScriptRuntime)
     * @param options Lifecycle timing data (start time)
     * @returns Array of runtime actions to execute after mount
     */
    mount(runtime: IRuntimeActionable, options?: BlockLifecycleOptions): IRuntimeAction[];

    /**
     * Called to advance the block's execution state.
     * 
     * Triggers:
     * 1. **Automatic**: Called by RuntimeStack when a child block is popped (child completion).
     * 2. **Manual**: Called by NextAction when user manually acts (e.g., skips block).
     * 3. **Timer**: Called by TimerBehavior when a timer completes (implicit next).
     * 
     * Responsibilities:
     * - Determine the next step in the block's execution flow.
     * - If block has children (e.g., loops), push the next child.
     * - If block is simple (e.g., single movement), mark itself complete.
     * - If block is a timer, handle timer completion logic.
     * 
     * @param runtime The runtime context (typed as the IRuntimeActionable primitive
     *                to break the cycle through IScriptRuntime)
     * @param options Lifecycle timing data (completion timestamp if triggered by child pop)
     * @returns Array of runtime actions representing next execution steps (e.g., PushBlock, MarkComplete)
     */
    next(runtime: IRuntimeActionable, options?: BlockLifecycleOptions): IRuntimeAction[];

    /**
     * Inspect what the next() call would do, WITHOUT dispatching.
     *
     * PURE READ. Does not mutate _isComplete, does not register any
     * side effects on the runtime, does not emit any events. Runs the
     * behavior onNext chain against a temporary BehaviorContext and
     * returns the decision the chain reached.
     *
     * Use this to ask "what would happen if I called next() right now?"
     * without paying for the side effects. The cast sender can pre-emptively
     * dim the next block; analytics can explain "why did this block end?"
     * from the decision trail; tests can assert on the decision without
     * touching state.
     *
     * @param runtime The runtime context (typed as the IRuntimeActionable primitive
     *                to break the cycle through IScriptRuntime)
     * @param options Lifecycle timing data (completion timestamp if triggered by child pop)
     * @returns The completion decision: { complete, reason?, actions }
     */
    inspectNext(runtime: IRuntimeActionable, options?: BlockLifecycleOptions): CompletionDecision;

    /**
     * Called when this block is popped from the runtime stack.
     * Handles completion logic, cleanup, and resource disposal.
     * 
     * Note: This method MUST unsubscribe from events and dispose 
     * memory entries to complete any active observables.
     * 
     * @param runtime The runtime context (typed as the IRuntimeActionable primitive
     *                to break the cycle through IScriptRuntime)
     * @param options Lifecycle timing data (completion timestamp)
     * @returns Array of runtime actions to execute after unmount
     */
    unmount(runtime: IRuntimeActionable, options?: BlockLifecycleOptions): IRuntimeAction[];

    /**
     * Cleans up any resources held by this block.
     * 
     * ## Critical Requirements
     * - MUST be called by consumer after popping from stack
     * - Should complete within 50ms for performance
     * - Must handle being called multiple times safely
     * - Should not throw exceptions during cleanup
     * 
     * ## Resource Management
     * - Close file handles, network connections
     * - Unregister event listeners and callbacks
     * - Release memory references and clear caches
     * - Dispose of child objects and dependencies
     * 
     * @param runtime The runtime context (typed as the IRuntimeActionable primitive
     *                to break the cycle through IScriptRuntime)
     * @throws Never - Should handle all cleanup errors internally
     */
    dispose(runtime: IRuntimeActionable): void;

    /**
     * Gets a specific behavior by type from the behaviors array.
     * @param behaviorType Constructor/class of the behavior to find
     * @returns The behavior instance or undefined if not found
     */
    getBehavior<T extends IRuntimeBehavior>(behaviorType: new (...args: unknown[]) => T): T | undefined;

    /**
     * Read-only list of all behaviors attached to this block.
     * Useful for debug/inspection UIs.
     */
    readonly behaviors: readonly IRuntimeBehavior[];

    // ============================================================================
    // List-Based Memory API
    // ============================================================================

    /**
     * Push a new memory location onto the block's memory list.
     * Multiple locations with the same tag can coexist.
     */
    pushMemory(location: IMemoryLocation): void;

    /**
     * Merge a set of compiler hints (e.g. from an effort markdown file) into
     * the block. Hints are stored as `MetricType.Hint` metrics in a
     * `metric:hint` memory location.
     *
     * IMPORTANT: unlike dialect-emitted hints (which are attached to the
     * *statement* before `JitCompiler.compile()` runs, and so are visible to
     * `hasHint`/`getHints` calls inside strategy `match()`/`apply()`), hints
     * merged here land on the *block* — which only exists after compilation.
     * They currently do NOT reach any strategy decision; `hasHint`/`getHints`
     * never read from block memory. See
     * docs/architectural-cleanup-tier-3-extensibility.md §3.3 verification
     * notes for the full explanation. Use sparingly: any hint key not in
     * `CONSUMED_HINTS` (see `core/metrics/hints.ts`) is analytics-only even
     * when the read-path gap above is fixed. For effort-specific metrics,
     * prefer a domain metric.
     */
    mergeHints(hints: Readonly<Record<string, unknown>>): void;

    /**
     * Get all memory locations matching the given tag.
     * Returns an empty array if no locations match.
     *
     * @param tag The memory tag to filter by
     * @returns Array of memory locations with the given tag
     */
    getMemoryByTag(tag: MemoryTag): IMemoryLocation[];

    /**
     * Get all memory locations owned by this block.
     * Returns the full memory list in insertion order.
     *
     * @returns Array of all memory locations
     */
    getAllMemory(): IMemoryLocation[];

    /**
     * Get all metrics memory locations matching a given visibility tier.
     *
     * Fragment tags follow the `metrics:*` namespace convention and are
     * classified into three visibility tiers: `'display'`, `'promote'`,
     * and `'private'`. This method filters all memory locations to those
     * with metrics tags belonging to the specified tier.
     *
     * @param visibility The visibility tier to filter by
     * @returns Array of memory locations in the requested tier
     *
     * @example
     * ```typescript
     * // Get metrics visible in the UI card
     * const displayLocs = block.getMetricMemoryByVisibility('display');
     *
     * // Get all tiers for debug view
     * const all = (['display', 'promote', 'private'] as const)
     *   .flatMap(v => block.getMetricMemoryByVisibility(v));
     * ```
     */
    getMetricMemoryByVisibility(visibility: MetricVisibility): IMemoryLocation[];

    /**
     * Indicates whether this block has completed execution.
     * When true, the stack will pop this block during its next completion sweep.
     * 
     * @remarks
     * - Set by behaviors when their completion condition is met
     * - Read by the stack after action/event processing
     * - Once true, should not be reset to false
     */
    readonly isComplete: boolean;

    /**
     * The reason this block was completed, if any.
     * 
     * Set by `markComplete(reason)`. Common values:
     * - `'user-advance'` — user clicked next (self-pop)
     * - `'forced-pop'` — parent popped this block (e.g., timer expiry)
     * - `'timer-expired'` — block's own timer completed
     * - `'rounds-complete'` — all rounds finished
     * 
     * Available during `onUnmount` so output behaviors can include
     * completion context in the emitted output.
     */
    readonly completionReason?: string;

    /**
     * Marks the block as complete. Idempotent - subsequent calls have no effect.
     * Called by behaviors when their completion condition is met.
     * 
     * @param reason Optional reason for completion (for debugging/history)
     */
    markComplete(reason?: string): void;
}
