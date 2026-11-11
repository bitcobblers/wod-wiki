import {
  isFindQuery,
  parseQuery,
  type AnyParsedQuery,
  type DocumentOutput,
  type DocumentResult,
  type FamilyRunPayload,
  type NoteContainer,
  type PipelineSink,
  type QueryDocumentRunnerHost,
  type QueryResult,
  type RowsRun,
  type Series,
  type TabularResult,
} from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';

export interface MergedPoint {
  ts: number;
  [label: string]: number | string;
}

/**
 * Canonical widget execution output — combines the numeric `QueryResult`
 * shape with content-plane payloads (`notes`, `blocks`, `efforts`, `runs`,
 * `containers`, `table`, `chart`) so every widget renderer and inline query
 * block consumes a single unified result type.
 */
export type WidgetRunResult = QueryResult & {
  notes?: unknown[];
  blocks?: unknown[];
  efforts?: unknown[];
  runs?: RowsRun[];
  containers?: Record<string, NoteContainer>;
  table?: TabularResult;
  chart?: PipelineSink;
};

export interface ExecutorDocumentHostOptions {
  rangeStart?: number;
  rangeEnd?: number;
  preferredUnit?: string;
  rollupEnsure?: () => Promise<void>;
}

/**
 * Executor → SharedQueryDocumentRunner host adapter.
 * Every UI surface (DashboardView, QueryBlockView, useAnalyticsQueries,
 * WidgetComposerDialog) executes WQL through this single host seam.
 */
export function createExecutorDocumentHost(
  executor: QueryExecutor,
  range: ExecutorDocumentHostOptions = {},
): QueryDocumentRunnerHost {
  return {
    runAggregate: (queryText, overrides) =>
      executor.runQuery(queryText, {
        context: overrides.context,
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        preferredUnit: range.preferredUnit,
      }),
    runFind: async (queryText, context) => {
      const parsed = parseQuery(queryText);
      if (!isFindQuery(parsed)) return { kind: 'find', error: `not a content query: ${queryText}` };
      const res = await executor.runFind(parsed, {
        context,
        range: range.rangeStart !== undefined
          ? { start: range.rangeStart, end: range.rangeEnd ?? Number.MAX_SAFE_INTEGER, endExclusive: false }
          : undefined,
      });
      return {
        kind: 'find',
        notes: res.notes,
        blocks: res.blocks,
        efforts: res.efforts,
        events: res.events,
        containers: res.containers,
        runs: res.runs,
        table: res.table,
      };
    },
    runPipeline: async (queryText, context) => {
      const res = await executor.runPipeline?.(queryText, {
        context,
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        preferredUnit: range.preferredUnit,
      });
      return res ?? { error: 'pipeline queries are not supported by this executor' };
    },
    ...(executor.runPipelineFromFind
      ? {
          runPipelineFromFind: async (sourceFind: FamilyRunPayload, pipeTail: string, context) =>
            executor.runPipelineFromFind!(sourceFind, pipeTail, {
              context,
              rangeStart: range.rangeStart,
              rangeEnd: range.rangeEnd,
              preferredUnit: range.preferredUnit,
            }),
        }
      : {}),
    rollupEnsure: range.rollupEnsure,
  };
}

/**
 * Adapter — pipeline/document outputs ride the QueryResult shape the widget
 * renderers already consume.
 */
export function toChartResult(input: {
  parsed: AnyParsedQuery;
  series?: Series[];
  unit?: string;
  error?: string;
  table?: TabularResult;
}): QueryResult {
  const parsed = input.parsed as QueryResult['parsed'];
  const series = input.series ?? [];
  const scalar = series.length === 1 && series[0].points.length === 1 ? series[0].points[0].value : undefined;
  return {
    parsed,
    series,
    stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
    matched: [],
    ...(scalar !== undefined ? { scalar } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.table ? { table: input.table } : {}),
  };
}

