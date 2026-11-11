/**
 * Test Setup Action Registry
 * 
 * Central registry for all test setup action types.
 * Provides factory lookup, serialization, and preset definitions.
 */

import { 
  ITestSetupAction, 
  TestSetupActionJSON, 
  TestSetupActionFactory 
} from './ITestSetupAction';
import { SetMemoryValueActionFactory } from './SetMemoryValueAction';
import { SetLoopIndexActionFactory } from './SetLoopIndexAction';
import { SetTimerStateActionFactory } from './SetTimerStateAction';
import { SetEffortStateActionFactory } from './SetEffortStateAction';
import { AllocateTestMemoryActionFactory } from './AllocateTestMemoryAction';

/**
 * All registered test setup action factories
 */
const actionFactories: Map<string, TestSetupActionFactory> = new Map();

// Register built-in factories
const builtInFactories: TestSetupActionFactory[] = [
  SetMemoryValueActionFactory,
  SetLoopIndexActionFactory,
  SetTimerStateActionFactory,
  SetEffortStateActionFactory,
  AllocateTestMemoryActionFactory
];

for (const factory of builtInFactories) {
  actionFactories.set(factory.type, factory);
}

/**
 * Get all registered action factories (for UI dropdown)
 */
export function getAllActionFactories(): TestSetupActionFactory[] {
  return Array.from(actionFactories.values());
}

/**
 * Get a specific factory by type
 */
export function getActionFactory(type: string): TestSetupActionFactory | undefined {
  return actionFactories.get(type);
}

/**
 * Register a custom action factory
 */
export function registerActionFactory(factory: TestSetupActionFactory): void {
  actionFactories.set(factory.type, factory);
}

/**
 * Create an action from JSON (for deserialization)
 */
export function createActionFromJSON(json: TestSetupActionJSON): ITestSetupAction {
  const factory = actionFactories.get(json.type);
  if (!factory) {
    throw new Error(`Unknown test setup action type: ${json.type}`);
  }
  return factory.create(json.params);
}

/**
 * Serialize an array of actions to JSON
 */
export function serializeActions(actions: ITestSetupAction[]): TestSetupActionJSON[] {
  return actions.map(a => a.toJSON());
}

/**
 * Deserialize an array of actions from JSON
 */
export function deserializeActions(json: TestSetupActionJSON[]): ITestSetupAction[] {
  return json.map(createActionFromJSON);
}

/**
 * Preset action configurations for common test scenarios
 */
export interface TestSetupPreset {
  id: string;
  name: string;
  description: string;
  category: 'timer' | 'rounds' | 'effort' | 'memory' | 'general';
  actions: TestSetupActionJSON[];
}

/**
 * Built-in presets for common testing scenarios
 */
export const TEST_SETUP_PRESETS: TestSetupPreset[] = [
  // Timer presets
  {
    id: 'timer-50-percent',
    name: 'Timer at 50%',
    description: 'Set timer to 50% elapsed (30 seconds of 60)',
    category: 'timer',
    actions: [
      { type: 'setTimerState', params: { blockKey: '{{currentBlock}}', elapsedMs: 30000, totalMs: 60000 } }
    ]
  },
  {
    id: 'timer-almost-complete',
    name: 'Timer Almost Complete',
    description: 'Set timer to 95% elapsed (57 seconds of 60)',
    category: 'timer',
    actions: [
      { type: 'setTimerState', params: { blockKey: '{{currentBlock}}', elapsedMs: 57000, totalMs: 60000 } }
    ]
  },
  {
    id: 'timer-paused',
    name: 'Timer Paused',
    description: 'Set timer to paused state at 30 seconds',
    category: 'timer',
    actions: [
      { type: 'setTimerState', params: { blockKey: '{{currentBlock}}', elapsedMs: 30000, isPaused: true } }
    ]
  },
  
  // Rounds presets
  {
    id: 'rounds-iteration-2-of-3',
    name: 'Rounds: 2 of 3',
    description: 'Set rounds block to iteration 2 of 3 (index 1)',
    category: 'rounds',
    actions: [
      { type: 'setLoopIndex', params: { blockKey: '{{currentBlock}}', currentIndex: 1, totalIterations: 3 } }
    ]
  },
  {
    id: 'rounds-last-iteration',
    name: 'Rounds: Last Iteration',
    description: 'Set rounds block to final iteration',
    category: 'rounds',
    actions: [
      { type: 'setLoopIndex', params: { blockKey: '{{currentBlock}}', currentIndex: 2, totalIterations: 3 } }
    ]
  },
  
  // Effort presets
  {
    id: 'effort-half-done',
    name: 'Effort: Half Complete',
    description: 'Set effort to 50% reps done (5 of 10)',
    category: 'effort',
    actions: [
      { type: 'setEffortState', params: { blockKey: '{{currentBlock}}', currentReps: 5, targetReps: 10 } }
    ]
  },
  {
    id: 'effort-one-remaining',
    name: 'Effort: One Rep Left',
    description: 'Set effort to just one rep remaining (9 of 10)',
    category: 'effort',
    actions: [
      { type: 'setEffortState', params: { blockKey: '{{currentBlock}}', currentReps: 9, targetReps: 10 } }
    ]
  },
  {
    id: 'effort-complete',
    name: 'Effort: Complete',
    description: 'Set effort as fully complete',
    category: 'effort',
    actions: [
      { type: 'setEffortState', params: { blockKey: '{{currentBlock}}', isComplete: true } }
    ]
  },
  
  // Memory/inheritance presets
  {
    id: 'inherit-reps-21',
    name: 'Inherit 21 Reps',
    description: 'Allocate parent reps memory with 21 (for 21-15-9 style)',
    category: 'memory',
    actions: [
      { type: 'allocateTestMemory', params: { type: 'metric:reps', ownerId: 'test-parent', value: 21, visibility: 'public' } }
    ]
  },
  {
    id: 'inherit-reps-15',
    name: 'Inherit 15 Reps',
    description: 'Allocate parent reps memory with 15',
    category: 'memory',
    actions: [
      { type: 'allocateTestMemory', params: { type: 'metric:reps', ownerId: 'test-parent', value: 15, visibility: 'public' } }
    ]
  }
];

/**
 * Get presets by category
 */
export function getPresetsByCategory(category: TestSetupPreset['category']): TestSetupPreset[] {
  return TEST_SETUP_PRESETS.filter(p => p.category === category);
}

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): TestSetupPreset | undefined {
  return TEST_SETUP_PRESETS.find(p => p.id === id);
}

/**
 * Apply preset actions with block key substitution
 * Replaces {{currentBlock}} with the actual block key
 */
export function applyPresetWithBlockKey(preset: TestSetupPreset, blockKey: string): ITestSetupAction[] {
  const substitutedJson = preset.actions.map(action => ({
    ...action,
    params: Object.fromEntries(
      Object.entries(action.params).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.replace('{{currentBlock}}', blockKey) : value
      ])
    )
  }));
  
  return deserializeActions(substitutedJson);
}
