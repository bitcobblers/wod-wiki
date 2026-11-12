/**
 * RuntimeFactory - Service for creating ScriptRuntime instances
 * 
 * This factory encapsulates the runtime creation logic, decoupling it from
 * UI components like WorkbenchContext. It handles:
 * - WhiteboardScript creation from block content
 * - ScriptRuntime instantiation with JIT compiler
 * - Root block compilation and mounting
 * - Optional debug mode enabling
 * 
 * @example
 * ```typescript
 * const factory = new RuntimeFactory(createCompiler());
 * const runtime = factory.createRuntime(scriptBlock);
 * 
 * // With debug mode
 * const debugRuntime = factory.createRuntime(scriptBlock, { debugMode: true });
 * ```
 */

import { ScriptRuntime } from '../ScriptRuntime';
import { RuntimeStack } from '../RuntimeStack';
import { RuntimeClock } from '../RuntimeClock';
import { EventBus } from '../events/EventBus';
import { JitCompiler } from './JitCompiler';
import { WhiteboardScript } from '../../parser/WhiteboardScript';
import type { ScriptBlock } from '@bitcobblers/wod-wiki-core';
import { RuntimeStackOptions } from '../contracts/IRuntimeOptions';
import type { IScriptRuntime } from '../contracts/IScriptRuntime';
import type { INowProvider } from '../INowProvider';
import { wallClockNow } from '../INowProvider';
import { StartSessionAction } from '../actions/stack/StartSessionAction';
import { createAnalyticsEngineForBlock } from '../../analytics/createAnalyticsEngineForBlock';
import { collapseUnresolvedChoices } from './metrics/ChoiceResolution';

/**
 * Interface for runtime factory implementations
 * Allows for dependency injection and testing
 */
export interface IRuntimeFactory {
  /**
   * Creates a new ScriptRuntime from a ScriptBlock
   * @param block - The WOD block containing workout script and parsed statements
   * @param options - Optional runtime options (debug mode, logging, tracker, etc.)
   * @returns A fully initialized ScriptRuntime, or null if block has no statements
   */
  createRuntime(block: ScriptBlock, options?: RuntimeStackOptions): IScriptRuntime | null;

  /**
   * Disposes of a runtime and cleans up resources
   * @param runtime - The runtime to dispose
   */
  disposeRuntime(runtime: IScriptRuntime): void;
}

/**
 * Default implementation of IRuntimeFactory
 */
export class RuntimeFactory implements IRuntimeFactory {
  constructor(
    private readonly compiler: JitCompiler,
    private readonly nowProvider: INowProvider = wallClockNow,
  ) { }

  /**
   * Creates a new ScriptRuntime from a ScriptBlock
   * 
   * Process:
   * 1. Validates block has statements
   * 2. Creates WhiteboardScript from content + statements
   * 3. Instantiates ScriptRuntime with JIT compiler and options
   * 4. Dispatches StartSessionAction to wrap script in session root block and push it
   * 
   * @param block - The WOD block to create runtime for
   * @param options - Optional runtime options (debug mode, logging, tracker, etc.)
   * @returns Initialized ScriptRuntime or null if invalid block
   */
  createRuntime(block: ScriptBlock, options?: RuntimeStackOptions): IScriptRuntime | null {
    if (!block.statements || block.statements.length === 0) {
      return null;
    }

    // Create WhiteboardScript from block content and statements
    const script = new WhiteboardScript(block.content, block.statements);

    // Collapse any unresolved Choice Groups BEFORE the runtime spins up its first
    // block. The Pre-Run Wizard resolves Choices at origin 'user-plan'; this is the
    // enforced safety net that defaults anything still unresolved to its first
    // alternative, guaranteeing a MetricType.Choice never reaches a compiled Block
    // — even on entry points that never surface the wizard.
    collapseUnresolvedChoices(script.statements);

    // Instantiate dependencies
    const stack = new RuntimeStack();
    // Share `nowProvider` with RuntimeClock so span open/close and expiry agree.
    const clock = new RuntimeClock(this.nowProvider);
    const eventBus = new EventBus();

    const dependencies = {
      stack,
      clock,
      eventBus
    };

    // Create runtime with JIT compiler and optional debug options
    const runtime = new ScriptRuntime(script, this.compiler, dependencies, options, this.nowProvider);

    // Wire analytics engine automatically for all runtimes
    const { engine, analyticsContext } = createAnalyticsEngineForBlock(block, options?.analyticsOptions);
    runtime.analyticsContext = analyticsContext;
    runtime.setAnalyticsEngine(engine);

    // Start the workout by dispatching StartSessionAction
    // This wraps the script in a SessionRootBlock (with WaitingToStart gate)
    // and pushes it onto the stack
    runtime.do(new StartSessionAction());

    return runtime;
  }

  /**
   * Disposes of a runtime, cleaning up all blocks and resources
   * 
   * @param runtime - The runtime to dispose
   */
  disposeRuntime(runtime: IScriptRuntime): void {

    runtime.dispose();
  }
}
