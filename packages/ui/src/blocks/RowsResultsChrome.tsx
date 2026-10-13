import { useCallback, useEffect, useState } from 'react';
import { type EventRecord, MetricType } from '@bitcobblers/wod-wiki-core';
import { parseQuery, isFindQuery, type RowsQueryResult, type RowsRun, type ParsedFindQuery } from '@bitcobblers/wod-wiki-wql';
import type { QueryExecutor } from '../contracts/query';
import { RowsTable } from '../widgets/RowsTable';
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

export interface RowsResultsChromeProps {
  /** The session result id from the written `rows:{result:…}` query. */
  resultId: string;
  /** The session-scoped rows result (one run). */
  sessionResult: RowsQueryResult;
  /** Injected QueryExecutor for widened query execution. */
  executor?: QueryExecutor;
  /** Optional RPE capture handler. */
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void>;
  /** Re-run the parent query after a capture so the grid reflects the RPE. */
  onCaptured?: () => void;
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
  onCaptured,
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

  useEffect(() => {
    if (!widened || !blockContentId || !executor) {
      setWideResult(undefined);
      return;
    }
    let cancelled = false;
    const wideQuery = parseQuery(`:session{block:${blockContentId}}`);
    if (!isFindQuery(wideQuery)) return;

    void (executor.runFind ? executor.runFind(wideQuery as ParsedFindQuery) : (executor as any).runRows(wideQuery))
      .then((res: any) => {
        if (!cancelled) setWideResult(res);
      })
      .catch(() => {
        if (!cancelled) setWideResult(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [widened, blockContentId, executor]);

  const displayedResult = widened && wideResult ? wideResult : sessionResult;
  const versionCount = wideResult?.runs.length ?? (widened ? 1 : undefined);
  const canWiden = Boolean(blockContentId);

  return (
    <div className="flex flex-col gap-3" data-testid="rows-results-chrome">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60 text-xs">
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
