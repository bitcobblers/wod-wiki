import type { IScriptRuntime, OutputListener } from './contracts/IScriptRuntime';
import type { IJitCompiler } from './contracts/IJitCompiler';
import type { IRuntimeStack, Unsubscribe, StackObserver, StackSnapshot } from './contracts/IRuntimeStack';
import type { WhiteboardScript } from '../parser/WhiteboardScript';
import type { RuntimeError } from './actions/ErrorAction';
import type { IEventBus } from './contracts/events/IEventBus';
import {
    DEFAULT_RUNTIME_OPTIONS,
    RuntimeStackOptions
} from './contracts/IRuntimeOptions';
import { IRuntimeClock } from './contracts/IRuntimeClock';
import { NextEventHandler } from './events/NextEventHandler';
import { AbortEventHandler } from './events/AbortEventHandler';
import { IOutputStatement } from '@bitcobblers/wod-wiki-core';
import type { IRuntimeAction } from './contracts/IRuntimeAction';
import { IEvent } from './contracts/events/IEvent';
import { ExecutionContext } from './ExecutionContext';
import { OutputEmitter } from './OutputEmitter';
import { RuntimeObservers } from './RuntimeObservers';
import { PushBlockAction } from './actions/stack/PushBlockAction';
import { PopBlockAction } from './actions/stack/PopBlockAction';
import { IAnalyticsEngine } from '../analytics/contracts/IAnalyticsEngine';
import type { AnalyticsContext } from '../analytics/AnalyticsContext';
import type { INowProvider } from './INowProvider';
import { wallClockNow } from './INowProvider';
import { RuntimeLogger } from './RuntimeLogger';

export type RuntimeState = 'idle' | 'running' | 'compiling' | 'completed';

export interface ScriptRuntimeDependencies {
    stack: IRuntimeStack;
    clock: IRuntimeClock;
    eventBus: IEventBus;
}

export class ScriptRuntime implements IScriptRuntime {

    public readonly eventBus: IEventBus;
    public readonly clock: IRuntimeClock;
    public readonly stack: IRuntimeStack;
    public readonly jit: IJitCompiler;

    public readonly errors: RuntimeError[] = [];
    public readonly options: RuntimeStackOptions;
    public analyticsContext?: AnalyticsContext;

    // Single module owning the output buffer, subscriber notification,
    // analytics enrichment, and all runtime emission helpers.
    private readonly _output = new OutputEmitter();

    // Shared observer collaborator — owns the stack subscriber Set and the
    // post-mount snapshot contract. See `RuntimeObservers` for the seam.
    private readonly _observers: RuntimeObservers;

    // The current execution context for the "turn"
    private _activeContext: ExecutionContext | null = null;
    private readonly _now: INowProvider;


    // Unsubscribe function for the IRuntimeStack → stack snapshot bridge.
    // The stack-snapshot fan-out itself is owned by _observers (see
    // RuntimeObservers); this field only holds the unsubscribe for the
    // upstream `this.stack.subscribe(...)` call in the constructor.
    private _stackSubscriptionUnsub: (() => void) | null = null;

    // Unsubscribe function for the global NextEventHandler
    private _nextHandlerUnsub: (() => void) | null = null;

    public get nowProvider(): INowProvider {
        return this._now;
    }

    // Unsubscribe function for the global AbortEventHandler
    private _abortHandlerUnsub: (() => void) | null = null;

    constructor(
        public readonly script: WhiteboardScript,
        compiler: IJitCompiler,
        dependencies: ScriptRuntimeDependencies,
        options: RuntimeStackOptions = {},
        now: INowProvider = wallClockNow
    ) {
        // Merge with defaults
        this.options = { ...DEFAULT_RUNTIME_OPTIONS, ...options };

        this._observers = new RuntimeObservers(this.options.logger);

        this.stack = dependencies.stack;
        this.clock = dependencies.clock;
        this.eventBus = dependencies.eventBus;
        this._now = now;

        // Handle explicit next events to advance the current block once per request
        this._nextHandlerUnsub = this.eventBus.register('next', new NextEventHandler('runtime-next-handler'), 'runtime', { scope: 'global' });

        // Handle abort events to force-terminate the session
        this._abortHandlerUnsub = this.eventBus.register('abort', new AbortEventHandler('runtime-abort-handler'), 'runtime', { scope: 'global' });

        this.jit = compiler;

        // Wire the OutputEmitter's runtime deps once — the emission helpers
        // read clock/stack/script from here instead of taking them per call.
        this._output.attach({ clock: this.clock, stack: this.stack, script: this.script });

        // Bridge stack events to StackSnapshot observers and emit system outputs.
        // The stack-snapshot fan-out is owned by RuntimeObservers; we just
        // translate the IRuntimeStack event into a StackSnapshot and delegate.
        this._stackSubscriptionUnsub = this.stack.subscribe((event) => {
            if (event.type === 'pop') {
                this._output.emitSegmentFromResultMemory(event.block, event.depth);
            }

            // Emit system output for push/pop events
            if (event.type === 'push' || event.type === 'pop') {
                this._output.emitStackEvent(event);
            }

            // Notify stack observers via the shared collaborator
            const snapshot: StackSnapshot = {
                type: event.type === 'initial' ? 'initial' : event.type,
                blocks: event.type === 'initial' ? event.blocks : event.blocks,
                affectedBlock: event.type !== 'initial' ? event.block : undefined,
                depth: event.type === 'initial' ? event.blocks.length : event.depth,
                clockTime: this.clock.currentDate,
            };
            this._observers.emitStack(snapshot);
        });

        // Start the clock
        this.clock.start();

        // Emit 'load' output with initial state
        this._output.emitLoad();

        // Paper-format BOOT line when debug logging is on (prototype tier 04).
        RuntimeLogger.logBoot(`statements ${this.script.statements.length}`);
    }

