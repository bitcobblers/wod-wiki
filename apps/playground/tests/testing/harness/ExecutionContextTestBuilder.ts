import { ExecutionContextTestHarness, HarnessConfig } from './ExecutionContextTestHarness';
import { IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBlockStrategy } from '@bitcobblers/wod-wiki-engine';
import { IEventHandler } from '@bitcobblers/wod-wiki-engine';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';

/**
 * Block matcher predicate function type.
 */
export type BlockMatcherPredicate = (
  statements: ICodeStatement[],
  runtime: IScriptRuntime
) => boolean;

/**
 * Block or factory for creating blocks.
 */
export type BlockOrFactory = IRuntimeBlock | ((
  statements: ICodeStatement[],
  runtime: IScriptRuntime
) => IRuntimeBlock);

/**
 * Pending JIT matcher configuration.
 */
interface JitMatcherConfig {
  predicate: BlockMatcherPredicate;
  blockOrFactory: BlockOrFactory;
  priority?: number;
}

/**
 * Pending event handler configuration.
 */
interface EventHandlerConfig {
  eventName: string;
  handler: IEventHandler;
  ownerId: string;
}

/**
 * ExecutionContextTestBuilder - Fluent builder for creating ExecutionContextTestHarness.
 * 
 * Provides a clean, chainable API for configuring test harnesses with minimal boilerplate.
 * 
 * @example
 * ```typescript
 * const harness = new ExecutionContextTestBuilder()
 *   .withClock(new Date('2024-01-01T12:00:00Z'))
 *   .withMaxDepth(10)
 *   .whenTextContains('10:00', timerBlock)
 *   .withBlocks(parentBlock)
 *   .build();
 * ```
 */
export class ExecutionContextTestBuilder {
  private _config: HarnessConfig = {};
  private _jitMatchers: JitMatcherConfig[] = [];
  private _initialBlocks: IRuntimeBlock[] = [];
  private _eventHandlers: EventHandlerConfig[] = [];
  private _defaultBlock?: IRuntimeBlock;

  /**
   * Set initial clock time.
   * 
   * @param time The initial time for the mock clock
   * @returns this for method chaining
   */
  withClock(time: Date): this {
    this._config.clockTime = time;
    return this;
  }

  /**
   * Set max ExecutionContext iterations before throwing.
   * 
   * @param depth Maximum iteration depth (default: 20)
   * @returns this for method chaining
   */
  withMaxDepth(depth: number): this {
    this._config.maxDepth = depth;
    return this;
  }

  /**
   * Register JIT compilation strategies.
   * 
   * @param strategies Strategies to register with the MockJitCompiler
   * @returns this for method chaining
   */
  withStrategies(...strategies: IRuntimeBlockStrategy[]): this {
    this._config.strategies = [
      ...(this._config.strategies ?? []),
      ...strategies
    ];
    return this;
  }

  /**
   * Configure MockJitCompiler to return block when predicate matches.
   * 
   * @param predicate Function to test if this matcher should apply
   * @param blockOrFactory Block to return, or factory to create one
   * @param priority Higher priority matchers are evaluated first (default: 0)
   * @returns this for method chaining
   */
  whenCompiling(
    predicate: BlockMatcherPredicate,
    blockOrFactory: BlockOrFactory,
    priority?: number
  ): this {
    this._jitMatchers.push({ predicate, blockOrFactory, priority });
    return this;
  }

  /**
   * Configure MockJitCompiler to return block when serialized statement contains text.
   * 
   * @param substring Text to search for (case-insensitive)
   * @param blockOrFactory Block to return, or factory to create one
   * @param priority Higher priority matchers are evaluated first (default: 0)
   * @returns this for method chaining
   */
  whenTextContains(
    substring: string,
    blockOrFactory: BlockOrFactory,
    priority?: number
  ): this {
    return this.whenCompiling(
      (statements) => statements.some(s => 
        JSON.stringify(s).toLowerCase().includes(substring.toLowerCase())
      ),
      blockOrFactory,
      priority
    );
  }

  /**
   * Configure MockJitCompiler to return block for statements with specific IDs.
   * 
   * @param ids Statement IDs that should match
   * @param blockOrFactory Block to return, or factory to create one
   * @param priority Higher priority matchers are evaluated first (default: 0)
   * @returns this for method chaining
   */
  whenStatementIds(
    ids: number[],
    blockOrFactory: BlockOrFactory,
    priority?: number
  ): this {
    return this.whenCompiling(
      (statements) => ids.every(id => statements.some(s => s.id === id)),
      blockOrFactory,
      priority
    );
  }

  /**
   * Set default block to return when no matchers match.
   * 
   * @param block Default block
   * @returns this for method chaining
   */
  withDefaultBlock(block: IRuntimeBlock): this {
    this._defaultBlock = block;
    return this;
  }

  /**
   * Push block(s) to stack when harness is built.
   * 
   * @param blocks Blocks to push onto the stack
   * @returns this for method chaining
   */
  withBlocks(...blocks: IRuntimeBlock[]): this {
    this._initialBlocks.push(...blocks);
    return this;
  }

  /**
   * Register an event handler with global scope.
   * Global scope ensures the handler fires regardless of stack state.
   * 
   * @param eventName Event name to listen for
   * @param handler Event handler
   * @param ownerId Owner ID for the handler (default: 'test-builder')
   * @returns this for method chaining
   */
  onEvent(
    eventName: string,
    handler: IEventHandler,
    ownerId: string = 'test-builder'
  ): this {
    this._eventHandlers.push({ eventName, handler, ownerId });
    return this;
  }

  /**
   * Build the harness with all configurations applied.
   * 
   * @returns Configured ExecutionContextTestHarness
   */
  build(): ExecutionContextTestHarness {
    const harness = new ExecutionContextTestHarness(this._config);

    // Configure MockJitCompiler matchers
    for (const { predicate, blockOrFactory, priority } of this._jitMatchers) {
      harness.mockJit.whenMatches(predicate, blockOrFactory, priority);
    }

    // Set default block if configured
    if (this._defaultBlock) {
      harness.mockJit.withDefaultBlock(this._defaultBlock);
    }

    // Push initial blocks to stack
    for (const block of this._initialBlocks) {
      harness.stack.push(block);
    }

    // Register event handlers with global scope so they fire regardless of stack state
    for (const { eventName, handler, ownerId } of this._eventHandlers) {
      harness.eventBus.register(eventName, handler, ownerId, { scope: 'global' });
    }

    return harness;
  }
}
