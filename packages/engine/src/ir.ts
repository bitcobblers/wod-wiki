/**
 * Pure JSON Intermediate Representation (IR) Schemas & Envelope
 *
 * Implements wayfinder #955 and research asset `docs/research/json-ir-schemas-2026-08-17.md`.
 * Freezes the existing result vocabulary (QueryResult, RowsQueryResult, FindQueryResult,
 * StoredOutputStatement, AnalyticsDataPoint, WorkoutResult, StatementNode) in a
 * versioned envelope safe for JSON round-trips.
 */

import type {
  ICodeStatement,
  AnalyticsDataPoint,
  Note,
  BlockRevision,
  BlockIndexRow,
  Session,
  StoredOutputStatement,
  WorkoutResults,
} from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import type { IScript, IEffort } from '@bitcobblers/wod-wiki-lang';
import { getHints } from '@bitcobblers/wod-wiki-lang';

export type IrKind =
  | 'fact-set'
  | 'result-set'
  | 'note-set'
  | 'corpus'
  | 'query-result'
  | 'find-result'
  | 'rows-result'
  | 'pipeline-result'
  | 'parse-tree'
  | 'execution-log';

/**
 * Universal JSON envelope for all headless IR fixtures and output artifacts.
 */
export interface WodWikiIRFile<T> {
  $schema: 'https://wod-wiki.dev/ir/v1.json';
  kind: IrKind;
  generatedAt: number;
  source: string;
  data: T;
}

export function createIRFile<T>(
  kind: IrKind,
  data: T,
  optionsOrSource?: string | { source?: string; generatedAt?: number },
  generatedAt?: number,
): WodWikiIRFile<T> {
  let source = 'wod:headless';
  let genAt = Date.now();
  if (typeof optionsOrSource === 'string') {
    source = optionsOrSource;
    if (generatedAt !== undefined) genAt = generatedAt;
  } else if (optionsOrSource && typeof optionsOrSource === 'object') {
    if (optionsOrSource.source) source = optionsOrSource.source;
    if (optionsOrSource.generatedAt !== undefined) genAt = optionsOrSource.generatedAt;
  }
  return {
    $schema: 'https://wod-wiki.dev/ir/v1.json',
    kind,
    generatedAt: genAt,
    source,
    data,
  };
}

export function isIRFile<T = unknown>(obj: unknown): obj is WodWikiIRFile<T> {
  if (!obj || typeof obj !== 'object') return false;
  const cand = obj as Partial<WodWikiIRFile<T>>;
  return (
    cand.$schema === 'https://wod-wiki.dev/ir/v1.json' &&
    typeof cand.kind === 'string' &&
    typeof cand.generatedAt === 'number' &&
    typeof cand.source === 'string' &&
    'data' in cand
  );
}

// ── Parse Tree IR Models (#955) ─────────────────────────────────────────────

export interface MetricNode {
  type: string;
  image?: string;
  value?: unknown;
  origin?: string;
}

export interface StatementNode {
  id: number;
  type: 'statement' | 'duration' | 'rounds' | 'rest' | 'segment' | 'root';
  raw: string;
  from: number;
  to: number;
  metrics: MetricNode[];
  hints?: string[];
  children?: StatementNode[];
}

export function statementToNode(stmt: ICodeStatement, idMap: Map<number, ICodeStatement>): StatementNode {
  const meta = stmt.meta;
  const metrics: MetricNode[] = stmt.metrics.toArray().map((m) => ({
    type: m.type as string,
    ...(m.image !== undefined ? { image: m.image } : {}),
    ...(m.value !== undefined ? { value: m.value } : {}),
    ...(m.origin !== undefined ? { origin: m.origin } : {}),
  }));

  const raw = meta?.raw ?? '';
  const from = meta?.startOffset ?? 0;
  const to = meta?.endOffset ?? (from + raw.length);

  const durationFrag = stmt.metrics.find((m) => m.type === MetricType.Duration || m.type === 'duration');
  const roundsFrag = stmt.metrics.find((m) => m.type === MetricType.Rounds || m.type === 'rounds');
  const type: StatementNode['type'] = durationFrag ? 'duration' : roundsFrag ? 'rounds' : 'statement';

  const hints = getHints(stmt);

  const childIds = (stmt.children ?? []).flat();
  const children: StatementNode[] = childIds
    .map((cid) => idMap.get(cid))
    .filter((c): c is ICodeStatement => c !== undefined)
    .map((c) => statementToNode(c, idMap));

  return {
    id: stmt.id,
    type,
    raw,
    from,
    to,
    metrics,
    ...(hints.length > 0 ? { hints } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

/** Builds a StatementNode tree from a parsed WhiteboardScript. */
export function buildStatementTree(script: IScript): StatementNode {
  const idMap = new Map(script.statements.map((s) => [s.id, s]));
  const topLevel = script.statements.filter((s) => s.parent === undefined || !idMap.has(s.parent));

  if (topLevel.length === 1 && topLevel[0].children.length > 0) {
    return statementToNode(topLevel[0], idMap);
  }

  return {
    id: 0,
    type: 'root',
    raw: script.source,
    from: 0,
    to: script.source.length,
    metrics: [],
    children: topLevel.map((s) => statementToNode(s, idMap)),
  };
}

// ── Execution Log IR Models (#955) ──────────────────────────────────────────

export interface ExecutionLog {
  results: WorkoutResults;
  logs: StoredOutputStatement[];
  statements?: StoredOutputStatement[];
  blockKey?: string;
  sourceScript?: string;
}

// ── Corpus IR Models (#955) ─────────────────────────────────────────────────

export interface CorpusIRData {
  notes?: Note[];
  revisions?: BlockRevision[];
  blocks?: BlockIndexRow[];
  results?: Session[];
  facts?: AnalyticsDataPoint[];
  efforts?: IEffort[];
  logs?: StoredOutputStatement[];
  tags?: Record<string, string[]>;
}
