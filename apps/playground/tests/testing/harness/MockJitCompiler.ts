import { JitCompiler } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBlock } from '@bitcobblers/wod-wiki-engine';
import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBlockStrategy } from '@bitcobblers/wod-wiki-engine';
import type { CodeStatement } from '@bitcobblers/wod-wiki-engine';

/**
 * Record of a single compile() call for inspection in tests.
 */
export interface CompileCall {
  /** Statements passed to compile() */
  statements: CodeStatement[];
  /** Runtime context passed to compile() */
  runtime: IScriptRuntime;
  /** Timestamp when compile() was called */
  timestamp: Date;
  /** Block returned from compile() */
  result: IRuntimeBlock | undefined;
}

/**
 * Predicate-based matcher for statements.
 * Used to configure MockJitCompiler to return specific blocks for matching statements.
 */
export interface BlockMatcher {
  /** Function to determine if this matcher applies */
  predicate: (statements: CodeStatement[], runtime: IScriptRuntime) => boolean;
  /** Block to return, or factory to create one dynamically */
  blockOrFactory: IRuntimeBlock | ((statements: CodeStatement[], runtime: IScriptRuntime) => IRuntimeBlock);
  /** Higher priority matchers are evaluated first. Default: 0 */
  priority: number;
}

/**
 * MockJitCompiler extends JitCompiler to provide:
 * - Recording of all compile() calls for inspection
 * - Predicate-based block matching for test configuration
 * - Convenient text-based matchers
 * - Factory functions for dynamic block creation
 * - Default block fallback
 * 
 * @example
 * ```typescript
 * const mockJit = new MockJitCompiler();
 * 
 * // Return specific block for timer statements
 * mockJit.whenTextContains('10:00', new MockBlock('timer', []));
 * 
 * // Use factory for dynamic creation
 * mockJit.whenMatches(
 *   (stmts) => stmts.some(s => s.metrics.some(f => f.metricType === MetricType.Effort)),
 *   (stmts, runtime) => new MockBlock(`effort-${stmts[0].id}`, [])
 * );
 * 
 * // Inspect after execution
 * expect(mockJit.compileCalls).toHaveLength(2);
 * expect(mockJit.wasCompiled(c => c.statements.length > 0)).toBe(true);
 * ```
 */
export class MockJitCompiler extends JitCompiler {
  private _compileCalls: CompileCall[] = [];
  private _matchers: BlockMatcher[] = [];
  private _defaultBlock?: IRuntimeBlock;

  constructor(strategies: IRuntimeBlockStrategy[] = []) {
    super(strategies);
  }

  /**
   * Override compile to record calls and optionally return matched block.
   * 
   * Evaluation order:
   * 1. Matchers sorted by priority (descending) - first match wins
   * 2. Default block if configured
   * 3. Parent JitCompiler.compile() if no default
   */
  override compile(statements: CodeStatement[], runtime: IScriptRuntime): IRuntimeBlock | undefined {
    const startTime = new Date();
    let result: IRuntimeBlock | undefined;

    // Check matchers in priority order (higher priority first)
    const sortedMatchers = [...this._matchers].sort((a, b) => b.priority - a.priority);

    for (const matcher of sortedMatchers) {
      if (matcher.predicate(statements, runtime)) {
        result = typeof matcher.blockOrFactory === 'function'
          ? matcher.blockOrFactory(statements, runtime)
          : matcher.blockOrFactory;
        break;
      }
    }

    // Fallback to default or parent compilation
    if (!result) {
      result = this._defaultBlock ?? super.compile(statements, runtime);
    }

    // Record the call
    this._compileCalls.push({
      statements: [...statements], // Shallow copy to preserve state at call time
      runtime,
      timestamp: startTime,
      result
    });

    return result;
  }

  // ============================================================================
  // Configuration API (Fluent)
  // ============================================================================

  /**
   * Register a matcher with custom predicate.
   * 
   * @param predicate Function that returns true if this matcher should apply
   * @param blockOrFactory Block to return, or factory function to create one
   * @param priority Higher priority matchers are evaluated first. Default: 0
   * @returns this for method chaining
   * 
   * @example
   * ```typescript
   * mockJit.whenMatches(
   *   (stmts) => stmts.some(s => s.metrics.some(f => f.metricType === MetricType.Duration)),
   *   new MockBlock('timer', [])
   * );
   * ```
   */
  whenMatches(
    predicate: (statements: CodeStatement[], runtime: IScriptRuntime) => boolean,
    blockOrFactory: IRuntimeBlock | ((statements: CodeStatement[], runtime: IScriptRuntime) => IRuntimeBlock),
    priority: number = 0
  ): this {
    this._matchers.push({ predicate, blockOrFactory, priority });
    return this;
  }

  /**
   * Convenience matcher that checks if any statement contains the given text.
   * Uses case-insensitive JSON.stringify matching.
   * 
   * @param text Text to search for in serialized statements
   * @param blockOrFactory Block to return, or factory function to create one
   * @param priority Higher priority matchers are evaluated first. Default: 0
   * @returns this for method chaining
   * 
   * @example
   * ```typescript
   * mockJit.whenTextContains('10:00', new MockBlock('timer-10', []));
   * ```
   */
  whenTextContains(
    text: string,
    blockOrFactory: IRuntimeBlock | ((statements: CodeStatement[], runtime: IScriptRuntime) => IRuntimeBlock),
    priority: number = 0
  ): this {
    return this.whenMatches(
      (statements) => statements.some(s => 
        JSON.stringify(s).toLowerCase().includes(text.toLowerCase())
      ),
      blockOrFactory,
      priority
    );
  }

  /**
   * Set default block to return when no matchers match.
   * If not set, falls back to parent JitCompiler.compile().
   * 
   * @param block Default block to return
   * @returns this for method chaining
   */
  withDefaultBlock(block: IRuntimeBlock): this {
    this._defaultBlock = block;
    return this;
  }

  // ============================================================================
  // Assertion API
  // ============================================================================

  /**
   * Get all recorded compile() calls.
   * Returns a copy to prevent mutation.
   */
  get compileCalls(): readonly CompileCall[] {
    return [...this._compileCalls];
  }

  /**
   * Get the most recent compile() call, or undefined if none.
   */
  get lastCompileCall(): CompileCall | undefined {
    return this._compileCalls[this._compileCalls.length - 1];
  }

  /**
   * Clear all recorded calls. Does not clear matchers or default block.
   * Call this in beforeEach() to reset state between tests.
   */
  clearCalls(): void {
    this._compileCalls = [];
  }

  /**
   * Check if any compile() call matches the predicate.
   * 
   * @param predicate Function to test each CompileCall
   * @returns true if any call matches
   * 
   * @example
   * ```typescript
   * expect(mockJit.wasCompiled(c => c.statements.some(s => s.id === 1))).toBe(true);
   * ```
   */
  wasCompiled(predicate: (call: CompileCall) => boolean): boolean {
    return this._compileCalls.some(predicate);
  }

  /**
   * Extract all statement IDs from all compile() calls.
   * Useful for verifying which statements were compiled.
   * 
   * @returns Array of statement IDs in call order
   */
  getCompiledStatementIds(): number[] {
    return this._compileCalls.flatMap(call => call.statements.map(s => s.id));
  }
}
