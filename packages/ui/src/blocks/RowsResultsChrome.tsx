import { useCallback, useEffect, useMemo, useState } from 'react';
import { type EventRecord, MetricType } from '@bitcobblers/wod-wiki-core';
import {
  parseQuery,
  isFindQuery,
  type RowsQueryResult,
  type RowsRun,
  type ParsedFindQuery,
} from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { RowsTable } from '../widgets/RowsTable';
import { PRBadge } from '../widgets/PRBadge';
import type {
  InlineMetricEditPayload,
  RowPrHighlight,
  SessionTableSortSpec,
} from '../widgets/OutputStatementsTable';
import { cn } from '../utils/cn';

const RPE_SCALE = Array.from({ length: 10 }, (_, i) => i + 1);

export function readSessionRpe(events: EventRecord[] | undefined): number | undefined {
  if (!events) return undefined;
  for (const statement of events) {
    for (const metric of statement.metrics) {
      if (metric.type === MetricType.SessionRPE || (metric.type as string) === 'session_rpe') {
        if (typeof metric.value === 'number') return metric.value;
      }
    }
  }
  return undefined;
}

/**
 * Compute per-row PR highlights by comparing `sessionRun` against prior runs
 * of the same workout block. For each effort slug with a numeric `calc.e1rm`
 * or `resistance` metric, flags the row that beats the best prior run.
 */
export function computeSessionPrHighlights(
  sessionRun: RowsRun | undefined,
  allRuns: readonly RowsRun[] | undefined,
): Map<string | number, RowPrHighlight> {
  const highlights = new Map<string | number, RowPrHighlight>();
  if (!sessionRun || !allRuns || allRuns.length < 2) return highlights;

  const priorRuns = allRuns.filter(
    (r) => r.resultId !== sessionRun.resultId && r.timestamp <= sessionRun.timestamp,
  );
  if (priorRuns.length === 0) return highlights;

  const extractBestForEffort = (events: readonly EventRecord[]) => {
    const byEffort = new Map<
      string,
      { value: number; unit?: string; rowId?: string | number; label: string }
    >();
    for (const row of events) {
      if (row.outputType !== 'segment') continue;
      const effortMetric = row.metrics.find((m) => String(m.type).toLowerCase() === 'effort');
      const effortImage =
        effortMetric && 'image' in effortMetric && typeof effortMetric.image === 'string'
          ? effortMetric.image
          : undefined;
      const label = String(effortImage ?? effortMetric?.value ?? '').trim();
      const key = label.toLowerCase();
      if (!key) continue;

      // Prefer calc.e1rm when present; otherwise use user/runtime resistance.
      const e1rm = row.metrics.find(
        (m) => String(m.type).toLowerCase() === 'calc.e1rm' && typeof m.value === 'number',
      );
      const resistance =
        row.metrics.find(
          (m) =>
            String(m.type).toLowerCase() === 'resistance' &&
            m.origin === 'user' &&
            typeof m.value === 'number',
        ) ??
        row.metrics.find(
          (m) => String(m.type).toLowerCase() === 'resistance' && typeof m.value === 'number',
        );
      const chosen = e1rm ?? resistance;
      if (!chosen || typeof chosen.value !== 'number' || !Number.isFinite(chosen.value) || chosen.value <= 0) {
        continue;
      }
      const unit =
        'unit' in chosen && typeof (chosen as { unit?: unknown }).unit === 'string'
          ? (chosen as { unit: string }).unit
          : undefined;
      const prev = byEffort.get(key);
      if (!prev || chosen.value > prev.value) {
        byEffort.set(key, {
          value: chosen.value,
          unit,
          rowId: row.id ?? row.sourceBlockKey,
          label,
        });
      }
    }
    return byEffort;
  };

  const priorMaxByEffort = new Map<string, number>();
  for (const run of priorRuns) {
    const runBest = extractBestForEffort(run.events);
    for (const [effortKey, info] of runBest) {
      const existing = priorMaxByEffort.get(effortKey);
      if (existing === undefined || info.value > existing) {
        priorMaxByEffort.set(effortKey, info.value);
      }
    }
  }

  const currentBest = extractBestForEffort(sessionRun.events);
  for (const [effortKey, curr] of currentBest) {
    const priorMax = priorMaxByEffort.get(effortKey);
    if (priorMax !== undefined && curr.value > priorMax && curr.rowId !== undefined) {
      const delta = Math.round((curr.value - priorMax) * 10) / 10;
      highlights.set(curr.rowId, {
        improvement: delta,
        unit: curr.unit,
      });
    }
  }

  return highlights;
}

