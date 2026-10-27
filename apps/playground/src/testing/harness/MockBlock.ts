import { BlockKey } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBehavior } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeAction } from '@bitcobblers/wod-wiki-engine';
import { PopBlockAction } from '@bitcobblers/wod-wiki-engine';
import { BlockLifecycleOptions, CompletionDecision, IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeActionable } from '@bitcobblers/wod-wiki-engine';
import { IBlockContext } from '@bitcobblers/wod-wiki-engine';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-engine';
import { IMemoryReference, IMemorySubscription, TypedMemoryReference } from '@bitcobblers/wod-wiki-engine';
import { MemoryTypeEnum } from '@bitcobblers/wod-wiki-engine';
import { IAnchorValue } from '@bitcobblers/wod-wiki-engine';
import { IBehaviorContext, BehaviorEventType, BehaviorEventListener, SubscribeOptions, Unsubscribe } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeClock } from '@bitcobblers/wod-wiki-engine';
import { OutputStatementType, OutputStatement } from '@bitcobblers/wod-wiki-engine';
import { IMemoryLocation, MemoryLocation, MemoryTag } from '@bitcobblers/wod-wiki-engine';
import { IEventHandler } from '@bitcobblers/wod-wiki-engine';
import { IEvent } from '@bitcobblers/wod-wiki-engine';
import { TimeSpan } from '@bitcobblers/wod-wiki-engine';
import { MetricVisibility, getMetricVisibility } from '@bitcobblers/wod-wiki-engine';
/** Legacy two-arg behavior shape still supported by the mock harness. */
interface LegacyBehavior {
  onNext?(runtime: IRuntimeBlock, clock: IRuntimeClock): IRuntimeAction[] | void;
  onDispose?(ctx: IBehaviorContext): void;
}

/**
 * Minimal stub context for MockBlock
 */
class MockBlockContext implements IBlockContext {
  readonly ownerId: string;
  readonly exerciseId: string;
  readonly references: Array<IMemoryReference> = [];
  private _released = false;

  constructor(blockId: string) {
    this.ownerId = blockId;
    this.exerciseId = blockId;
  }

  allocate<T>(type: MemoryTypeEnum | string, initialValue?: T, visibility?: 'public' | 'private'): TypedMemoryReference<T> {
    let currentValue = initialValue;
    const ref = {
      id: `mock-ref-${Math.random().toString(36).slice(2)}`,
      type: type,
      ownerId: this.ownerId,
      visibility: (visibility ?? 'private') as 'public' | 'private' | 'inherited',
      value: () => currentValue,
      get: () => currentValue,
      set: (value: T) => { currentValue = value; },
      _subscriptions: [],
      _memory: {} as unknown as IScriptRuntime['memory'], // Mock
      subscribe: (cb: IMemorySubscription<T>['callback']) => { (ref as unknown as { _subscriptions: IMemorySubscription<T>[] })._subscriptions.push(cb); return () => { }; }
    } as unknown as TypedMemoryReference<T>;

    this.references.push(ref);
    return ref;
  }

  get<T>(type: MemoryTypeEnum | string): TypedMemoryReference<T> | undefined {
    return this.references.find(r => r.type === type) as TypedMemoryReference<T> | undefined;
  }

  getAll<T>(type: string): TypedMemoryReference<T>[] {
    return this.references.filter(r => r.type === type) as TypedMemoryReference<T>[];
  }

  set<T>(reference: TypedMemoryReference<T>, value: T): void {
    reference.set(value);
  }

  release(): void { this._released = true; }
  isReleased(): boolean { return this._released; }

  getOrCreateAnchor(anchorId: string): TypedMemoryReference<IAnchorValue> {
    const existing = this.get<IAnchorValue>(`anchor-${anchorId}`);
    if (existing) return existing;
    return this.allocate<IAnchorValue>(`anchor-${anchorId}`, { searchCriteria: {} }, 'public');
  }
}

/**
 * Recorded calls from MockBehaviorContext for spy-like assertions.
 */
export interface BehaviorContextRecordings {
  pushMemory: Array<{ tag: string; metrics: IMetric[]; result: IMemoryLocation }>;
  updateMemory: Array<{ tag: string; metrics: IMetric[] }>;
  subscribe: Array<{ eventType: BehaviorEventType; options?: SubscribeOptions; unsubscribe: Unsubscribe }>;
  markComplete: Array<{ reason?: string }>;
  emitOutput: Array<{ type: OutputStatementType; metrics: IMetric[]; options?: unknown }>;
  emitEvent: Array<{ event: IEvent }>;
}