/** Convert a `DocumentOutput` from `SharedQueryDocumentRunner` into `WidgetRunResult`. */
export function outputToRunResult(parsed: AnyParsedQuery, out: DocumentOutput): WidgetRunResult {
  const base = toChartResult({
    parsed,
    series: out.series,
    unit: out.unit,
    error: out.error,
    table: out.table,
  });
  return Object.assign(base, {
    ...(out.notes ? { notes: out.notes } : {}),
    ...(out.blocks ? { blocks: out.blocks } : {}),
    ...(out.efforts ? { efforts: out.efforts } : {}),
    ...(out.containers ? { containers: out.containers } : {}),
    ...(out.runs ? { runs: out.runs } : {}),
    ...(out.chart ? { chart: out.chart } : {}),
  });
}

/**
 * Merge EVERY shown output of a document run into one widget result.
 *
 * A Query Document can show several bindings (`show kb, bb | :stacked-bar{}`).
 * Taking only `outputs[0]` silently dropped every series after the first —
 * the chart rendered a single band for a stacked-bar that declared two.
 * This merges all shown series, keeps the first sink/unit, and surfaces the
 * first error so a failed stage is never swallowed by a healthy sibling.
 */
export function outputsToRunResult(
  parsed: AnyParsedQuery,
  res: DocumentResult,
  attributes?: Record<string, string>,
): WidgetRunResult {
  const outputs = res.outputs;
  const first = outputs[0];
  if (!first) {
    return outputToRunResult(parsed, { name: 'query', kind: 'aggregate', error: res.diagnostics[0] });
  }

  const labelFor = (outName: string) => attributes?.[`label.${outName}`] ?? outName;

  const series = outputs.length === 1
    ? (first.series ?? []).map((s) => {
        const customLabel = attributes?.[`label.${first.name}`];
        return customLabel && (first.series?.length ?? 0) === 1
          ? { ...s, label: customLabel }
          : s;
      })
    : outputs.flatMap((out) => {
        const displayName = labelFor(out.name);
        return (out.series ?? []).map((series) => ({
          ...series,
          key: JSON.stringify([out.name, series.key]),
          label: out.series?.length === 1 ? displayName : `${displayName} · ${series.label}`,
        }));
      });
  const chart = res.showChart ?? outputs.find((o) => o.chart)?.chart;
  const unit = outputs.find((o) => o.unit !== undefined)?.unit ?? first.unit;
  const error = outputs.find((o) => o.error !== undefined)?.error ?? res.diagnostics[0];
  const table = outputs.find((o) => o.table !== undefined)?.table;

  const merged = outputToRunResult(parsed, {
    ...first,
    series,
    ...(unit !== undefined ? { unit } : {}),
    ...(table !== undefined ? { table } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(chart !== undefined ? { chart } : {}),
  });

  // Content-plane payloads: the first output that carries each plane wins,
  // so a `show a, b` document with one content binding still renders rows.
  return Object.assign(merged, {
    ...(outputs.find((o) => o.notes !== undefined)?.notes ? { notes: outputs.find((o) => o.notes !== undefined)!.notes } : {}),
    ...(outputs.find((o) => o.blocks !== undefined)?.blocks ? { blocks: outputs.find((o) => o.blocks !== undefined)!.blocks } : {}),
    ...(outputs.find((o) => o.efforts !== undefined)?.efforts ? { efforts: outputs.find((o) => o.efforts !== undefined)!.efforts } : {}),
    ...(outputs.find((o) => o.containers !== undefined)?.containers ? { containers: outputs.find((o) => o.containers !== undefined)!.containers } : {}),
    ...(outputs.find((o) => o.runs !== undefined)?.runs ? { runs: outputs.find((o) => o.runs !== undefined)!.runs } : {}),
  });
}

export function mergeSeries(series: Series[]): MergedPoint[] {
  const map = new Map<number, MergedPoint>();
  for (const s of series) {
    for (const p of s.points) {
      if (!map.has(p.ts)) map.set(p.ts, { ts: p.ts });
      map.get(p.ts)![s.label] = p.value;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

export function compactNumber(value: number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function tooltipTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
