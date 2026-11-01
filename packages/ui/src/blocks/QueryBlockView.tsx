import { useEffect, useMemo, useState } from 'react';
import { ChartBar, Edit3 } from 'lucide-react';
import {
  parseQuery,
  parseDocument,
  isFindQuery,
  isPipelineQuery,
  substituteTokens,
  isDashboardWidgetType,
  unknownTokensMessage,
  unknownWidgetTypeMessage,
  SharedQueryDocumentRunner,
  type AnyParsedQuery,
  type RowsQueryResult,
} from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { RowsTable } from '../widgets/RowsTable';
import { RowsResultsChrome } from './RowsResultsChrome';
import { WidgetChart, WidgetProblemBadge } from '../widgets/WidgetChart';
import {
  createExecutorDocumentHost,
  outputToRunResult,
  type WidgetRunResult,
} from '../widgets/chartData';
import { extractBlockQueries } from '../utils/blockQueryPatcher';
import { WqlQueryInspectorModal } from './WqlQueryInspectorModal';

export interface QueryBlockViewProps {
  /** Raw text between the ```query fences — the WQL query string or Query Document body. */
  query: string;
  /** Injected QueryExecutor for executing WQL queries (zero singleton coupling). */
  executor?: QueryExecutor;
  /** Optional callback or subscription hook for when a result is saved. */
  onResultSaved?: (callback: () => void) => (() => void) | void;
  /** Present when the query block is editable — opens the WQL composer. */
  onSaveQuery?: (nextQuery: string) => void | Promise<void>;
  /** When multiple queries appear in one block, the index of this query. */
  queryIndex?: number;
  /** When true, editing the query is disallowed. */
  readOnly?: boolean;
  /** Fence-suffix widget type override (e.g. `query:timeseries`, `query:value`). */
  widgetType?: string;
  /** Frontmatter/syntax parse error for the enclosing widget block. */
  widgetError?: string;
  /** Token values from the note's frontmatter or entity scope, for `$token` substitution. */
  tokenValues?: Record<string, string>;
  /** Fence-tag presentation attributes (decision 22). */
  attributes?: Record<string, string>;
  /** Optional action for saving this query as a dashboard widget. */
  onAddToDashboard?: () => void;
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
  onAddToDashboard,
  onCaptureRpe,
  onOpenNote,
  noteHref,
}: QueryBlockViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const extracted = useMemo(() => extractBlockQueries(query), [query]);
  const rawBody = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.includes('\n')) {
      const docParsed = parseDocument(trimmed);
      if (!docParsed.doc.degenerate && docParsed.diagnostics.length === 0 && docParsed.doc.assignments.length > 0) {
        return trimmed;
      }
    }
    return extracted.length > 0 ? extracted[0].query : query;
  }, [extracted, query]);

  const { query: effectiveQuery, missing } = useMemo(() => {
    const subQuery = substituteTokens(rawBody, tokenValues ?? {});
    const missingSet = new Set(subQuery.missing);
    for (const value of Object.values(attributes ?? {})) {
      for (const m of substituteTokens(value, tokenValues ?? {}).missing) missingSet.add(m);
    }
    return { query: subQuery.query, missing: [...missingSet] };
  }, [rawBody, tokenValues, attributes]);

  const resolvedAttributes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes ?? {})) {
      out[key] = substituteTokens(value, tokenValues ?? {}).query;
    }
    return out;
  }, [attributes, tokenValues]);

  const docParse = useMemo(() => parseDocument(effectiveQuery), [effectiveQuery]);
  const isMultiLineDoc = !docParse.doc.degenerate && docParse.doc.assignments.length > 0;
  const parsed = useMemo(() => parseQuery(effectiveQuery), [effectiveQuery]);
  const syntaxError = isMultiLineDoc ? docParse.diagnostics[0] : parsed.error;

  const unknownType =
    widgetType != null && widgetType !== '' && !isDashboardWidgetType(widgetType);
  const [runResult, setRunResult] = useState<WidgetRunResult | undefined>(undefined);
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
    let retryTimer: number | NodeJS.Timeout | undefined;
    setRunError(undefined);
    setRunResult(undefined);

    if (syntaxError || widgetError || unknownType || missing.length > 0 || !executor) return;

    const isSessionFind = !isMultiLineDoc && isFindQuery(parsed) && parsed.target === 'session';
    const host = createExecutorDocumentHost(executor);

    const executeRun = (attemptCount: number) => {
      const runner = new SharedQueryDocumentRunner(host);
      void runner
        .run(effectiveQuery)
        .then((res) => {
          if (cancelled) return;
          const out = res.outputs[0];
          if (!out) {
            setRunError(res.diagnostics[0] ?? 'widget produced no output');
            return;
          }
          const err = out.error ?? res.diagnostics[0];
          if (err) {
            setRunError(err);
            return;
          }
          const effectiveParsed: AnyParsedQuery = isMultiLineDoc
            ? (out.kind === 'find'
                ? { family: 'find', raw: effectiveQuery, target: 'note', filters: [] }
                : { family: 'aggregate', raw: effectiveQuery, agg: 'sum', metric: out.name, filters: [], groupBy: out.groupBy ?? [] })
            : parsed;
          const shaped = outputToRunResult(effectiveParsed, out);
          setRunResult(shaped);
          if (isSessionFind && (shaped.runs ?? []).length === 0 && attemptCount < 4) {
            const delays = [50, 150, 350, 750];
            retryTimer = setTimeout(() => {
              if (!cancelled) executeRun(attemptCount + 1);
            }, delays[attemptCount] ?? 500);
          }
        })
        .catch((err) => {
          if (!cancelled) setRunError(err instanceof Error ? err.message : String(err));
        });
    };

    executeRun(0);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [effectiveQuery, parsed, isMultiLineDoc, syntaxError, widgetError, unknownType, missing, executor, rowsRefreshKey]);

  const canEdit = onSaveQuery !== undefined && !readOnly;
  const onEdit = canEdit ? () => setIsModalOpen(true) : undefined;

  const resultId = useMemo(() => {
    if (!isFindQuery(parsed) || parsed.target !== 'session') return undefined;
    const resultFilter = parsed.filters.find((f) => f.key === 'result');
    return resultFilter?.values[0]?.value;
  }, [parsed]);

  const fallbackLabel = useMemo(() => {
    if (!isFindQuery(parsed) && !isPipelineQuery(parsed)) return parsed.metric;
    return parsed.raw;
  }, [parsed]);

  return (
    <div data-testid="query-block-view">
      {widgetError ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly} onAddToDashboard={onAddToDashboard}>
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            {widgetError}
          </div>
        </QueryBlockShell>
      ) : unknownType ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly} onAddToDashboard={onAddToDashboard}>
          <WidgetProblemBadge message={unknownWidgetTypeMessage(widgetType)} />
        </QueryBlockShell>
      ) : missing.length > 0 ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly} onAddToDashboard={onAddToDashboard}>
          <WidgetProblemBadge message={unknownTokensMessage(missing)} />
        </QueryBlockShell>
      ) : syntaxError ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly} onAddToDashboard={onAddToDashboard}>
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            Query syntax error: {syntaxError}
          </div>
        </QueryBlockShell>
      ) : runError ? (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly} onAddToDashboard={onAddToDashboard}>
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
            Query execution error: {runError}
          </div>
        </QueryBlockShell>
      ) : (
        <QueryBlockShell onEdit={onEdit} readOnly={readOnly} onAddToDashboard={onAddToDashboard}>
          <QueryBlockBody
            parsed={parsed}
            result={runResult}
            resultId={resultId}
            widgetType={widgetType}
            attributes={resolvedAttributes}
            fallbackLabel={fallbackLabel}
            executor={executor}
            onCaptureRpe={onCaptureRpe}
            onCaptured={() => setRowsRefreshKey((k) => k + 1)}
            onOpenNote={onOpenNote}
            noteHref={noteHref}
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

function QueryBlockBody({
  parsed,
  result,
  resultId,
  widgetType,
  attributes,
  fallbackLabel,
  executor,
  onCaptureRpe,
  onCaptured,
  onOpenNote,
  noteHref,
}: {
  parsed: AnyParsedQuery;
  result: WidgetRunResult | undefined;
  resultId?: string;
  widgetType?: string;
  attributes?: Record<string, string>;
  fallbackLabel: string;
  executor?: QueryExecutor;
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void>;
  onCaptured: () => void;
  onOpenNote?: (item: { id: string; title?: string; blockContentId?: string }) => void;
  noteHref?: (item: { id: string; title?: string; blockContentId?: string }) => string;
}) {
  if (!result) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        {isFindQuery(parsed) ? 'Loading rows…' : 'Loading…'}
      </div>
    );
  }

  if (result.table && (widgetType == null || widgetType === '' || widgetType === 'table')) {
    return <WidgetChart type="table" result={result} />;
  }

  if (resultId && result.runs && result.runs.length > 0) {
    return (
      <RowsResultsChrome
        resultId={resultId}
        sessionResult={result as unknown as RowsQueryResult}
        executor={executor}
        onCaptureRpe={onCaptureRpe}
        onCaptured={onCaptured}
      />
    );
  }

  if (result.runs && (isFindQuery(parsed) || result.runs.length > 0)) {
    return <RowsTable result={result as unknown as RowsQueryResult} />;
  }

  if (
    isFindQuery(parsed) ||
    ((result.notes?.length ?? 0) + (result.blocks?.length ?? 0) + (result.efforts?.length ?? 0) > 0 &&
      (!result.series || result.series.length === 0))
  ) {
    return (
      <WidgetChart
        type="list"
        result={result}
        onOpenNote={onOpenNote}
        noteHref={noteHref}
      />
    );
  }

  const sinkHead = result.chart?.head;
  const effectiveType = widgetType != null && widgetType !== '' ? widgetType : sinkHead ?? '';
  const sinkAttributes = Object.fromEntries(
    (result.chart?.filters ?? []).map((f) => [f.key, f.values.map((v) => v.value).join(',')]),
  );
  const mergedAttributes = { ...sinkAttributes, ...attributes };
  const needsChartHeight =
    isPipelineQuery(parsed) && (Boolean(effectiveType) || (result.series?.length ?? 0) > 0);

  return (
    <div className={needsChartHeight ? 'w-full h-[220px] min-h-[160px]' : undefined}>
      <WidgetChart
        type={effectiveType}
        result={result}
        label={fallbackLabel}
        attributes={mergedAttributes}
        inferDefaultShape={effectiveType === ''}
        onOpenNote={onOpenNote}
        noteHref={noteHref}
      />
    </div>
  );
}

function QueryBlockShell({
  children,
  onEdit,
  readOnly,
  onAddToDashboard,
}: {
  children: React.ReactNode;
  onEdit?: () => void;
  readOnly?: boolean;
  onAddToDashboard?: () => void;
}) {
  return (
    <div className="relative group/block my-2 p-3 rounded-lg border border-border/80 bg-card/60 shadow-sm">
      {(onAddToDashboard || (onEdit && !readOnly)) && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          {onAddToDashboard && (
            <button
              type="button"
              onClick={onAddToDashboard}
              aria-label="Add to dashboard"
              title="Add to dashboard"
              data-testid="query-add-dashboard"
              className="p-1 rounded bg-muted/80 text-muted-foreground hover:text-foreground"
            >
              <ChartBar className="w-3.5 h-3.5" />
            </button>
          )}
          {onEdit && !readOnly && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit query in Omni-Composer"
              title="Edit query in Omni-Composer"
              className="p-1 rounded bg-muted/80 text-muted-foreground hover:text-foreground opacity-0 group-hover/block:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
