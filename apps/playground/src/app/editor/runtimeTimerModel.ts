import { createParser } from '@bitcobblers/wod-wiki-engine';
import { runtimeFactory } from '@/hooks/useRuntimeFactory';
import { getTagIndex } from '@/services/tags/tagCatalogue';
import type { IScriptRuntime } from '@/hooks/useRuntimeTimer';
import type { IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import { toStoredOutputStatement } from '@/components/Editor/types';
import type { INowProvider } from '@bitcobblers/wod-wiki-engine';

const factory = runtimeFactory;

export function prepareRuntimeBlock(block: ScriptBlock): ScriptBlock & { statements: NonNullable<ScriptBlock['statements']> } {
  if (block.statements?.length) {
    return block as ScriptBlock & { statements: NonNullable<ScriptBlock['statements']> };
  }
  // The tag index lets a line reference a tag with `#tag-slug`.
  const parser = createParser({ tags: getTagIndex() });
  return { ...block, statements: parser.read(block.content, block.sport).statements };
}

export function createRuntimeForBlock(block: ScriptBlock): IScriptRuntime | null {
  return factory.createRuntime(prepareRuntimeBlock(block)) ?? null;
}

export function buildSessions(
  outputs: readonly IOutputStatement[],
  options: {
    readonly startTime?: number;
    readonly elapsedTime: number;
    readonly completed: boolean;
    readonly now: INowProvider;
  },
): Sessions {
  return {
    startTime: options.startTime ?? options.now.nowMs(),
    endTime: options.now.nowMs(),
    duration: options.elapsedTime,
    completed: options.completed,
    logs: outputs.map(toStoredOutputStatement),
  };
}

export function countSegmentOutputs(outputs: readonly IOutputStatement[]): number {
  return outputs.filter((output) => output.outputType === 'segment').length;
}
