/**
 * Test Setup Actions
 * 
 * These actions are used during test scenario setup to manipulate
 * runtime state before executing lifecycle operations (mount/next/unmount).
 * 
 * Unlike runtime actions (IRuntimeAction), test setup actions:
 * - Target blocks by their block key (string) 
 * - Can modify memory values directly
 * - Are applied before the test operation runs
 */

import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';

/**
 * Interface for test setup actions that modify runtime state
 * before test execution.
 */
export interface ITestSetupAction {
  /** Type identifier for the action */
  readonly type: string;
  
  /** Human-readable description of what this action does */
  readonly description: string;
  
  /** Target block key (if applicable) */
  readonly targetBlockKey?: string;
  
  /** Apply the setup action to the runtime */
  apply(runtime: IScriptRuntime): void;
  
  /** Serialize to JSON for scenario persistence */
  toJSON(): TestSetupActionJSON;
}

/**
 * JSON representation for serialization/deserialization
 */
export interface TestSetupActionJSON {
  type: string;
  targetBlockKey?: string;
  params: Record<string, unknown>;
}

/**
 * Registry entry for action factory
 */
export interface TestSetupActionFactory {
  type: string;
  label: string;
  description: string;
  paramSchema: TestSetupActionParamSchema[];
  create: (params: Record<string, unknown>) => ITestSetupAction;
}

/**
 * Schema for action parameters (for UI generation)
 */
export interface TestSetupActionParamSchema {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'blockKey';
  label: string;
  required: boolean;
  defaultValue?: unknown;
  options?: { value: string; label: string }[]; // For select type
}
