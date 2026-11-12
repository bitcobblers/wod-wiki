import type { WhiteboardScript } from '../../parser/WhiteboardScript';
import type { RuntimeError } from './IRuntimeError';
import type { IEventBus } from './events/IEventBus';
import type { IRuntimeStack, Unsubscribe, StackObserver } from './IRuntimeStack';
import type { IRuntimeClock } from './IRuntimeClock';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-core';
import type { IRuntimeAction } from './IRuntimeAction';
import type { IEvent } from './events/IEvent';
import type { IAnalyticsEngine } from '../../analytics/contracts/IAnalyticsEngine';
import type { ProjectionResult } from '../../analytics/ProjectionResult';
import type { RuntimeStackOptions } from './IRuntimeOptions';
import type { IRuntimeActionable } from './primitives/IRuntimeActionable';
import type { BlockLifecycleOptions } from './primitives/IBlockLifecycle';
import type { IRuntimeBlock } from './IRuntimeBlock';
import type { AnalyticsContext } from '../../analytics/AnalyticsContext';
import type { INowProvider } from '../INowProvider';
import type { IJitCompiler } from './IJitCompiler';
export type { IJitCompiler };


/**
 * Listener callback for output statement events.
 */
export type OutputListener = (output: IOutputStatement) => void;

export interface IScriptRuntime extends IRuntimeActionable {
    options: RuntimeStackOptions;
    script: WhiteboardScript;

    eventBus: IEventBus;
    stack: IRuntimeStack;

    jit: IJitCompiler;
    clock: IRuntimeClock;
    nowProvider: INowProvider;

    /** Errors collected during runtime execution */
    errors?: RuntimeError[];

    /** Optional analytics context for compile-time effort enrichment. */
    analyticsContext?: AnalyticsContext;

    /**
     * Executes an action at the next available opportunity.
     * Actions are processed in "turns" where time is frozen and 
     * nested actions are allowed up to a recursion limit.
     */
    do(action: IRuntimeAction): void;

    /**
     * Pushes multiple actions onto the execution stack in the correct order
     * for LIFO processing. The first action in the array will execute first.
     * 
     * This method internalizes the reverse-push pattern so callers don't need
     * to know about LIFO stack mechanics — they just pass actions in the order
     * they want them executed.
     * 
     * @param actions Actions to execute, in desired execution order
     */
    doAll(actions: IRuntimeAction[]): void;

    /**
     * Dispatches an event and executes all resulting actions in a single turn.
     */
    handle(event: IEvent): void;

    /**
     * Pushes a block onto the runtime stack.
     * This is a convenience method that wraps PushBlockAction.
     * 
     * @param block The block to push
     * @param lifecycle Optional lifecycle options (startTime, etc.)
     */
    pushBlock(block: IRuntimeBlock, lifecycle?: BlockLifecycleOptions): void;

    /**
     * Pops the current block from the runtime stack.
     * This is a convenience method that wraps PopBlockAction.
     * Handles the full lifecycle: unmount, pop, dispose, and parent notification.
     * 
     * @param lifecycle Optional lifecycle options (createdAt, etc.)
     */
    popBlock(lifecycle?: BlockLifecycleOptions): void;

    // ============================================================================
    // Output Statement API
    // ============================================================================

    /**
     * Subscribe to output statements generated during execution.
     * Listeners are notified when a block unmounts and produces output.
     * 
     * @param listener Callback invoked for each output statement
     * @returns Unsubscribe function to stop receiving notifications
     * 
     * @example
     * ```typescript
     * const unsubscribe = runtime.subscribeToOutput((output) => {
     *   console.log(`Block ${output.sourceBlockKey} completed:`, output.outputType);
     *   console.log('Fragments:', output.metrics);
     * });
     * ```
     */
    subscribeToOutput(listener: OutputListener): Unsubscribe;

    /**
     * Get all output statements generated so far during this execution.
     * Returns a copy of the internal array.
     */
    getOutputStatements(): IOutputStatement[];


    /**
     * Ephemeral Tier-2 (running-total) snapshot for live display — the
     * analytics engine's current projection set, replaced each segment.
     * Display-only: never persisted to the output log. Optional because only
     * a concrete runtime with a wired analytics engine produces it; consumers
     * call it defensively (`runtime.getLiveAnalytics?.()`).
     */
    getLiveAnalytics?(): IOutputStatement[];
    /** Typed live Summary Metric projections from the attached AnalyticsEngine. */
    getLiveProjections?(): readonly ProjectionResult[];
    /**
     * Add an output statement to the collection and notify subscribers.
     * Used by BehaviorContext to emit outputs at any lifecycle point.
     * 
     * @param output The output statement to add
     * 
     * @example
     * ```typescript
     * runtime.addOutput(new OutputStatement({
     *   outputType: 'segment',
     *   timeSpan: new TimeSpan(start, end),
     *   sourceBlockKey: block.key.toString(),
     *   completionReason: 'user-advance',
     *   metrics: [],
     * }));
     * ```
     */
    addOutput(output: IOutputStatement): void;

    // ============================================================================
    // Stack Observer API
    // ============================================================================

    /**
     * Subscribe to stack snapshots. The observer receives a StackSnapshot
     * on every push/pop/clear event, containing the full stack state,
     * the affected block, depth, and clock time.
     * 
     * New subscribers immediately receive an 'initial' snapshot with the
     * current stack state.
     * 
     * This is the primary API for UI consumers to react to stack changes.
     * 
     * @param observer Callback invoked with a StackSnapshot on each stack mutation
     * @returns Unsubscribe function to stop receiving notifications
     * 
     * @example
     * ```typescript
     * const unsubscribe = runtime.subscribeToStack((snapshot) => {
     *   console.log(`Stack ${snapshot.type}: depth=${snapshot.depth}`);
     *   if (snapshot.affectedBlock) {
     *     console.log(`Affected: ${snapshot.affectedBlock.label}`);
     *   }
     * });
     * ```
     */
    subscribeToStack(observer: StackObserver): Unsubscribe;

    /**
     * Set the analytics engine for the runtime.
     * The engine will process each output statement as it is added.
     */
    setAnalyticsEngine(engine: IAnalyticsEngine): void;

    /**
     * Finalize the analytics engine and return any summary output statements.
     * These statements are also automatically added to the runtime's internal list.
     */
    finalizeAnalytics(): IOutputStatement[];

    dispose(): void;
}