/**
 * MockBehaviorContext — production-faithful implementation of IBehaviorContext for testing.
 *
 * When a runtime is available (via MockBlock.setRuntime), this context wires:
 * - subscribe → EventBus (events flow through the real event system)
 * - emitEvent → runtime.handle() (events dispatch to all handlers)
 * - emitOutput → runtime.addOutput() (outputs are captured by OutputTracingHarness)
 *
 * All calls are recorded in the `recordings` property for spy-like assertions.
 */
class MockBehaviorContext implements IBehaviorContext {
  readonly block: IRuntimeBlock;
  clock: IRuntimeClock;
  readonly stackLevel: number;
  private _mockBlock: MockBlock;
  private _unsubscribers: Array<() => void> = [];
  private _capabilities: Set<string> = new Set();

  readonly recordings: BehaviorContextRecordings;

  constructor(block: MockBlock, clock: IRuntimeClock, stackLevel: number = 0, recordings?: BehaviorContextRecordings) {
    this._mockBlock = block;
    this.block = block;
    this.clock = clock;
    this.stackLevel = stackLevel;
    // Use shared recordings from MockBlock (survives dispose)
    this.recordings = recordings ?? {
      pushMemory: [],
      updateMemory: [],
      subscribe: [],
      markComplete: [],
      emitOutput: [],
      emitEvent: [],
    };
  }

  get nowProvider() {
    return this._mockBlock.runtime.nowProvider;
  }

  subscribe(eventType: BehaviorEventType, listener: BehaviorEventListener, options?: SubscribeOptions): Unsubscribe {
    const runtime = this._mockBlock.runtime;
    let unsub: Unsubscribe;

    if (runtime?.eventBus) {
      // Wire to real EventBus — mirrors production BehaviorContext.subscribe()
      const self = this;
      const handler: IEventHandler = {
        id: `mock-behavior-${this._mockBlock.key.toString()}-${eventType}-${Date.now()}`,
        name: `MockBehaviorHandler-${this._mockBlock.label}-${eventType}`,
        handler: (event: IEvent, _runtime: IScriptRuntime): IRuntimeAction[] => {
          // Use the dispatching runtime's live clock (like production)
          const callbackCtx: IBehaviorContext = Object.create(self, {
            clock: { value: _runtime.clock, enumerable: true, configurable: true }
          });
          return listener(event, callbackCtx);
        }
      };

      unsub = runtime.eventBus.register(
        eventType,
        handler,
        this._mockBlock.key.toString(),
        { scope: options?.scope ?? 'active' }
      );
    } else {
      // No runtime — no-op subscription (backward compat)
      unsub = () => {};
    }

    this._unsubscribers.push(unsub);
    this.recordings.subscribe.push({ eventType, options, unsubscribe: unsub });
    return unsub;
  }

  emitOutput(type: OutputStatementType, metrics: IMetric[], _options?: { label?: string; completionReason?: string }): void {
    this.recordings.emitOutput.push({ type, metrics, options: _options });

    const runtime = this._mockBlock.runtime;
    if (runtime?.addOutput) {
      // Wire to runtime — mirrors production BehaviorContext.emitOutput()
      const now = this.clock.currentDate;
      const timerLocations = this._mockBlock.getMemoryByTag('time');
      let startTime = now.getTime();
      const endTime = now.getTime();
      let timerSpans: TimeSpan[] = [];

      if (timerLocations.length > 0) {
        const timerFragments = timerLocations[0].metrics;
        if (timerFragments.length > 0) {
          const timerValue = timerFragments[0].value as { spans?: TimeSpan[] } | undefined;
          if (timerValue?.spans && timerValue.spans.length > 0) {
            timerSpans = [...timerValue.spans];
            startTime = timerSpans[0].started;
          }
        }
      }

      const taggedMetrics = metrics.map(f => ({
        ...f,
        sourceBlockKey: f.sourceBlockKey ?? this._mockBlock.key.toString(),
        timestamp: f.timestamp ?? now
      }));

      if (timerSpans.length > 0) {
        taggedMetrics.unshift({
          type: MetricType.Spans,
          value: timerSpans,
          origin: 'runtime',
          timestamp: now,
          sourceBlockKey: this._mockBlock.key.toString(),
        });
      }

      const output = new OutputStatement({
        outputType: type,
        timeSpan: new TimeSpan(startTime, endTime),
        sourceBlockKey: this._mockBlock.key.toString(),
        sourceStatementId: this._mockBlock.sourceIds?.[0],
        stackLevel: this.stackLevel,
        metrics: taggedMetrics,
        completionReason: _options?.completionReason,
      });

      runtime.addOutput(output);
    }
  }

