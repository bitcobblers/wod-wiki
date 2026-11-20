import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Code2,
  Gauge,
  Pencil,
  Table2,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatDurationMMSS,
  formatPace,
  formatSignedDeltaSec,
  type ProtoSummaryMetrics,
  type ProtoWorkoutFixture,
} from './protoData';

const RPE_HINTS: Array<{ range: string; label: string; toneClass: string }> = [
  { range: '1–3', label: 'Easy', toneClass: 'text-emerald-800 dark:text-emerald-300' },
  { range: '4–6', label: 'Moderate', toneClass: 'text-amber-900 dark:text-amber-200' },
  { range: '7–8', label: 'Hard', toneClass: 'text-orange-800 dark:text-orange-300' },
  { range: '9–10', label: 'Max', toneClass: 'text-destructive' },
];

function rpeChipClass(rpe: number, selected: boolean): string {
  if (selected) {
    return 'bg-primary text-primary-foreground border-primary font-bold';
  }
  if (rpe <= 3) return 'border-border bg-background text-foreground hover:bg-rpe-easy/15';
  if (rpe <= 6) return 'border-border bg-background text-foreground hover:bg-rpe-moderate/20';
  if (rpe <= 8) return 'border-border bg-background text-foreground hover:bg-rpe-hard/20';
  return 'border-border bg-background text-foreground hover:bg-rpe-max/20';
}

export interface RpePopoverControlProps {
  rpe: number | null;
  onChange: (nextRpe: number) => void;
  compact?: boolean;
}

