import { IScriptRuntime } from './contracts/IScriptRuntime';
import { IRuntimeAction } from './contracts/IRuntimeAction';
import { IRuntimeContext } from './contracts/IRuntimeContext';
import { SnapshotClock } from './RuntimeClock';
import { IOutputStatement } from '@bitcobblers/wod-wiki-core';
import { IEvent } from './contracts/events/IEvent';
import { EmitSystemOutputAction } from './actions/stack/EmitSystemOutputAction';

/**
 * ExecutionContext manages a "turn" of execution.
 *
 * It wraps a runtime and ensures that all actions pushed during the turn
 * see a consistent frozen clock and share an execution depth limit.
 *
 * This class declares only the narrow {@link IRuntimeContext} surface — the
 * collaborators and verbs the execution world (actions, blocks, behaviors)
 * actually uses mid-turn. The wide `IScriptRuntime` members (subscribeTo*,
 * finalizeAnalytics, setAnalyticsEngine, pushBlock/popBlock, dispose) stay on
 * `ScriptRuntime` for external drivers; they are NOT re-declared here, so
 * adding a member to `IScriptRuntime` no longer forces a matching pass-through.
 *
 * ## Stack Semantics (LIFO)
 *
 * Actions are processed using a **stack** (Last-In-First-Out). When an action
 * produces child actions via `runtime.do()`, those children are pushed onto the
 * stack and executed **before** returning to any remaining sibling actions.
 *
 * This ensures that nested operations (e.g., a pop that triggers a parent.next()
 * which pushes a new child) complete their full depth before processing continues
 * at the parent level — mirroring the natural call-stack behavior of block
 * lifecycle operations.
 *
 * ## Lifecycle
 *
 * 1. Created by `ScriptRuntime.do()` or `ScriptRuntime.handle()` when no active context exists
 * 2. Clock is frozen at creation time (SnapshotClock)
 * 3. Actions are executed from the stack until empty
 * 4. Context is discarded — all actions in the turn shared the same frozen timestamp
 */
export class ExecutionContext implements IRuntimeContext {
    private readonly _workList: IRuntimeAction[] = [];
    private _iteration = 0;
    private readonly _maxIterations: number;
    private readonly _snapshotClock: SnapshotClock;

    constructor(
        private readonly _runtime: IScriptRuntime,
        maxIterations = 20
    ) {
        this._maxIterations = maxIterations;
        // Freeze the clock at the start of the execution context
        this._snapshotClock = SnapshotClock.at(_runtime.clock, _runtime.clock.currentDate);
    }

    // --- Collaborators (delegated to the underlying runtime) ---

    get script() { return this._runtime.script; }
    get eventBus() { return this._runtime.eventBus; }
    get stack() { return this._runtime.stack; }
    get options() { return this._runtime.options; }
    get jit() { return this._runtime.jit; }
    get errors() { return this._runtime.errors; }
    get analyticsContext() { return this._runtime.analyticsContext; }

    // Use our frozen clock instead of the live runtime clock
    get clock() { return this._snapshotClock; }
    get nowProvider() { return this._runtime.nowProvider; }

    addOutput(output: IOutputStatement): void {
        this._runtime.addOutput(output);
    }

    /**
     * Pushes an action onto the execution work list to be processed in this turn.
     * Actions pushed during another action's execution land on top of the stack
     * (LIFO / Depth-First semantics).
     */
    do(action: IRuntimeAction): void {
        this._workList.unshift(action);
    }

    /**
     * Pushes multiple actions onto the work list. Land on top of the stack
     * in the order provided (first element on very top).
     */
    doAll(actions: IRuntimeAction[]): void {
        if (actions.length === 0) return;
        this._workList.unshift(...actions);
    }

    /**
     * Dispatches an event and pushes all resulting actions onto the work list.
     */
    handle(event: IEvent): void {
        const actions = this.eventBus.dispatch(event, this);
        if (actions.length > 0) {
            // `source` is an optional attribution carried by some concrete events
            // beyond the IEvent base; narrow it rather than asserting a shape.
            const source = ('source' in event && typeof event.source === 'string')
                ? event.source
                : 'event-bus';
            const systemOutput = new EmitSystemOutputAction(
                `event: ${event.name} → ${actions.length} action(s)`,
                'event-action',
                source,
                undefined,
                this.stack.count,
                { eventName: event.name, actionTypes: actions.map(a => a.type) }
            );
            this.doAll([systemOutput, ...actions]);
        } else {
            this.doAll(actions);
        }
    }

    /**
     * Executes an initial action and then all subsequent actions on the work list until empty.
     *
     * Uses an 'Ordered Stack' model:
     * 1. **Queued actions (do)** are appended to the back (FIFO).
     * 2. **Returned actions (children)** are prepended to the front (Depth-First).
     * 3. **Execution** always takes from the front.
     *
     * This ensures that nested operations (e.g., a pop that triggers a parent.next())
     * complete their full depth before processing continues at the sibling level,
     * while explicitly queued side-effects run in the order they were triggered.
     *
     * @throws Error if max iterations reached
     */
    execute(initialAction: IRuntimeAction): void {
        this._workList.push(initialAction);

        while (this._workList.length > 0) {
            if (this._iteration >= this._maxIterations) {
                throw new Error(`[ExecutionContext] Max iterations reached (${this._maxIterations}). Aborting to prevent infinite loop.`);
            }

            // Always take from the front
            const action = this._workList.shift()!;
            this._iteration++;

            // Execute the action using THIS context as the runtime.
            const childActions = action.do(this);

            // If the action returned child actions, prepend them to the front
            // of the work list to maintain depth-first processing.
            if (childActions && childActions.length > 0) {
                this._workList.unshift(...childActions);
            }
        }
    }
}
