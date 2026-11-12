import { z } from 'zod';
import {
  WQL_AGGREGATORS,
  WQL_FIND_TARGETS,
  WQL_ROLLUP_PERIODS,
  isAggregateQuery,
  isFindQuery,
  isPipelineQuery,
  normalizeWql,
  parseQuery,
  wqlFilterKeys,
  wqlGroupingDimensions,
} from '@bitcobblers/wod-wiki-wql';
import { createQueryServiceForStorage } from '../helpers';
import { defineAgentTool } from './../types';

const validateWqlInputSchema = z.object({
  query: z.string().describe('WQL query string to validate and inspect (e.g. ":note{notebook:journal} last 7d" or "sum:volume by {effort}").'),
  targetHint: z
    .string()
    .optional()
    .describe('Optional target plane to list valid filter keys & grouping dimensions for (note, session, effort, equipment, tag, feed, block, event).'),
});

export const wodValidateWqlTool = defineAgentTool({
  name: 'wod_validate_wql',
  title: 'Validate & Inspect WQL Query',
  description:
    'Parse a WQL string without executing it. Returns syntax validity, query family (find, aggregate, pipeline), normalized WQL string, and the allowed filter keys and `by {}` grouping dimensions for that plane.',
  tier: 0,
  domain: 'wql',
  annotations: {
    title: 'Validate WQL Query',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: validateWqlInputSchema,
  cliEquivalent: 'wod query "<wql>" --format json',
  async execute(args) {
    const parsed = parseQuery(args.query);
    const valid = !parsed.error;
    const family: 'find' | 'aggregate' | 'pipeline' = isPipelineQuery(parsed)
      ? 'pipeline'
      : isFindQuery(parsed)
        ? 'find'
        : 'aggregate';
    const target =
      args.targetHint ??
      (isFindQuery(parsed) ? parsed.target : isAggregateQuery(parsed) ? 'event' : 'note');
    const capFamily = family === 'find' ? 'find' : 'aggregate';

    return {
      valid,
      ...(parsed.error ? { error: parsed.error } : {}),
      family,
      target,
      normalized: valid ? normalizeWql(args.query) : args.query,
      allowedTargets: [...WQL_FIND_TARGETS],
      allowedAggregators: [...WQL_AGGREGATORS],
      allowedRollupPeriods: [...WQL_ROLLUP_PERIODS],
      validFilterKeys: [...wqlFilterKeys(target, capFamily)],
      validGroupingDimensions: [...wqlGroupingDimensions(target, capFamily)],
    };
  },
});

const queryWqlInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('WQL query expression (e.g. ":note{notebook:journal}", ":session last 30d", "sum:volume by {week}").'),
  preferredUnit: z
    .string()
    .optional()
    .describe('Optional display unit conversion preference (e.g. "lb", "kg", "m", "mi").'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Maximum rows/items to return in the response payload (default 100).'),
});

export const wodQueryWqlTool = defineAgentTool({
  name: 'wod_query_wql',
  title: 'Execute WQL Query',
  description:
    'Run any WQL find (`:note`, `:session`, `:effort`, `:equipment`, `:tag`, `:feed`, `:block`), aggregate (`sum:volume`, `max:weight`, `count:sessions`), or pipeline query against the active WOD Wiki storage.',
  tier: 0,
  domain: 'wql',
  annotations: {
    title: 'Execute WQL Query',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: queryWqlInputSchema,
  cliEquivalent: "wod query '<wql>' --format json",
  async execute(args, ctx) {
    const parsed = parseQuery(args.query);
    if (parsed.error) {
      throw new Error(
        `WQL Syntax Error in "${args.query}": ${parsed.error}. Call wod_validate_wql to inspect valid targets and filter keys.`,
      );
    }
    const service = createQueryServiceForStorage(ctx.storage);
    const limit = args.limit ?? 100;

    if (isPipelineQuery(parsed)) {
      const result = await service.runPipeline(args.query, {
        preferredUnit: args.preferredUnit,
      });
      return {
        kind: 'pipeline-result' as const,
        query: args.query,
        result,
      };
    }

    if (isFindQuery(parsed)) {
      const result = await service.runFind(parsed);
      if (Array.isArray(result.runs)) {
        return {
          kind: 'rows-result' as const,
          target: parsed.target,
          query: args.query,
          totalRuns: result.runs.length,
          totalCount: result.runs.length,
          runs: result.runs.slice(0, limit),
          truncated: result.runs.length > limit,
        };
      }
      if (Array.isArray(result.efforts)) {
        return {
          kind: 'find-result' as const,
          target: parsed.target,
          query: args.query,
          totalCount: result.efforts.length,
          items: result.efforts.slice(0, limit),
          truncated: result.efforts.length > limit,
        };
      }
      if (result.table) {
        return {
          kind: 'find-result' as const,
          target: parsed.target,
          query: args.query,
          columns: result.table.columns,
          totalCount: result.table.rows.length,
          items: result.table.rows.slice(0, limit),
          truncated: result.table.rows.length > limit,
        };
      }
      if (parsed.target === 'block') {
        return {
          kind: 'find-result' as const,
          target: parsed.target,
          query: args.query,
          totalCount: result.blocks.length,
          items: result.blocks.slice(0, limit),
          truncated: result.blocks.length > limit,
        };
      }
      return {
        kind: 'find-result' as const,
        target: parsed.target,
        query: args.query,
        totalCount: result.notes.length,
        items: result.notes.slice(0, limit),
        truncated: result.notes.length > limit,
      };
    }

    const result = await service.runQuery(args.query, {
      preferredUnit: args.preferredUnit,
    });
    return {
      kind: 'query-result' as const,
      query: args.query,
      result,
    };
  },
});

export const WQL_AGENT_TOOLS = [wodQueryWqlTool, wodValidateWqlTool] as const;
