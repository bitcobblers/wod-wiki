import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { IMetric } from '@bitcobblers/wod-wiki-core';
import {
  computeColumnLabel,
  metricPresentation,
  type MetricPresentationToken,
} from '@bitcobblers/wod-wiki-lang';
import { PRBadge } from './PRBadge';

// ── Time formatting ──────────────────────────────────────────────────────────

export function formatMMSS(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatOffsetMMSS(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) return '+00:00';
  if (deltaMs < 0) {
    const absSec = Math.floor(-deltaMs / 1000);
    if (absSec === 0) return '+00:00';
    return `-${formatMMSS(-deltaMs)}`;
  }
  return `+${formatMMSS(deltaMs)}`;
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
  const accessibleLabel = token.columnLabel ? `${token.columnLabel}: ${token.label}` : token.label;
  if (token.renderKind === 'comment') {
    return (
      <span
        className="text-[10px] italic text-muted-foreground"
        title={token.tooltip}
        aria-label={accessibleLabel}
      >
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
      aria-label={accessibleLabel}
    >
      {token.label}
    </span>
  );
}

function formatDecimalPace(minutesPerUnit: number, unit: string): string {
  const totalSec = Math.max(0, Math.round(minutesPerUnit * 60));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const suffix = unit.toLowerCase().includes('km') ? '/km' : '/mi';
  return `${mins}:${String(secs).padStart(2, '0')} ${suffix}`;
}

const CANONICAL_METRIC_UNITS: Record<string, string> = {
  metminutes: 'MET-min',
  'calc.metminutes': 'MET-min',
  sessionload: 'AU',
  'calc.sessionload': 'AU',
  tis: 'pts',
  'calc.tis': 'pts',
  totalvolume: 'kg',
  'calc.totalvolume': 'kg',
  totalwork: 'kg',
  'calc.totalwork': 'kg',
  reps: 'reps',
  totalreps: 'reps',
  'calc.totalreps': 'reps',
};

function inferCanonicalUnit(m: IMetric): string | undefined {
  if (typeof m.unit === 'string' && m.unit.trim().length > 0) return m.unit;
  const meta = m.metadata as Record<string, unknown> | undefined;
  const candidates = [
    typeof meta?.canonicalKey === 'string' ? meta.canonicalKey : '',
    typeof meta?.originalKey === 'string' ? meta.originalKey : '',
    String(m.type ?? ''),
  ];
  for (const raw of candidates) {
    const key = raw.trim().toLowerCase();
    if (key && CANONICAL_METRIC_UNITS[key]) return CANONICAL_METRIC_UNITS[key];
  }
  return undefined;
}

function isMetMinutesMetric(m: IMetric): boolean {
  const unitLower = String(m.unit ?? '').trim().toLowerCase();
  if (unitLower === 'met-min') return true;
  const typeLower = String(m.type ?? '').trim().toLowerCase();
  if (typeLower.includes('metminute')) return true;
  const meta = m.metadata as Record<string, unknown> | undefined;
  const ck = String(meta?.canonicalKey ?? meta?.originalKey ?? '').trim().toLowerCase();
  return ck.includes('metminute');
}

const INTERNAL_AUX_METRIC_TYPES = new Set(['metminutesestimated', 'rpeestimated']);

function isInternalAuxMetric(m: IMetric): boolean {
  return INTERNAL_AUX_METRIC_TYPES.has(String(m.type ?? '').trim().toLowerCase());
}

function sanitizeMetricForDisplay(m: IMetric): IMetric {
  if (typeof m.value !== 'number' || !Number.isFinite(m.value) || m.image !== undefined) return m;
  const typeLower = String(m.type ?? '').toLowerCase();
  const inferredUnit = inferCanonicalUnit(m);
  const unitLower = String(inferredUnit ?? '').trim().toLowerCase();
  if (typeLower === 'pace' && (unitLower === 'min/km' || unitLower === 'min/mi')) {
    const formatted = formatDecimalPace(m.value, unitLower);
    return { ...m, ...(inferredUnit ? { unit: inferredUnit } : {}), image: formatted };
  }
  const rounded = Math.round(m.value * 100) / 100;
  // Format numeric metrics carrying an explicit or canonical unit so Raw Events
  // & Analytics summary cells never render bare unitless numbers (WW-092).
  const skipUnitImage =
    typeLower === 'duration' ||
    typeLower === 'time' ||
    typeLower === 'elapsed' ||
    typeLower === 'rounds' ||
    typeLower === 'current-round' ||
    typeLower === 'rep';
  const formattedImage =
    inferredUnit && !skipUnitImage
      ? `${rounded} ${inferredUnit}`
      : undefined;
  if (rounded === m.value && inferredUnit === m.unit && formattedImage === undefined) return m;
  return {
    ...m,
    value: rounded,
    ...(inferredUnit && !m.unit ? { unit: inferredUnit } : {}),
    ...(formattedImage ? { image: formattedImage } : {}),
  };
}

/** Metric badges for a statement/output metric group. */
export function presentBadges(metrics: Iterable<IMetric>): ReactNode {
  const tokens = metricPresentation.presentGroup(
    Array.from(metrics, sanitizeMetricForDisplay),
    'runtime-badge',
  );
  return (
    <>
      {tokens.map((token, i) => (
        <Fragment key={i}>
          {i > 0 ? ' ' : null}
          <MetricBadge token={token} />
        </Fragment>
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

const OUTPUT_TYPE_LABEL: Record<string, string> = {
  segment: 'Segment',
  milestone: 'Milestone',
  completion: 'Complete',
  metric: 'Metric',
  system: 'System',
  event: 'Event',
  group: 'Group',
  load: 'Load',
  compiler: 'Compiler',
  analytics: 'Analytics',
};

function formatOutputTypeLabel(outputType: unknown): string {
  const raw = String(outputType ?? 'system').trim().toLowerCase();
  if (!raw) return 'System';
  return OUTPUT_TYPE_LABEL[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

const ACRONYMS: Record<string, string> = {
  c2b: 'C2B',
  t2b: 'T2B',
  ghd: 'GHD',
  hspu: 'HSPU',
  amrap: 'AMRAP',
  emom: 'EMOM',
  rft: 'RFT',
};

function humanizeSlug(slug: string): string {
  return slug
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return ACRONYMS[lower] ?? word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

const GENERIC_LABELS = new Set(['segment', 'statement', 'completed', 'system']);

/** Resolve a human-readable movement/block/event name for an output row (WW-092). */
export function resolveOutputRowLabel(out: OutputStatementRow): string {
  const explicitLabel = out.label?.trim();
  if (explicitLabel && !GENERIC_LABELS.has(explicitLabel.toLowerCase())) {
    return explicitLabel;
  }

  const all = out.metrics ? Array.from(out.metrics) : [];
  for (const m of all) {
    const t = String(m.type ?? '').toLowerCase();
    if (t === 'effort' || t === 'action' || t === 'label' || t === 'text') {
      const rawText =
        (typeof m.image === 'string' && m.image.trim()) ||
        (typeof m.value === 'string' && m.value.trim()) ||
        '';
      if (!rawText) continue;
      const lower = rawText.toLowerCase();
      if (lower === 'ready to start') return 'Start';
      if (lower === 'session' || lower === 'session completed') return 'Session';
      if (!GENERIC_LABELS.has(lower)) return rawText;
    }
  }

  if (out.effortSlug && out.effortSlug.trim()) {
    return humanizeSlug(out.effortSlug);
  }

  const rawStatement = (out.statement ?? out.text ?? '').trim();
  if (rawStatement) {
    const firstLine = rawStatement.split('\n')[0]?.trim() ?? '';
    if (firstLine && !GENERIC_LABELS.has(firstLine.toLowerCase())) {
      return firstLine;
    }
  }

  for (const m of all) {
    const t = String(m.type ?? '').toLowerCase();
    if (t === 'current-round' || t === 'rounds') {
      const img = typeof m.image === 'string' ? m.image.trim() : '';
      if (/^completed\b/i.test(img)) return img;
      const n = typeof m.value === 'number' ? m.value : Number(m.value);
      if (Number.isFinite(n) && n > 0) {
        return t === 'current-round' ? `Round ${n}` : `${n} ${n === 1 ? 'Round' : 'Rounds'}`;
      }
    }
  }

  const blockKey = String(out.sourceBlockKey ?? '').trim().toLowerCase();
  if (blockKey.startsWith('waiting-to-start')) return 'Start';
  if (blockKey.startsWith('session-root') || blockKey === 'root') return 'Session';
  if (blockKey.startsWith('rest')) return 'Rest';
  const roundMatch = /^round[-_:\s]*(\d+)/i.exec(blockKey);
  if (roundMatch) return `Round ${roundMatch[1]}`;
  if (blockKey.startsWith('rounds')) return 'Rounds';

  if (String(out.outputType ?? '').toLowerCase() === 'event') {
    for (const m of all) {
      if (String(m.type ?? '').toLowerCase() === 'system') {
        const rawEvt =
          (typeof m.image === 'string' && m.image.trim()) ||
          (typeof m.value === 'string' && m.value.trim()) ||
          (typeof m.value === 'object' && m.value !== null && 'name' in m.value && typeof (m.value as { name?: unknown }).name === 'string'
            ? (m.value as { name: string }).name
            : '');
        const cleaned = rawEvt.replace(/^event:\s*/i, '').trim();
        if (cleaned) {
          if (cleaned.toLowerCase() === 'abort') return 'Stop';
          return humanizeSlug(cleaned);
        }
      }
    }
  }

  if (String(out.outputType ?? '').toLowerCase() === 'analytics' && all.length > 0) {
    const first = all[0]!;
    const meta = first.metadata as Record<string, unknown> | undefined;
    const summaryName =
      (typeof meta?.originalKey === 'string' && meta.originalKey) ||
      (typeof meta?.canonicalKey === 'string' && meta.canonicalKey) ||
      String(first.type ?? '');
    if (summaryName) return computeColumnLabel(summaryName);
  }

  if (String(out.outputType ?? '').toLowerCase() === 'segment') {
    const hasDuration = all.some((m) => {
      const t = String(m.type ?? '').toLowerCase();
      return t === 'duration' || t === 'time';
    });
    if (hasDuration) return blockKey.includes('amrap') ? 'AMRAP' : blockKey.includes('emom') ? 'EMOM' : 'Timer';
  }

  return formatOutputTypeLabel(out.outputType);
}

/** Resolve the Type column badge text so structural/lifecycle rows are not homogenized as 'Segment'. */
export function resolveOutputTypeBadgeLabel(out: OutputStatementRow): string {
  const rawType = String(out.outputType ?? 'system').trim().toLowerCase();
  if (rawType !== 'segment') return formatOutputTypeLabel(out.outputType);

  const blockKey = String(out.sourceBlockKey ?? '').trim().toLowerCase();
  if (blockKey.startsWith('waiting-to-start')) return 'Start';
  if (blockKey.startsWith('session-root') || blockKey === 'root') return 'Session';
  if (blockKey.startsWith('rest')) return 'Rest';

  const all = out.metrics ? Array.from(out.metrics) : [];
  const hasEffort =
    Boolean(out.effortSlug) ||
    all.some((m) => String(m.type ?? '').toLowerCase() === 'effort');
  if (!hasEffort) {
    const hasRoundMetric = all.some((m) => {
      const t = String(m.type ?? '').toLowerCase();
      return t === 'rounds' || t === 'current-round';
    });
    if (hasRoundMetric || blockKey.startsWith('round')) return 'Rounds';
    const hasDuration = all.some((m) => {
      const t = String(m.type ?? '').toLowerCase();
      return t === 'duration' || t === 'time';
    });
    if (hasDuration) return 'Timer';
  }
  return 'Segment';
}

function formatOutputRowTitle(out: OutputStatementRow, elapsedStr: string): string {
  const label = resolveOutputRowLabel(out);
  return elapsedStr ? `${label} (${elapsedStr})` : label;
}

/** Resolve a consistent time origin across outputs; ignore completion timestamps that post-date all rows (WW-092). */
export function resolveTimeOrigin(
  outputs: readonly OutputStatementRow[],
  timeOrigin?: number,
): number | undefined {
  let minStarted: number | undefined;
  let maxStarted: number | undefined;
  for (const o of outputs) {
    const s = o.timeSpan?.started;
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    minStarted = minStarted === undefined ? s : Math.min(minStarted, s);
    maxStarted = maxStarted === undefined ? s : Math.max(maxStarted, s);
  }
  if (typeof timeOrigin === 'number' && Number.isFinite(timeOrigin)) {
    if (minStarted !== undefined && timeOrigin > minStarted && (maxStarted === undefined || timeOrigin >= maxStarted)) {
      return minStarted;
    }
    return timeOrigin;
  }
  return minStarted;
}

function metricDurationToMs(m: IMetric): number | undefined {
  const rawVal = typeof m.value === 'number' ? m.value : Number(m.value);
  if (!Number.isFinite(rawVal) || rawVal <= 0) return undefined;
  const unit =
    'unit' in m && typeof (m as { unit?: unknown }).unit === 'string'
      ? (m as { unit: string }).unit.trim().toLowerCase()
      : '';
  if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
    return rawVal * 1000;
  }
  if (unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
    return rawVal * 60_000;
  }
  return rawVal;
}

/** Resolve row duration in ms, falling back to an explicit positive elapsed/duration metric when timeSpan is zero-width. */
export function resolveRowDurationMs(out: OutputStatementRow): number | undefined {
  const started = out.timeSpan?.started;
  const ended = out.timeSpan?.ended;
  if (started !== undefined && ended !== undefined && ended > started) {
    return ended - started;
  }
  if (out.metrics) {
    for (const m of out.metrics) {
      const t = String(m.type ?? '').toLowerCase();
      if (t === 'elapsed' || t === 'duration') {
        const ms = metricDurationToMs(m);
        if (ms !== undefined && ms > 0) return ms;
      }
    }
  }
  if (started !== undefined && ended !== undefined) {
    return Math.max(0, ended - started);
  }
  return undefined;
}

// ── Metric categorisation (base column vocabulary + dynamic custom discovery) ─

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
// External resistance/load only — derived work/energy/analytics metrics (e.g.
// MET-min, totalVolume, sessionLoad, tis) belong in their own dynamic columns,
// never concatenated into the Load column (WW-092).
const LOAD_TYPES = new Set(['resistance', 'intensity', 'load']);
const ROUND_TYPES = new Set(['rounds', 'current-round', 'increment']);
// Target column carries prescribed duration/time only; actual `elapsed` already
// lives in the Time column (WW-092).
const DURATION_TYPES = new Set(['duration', 'time']);
const TIME_ONLY_TYPES = new Set(['elapsed']);
const HINT_TYPES = new Set(['hint', 'custom', 'system', 'sound', 'lap', 'group', 'diagnostic']);

function isBaseBucketType(lowerType: string): boolean {
  return (
    EFFORT_TYPES.has(lowerType) ||
    lowerType === 'rep' ||
    lowerType === 'reps' ||
    LOAD_TYPES.has(lowerType) ||
    ROUND_TYPES.has(lowerType) ||
    DURATION_TYPES.has(lowerType) ||
    TIME_ONLY_TYPES.has(lowerType) ||
    lowerType === 'distance' ||
    HINT_TYPES.has(lowerType)
  );
}

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
    else if (t === 'rep' || t === 'reps') result.reps.push(m);
    else if (LOAD_TYPES.has(t)) result.loads.push(m);
    else if (ROUND_TYPES.has(t)) result.rounds.push(m);
    else if (DURATION_TYPES.has(t)) result.durations.push(m);
    else if (t === 'distance') result.distances.push(m);
    else if (HINT_TYPES.has(t) || typeof m.value !== 'number') result.hints.push(m);
    else result.loads.push(m);
  }
  if (result.efforts.length === 0 && metrics) {
    const first = Array.from(metrics)[0];
    const meta = first?.metadata as Record<string, unknown> | undefined;
    const summaryName =
      (typeof meta?.originalKey === 'string' && meta.originalKey) ||
      (typeof meta?.canonicalKey === 'string' && meta.canonicalKey);
    if (summaryName && first) {
      const displayLabel = computeColumnLabel(summaryName);
      result.efforts.push({ type: 'label' as IMetric['type'], value: displayLabel, image: displayLabel, origin: first.origin });
    }
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

// ── Row, Sort, PR, and Inline-Edit Shapes ────────────────────────────────────

/** Structural subset satisfied by live `IOutputStatement`s, stored statements,
 *  and `EventRecord` event rows alike. */
export interface OutputStatementRow {
  readonly id?: number | string;
  readonly grain?: string;
  readonly outputType?: string;
  readonly effortSlug?: string;
  readonly label?: string;
  readonly statement?: string;
  readonly text?: string;
  readonly timeSpan?: { started: number; ended?: number };
  readonly metrics?: Iterable<IMetric>;
  readonly sourceBlockKey?: string;
  readonly sourceStatementId?: number;
  readonly stackLevel?: number;
  readonly completionReason?: string;
}

export interface SessionTableSortSpec {
  col: string;
  dir: 'asc' | 'desc';
}

export interface InlineMetricEditPayload {
  occurrence: {
    blockKey: string;
    sourceStatementId?: number;
    stackLevel?: number;
  };
  metric: {
    type: string;
    value: number;
    image: string;
  };
}

export interface RowPrHighlight {
  label?: string;
  improvement?: number;
  unit?: string;
}

function lookupPrHighlight(
  out: OutputStatementRow,
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>,
): RowPrHighlight | undefined {
  if (!prHighlights) return undefined;
  const get = (key: string | number | undefined): RowPrHighlight | undefined => {
    if (key === undefined || key === '') return undefined;
    if (prHighlights instanceof Map) {
      return (prHighlights as ReadonlyMap<string | number, RowPrHighlight>).get(key) ??
        (prHighlights as ReadonlyMap<string | number, RowPrHighlight>).get(String(key));
    }
    return (prHighlights as Record<string, RowPrHighlight>)[String(key)];
  };
  return get(out.id) ?? get(out.sourceBlockKey);
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
    const wanted = lower.slice(5).trim();
    if (wanted === 'segment' && outType === 'analytics') return true;
    return outType.includes(wanted);
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

// ── Dynamic Column Model ─────────────────────────────────────────────────────

type BuiltinColKind =
  | 'type'
  | 'time'
  | 'effort'
  | 'reps'
  | 'loads'
  | 'rounds'
  | 'durations'
  | 'distances'
  | 'summary'
  | 'hints'
  | 'metric';

interface SessionColumnDef {
  id: string;
  kind: BuiltinColKind;
  header: string;
  className: string;
  /** Exact metric type (lowercased) when `kind === 'metric'`. */
  metricTypeLower?: string;
  /** Default metric type written on inline edit. */
  editableType?: string;
}

const BASE_COLUMNS: readonly SessionColumnDef[] = [
  { id: 'type', kind: 'type', header: 'Type', className: 'p-2 w-12 text-center' },
  { id: 'time', kind: 'time', header: 'Time', className: 'p-2 min-w-[110px]' },
  { id: 'effort', kind: 'effort', header: '🏃 Movement', className: 'p-2 font-sans min-w-[140px]' },
  { id: 'reps', kind: 'reps', header: '🔢 Reps', className: 'p-2 font-sans min-w-[60px]', editableType: 'rep' },
  { id: 'loads', kind: 'loads', header: '💪 Load', className: 'p-2 font-sans min-w-[70px]', editableType: 'resistance' },
  { id: 'rounds', kind: 'rounds', header: '🔄 Rounds', className: 'p-2 font-sans min-w-[80px]' },
  { id: 'durations', kind: 'durations', header: '⏱️ Target', className: 'p-2 font-sans min-w-[70px]', editableType: 'duration' },
  { id: 'distances', kind: 'distances', header: '📏 Distance', className: 'p-2 font-sans min-w-[70px]', editableType: 'distance' },
  { id: 'hints', kind: 'hints', header: '🏷️ Hints', className: 'p-2 font-sans min-w-[110px]' },
];

const COLUMN_ALIAS_MAP: Record<string, string> = {
  type: 'type',
  time: 'time',
  elapsed: 'time',
  effort: 'effort',
  efforts: 'effort',
  movement: 'effort',
  exercise: 'effort',
  rep: 'reps',
  reps: 'reps',
  load: 'loads',
  loads: 'loads',
  weight: 'loads',
  resistance: 'loads',
  round: 'rounds',
  rounds: 'rounds',
  duration: 'durations',
  durations: 'durations',
  target: 'durations',
  distance: 'distances',
  distances: 'distances',
  hint: 'hints',
  hints: 'hints',
};

function makeCustomMetricColumn(rawType: string): SessionColumnDef {
  return {
    id: rawType,
    kind: 'metric',
    header: computeColumnLabel(rawType),
    className: 'p-2 font-sans min-w-[72px]',
    metricTypeLower: rawType.toLowerCase(),
    editableType: rawType,
  };
}

function buildActiveColumns(
  outputs: readonly OutputStatementRow[],
  explicitColumns?: readonly string[],
): SessionColumnDef[] {
  if (explicitColumns && explicitColumns.length > 0) {
    const out: SessionColumnDef[] = [];
    const seen = new Set<string>();
    for (const rawCol of explicitColumns) {
      const trimmed = rawCol.trim();
      if (!trimmed) continue;
      const mappedId = COLUMN_ALIAS_MAP[trimmed.toLowerCase()];
      const base = mappedId ? BASE_COLUMNS.find((c) => c.id === mappedId) : undefined;
      const col = base ?? makeCustomMetricColumn(trimmed);
      if (seen.has(col.id.toLowerCase())) continue;
      seen.add(col.id.toLowerCase());
      out.push(col);
    }
    return out.length > 0 ? out : [...BASE_COLUMNS];
  }

  // Discover any custom / Property Note / #tag numeric metrics on non-analytics
  // rows not covered by the 9 built-in buckets (e.g. pace, rpe, power, metMinutes).
  // Analytics summary rows use a single consolidated Summary column instead of
  // spawning 1-row sparse columns across the whole event table (WW-092).
  const dynamicCols: SessionColumnDef[] = [];
  const seenDynamic = new Set<string>();
  let hasAnalyticsRows = false;
  for (const row of outputs) {
    if (!row.metrics) continue;
    if (String(row.outputType ?? '').toLowerCase() === 'analytics') {
      hasAnalyticsRows = true;
      continue;
    }
    for (const m of row.metrics) {
      if (isInternalAuxMetric(m)) continue;
      if (isMetMinutesMetric(m)) {
        if (!seenDynamic.has('metminutes')) {
          seenDynamic.add('metminutes');
          dynamicCols.push({
            id: 'metMinutes',
            kind: 'metric',
            header: 'MET-min',
            className: 'p-2 font-sans min-w-[78px]',
            metricTypeLower: 'metminutes',
          });
        }
        continue;
      }
      const rawType = String(m.type ?? '').trim();
      if (!rawType) continue;
      const lower = rawType.toLowerCase();
      if (isBaseBucketType(lower) || seenDynamic.has(lower)) continue;
      if (typeof m.value === 'number' && Number.isFinite(m.value)) {
        seenDynamic.add(lower);
        dynamicCols.push(makeCustomMetricColumn(rawType));
      }
    }
  }

  const summaryCols: SessionColumnDef[] = hasAnalyticsRows
    ? [{ id: 'summary', kind: 'summary', header: 'Summary', className: 'p-2 font-sans min-w-[96px]' }]
    : [];

  if (dynamicCols.length === 0 && summaryCols.length === 0) return [...BASE_COLUMNS];
  return [
    ...BASE_COLUMNS.slice(0, BASE_COLUMNS.length - 1),
    ...summaryCols,
    ...dynamicCols,
    BASE_COLUMNS[BASE_COLUMNS.length - 1]!,
  ];
}

function extractMetricsForColumn(
  out: OutputStatementRow,
  col: SessionColumnDef,
  dynamicLowerTypes: ReadonlySet<string>,
): IMetric[] {
  const all = out.metrics ? Array.from(out.metrics).filter((m) => !isInternalAuxMetric(m)) : [];
  const isAnalyticsRow = String(out.outputType ?? '').toLowerCase() === 'analytics';
  if (col.kind === 'summary') {
    if (!isAnalyticsRow) return [];
    return all.filter((m) => typeof m.value === 'number' && Number.isFinite(m.value));
  }
  if (col.kind === 'metric' && col.metricTypeLower) {
    if (isAnalyticsRow) return [];
    if (col.metricTypeLower === 'metminutes') {
      return all.filter((m) => isMetMinutesMetric(m));
    }
    const matched = all.filter(
      (m) => !isMetMinutesMetric(m) && String(m.type).toLowerCase() === col.metricTypeLower,
    );
    // Avoid concatenating both speed (m/s) and pace (min/km) in the same Pace cell (WW-092).
    if (col.metricTypeLower === 'pace' && matched.length > 1) {
      const preferred = matched.filter((m) => {
        const u = String(m.unit ?? '').trim().toLowerCase();
        return u === 'min/km' || u === 'min/mi';
      });
      if (preferred.length > 0) return [preferred[0]!];
    }
    return matched;
  }
  switch (col.kind) {
    case 'effort': {
      const explicitEfforts = all.filter((m) => EFFORT_TYPES.has(String(m.type).toLowerCase()));
      if (explicitEfforts.length > 0) return explicitEfforts;
      const resolved = resolveOutputRowLabel(out);
      const genericType = formatOutputTypeLabel(out.outputType);
      if (resolved && resolved !== genericType) {
        const origin = all[0]?.origin ?? 'runtime';
        return [{ type: 'label' as IMetric['type'], value: resolved, image: resolved, origin }];
      }
      return [];
    }
    case 'reps':
      if (isAnalyticsRow) return [];
      return all.filter((m) => {
        const t = String(m.type).toLowerCase();
        return t === 'rep' || t === 'reps';
      });
    case 'loads':
      if (isAnalyticsRow) return [];
      return all.filter((m) => {
        if (isMetMinutesMetric(m)) return false;
        const t = String(m.type).toLowerCase();
        if (dynamicLowerTypes.has(t)) return false;
        if (LOAD_TYPES.has(t)) return true;
        return !isBaseBucketType(t) && typeof m.value === 'number';
      });
    case 'rounds':
      if (isAnalyticsRow) return [];
      return all.filter((m) => ROUND_TYPES.has(String(m.type).toLowerCase()));
    case 'durations':
      if (isAnalyticsRow) return [];
      return all.filter((m) => DURATION_TYPES.has(String(m.type).toLowerCase()));
    case 'distances':
      if (isAnalyticsRow) return [];
      return all.filter((m) => String(m.type).toLowerCase() === 'distance');
    case 'hints':
      if (isAnalyticsRow) return [];
      return all.filter((m) => {
        const t = String(m.type).toLowerCase();
        return HINT_TYPES.has(t) || (!isBaseBucketType(t) && typeof m.value !== 'number');
      });
    default:
      return [];
  }
}

function resolveSortColumn(
  rawCol: string,
  columns: readonly SessionColumnDef[],
): SessionColumnDef | undefined {
  const lower = rawCol.trim().toLowerCase();
  const alias = COLUMN_ALIAS_MAP[lower];
  return (
    columns.find((c) => c.id.toLowerCase() === lower) ??
    (alias ? columns.find((c) => c.id === alias) : undefined) ??
    makeCustomMetricColumn(rawCol)
  );
}

function extractSortComparable(
  out: OutputStatementRow,
  col: SessionColumnDef,
  dynamicLowerTypes: ReadonlySet<string>,
): number | string | undefined {
  if (col.kind === 'type') return String(out.outputType ?? '');
  if (col.kind === 'time') {
    if (out.timeSpan?.started !== undefined && out.timeSpan?.ended !== undefined) {
      return out.timeSpan.ended - out.timeSpan.started;
    }
    return out.timeSpan?.started;
  }
  const list = extractMetricsForColumn(out, col, dynamicLowerTypes);
  if (list.length === 0) return undefined;
  // Prefer user-origin override when multiple metrics share a cell.
  const preferred = list.find((m) => m.origin === 'user') ?? list[0]!;
  if (typeof preferred.value === 'number' && Number.isFinite(preferred.value)) {
    return preferred.value;
  }
  return preferred.image ?? String(preferred.value ?? '');
}

function compareRowsBySpecs(
  a: OutputStatementRow,
  b: OutputStatementRow,
  specs: readonly SessionTableSortSpec[],
  columns: readonly SessionColumnDef[],
  dynamicLowerTypes: ReadonlySet<string>,
): number {
  for (const spec of specs) {
    const col = resolveSortColumn(spec.col, columns);
    if (!col) continue;
    const va = extractSortComparable(a, col, dynamicLowerTypes);
    const vb = extractSortComparable(b, col, dynamicLowerTypes);
    if (va === undefined && vb === undefined) continue;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    if (cmp !== 0) return spec.dir === 'desc' ? -cmp : cmp;
  }
  return 0;
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
          type="button"
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
  /** Clears the active filter — enables the Card List's Clear-filter affordance. */
  onClearFilter?: () => void;
  /** Optional explicit column whitelist & order (from YAML `columns: [...]`). */
  columns?: readonly string[];
  /** Initial or controlled sort order (from YAML `sort: [...]`). */
  sort?: readonly SessionTableSortSpec[];
  /** Notifies host when user clicks column headers to re-sort. */
  onSortChange?: (next: SessionTableSortSpec[]) => void;
  /** Optional maximum rows to display after filtering and sorting. */
  limit?: number;
  /** Optional inline actuals editor callback (`captureMetricCorrection`). */
  onEditMetric?: (payload: InlineMetricEditPayload) => void | Promise<void>;
  /** Optional PR highlights keyed by row `id` or `sourceBlockKey`. */
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>;
}

interface StatementEditDraft {
  rowKey: string;
  colId: string;
  metricType: string;
  unit?: string;
  draft: string;
  error?: string;
  saving?: boolean;
}

/** The Card List — phone presentation below `sm`. */
function StatementCards({
  rows,
  outputs,
  t0,
  onClearFilter,
  prHighlights,
  canEdit,
  editingCell,
  onStartEdit,
  onChangeDraft,
  onCancelEdit,
  onCommitEdit,
}: {
  rows: readonly OutputStatementRow[];
  outputs: readonly OutputStatementRow[];
  t0: number | undefined;
  onClearFilter?: () => void;
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>;
  canEdit?: boolean;
  editingCell?: StatementEditDraft | null;
  onStartEdit?: (out: OutputStatementRow, rowKey: string, metricType: string, defaultVal?: number | string, unit?: string) => void;
  onChangeDraft?: (draft: string) => void;
  onCancelEdit?: () => void;
  onCommitEdit?: (out: OutputStatementRow) => void | Promise<void>;
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
        if (cats.efforts.length === 0) {
          const resolved = resolveOutputRowLabel(out);
          const genericType = formatOutputTypeLabel(out.outputType);
          if (resolved && resolved !== genericType) {
            cats.efforts.push({ type: 'label' as IMetric['type'], value: resolved, image: resolved, origin: 'runtime' });
          }
        }
        const started = out.timeSpan?.started;
        const durationMs = resolveRowDurationMs(out);
        const elapsedStr = durationMs !== undefined ? formatMMSS(durationMs) : 'running';
        const offsetStr = started !== undefined && t0 !== undefined ? formatOffsetMMSS(started - t0) : '+00:00';
        const typeKey = String(out.outputType);
        const typeLabel = resolveOutputTypeBadgeLabel(out);
        const rowTitle = formatOutputRowTitle(out, elapsedStr);
        const pr = lookupPrHighlight(out, prHighlights);
        const bodyMetrics = [...cats.reps, ...cats.loads, ...cats.rounds, ...cats.durations, ...cats.distances];
        const hasBody = bodyMetrics.length > 0;
        const rowKey = String(out.id ?? `${out.sourceBlockKey ?? 'row'}-${idx}`);
        const rowEditable = Boolean(canEdit && typeKey.toLowerCase() === 'segment' && out.sourceBlockKey);
        const isEditingThis = editingCell?.rowKey === rowKey;
        const repMetric = cats.reps[0];
        const repUnit =
          repMetric && 'unit' in repMetric && typeof (repMetric as { unit?: unknown }).unit === 'string'
            ? (repMetric as { unit: string }).unit
            : undefined;

        return (
          <li key={rowKey} className="relative pb-3 pl-6 last:pb-0" title={rowTitle}>
            {idx < rows.length - 1 && (
              <span aria-hidden className="absolute bottom-0 left-[5px] top-5 w-px bg-border/60" />
            )}
            <span
              aria-hidden
              title={rowTitle}
              className={`absolute left-0 top-1.5 size-2.5 rounded-full shadow-md ring-2 ring-background ${
                OUTPUT_TYPE_DOT[typeKey] ?? OUTPUT_TYPE_DOT.system
              }`}
            />
            <article className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
              <header className="flex items-start justify-between gap-2 border-b border-border/40 pb-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <span
                    className={`inline-block shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold tracking-wider ${
                      OUTPUT_TYPE_CLASS[typeKey] ?? OUTPUT_TYPE_CLASS.system
                    }`}
                  >
                    {typeLabel}
                  </span>
                  {presentBadges(cats.efforts)}
                  {pr && <PRBadge improvement={pr.improvement} unit={pr.unit} label={pr.label} />}
                </div>
                <div className="whitespace-nowrap text-right font-mono text-[11px] tabular-nums leading-tight">
                  <span className="font-bold text-primary">{offsetStr}</span>{' '}
                  <span className="text-[10px] text-muted-foreground/80">({elapsedStr})</span>
                </div>
              </header>
              {hasBody && (
                <div className="flex flex-wrap items-center justify-between gap-1 pt-1.5">
                  <div className="flex flex-wrap gap-1">{presentBadges(bodyMetrics)}</div>
                  {rowEditable && onStartEdit && !isEditingThis && (
                    <button
                      type="button"
                      onClick={() =>
                        onStartEdit(
                          out,
                          rowKey,
                          repMetric ? String(repMetric.type) : 'rep',
                          typeof repMetric?.value === 'number' ? repMetric.value : '',
                          repUnit,
                        )
                      }
                      data-testid={`edit-card-reps-${idx}`}
                      className="rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      Edit reps
                    </button>
                  )}
                </div>
              )}
              {isEditingThis && editingCell && onCommitEdit && (
                <form
                  className="mt-2 flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onCommitEdit(out);
                  }}
                >
                  <input
                    type="number"
                    step="any"
                    value={editingCell.draft}
                    onChange={(e) => onChangeDraft?.(e.target.value)}
                    data-testid="inline-metric-input"
                    className="min-h-10 w-24 rounded border border-primary bg-background px-2 font-mono text-xs text-foreground"
                  />
                  <button
                    type="submit"
                    disabled={editingCell.saving}
                    data-testid="inline-metric-save"
                    className="min-h-10 rounded bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="min-h-10 rounded border border-border px-2.5 text-xs text-muted-foreground"
                  >
                    Cancel
                  </button>
                </form>
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

/** The Session Results surface — Card List below `sm`, dynamic sortable/editable table at `sm` and up. */
export function OutputStatementsTable({
  outputs,
  filter = '',
  timeOrigin,
  onClearFilter,
  columns: explicitColumns,
  sort: controlledSort,
  onSortChange,
  limit,
  onEditMetric,
  prHighlights,
}: OutputStatementsTableProps) {
  const t0 = useMemo(() => resolveTimeOrigin(outputs, timeOrigin), [outputs, timeOrigin]);
  const [internalSort, setInternalSort] = useState<SessionTableSortSpec[]>(
    controlledSort ? [...controlledSort] : [],
  );
  useEffect(() => {
    if (controlledSort) setInternalSort([...controlledSort]);
  }, [controlledSort]);

  const activeSort = controlledSort ?? internalSort;

  const activeColumns = useMemo(
    () => buildActiveColumns(outputs, explicitColumns),
    [outputs, explicitColumns],
  );

  const dynamicLowerTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of activeColumns) {
      if (c.kind === 'metric' && c.metricTypeLower) set.add(c.metricTypeLower);
    }
    return set;
  }, [activeColumns]);

  const handleSortClick = useCallback(
    (colId: string, shiftKey: boolean) => {
      const computeNext = (prev: readonly SessionTableSortSpec[]): SessionTableSortSpec[] => {
        const existing = prev.find((s) => s.col.toLowerCase() === colId.toLowerCase());
        if (shiftKey) {
          if (!existing) return [...prev, { col: colId, dir: 'asc' }];
          if (existing.dir === 'asc') {
            return prev.map((s) =>
              s.col.toLowerCase() === colId.toLowerCase() ? { ...s, dir: 'desc' } : s,
            );
          }
          return prev.filter((s) => s.col.toLowerCase() !== colId.toLowerCase());
        }
        if (!existing) return [{ col: colId, dir: 'asc' }];
        if (existing.dir === 'asc') return [{ col: colId, dir: 'desc' }];
        return [];
      };
      const next = computeNext(activeSort);
      setInternalSort(next);
      onSortChange?.(next);
    },
    [activeSort, onSortChange],
  );

  const rows = useMemo(() => {
    const hasEventAnalytics = outputs.some(
      (out) => out.grain !== 'summary' && String(out.outputType ?? '').toLowerCase() === 'analytics',
    );
    const deduped = hasEventAnalytics ? outputs.filter((out) => out.grain !== 'summary') : outputs;
    const filtered = !filter.trim()
      ? [...deduped]
      : deduped.filter((out) => matchesOutputFilter(out, filter));
    if (activeSort.length > 0) {
      filtered.sort((a, b) => compareRowsBySpecs(a, b, activeSort, activeColumns, dynamicLowerTypes));
    }
    if (limit !== undefined && limit > 0) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }, [outputs, filter, activeSort, activeColumns, dynamicLowerTypes, limit]);

  // Inline actuals editor state
  const [editingCell, setEditingCell] = useState<{
    rowKey: string;
    colId: string;
    metricType: string;
    unit?: string;
    draft: string;
    error?: string;
    saving?: boolean;
  } | null>(null);

  const commitInlineEdit = useCallback(
    async (out: OutputStatementRow) => {
      if (!editingCell || !onEditMetric || !out.sourceBlockKey) return;
      const num = Number(editingCell.draft.trim());
      if (!Number.isFinite(num) || editingCell.draft.trim() === '') {
        setEditingCell((prev) => (prev ? { ...prev, error: 'Enter a valid number' } : null));
        return;
      }
      if (editingCell.metricType.toLowerCase() === 'rep' && (!Number.isSafeInteger(num) || num < 0)) {
        setEditingCell((prev) => (prev ? { ...prev, error: 'Reps must be a whole number ≥ 0' } : null));
        return;
      }
      const image = editingCell.unit ? `${num} ${editingCell.unit}` : String(num);
      setEditingCell((prev) => (prev ? { ...prev, saving: true, error: undefined } : null));
      try {
        await onEditMetric({
          occurrence: {
            blockKey: out.sourceBlockKey,
            ...(out.sourceStatementId !== undefined ? { sourceStatementId: out.sourceStatementId } : {}),
            ...(out.stackLevel !== undefined ? { stackLevel: out.stackLevel } : {}),
          },
          metric: {
            type: editingCell.metricType,
            value: num,
            image,
          },
        });
        setEditingCell(null);
      } catch (err) {
        setEditingCell((prev) =>
          prev ? { ...prev, saving: false, error: err instanceof Error ? err.message : String(err) } : null,
        );
      }
    },
    [editingCell, onEditMetric],
  );

  const prAttachColId = useMemo(() => {
    return (
      activeColumns.find((c) => c.kind === 'effort')?.id ??
      activeColumns.find((c) => c.kind === 'loads')?.id ??
      activeColumns[0]?.id
    );
  }, [activeColumns]);

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 639px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobileViewport(e.matches);
    setIsMobileViewport(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobileViewport ? (
    <div>
      <StatementCards
        rows={rows}
        outputs={outputs}
        t0={t0}
        onClearFilter={onClearFilter}
        prHighlights={prHighlights}
        canEdit={Boolean(onEditMetric)}
        editingCell={editingCell}
        onStartEdit={(_out, rowKey, metricType, defaultVal, unit) =>
          setEditingCell({
            rowKey,
            colId: 'reps',
            metricType,
            unit,
            draft: defaultVal !== undefined ? String(defaultVal) : '',
          })
        }
        onChangeDraft={(draft) => setEditingCell((prev) => (prev ? { ...prev, draft } : null))}
        onCancelEdit={() => setEditingCell(null)}
        onCommitEdit={commitInlineEdit}
      />
    </div>
  ) : (
    <div className="overflow-x-auto rounded-md border border-border/50 bg-background/40">
        <table className="w-full text-left font-mono text-xs border-collapse" data-testid="output-statements-table">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">
              {activeColumns.map((col) => {
                const sortEntry = activeSort.find(
                  (s) =>
                    s.col.toLowerCase() === col.id.toLowerCase() ||
                    COLUMN_ALIAS_MAP[s.col.toLowerCase()] === col.id,
                );
                const ariaSort = sortEntry
                  ? sortEntry.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={ariaSort}
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('button')) {
                        handleSortClick(col.id, e.shiftKey);
                      }
                    }}
                    data-testid={`sort-col-${col.id}`}
                    className={`${col.className} select-none hover:text-foreground transition-colors`}
                    title={`Sort by ${col.header}`}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleSortClick(col.id, e.shiftKey)}
                      className="inline-flex items-center gap-1 font-inherit text-inherit uppercase tracking-wider hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      <span>{col.header}</span>
                      {sortEntry && (
                        <span className="text-primary font-mono text-[10px]" aria-hidden>
                          {sortEntry.dir === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={activeColumns.length} className="p-8 text-center text-muted-foreground font-sans text-xs">
                  {outputs.length === 0
                    ? 'No output statements recorded for this run.'
                    : 'No output statements match the current filter.'}
                </td>
              </tr>
            ) : (
              rows.map((out, idx) => {
                const started = out.timeSpan?.started;
                const ended = out.timeSpan?.ended;
                const durationMs = resolveRowDurationMs(out);
                const elapsedStr = durationMs !== undefined ? formatMMSS(durationMs) : 'running';
                const wallTimeStr =
                  ended !== undefined || started !== undefined
                    ? formatClockTime(new Date(ended ?? started ?? 0))
                    : '—';
                const offsetStr = started !== undefined && t0 !== undefined ? formatOffsetMMSS(started - t0) : '+00:00';
                const typeLabel = resolveOutputTypeBadgeLabel(out);
                const rowTitle = formatOutputRowTitle(out, elapsedStr);
                const rowKey = String(out.id ?? `${out.sourceBlockKey ?? 'row'}-${idx}`);
                const pr = lookupPrHighlight(out, prHighlights);
                const canInlineEditRow =
                  Boolean(onEditMetric) &&
                  String(out.outputType ?? '').toLowerCase() === 'segment' &&
                  Boolean(out.sourceBlockKey);

                return (
                  <tr
                    key={rowKey}
                    title={rowTitle}
                    className="hover:bg-muted/30 transition-colors group cursor-default"
                  >
                    {activeColumns.map((col) => {
                      if (col.kind === 'type') {
                        return (
                          <td key={col.id} className="p-2 text-center whitespace-nowrap">
                            <span
                              className={`inline-block rounded px-1.5 py-0.2 text-[9px] font-bold tracking-wider ${
                                OUTPUT_TYPE_CLASS[String(out.outputType)] ?? OUTPUT_TYPE_CLASS.system
                              }`}
                              title={rowTitle}
                            >
                              {typeLabel}
                            </span>
                          </td>
                        );
                      }

                      if (col.kind === 'time') {
                        return (
                          <td
                            key={col.id}
                            title={wallTimeStr !== '—' ? `Recorded at ${wallTimeStr}` : undefined}
                            className="p-2 whitespace-nowrap leading-tight"
                          >
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <span className="font-bold text-primary tabular-nums">{offsetStr}</span>
                              {' '}
                              <span className="text-[10px] text-muted-foreground/80 tabular-nums">({elapsedStr})</span>
                            </div>
                          </td>
                        );
                      }

                      const badges = extractMetricsForColumn(out, col, dynamicLowerTypes);
                      const isEditableCol = canInlineEditRow && Boolean(col.editableType);
                      const isEditingThis =
                        editingCell?.rowKey === rowKey && editingCell?.colId === col.id;
                      const showPrHere = pr && col.id === prAttachColId;

                      if (isEditingThis && editingCell) {
                        return (
                          <td key={col.id} className="p-1.5 font-sans">
                            <form
                              className="flex flex-col gap-0.5"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void commitInlineEdit(out);
                              }}
                            >
                              <div className="inline-flex items-center gap-1">
                                <input
                                  type="number"
                                  step="any"
                                  autoFocus
                                  disabled={editingCell.saving}
                                  data-testid="inline-metric-input"
                                  aria-label={`Edit ${col.header}`}
                                  value={editingCell.draft}
                                  onChange={(e) =>
                                    setEditingCell((prev) =>
                                      prev ? { ...prev, draft: e.target.value, error: undefined } : null,
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      e.stopPropagation();
                                      setEditingCell(null);
                                    }
                                  }}
                                  className="w-16 rounded border border-primary bg-background px-1.5 py-0.5 font-mono text-xs text-foreground focus:outline-none"
                                />
                                <button
                                  type="submit"
                                  disabled={editingCell.saving}
                                  data-testid="inline-metric-save"
                                  className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCell(null)}
                                  className="rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                                >
                                  ✕
                                </button>
                              </div>
                              {editingCell.error && (
                                <span role="alert" className="text-[10px] text-destructive">
                                  {editingCell.error}
                                </span>
                              )}
                            </form>
                          </td>
                        );
                      }

                      const openEditor = () => {
                        if (!isEditableCol || !col.editableType) return;
                        const preferred = badges.find((m) => m.origin === 'user') ?? badges.find((m) => typeof m.value === 'number');
                        const targetType = preferred ? String(preferred.type) : col.editableType;
                        const unit = preferred && 'unit' in preferred && typeof (preferred as { unit?: unknown }).unit === 'string'
                          ? (preferred as { unit: string }).unit
                          : undefined;
                        setEditingCell({
                          rowKey,
                          colId: col.id,
                          metricType: targetType,
                          unit,
                          draft: preferred && typeof preferred.value === 'number' ? String(preferred.value) : '',
                        });
                      };

                      return (
                        <td key={col.id} className="p-2 font-sans">
                          <div className="flex flex-wrap items-center gap-1">
                            {badges.length > 0 ? (
                              isEditableCol ? (
                                <button
                                  type="button"
                                  onClick={openEditor}
                                  data-testid={`edit-cell-${col.id}-${idx}`}
                                  title={`Click to edit ${col.header}`}
                                  className="inline-flex flex-wrap items-center gap-1 rounded hover:ring-1 hover:ring-primary/50 cursor-pointer text-left"
                                >
                                  {presentBadges(badges)}
                                </button>
                              ) : (
                                presentBadges(badges)
                              )
                            ) : isEditableCol ? (
                              <button
                                type="button"
                                onClick={openEditor}
                                data-testid={`edit-cell-${col.id}-${idx}`}
                                title={`Log ${col.header}`}
                                className="text-muted-foreground/50 hover:text-primary font-mono text-[11px] px-1 rounded border border-transparent hover:border-dashed hover:border-primary/50 cursor-pointer"
                              >
                                + log
                              </button>
                            ) : (
                              <span className="text-muted-foreground/30 font-mono text-[11px] select-none">—</span>
                            )}
                            {showPrHere && (
                              <PRBadge improvement={pr.improvement} unit={pr.unit} label={pr.label} />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
  );
}