  emitEvent(event: { name: string; timestamp: Date; data?: unknown }): void {
    this.recordings.emitEvent.push({ event });

    const runtime = this._mockBlock.runtime;
    if (runtime?.handle) {
      runtime.handle(event as IEvent);
    }
  }

  getMemoryByTag(tag: MemoryTag): IMemoryLocation[] {
    return this._mockBlock.getMemoryByTag(tag);
  }

  pushMemory(_tag: string, _metrics: IMetric[]): IMemoryLocation {
    const location = new MemoryLocation(_tag as MemoryTag, _metrics);
    this._mockBlock.pushMemory(location);
    this.recordings.pushMemory.push({ tag: _tag, metrics: _metrics, result: location });
    return location;
  }

  updateMemory(_tag: string, _metrics: IMetric[]): void {
    const locations = this._mockBlock.getMemoryByTag(_tag as MemoryTag);
    if (locations.length > 0) {
      locations[0].update(_metrics);
    }
    this.recordings.updateMemory.push({ tag: _tag, metrics: _metrics });
  }

  markComplete(reason?: string): void {
    this._mockBlock.markComplete(reason);
    this.recordings.markComplete.push({ reason });
  }

  declareCapability(cap: string): void {
    this._capabilities.add(cap);
  }

  getCapabilities(): Set<string> {
    return new Set(this._capabilities);
  }

  hasCapability(cap: string): boolean {
    return this._capabilities.has(cap);
  }

  /**
   * Dispose all event subscriptions registered via subscribe().
   */
  dispose(): void {
    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch { /* cleanup */ }
    }
    this._unsubscribers = [];
  }
}

/**
 * Custom BlockKey for test identification
 */
class MockBlockKey extends BlockKey {
  constructor(private readonly _id: string) { super(); }
  override toString(): string { return this._id; }
}

/**
 * Configuration for MockBlock
 */
export interface MockBlockConfig {
  /** Custom identifier for the block */
  id?: string;
  /** Block type label */
  blockType?: string;
  /** Human-readable label */
  label?: string;
  /** Source statement IDs */
  sourceIds?: number[];
  /** Pre-configured metrics */
  metrics?: IMetric[][];
  /** Custom state object accessible in conditions */
  state?: Record<string, unknown>;
}

/**
 * MockBlock - Configurable IRuntimeBlock for testing behaviors in isolation.
 */
export class MockBlock implements IRuntimeBlock {
  readonly key: BlockKey;
  readonly sourceIds: number[];
  readonly blockType: string;
  readonly context: IBlockContext;
  readonly metrics: IMetric[][];
  executionTiming: BlockLifecycleOptions = {};

  /**
   * Computed label derived from the block's Label metrics in memory.
   * Falls back to blockType → 'Block'.
   */
  get label(): string {
    for (const loc of this._memory) {
      for (const frag of loc.metrics) {
        if (frag.type === MetricType.Label) {
          return frag.image || frag.value?.toString() || this.blockType || 'Block';
        }
      }
    }
    return this.blockType || 'Block';
  }

  /** Mutable state accessible in tests and condition functions */
  public state: Record<string, unknown>;

  private _runtime?: IScriptRuntime;
  private _behaviorContext?: MockBehaviorContext;
  private _recordings: BehaviorContextRecordings = {
    pushMemory: [],
    updateMemory: [],
    subscribe: [],
    markComplete: [],
    emitOutput: [],
    emitEvent: [],
  };
  private _forcedMountActions: IRuntimeAction[] = [];
  private _forcedNextActions: IRuntimeAction[] = [];
  private _forcedUnmountActions: IRuntimeAction[] = [];
  private _isComplete = false;
  private _completionReason?: string;

  /**
   * Indicates whether this block has completed execution.
   */
  get isComplete(): boolean {
    return this._isComplete;
  }

