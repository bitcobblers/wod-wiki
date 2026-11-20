import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Code2,
  Gauge,
} from 'lucide-react';
import {
  computeRowsRunSummary,
  type MovementRollupItem,
  type RowsRun,
  type RowsRunSummary,
} from '@bitcobblers/wod-wiki-wql';
import type { RowPrHighlight } from '../widgets/OutputStatementsTable';
import { PRBadge } from '../widgets/PRBadge';
import { cn } from '../utils/cn';

/**
 * Shared payload emitted when the user opens a full session breakdown or
 * promotes a workout into an analytics dashboard from any SessionSummaryCard
 * or ResultsSpreadsheetGrid surface.
 */
export interface SessionActionContext {
  resultId: string;
  noteId?: string;
  noteTitle?: string;
  blockContentId?: string;
  notebooks?: readonly string[];
  summary?: RowsRunSummary;
}

const RPE_HINTS: readonly { range: string; label: string; toneClass: string }[] = [
  { range: '1–3', label: 'Easy', toneClass: 'text-emerald-800 dark:text-emerald-300' },
  { range: '4–6', label: 'Moderate', toneClass: 'text-amber-900 dark:text-amber-200' },
  { range: '7–8', label: 'Hard', toneClass: 'text-orange-800 dark:text-orange-300' },
  { range: '9–10', label: 'Max', toneClass: 'text-destructive' },
];

function rpeChipClass(rpe: number, selected: boolean): string {
  if (selected) {
    return 'bg-primary text-primary-foreground border-primary font-bold';
  }
  if (rpe <= 3) return 'border-border bg-background text-foreground hover:bg-emerald-500/15';
  if (rpe <= 6) return 'border-border bg-background text-foreground hover:bg-amber-500/20';
  if (rpe <= 8) return 'border-border bg-background text-foreground hover:bg-orange-500/20';
  return 'border-border bg-background text-foreground hover:bg-destructive/20';
}

