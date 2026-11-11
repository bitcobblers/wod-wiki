import { IRuntimeBlock, BlockLifecycleOptions } from '@bitcobblers/wod-wiki-lang';
import { IRuntimeAction } from '@bitcobblers/wod-wiki-lang';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-lang';
import { IEvent } from '@bitcobblers/wod-wiki-lang';
import { createMockClock } from '@bitcobblers/wod-wiki-lang';
import { RuntimeMemory } from '@bitcobblers/wod-wiki-lang';
import { RuntimeStack } from '@bitcobblers/wod-wiki-lang';
import { EventBus } from '@bitcobblers/wod-wiki-lang';
import { TypedMemoryReference } from '@bitcobblers/wod-wiki-lang';
import { MockBlock } from '../harness/MockBlock';
import { PushBlockAction } from '@bitcobblers/wod-wiki-lang';
import { PopBlockAction } from '@bitcobblers/wod-wiki-lang';
import { StartWorkoutAction } from '@bitcobblers/wod-wiki-lang';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-core';
import type { OutputListener } from '@bitcobblers/wod-wiki-lang';
import type { MemoryTag } from '@bitcobblers/wod-wiki-lang';

/**
 * Minimal runner-agnostic event spy — stands in for bun:test `mock()` /
 * vitest `vi.fn()` so this harness loads identically under both runners.
 * Exported stable name: test assertions reach into `.calls`.
 */
export interface EventSpy {
    (event: IEvent): void;
    readonly calls: IEvent[];
    mockClear(): void;
}

function createEventSpy(): EventSpy {
    const calls: IEvent[] = [];
    const spy = ((event: IEvent) => {
        calls.push(event);
    }) as EventSpy;
    Object.defineProperty(spy, 'calls', { value: calls });
    spy.mockClear = () => {
        calls.length = 0;
    };
    return spy;
}

/**
 * Captured action for test assertions
 */
export interface CapturedAction {
  action: IRuntimeAction;
  timestamp: number;
  phase: 'mount' | 'next' | 'unmount' | 'event';
}

/**
 * Captured event for test assertions
 */
export interface CapturedEvent {
  event: IEvent;
  timestamp: number;
}

/**
 * BehaviorTestHarness - Lightweight harness for testing individual behaviors.
 *
 * Provides:
 * - Real memory, stack, and event bus (not mocks)
 * - Controllable mock clock
 * - Action and event capture for assertions
 * - Fluent API for lifecycle operations
 */
export class BehaviorTestHarness {
  private _clock: ReturnType<typeof createMockClock>;
  private _memory: RuntimeMemory;
  private _stack: RuntimeStack;
  private _eventBus: EventBus;
  private _mockRuntime: IScriptRuntime;

  private _capturedActions: CapturedAction[] = [];
  private _capturedEvents: CapturedEvent[] = [];
  private _handleSpy: EventSpy;
  private _iteration = 0;
  private readonly _maxIterations = 20;
  private _actionStack: IRuntimeAction[] = [];

  constructor() {
    this._clock = createMockClock(new Date());
    this._memory = new RuntimeMemory();
    this._stack = new RuntimeStack();
    this._eventBus = new EventBus();
    this._handleSpy = createEventSpy();
    this._mockRuntime = this._createMockRuntime();
  }

  private _createMockRuntime(): IScriptRuntime {
    const self = this;

    return {
      memory: this._memory,
      stack: this._stack,
      eventBus: this._eventBus,
      clock: this._clock,
      jit: {} as unknown as IScriptRuntime['jit'], // Not used in behavior tests
      script: {} as unknown as IScriptRuntime['script'], // Not used in behavior tests
      errors: [],
      options: { maxActionDepth: 20 },
      tracker: {
        recordMetric: () => { },
        recordRound: () => { },
        getMetric: () => undefined,
        getRounds: () => undefined
      },

      do(action: IRuntimeAction) {
        self._actionStack.push(action);
      },

      doAll(actions: IRuntimeAction[]) {
        if (!actions) return;
        self._actionStack.push(...actions);
      },

      handle(event: IEvent) {
        // Mirror ScriptRuntime.handle(): dispatch through event bus and process returned actions
        const actions = self._eventBus.dispatch(event, this);
        if (actions.length > 0) {
          this.doAll(actions);
        }
      },

      pushBlock(block: IRuntimeBlock) {
        this.do(new PushBlockAction(block));
      },

      popBlock(lifecycle?: BlockLifecycleOptions) {
        this.do(new PopBlockAction(lifecycle));
      },

      isComplete() {
        return self._stack.count === 0;
      },

      sweepCompletedBlocks() {
        // Sweep completed blocks from the stack
        while (self._stack.current?.isComplete) {
          const block = self._stack.pop();
          if (block) block.dispose(this as unknown as IScriptRuntime);
        }
      },

      subscribeToOutput(_listener: OutputListener) {
        // No-op for test harness
        return () => { };
      },

      getOutputStatements() {
        return [];
      },

      addOutput(_output: IOutputStatement) {
        // No-op for test harness
      },

      getStatementById(_id: number) {
        return undefined;
      },

      dispose() {
        while (self._stack.count > 0) {
          const block = self._stack.pop();
          if (block) block.dispose(this as unknown as IScriptRuntime);
        }
      }
    } as unknown as IScriptRuntime;
  }

