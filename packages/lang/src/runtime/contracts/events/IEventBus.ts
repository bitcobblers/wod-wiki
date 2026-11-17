import type { IEvent } from './IEvent';
import type { IEventDispatchContext } from '../primitives/IEventDispatchContext';
import type { IRuntimeAction } from '../IRuntimeAction';
import type { IEventHandler } from './IEventHandler';

/**
 * Simple callback type for UI event listeners that don't produce actions.
 *
 * Receives an {@link IEventDispatchContext} — the same primitive used by
 * {@link IEventBus.dispatch} — so callbacks can rely on the stack
 * accessors and `handle()` / `do()` surface the bus already requires.
 * This avoids importing `IScriptRuntime` (which would re-introduce the
 * `IEventBus ↔ IScriptRuntime` cycle) while keeping the contract
 * type-accurate. Concrete callbacks are free to narrow the parameter type
 * to `IScriptRuntime`.
 */
export type EventCallback = (event: IEvent, runtime: IEventDispatchContext) => void;

/**
 * Handler scope determines when a handler receives events.
 *
 * - 'active' (default): Only fires when the owner block is the current/active block on the stack.
 * - 'bubble': Fires when the owner block is anywhere on the stack (allows parent listening).
 * - 'global': Always fires regardless of stack state (for runtime-level handlers).
 */
export type HandlerScope = 'active' | 'bubble' | 'global';

/**
 * Options for registering an event handler.
 */
export interface EventHandlerOptions {
    /** Handler priority (higher priority handlers execute first). Default: 0 */
    priority?: number;
    /** Handler scope determining when it receives events. Default: 'active' */
    scope?: HandlerScope;
}

export interface IEventBus {
    /**
     * Register a full event handler that can produce runtime actions.
     * Used for runtime-internal event processing.
     *
     * @param eventName - The event name to listen for ('*' for all events)
     * @param handler - The event handler
     * @param ownerId - The owner block ID (used for scope filtering and cleanup)
     * @param options - Handler options including priority and scope
     * @returns Unsubscribe function
     */
    register(
        eventName: string,
        handler: IEventHandler,
        ownerId: string,
        options?: EventHandlerOptions
    ): () => void;

    /**
     * Register a simple callback for event notifications.
     * Used for UI components that need to react to events without producing actions.
     * Returns an unsubscribe function.
     */
    on(eventName: string, callback: EventCallback, ownerId: string): () => void;

    unregisterById(handlerId: string): void;
    unregisterByOwner(ownerId: string): void;

    /**
     * Dispatch an event and return the resulting actions without executing them.
     * Used internally when actions need special handling.
     *
     * @param event - The event to dispatch.
     * @param runtime - The runtime context. Typed as the
     * {@link IEventDispatchContext} primitive so the implementation can rely
     * on `stack` (for scope filtering) and `errors` (for early-exit) without
     * importing `IScriptRuntime` and re-introducing the
     * `IEventBus ↔ IScriptRuntime` cycle.
     */
    dispatch(event: IEvent, runtime: IEventDispatchContext): IRuntimeAction[];

    /**
     * Dispatch an event and execute all resulting actions immediately.
     * This is the primary entry point for event handling.
     *
     * @param event - The event to dispatch
     * @param runtime - The runtime context. Typed as the
     * {@link IEventDispatchContext} primitive so the implementation can call
     * `runtime.handle(event)` without importing `IScriptRuntime`.
     */
    emit(event: IEvent, runtime: IEventDispatchContext): void;

    /**
     * Dispose of all handlers and callbacks, releasing all references.
     * Call this during runtime cleanup to prevent memory leaks.
     */
    dispose(): void;
}
