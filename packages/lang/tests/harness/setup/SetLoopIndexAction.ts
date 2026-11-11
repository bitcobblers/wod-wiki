/**
 * SetLoopIndexAction
 * 
 * Test setup action that sets the current loop index for a rounds/loop block.
 * This is commonly needed to test mid-execution scenarios.
 */

import { IScriptRuntime } from '@bitcobblers/wod-wiki-lang';
import {
  ITestSetupAction,
  TestSetupActionJSON,
  TestSetupActionFactory,
  TestSetupActionParamSchema
} from '../setup/ITestSetupAction';

export interface SetLoopIndexParams {
  /** Block key of the rounds/loop block */
  blockKey: string;
  /** Current index to set (0-based) */
  currentIndex: number;
  /** Total iterations (optional, for display) */
  totalIterations?: number;
}

/**
 * Action that sets the current loop iteration for a block.
 * Looks for 'loop:state' or 'rounds:state' memory types.
 */
export class SetLoopIndexAction implements ITestSetupAction {
  readonly type = 'setLoopIndex';
  readonly targetBlockKey: string;

  constructor(
    private readonly params: SetLoopIndexParams
  ) {
    this.targetBlockKey = params.blockKey;
  }

  get description(): string {
    const total = this.params.totalIterations
      ? ` of ${this.params.totalIterations}`
      : '';
    return `Set loop index to ${this.params.currentIndex}${total} for "${this.params.blockKey}"`;
  }

  apply(runtime: IScriptRuntime): void {
    // Try to find loop state memory
    const memoryTypes = ['loop:state', 'rounds:state', 'iterator:state'];

    const block = runtime.stack.blocks.find(b => b.key.toString() === this.params.blockKey);
    if (!block) {
      console.warn(`SetLoopIndexAction: Block "${this.params.blockKey}" not found in stack.`);
      return;
    }

    for (const memoryType of memoryTypes) {
      const loc = block.getMemoryByTag(memoryType as any)[0];

      if (loc?.metrics[0]) {
        const currentValue = loc.metrics[0].value;
        const newValue = typeof currentValue === 'object' && currentValue !== null
          ? { ...currentValue, currentIndex: this.params.currentIndex }
          : { currentIndex: this.params.currentIndex, total: this.params.totalIterations };

        loc.update([{ ...loc.metrics[0], value: newValue }]);
        return; // Found and set, done
      }
    }

    console.warn(
      `SetLoopIndexAction: No loop state found for block "${this.params.blockKey}". ` +
      `Looked for types: ${memoryTypes.join(', ')}`
    );
  }

  toJSON(): TestSetupActionJSON {
    return {
      type: this.type,
      targetBlockKey: this.targetBlockKey,
      params: {
        blockKey: this.params.blockKey,
        currentIndex: this.params.currentIndex,
        totalIterations: this.params.totalIterations
      }
    };
  }
}

/**
 * Factory for creating SetLoopIndexAction from UI/JSON
 */
export const SetLoopIndexActionFactory: TestSetupActionFactory = {
  type: 'setLoopIndex',
  label: 'Set Loop Index',
  description: 'Sets the current iteration index for a rounds/loop block',
  paramSchema: [
    { name: 'blockKey', type: 'blockKey', label: 'Target Block', required: true },
    { name: 'currentIndex', type: 'number', label: 'Current Index (0-based)', required: true, defaultValue: 0 },
    { name: 'totalIterations', type: 'number', label: 'Total Iterations', required: false }
  ] as TestSetupActionParamSchema[],
  create: (params: Record<string, unknown>) => new SetLoopIndexAction({
    blockKey: params.blockKey as string,
    currentIndex: params.currentIndex as number,
    totalIterations: params.totalIterations as number | undefined
  })
};
