import { IEvent } from '../contracts/events/IEvent';
import { v7 as uuidv7 } from 'uuid';
import { IScriptRuntime } from '../contracts/IScriptRuntime';
import { IEventHandler } from '../contracts/events/IEventHandler';
import { IEventBus, EventCallback, HandlerScope, EventHandlerOptions } from '../contracts/events/IEventBus';
import { RuntimeLogger } from '../RuntimeLogger';

export type EventHandlerRegistration = {
  handler: IEventHandler;
  ownerId: string;
  priority: number;
  scope: HandlerScope;
};

type CallbackRegistration = {
  id: string;
  callback: EventCallback;
  ownerId: string;
};

/**
 * Simple in-memory event bus for runtime events.
 * 
 * ## Handler Scope Filtering
 * 
 * Handlers registered via `register()` are filtered by scope before dispatch:
 * - `'active'` (default): Only fires when ownerId matches the current/active block on the stack
 * - `'bubble'`: Fires when ownerId is anywhere on the stack (parent can listen to child events)
 * - `'global'`: Always fires regardless of stack state (for runtime-level handlers)
 * 
 * ## Callbacks vs Handlers
 * 
 * - **Handlers** (via `register()`): Produce `IRuntimeAction[]`, are scope-filtered
 * - **Callbacks** (via `on()`): Simple notifications for UI, are NOT scope-filtered (always fire)
 * 
 * Callbacks are intended for UI components that need to react to all events regardless
 * of which block is active. They do not produce actions and cannot affect runtime state.
 */
export class EventBus implements IEventBus {
  private readonly handlersByEvent: Map<string, EventHandlerRegistration[]> = new Map();
  private readonly callbacksByEvent: Map<string, CallbackRegistration[]> = new Map();

  register(
    eventName: string,
    handler: IEventHandler,
    ownerId: string,
    options: EventHandlerOptions = {}
  ): () => void {
    const { priority = 0, scope = 'active' } = options;

    const list = this.handlersByEvent.get(eventName) ?? [];
    const updated = [...list, { handler, ownerId, priority, scope }];
    // Keep deterministic order: higher priority first, then insertion
    updated.sort((a, b) => b.priority - a.priority);
    this.handlersByEvent.set(eventName, updated);

    return () => this.unregisterById(handler.id);
  }

  on(eventName: string, callback: EventCallback, ownerId: string): () => void {
    const id = uuidv7();
    const list = this.callbacksByEvent.get(eventName) ?? [];
    list.push({ id, callback, ownerId });
    this.callbacksByEvent.set(eventName, list);

    return () => this.unregisterById(id);
  }

  unregisterById(handlerId: string): void {
    // Unregister from handlers
    for (const [eventName, list] of this.handlersByEvent.entries()) {
      const filtered = list.filter(entry => entry.handler.id !== handlerId);
      if (filtered.length === 0) {
        this.handlersByEvent.delete(eventName);
      } else {
        this.handlersByEvent.set(eventName, filtered);
      }
    }

    // Unregister from callbacks
    for (const [eventName, list] of this.callbacksByEvent.entries()) {
      const filtered = list.filter(entry => entry.id !== handlerId);
      if (filtered.length === 0) {
        this.callbacksByEvent.delete(eventName);
      } else {
        this.callbacksByEvent.set(eventName, filtered);
      }
    }
  }

  unregisterByOwner(ownerId: string): void {
    // Unregister handlers by owner
    for (const [eventName, list] of this.handlersByEvent.entries()) {
      const filtered = list.filter(entry => entry.ownerId !== ownerId);
      if (filtered.length === 0) {
        this.handlersByEvent.delete(eventName);
      } else {
        this.handlersByEvent.set(eventName, filtered);
      }
    }

    // Unregister callbacks by owner
    for (const [eventName, list] of this.callbacksByEvent.entries()) {
      const filtered = list.filter(entry => entry.ownerId !== ownerId);
      if (filtered.length === 0) {
        this.callbacksByEvent.delete(eventName);
      } else {
        this.callbacksByEvent.set(eventName, filtered);
      }
    }
  }

  dispatch(event: IEvent, runtime: IScriptRuntime): import('../contracts/IRuntimeAction').IRuntimeAction[] {
    // First, invoke simple callbacks (no actions) - callbacks are not scope-filtered
    const callbacks = [
      ...(this.callbacksByEvent.get('*') ?? []),
      ...(this.callbacksByEvent.get(event.name) ?? [])
    ];

    for (const entry of callbacks) {
      try {
        entry.callback(event, runtime);
      } catch (error) {
        console.error(`EventBus callback error for ${event.name}:`, error);
      }
    }

    // Get active block key and all stack keys for scope filtering
    const activeBlockKey = runtime.stack.current?.key.toString();
    const stackKeys = new Set(runtime.stack.keys.map(k => k.toString()));

    // Get all handlers for this event
    const allHandlers = [
      ...(this.handlersByEvent.get('*') ?? []),
      ...(this.handlersByEvent.get(event.name) ?? [])
    ];

    // Filter handlers based on scope
    const eligibleHandlers = allHandlers.filter(entry => {
      switch (entry.scope) {
        case 'global':
          // Global handlers always fire
          return true;
        case 'bubble':
          // Bubble handlers fire when owner is anywhere on stack
          return stackKeys.has(entry.ownerId);
        case 'active':
        default:
          // Active handlers only fire when owner is the current block
          return entry.ownerId === activeBlockKey;
      }
    });

    const actions = [] as import('../contracts/IRuntimeAction').IRuntimeAction[];

    for (const entry of eligibleHandlers) {
      try {
        const result = entry.handler.handler(event, runtime);
        if (result && result.length > 0) {
          actions.push(...result);
        }
      } catch (error) {
        console.error(`EventBus handler error for ${event.name}:`, error);
      }
    }

    // Log events that produce actions (skip no-op ticks)
    RuntimeLogger.logEvent(event, actions);

    return actions;
  }

  emit(event: IEvent, runtime: IScriptRuntime): void {
    runtime.handle(event);
  }

  /**
   * Dispose of all handlers and callbacks, releasing all references.
   */
  dispose(): void {
    this.handlersByEvent.clear();
    this.callbacksByEvent.clear();
  }
}
