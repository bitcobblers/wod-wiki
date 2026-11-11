/**
 * AllocateTestMemoryAction
 * 
 * Test setup action that allocates memory entries for testing purposes.
 * Useful for simulating parent block memory that children should inherit.
 */

import { IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import {
  ITestSetupAction,
  TestSetupActionJSON,
  TestSetupActionFactory,
  TestSetupActionParamSchema
} from './ITestSetupAction';
import { appWarn } from '@/lib/log';

export interface AllocateTestMemoryParams {
  /** Memory type to allocate */
  type: string;
  /** Owner ID (block key) */
  ownerId: string;
  /** Initial value */
  value: unknown;
  /** Visibility ('public' for inheritance, 'private' for block-only) */
  visibility: 'public' | 'private';
}

/**
 * Action that allocates a new memory entry during test setup.
 * Use this to simulate parent context that child blocks would inherit.
 */
export class AllocateTestMemoryAction implements ITestSetupAction {
  readonly type = 'allocateTestMemory';
  readonly targetBlockKey?: string;

  constructor(
    private readonly params: AllocateTestMemoryParams
  ) {
    this.targetBlockKey = params.ownerId;
  }

  get description(): string {
    return `Allocate ${this.params.visibility} ${this.params.type} for "${this.params.ownerId}" = ${JSON.stringify(this.params.value)}`;
  }

  apply(runtime: IScriptRuntime): void {
    const block = runtime.stack.blocks.find(b => b.key.toString() === this.params.ownerId);
    if (block) {
      block.context.allocate(
        this.params.type,
        this.params.value,
        this.params.visibility
      );
    } else {
      appWarn('AllocateTestMemoryAction', `Block "${this.params.ownerId}" not found in stack.`);
    }
  }

  toJSON(): TestSetupActionJSON {
    return {
      type: this.type,
      targetBlockKey: this.targetBlockKey,
      params: {
        type: this.params.type,
        ownerId: this.params.ownerId,
        value: this.params.value,
        visibility: this.params.visibility
      }
    };
  }
}

/**
 * Factory for creating AllocateTestMemoryAction from UI/JSON
 */
export const AllocateTestMemoryActionFactory: TestSetupActionFactory = {
  type: 'allocateTestMemory',
  label: 'Allocate Test Memory',
  description: 'Allocates a new memory entry to simulate parent context',
  paramSchema: [
    { name: 'type', type: 'string', label: 'Memory Type', required: true, defaultValue: 'metric:reps' },
    { name: 'ownerId', type: 'string', label: 'Owner ID', required: true, defaultValue: 'test-parent' },
    {
      name: 'visibility',
      type: 'select',
      label: 'Visibility',
      required: true,
      defaultValue: 'public',
      options: [
        { value: 'public', label: 'Public (inheritable)' },
        { value: 'private', label: 'Private (block-only)' }
      ]
    },
    { name: 'value', type: 'string', label: 'Value (JSON)', required: true, defaultValue: '0' }
  ] as TestSetupActionParamSchema[],
  create: (params: Record<string, unknown>) => new AllocateTestMemoryAction({
    type: params.type as string,
    ownerId: params.ownerId as string,
    visibility: params.visibility as 'public' | 'private',
    value: typeof params.value === 'string' ? JSON.parse(params.value as string) : params.value
  })
};
