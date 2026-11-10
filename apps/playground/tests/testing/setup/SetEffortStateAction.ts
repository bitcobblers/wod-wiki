/**
 * SetEffortStateAction
 * 
 * Test setup action that sets effort block state (current reps, completion).
 * Commonly used to test effort blocks at various completion stages.
 */

import { IScriptRuntime, type MemoryTag } from '@bitcobblers/wod-wiki-engine';
import {
  ITestSetupAction,
  TestSetupActionJSON,
  TestSetupActionFactory,
  TestSetupActionParamSchema
} from './ITestSetupAction';

export interface SetEffortStateParams {
  /** Block key of the effort block */
  blockKey: string;
  /** Current reps completed */
  currentReps?: number;
  /** Target reps (if different from initial) */
  targetReps?: number;
  /** Mark as complete */
  isComplete?: boolean;
}

/**
 * Action that sets effort state for an effort block.
 * Looks for 'effort:state' memory type.
 */
export class SetEffortStateAction implements ITestSetupAction {
  readonly type = 'setEffortState';
  readonly targetBlockKey: string;

  constructor(
    private readonly params: SetEffortStateParams
  ) {
    this.targetBlockKey = params.blockKey;
  }

  get description(): string {
    const parts: string[] = [];
    if (this.params.currentReps !== undefined) {
      parts.push(`currentReps=${this.params.currentReps}`);
    }
    if (this.params.targetReps !== undefined) {
      parts.push(`targetReps=${this.params.targetReps}`);
    }
    if (this.params.isComplete !== undefined) {
      parts.push(`complete=${this.params.isComplete}`);
    }
    return `Set effort state for "${this.params.blockKey}": ${parts.join(', ')}`;
  }

  apply(runtime: IScriptRuntime): void {
    // Try multiple memory type variations
    const memoryTypes = ['effort:state', 'effort', 'metric:reps'];

    const block = runtime.stack.blocks.find(b => b.key.toString() === this.params.blockKey);
    if (!block) {
      console.warn(`SetEffortStateAction: Block "${this.params.blockKey}" not found in stack.`);
      return;
    }

    for (const memoryType of memoryTypes) {
      const loc = block.getMemoryByTag(memoryType as unknown as MemoryTag)[0];

      if (loc?.metrics[0]) {
        const currentValue = loc.metrics[0].value;
        let newValue: Record<string, unknown> | number;

        // Handle different memory shapes
        if (typeof currentValue === 'object' && currentValue !== null) {
          const obj: Record<string, unknown> = { ...(currentValue as Record<string, unknown>) };
          if (this.params.currentReps !== undefined) {
            obj.currentReps = this.params.currentReps;
            obj.reps = this.params.currentReps;
          }
          if (this.params.targetReps !== undefined) {
            obj.targetReps = this.params.targetReps;
            obj.target = this.params.targetReps;
          }
          if (this.params.isComplete !== undefined) {
            obj.isComplete = this.params.isComplete;
            obj.complete = this.params.isComplete;
          }
          newValue = obj;
        } else if (typeof currentValue === 'number') {
          // Simple number value (like metric:reps)
          newValue = this.params.currentReps ?? currentValue;
        } else {
          newValue = {
            currentReps: this.params.currentReps ?? 0,
            targetReps: this.params.targetReps,
            isComplete: this.params.isComplete ?? false
          };
        }

        loc.update([{ ...loc.metrics[0], value: newValue }]);
        return; // Found and set, done
      }
    }

    console.warn(
      `SetEffortStateAction: No effort state found for block "${this.params.blockKey}". ` +
      `Looked for types: ${memoryTypes.join(', ')}`
    );
  }

  toJSON(): TestSetupActionJSON {
    return {
      type: this.type,
      targetBlockKey: this.targetBlockKey,
      params: {
        blockKey: this.params.blockKey,
        currentReps: this.params.currentReps,
        targetReps: this.params.targetReps,
        isComplete: this.params.isComplete
      }
    };
  }
}

/**
 * Factory for creating SetEffortStateAction from UI/JSON
 */
export const SetEffortStateActionFactory: TestSetupActionFactory = {
  type: 'setEffortState',
  label: 'Set Effort State',
  description: 'Sets current/target reps and completion state for an effort block',
  paramSchema: [
    { name: 'blockKey', type: 'blockKey', label: 'Target Block', required: true },
    { name: 'currentReps', type: 'number', label: 'Current Reps', required: false, defaultValue: 0 },
    { name: 'targetReps', type: 'number', label: 'Target Reps', required: false },
    { name: 'isComplete', type: 'boolean', label: 'Is Complete', required: false, defaultValue: false }
  ] as TestSetupActionParamSchema[],
  create: (params: Record<string, unknown>) => new SetEffortStateAction({
    blockKey: params.blockKey as string,
    currentReps: params.currentReps as number | undefined,
    targetReps: params.targetReps as number | undefined,
    isComplete: params.isComplete as boolean | undefined
  })
};
