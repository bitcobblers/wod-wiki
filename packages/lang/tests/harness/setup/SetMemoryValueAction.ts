/**
 * SetMemoryValueAction
 * 
 * Test setup action that sets a specific memory value by type and owner.
 * Useful for setting up block state before testing lifecycle operations.
 */

import { IScriptRuntime } from '@bitcobblers/wod-wiki-lang';
import type { MemoryTag } from '@bitcobblers/wod-wiki-lang';
import {
  ITestSetupAction,
  TestSetupActionJSON,
  TestSetupActionFactory,
  TestSetupActionParamSchema
} from '../setup/ITestSetupAction';

export interface SetMemoryValueParams {
  /** Memory type to match (e.g., 'metric:reps', 'effort:state') */
  memoryType: string;
  /** Owner ID to match (block key) */
  ownerId: string;
  /** New value to set */
  value: unknown;
}

/**
 * Action that sets a memory value matching the given type and owner.
 * If multiple refs match, sets all of them.
 */
export class SetMemoryValueAction implements ITestSetupAction {
  readonly type = 'setMemoryValue';
  readonly targetBlockKey?: string;

  constructor(
    private readonly params: SetMemoryValueParams
  ) {
    this.targetBlockKey = params.ownerId;
  }

  get description(): string {
    return `Set ${this.params.memoryType} for "${this.params.ownerId}" to ${JSON.stringify(this.params.value)}`;
  }

  apply(runtime: IScriptRuntime): void {
    const block = runtime.stack.blocks.find(b => b.key.toString() === this.params.ownerId);
    if (!block) {
      console.warn(`SetMemoryValueAction: Block "${this.params.ownerId}" not found in stack.`);
      return;
    }

    const loc = block.getMemoryByTag(this.params.memoryType as unknown as MemoryTag)[0];
    if (loc?.metrics[0]) {
      loc.update([{ ...loc.metrics[0], value: this.params.value }]);
    } else {
      console.warn(
        `SetMemoryValueAction: No memory found for type="${this.params.memoryType}" on block "${this.params.ownerId}"`
      );
    }
  }

  toJSON(): TestSetupActionJSON {
    return {
      type: this.type,
      targetBlockKey: this.targetBlockKey,
      params: {
        memoryType: this.params.memoryType,
        ownerId: this.params.ownerId,
        value: this.params.value
      }
    };
  }
}

/**
 * Factory for creating SetMemoryValueAction from UI/JSON
 */
export const SetMemoryValueActionFactory: TestSetupActionFactory = {
  type: 'setMemoryValue',
  label: 'Set Memory Value',
  description: 'Sets a value in runtime memory by type and owner',
  paramSchema: [
    { name: 'memoryType', type: 'string', label: 'Memory Type', required: true, defaultValue: 'metric:reps' },
    { name: 'ownerId', type: 'blockKey', label: 'Owner Block', required: true },
    { name: 'value', type: 'string', label: 'Value (JSON)', required: true, defaultValue: '0' }
  ] as TestSetupActionParamSchema[],
  create: (params: Record<string, unknown>) => new SetMemoryValueAction({
    memoryType: params.memoryType as string,
    ownerId: params.ownerId as string,
    value: typeof params.value === 'string' ? JSON.parse(params.value as string) : params.value
  })
};
