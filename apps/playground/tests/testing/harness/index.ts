// Mock infrastructure
export { MockJitCompiler } from './MockJitCompiler';
export type { CompileCall, BlockMatcher } from './MockJitCompiler';

// ExecutionContext testing (Phase 2 — will collapse into BehaviorTestHarness in Phase D)
export { ExecutionContextTestHarness } from './ExecutionContextTestHarness';
export type { ActionExecution, EventDispatch, HarnessConfig } from './ExecutionContextTestHarness';

// Builder & Factory Methods
export { ExecutionContextTestBuilder } from './ExecutionContextTestBuilder';
export type { BlockMatcherPredicate, BlockOrFactory } from './ExecutionContextTestBuilder';
export {
  createTimerTestHarness,
  createBehaviorTestHarness,
  createCompilationTestHarness,
  createBasicTestHarness,
  createEventTestHarness
} from './factory';
export type {
  TimerTestConfig,
  BehaviorTestConfig,
  BasicTestConfig
} from './factory';

// Behavior-level testing

// Generic runtime testing
export { RuntimeTestHarness, RuntimeTestBuilder } from './RuntimeTestBuilder';
export type { MemoryEntry } from './RuntimeTestBuilder';
export { BehaviorTestHarness } from './BehaviorTestHarness';
export { StrategyTestHarness, AppliedStrategy, apply, stmtWith, makeStatement, stubRuntime } from './StrategyTestHarness';
export type { AppliedStrategy as AppliedStrategyView } from './StrategyTestHarness';
export { MockBlock } from './MockBlock';
export type { MockBlockConfig, BehaviorContextRecordings } from './MockBlock';

// Effort Registry mocks
export { MockEffortResolver } from './MockEffortResolver';