  /**
   * Marks the block as complete. Idempotent - subsequent calls have no effect.
   * @param reason Optional reason for completion (for debugging/history)
   */
  markComplete(reason?: string): void {
    if (this._isComplete) return;
    this._isComplete = true;
    this._completionReason = reason;
  }

  /**
   * Gets the completion reason if block is complete.
   */
  get completionReason(): string | undefined {
    return this._completionReason;
  }

  constructor(
    idOrConfig: string | MockBlockConfig,
    public readonly behaviors: IRuntimeBehavior[] = [],
    config?: MockBlockConfig
  ) {
    const resolvedConfig: MockBlockConfig = typeof idOrConfig === 'string'
      ? { id: idOrConfig, ...config }
      : idOrConfig;

    this.key = new MockBlockKey(resolvedConfig.id ?? `mock-${Math.random().toString(36).slice(2)}`);
    this.blockType = resolvedConfig.blockType ?? 'MockBlock';
    this.sourceIds = resolvedConfig.sourceIds ?? [];

    // Store label as a Label metrics in memory (matching RuntimeBlock pattern)
    const labelText = resolvedConfig.label ?? this.blockType;
    if (labelText) {
      this._memory.push(new MemoryLocation('metric:label', [{
        type: MetricType.Label,
        image: labelText,
        origin: 'parser',
        value: labelText
      } as IMetric]));
    }
    this.metrics = resolvedConfig.metrics ?? [];
    this.context = new MockBlockContext(this.key.toString());
    this.state = resolvedConfig.state ?? {};
  }

  setRuntime(runtime: IScriptRuntime): void {
    this._runtime = runtime;
  }

  get runtime(): IScriptRuntime | undefined {
    return this._runtime;
  }

  /**
   * Access the behavior context created during mount.
   * Use this to inspect recorded calls (pushMemory, subscribe, etc.)
   */
  get behaviorContext(): MockBehaviorContext | undefined {
    return this._behaviorContext;
  }

  /**
   * Shorthand access to recorded calls from the behavior context.
   * Survives dispose() — recordings are owned by MockBlock, not the context.
   */
  get recordings(): BehaviorContextRecordings {
    return this._recordings;
  }

  // Helper methods to force specific actions for testing
  setMountActions(actions: IRuntimeAction[]): void {
    this._forcedMountActions = actions;
  }

  setNextActions(actions: IRuntimeAction[]): void {
    this._forcedNextActions = actions;
  }

  setUnmountActions(actions: IRuntimeAction[]): void {
    this._forcedUnmountActions = actions;
  }

  mount(runtime: IScriptRuntime, options?: BlockLifecycleOptions): IRuntimeAction[] {
    const clock = options?.clock ?? runtime.clock;
    this.executionTiming.startTime = options?.startTime ?? clock.currentDate;

    if (this._forcedMountActions.length > 0) {
      return [...this._forcedMountActions];
    }

    // Create persistent context (reused across lifecycle calls)
    const stackLevel = runtime.stack?.count ? Math.max(0, runtime.stack.count - 1) : 0;
    this._behaviorContext = new MockBehaviorContext(this, clock, stackLevel, this._recordings);

    const actions: IRuntimeAction[] = [];
    for (const behavior of this.behaviors) {
      const usesNewApi = typeof behavior.onMount === 'function';
      const result = usesNewApi 
        ? behavior.onMount(this._behaviorContext) 
        : behavior.onPush?.(this, clock);
      if (result) actions.push(...result);
    }
    return actions;
  }

  next(runtime: IScriptRuntime, options?: BlockLifecycleOptions): IRuntimeAction[] {
    if (this._forcedNextActions.length > 0) {
      return [...this._forcedNextActions];
    }

    const clock = options?.clock ?? runtime.clock;
    // Update clock on existing context (like production RuntimeBlock)
    if (this._behaviorContext) {
      this._behaviorContext.clock = clock;
    }
    const ctx = this._behaviorContext ?? new MockBehaviorContext(this, clock, runtime.stack?.count ?? 0);
    const actions: IRuntimeAction[] = [];
    for (const behavior of this.behaviors) {
      const usesNewApi = typeof behavior.onMount === 'function';
      const result = usesNewApi 
        ? behavior.onNext?.(ctx) 
        : (behavior as unknown as LegacyBehavior).onNext?.(this, clock);
      if (result) actions.push(...result);
    }
    return actions;
  }