export function RpePopoverControl({ rpe, onChange, compact }: RpePopoverControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="proto-rpe-trigger"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'min-h-11' : 'min-h-11 sm:min-h-8',
          rpe != null
            ? 'border-border bg-background text-foreground hover:bg-muted'
            : 'border-dashed border-field-border bg-background text-muted-foreground hover:text-foreground',
        )}
      >
        <Gauge className="size-3.5 text-primary" aria-hidden="true" />
        <span>{rpe != null ? `RPE ${rpe}/10` : 'Rate RPE'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Rate session RPE"
          data-testid="proto-rpe-popover"
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
                data-testid={`proto-rpe-option-${val}`}
                onClick={() => {
                  onChange(val);
                  setOpen(false);
                }}
                className={cn(
                  'min-h-11 rounded-md border text-xs font-mono tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
  fixture: ProtoWorkoutFixture;
  summary: ProtoSummaryMetrics;
  rpe: number | null;
  onChangeRpe: (nextRpe: number) => void;
  onOpenSpreadsheet?: () => void;
  onOpenAddToDashboard?: () => void;
  showSourceToggle?: boolean;
  isEditingSource?: boolean;
  onToggleSource?: () => void;
  yamlFenceText?: string;
  compactMobile?: boolean;
  hideDrillActions?: boolean;
  /** Omit outer card border/fill when already hosted inside an enclosing card. */
  bare?: boolean;
}

export function SessionSummaryCard({
  fixture,
  summary,
  rpe,
  onChangeRpe,
  onOpenSpreadsheet,
  onOpenAddToDashboard,
  showSourceToggle = false,
  isEditingSource = false,
  onToggleSource,
  yamlFenceText,
  compactMobile = false,
  hideDrillActions = false,
  bare = false,
}: SessionSummaryCardProps) {
  const [rollupOpen, setRollupOpen] = useState(true);

  const kpis: Array<{
    label: string;
    value: string;
    subtext?: string;
    toneClass: string;
  }> =
    fixture.domain === 'endurance'
      ? [
          {
            label: 'Elapsed Time',
            value: formatDurationMMSS(summary.elapsedSec),
            subtext:
              summary.priorDeltaSec != null
                ? `${formatSignedDeltaSec(summary.priorDeltaSec)} vs prior`
                : undefined,
            toneClass: 'text-metric-time',
          },
          {
            label: 'Distance',
            value:
              summary.totalDistanceM != null
                ? `${(summary.totalDistanceM / 1000).toFixed(2)} km`
                : '—',
            subtext: `${summary.splitCount} intervals`,
            toneClass: 'text-metric-distance',
          },
          {
            label: 'Avg Pace',
            value: formatPace(summary.avgPaceSecPerKm),
            subtext: 'threshold pace',
            toneClass: 'text-metric-action',
          },
          {
            label: 'TIS Score',
            value: `${summary.tis.toFixed(1)} pts`,
            subtext: `${summary.sessionLoadAu} AU load`,
            toneClass: 'text-metric-effort',
          },
        ]
      : [
          {
            label: 'Elapsed Time',
            value: formatDurationMMSS(summary.elapsedSec),
            subtext:
              summary.priorDeltaSec != null
                ? `${formatSignedDeltaSec(summary.priorDeltaSec)} vs prior`
                : undefined,
            toneClass: 'text-metric-time',
          },
          {
            label: 'Total Volume',
            value:
              summary.totalVolumeLbs != null
                ? `${summary.totalVolumeLbs.toLocaleString()} lb`
                : '—',
            subtext:
              summary.maxE1rmLbs != null
                ? `peak ${summary.maxE1rmLbs.toFixed(1)} lb e1RM`
                : undefined,
            toneClass: 'text-metric-resistance',
          },
          {
            label: 'Total Reps',
            value: `${summary.totalReps}`,
            subtext: `${summary.splitCount} ${fixture.hasSegments ? 'splits' : 'sets'}`,
            toneClass: 'text-metric-rep',
          },
          {
            label: 'TIS Score',
            value: `${summary.tis.toFixed(1)} pts`,
            subtext: `${summary.sessionLoadAu} AU load`,
            toneClass: 'text-metric-effort',
          },
        ];

  return (
    <section
      aria-label={`Session summary for ${fixture.title}`}
      data-testid="proto-session-summary-card"
      className={cn(
        'text-card-foreground',
        bare
          ? 'rounded-lg bg-muted/20'
          : 'rounded-xl border border-border bg-card',
      )}
    >
      {/* Flex header row: zero absolute overlapping controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{fixture.title}</h3>
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {fixture.attemptLabel} · {fixture.dateLabel}
            </span>
            {summary.prBadges.map((badge) => (
              <span
                key={badge}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 tabular-nums"
              >
                <Trophy className="size-3" aria-hidden="true" />
                {badge}
              </span>
            ))}
            {summary.modifiedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-600/30 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200 tabular-nums">
                <Pencil className="size-3" aria-hidden="true" />
                {summary.modifiedCount} edited
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <RpePopoverControl rpe={rpe} onChange={onChangeRpe} compact={compactMobile} />
          {showSourceToggle && onToggleSource && (
            <button
              type="button"
              data-testid="proto-summary-source-toggle"
              aria-pressed={isEditingSource}
              onClick={onToggleSource}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                isEditingSource
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              <Code2 className="size-3.5" aria-hidden="true" />
              <span>{isEditingSource ? 'Return to summary' : 'Source'}</span>
            </button>
          )}
        </div>
      </div>

      {isEditingSource && yamlFenceText ? (
        <div className="p-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Embedded Markdown Query Block (explicit YAML injection)
          </div>
          <pre
            data-testid="proto-summary-source-pre"
            className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground leading-relaxed"
          >
            {yamlFenceText}
          </pre>
        </div>
      ) : (
        <>
          {/* 4-metric KPI strip with hairline dividers (no nested cards) */}
          <div
            className={cn(
              'grid divide-border/70 border-b border-border/70',
              compactMobile
                ? 'grid-cols-2 divide-y sm:divide-y-0'
                : 'grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x',
            )}
          >
            {kpis.map((kpi, idx) => (
              <div
                key={kpi.label}
                className={cn(
                  'px-4 py-3',
                  compactMobile && idx % 2 === 1 && 'border-l border-border/70',
                )}
              >
                <div className="text-xs font-medium text-muted-foreground">{kpi.label}</div>
                <div className={cn('mt-0.5 text-lg font-bold tabular-nums', kpi.toneClass)}>
                  {kpi.value}
                </div>
                {kpi.subtext && (
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {kpi.subtext}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Collapsible movement rollup */}
          <div className="px-4 py-2.5">
            <button
              type="button"
              aria-expanded={rollupOpen}
              onClick={() => setRollupOpen((v) => !v)}
              className={cn(
                'flex w-full items-center justify-between text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
                compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-7',
              )}
            >
              <span>
                Movement rollup ({summary.movementRollup.length}{' '}
                {summary.movementRollup.length === 1 ? 'movement' : 'movements'})
              </span>
              {rollupOpen ? (
                <ChevronUp className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4" aria-hidden="true" />
              )}
            </button>

            {rollupOpen && (
              <ul className="mt-1.5 divide-y divide-border/50">
                {summary.movementRollup.map((item) => (
                  <li
                    key={item.effortSlug}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-foreground">{item.movement}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {item.sets} {item.sets === 1 ? 'set' : 'sets'}
                        {item.totalReps > 0 ? ` · ${item.totalReps} reps` : ''}
                        {item.avgLoadLbs != null ? ` @ ${item.avgLoadLbs} lb` : ''}
                        {item.totalDistanceM != null
                          ? ` · ${(item.totalDistanceM / 1000).toFixed(2)} km`
                          : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {item.totalVolumeLbs != null && (
                        <span>{item.totalVolumeLbs.toLocaleString()} lb vol</span>
                      )}
                      {item.bestE1rmLbs != null && (
                        <span className="text-foreground font-medium">
                          {item.bestE1rmLbs.toFixed(1)} lb e1RM
                        </span>
                      )}
                      {item.avgPaceSecPerKm != null && (
                        <span className="text-foreground font-medium">
                          {formatPace(item.avgPaceSecPerKm)}
                        </span>
                      )}
                      <span>{formatDurationMMSS(item.totalDurationSec)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Card Footer Actions */}
          {!hideDrillActions && (onOpenSpreadsheet || onOpenAddToDashboard) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-muted/25 px-4 py-2.5 rounded-b-xl">
              {onOpenAddToDashboard ? (
                <button
                  type="button"
                  data-testid="proto-summary-add-dashboard"
                  onClick={onOpenAddToDashboard}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-9',
                  )}
                >
                  <BarChart3 className="size-3.5 text-primary" aria-hidden="true" />
                  <span>Add to dashboard</span>
                </button>
              ) : (
                <span />
              )}

              {onOpenSpreadsheet && (
                <button
                  type="button"
                  data-testid="proto-summary-open-spreadsheet"
                  onClick={onOpenSpreadsheet}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-9',
                  )}
                >
                  <Table2 className="size-3.5" aria-hidden="true" />
                  <span>
                    Open Spreadsheet ({summary.splitCount}{' '}
                    {fixture.hasSegments ? 'splits' : 'sets'})
                  </span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
