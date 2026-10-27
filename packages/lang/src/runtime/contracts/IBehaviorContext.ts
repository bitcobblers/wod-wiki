import { IEvent } from './events/IEvent';
import { IRuntimeAction } from './IRuntimeAction';
import type { IBlockRef } from './primitives/IBlockRef';
import type { INowProvider } from '../INowProvider';
import { IRuntimeClock } from './IRuntimeClock';
import { IMetric } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { OutputStatementType } from '@bitcobblers/wod-wiki-core';
import { IMemoryLocation, MemoryTag } from '../memory/MemoryLocation';

import { HandlerScope } from './events/IEventBus';

/**
 * Unsubscribe function returned by subscribe().
 */
export type Unsubscribe = () => void;

/**
 * Event types that behaviors can subscribe to.
 */
export type BehaviorEventType =
  | 'tick'
  | 'next'
  | 'timer:complete'
  | 'timer:reset'
  | 'timer:pause'
  | 'timer:resume'
  | 'timer:skip-attempt'
  | 'pause'
  | 'resume'
  | '*';

/**
 * Listener function for behavior event subscriptions.
 */
export type BehaviorEventListener = (event: IEvent, ctx: IBehaviorContext) => IRuntimeAction[];

/**
 * Options for subscribing to events.
 */
export interface SubscribeOptions {
    /**
     * Handler scope for this subscription.
     * - `'active'` (default): Only fires when this block is the active (top-of-stack) block
     * - `'bubble'`: Fires when this block is anywhere on the stack (parent hears child events)
     * - `'global'`: Always fires regardless of stack state
     */
    scope?: HandlerScope;
}

/**
 * Options for emitting an output statement.
 */
export interface OutputOptions {
    /** Human-readable label for the output */
    label?: string;

    /**
     * Reason the block completed.
     * 
     * Propagated to OutputStatement so downstream consumers can distinguish:
     * - `'user-advance'` — self-pop (user clicked next)
     * - `'forced-pop'` — parent-pop (parent timer expired, etc.)
     * - `'timer-expired'` — block's own timer completed
     */
    completionReason?: string;
}

/**
 * IBehaviorContext is the unified context object passed to behavior lifecycle hooks.
 * 
 * It provides everything a behavior needs to interact with the runtime:
 * - Access to the block and clock
 * - Event subscription during mount (for tick, next, etc.)
 * - Output emission at any lifecycle point
 * - Typed memory access
 * - Block completion control
 * 
 * ## Design Philosophy
 * 
 * This context replaces the old `(block, clock)` tuple with a richer API that:
 * 1. **Enables event subscription**: Behaviors can register for tick/next events during mount
 * 2. **Supports output emission**: Behaviors emit IOutputStatements at any lifecycle point
 * 3. **Provides typed memory**: Read and write to block-owned memory with type safety
 * 4. **Separates events from outputs**: Events are coordination, outputs are reporting
 * 
 * @example
 * ```typescript
 * class TimerBehavior implements IRuntimeBehavior {
 *   onMount(ctx: IBehaviorContext) {
 *     // Subscribe to tick events
 *     ctx.subscribe('tick', (event, ctx) => {
 *       const [timerLoc] = ctx.getMemoryByTag('time');
 *       if (timer?.elapsed >= timer?.duration) {
 *         ctx.markComplete('timer:complete');
 *       }
 *       return [];
 *     });
 *     
 *     // Emit segment started output
 *     ctx.emitOutput('segment', [timerFragment], { label: '5:00 countdown' });
 *     
 *     return [];
 *   }
 *   
 *   onUnmount(ctx: IBehaviorContext) {
 *     // Emit a milestone marking this behavior's own completion. The block's
 *     // final 'segment' output (carrying completionReason) is emitted separately
 *     // by the runtime when the block pops — behaviors should not emit their own
 *     // 'segment'/'completion'-shaped output on unmount; see ReportOutputBehavior
 *     // for the canonical pattern (write result memory, let the pop emit the segment).
 *     ctx.emitOutput('milestone', [elapsedFragment], { label: 'Timer Complete' });
 *     return [];
 *   }
 * }
 * ```
 */
export interface IBehaviorContext {
    // ============================================================================
    // Core References
    // ============================================================================

    /** The block this behavior is attached to */
    readonly block: IBlockRef;

    /** Current runtime clock */
    readonly clock: IRuntimeClock;
    /** Live wall-clock provider, independent of execution snapshots. */
    readonly nowProvider: INowProvider;

    /**
     * Current stack level (depth) of the block.
     * 0 = root block, 1 = first child, etc.
     */
    readonly stackLevel: number;

    // ============================================================================
    // Event Subscription
    // ============================================================================

    /**
     * Subscribe to runtime events.
     * 
     * Subscriptions are automatically cleaned up when the block unmounts.
     * By default, the listener only fires when this block is the active block.
     * Use `{ scope: 'bubble' }` to receive events when a child block is active
     * (e.g., parent timer tracking ticks while children execute).
     * 
     * @param eventType The event type to subscribe to ('tick', 'next', etc.)
     * @param listener The callback to invoke when the event fires
     * @param options Optional settings including handler scope
     * @returns Unsubscribe function (usually not needed as cleanup is automatic)
     * 
     * @example
     * ```typescript
     * onMount(ctx) {
     *   // Active scope (default) — only fires when this block is on top
     *   ctx.subscribe('next', (event, ctx) => {
     *     return [];
     *   });
     *   
     *   // Bubble scope — fires even when a child block is active
     *   ctx.subscribe('tick', (event, ctx) => {
     *     // Track timer even when child effort blocks are executing
     *     return [];
     *   }, { scope: 'bubble' });
     * }
     * ```
     */
    subscribe(eventType: BehaviorEventType, listener: BehaviorEventListener, options?: SubscribeOptions): Unsubscribe;