  inspectNext(runtime: IRuntimeActionable, options?: BlockLifecycleOptions): CompletionDecision {
    const clock = options?.clock ?? (runtime as IScriptRuntime).clock;
    const ctx = this._behaviorContext ?? new MockBehaviorContext(this, clock, (runtime as IScriptRuntime).stack?.count ?? 0);

    // Snapshot completion state so we can restore it after inspection.
    const wasComplete = this._isComplete;
    const wasReason = this._completionReason;

    const actions: IRuntimeAction[] = [];
    for (const behavior of this.behaviors) {
      const usesNewApi = typeof behavior.onMount === 'function';
      const result = usesNewApi
        ? behavior.onNext?.(ctx)
        : (behavior as unknown as { onNext?: (block: IRuntimeBlock, clock: IRuntimeClock) => IRuntimeAction[] }).onNext?.(this, clock);
      if (result) actions.push(...result);
    }

    const decision: CompletionDecision = {
      complete: this._isComplete,
      reason: this._completionReason,
      actions,
    };

    // Restore completion state — inspectNext must not mutate the block.
    this._isComplete = wasComplete;
    this._completionReason = wasReason;

    // Auto-pop: mirror next()'s auto-pop logic.
    if (decision.complete && !actions.some(a => a.type === 'pop-block')) {
      actions.push(new PopBlockAction());
    }

    return decision;
  }

  unmount(runtime: IScriptRuntime, options?: BlockLifecycleOptions): IRuntimeAction[] {
    const clock = options?.clock ?? runtime.clock;
    this.executionTiming.createdAt = options?.createdAt ?? clock.currentDate;

    if (this._forcedUnmountActions.length > 0) {
      return [...this._forcedUnmountActions];
    }

    // Update clock on existing context
    if (this._behaviorContext) {
      this._behaviorContext.clock = clock;
    }
    const ctx = this._behaviorContext ?? new MockBehaviorContext(this, clock, runtime.stack?.count ?? 0);
    const actions: IRuntimeAction[] = [];
    for (const behavior of this.behaviors) {
      const usesNewApi = typeof behavior.onMount === 'function';
      const result = usesNewApi 
        ? behavior.onUnmount?.(ctx) 
        : behavior.onPop?.(this, clock);
      if (result) actions.push(...result);
    }
    return actions;
  }

  dispose(_runtime: IScriptRuntime): void {
    // Pass BehaviorContext to onDispose (matches production RuntimeBlock)
    const ctx = this._behaviorContext ?? new MockBehaviorContext(this, _runtime?.clock ?? { currentDate: new Date(), now: () => new Date(), nowMs: () => Date.now(), elapsed: 0, isRunning: false, spans: [], start: () => new Date(), stop: () => new Date() } as IRuntimeClock, 0);
    for (const behavior of this.behaviors) {
      if (typeof (behavior as unknown as LegacyBehavior).onDispose === 'function') {
        (behavior as unknown as LegacyBehavior).onDispose(ctx);
      }
    }
    // Dispose the behavior context (cleans up event subscriptions)
    if (this._behaviorContext) {
      this._behaviorContext.dispose();
      this._behaviorContext = undefined;
    }
  }

  getBehavior<T extends IRuntimeBehavior>(behaviorType: new (...args: unknown[]) => T): T | undefined {
    return this.behaviors.find(b => b instanceof behaviorType) as T | undefined;
  }

  // ============================================================================
  // List-Based Memory API
  // ============================================================================

  private _memory: IMemoryLocation[] = [];

  /**
   * Push a new memory location onto the block's memory list.
   */
  pushMemory(location: IMemoryLocation): void {
    this._memory.push(location);
  }

  /**
   * Get all memory locations matching the given tag.
   */
  getMemoryByTag(tag: MemoryTag): IMemoryLocation[] {
    return this._memory.filter(loc => loc.tag === tag);
  }

  /**
   * Get all memory locations.
   */
  getAllMemory(): IMemoryLocation[] {
    return [...this._memory];
  }

  /**
   * Get all metrics memory locations matching a given visibility tier.
   */
  getMetricMemoryByVisibility(visibility: MetricVisibility): IMemoryLocation[] {
    return this._memory.filter(loc => getMetricVisibility(loc.tag) === visibility);
  }

  /** MockBlock ignores effort-defined hints (the contract is honored by the
   *  real RuntimeBlock; tests can inspect `this._memory` directly). */
  mergeHints(_hints: Readonly<Record<string, unknown>>): void {
    // no-op for tests
  }

}
