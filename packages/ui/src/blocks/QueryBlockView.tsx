import { useEffect, useMemo, useState } from 'react';
import { Edit3 } from 'lucide-react';
import { parseQuery, isFindQuery, isPipelineQuery, substituteTokens, isDashboardWidgetType, unknownTokensMessage, unknownWidgetTypeMessage, type QueryResult, type FindQueryResult, type PipelineResult, type NoteContainer, type RowsQueryResult } from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { RowsTable } from '../widgets/RowsTable';
import { RowsResultsChrome } from './RowsResultsChrome';
import { useChartShape } from '../widgets/useChartShape';
import { QueryValue } from '../widgets/QueryValue';
import { WqlTimeseries } from '../widgets/WqlTimeseries';
import { WqlBars } from '../widgets/WqlBars';
import { WqlEmptyState } from '../widgets/WqlEmptyState';
import { WidgetChart, WidgetProblemBadge } from '../widgets/WidgetChart';
import { toChartResult } from '../widgets/chartData';
import { extractBlockQueries } from '../utils/blockQueryPatcher';
import { WqlQueryInspectorModal } from './WqlQueryInspectorModal';

export interface QueryBlockViewProps {
  /** Raw text between the ```query fences — the WQL query string or block source. */
  query: string;
  /** Injected QueryExecutor for executing WQL queries (zero singleton coupling). */
  executor?: QueryExecutor;
  /** Optional callback or subscription hook for when a result is saved, replacing hardcoded resultRecorder coupling. */
  onResultSaved?: (callback: () => void) => (() => void) | void;
  /** Present when the query block is editable — opens the WQL composer.
   *  May return the write's Promise so a rejected save keeps the editor
   *  open; a plain void write is fire-and-forget. */
  onSaveQuery?: (nextQuery: string) => void | Promise<void>;
  /** When multiple queries appear in one block, the index of this query. */
  queryIndex?: number;
  /** When true, editing the query is disallowed. */
  readOnly?: boolean;
  /** Fence-suffix widget type override (e.g. `query:chart`, `query:value`). */
  widgetType?: string;
  /** Frontmatter/syntax parse error for the enclosing widget block. */
  widgetError?: string;
  /** Token values from the note's frontmatter, for `$token` substitution. */
  tokenValues?: Record<string, string>;
  /** Fence-tag presentation attributes (decision 22). */
  attributes?: Record<string, string>;
  /** Optional RPE capture handler. */
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void>;
  /** Optional click handler for opening a note from :note results. */
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  /** Optional resolver returning the destination href for an item in :note results. */
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}

