import { ExecutionContextTestBuilder } from './ExecutionContextTestBuilder';
import { ExecutionContextTestHarness } from './ExecutionContextTestHarness';
import { MockBlock } from './MockBlock';
import { IRuntimeBehavior } from '@bitcobblers/wod-wiki-engine';
import { IRuntimeBlockStrategy } from '@bitcobblers/wod-wiki-engine';
import { IEventHandler } from '@bitcobblers/wod-wiki-engine';

/**
 * Configuration for timer test harness.
 */
export interface TimerTestConfig {
  /** Initial clock time. Default: 2024-01-01T12:00:00Z */
  clockTime?: Date;
  /** Max execution iterations. Default: 20 */
  maxDepth?: number;
}

/**
 * Configuration for behavior test harness.
 */
export interface BehaviorTestConfig {
  /** Initial clock time. Default: current time */
  clockTime?: Date;
  /** Max execution iterations. Default: 20 */
  maxDepth?: number;
  /** Block ID for the mock block. Default: 'test-block' */
  blockId?: string;
}

/**
 * Configuration for basic test harness.
 */
export interface BasicTestConfig {
  /** Initial clock time. Default: current time */
  clockTime?: Date;
  /** Max execution iterations. Default: 20 */
  maxDepth?: number;
  /** Add a timer mock block to the stack */
  withTimerBlock?: boolean;
  /** Add a loop mock block to the stack */
  withLoopBlock?: boolean;
}

/**
 * Create harness for testing timer-based behaviors.
 * Pre-configured with a sensible clock time.
 * 
 * @example
 * ```typescript
 * const harness = createTimerTestHarness({ clockTime: new Date('2024-01-01T12:00:00Z') });
 * harness.advanceClock(5000);
 * expect(harness.clock.now.getTime()).toBe(initialTime + 5000);
 * ```
 */
export function createTimerTestHarness(
  config: TimerTestConfig = {}
): ExecutionContextTestHarness {
  return new ExecutionContextTestBuilder()
    .withClock(config.clockTime ?? new Date('2024-01-01T12:00:00Z'))
    .withMaxDepth(config.maxDepth ?? 20)
    .build();
}

/**
 * Create harness for testing a behavior in isolation.
 * Creates a MockBlock with the behavior and pushes it to the stack.
 * 
 * @example
 * ```typescript
 * const behavior = new TimerBehavior('up');
 * const harness = createBehaviorTestHarness(behavior);
 * expect(harness.stack.count).toBe(1);
 * ```
 */
export function createBehaviorTestHarness(
  behavior: IRuntimeBehavior,
  config: BehaviorTestConfig = {}
): ExecutionContextTestHarness {
  const block = new MockBlock(config.blockId ?? 'test-block', [behavior]);

  return new ExecutionContextTestBuilder()
    .withClock(config.clockTime ?? new Date())
    .withMaxDepth(config.maxDepth ?? 20)
    .withBlocks(block)
    .build();
}

/**
 * Create harness for testing JIT compilation with strategies.
 * 
 * @example
 * ```typescript
 * const harness = createCompilationTestHarness([new TimerStrategy()]);
 * harness.mockJit.compile(statements, harness.runtime);
 * ```
 */
export function createCompilationTestHarness(
  strategies: IRuntimeBlockStrategy[],
  config: { clockTime?: Date } = {}
): ExecutionContextTestHarness {
  return new ExecutionContextTestBuilder()
    .withClock(config.clockTime ?? new Date())
    .withStrategies(...strategies)
    .build();
}

/**
 * Create a basic test harness with optional pre-configured blocks.
 * 
 * @example
 * ```typescript
 * const harness = createBasicTestHarness({ withTimerBlock: true });
 * expect(harness.stack.count).toBe(1);
 * ```
 */
export function createBasicTestHarness(
  config: BasicTestConfig = {}
): ExecutionContextTestHarness {
  const builder = new ExecutionContextTestBuilder()
    .withClock(config.clockTime ?? new Date())
    .withMaxDepth(config.maxDepth ?? 20);

  if (config.withTimerBlock) {
    const timerBlock = new MockBlock('timer', [], { blockType: 'Timer' });
    builder.withBlocks(timerBlock);
  }

  if (config.withLoopBlock) {
    const loopBlock = new MockBlock('loop', [], { blockType: 'Loop' });
    builder.withBlocks(loopBlock);
  }

  return builder.build();
}

/**
 * Create harness with event handlers pre-configured.
 * 
 * @example
 * ```typescript
 * const handlers = {
 *   'timer:start': { id: 'h1', name: 'H1', handler: () => [...] }
 * };
 * const harness = createEventTestHarness(handlers);
 * harness.dispatchEvent({ name: 'timer:start', timestamp: new Date() });
 * ```
 */
export function createEventTestHarness(
  handlers: Record<string, IEventHandler>,
  config: { clockTime?: Date } = {}
): ExecutionContextTestHarness {
  const builder = new ExecutionContextTestBuilder()
    .withClock(config.clockTime ?? new Date());

  for (const [eventName, handler] of Object.entries(handlers)) {
    builder.onEvent(eventName, handler);
  }

  return builder.build();
}
