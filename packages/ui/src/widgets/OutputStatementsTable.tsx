import { useMemo, type ReactNode } from 'react';
import type { IMetric } from '@bitcobblers/wod-wiki-core';
import { metricPresentation, type MetricPresentationToken } from '@bitcobblers/wod-wiki-lang';

// ── Time formatting ──────────────────────────────────────────────────────────

export function formatMMSS(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatClockTime(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── Metric badge presentation (runtime-badge surface) ────────────────────────

export const TONE_CLASS: Record<string, string> = {
  time: 'border-metric-time/40 bg-metric-time/10 text-metric-time',
  rep: 'border-metric-rep/40 bg-metric-rep/10 text-metric-rep',
  effort: 'border-metric-effort/40 bg-metric-effort/10 text-metric-effort',
  distance: 'border-metric-distance/40 bg-metric-distance/10 text-metric-distance',
  rounds: 'border-metric-rounds/40 bg-metric-rounds/10 text-metric-rounds',
  action: 'border-metric-action/40 bg-metric-action/10 text-metric-action',
  resistance: 'border-metric-resistance/40 bg-metric-resistance/10 text-metric-resistance',
  rest: 'border-metric-rest/40 bg-metric-rest/10 text-metric-rest italic',
  muted: 'border-border/70 bg-muted/50 text-muted-foreground',
  system: 'border-border/60 bg-muted/40 text-muted-foreground',
  unknown: 'border-border/60 bg-muted/40 text-muted-foreground',
};

export function MetricBadge({ token }: { token: MetricPresentationToken }) {
  if (!token.visible || !token.label) return null;
  if (token.renderKind === 'comment') {
    return (
      <span className="text-[10px] italic text-muted-foreground" title={token.tooltip}>
        {token.label}
      </span>
    );
  }
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-tight select-none ${
        TONE_CLASS[token.tone] ?? TONE_CLASS.unknown
      }`}
      title={token.tooltip}
    >
      {token.label}
    </span>
  );
}

/** Metric badges for a statement/output metric group. */
export function presentBadges(metrics: Iterable<IMetric>): ReactNode {
  return (
    <>
      {metricPresentation
        .presentGroup(Array.from(metrics), 'runtime-badge')
        .map((token, i) => (
          <MetricBadge key={i} token={token} />
        ))}
    </>
  );
}

export const OUTPUT_TYPE_CLASS: Record<string, string> = {
  segment: 'bg-type-segment/15 text-type-segment border-type-segment/30',
  milestone: 'bg-type-milestone/15 text-type-milestone border-type-milestone/30',
  completion: 'bg-type-completion/15 text-type-completion border-type-completion/30',
  metric: 'bg-type-metric/15 text-type-metric border-type-metric/30',
  system: 'bg-muted/70 text-muted-foreground border-border/50',
  event: 'bg-type-event/15 text-type-event border-type-event/30',
  group: 'bg-type-group/15 text-type-group border-type-group/30',
  load: 'bg-muted/70 text-muted-foreground border-border/50',
  compiler: 'bg-muted/70 text-muted-foreground border-border/50',
  analytics: 'bg-type-analytics/15 text-type-analytics border-type-analytics/30',
};

export const OUTPUT_TYPE_DOT: Record<string, string> = {
  segment: 'bg-type-segment shadow-type-segment/50',
  milestone: 'bg-type-milestone shadow-type-milestone/50',
  completion: 'bg-type-completion shadow-type-completion/50',
  metric: 'bg-type-metric shadow-type-metric/50',
  system: 'bg-muted-foreground/40',
  event: 'bg-type-event shadow-type-event/50',
  group: 'bg-type-group shadow-type-group/50',
  load: 'bg-muted-foreground/40',
  compiler: 'bg-muted-foreground/40',
  analytics: 'bg-type-analytics shadow-type-analytics/50',
};

// ── Metric categorisation (fixed column vocabulary) ──────────────────────────

export interface CategorizedMetrics {
  efforts: IMetric[];
  reps: IMetric[];
  loads: IMetric[];
  rounds: IMetric[];
  durations: IMetric[];
  distances: IMetric[];
  hints: IMetric[];
}

const EFFORT_TYPES = new Set(['effort', 'text', 'action', 'label']);
const LOAD_TYPES = new Set([
  'resistance',
  'intensity',
  'load',
  'volume',
  'work',
  'power',
  'calculated',
  'totalwork',
  'totalvolume',
  'tis',
  'sessionload',
  'session-load',
  'calc.metminutes',
  'metminutes',
  'totalmetminutes',
]);
const ROUND_TYPES = new Set(['rounds', 'current-round', 'increment']);
const DURATION_TYPES = new Set(['duration', 'time', 'elapsed']);
const HINT_TYPES = new Set(['hint', 'custom', 'system', 'sound', 'lap', 'group', 'diagnostic']);

export function extractMetricsByCategory(metrics?: Iterable<IMetric>): CategorizedMetrics {
  const result: CategorizedMetrics = {
    efforts: [],
    reps: [],
    loads: [],
    rounds: [],
    durations: [],
    distances: [],
    hints: [],
  };
  if (!metrics) return result;

  for (const m of metrics) {
    const t = String(m.type).toLowerCase();
    if (EFFORT_TYPES.has(t)) result.efforts.push(m);
    else if (t === 'rep') result.reps.push(m);
    else if (LOAD_TYPES.has(t)) result.loads.push(m);
    else if (ROUND_TYPES.has(t)) result.rounds.push(m);
    else if (DURATION_TYPES.has(t)) result.durations.push(m);
    else if (t === 'distance') result.distances.push(m);
    else if (HINT_TYPES.has(t) || typeof m.value !== 'number') result.hints.push(m);
    else result.loads.push(m);
  }
  return result;
}

// ── Filter presets ───────────────────────────────────────────────────────────

export interface OutputFilterPreset {
  label: string;
  query: string;
}

export type OutputFilterInput = string | OutputFilterPreset;

/** Default row filter — segment statements only (the Workbench default). */
export const DEFAULT_PRIMARY_FILTER = 'type:segment';

export const DEFAULT_OUTPUT_FILTERS: OutputFilterPreset[] = [
  { label: 'All', query: '' },
  { label: 'Segments', query: 'type:segment' },
  { label: 'Events', query: 'type:event' },
];

export function normalizeOutputFilter(filter: OutputFilterInput): OutputFilterPreset {
  if (typeof filter === 'object' && filter !== null && 'label' in filter && 'query' in filter) {
    return filter;
  }
  const str = String(filter).trim();
  const lower = str.toLowerCase();
  if (lower === 'all' || lower === '') {
    return { label: 'All', query: '' };
  }
  if (lower === 'segments' || lower === 'segment' || lower === 'type:segment') {
    return { label: 'Segments', query: 'type:segment' };
  }
  if (lower === 'events' || lower === 'event' || lower === 'type:event') {
    return { label: 'Events', query: 'type:event' };
  }
  if (lower === 'milestones' || lower === 'milestone' || lower === 'type:milestone') {
    return { label: 'Milestones', query: 'type:milestone' };
  }
  return { label: str, query: str };
}

// ── Row shape ────────────────────────────────────────────────────────────────

/** Structural subset satisfied by live `IOutputStatement`s, stored statements,
 *  and `EventRecord` event rows alike. */
export interface OutputStatementRow {
  readonly id?: number | string;
  readonly outputType?: string;
  readonly timeSpan?: { started: number; ended?: number };
  readonly metrics?: Iterable<IMetric>;
  readonly sourceBlockKey?: string;
  readonly completionReason?: string;
}

/** Client-side row filter: `type:<x>` targets the output type, otherwise free
 *  text matches type/block key/completion reason/metric values. Aggregate
 *  queries (`sum:`/`avg:`/`count:`) pass everything through. */
function matchesOutputFilter(out: OutputStatementRow, filter: string): boolean {
  const lower = filter.toLowerCase().trim();
  if (!lower || lower === 'all') return true;
  if (lower.startsWith('sum:') || lower.startsWith('avg:') || lower.startsWith('count:')) {
    return true;
  }

  const outType = String(out.outputType || '').toLowerCase();
  if (lower.startsWith('type:')) {
    return outType.includes(lower.slice(5).trim());
  }

  const typeMatch = outType.includes(lower);
  const keyMatch = out.sourceBlockKey?.toLowerCase().includes(lower);
  const reasonMatch = out.completionReason?.toLowerCase().includes(lower);
  const metricMatch =
    out.metrics &&
    Array.from(out.metrics).some((m: IMetric) => {
      const valStr = typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value ?? '');
      return String(m.type).toLowerCase().includes(lower) || valStr.toLowerCase().includes(lower);
    });
  return Boolean(typeMatch || keyMatch || reasonMatch || metricMatch);
}

// ── Filter pills ─────────────────────────────────────────────────────────────

export function OutputFilterPills({
  presets,
  filter,
  onChange,
}: {
  presets: OutputFilterPreset[];
  filter: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.query)}
          data-testid={`output-filter-preset-${p.label.toLowerCase().replace(/\s+/g, '-')}`}
          className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] cursor-pointer transition-all ${
            filter === p.query || (p.query === '' && filter === '')
              ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
              : 'border-border/70 bg-card text-foreground hover:bg-accent'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── The table (≥ sm) and the Card List (< sm, wayfinder #992/#997) ───────────

export interface OutputStatementsTableProps {
  outputs: readonly OutputStatementRow[];
  /** Filter expression (`type:segment`, free text). Empty shows all. */
  filter?: string;
  /** Epoch ms the +offset column is relative to. Defaults to first statement start. */
  timeOrigin?: number;
  /** Clears the active filter — enables the Card List's Clear-filter
   *  affordance on the filtered-empty state. Optional; hosts without a
   *  clearable filter omit it. */
  onClearFilter?: () => void;
}

/** The Card List — phone presentation below `sm`. One stacked card per output
 *  statement on a type-dot timeline rail: header (type chip + movement badges
 *  | compact `+offset (elapsed)`), category-ordered metric badges, hints row.
 *  Same rows, filter pipeline, and badge components as the table. */
function StatementCards({
  rows,
  outputs,
  t0,
  onClearFilter,
}: {
  rows: readonly OutputStatementRow[];
  outputs: readonly OutputStatementRow[];
  t0: number | undefined;
  onClearFilter?: () => void;
}) {
  if (rows.length === 0) {
    const filtered = outputs.length > 0;
    return (
      <div
        className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center"
        data-testid="output-statements-empty"
      >
        <p className="text-xs text-muted-foreground">
          {filtered
            ? 'No output statements match the current filter.'
            : 'No output statements recorded for this run.'}
        </p>
        {filtered && onClearFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="mt-3 inline-flex cursor-pointer rounded-md border border-border bg-background px-3 py-1 text-[11px] font-semibold text-foreground shadow-xs transition-colors hover:bg-accent"
          >
            Clear filter
          </button>
        )}
      </div>
    );
  }

  return (
    <ol className="flex flex-col" data-testid="output-statements-cards">
      {rows.map((out, idx) => {
        const cats = extractMetricsByCategory(out.metrics);
        const started = out.timeSpan?.started;
        const ended = out.timeSpan?.ended;
        const elapsedStr = ended !== undefined && started !== undefined ? formatMMSS(ended - started) : 'running';
        const offsetStr = started !== undefined && t0 !== undefined ? `+${formatMMSS(started - t0)}` : '+00:00';
        const typeKey = String(out.outputType);
        const hoverInfo = `#${out.id ?? idx + 1} · Block: ${out.sourceBlockKey || 'session'}${
          out.completionReason ? ` · Reason: ${out.completionReason}` : ''
        }`;
        // Category order per the locked Card List anatomy: reps → loads →
        // rounds → durations → distances; movement badges live in the header.
        const bodyMetrics = [...cats.reps, ...cats.loads, ...cats.rounds, ...cats.durations, ...cats.distances];
        const hasBody = bodyMetrics.length > 0;

        return (
          <li key={out.id ?? idx} className="relative pb-3 pl-6 last:pb-0" title={hoverInfo}>
            {idx < rows.length - 1 && (
              <span aria-hidden className="absolute bottom-0 left-[5px] top-5 w-px bg-border/60" />
            )}
            <span
              aria-hidden
              title={`Type: ${out.outputType} | ${hoverInfo}`}
              className={`absolute left-0 top-1.5 size-2.5 rounded-full shadow-md ring-2 ring-background ${
                OUTPUT_TYPE_DOT[typeKey] ?? OUTPUT_TYPE_DOT.system
              }`}
            />
            <article className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
              <header className="flex items-start justify-between gap-2 border-b border-border/40 pb-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <span
                    className={`inline-block shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                      OUTPUT_TYPE_CLASS[typeKey] ?? OUTPUT_TYPE_CLASS.system
                    }`}
                  >
                    {String(out.outputType ?? 'system').slice(0, 4)}
                  </span>
                  {presentBadges(cats.efforts)}
                </div>
                <div className="whitespace-nowrap text-right font-mono text-[11px] tabular-nums leading-tight">
                  <span className="font-bold text-primary">{offsetStr}</span>{' '}
                  <span className="text-[10px] text-muted-foreground/80">({elapsedStr})</span>
                </div>
              </header>
              {hasBody && (
                <div className="flex flex-wrap gap-1 pt-1.5">{presentBadges(bodyMetrics)}</div>
              )}
              {cats.hints.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border/30 pt-1.5">
                  {presentBadges(cats.hints)}
                </div>
              )}
              {!hasBody && cats.hints.length === 0 && (
                <p className="pt-1.5 text-[11px] text-muted-foreground/60">No metrics on this statement</p>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

/** The Session Results surface — Card List below `sm`, the 9-column table at
 *  `sm` and above. One component: same props, same filtering; hosts (analytics
 *  explorer, editor query blocks, workbench) inherit the phone path. */
export function OutputStatementsTable({
  outputs,
  filter = '',
  timeOrigin,
  onClearFilter,
}: OutputStatementsTableProps) {
  const t0 = timeOrigin ?? (outputs.length > 0 ? outputs[0].timeSpan?.started : undefined);

  const rows = useMemo(() => {
    if (!filter.trim()) return outputs;
    return outputs.filter((out) => matchesOutputFilter(out, filter));
  }, [outputs, filter]);

  return (
    <>
      {/* Phone: Card List below sm (wayfinder #992/#997) */}
      <div className="sm:hidden">
        <StatementCards rows={rows} outputs={outputs} t0={t0} onClearFilter={onClearFilter} />
      </div>
      {/* sm and up: the 9-column table */}
      <div className="hidden overflow-x-auto rounded-md border border-border/50 bg-background/40 sm:block">
        <table className="w-full text-left font-mono text-xs border-collapse" data-testid="output-statements-table">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">
              <th className="p-2 w-12 text-center">Type</th>
              <th className="p-2 min-w-[110px]">Time</th>
              <th className="p-2 font-sans min-w-[140px]">🏃 Movement</th>
              <th className="p-2 font-sans min-w-[60px]">🔢 Reps</th>
              <th className="p-2 font-sans min-w-[70px]">💪 Load</th>
              <th className="p-2 font-sans min-w-[80px]">🔄 Rounds</th>
              <th className="p-2 font-sans min-w-[70px]">⏱️ Target</th>
              <th className="p-2 font-sans min-w-[70px]">📏 Distance</th>
              <th className="p-2 font-sans min-w-[110px]">🏷️ Hints</th>
            </tr>
          </thead>
        <tbody className="divide-y divide-border/40">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-8 text-center text-muted-foreground font-sans text-xs">
                {outputs.length === 0
                  ? 'No output statements recorded for this run.'
                  : 'No output statements match the current filter.'}
              </td>
            </tr>
          ) : (
            rows.map((out, idx) => {
              const cats = extractMetricsByCategory(out.metrics);
              const started = out.timeSpan?.started;
              const ended = out.timeSpan?.ended;
              const elapsedStr = ended !== undefined && started !== undefined ? formatMMSS(ended - started) : 'running';
              const wallTimeStr = formatClockTime(new Date(ended ?? started ?? 0));
              const offsetStr = started !== undefined && t0 !== undefined ? `+${formatMMSS(started - t0)}` : '+00:00';
              const hoverInfo = `#${out.id ?? idx + 1} · Block: ${out.sourceBlockKey || 'session'}${
                out.completionReason ? ` · Reason: ${out.completionReason}` : ''
              }`;

              const badgeCell = (badges: IMetric[]) => (
                <td className="p-2 font-sans">
                  {badges.length > 0 ? (
                    <div className="flex flex-wrap gap-1">{presentBadges(badges)}</div>
                  ) : (
                    <span className="text-muted-foreground/30 font-mono text-[11px] select-none">—</span>
                  )}
                </td>
              );

              return (
                <tr
                  key={out.id ?? idx}
                  title={hoverInfo}
                  className="hover:bg-muted/30 transition-colors group cursor-default"
                >
                  {/* 1. Type (minimal size, first column) */}
                  <td className="p-2 text-center whitespace-nowrap">
                    <span
                      className={`inline-block rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                        OUTPUT_TYPE_CLASS[String(out.outputType)] ?? OUTPUT_TYPE_CLASS.system
                      }`}
                      title={`Type: ${out.outputType} | ${hoverInfo}`}
                    >
                      {String(out.outputType ?? 'system').slice(0, 4)}
                    </span>
                  </td>

                  {/* 2. Consolidated time (line 1: offset & elapsed, line 2: wall time) */}
                  <td className="p-2 whitespace-nowrap leading-tight">
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="font-bold text-primary tabular-nums">{offsetStr}</span>
                      <span className="text-[10px] text-muted-foreground/80 tabular-nums">({elapsedStr})</span>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                      {wallTimeStr}
                    </div>
                  </td>

                  {/* 3. Movement */}
                  {badgeCell(cats.efforts)}
                  {/* 4. Reps */}
                  {badgeCell(cats.reps)}
                  {/* 5. Load */}
                  {badgeCell(cats.loads)}
                  {/* 6. Rounds */}
                  {badgeCell(cats.rounds)}
                  {/* 7. Target (durations) */}
                  {badgeCell(cats.durations)}
                  {/* 8. Distance */}
                  {badgeCell(cats.distances)}
                  {/* 9. Hints */}
                  {badgeCell(cats.hints)}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>
    </>
  );
}