  // ========== Configuration API ==========

  /**
   * Set the initial clock time
   */
  withClock(time: Date): this {
    this._clock = createMockClock(time);
    this._mockRuntime = this._createMockRuntime();
    return this;
  }

  /**
   * Pre-allocate memory with initial values
   */
  withMemory<T>(type: string, ownerId: string, value: T, visibility: 'public' | 'private' | 'inherited' = 'private'): this {
    this._memory.allocate(type, ownerId, value, visibility);
    return this;
  }

  // ========== Workout Operations ==========

  /**
   * Start a workout by dispatching StartWorkoutAction.
   * This wraps the script's statements in a root block and pushes it.
   * 
   * Note: For BehaviorTestHarness, this is typically a no-op since
   * there's no real script. Use push() with MockBlock for unit tests.
   * This method is provided for consistency with other harnesses.
   */
  startWorkout(options?: { totalRounds?: number }): this {
    this._mockRuntime.do(new StartWorkoutAction(options));
    return this;
  }

  // ========== Stack Operations ==========

  /**
   * Push a block onto the stack (does not mount)
   */
  push(block: IRuntimeBlock): this {
    const maybeMock = block as unknown as Partial<MockBlock>;
    if (block instanceof MockBlock || typeof maybeMock.setRuntime === 'function') {
      maybeMock.setRuntime?.(this._mockRuntime);
    }
    this._stack.push(block);
    return this;
  }

  /**
   * Mount the current block
   */
  mount(options?: BlockLifecycleOptions): IRuntimeAction[] {
    const block = this._stack.current;
    if (!block) throw new Error('No block on stack to mount');

    const resolvedOptions: BlockLifecycleOptions = {
      startTime: this._clock.currentDate,
      ...options
    };

    const actions = block.mount(this._mockRuntime, resolvedOptions);
    this._recordActions(actions, 'mount');

    // Use the safe iteration-limited execution
    this._mockRuntime.doAll(actions);
    this._executeActionStack();

    return actions;
  }

  /**
   * Call next() on the current block
   */
  next(options?: BlockLifecycleOptions): IRuntimeAction[] {
    const block = this._stack.current;
    if (!block) throw new Error('No block on stack for next()');

    const actions = block.next(this._mockRuntime, options);
    this._recordActions(actions, 'next');

    // Use the safe iteration-limited execution
    this._mockRuntime.doAll(actions);
    this._executeActionStack();

    return actions;
  }

  /**
   * Unmount and dispose the current block
   */
  unmount(options?: BlockLifecycleOptions): IRuntimeAction[] {
    const block = this._stack.current;
    if (!block) throw new Error('No block on stack to unmount');

    const resolvedOptions: BlockLifecycleOptions = {
      createdAt: this._clock.currentDate,
      ...options
    };

    const actions = block.unmount(this._mockRuntime, resolvedOptions);
    this._recordActions(actions, 'unmount');

    // Use the safe iteration-limited execution
    this._mockRuntime.doAll(actions);
    this._executeActionStack();

    this._stack.pop();
    block.dispose(this._mockRuntime);

    return actions;
  }

  // ========== Time Operations ==========

  /**
   * Advance the mock clock by milliseconds
   */
  advanceClock(ms: number): this {
    this._clock.advance(ms);
    return this;
  }

  /**
   * Set the mock clock to a specific time
   */
  setClock(time: Date): this {
    this._clock.setTime(time);
    return this;
  }

  // ========== Event Operations ==========

  /**
   * Dispatch an event through the runtime
   */
  simulateEvent(name: string, data?: Record<string, unknown>): IRuntimeAction[] {
    const event: IEvent = {
      name,
      timestamp: this._clock.currentDate,
      data: { source: 'test-harness', ...data }
    };

    // Track event for assertions
    this._capturedEvents.push({ event, timestamp: Date.now() });
    this._handleSpy(event);

    // Dispatch through runtime.handle() — mirrors production entry point
    this._mockRuntime.handle(event);

    // Ensure actions resulting from the event are processed
    this._executeActionStack();

    return [];
  }

  /**
   * Simulate 'next' event (common operation)
   */
  simulateNext(): this {
    this.simulateEvent('next');
    return this;
  }

  /**
   * Simulate tick event
   */
  simulateTick(): this {
    this.simulateEvent('tick');
    return this;
  }

  // ========== Memory Operations ==========