export function formatSummaryDurationMMSS(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatCompactNum(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString('en-US') : rounded.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function normalizePrMap(
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>,
): Map<string, RowPrHighlight> {
  const map = new Map<string, RowPrHighlight>();
  if (!prHighlights) return map;
  if (prHighlights instanceof Map) {
    for (const [k, v] of prHighlights.entries()) map.set(String(k), v);
  } else {
    for (const [k, v] of Object.entries(prHighlights)) map.set(k, v);
  }
  return map;
}

export interface RpePopoverControlProps {
  rpe: number | null | undefined;
  onChange?: (nextRpe: number) => void | Promise<void>;
  readOnly?: boolean;
  compact?: boolean;
  resultId?: string;
  className?: string;
}

/** Accessible 1–10 session effort (RPE) selector popover. */
export function RpePopoverControl({
  rpe,
  onChange,
  readOnly = false,
  compact = false,
  resultId,
  className,
}: RpePopoverControlProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasValue = typeof rpe === 'number' && Number.isFinite(rpe) && rpe > 0;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (readOnly || !onChange) {
    if (!hasValue) return null;
    return (
      <span
        data-testid={resultId ? `rpe-readonly-${resultId}` : 'session-rpe-readonly'}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-mono tabular-nums text-muted-foreground',
          className,
        )}
      >
        <Gauge className="size-3.5 text-primary" aria-hidden="true" />
        RPE {rpe}/10
      </span>
    );
  }

  const pick = async (val: number) => {
    setPending(true);
    try {
      await onChange(val);
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid={resultId ? `rpe-chip-${resultId}` : 'session-rpe-trigger'}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'min-h-11' : 'min-h-11 sm:min-h-8',
          hasValue
            ? 'border-border bg-background text-foreground hover:bg-muted'
            : 'border-dashed border-muted-foreground/50 bg-background text-muted-foreground hover:text-foreground hover:border-border',
        )}
        title={hasValue ? 'Update session RPE' : 'Rate this session effort'}
      >
        <Gauge className="size-3.5 text-primary" aria-hidden="true" />
        <span>{hasValue ? `RPE ${rpe}/10` : 'Rate RPE'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Rate session RPE"
          data-testid={resultId ? `rpe-scale-${resultId}` : 'session-rpe-popover'}
          className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Session Effort (RPE)</span>
            <span className="text-xs text-muted-foreground">1 = easy, 10 = max</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 10 }, (_, idx) => idx + 1).map((val) => (
              <button
                key={val}
                type="button"
                disabled={pending}
                aria-label={`RPE ${val}`}
                data-testid={resultId ? `rpe-option-${resultId}-${val}` : `session-rpe-option-${val}`}
                onClick={() => void pick(val)}
                className={cn(
                  'min-h-11 rounded-md border text-xs font-mono tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  rpeChipClass(val, rpe === val),
                )}
              >
                {val}
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
            {RPE_HINTS.map((hint) => (
              <span key={hint.range} className={hint.toneClass}>
                {hint.range} {hint.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export interface SessionSummaryCardProps {
  run: RowsRun;
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>;
  noteTitle?: string;
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void> | void;
  onOpenResults?: (ctx: SessionActionContext) => void;
  onAddToDashboard?: (ctx: SessionActionContext) => void;
  onEditSource?: () => void;
  readOnly?: boolean;
  /** Omit outer card border/background when already hosted inside an enclosing shell/frame. */
  bare?: boolean;
  hideDrillActions?: boolean;
  compactMobile?: boolean;
  className?: string;
}

/**
 * Shared workout execution summary card backed directly by `RowsRun.summary`
 * (or derived via `computeRowsRunSummary`). Rendered in inline Note previews,
 * `FullscreenTimer` completion, and `summary` dashboard widgets.
 */
export function SessionSummaryCard({
  run,
  prHighlights,
  noteTitle: noteTitleProp,
  onCaptureRpe,
  onOpenResults,
  onAddToDashboard,
  onEditSource,
  readOnly = false,
  bare = false,
  hideDrillActions = false,
  compactMobile = false,
  className,
}: SessionSummaryCardProps) {
  const [rollupExpanded, setRollupExpanded] = useState(false);

  const summary = useMemo(
    () => run.summary ?? computeRowsRunSummary(run, { noteTitle: noteTitleProp }),
    [run, noteTitleProp],
  );
  const prMap = useMemo(() => normalizePrMap(prHighlights), [prHighlights]);

  const effortPrMap = useMemo(() => {
    const out = new Map<string, RowPrHighlight>();
    if (prMap.size === 0) return out;
    for (const ev of run.events) {
      const key = ev.id ?? ev.sourceBlockKey;
      if (key === undefined) continue;
      const hit = prMap.get(String(key)) ?? (ev.sourceBlockKey ? prMap.get(ev.sourceBlockKey) : undefined);
      if (!hit) continue;
      const slug = ev.effortSlug?.trim().toLowerCase();
      if (slug && !out.has(slug)) out.set(slug, hit);
    }
    return out;
  }, [prMap, run.events]);

  const prCount = Math.max(summary.prCount ?? 0, prMap.size);
  const title = noteTitleProp ?? summary.noteTitle ?? 'Completed Workout';
  const dateLabel = new Date(run.timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const actionContext: SessionActionContext = {
    resultId: run.resultId,
    noteId: run.noteId,
    noteTitle: title,
    blockContentId: summary.blockContentId,
    notebooks: summary.notebooks,
    summary,
  };

  const hasVolume = summary.totalVolume > 0;
  const hasDistance = summary.totalDistance > 0;
  const primaryWorkLabel = hasVolume ? 'Total Volume' : hasDistance ? 'Total Distance' : 'Splits Recorded';
  const primaryWorkValue = hasVolume
    ? `${formatCompactNum(summary.totalVolume)}${summary.volumeUnit ? ` ${summary.volumeUnit}` : ''}`
    : hasDistance
      ? `${formatCompactNum(summary.totalDistance)}${summary.distanceUnit ? ` ${summary.distanceUnit}` : ''}`
      : summary.splitCount > 0
        ? String(summary.splitCount)
        : '—';
  const effortList = summary.efforts ?? [];
  const primaryWorkSub = hasVolume && hasDistance
    ? `${formatCompactNum(summary.totalDistance)} ${summary.distanceUnit ?? 'm'} distance`
    : effortList.length > 0
      ? `${effortList.length} movement${effortList.length === 1 ? '' : 's'}`
      : undefined;

  const intensityLabel =
    summary.tis !== undefined
      ? 'Intensity (TIS)'
      : summary.sessionLoad !== undefined
        ? 'Session Load'
        : 'Movements';
  const intensityValue =
    summary.tis !== undefined
      ? `${formatCompactNum(summary.tis)} pts`
      : summary.sessionLoad !== undefined
        ? `${formatCompactNum(summary.sessionLoad)} AU`
        : effortList.length > 0
          ? String(effortList.length)
          : '—';
  const intensitySub =
    summary.tis !== undefined && summary.sessionLoad !== undefined
      ? `${formatCompactNum(summary.sessionLoad)} AU load`
      : summary.rpe !== undefined
        ? `RPE ${summary.rpe}/10 logged`
        : undefined;

  const rollups: readonly MovementRollupItem[] = summary.movementRollup ?? [];
  const visibleRollups = rollupExpanded ? rollups : rollups.slice(0, compactMobile ? 2 : 3);

  return (
    <article
      data-testid="session-summary-card"
      data-result-id={run.resultId}
      className={cn(
        !bare && 'rounded-xl border border-border bg-card text-card-foreground shadow-sm p-3.5 sm:p-4',
        bare && 'p-2.5 sm:p-3',
        className,
      )}
    >
      {/* Top header + non-colliding flex action cluster */}
      <header className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm sm:text-base font-semibold tracking-tight text-foreground truncate">
              {title}
            </h3>
            {prCount > 0 && (
              <PRBadge label={prCount > 1 ? `${prCount} PRs` : undefined} />
            )}
            {summary.completed === false && (
              <span className="inline-flex items-center rounded-full border border-amber-400/50 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                Partial
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
            <time dateTime={new Date(run.timestamp).toISOString()}>{dateLabel}</time>
            {summary.roundsCompleted > 0 && (
              <span>
                {summary.roundsCompleted} {summary.roundsCompleted === 1 ? 'round' : 'rounds'}
              </span>
            )}
            {summary.splitCount > 0 && (
              <span>
                {summary.splitCount} {summary.splitCount === 1 ? 'split' : 'splits'}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <RpePopoverControl
            rpe={summary.rpe ?? null}
            resultId={run.resultId}
            readOnly={readOnly}
            compact={compactMobile}
            onChange={onCaptureRpe ? (next) => onCaptureRpe(run.resultId, next) : undefined}
          />
          {!readOnly && onEditSource && (
            <button
              type="button"
              data-testid="session-summary-edit-source"
              onClick={onEditSource}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors min-h-11 sm:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Edit query source"
            >
              <Code2 className="size-3.5" aria-hidden="true" />
              <span>Source</span>
            </button>
          )}
          {!hideDrillActions && onAddToDashboard && (
            <button
              type="button"
              data-testid="session-summary-add-dashboard"
              onClick={() => onAddToDashboard(actionContext)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors min-h-11 sm:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BarChart3 className="size-3.5 text-primary" aria-hidden="true" />
              <span>Add to Dashboard</span>
            </button>
          )}
          {!hideDrillActions && onOpenResults && (
            <button
              type="button"
              data-testid="session-summary-open-results"
              onClick={() => onOpenResults(actionContext)}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors min-h-11 sm:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>Open Results</span>
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {/* 4-KPI responsive strip */}
      <dl
        data-testid="session-summary-kpis"
        className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2"
      >
        <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
          <dt className="text-[11px] font-medium text-muted-foreground">Duration</dt>
          <dd className="mt-0.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
            {formatSummaryDurationMMSS(summary.elapsedMs)}
          </dd>
          {summary.roundsCompleted > 0 && (
            <dd className="text-[11px] text-muted-foreground tabular-nums">
              {summary.roundsCompleted} rds completed
            </dd>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
          <dt className="text-[11px] font-medium text-muted-foreground">{primaryWorkLabel}</dt>
          <dd className="mt-0.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
            {primaryWorkValue}
          </dd>
          {primaryWorkSub && (
            <dd className="text-[11px] text-muted-foreground tabular-nums">{primaryWorkSub}</dd>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
          <dt className="text-[11px] font-medium text-muted-foreground">Total Reps</dt>
          <dd className="mt-0.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
            {summary.totalReps > 0 ? formatCompactNum(summary.totalReps) : '—'}
          </dd>
          {summary.splitCount > 0 && (
            <dd className="text-[11px] text-muted-foreground tabular-nums">
              across {summary.splitCount} {summary.splitCount === 1 ? 'segment' : 'segments'}
            </dd>
          )}
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
          <dt className="text-[11px] font-medium text-muted-foreground">{intensityLabel}</dt>
          <dd className="mt-0.5 text-base sm:text-lg font-semibold font-mono tabular-nums text-foreground">
            {intensityValue}
          </dd>
          {intensitySub && (
            <dd className="text-[11px] text-muted-foreground tabular-nums">{intensitySub}</dd>
          )}
        </div>
      </dl>

      {/* Collapsible Movement Rollup */}
      {rollups.length > 0 && (
        <section className="mt-3 border-t border-border/60 pt-2.5" aria-label="Movement breakdown">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Movement Rollup ({rollups.length})
            </span>
            {rollups.length > (compactMobile ? 2 : 3) && (
              <button
                type="button"
                data-testid="session-summary-movements-toggle"
                aria-expanded={rollupExpanded}
                onClick={() => setRollupExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <span>{rollupExpanded ? 'Show fewer' : `Show all ${rollups.length}`}</span>
                {rollupExpanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
              </button>
            )}
          </div>
          <ul
            data-testid="session-summary-movements"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5"
          >
            {visibleRollups.map((item) => {
              const prHit = effortPrMap.get(item.effortSlug.trim().toLowerCase());
              const volStr =
                item.totalVolume > 0
                  ? `${formatCompactNum(item.totalVolume)}${item.volumeUnit ? ` ${item.volumeUnit}` : ''}`
                  : item.totalDistance > 0
                    ? `${formatCompactNum(item.totalDistance)}${item.distanceUnit ? ` ${item.distanceUnit}` : ''}`
                    : item.totalElapsedMs > 0
                      ? formatSummaryDurationMMSS(item.totalElapsedMs)
                      : '—';
              return (
                <li
                  key={item.effortSlug}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground truncate">{item.label}</span>
                      {prHit && <PRBadge improvement={prHit.improvement} unit={prHit.unit} />}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {item.splits} {item.splits === 1 ? 'set' : 'sets'}
                      {item.totalReps > 0 ? ` · ${formatCompactNum(item.totalReps)} reps` : ''}
                      {item.bestE1rm
                        ? ` · e1RM ${formatCompactNum(item.bestE1rm)}${item.volumeUnit ? ` ${item.volumeUnit}` : ''}`
                        : item.bestWeight
                          ? ` · ${formatCompactNum(item.bestWeight)}${item.volumeUnit ? ` ${item.volumeUnit}` : ''}`
                          : ''}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">
                    {volStr}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