export function QueryBlockView({
  query,
  executor,
  onResultSaved,
  onSaveQuery,
  queryIndex: _queryIndex = 0,
  readOnly = false,
  widgetType,
  widgetError,
  tokenValues,
  attributes,
  onCaptureRpe,
  onOpenNote,
  noteHref,
}: QueryBlockViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const extracted = useMemo(() => extractBlockQueries(query), [query]);
  // Decision 22: the body IS the Query Document — no positional split.
  // Presentation config rides fence-tag attributes.
  const { query: effectiveQuery, missing } = useMemo(() => {
    const raw = extracted.length > 0 ? extracted[0].query : query;
    const subQuery = substituteTokens(raw, tokenValues ?? {});
    // Fence-tag attributes (`goal=$token`) resolve against the same values;
    // a missing token blocks the widget rather than rendering a NaN target.
    const missingSet = new Set(subQuery.missing);
    for (const value of Object.values(attributes ?? {})) {
      for (const m of substituteTokens(value, tokenValues ?? {}).missing) missingSet.add(m);
    }
    return { query: subQuery.query, missing: [...missingSet] };
  }, [extracted, query, tokenValues, attributes]);

  const resolvedAttributes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      out[key] = substituteTokens(value, tokenValues ?? {}).query;
    }
    return out;
  }, [attributes, tokenValues]);

  const parsed = useMemo(() => parseQuery(effectiveQuery), [effectiveQuery]);
  const unknownType =
    widgetType != null && widgetType !== '' && !isDashboardWidgetType(widgetType);
  const [result, setResult] = useState<QueryResult | undefined>(undefined);
  const [findResult, setFindResult] = useState<FindQueryResult | undefined>(undefined);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | undefined>(undefined);
  const [runError, setRunError] = useState<string | undefined>(undefined);
  const [rowsRefreshKey, setRowsRefreshKey] = useState(0);

  useEffect(() => {
    if (onResultSaved) {
      const unsub = onResultSaved(() => {
        setRowsRefreshKey((k) => k + 1);
      });
      return () => {
        if (typeof unsub === 'function') unsub();
      };
    }
  }, [onResultSaved]);

  useEffect(() => {
    let cancelled = false;
    setRunError(undefined);
    setResult(undefined);
    setFindResult(undefined);
    setPipelineResult(undefined);

    if (parsed.error) return;
    if (widgetError || unknownType || missing.length > 0) return;
    if (!executor) return;

    if (isFindQuery(parsed)) {
      let retryTimer: number | NodeJS.Timeout | undefined;
      const isSession = parsed.target === 'session';
      const executeFind = (attemptCount: number) => {
        void executor
          .runFind(parsed)
          .then((res) => {
            if (cancelled) return;
            setFindResult(res);
            if (isSession && (res.runs ?? []).length === 0 && attemptCount < 4) {
              const delays = [50, 150, 350, 750];
              retryTimer = setTimeout(() => {
                if (!cancelled) executeFind(attemptCount + 1);
              }, delays[attemptCount] ?? 500);
            }
          })
          .catch((err) => {
            if (!cancelled) setRunError(err instanceof Error ? err.message : String(err));
          });
      };
      executeFind(0);
      return () => {
        cancelled = true;
        clearTimeout(retryTimer);
      };
    }

    if (isPipelineQuery(parsed)) {
      if (!executor.runPipeline) {
        setRunError('pipeline queries are not supported by this executor');
        return;
      }
      void executor
        .runPipeline(effectiveQuery)
        .then((res) => {
          if (!cancelled) setPipelineResult(res);
        })
        .catch((err) => {
          if (!cancelled) setRunError(err instanceof Error ? err.message : String(err));
        });
      return () => {
        cancelled = true;
      };
    }

    void executor
      .runQuery(effectiveQuery)
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setRunError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveQuery, parsed, widgetError, unknownType, missing, executor, rowsRefreshKey]);

  const canEdit = onSaveQuery !== undefined && !readOnly;
  const onEdit = canEdit ? () => setIsModalOpen(true) : undefined;

  const resultId = useMemo(() => {
    if (!isFindQuery(parsed) || parsed.target !== 'session') return undefined;
    const resultFilter = parsed.filters.find((f) => f.key === 'result');
    return resultFilter?.values[0]?.value;
  }, [parsed]);

  return (
    <div data-testid="query-block-view">
      {widgetError ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            {widgetError}
          </div>
        </QueryBlockShell>
      ) : unknownType ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <WidgetProblemBadge message={unknownWidgetTypeMessage(widgetType)} />
        </QueryBlockShell>
      ) : missing.length > 0 ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <WidgetProblemBadge message={unknownTokensMessage(missing)} />
        </QueryBlockShell>
      ) : parsed.error ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            Query syntax error: {parsed.error}
          </div>
        </QueryBlockShell>
      ) : runError ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            Query execution error: {runError}
          </div>
        </QueryBlockShell>
      ) : isFindQuery(parsed) ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          {(findResult as any)?.table ? (
            <WidgetChart type="table" result={findResult as any} />
          ) : resultId && findResult?.runs && findResult.runs.length > 0 ? (
            <RowsResultsChrome
              resultId={resultId}
              sessionResult={findResult as any}
              executor={executor}
              onCaptureRpe={onCaptureRpe}
              onCaptured={() => setRowsRefreshKey((k) => k + 1)}
            />
          ) : findResult?.runs ? (
            <RowsTable result={findResult as any} />
          ) : findResult ? (
            <FindResultList
              target={parsed.target}
              notes={findResult.notes}
              blocks={findResult.blocks}
              containers={findResult.containers}
              onOpenNote={onOpenNote}
              noteHref={noteHref}
            />
          ) : (
            <div className="text-xs text-muted-foreground py-2">Loading rows…</div>
          )}
        </QueryBlockShell>
      ) : isPipelineQuery(parsed) ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <PipelineResultView
            result={pipelineResult}
            onOpenNote={onOpenNote}
            noteHref={noteHref}
            widgetType={widgetType}
            attributes={resolvedAttributes}
            fallbackLabel={parsed.raw}
          />
        </QueryBlockShell>
      ) : (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly}>
          <AnalyticsChart
            result={result}
            metric={parsed.metric}
            widgetType={widgetType}
            attributes={resolvedAttributes}
          />
        </QueryBlockShell>
      )}
      {canEdit && (
        <WqlQueryInspectorModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          initialQuery={effectiveQuery}
          executor={executor}
          onApply={(nextQuery) => onSaveQuery(nextQuery)}
        />
      )}
    </div>
  );
}

function AnalyticsChart({
  result,
  metric,
  widgetType,
  attributes,
}: {
  result: QueryResult | undefined;
  metric: string;
  widgetType?: string;
  attributes?: Record<string, string>;
}) {
  const shape = useChartShape(result);

  if (widgetType != null && widgetType !== '') {
    return <WidgetChart type={widgetType} result={result} label={metric} attributes={attributes} />;
  }

  if (shape.kind === 'scalar') {
    return <QueryValue result={result!} label={metric} />;
  }
  if (shape.kind === 'timeseries') {
    return <WqlTimeseries result={result!} />;
  }
  if (shape.kind === 'bars') {
    return <WqlBars result={result!} />;
  }
  return <WqlEmptyState result={result} />;
}

/**
 * Canonical page link for a matched note — the parent Page wins over the
 * standalone note (slug pages → /page/:slug, journal date pages →
 * /day/:date); undefined lets the caller's resolver answer.
 */
