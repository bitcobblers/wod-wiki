import { BlockKey } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeAction } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBehavior } from '@bitcobblers/wod-wiki-engine';
import { BlockLifecycleOptions, CompletionDecision, IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import type { IRuntimeActionable } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { IBlockContext } from '@bitcobblers/wod-wiki-engine';
import type { InterceptMode, TestableBlockConfig } from '@bitcobblers/wod-wiki-engine';

// Re-export so existing consumers of this module continue to work
export type { InterceptMode, TestableBlockConfig } from '@bitcobblers/wod-wiki-engine';

/**
 * Recorded method call for inspection
 */
export interface MethodCall {
  method: keyof IRuntimeBlock;
  args: unknown[];
  returnValue?: unknown;
  timestamp: number;
  duration: number;
  error?: Error;
}

/**
 * Memory operation recorded during block execution
 */
export interface MemoryOperation {
  operation: 'allocate' | 'get' | 'set' | 'release' | 'search';
  type: string;
  ownerId: string;
  refId?: string;
  value?: unknown;
  timestamp: number;
}

/**
 * Stack operation recorded during block execution
 */
export interface StackOperation {
  operation: 'push' | 'pop';
  blockKey: string;
  blockType?: string;
  timestamp: number;
}

/**
 * A custom BlockKey that allows overriding the string representation
 * for easier identification in visualizations.
 */
class TestableBlockKey extends BlockKey {
  constructor(private readonly _testId: string) {
    super();
  }

  override toString(): string {
    return this._testId;
  }
}

/**
 * TestableBlock wraps any IRuntimeBlock to enable:
 * - Method interception (spy, override, ignore)
 * - Call recording for assertions
 * - Custom test IDs for easy identification
 * 
 * @example
 * ```typescript
 * const realBlock = new EffortBlock(runtime, [1], { exerciseName: 'Squats', targetReps: 10 });
 * const testable = new TestableBlock(realBlock, {
 *   testId: 'effort-squats-1',
 *   nextMode: 'spy',
 *   mountOverride: () => [] // Skip default mount actions
 * });
 * 
 * // Execute and inspect
 * testable.mount(runtime);
 * console.log(testable.calls); // All recorded method calls
 * console.log(testable.key.toString()); // 'effort-squats-1'
 * ```
 */
export class TestableBlock implements IRuntimeBlock {
  private _calls: MethodCall[] = [];
  private _config: Required<TestableBlockConfig>;
  private _testKey: BlockKey;

  constructor(
    private readonly _wrapped: IRuntimeBlock,
    config: TestableBlockConfig = {}
  ) {
    // Apply defaults
    this._config = {
      testId: config.testId ?? '',
      labelOverride: config.labelOverride ?? '',
      mountMode: config.mountMode ?? 'spy',
      mountOverride: config.mountOverride ?? (() => []),
      nextMode: config.nextMode ?? 'spy',
      nextOverride: config.nextOverride ?? (() => []),
      inspectNextMode: config.inspectNextMode ?? 'spy',
      inspectNextOverride: config.inspectNextOverride ?? (() => ({ complete: false, actions: [] })),
      unmountMode: config.unmountMode ?? 'spy',
      unmountOverride: config.unmountOverride ?? (() => []),
      disposeMode: config.disposeMode ?? 'spy',
      disposeOverride: config.disposeOverride ?? (() => { }),
    };

    // Create custom key if testId provided, otherwise use wrapped key
    this._testKey = this._config.testId
      ? new TestableBlockKey(this._config.testId)
      : this._wrapped.key;
  }

  // ========== IRuntimeBlock Properties ==========

  get key(): BlockKey {
    return this._testKey;
  }

  get sourceIds(): number[] {
    return this._wrapped.sourceIds;
  }

  get blockType(): string | undefined {
    return this._wrapped.blockType;
  }

  get label(): string {
    return this._config.labelOverride || this._wrapped.label;
  }

  get context(): IBlockContext {
    return this._wrapped.context;
  }

  get isComplete(): boolean {
    return this._wrapped.isComplete;
  }

  get behaviors(): readonly IRuntimeBehavior[] {
    return this._wrapped.behaviors;
  }

  markComplete(reason?: string): void {
    this._wrapped.markComplete(reason);
  }

  // ========== Testing API ==========

  /** Access the underlying block for direct inspection */
  get wrapped(): IRuntimeBlock {
    return this._wrapped;
  }

  /** The test ID assigned to this block */
  get testId(): string {
    return this._config.testId;
  }

  /** All recorded method calls */
  get calls(): ReadonlyArray<MethodCall> {
    return [...this._calls];
  }

  /** Get calls for a specific method */
  getCallsFor(method: keyof IRuntimeBlock): MethodCall[] {
    return this._calls.filter(c => c.method === method);
  }

  /** Get the most recent call for a method */
  getLastCall(method: keyof IRuntimeBlock): MethodCall | undefined {
    const calls = this.getCallsFor(method);
    return calls[calls.length - 1];
  }

  /** Check if a method was called */
  wasCalled(method: keyof IRuntimeBlock): boolean {
    return this._calls.some(c => c.method === method);
  }

  /** Get call count for a method */
  callCount(method: keyof IRuntimeBlock): number {
    return this.getCallsFor(method).length;
  }

  /** Clear recorded calls */
  clearCalls(): void {
    this._calls = [];
  }

  // ========== IRuntimeBlock Methods (intercepted) ==========

  mount(runtime: IScriptRuntime, options?: BlockLifecycleOptions): IRuntimeAction[] {
    return this._intercept('mount', runtime, this._config.mountMode, options, () => {
      if (this._config.mountMode === 'override') {
        return this._config.mountOverride(runtime);
      }
      return this._wrapped.mount(runtime, options);
    });
  }

  next(runtime: IScriptRuntime, options?: BlockLifecycleOptions): IRuntimeAction[] {
    return this._intercept('next', runtime, this._config.nextMode, options, () => {
      if (this._config.nextMode === 'override') {
        return this._config.nextOverride(runtime);
      }
      return this._wrapped.next(runtime, options);
    });
  }

  inspectNext(runtime: IRuntimeActionable, options?: BlockLifecycleOptions): CompletionDecision {
    return this._intercept('inspectNext', runtime as IScriptRuntime, this._config.inspectNextMode!, options, () => {
      if (this._config.inspectNextMode === 'override') {
        return this._config.inspectNextOverride!(runtime as IScriptRuntime);
      }
      return this._wrapped.inspectNext(runtime, options);
    });
  }

  unmount(runtime: IScriptRuntime, options?: BlockLifecycleOptions): IRuntimeAction[] {
    return this._intercept('unmount', runtime, this._config.unmountMode, options, () => {
      if (this._config.unmountMode === 'override') {
        return this._config.unmountOverride(runtime);
      }
      return this._wrapped.unmount(runtime, options);
    });
  }

  dispose(runtime: IScriptRuntime): void {
    this._intercept('dispose', runtime, this._config.disposeMode, undefined, () => {
      if (this._config.disposeMode === 'override') {
        this._config.disposeOverride(runtime);
        return;
      }
      this._wrapped.dispose(runtime);
    });
  }

  getBehavior<B extends IRuntimeBehavior>(
    behaviorType: new (...args: unknown[]) => B
  ): B | undefined {
    return this._wrapped.getBehavior(behaviorType);
  }

  // ========== Block-Owned Memory ==========

  pushMemory(location: import('@bitcobblers/wod-wiki-engine').IMemoryLocation): void {
    this._wrapped.pushMemory(location);
  }

  getMemoryByTag(tag: import('@bitcobblers/wod-wiki-engine').MemoryTag): import('@bitcobblers/wod-wiki-engine').IMemoryLocation[] {
    return this._wrapped.getMemoryByTag(tag);
  }

  getAllMemory(): import('@bitcobblers/wod-wiki-engine').IMemoryLocation[] {
    return this._wrapped.getAllMemory();
  }

  getMetricMemoryByVisibility(visibility: import('@bitcobblers/wod-wiki-engine').MetricVisibility): import('@bitcobblers/wod-wiki-engine').IMemoryLocation[] {
    return this._wrapped.getMetricMemoryByVisibility(visibility);
  }

  get completionReason(): string | undefined {
    return this._wrapped.completionReason;
  }


  // ========== Private Helpers ==========

  private _intercept<R>(
    method: keyof IRuntimeBlock,
    runtime: IScriptRuntime,
    mode: InterceptMode,
    options: BlockLifecycleOptions | undefined,
    execute: () => R
  ): R {
    const startTime = performance.now();
    const call: MethodCall = {
      method,
      args: [runtime, options],
      timestamp: Date.now(),
      duration: 0,
    };

    try {
      if (mode === 'ignore') {
        if (method === 'dispose') {
          call.returnValue = undefined;
        } else if (method === 'inspectNext') {
          call.returnValue = { complete: false, actions: [] };
        } else {
          call.returnValue = [];
        }
        return call.returnValue as R;
      }

      const result = execute();
      call.returnValue = result;
      return result;
    } catch (error) {
      call.error = error as Error;
      throw error;
    } finally {
      call.duration = performance.now() - startTime;
      this._calls.push(call);
    }
  }

  /** TestableBlock delegates everything to the wrapped block; effort hints
   *  are merged onto the wrapped block by the compilation pipeline. */
  mergeHints(hints: Readonly<Record<string, unknown>>): void {
    this._wrapped.mergeHints(hints);
  }
}

/**
 * Factory function to create a TestableBlock with a simple test ID
 */
export function createTestableBlock(
  wrapped: IRuntimeBlock,
  testId: string,
  config: Omit<TestableBlockConfig, 'testId'> = {}
): TestableBlock {
  return new TestableBlock(wrapped, { ...config, testId });
}
