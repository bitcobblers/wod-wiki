import type { QueryResult, FindQueryResult, RowsQueryResult, RowsRun, ParsedAggregateQuery, ParsedFindQuery, ParsedRowsQuery, ParsedPipelineQuery, PipelineResult, QueryOptions, FindOptions, FamilyRunPayload } from '@bitcobblers/wod-wiki-wql';

export interface QueryExecutor {
  runQuery(query: string, options?: QueryOptions): Promise<QueryResult>;
  runFind(parsed: ParsedFindQuery, options?: FindOptions): Promise<FindQueryResult>;
  runRows(parsed: ParsedRowsQuery, options?: { anchorNow?: number }): Promise<RowsQueryResult>;
  run?(parsed: ParsedAggregateQuery, options?: QueryOptions): Promise<QueryResult>;
  /** Pipeline queries (`:source | :fn | :chart`, `@dataset | …`) — the
   *  QueryService.runPipeline seam; the sink rides `PipelineResult.chart`. */
  runPipeline?(query: string, options?: QueryOptions): Promise<PipelineResult>;
  /** Evaluate a named list pipe's tail stages over an ALREADY-RESOLVED
   *  source list — the shared source DAG (`kb = bench | :sum{…}` reuses the
   *  `bench` events instead of re-fetching them). */
  runPipelineFromFind?(sourceFind: FamilyRunPayload, pipeTail: string, options?: QueryOptions): Promise<PipelineResult>;
}

export type {
  QueryResult,
  FindQueryResult,
  RowsQueryResult,
  RowsRun,
  QueryOptions,
  FindOptions,
  ParsedAggregateQuery,
  ParsedFindQuery,
  ParsedRowsQuery,
  ParsedPipelineQuery,
  PipelineResult,
};