function containerPageHref(container: NoteContainer | undefined): string | undefined {
  if (!container || container.kind !== 'page') return undefined;
  const { slug, date } = container as { slug?: string; date?: string };
  if (slug) return `/page/${encodeURIComponent(slug)}`;
  if (date) return `/day/${encodeURIComponent(date)}`;
  return undefined;
}

function FindResultList({
  target,
  notes,
  blocks,
  containers,
  onOpenNote,
  noteHref,
}: {
  target: string;
  notes: FindQueryResult['notes'];
  blocks: FindQueryResult['blocks'];
  containers?: FindQueryResult['containers'];
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}) {
  const isBlock = target === 'block';
  const items = isBlock ? blocks : notes;

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        No {target}s matched this query.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">
        {items.length} {target}{items.length === 1 ? '' : 's'} matched
      </div>
      <ul className="space-y-0.5 max-h-48 overflow-y-auto font-mono text-xs">
        {items.map((item) => {
          const typedItem = item as unknown as { id: string; title?: string; blockContentId?: string };
          const title = isBlock
            ? typedItem.title || typedItem.blockContentId || item.id
            : typedItem.title || item.id;
          const href = containers
            ? containerPageHref(containers[item.id]) ?? (noteHref ? noteHref(typedItem) : undefined)
            : noteHref
              ? noteHref(typedItem)
              : undefined;
          return (
            <li key={item.id} className="rounded hover:bg-muted/50 truncate">
              {href ? (
                <a
                  href={href}
                  onClick={(e) => {
                    if (onOpenNote) {
                      e.preventDefault();
                      onOpenNote(typedItem);
                    }
                  }}
                  className="block py-0.5 px-1.5 text-primary hover:underline truncate"
                >
                  {title}
                </a>
              ) : onOpenNote ? (
                <button
                  type="button"
                  onClick={() => onOpenNote(typedItem)}
                  className="w-full text-left py-0.5 px-1.5 text-primary hover:underline truncate"
                >
                  {title}
                </button>
              ) : (
                <span className="block py-0.5 px-1.5 text-foreground truncate">{title}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Pipeline result rendering (`:source | :fn | :chart`, `@dataset | …`).
 * The terminal chart sink picks the real renderer (all six heads map onto
 * production widgets); a source-only pipeline passes its content plane
 * through; a sink-less numeric result falls back to the automatic chart
 * shape.
 */
function PipelineResultView({
  result,
  onOpenNote,
  noteHref,
  widgetType,
  attributes,
  fallbackLabel,
}: {
  result: PipelineResult | undefined;
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
  widgetType?: string;
  attributes?: Record<string, string>;
  fallbackLabel: string;
}) {
  if (!result) {
    return <div className="text-xs text-muted-foreground py-2">Loading…</div>;
  }
  if (result.error) {
    return (
      <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
        Query execution error: {result.error}
      </div>
    );
  }

  const listTarget =
    result.parsed.source.kind === 'query' && result.parsed.source.query.family === 'find'
      ? result.parsed.source.query.target
      : 'note';
  if ((result.notes?.length ?? 0) + (result.blocks?.length ?? 0) > 0) {
    return (
      <FindResultList
        target={listTarget}
        notes={result.notes ?? []}
        blocks={result.blocks ?? []}
        containers={result.containers}
        onOpenNote={onOpenNote}
        noteHref={noteHref}
      />
    );
  }

  if (result.runs && result.runs.length > 0) {
    // Session-run pipelines surface the rows grid (RowsQueryResult shape).
    const rowsResult = { parsed: result.parsed, runs: result.runs, table: result.table } as unknown as RowsQueryResult;
    return <RowsTable result={rowsResult} />;
  }

  const chartHead = widgetType != null && widgetType !== '' ? widgetType : result.chart?.head;
  if (chartHead) {
    const sinkAttributes = Object.fromEntries(
      (result.chart?.filters ?? []).map((f) => [f.key, f.values.map((v) => v.value).join(',')]),
    );
    // Bounded height: h-full resolves to 0 against an auto-height shell and
    // leaves ResponsiveContainer charts with no size to measure.
    return (
      <div className="w-full h-[220px] min-h-[160px]">
        <WidgetChart
          type={chartHead}
          result={toChartResult(result)}
          label={fallbackLabel}
          attributes={{ ...sinkAttributes, ...attributes }}
        />
      </div>
    );
  }

  if (result.series && result.series.length > 0) {
    return (
      <div className="w-full h-[220px] min-h-[160px]">
        <AnalyticsChart result={toChartResult(result)} metric={fallbackLabel} />
      </div>
    );
  }

  return <WqlEmptyState result={toChartResult(result)} />;
}

function QueryBlockShell({
  children,
  onEdit,
  readOnly,
}: {
  children: React.ReactNode;
  onEdit?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div className="relative group/block my-2 p-3 rounded-lg border border-border/80 bg-card/60 shadow-sm">
      {onEdit && !readOnly && (
        <button
          type="button"
          onClick={onEdit}
          title="Edit query in Omni-Composer"
          className="absolute top-2 right-2 p-1 rounded bg-muted/80 text-muted-foreground hover:text-foreground opacity-0 group-hover/block:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity z-10"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}
