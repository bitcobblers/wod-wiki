import { type ParsedFindQuery, type ParsedAggregateQuery, type ParsedPipelineQuery, type PipelineSource } from '@bitcobblers/wod-wiki-wql';
import type { AnyParsedQuery } from './useWqlStageCounts';
export interface WqlDiagnostics {
  valid: boolean;
  /** Exact resolved draft text, including invalid input. */
  wql: string;
  ast: AnyParsedQuery;
  error?: string;
  offendingClauseId?: string;
}

export interface WqlFindSummary {
  target: string;
  scope: string;
  timeWindow?: string;
  groupBy?: string;
  hasJoin: boolean;
  filterCount: number;
}

export function summarizeFind(ast: ParsedFindQuery): WqlFindSummary {
  const sourceFilter = ast.filters.find((f) => f.key === 'source');
  const scope = sourceFilter ? sourceFilter.values.map((v) => v.value).join(',') : 'all';
  return {
    target: ast.target,
    scope,
    timeWindow: ast.window
      ? ast.window.kind === 'relative'
        ? `last ${ast.window.size}${ast.window.unit}`
        : ast.window.kind === 'param'
          ? `last $${ast.window.param}${ast.window.unit ? ` ${ast.window.unit}` : ''}`
          : `from ${ast.window.start}${ast.window.end ? ` to ${ast.window.end}` : ''}`
      : undefined,
    groupBy: ast.groupBy?.length ? ast.groupBy.join(', ') : undefined,
    hasJoin: Boolean(ast.join),
    filterCount: ast.filters.length,
  };
}

export interface WqlAggregateSummary {
  agg: string;
  metric: string;
  groupBy?: string;
  rollup?: string;
  unit?: string;
  timeWindow?: string;
  hasJoin: boolean;
  filterCount: number;
}

export function summarizeAggregate(ast: ParsedAggregateQuery): WqlAggregateSummary {
  return {
    agg: ast.agg,
    metric: ast.metric,
    groupBy: ast.groupBy.length > 0 ? ast.groupBy.join(', ') : undefined,
    rollup: ast.rollup ? `${ast.rollup.size}${ast.rollup.unit}` : undefined,
    unit: ast.displayUnit,
    hasJoin: Boolean(ast.join),
    filterCount: ast.filters.length,
  };
}

export interface WqlPipelineSummary {
  source: string;
  /** One entry per transform stage, in order — `sum:tis`, `avg:load`, … */
  functions: string[];
  sink?: string;
  timeWindow?: string;
  filterCount: number;
}

function pipelineSourceLabel(source: PipelineSource): string {
  if (source.kind === 'dataset') return source.name;
  return 'target' in source.query ? `:${source.query.target}` : `:${source.query.agg}`;
}

export function summarizePipeline(ast: ParsedPipelineQuery): WqlPipelineSummary {
  const sourceQuery = ast.source.kind === 'query' ? ast.source.query : undefined;
  return {
    source: pipelineSourceLabel(ast.source),
    functions: ast.transforms.map((stage) => `${stage.agg}:${stage.metric}`),
    sink: ast.sink ? `:${ast.sink.head}` : undefined,
    timeWindow: sourceQuery?.window
      ? sourceQuery.window.kind === 'relative'
        ? `last ${sourceQuery.window.size}${sourceQuery.window.unit}`
        : sourceQuery.window.kind === 'param'
          ? `last $${sourceQuery.window.param}${sourceQuery.window.unit ? ` ${sourceQuery.window.unit}` : ''}`
          : `from ${sourceQuery.window.start}${sourceQuery.window.end ? ` to ${sourceQuery.window.end}` : ''}`
      : undefined,
    filterCount: sourceQuery ? sourceQuery.filters.length : 0,
  };
}

