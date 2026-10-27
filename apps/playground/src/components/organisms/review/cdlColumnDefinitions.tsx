/**
 * CDL Column Definitions
 *
 * Canonical ColumnDef declarations for every column in the review grid.
 * Replaces the imperative GridColumn building in gridPresets.ts with
 * declarative ColumnDef instances.
 *
 * @see docs/adr/0011-column-definition-language.md
 */

import React from 'react';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { formatSecondsMMSS } from '@/lib/formatTime';
import { getMetricIcon } from '@/views/runtime/metricColorMap';
import { computeColumnLabel } from '@bitcobblers/wod-wiki-engine';
import type { ColumnDef, ColumnSetConfig, ColumnSetPreset } from './column-definition-language';
import { renderMetricCell } from './interpreters';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════
// Metric Cell Extractor Helpers
// ═══════════════════════════════════════════════════════════════

/** Structural view of a grid row for column extractors. */
interface GridRowLike {
  index?: number;
  hideMs?: boolean;
  absoluteStartTime?: number;
  spans?: unknown;
  elapsed?: number;
  sourceBlockKey?: string;
  outputType?: string;
  stackLevel?: number;
  completionReason?: string;
}

const rowOf = (row: unknown): GridRowLike => row as GridRowLike;

function getMetricArray(cell: unknown): IMetric[] {
  const metrics = (cell as { metrics?: unknown } | null)?.metrics;
  if (!metrics) return [];
  if (Array.isArray(metrics)) return metrics as IMetric[];
  if (typeof metrics === 'object' && metrics !== null && 'toArray' in metrics) {
    const container = metrics as { toArray: () => IMetric[] };
    if (typeof container.toArray === 'function') return container.toArray();
  }
  return [];
}

function extractMetricSortValue(cell: unknown): number | string | undefined {
  const arr = getMetricArray(cell);
  if (arr.length === 0) return undefined;
  const first = arr[0];
  if (typeof first?.value === 'number') return first.value;
  if (first?.image) return first.image;
  return String(first?.value ?? '');
}

function extractMetricGraphValue(cell: unknown): number | undefined {
  const arr = getMetricArray(cell);
  for (const m of arr) {
    if (typeof m?.value === 'number') return m.value;
  }
  return undefined;
}

function extractMetricFilterText(cell: unknown): string {
  const arr = getMetricArray(cell);
  return arr.map((m: IMetric) => m.image ?? String(m.value ?? '')).join(', ');
}

function extractResolvedText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => extractResolvedText(entry)).filter(Boolean).join(' — ');
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return extractMetricFilterText(value);
}

function isNumericMetricType(ft: MetricType): boolean {
  switch (ft) {
    case MetricType.Duration:
    case MetricType.Rep:
    case MetricType.Distance:
    case MetricType.Rounds:
    case MetricType.Resistance:
    case MetricType.Increment:
    case MetricType.Metric:
    case MetricType.Volume:
    case MetricType.Intensity:
    case MetricType.Load:
    case MetricType.Work:
    case MetricType.CurrentRound:
    case MetricType.Calculated:
      return true;
    default:
      return false;
  }
}

