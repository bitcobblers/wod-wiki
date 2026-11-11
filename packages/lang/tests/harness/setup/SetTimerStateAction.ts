/**
 * SetTimerStateAction
 * 
 * Test setup action that sets timer state (elapsed, remaining, paused).
 * Useful for testing timer-dependent logic at specific time points.
 */

import { IScriptRuntime } from '@bitcobblers/wod-wiki-lang';
import type { MemoryTag } from '@bitcobblers/wod-wiki-lang';
import {
  ITestSetupAction,
  TestSetupActionJSON,
  TestSetupActionFactory,
  TestSetupActionParamSchema
} from '../setup/ITestSetupAction';

export interface SetTimerStateParams {
  /** Block key of the timer block */
  blockKey: string;
  /** Elapsed time in milliseconds */
  elapsedMs?: number;
  /** Remaining time in milliseconds (alternative to elapsed) */
  remainingMs?: number;
  /** Total duration in milliseconds (for calculating remaining) */
  totalMs?: number;
  /** Whether timer is paused */
  isPaused?: boolean;
  /** Whether timer has started */
  isStarted?: boolean;
}

/**
 * Action that sets timer state for a timer block.
 * Looks for 'timer:state' memory type.
 */
export class SetTimerStateAction implements ITestSetupAction {
  readonly type = 'setTimerState';
  readonly targetBlockKey: string;

  constructor(
    private readonly params: SetTimerStateParams
  ) {
    this.targetBlockKey = params.blockKey;
  }

  get description(): string {
    const parts: string[] = [];
    if (this.params.elapsedMs !== undefined) {
      parts.push(`elapsed=${this.params.elapsedMs}ms`);
    }
    if (this.params.remainingMs !== undefined) {
      parts.push(`remaining=${this.params.remainingMs}ms`);
    }
    if (this.params.isPaused !== undefined) {
      parts.push(`paused=${this.params.isPaused}`);
    }
    return `Set timer state for "${this.params.blockKey}": ${parts.join(', ')}`;
  }

  apply(runtime: IScriptRuntime): void {
    const block = runtime.stack.blocks.find(b => b.key.toString() === this.params.blockKey);
    if (!block) {
      console.warn(`SetTimerStateAction: Block "${this.params.blockKey}" not found in stack.`);
      return;
    }

    // Try 'time:state' then 'time'
    const timeLoc = block.getMemoryByTag('time:state' as unknown as MemoryTag)[0] ?? block.getMemoryByTag('time')[0];

    if (timeLoc?.metrics[0]) {
      const currentValue = timeLoc.metrics[0].value;
      const newValue: Record<string, unknown> =
        typeof currentValue === 'object' && currentValue !== null
          ? { ...currentValue }
          : {};

      if (this.params.elapsedMs !== undefined) {
        newValue.elapsedMs = this.params.elapsedMs;
        newValue.elapsed = this.params.elapsedMs;
      }
      if (this.params.remainingMs !== undefined) {
        newValue.remainingMs = this.params.remainingMs;
        newValue.remaining = this.params.remainingMs;
      }
      if (this.params.totalMs !== undefined) {
        newValue.totalMs = this.params.totalMs;
        newValue.total = this.params.totalMs;
      }
      if (this.params.isPaused !== undefined) {
        newValue.isPaused = this.params.isPaused;
        newValue.paused = this.params.isPaused;
      }
      if (this.params.isStarted !== undefined) {
        newValue.isStarted = this.params.isStarted;
        newValue.started = this.params.isStarted;
      }

      timeLoc.update([{ ...timeLoc.metrics[0], value: newValue }]);
      return; // Found and set, done
    }

    console.warn(
      `SetTimerStateAction: No timer state found for block "${this.params.blockKey}"`
    );
  }

  toJSON(): TestSetupActionJSON {
    return {
      type: this.type,
      targetBlockKey: this.targetBlockKey,
      params: {
        blockKey: this.params.blockKey,
        elapsedMs: this.params.elapsedMs,
        remainingMs: this.params.remainingMs,
        totalMs: this.params.totalMs,
        isPaused: this.params.isPaused,
        isStarted: this.params.isStarted
      }
    };
  }
}

/**
 * Factory for creating SetTimerStateAction from UI/JSON
 */
export const SetTimerStateActionFactory: TestSetupActionFactory = {
  type: 'setTimerState',
  label: 'Set Timer State',
  description: 'Sets elapsed/remaining time and pause state for a timer block',
  paramSchema: [
    { name: 'blockKey', type: 'blockKey', label: 'Target Block', required: true },
    { name: 'elapsedMs', type: 'number', label: 'Elapsed (ms)', required: false },
    { name: 'remainingMs', type: 'number', label: 'Remaining (ms)', required: false },
    { name: 'totalMs', type: 'number', label: 'Total Duration (ms)', required: false },
    { name: 'isPaused', type: 'boolean', label: 'Is Paused', required: false, defaultValue: false }
  ] as TestSetupActionParamSchema[],
  create: (params: Record<string, unknown>) => new SetTimerStateAction({
    blockKey: params.blockKey as string,
    elapsedMs: params.elapsedMs as number | undefined,
    remainingMs: params.remainingMs as number | undefined,
    totalMs: params.totalMs as number | undefined,
    isPaused: params.isPaused as boolean | undefined,
    isStarted: params.isStarted as boolean | undefined
  })
};
