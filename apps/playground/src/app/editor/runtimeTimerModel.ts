import {
  createParser,
  extractPropertyRulesFromMeta,
  extractTagPropertyRules,
  resolvePropertyDashboardWidgets,
  resolveEntityScope,
  type PropertyRuleInput,
  type StackedDashboardWidgetDescriptor,
  type RuntimeStackOptions,
  type IOutputStatement,
  type INowProvider,
} from '@bitcobblers/wod-wiki-engine';
import { parseFrontmatter } from '@bitcobblers/wod-wiki-wql';
import { runtimeFactory } from '@/hooks/useRuntimeFactory';
import { getTagIndex } from '@/services/tags/tagCatalogue';
import type { IScriptRuntime } from '@/hooks/useRuntimeTimer';
import { extractTypedFrontmatterTags } from '@/lib/frontmatter';
import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import { toStoredOutputStatement } from '@/components/Editor/types';

const factory = runtimeFactory;

export function prepareRuntimeBlock(block: ScriptBlock): ScriptBlock & { statements: NonNullable<ScriptBlock['statements']> } {
  // Parse at Run time, not only at editor render time. The tag catalogue can
  // finish loading after the block was first parsed; reusing those statements
  // would leave inline #tag references as inert custom annotations forever.
  const parser = createParser({ tags: getTagIndex() });
  return { ...block, statements: parser.read(block.content, block.sport).statements };
}

/**
 * The note frontmatter's `metrics.*` / `summaries.*` rules as Property Rule
 * inputs for the analytics engine — empty when the note declares none.
 * Shared by the Run panel runtime and the workbench lifecycle so both run
 * surfaces feed the same rules to the Metric Shake-Out Queue.
 */
export function notePropertySourcesFromContent(noteContent?: string): PropertyRuleInput[] {
  if (!noteContent || !noteContent.trimStart().startsWith('---')) return [];
  const { meta } = parseFrontmatter(noteContent);
  const noteSource = extractPropertyRulesFromMeta(meta, 'note', 'note-frontmatter');
  if (
    Object.keys(noteSource.metrics ?? {}).length > 0 ||
    Object.keys(noteSource.summaries ?? {}).length > 0 ||
    Object.keys(noteSource.widgets ?? {}).length > 0
  ) {
    return [noteSource];
  }
  return [];
}

const KNOWN_FRONTMATTER_TAG_KEYS = [
  'tags',
  'category',
  'domain',
  'format',
  'equipment',
  'quality',
  'intent',
  'discipline',
  'intensity',
  'sound',
] as const;

export interface ResolvedNotePropertyStack {
  readonly activeTags: string[];
  readonly propertySources: PropertyRuleInput[];
  readonly dashboardWidgets: StackedDashboardWidgetDescriptor[];
}

/**
 * Resolve the complete Property Note stack (`note > tag > effort > equipment > category`)
 * for a Note's raw content, returning active tag slugs, `PropertyRuleInput[]` for
 * the Metric Shake-Out Queue, and bound `StackedDashboardWidgetDescriptor[]`
 * contributed by stacked Tags and Summary Metrics.
 */
export function resolveNotePropertyStack(
  noteContent?: string,
  options: { noteId?: string; scopeFilter?: string } = {},
): ResolvedNotePropertyStack {
  const tags = getTagIndex();
  const propertySources: PropertyRuleInput[] = [];
  const activeTags: string[] = [];
  if (noteContent && noteContent.trimStart().startsWith('---')) {
    propertySources.push(...notePropertySourcesFromContent(noteContent));
    const authoredTags = extractTypedFrontmatterTags(noteContent, [...KNOWN_FRONTMATTER_TAG_KEYS]);
    for (const authoredTag of authoredTags) {
      const slug = authoredTag.label.trim();
      if (slug && tags.resolve(slug) && !activeTags.includes(slug)) activeTags.push(slug);
    }
  }
  const tagRules = extractTagPropertyRules(tags, activeTags);
  const allSources = [...propertySources, ...tagRules];
  const scopeFilter = options.scopeFilter
    ?? (options.noteId ? resolveEntityScope({ noteId: options.noteId, rawContent: noteContent }).scopeFilter : undefined);
  const dashboardWidgets = resolvePropertyDashboardWidgets(allSources, { scopeFilter });
  return {
    activeTags,
    propertySources,
    dashboardWidgets,
  };
}

export function createRuntimeForBlock(block: ScriptBlock, noteContent?: string): IScriptRuntime | null {
  const tags = getTagIndex();
  const { activeTags, propertySources } = resolveNotePropertyStack(noteContent);
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
