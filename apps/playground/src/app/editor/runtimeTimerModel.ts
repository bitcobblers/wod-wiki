import {
  createParser,
  extractPropertyRulesFromMeta,
  type PropertyRuleInput,
  type RuntimeStackOptions,
} from '@bitcobblers/wod-wiki-engine';
import { runtimeFactory } from '@/hooks/useRuntimeFactory';
import { getTagIndex } from '@/services/tags/tagCatalogue';
import { parseFrontmatter } from '@bitcobblers/wod-wiki-wql';
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

export function createRuntimeForBlock(block: ScriptBlock, noteContent?: string): IScriptRuntime | null {
  const tags = getTagIndex();
  const propertySources: PropertyRuleInput[] = [];
  const activeTags: string[] = [];

  if (noteContent && noteContent.trimStart().startsWith('---')) {
    const { meta } = parseFrontmatter(noteContent);
    const noteSource = extractPropertyRulesFromMeta(meta, 'note', 'note-frontmatter');
    if (Object.keys(noteSource.metrics ?? {}).length > 0 || Object.keys(noteSource.summaries ?? {}).length > 0) {
      propertySources.push(noteSource);
    }
    const knownTagKeys = new Set(['tags', 'category', 'domain', 'format', 'quality', 'intent', 'discipline', 'intensity', 'sound']);
    for (const [key, rawValue] of Object.entries(meta)) {
      if (!knownTagKeys.has(key.trim().toLowerCase())) continue;
      const values = Array.isArray(rawValue) ? rawValue : [String(rawValue)];
      for (const value of values) {
        const slug = String(value).trim();
        if (slug && tags.resolve(slug) && !activeTags.includes(slug)) activeTags.push(slug);
      }
    }
  }

  const options: RuntimeStackOptions = {
    analyticsOptions: {
      tags,
      activeTags,
      propertySources,
    },
  };
  return factory.createRuntime(prepareRuntimeBlock(block), options) ?? null;
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