function getUnitForMetricType(ft: MetricType): string {
  switch (ft) {
    case MetricType.Duration:
      return 's';
    case MetricType.Rep:
      return 'reps';
    case MetricType.Distance:
      return 'm';
    case MetricType.Rounds:
      return 'rounds';
    case MetricType.Resistance:
      return 'kg';
    case MetricType.Increment:
      return 'Δ';
    case MetricType.Calculated:
    case MetricType.Custom:
      return '';
    default:
      return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// Metric Column Factory
// ═══════════════════════════════════════════════════════════════

export function makeMetricColumn(
  metricType: MetricType,
  opts?: { defaultVisible?: boolean; graphable?: boolean; debugOnly?: boolean },
): ColumnDef {
  const label = computeColumnLabel(metricType);
  const icon = getMetricIcon(metricType) ?? undefined;
  const graphable = opts?.graphable ?? isNumericMetricType(metricType);
  return {
    id: metricType,
    label,
    icon,
    source: { type: 'metric-type', metricType },
    format: {
      type: 'custom',
      render: (value) => renderMetricCell(value, 0),
    },
    sort: isNumericMetricType(metricType)
      ? {
          type: 'numeric',
          extractor: (cell) => extractMetricGraphValue(cell),
        }
      : {
          type: 'text',
          extractor: (cell) => {
            const value = extractMetricSortValue(cell);
            return value === undefined ? undefined : String(value);
          },
        },
    graph: graphable
      ? {
          extractor: (cell) => extractMetricGraphValue(cell),
          axisLabel: label,
          unit: getUnitForMetricType(metricType),
        }
      : undefined,
    filter: {
      extractor: (cell) => extractMetricFilterText(cell),
      caseInsensitive: true,
    },
    meta: {
      defaultVisible: opts?.defaultVisible ?? true,
      debugOnly: opts?.debugOnly,
      tags: [metricType],
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Fixed Columns
// ═══════════════════════════════════════════════════════════════

function outputTypeBadgeClass(type: string): string {
  switch (type) {
    case 'segment':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200';
    case 'milestone':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200';
    case 'system':
      return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    case 'event':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200';
    case 'group':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200';
    case 'load':
      return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
    case 'compiler':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-200';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }
}

function formatSpans(
  spans?: { started: number; ended?: number }[],
  durationSeconds?: number,
): string {
  if (!spans || spans.length === 0) return '';
  const fmt = (s: number) => formatSecondsMMSS(s);
  if (durationSeconds === 0) {
    return fmt(spans[0].started);
  }
  const start = fmt(spans[0].started);
  const endSpan = spans[spans.length - 1];
  if (endSpan.ended === undefined) return start;
  const end = fmt(endSpan.ended);
  if (start === end) return start;
  return `${start} — ${end}`;
}

function formatTimestamp(ts?: number, withMs: boolean = true): string {
  if (ts === undefined || ts === 0) return '';
  const date = new Date(ts);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  if (!withMs) return `${h}:${m}:${s}`;
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

// ═══════════════════════════════════════════════════════════════
// Time Display Helpers — :00 notation with visual highlight
// ═══════════════════════════════════════════════════════════════

/**
 * Renders a time string in :00 notation with visual emphasis.
 * Minutes are bold/foreground; seconds and colon are muted.
 * e.g., "05:23" → **05**:23 (05 bold, :23 dimmed)
 */
function TimePart({ value }: { value: string }): React.ReactElement {
  // Match patterns like "05:23", "1:05:23", "05:23.456"
  const match = value.match(/^(-?)(\d+)(:\d{2})(?::\d{2})?(\.\d+)?$/);
  if (!match) {
    return <span className="font-mono text-xs whitespace-nowrap">{value}</span>;
  }

  const [, sign, major, minorWithColon, extraColonSecs, msPart] = match;
  const minor = minorWithColon.slice(1); // strip leading colon

  return (
    <span className="font-mono text-xs whitespace-nowrap inline-flex items-baseline">
      {sign && <span className="text-muted-foreground">{sign}</span>}
      <span className="font-semibold text-foreground">{major}</span>
      <span className="text-muted-foreground/60">:{minor}</span>
      {extraColonSecs && (
        <span className="text-muted-foreground/40">{extraColonSecs}</span>
      )}
      {msPart && <span className="text-muted-foreground/30 text-[10px]">{msPart}</span>}
    </span>
  );
}

/**
 * Renders elapsed time, optionally with duration as "elapsed / duration".
 * Both values use the :00 notation with visual highlight.
 */
function ElapsedDurationPart({
  elapsed,
  duration,
}: {
  elapsed: number;
  duration?: number;
}): React.ReactElement {
  const elapsedStr = formatSecondsMMSS(elapsed);
  const hasDuration = duration !== undefined && duration > 0 && duration !== elapsed;

  return (
    <span className="inline-flex items-baseline gap-0.5">
      <TimePart value={elapsedStr} />
      {hasDuration && (
        <>
          <span className="text-muted-foreground/40 mx-0.5">/</span>
          <span className="opacity-60">
            <TimePart value={formatSecondsMMSS(duration)} />
          </span>
        </>
      )}
    </span>
  );
}

/** Index (#) column */
export const indexColumn: ColumnDef = {
  id: '#',
  label: '#',
  source: {
    type: 'derived',
    compute: (row) => ({
      index: row.index,
      outputType: row.outputType,
      sourceBlockKey: row.sourceBlockKey,
    }),
  },
  format: {
    type: 'custom',
    render: (value) => {
      const { index, outputType, sourceBlockKey } = (value as {
        index: number;
        outputType: string;
        sourceBlockKey: string;
      }) ?? {};
      return (
        <span
          className={cn(
            'font-mono text-[11px] w-8 text-right inline-block',
            outputTypeBadgeClass(outputType),
          )}
          title={`Type: ${outputType}\nBlock: ${sourceBlockKey}`}
        >
          {index}
        </span>
      );
    },
  },
  sort: {
    type: 'numeric',
    extractor: (row) => rowOf(row)?.index || 0,
  },
  meta: {
    tags: ['layout'],
    defaultVisible: true,
    width: '40px',
    resizable: false,
  },
};

/** Timestamp column */
export const timestampColumn: ColumnDef = {
  id: 'timestamp',
  label: 'Timestamp',
  source: { type: 'fixed-field', field: 'absoluteStartTime' },
  format: {
    type: 'custom',
    render: (value, ctx) => {
      const ts = value as number | undefined;
      const withMs = rowOf(ctx)?.hideMs !== false;
      return (
        <span className="text-muted-foreground font-mono text-[10px] text-center w-24 whitespace-nowrap">
          {formatTimestamp(ts, withMs)}
        </span>
      );
    },
    context: { hideMs: false },
  },
  sort: {
    type: 'numeric',
    extractor: (row) => rowOf(row)?.absoluteStartTime ?? 0,
  },
  meta: {
    tags: ['timing', 'layout'],
    defaultVisible: true,
  },
};

/** Spans (Time) column */
export const spansColumn: ColumnDef = {
  id: 'spans',
  label: 'Time',
  source: {
    type: 'derived',
    compute: (row) => ({ spans: row.spans, duration: row.duration }),
  },
  format: {
    type: 'custom',
    render: (value) => {
      const { spans, duration } = (value as {
        spans: { started: number; ended?: number }[];
        duration?: number;
      }) ?? {};
      return (
        <span className="text-muted-foreground font-mono text-[10px] text-center w-40 whitespace-nowrap">
          {formatSpans(spans, duration)}
        </span>
      );
    },
  },
  sort: {
    type: 'numeric',
    extractor: (row) => {
      const spans = rowOf(row)?.spans;
      return spans?.[0]?.started ?? 0;
    },
  },
  meta: {
    tags: ['timing', 'layout'],
    defaultVisible: true,
  },
};

/** Compound TimeSpan column: timestamp + elapsed (+ duration if present). */
export const timeSpanColumn: ColumnDef = {
  id: 'timeSpan',
  label: 'Time',
  source: {
    type: 'derived',
    compute: (row) => ({
      timestamp: row.absoluteStartTime,
      elapsed: row.elapsed,
      duration: row.duration,
    }),
  },
  format: {
    type: 'custom',
    render: (value) => {
      const { timestamp, elapsed, duration } = (value as {
        timestamp?: number;
        elapsed?: number;
        duration?: number;
      }) ?? {};

      if (elapsed === undefined) {
        return <span className="text-muted-foreground opacity-40">—</span>;
      }

      return (
        <div className="flex flex-col items-start gap-0 leading-tight">
          {/* Timestamp — small, muted */}
          {timestamp !== undefined && timestamp > 0 && (
            <span className="text-muted-foreground/50 font-mono text-[10px] whitespace-nowrap">
              {formatTimestamp(timestamp, false)}
            </span>
          )}
          {/* Elapsed / Duration — :00 notation with visual highlight */}
          <ElapsedDurationPart elapsed={elapsed} duration={duration} />
        </div>
      );
    },
  },
  sort: {
    type: 'numeric',
    extractor: (row) => rowOf(row)?.elapsed ?? 0,
  },
  graph: {
    extractor: (row) => rowOf(row)?.elapsed,
    axisLabel: 'Elapsed',
    unit: 's',
  },
  filter: {
    extractor: (value) => {
      const { timestamp, elapsed, duration } = (value as {
        timestamp?: number;
        elapsed?: number;
        duration?: number;
      }) ?? {};
      const parts: string[] = [];
      if (timestamp !== undefined && timestamp > 0) {
        parts.push(formatTimestamp(timestamp, false));
      }
      if (elapsed !== undefined) {
        parts.push(formatSecondsMMSS(elapsed));
      }
      if (duration !== undefined && duration > 0 && duration !== elapsed) {
        parts.push(formatSecondsMMSS(duration));
      }
      return parts.join(' ');
    },
    caseInsensitive: true,
  },
  meta: {
    tags: ['timing', 'compound'],
    defaultVisible: true,
    width: '100px',
    // Hide duration and elapsedTotal when timeSpan (compound) is visible
    subsumes: ['duration', 'elapsedTotal'],
  },
};

/** Block key column */
export const blockKeyColumn: ColumnDef = {
  id: 'blockKey',
  label: 'Block',
  source: { type: 'fixed-field', field: 'sourceBlockKey' },
  format: {
    type: 'text',
    className: 'truncate max-w-[160px] text-sm',
  },
  sort: {
    type: 'text',
    extractor: (row) => rowOf(row)?.sourceBlockKey ?? '',
  },
  filter: {
    extractor: (row) => rowOf(row)?.sourceBlockKey ?? '',
    caseInsensitive: true,
  },
  meta: {
    tags: ['layout'],
    defaultVisible: false,
  },
};

/** Output type column */
export const outputTypeColumn: ColumnDef = {
  id: 'outputType',
  label: 'Type',
  source: { type: 'fixed-field', field: 'outputType' },
  format: {
    type: 'custom',
    render: (value) => {
      const type = String(value ?? '');
      return (
        <span
          className={cn(
            'text-xs px-1.5 py-0.5 rounded font-medium',
            outputTypeBadgeClass(type),
          )}
        >
          {type}
        </span>
      );
    },
  },
  sort: {
    type: 'text',
    extractor: (row) => rowOf(row)?.outputType ?? '',
  },
  filter: {
    extractor: (row) => rowOf(row)?.outputType ?? '',
    caseInsensitive: true,
  },
  meta: {
    tags: ['debug'],
    defaultVisible: false,
  },
};

/** Stack level column */
export const stackLevelColumn: ColumnDef = {
  id: 'stackLevel',
  label: 'Depth',
  source: { type: 'fixed-field', field: 'stackLevel' },
  format: {
    type: 'text',
    className: 'text-muted-foreground font-mono text-xs text-center w-12',
  },
  sort: {
    type: 'numeric',
    extractor: (row) => rowOf(row)?.stackLevel ?? 0,
  },
  meta: {
    tags: ['debug'],
    defaultVisible: false,
    debugOnly: true,
  },
};

/** Elapsed / Total column */
export const elapsedTotalColumn: ColumnDef = {
  id: 'elapsedTotal',
  label: 'Elapsed',
  source: {
    type: 'derived',
    compute: (row) => ({ elapsed: row.elapsed, total: row.total }),
  },
  format: {
    type: 'custom',
    render: (value) => {
      const { elapsed, total } = (value as { elapsed: number; total: number }) ?? {};
      if (elapsed === undefined || total === undefined) return '';
      const text =
        elapsed === total
          ? formatSecondsMMSS(elapsed)
          : `${formatSecondsMMSS(elapsed)} / ${formatSecondsMMSS(total)}`;
      return (
        <span className="text-foreground font-mono text-xs text-right w-32 whitespace-nowrap">
          {text}
        </span>
      );
    },
  },
  sort: {
    type: 'numeric',
    extractor: (row) => rowOf(row)?.elapsed ?? 0,
  },
  graph: {
    extractor: (row) => rowOf(row)?.elapsed,
    axisLabel: 'Elapsed',
    unit: 's',
    color: '#14b8a6',
  },
  meta: {
    tags: ['timing'],
    defaultVisible: false,
  },
};

/** Completion reason column */
export const completionReasonColumn: ColumnDef = {
  id: 'completionReason',
  label: 'Reason',
  source: { type: 'fixed-field', field: 'completionReason' },
  format: {
    type: 'text',
    className: 'text-muted-foreground text-xs truncate max-w-[120px]',
  },
  sort: {
    type: 'text',
    extractor: (row) => rowOf(row)?.completionReason ?? '',
  },
  filter: {
    extractor: (row) => rowOf(row)?.completionReason ?? '',
    caseInsensitive: true,
  },
  meta: {
    tags: ['debug'],
    defaultVisible: false,
    debugOnly: true,
  },
};

// ═══════════════════════════════════════════════════════════════
export const effortColumn = makeMetricColumn(MetricType.Effort, { defaultVisible: false });
export const durationColumn = makeMetricColumn(MetricType.Duration, { debugOnly: true });
export const repColumn = makeMetricColumn(MetricType.Rep);
export const roundsColumn = makeMetricColumn(MetricType.Rounds, { defaultVisible: false });
export const distanceColumn = makeMetricColumn(MetricType.Distance);
export const resistanceColumn = makeMetricColumn(MetricType.Resistance);
export const actionColumn = makeMetricColumn(MetricType.Action);
export const incrementColumn = makeMetricColumn(MetricType.Increment);
export const metricColumn = makeMetricColumn(MetricType.Metric);
export const calculatedColumn = makeMetricColumn(MetricType.Calculated);
export const customColumn = makeMetricColumn(MetricType.Custom, { defaultVisible: false });
export const groupColumn = makeMetricColumn(MetricType.Group, { defaultVisible: false });
export const systemColumn = makeMetricColumn(MetricType.System, { defaultVisible: false });
export const labelColumn = makeMetricColumn(MetricType.Label, { defaultVisible: false });
export const textColumn = makeMetricColumn(MetricType.Text);
export const currentRoundColumn = makeMetricColumn(MetricType.CurrentRound, { defaultVisible: false });
export const volumeColumn = makeMetricColumn(MetricType.Volume);
export const intensityColumn = makeMetricColumn(MetricType.Intensity);
export const loadColumn = makeMetricColumn(MetricType.Load);
export const workColumn = makeMetricColumn(MetricType.Work);
/** Skipped-Dependency Diagnostics: why a note metric (e.g. `work`) never resolved. */
export const diagnosticColumn = makeMetricColumn(MetricType.Diagnostic);

/** Composite exercise column: effort + text when both exist, otherwise best available label. */
export const exerciseColumn: ColumnDef = {
  id: 'exercise',
  label: 'Exercise',
  icon: getMetricIcon(MetricType.Effort) ?? undefined,
  source: {
    type: 'fallback',
    semantics: 'first-present',
    sources: [
      {
        type: 'fallback',
        semantics: 'all-present-combined',
        sources: [
          { type: 'metric-type', metricType: MetricType.Effort },
          { type: 'metric-type', metricType: MetricType.Text },
        ],
      },
      { type: 'metric-type', metricType: MetricType.Text },
      { type: 'metric-type', metricType: MetricType.Label },
      { type: 'metric-type', metricType: MetricType.Effort },
    ],
  },
  format: {
    type: 'combined',
    layout: 'vertical',
    primaryFormat: { type: 'text', className: 'font-medium text-foreground' },
    secondaryFormat: { type: 'text', className: 'text-muted-foreground text-xs' },
    containerClassName: 'items-start',
  },
  sort: {
    type: 'text',
    extractor: (value) => extractResolvedText(value),
  },
  filter: {
    extractor: (value) => extractResolvedText(value),
    caseInsensitive: true,
  },
  meta: {
    defaultVisible: false,
    tags: ['grouping', 'fallback', 'descriptor'],
    // Hide Effort, Text, Label when exercise is visible
    subsumes: ['effort', 'text', 'label'],
  },
};

/** Composed descriptor column: effort | label | rounds | current-round — first present wins. */
export const descriptorColumn: ColumnDef = {
  id: 'descriptor',
  label: 'Descriptor',
  icon: getMetricIcon(MetricType.Effort) ?? undefined,
  source: {
    type: 'fallback',
    semantics: 'first-present',
    sources: [
      { type: 'metric-type', metricType: MetricType.Effort },
      { type: 'metric-type', metricType: MetricType.Label },
      { type: 'metric-type', metricType: MetricType.Rounds },
      { type: 'metric-type', metricType: MetricType.CurrentRound },
    ],
  },
  format: {
    type: 'custom',
    render: (value) => renderMetricCell(value, 0),
  },
  sort: {
    type: 'text',
    extractor: (value) => extractResolvedText(value),
  },
  filter: {
    extractor: (value) => extractResolvedText(value),
    caseInsensitive: true,
  },
  meta: {
    defaultVisible: true,
    // Hide Effort, Label, Rounds, CurrentRound when descriptor is visible
    subsumes: ['effort', 'label', 'rounds', 'current-round'],
  },
};

/** Strength-focused load column: prefer Load, then Resistance. */
export const loadFocusColumn: ColumnDef = {
  id: 'loadFocus',
  label: 'Load',
  icon: getMetricIcon(MetricType.Load) ?? getMetricIcon(MetricType.Resistance) ?? undefined,
  source: {
    type: 'fallback',
    semantics: 'first-present',
    sources: [
      { type: 'metric-type', metricType: MetricType.Load },
      { type: 'metric-type', metricType: MetricType.Resistance },
    ],
  },
  format: {
    type: 'custom',
    render: (value) => renderMetricCell(value, 0),
  },
  sort: {
    type: 'numeric',
    extractor: (value) => extractMetricGraphValue(value),
  },
  graph: {
    extractor: (value) => extractMetricGraphValue(value),
    axisLabel: 'Load',
    unit: 'kg',
  },
  filter: {
    extractor: (value) => extractMetricFilterText(value),
    caseInsensitive: true,
  },
  meta: {
    defaultVisible: false,
    tags: ['strength', 'fallback'],
  },
};

/** Endurance pace derived from distance ÷ duration. */
export const paceColumn: ColumnDef = {
  id: 'pace',
  label: 'Pace',
  icon: '⏱️',
  source: {
    type: 'derived',
    dependencies: ['distance', 'duration'],
    compute: (_row, ctx) => {
      const distance = extractMetricGraphValue(ctx.dependencies.get('distance'));
      const duration = extractMetricGraphValue(ctx.dependencies.get('duration'));
      if (!distance || !duration) return undefined;
      return distance / duration;
    },
  },
  format: {
    type: 'custom',
    render: (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return <span className="text-muted-foreground opacity-40">—</span>;
      }
      const secondsPerKm = 1000 / value;
      return (
        <span className="font-mono text-xs whitespace-nowrap">
          {formatSecondsMMSS(secondsPerKm)}/km
        </span>
      );
    },
  },
  sort: {
    type: 'numeric',
    extractor: (value) => (typeof value === 'number' ? value : undefined),
  },
  graph: {
    extractor: (value) => (typeof value === 'number' ? value : undefined),
    axisLabel: 'Pace',
    unit: 'm/s',
  },
  filter: {
    extractor: (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
      const secondsPerKm = 1000 / value;
      return `${formatSecondsMMSS(secondsPerKm)}/km`;
    },
    caseInsensitive: true,
  },
  meta: {
    defaultVisible: false,
    tags: ['endurance', 'derived'],
  },
};

// ═══════════════════════════════════════════════════════════════
// Column Set Config
// ═══════════════════════════════════════════════════════════════

/** All column definitions in canonical order. */
export const ALL_COLUMN_DEFINITIONS: ColumnDef[] = [
  // Layout / fixed columns
  indexColumn,
  timeSpanColumn,      // compound: timestamp + elapsed + duration
  timestampColumn,
  spansColumn,
  blockKeyColumn,
  outputTypeColumn,
  stackLevelColumn,
  elapsedTotalColumn,
  completionReasonColumn,
  // Primary descriptors
  exerciseColumn,
  descriptorColumn,
  effortColumn,
  textColumn,
  labelColumn,
  // Data metrics
  durationColumn,
  paceColumn,
  repColumn,
  roundsColumn,
  distanceColumn,
  resistanceColumn,
  actionColumn,
  incrementColumn,
  metricColumn,
  calculatedColumn,
  customColumn,
  currentRoundColumn,
  volumeColumn,
  intensityColumn,
  loadFocusColumn,
  loadColumn,
  workColumn,
  diagnosticColumn,   // Skipped-Dependency Diagnostics — why a note metric never resolved
  // System / meta
  groupColumn,
  systemColumn,
];

const DEFAULT_PRESET_FILTERS: NonNullable<ColumnSetPreset['filters']> = {
  outputTypes: ['segment', 'milestone', 'group', 'analytics'],
};

/** Default preset — normal user view. */
export const CDL_PRESET_DEFAULT: ColumnSetPreset = {
  label: 'Default',
  filters: DEFAULT_PRESET_FILTERS,
  visibleColumnIds: [
    '#',
    'timeSpan',     // compound: timestamp + elapsed + duration (hides duration, elapsedTotal)
    'descriptor',
    'rep',
    'distance',
    'resistance',
    'action',
    'increment',
    'metric',
    'calculated',
    'custom',
    'volume',
    'intensity',
    'load',
    'work',
    'diagnostic',
  ],
};

/** Debug preset — shows everything including system events. */
export const CDL_PRESET_DEBUG: ColumnSetPreset = {
  label: 'Debug',
  filters: {},
  visibleColumnIds: [
    '#',
    'timeSpan',     // compound: timestamp + elapsed + duration
    'timestamp',
    'spans',
    'blockKey',
    'outputType',
    'stackLevel',
    'descriptor',
    'duration',
    'rep',
    'distance',
    'resistance',
    'action',
    'increment',
    'metric',
    'calculated',
    'custom',
    'volume',
    'intensity',
    'load',
    'work',
    'diagnostic',
    'group',
    'system',
    'elapsedTotal',
    'completionReason',
  ],
};

/** Strength preset — grouped descriptors plus strength-centric output. */
export const CDL_PRESET_STRENGTH: ColumnSetPreset = {
  label: 'Strength',
  filters: DEFAULT_PRESET_FILTERS,
  visibleColumnIds: [
    '#',
    'timeSpan',     // compound: timestamp + elapsed + duration
    'exercise',
    'rep',
    'loadFocus',
    'volume',
    'intensity',
    'load',
    'work',
    'elapsedTotal',
  ],
};

/** Endurance preset — grouped descriptors plus endurance-specific pace. */
export const CDL_PRESET_ENDURANCE: ColumnSetPreset = {
  label: 'Endurance',
  filters: DEFAULT_PRESET_FILTERS,
  visibleColumnIds: [
    '#',
    'timeSpan',     // compound: timestamp + elapsed + duration
    'exercise',
    'distance',
    'duration',
    'pace',
    'rounds',
    'increment',
    'work',
    'elapsedTotal',
  ],
};

/** The canonical ColumnSetConfig used by useGridData. */
export const GRID_COLUMN_SET_CONFIG: ColumnSetConfig = {
  definitions: ALL_COLUMN_DEFINITIONS,
  presets: {
    default: CDL_PRESET_DEFAULT,
    debug: CDL_PRESET_DEBUG,
    strength: CDL_PRESET_STRENGTH,
    endurance: CDL_PRESET_ENDURANCE,
  },
  defaultPreset: 'default',
};