    // ============================================================================
    // Event Emission
    // ============================================================================

    /**
     * Emit an event to the runtime event bus.
     * 
     * Use this for **coordination** — triggering reactions in other parts of the system.
     * For example: 'timer:started', 'timer:complete', 'pause', 'resume'.
     * 
     * @param event The event to emit
     */
    emitEvent(event: IEvent): void;

    // ============================================================================
    // Output Emission
    // ============================================================================

    /**
     * Emit an output statement.
     * 
     * Use this for **reporting** — recording what happened during execution.
     * Output statements are collected by the runtime and made available to UI/history.
     * 
     * Output can be emitted at any lifecycle point:
     * - onMount: 'segment' started
     * - onNext: 'segment' per iteration, 'milestone' events
     * - onUnmount: write final results to memory (see ReportOutputBehavior) rather
     *   than emitting directly — the runtime emits exactly one 'segment' output per
     *   block pop, carrying those results plus a `completionReason` field
     *
     * @param type The type of output ('segment', 'milestone', 'metric', 'label')
     * @param metrics The data metrics that make up this output
     * @param options Optional metadata (label)
     *
     * @example
     * ```typescript
     * // Emit a segment for round 3
     * ctx.emitOutput('segment', [
     *   { metricType: MetricType.Rounds, value: 3, origin: 'runtime' }
     * ], { label: 'Round 3 of 5' });
     *
     * // Emit a milestone marking a notable event mid-execution
     * ctx.emitOutput('milestone', [
     *   { metricType: MetricType.Duration, value: elapsed, origin: 'runtime' }
     * ], { label: 'Halfway' });
     * ```
     */
    emitOutput(
        type: OutputStatementType,
        metrics: MetricContainer | IMetric[],
        options?: OutputOptions
    ): void;

    // ============================================================================
    // Memory Access
    // ============================================================================

    // ============================================================================
    // List-Based Memory API
    // ============================================================================

    /**
     * Push a new memory location with metrics data onto the block's memory list.
     *
     * This creates a new MemoryLocation internally and returns it for potential updates.
     * Multiple locations with the same tag can coexist on the same block.
     *
     * @param tag The memory tag (e.g., 'timer', 'metric:display')
     * @param metric The metric array to store at this location
     * @returns The created memory location for optional further manipulation
     *
     * @example
     * ```typescript
     * // Push timer metrics
     * ctx.pushMemory('time', [timerFragment]);
     *
     * // Push display row (metrics:display)
     * ctx.pushMemory('metric:display', [timerFrag, actionFrag, effortFrag]);
     * ```
     */
    pushMemory(tag: MemoryTag, metrics: MetricContainer | IMetric[]): IMemoryLocation;

    /**
     * Get all memory locations matching the given tag.
     * Delegates to block.getMemoryByTag — use this inside behaviors instead of
     * the deprecated getMemory() shim.
     */
    getMemoryByTag(tag: MemoryTag): IMemoryLocation[];

    /**
     * Update the first matching memory location with new metrics data.
     *
     * Convenience method for updating existing memory without managing references.
     * If no location with the given tag exists, this is a no-op.
     *
     * @param tag The memory tag to update
     * @param metrics The new metrics array
     *
     * @example
     * ```typescript
     * // Update timer metrics with new elapsed time
     * ctx.updateMemory('time', [updatedTimerMetric]);
     * ```
     */
    updateMemory(tag: MemoryTag, metrics: MetricContainer | IMetric[]): void;

    // ============================================================================
    // Capability Registry
    // ============================================================================

    /**
     * Declare that this block (via one of its behaviors) provides the named
     * capability. Other behaviors on the same block can then coordinate with
     * the declarer via `hasCapability` instead of string-inspecting
     * `behaviors[i].constructor.name`.
     *
     * Capabilities are block-scoped: they are declared during `onMount`
     * and consulted at any lifecycle hook. Declaring an unknown capability
     * is a no-op (capabilities are loose strings, not an enum).
     *
     * @param cap Capability identifier (e.g. `'childSelection'`)
     */
    declareCapability(cap: string): void;

    /**
     * Returns true if the named capability was declared on this block.
     *
     * Use this to coordinate between behaviors that share a block without
     * importing each other or relying on `constructor.name`.
     *
     * @param cap Capability identifier (e.g. `'childSelection'`)
     */
    hasCapability(cap: string): boolean;

    /**
     * Returns the Set used to store declared capabilities.  Internal callers
     * (e.g. `RuntimeBlock.inspectNext`) pass this back to a fresh
     * `BehaviorContext` so that all contexts for the same block observe the
     * same capabilities without coupling the inspection context to a
     * specific owner.
     */
    getCapabilities(): Set<string>;

    // ============================================================================
    // Block Control
    // ============================================================================

    /**
     * Mark the block as complete.
     *
     * When marked complete, the block will be popped from the stack
     *
     * @param reason Optional reason for completion (for debugging/history)
     */
    markComplete(reason?: string): void;

}
