import type { IServiceEventBus } from './IServiceEventBus';

/**
 * SimpleEventBus — single generic implementation of IServiceEventBus<T>.
 *
 * Replace WorkbenchEventBus and WorkoutEventBus class bodies with typed
 * wrappers around this class.  The runtime EventBus remains separate.
 */
export class SimpleEventBus<T> implements IServiceEventBus<T> {
  private readonly listeners = new Set<(event: T) => void>();

  emit(event: T): void {
    this.listeners.forEach(fn => {
      try {
        fn(event);
      } catch (err) {
        console.error('[SimpleEventBus] Error in listener:', err);
      }
    });
  }

  subscribe(fn: (event: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get size(): number {
    return this.listeners.size;
  }
}