    /**
     * Executes an action within a managed execution context (a "turn").
     * Actions can queue further actions which will be processed in the same turn.
     * Time is frozen during the turn.
     */
    public do(action: IRuntimeAction): void {
        if (this._activeContext) {
            this._activeContext.do(action);
            return;
        }

        this._activeContext = new ExecutionContext(this, this.options.maxActionDepth ?? 20);
        try {
            this._activeContext.execute(action);
        } finally {
            this._activeContext = null;
            // POST-MOUNT SNAPSHOT INVARIANT (see
            // tests/runtime-compliance/post-mount-snapshot-invariant.compliance.test.ts):
            // Snapshots reflect post-mount state. A block whose onMount has not
            // completed must not appear in a snapshot. We re-notify stack observers
            // here — AFTER the full execution turn (push + mount + child pushes) —
            // so blocks that initialize timer memory during onMount are serialized
            // with correct timer data. Without this, leaf blocks (no children pushed
            // on mount) would have timer:null in the Chromecast snapshot because
            // push fires before mount initializes memory.
            this._notifyStackSettled();
        }
    }

    /** Build the 'initial' snapshot of the current stack. Shared by settle-time
     *  notification (sync, all observers) and subscribe-time catch-up (deferred,
     *  new observer only). The two delivery timings differ deliberately — see
     *  the call sites. */
    private _buildInitialSnapshot(): StackSnapshot {
        const blocks = this.stack.blocks;
        return {
            type: 'initial',
            blocks,
            depth: blocks.length,
            clockTime: this.clock.currentDate,
        };
    }

    private _notifyStackSettled(): void {
        // Delegate the post-turn re-emit to the shared collaborator. The
        // collaborator owns the post-mount snapshot contract — it skips
        // fan-out when there are no subscribers or the stack is empty.
        this._observers.emitSettled(
            this.stack.blocks,
            this.stack.count,
            this.clock.currentDate,
        );
    }

    /**
     * Pushes multiple actions onto the execution stack in the correct order
     * for LIFO processing. The first action in the array will execute first.
     * 
     * If called within an active execution context, delegates to it.
     * Otherwise, wraps in a new context as a composite action.
     */
    public doAll(actions: IRuntimeAction[]): void {
        if (actions.length === 0) return;
        if (this._activeContext) {
            this._activeContext.doAll(actions);
            return;
        }

        // No active context — create one with a composite wrapper that returns actions
        this.do({
            type: 'composite-doAll',
            do: () => actions
        });
    }

    /**
     * Dispatches an event to the event bus and executes any resulting actions
     * within a single execution turn.
     */
    public handle(event: IEvent): void {
        const actions = this.eventBus.dispatch(event, this);

        // Only emit 'event' output if it's NOT a tick event OR if it produced actions
        // This prevents flooding the log with empty tick cycles
        if (event.name !== 'tick' || actions.length > 0) {
            this._output.emitRuntimeEvent(event);
        }

        if (actions.length === 0) return;

        this.doAll(actions);
    }

    // ========== Output Statement API ==========

    /**
     * Subscribe to output statements generated during execution.
     */
    public subscribeToOutput(listener: OutputListener): Unsubscribe {
        return this._output.subscribe(listener);
    }

    /**
     * Get all output statements generated so far.
     */
    public getOutputStatements(): IOutputStatement[] {
        return this._output.getAll();
    }

    /**
     * Ephemeral Tier-2 (running-total) snapshot for live display; never persisted.
     */
    public getLiveAnalytics(): IOutputStatement[] {
        return this._output.getLiveAnalytics();
    }

    /**
     * Add an output statement to the collection and notify subscribers.
     * Used by BehaviorContext to emit outputs at any lifecycle point.
     */
    public addOutput(output: IOutputStatement): void {
        this._output.add(output);
    }

    public setAnalyticsEngine(engine: IAnalyticsEngine): void {
        this._output.setAnalyticsEngine(engine);
    }

    /**
     * Finalize the analytics engine and return any summary output statements.
     */
    public finalizeAnalytics(): IOutputStatement[] {
        return this._output.finalizeAnalytics();
    }

    // ========== Stack Observer API ==========

