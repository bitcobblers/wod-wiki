import { ScriptRuntime } from '../ScriptRuntime';

import { RuntimeStack } from '../RuntimeStack';
import { RuntimeClock } from '../RuntimeClock';
import { EventBus } from '../events/EventBus';
import { JitCompiler } from './JitCompiler';
import type { WhiteboardScript } from '../../parser/WhiteboardScript';
import { IRuntimeOptions, DEFAULT_RUNTIME_OPTIONS } from '../contracts/IRuntimeOptions';
import type { INowProvider } from '../INowProvider';
import { wallClockNow } from '../INowProvider';
import type { TestableBlockConfig } from '../contracts/ITestableBlockConfig';

/**
 * RuntimeBuilder provides a fluent API for constructing ScriptRuntime instances
 * with configurable options including debug mode, logging, and custom block wrappers.
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const runtime = new RuntimeBuilder(script, compiler).build();
 * 
 * // With debug mode
 * const debugRuntime = new RuntimeBuilder(script, compiler)
 *   .withDebugMode(true)
 *   .build();
 * 
 * // With custom configuration
 * const customRuntime = new RuntimeBuilder(script, compiler)
 *   .withDebugMode(true)
 *   .withLogging(true)
 *   .withDefaultTestableConfig({ mountMode: 'spy', nextMode: 'spy' })
 *   .withDebugLogHandler((event) => {
 *     console.log('[Debug]', event);
 *   })
 *   .build();
 * ```
 */
export class RuntimeBuilder {
    private readonly options: IRuntimeOptions = { ...DEFAULT_RUNTIME_OPTIONS };
    private nowProvider: INowProvider = wallClockNow;

    constructor(
        private readonly script: WhiteboardScript,
        private readonly compiler: JitCompiler
    ) { }

    /**
     * Enable or disable debug mode.
     * When enabled:
     * - All blocks are wrapped with TestableBlock for inspection
     * - Lifecycle events are tracked and can be inspected
     */
    withDebugMode(enabled: boolean): this {
        this.options.debugMode = enabled;
        if (enabled) {
            // Auto-enable logging in debug mode
            this.options.enableLogging = true;
        }
        return this;
    }

    /**
     * Enable or disable debug logging.
     * Can be enabled independently of debug mode for lighter-weight logging.
     */
    withLogging(enabled: boolean): this {
        this.options.enableLogging = enabled;
        return this;
    }

    /**
     * Set default TestableBlock configuration.
     * Applied to all blocks wrapped in debug mode.
     */
    withDefaultTestableConfig(config: Partial<TestableBlockConfig>): this {
        this.options.defaultTestableConfig = config;
        return this;
    }

    /**
     * Set a custom block wrapper factory.
     * Use this to customize how blocks are wrapped in debug mode.
     */
    withBlockWrapperFactory(factory: IRuntimeOptions['blockWrapperFactory']): this {
        this.options.blockWrapperFactory = factory;
        return this;
    }

    /**
     * Set a custom debug log handler.
     * Called for every debug event in addition to console logging.
     */
    withDebugLogHandler(handler: IRuntimeOptions['onDebugLog']): this {
        this.options.onDebugLog = handler;
        return this;
    }

    /**
     * Set a custom INowProvider (time seam — see docs/adr/time-seam.md).
     * Defaults to wall-clock.
     */
    withNowProvider(provider: INowProvider): this {
        this.nowProvider = provider;
        return this;
    }

    /**
     * Get the current options (for inspection/debugging)
     */
    getOptions(): Readonly<IRuntimeOptions> {
        return { ...this.options };
    }

    /**
     * Build the ScriptRuntime with the configured options.
     */
    build(): ScriptRuntime {
        // Create runtime with options
        const dependencies = {
            stack: new RuntimeStack(),
            clock: new RuntimeClock(),
            eventBus: new EventBus()
        };
        return new ScriptRuntime(this.script, this.compiler, dependencies, this.options, this.nowProvider);
    }

    /**
     * Build the runtime and also return the options used.
     * Useful for debugging the builder configuration.
     */
    buildWithOptions(): { runtime: ScriptRuntime; options: IRuntimeOptions } {
        const runtime = this.build();
        return { runtime, options: { ...this.options } };
    }
}

/**
 * Factory function to create a RuntimeBuilder.
 * Convenience function for creating builders.
 * 
 * @example
 * ```typescript
 * const runtime = createRuntimeBuilder(script, compiler)
 *   .withDebugMode(true)
 *   .build();
 * ```
 */
export function createRuntimeBuilder(script: WhiteboardScript, compiler: JitCompiler): RuntimeBuilder {
    return new RuntimeBuilder(script, compiler);
}