export interface RowsResultsChromeProps {
  /** The session result id from the written `:session{result:…}` query. */
  resultId: string;
  /** The session-scoped rows result (one run). */
  sessionResult: RowsQueryResult;
  /** Injected QueryExecutor for widened query execution and PR lookup. */
  executor?: QueryExecutor;
  /** Optional RPE capture handler. */
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void>;
  /** Optional inline metric actuals editor (`captureMetricCorrection`). */
  onEditMetric?: (resultId: string, payload: InlineMetricEditPayload) => void | Promise<void>;
  /** Re-run the parent query after a capture so the grid reflects the update. */
  onCaptured?: () => void;
  /** Optional column whitelist/order from YAML `columns: [...]`. */
  columns?: readonly string[];
  /** Optional sort specs from YAML `sort: [...]`. */
  sort?: readonly SessionTableSortSpec[];
  /** Optional row limit from YAML `limit: N`. */
  limit?: number;
  /** Enable/disable historical PR badge comparison (defaults to true). */
  comparePr?: boolean;
}

function RpeChip({
  resultId,
  events,
  readOnly,
  onCapture,
}: {
  resultId: string;
  events: RowsRun['events'];
  readOnly?: boolean;
  onCapture: (rpe: number) => Promise<void>;
}) {
  const value = readSessionRpe(events);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (readOnly) {
    return value !== undefined ? (
      <span className="text-[10px] font-mono text-muted-foreground" data-testid={`rpe-readonly-${resultId}`}>
        RPE {value}
      </span>
    ) : null;
  }

  const pick = async (rpe: number) => {
    setPending(true);
    try {
      await onCapture(rpe);
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1" data-testid={`rpe-chip-${resultId}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors',
          value !== undefined
            ? 'border-border text-foreground hover:border-primary'
            : 'border-dashed border-muted-foreground/50 text-muted-foreground hover:text-foreground hover:border-primary',
        )}
        title={value !== undefined ? 'Update session RPE' : 'Rate this session’s effort'}
      >
        {value !== undefined ? `RPE ${value}` : 'RPE —'}
      </button>
      {open && (
        <span className="inline-flex gap-0.5" data-testid={`rpe-scale-${resultId}`}>
          {RPE_SCALE.map((rpe) => (
            <button
              key={rpe}
              type="button"
              disabled={pending}
              onClick={() => void pick(rpe)}
              aria-label={`RPE ${rpe}`}
              className={cn(
                'h-5 min-w-[1.25rem] px-0.5 text-[10px] font-medium rounded border border-border',
                rpe === value && 'bg-primary text-primary-foreground',
                rpe <= 3 && 'hover:bg-rpe-easy/15 hover:text-rpe-easy',
                rpe > 3 && rpe <= 6 && 'hover:bg-rpe-moderate/15 hover:text-rpe-moderate',
                rpe > 6 && rpe <= 8 && 'hover:bg-rpe-hard/15 hover:text-rpe-hard',
                rpe > 8 && 'hover:bg-rpe-max/15 hover:text-rpe-max',
              )}
            >
              {rpe}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function RowsResultsChrome({
  resultId,
  sessionResult,
  executor,
  onCaptureRpe,
  onEditMetric,
  onCaptured,
  columns,
  sort,
  limit,
  comparePr = true,
}: RowsResultsChromeProps) {
  const [widened, setWidened] = useState(false);
  const [wideResult, setWideResult] = useState<RowsQueryResult | undefined>(undefined);

  const sessionRun = sessionResult.runs[0];
  const blockContentId = sessionRun?.events[0]?.blockContentId;

  const handleCapture = useCallback(
    async (rpe: number) => {
      if (onCaptureRpe) {
        await onCaptureRpe(resultId, rpe);
      }
      onCaptured?.();
    },
    [resultId, onCaptureRpe, onCaptured],
  );

  const handleInlineEdit = useCallback(
    async (targetResultId: string, payload: InlineMetricEditPayload) => {
      if (!onEditMetric) return;
      await onEditMetric(targetResultId, payload);
      onCaptured?.();
    },
    [onEditMetric, onCaptured],
  );

  // Fetch block history whenever widened OR PR comparison is active so both
  // "All versions (N)" and PRBadge share one lightweight query.
  const shouldLoadHistory = Boolean(blockContentId && executor && (widened || comparePr));

  useEffect(() => {
    if (!shouldLoadHistory || !blockContentId || !executor) {
      if (!widened) setWideResult(undefined);
      return;
    }
    let cancelled = false;
    const wideQuery = parseQuery(`:session{block:${blockContentId}}`);
    if (!isFindQuery(wideQuery)) return;

    const legacyRowsExecutor = executor as unknown as {
      runRows?: (q: ParsedFindQuery) => Promise<RowsQueryResult>;
    };
    const promise = executor.runFind
      ? (executor.runFind(wideQuery) as unknown as Promise<RowsQueryResult>)
      : legacyRowsExecutor.runRows
        ? legacyRowsExecutor.runRows(wideQuery)
        : undefined;
    if (!promise) return;

    void promise
      .then((res) => {
        if (!cancelled && res && Array.isArray(res.runs)) setWideResult(res);
      })
      .catch(() => {
        if (!cancelled) setWideResult(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoadHistory, widened, blockContentId, executor, sessionRun?.events]);

  const prHighlights = useMemo(
    () => (comparePr ? computeSessionPrHighlights(sessionRun, wideResult?.runs) : undefined),
    [comparePr, sessionRun, wideResult?.runs],
  );

  const displayedResult = widened && wideResult ? wideResult : sessionResult;
  const versionCount = wideResult?.runs.length ?? (widened ? 1 : undefined);
  const canWiden = Boolean(blockContentId);

  return (
    <div className="flex flex-col gap-3" data-testid="rows-results-chrome">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60 text-xs">
        <div className="inline-flex items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setWidened(false)}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                !widened
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              This session
            </button>
            <button
              type="button"
              disabled={!canWiden}
              onClick={() => setWidened(true)}
              title={canWiden ? undefined : 'No block content association for this run'}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                widened
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
                !canWiden && 'opacity-40 cursor-not-allowed',
              )}
            >
              All versions{versionCount !== undefined ? ` (${versionCount})` : ''}
            </button>
          </div>
          {prHighlights && prHighlights.size > 0 && (
            <PRBadge
              label={prHighlights.size > 1 ? `${prHighlights.size} PRs` : undefined}
              className="text-[10px] py-0"
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`/results/${encodeURIComponent(resultId)}`}
            className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-0.5"
            data-testid="view-in-results-link"
          >
            View in Results &rarr;
          </a>
          <RpeChip
            resultId={resultId}
            events={sessionRun?.events}
            onCapture={handleCapture}
          />
        </div>
      </div>

      <RowsTable
        result={displayedResult}
        columns={columns}
        sort={sort}
        limit={limit}
        prHighlights={prHighlights}
        onEditMetric={onEditMetric ? handleInlineEdit : undefined}
        renderRunHeaderExtra={(run) =>
          run.resultId === resultId ? (
            <RpeChip resultId={resultId} events={run.events} onCapture={handleCapture} />
          ) : (
            <RpeChip resultId={run.resultId} events={run.events} readOnly onCapture={handleCapture} />
          )
        }
      />
    </div>
  );
}