    /**
     * Subscribe to stack snapshots. The observer receives a StackSnapshot
     * on every push/pop/clear event. New subscribers immediately receive
     * an 'initial' snapshot with the current stack state.
     */
    public subscribeToStack(observer: StackObserver): Unsubscribe {
        const unsub = this._observers.subscribeToStack(observer);

        // Immediate notification of current state, deferred to next tick to
        // avoid React render warnings. The collaborator is timing-agnostic;
        // each adapter owns its own initial-snapshot policy (the proxy fires
        // synchronously; ScriptRuntime defers). We call the observer
        // directly — `emitStack` is a broadcast and would re-deliver to all
        // existing subscribers, which is not the catch-up behavior either
        // adapter had before this refactor.
        // Build the snapshot at delivery time, not subscribe time: mutations
        // between subscription and the deferred delivery (e.g. the tour's
        // microtask gate-pop) would otherwise deliver a stale snapshot that
        // clobbers fresher push/pop notifications.
        setTimeout(() => {
            // Re-check membership: the observer may have unsubscribed before
            // the deferred callback fired.
            if (!this._observers.hasStackObserver(observer)) return;
            try {
                observer(this._buildInitialSnapshot());
            } catch (err) {
                console.error('[RT] Stack observer error (initial):', err);
            }
        }, 0);

        return unsub;
    }

    /**
     * Cleanup method that properly unmounts and disposes all blocks in the stack.
     */
    public dispose(): void {
        // Stop the clock
        this.clock.stop();

        // Properly unmount and dispose each block (top-down)
        while (this.stack.count > 0) {
            const block = this.stack.current;
            if (block) {
                try {
                    block.unmount(this);
                } catch {
                    // Swallow errors during emergency cleanup
                }
                this.stack.pop();
                try {
                    block.dispose(this);
                } catch {
                    // Swallow errors during emergency cleanup
                }
            } else {
                this.stack.pop();
            }
        }

        // Unregister the global NextEventHandler
        if (this._nextHandlerUnsub) {
            this._nextHandlerUnsub();
            this._nextHandlerUnsub = null;
        }

        // Unregister the global AbortEventHandler
        if (this._abortHandlerUnsub) {
            this._abortHandlerUnsub();
            this._abortHandlerUnsub = null;
        }

        // Clear output state to release references
        this._output.dispose();

        // Unsubscribe the IRuntimeStack → stack snapshot bridge.
        if (this._stackSubscriptionUnsub) {
            this._stackSubscriptionUnsub();
            this._stackSubscriptionUnsub = null;
        }

        // Drop all stack + tracker subscribers (and any upstream tracker
        // subscription the collaborator holds) in one call.
        this._observers.dispose();

        // Clear the event bus
        this.eventBus.dispose();
    }

    /**
     * Pushes a block onto the runtime stack.
     * This is a convenience method that wraps PushBlockAction.
     * Also handles hooks, tracking, wrapping, and logging if configured.
     * 
     * @param block The block to push
     * @param lifecycle Optional lifecycle options (startTime, etc.)
     */
    public pushBlock(block: import('./contracts/IRuntimeBlock').IRuntimeBlock, lifecycle?: import('./contracts/IRuntimeBlock').BlockLifecycleOptions): void {
        const parentBlock = this.stack.current;

        // Call before hooks
        this.options.hooks?.onBeforePush?.(block, parentBlock);

        // Emit 'compiler' output for the new block
        this._output.emitCompilerBlock(block);

        // Wrap block if wrapper is configured
        const wrappedBlock = this.options.wrapper?.wrap?.(block, parentBlock) ?? block;

        // Execute the push action
        this.do(new PushBlockAction(wrappedBlock, lifecycle));

        // Log the push
        this.options.logger?.debug?.('runtime.pushBlock', {
            blockKey: block.key.toString(),
            parentKey: parentBlock?.key.toString(),
        });

        // Call after hooks
        this.options.hooks?.onAfterPush?.(wrappedBlock, parentBlock);
    }

    /**
     * Pops the current block from the runtime stack.
     * This is a convenience method that wraps PopBlockAction.
     * Handles the full lifecycle: unmount, pop, dispose, and parent notification.
     * Also handles hooks, tracking, wrapping cleanup, and logging if configured.
     * 
     * @param lifecycle Optional lifecycle options (createdAt, etc.)
     */
    public popBlock(lifecycle?: import('./contracts/IRuntimeBlock').BlockLifecycleOptions): void {
        const currentBlock = this.stack.current;
        if (!currentBlock) {
            return;
        }

        // Call before hooks
        this.options.hooks?.onBeforePop?.(currentBlock);

        // Execute the pop action (which handles unmount, dispose, output statement, parent.next)
        this.do(new PopBlockAction(lifecycle));

        // Cleanup wrapper
        this.options.wrapper?.cleanup?.(currentBlock);

        // Unregister hooks by owner
        this.options.hooks?.unregisterByOwner?.(currentBlock.key.toString());

        // Log the pop
        this.options.logger?.debug?.('runtime.popBlock', {
            blockKey: currentBlock.key.toString(),
            stackDepth: this.stack.count,
        });

        // Call after hooks
        this.options.hooks?.onAfterPop?.(currentBlock);
    }
}
