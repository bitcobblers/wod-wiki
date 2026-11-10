/**
 * Test Setup Actions - Index
 * 
 * Exports all test setup action types, factories, and registry utilities.
 */

// Core interfaces
export type {
  ITestSetupAction,
  TestSetupActionJSON,
  TestSetupActionFactory,
  TestSetupActionParamSchema
} from './ITestSetupAction';

// Concrete actions
export { SetMemoryValueAction, SetMemoryValueActionFactory } from './SetMemoryValueAction';
export type { SetMemoryValueParams } from './SetMemoryValueAction';

export { SetLoopIndexAction, SetLoopIndexActionFactory } from './SetLoopIndexAction';
export type { SetLoopIndexParams } from './SetLoopIndexAction';

export { SetTimerStateAction, SetTimerStateActionFactory } from './SetTimerStateAction';
export type { SetTimerStateParams } from './SetTimerStateAction';

export { SetEffortStateAction, SetEffortStateActionFactory } from './SetEffortStateAction';
export type { SetEffortStateParams } from './SetEffortStateAction';

export { AllocateTestMemoryAction, AllocateTestMemoryActionFactory } from './AllocateTestMemoryAction';
export type { AllocateTestMemoryParams } from './AllocateTestMemoryAction';

// Registry and utilities
export {
  getAllActionFactories,
  getActionFactory,
  registerActionFactory,
  createActionFromJSON,
  serializeActions,
  deserializeActions,
  TEST_SETUP_PRESETS,
  getPresetsByCategory,
  getPresetById,
  applyPresetWithBlockKey
} from './TestSetupActionRegistry';
export type { TestSetupPreset } from './TestSetupActionRegistry';