  /**
   * Get a memory value by type and owner.
   * If no ownerId is provided, checks the current block's context first,
   * then falls back to the harness memory store.
   */
  getMemory<T = unknown>(type: string, ownerId?: string): T | undefined {
    // If no ownerId provided, try current block's context first
    if (!ownerId) {
      const currentBlock = this._stack.current;
      if (currentBlock) {
        // Check block's list-based memory via getMemoryByTag
        if (typeof currentBlock.getMemoryByTag === 'function') {
          const loc = currentBlock.getMemoryByTag(type as MemoryTag)[0];
          if (loc) {
            const frag = loc.metrics[0];
            if (frag) {
              // 'round' tag: metrics itself is the RoundState
              if (type === 'round') return frag as unknown as T;
              return frag.value as T;
            }
          }
        }
      }
    }

    // Fall back to harness memory store
    const blockId = ownerId ?? this._stack.current?.key?.toString();
    if (!blockId) return undefined;

    const refs = this._memory.search({ type, ownerId: blockId, id: null, visibility: null });
    if (refs.length === 0) return undefined;
    return this._memory.get(refs[0] as TypedMemoryReference<T>);
  }

  /**
   * Allocate memory during test
   */
  allocateMemory<T>(type: string, ownerId: string, value: T, visibility: 'public' | 'private' = 'private'): TypedMemoryReference<T> {
    return this._memory.allocate(type, ownerId, value, visibility);
  }

  // ========== Assertions API ==========

  /** Current block on stack */
  get currentBlock(): IRuntimeBlock | undefined {
    return this._stack.current;
  }

  /** Stack depth */
  get stackDepth(): number {
    return this._stack.count;
  }

  /** All blocks on stack (top-first) */
  get blocks(): readonly IRuntimeBlock[] {
    return this._stack.blocks;
  }

  /** The mock runtime */
  get runtime(): IScriptRuntime {
    return this._mockRuntime;
  }

  /** The mock clock */
  get clock(): ReturnType<typeof createMockClock> {
    return this._clock;
  }

  /** All captured actions */
  get capturedActions(): readonly CapturedAction[] {
    return [...this._capturedActions];
  }

  /** All captured events */
  get capturedEvents(): readonly CapturedEvent[] {
    return [...this._capturedEvents];
  }

  /** The handle() spy for assertions */
  get handleSpy(): EventSpy {
    return this._handleSpy;
  }

  /**
   * Find captured actions by type
   */
  findActions<T extends IRuntimeAction>(actionType: new (...args: unknown[]) => T): T[] {
    return this._capturedActions
      .filter(c => c.action instanceof actionType)
      .map(c => c.action as T);
  }

  /**
   * Find captured events by name
   */
  findEvents(name: string): IEvent[] {
    return this._capturedEvents
      .filter(c => c.event.name === name)
      .map(c => c.event);
  }

  /**
   * Check if an event was emitted
   */
  wasEventEmitted(name: string): boolean {
    return this._capturedEvents.some(c => c.event.name === name);
  }

  /**
   * Clear captured actions and events
   */
  clearCaptures(): this {
    this._capturedActions = [];
    this._capturedEvents = [];
    this._handleSpy.mockClear();
    return this;
  }

  /**
   * Dispose the harness and release all resources.
   * Call this in afterEach() to prevent memory leaks.
   */
  dispose(): void {
    // Unmount and dispose all blocks on the stack
    while (this._stack.count > 0) {
      const block = this._stack.current;
      if (block) {
        try { block.unmount(this._mockRuntime); } catch { /* cleanup */ }
        this._stack.pop();
        try { block.dispose(this._mockRuntime); } catch { /* cleanup */ }
      } else {
        this._stack.pop();
      }
    }
    // Clear the event bus
    this._eventBus.dispose();
    // Clear captures
    this._capturedActions = [];
    this._capturedEvents = [];
  }

  // ========== Private Helpers ==========

  /**
   * Executes the internal action stack using a LIFO loop with iteration limits.
   * This prevents infinite recursion and memory bloat from circular action triggers.
   */
  private _executeActionStack(): void {
    // Reset iteration counter for the start of this "turn"
    this._iteration = 0;

    while (this._actionStack.length > 0) {
      if (this._iteration >= this._maxIterations) {
        const errorMsg = `[BehaviorTestHarness] Max iterations reached (${this._maxIterations}). Aborting to prevent infinite loop.`;
        console.error(errorMsg);
        // Clear stack on failure to prevent subsequent runs from inheriting bad state
        this._actionStack = [];
        throw new Error(errorMsg);
      }

      // Ordered Stack: Take from the front
      const action = this._actionStack.shift()!;
      this._iteration++;

      // Execute action - it may push more actions onto this._actionStack via runtime.do() (appended)
      const childActions = action.do(this._mockRuntime);

      // Prepend returned child actions to maintain depth-first lifecycle
      if (childActions && childActions.length > 0) {
        this._actionStack.unshift(...childActions);
      }
    }
  }

  private _recordActions(actions: IRuntimeAction[], phase: CapturedAction['phase']): void {
    for (const action of actions) {
      this._capturedActions.push({ action, timestamp: Date.now(), phase });
    }
  }
}

/**
 * Factory function for quick harness creation
 */
export function createBehaviorHarness(clockTime?: Date): BehaviorTestHarness {
  const harness = new BehaviorTestHarness();
  if (clockTime) harness.withClock(clockTime);
  return harness;
}

