import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Check,
  Columns3,
  Copy,
  GitCompareArrows,
  LayoutList,
  Pencil,
  RotateCcw,
  Table2,
} from 'lucide-react';
import { createMetricOwnershipLedger, metricToMs, type EventRecord, type IMetric } from '@bitcobblers/wod-wiki-core';
import { computeColumnLabel } from '@bitcobblers/wod-wiki-lang';
import {
  computeRowsRunSummary,
  selectSplitSegmentEvents,
  type RowsRun,
} from '@bitcobblers/wod-wiki-wql';
import { EditorDialog } from '../dialog/EditorDialog';
import {
  formatAnalyticsFloat,
  formatSummaryDurationMMSS,
  RpePopoverControl,
  type SessionActionContext,
} from '../blocks/SessionSummaryCard';
import { cn } from '../utils/cn';
import {
  OutputFilterPills,
  OutputStatementsTable,
  DEFAULT_OUTPUT_FILTERS,
  normalizeOutputFilter,
  type InlineMetricEditPayload,
  type OutputStatementRow,
  type RowPrHighlight,
} from './OutputStatementsTable';
import { PRBadge } from './PRBadge';

export type SpreadsheetTabId = 'splits' | 'movement' | 'compare' | 'raw';
export type ColumnPresetId = 'execution' | 'strength' | 'pacing' | 'all';
export type MobileColumnGroupId = 'core' | 'output' | 'strength';
export type EditableMetricField = 'reps' | 'load' | 'split' | 'distance';

interface SortSpec {
  col: string;
  dir: 'asc' | 'desc';
}

export interface SpreadsheetSplitRow {
  id: string;
  index: number;
  event: EventRecord;
  sourceBlockKey?: string;
  sourceStatementId?: number;
  stackLevel?: number;
  effortSlug: string;
  movement: string;
  round: number | null;
  reps: number | null;
  repsType: string;
  repsModified: boolean;
  load: number | null;
  loadUnit: string;
  loadType: string;
  loadModified: boolean;
  splitSec: number | null;
  splitModified: boolean;
  offsetSec: number;
  distance: number | null;
  distanceUnit: string;
  distanceModified: boolean;
  volume: number | null;
  volumeUnit: string;
  e1rm: number | null;
  e1rmUnit: string;
  power: number | null;
  powerUnit: string;
  paceSecPerKm: number | null;
  isModified: boolean;
  prHighlight?: RowPrHighlight;
  custom: Record<string, { label: string; value: number; unit?: string; modified: boolean }>;
}

export interface SpreadsheetEditSheetContext {
  field: EditableMetricField;
  label: string;
  currentValue: number | null;
  unit?: string;
  row: SpreadsheetSplitRow;
  onSave: (nextValue: number) => Promise<void>;
  onClear?: () => Promise<void>;
  onClose: () => void;
}

export interface ResultsSpreadsheetGridProps {
  run: RowsRun;
  compareRuns?: readonly RowsRun[];
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>;
  noteTitle?: string;
  /** Optional test ID on the primary desktop/mobile splits `<table>` (e.g. `TEST_IDS.PROPERTY_TABLE`). */
  tableTestId?: string;
  onEditMetric?: (resultId: string, payload: InlineMetricEditPayload) => void | Promise<void>;
  onClearMetric?: (
    resultId: string,
    payload: { sourceBlockKey?: string; sourceStatementId?: number; metricType: string },
  ) => void | Promise<void>;
  onCaptureRpe?: (resultId: string, rpe: number) => Promise<void> | void;
  onAddToDashboard?: (ctx: SessionActionContext) => void;
  onSelectCompareRun?: (resultId: string) => void;
  /** Render computed shake-out summary / analytics rows above or beside the grid (completion & overview). */
  showCustomSummariesStrip?: boolean;
  /** Controlled active tab (defaults to uncontrolled `'splits'`). */
  activeTab?: SpreadsheetTabId;
  onTabChange?: (tab: SpreadsheetTabId) => void;
  /** Controlled mobile presentation mode (`'grid' | 'cards'`). */
  mobileViewMode?: 'grid' | 'cards';
  onMobileViewModeChange?: (mode: 'grid' | 'cards') => void;
  /** Optional host edit sheet (e.g. `ClockValueEntry`); defaults to built-in numeric/duration keypad. */
  renderEditSheet?: (ctx: SpreadsheetEditSheetContext) => ReactNode;
  readOnly?: boolean;
  className?: string;
}

function cleanNum(value: number | null | undefined, maxDecimals = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** maxDecimals;
  return Math.round(value * factor) / factor;
}

function formatNum(value: number | null | undefined, maxDecimals = 1): string {
  const cleaned = cleanNum(value, maxDecimals);
  if (cleaned === null) return '—';
  return cleaned.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

function formatPaceMMSS(secPerKm: number | null | undefined): string {
  if (secPerKm === null || secPerKm === undefined || !Number.isFinite(secPerKm) || secPerKm <= 0) {
    return '—';
  }
  const rounded = Math.round(secPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

function normalizePaceToSecPerKm(value: number, unit?: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const u = (unit ?? '').trim().toLowerCase();
  if (!u || u === 'sec/km' || u === 's/km') return value;
  if (u === 'min/km') return value * 60;
  if (u === 'min/mi') return (value * 60) / 1.609344;
  if (u === 'sec/mi' || u === 's/mi') return value / 1.609344;
  if (u === 'm/s') return 1000 / value;
  if (u === 'km/h' || u === 'kph') return 3600 / value;
  // Non-distance rates (e.g. reps/min) must not be interpreted as distance pace.
  return null;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function normalizePrLookup(
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>,
): Map<string, RowPrHighlight> {
  const out = new Map<string, RowPrHighlight>();
  if (!prHighlights) return out;
  if (prHighlights instanceof Map) {
    for (const [k, v] of prHighlights.entries()) out.set(String(k), v);
  } else {
    for (const [k, v] of Object.entries(prHighlights)) out.set(k, v);
  }
  return out;
}

const KNOWN_CANONICAL_KEYS = new Set([
  'effort',
  'rep',
  'reps',
  'totalreps',
  'resistance',
  'weight',
  'elapsed',
  'duration',
  'time',
  'distance',
  'totaldistance',
  'totalvolume',
  'volume',
  'calc.e1rm',
  'e1rm',
  'power',
  'pace',
  'rounds',
  'current-round',
  'currentround',
  'sessionrpe',
  'session_rpe',
  'session-rpe',
  'label',
  'hint',
  'diagnostic',
  'sound',
]);

interface RecordMetricLike {
  name?: string;
  type?: string;
  value?: unknown;
  unit?: string;
  origin?: string;
  image?: string;
  metadata?: Record<string, unknown>;
}

function extractVisibleMetrics(row: EventRecord): readonly RecordMetricLike[] {
  const raw = (row.metrics ?? []) as readonly RecordMetricLike[];
  try {
    return createMetricOwnershipLedger(raw as unknown as readonly IMetric[]).visible() as unknown as readonly RecordMetricLike[];
  } catch {
    return raw;
  }
}

export function buildSpreadsheetRows(
  run: RowsRun,
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>,
): SpreadsheetSplitRow[] {
  const prMap = normalizePrLookup(prHighlights);
  const segmentEvents = selectSplitSegmentEvents(run.events ?? []);
  const sessionStart = segmentEvents.reduce<number>(
    (min, e) => (e.timeSpan?.started !== undefined ? Math.min(min, e.timeSpan.started) : min),
    run.timestamp,
  );

  return segmentEvents.map((ev, index) => {
    const metrics = extractVisibleMetrics(ev);
    let movement = '';
    let effortSlug = ev.effortSlug ?? '';
    let round: number | null = null;
    let reps: number | null = null;
    let repsType = 'rep';
    let repsModified = false;
    let load: number | null = null;
    let loadUnit = 'kg';
    let loadType = 'resistance';
    let loadModified = false;
    let splitSec: number | null = null;
    let splitFromElapsed = false;
    let splitModified = false;
    let distance: number | null = null;
    let distanceUnit = 'm';
    let distanceModified = false;
    let volume: number | null = null;
    let volumeUnit = 'kg';
    let e1rm: number | null = null;
    let e1rmUnit = 'kg';
    let power: number | null = null;
    let powerUnit = 'W';
    let paceSecPerKm: number | null = null;
    const custom: SpreadsheetSplitRow['custom'] = {};

    for (const m of metrics) {
      const mType = String(m.type ?? '');
      const lower = mType.toLowerCase();
      const canon =
        typeof (m.metadata as Record<string, unknown> | undefined)?.canonicalKey === 'string'
          ? String((m.metadata as Record<string, unknown>).canonicalKey).toLowerCase()
          : lower;
      const isUser = m.origin === 'user';

      if (lower === 'effort' || canon === 'effort') {
        const slugVal =
          typeof (m.metadata as Record<string, unknown> | undefined)?.effortSlug === 'string'
            ? String((m.metadata as Record<string, unknown>).effortSlug)
            : typeof m.value === 'string'
              ? m.value
              : '';
        if (!effortSlug && slugVal) effortSlug = slugVal;
        movement = String(m.image ?? (slugVal ? humanizeSlug(slugVal) : m.value ?? '')).trim();
        continue;
      }
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;

      if (canon === 'rep' || canon === 'reps' || lower === 'rep' || lower === 'reps') {
        if (reps === null || isUser) {
          reps = m.value;
          repsType = mType || 'rep';
          repsModified = isUser;
        }
      } else if (canon === 'resistance' || canon === 'weight' || lower === 'resistance') {
        if (load === null || isUser) {
          load = m.value;
          if (m.unit) {
            loadUnit = m.unit;
            volumeUnit = m.unit;
            e1rmUnit = m.unit;
          }
          loadType = mType || 'resistance';
          loadModified = isUser;
        }
      } else if (canon === 'elapsed' || lower === 'elapsed') {
        const ms = metricToMs(m);
        if (ms !== undefined && (!splitModified || isUser)) {
          splitSec = ms / 1000;
          splitFromElapsed = true;
          splitModified = isUser;
        }
      } else if (canon === 'duration' || lower === 'duration') {
        const ms = metricToMs(m);
        if (ms !== undefined && ((splitSec === null && !splitFromElapsed) || isUser)) {
          splitSec = ms / 1000;
          splitModified = isUser;
        }
      } else if (canon === 'distance' || canon === 'totaldistance' || lower === 'distance') {
        if (distance === null || isUser) {
          distance = m.value;
          if (m.unit) distanceUnit = m.unit;
          distanceModified = isUser;
        }
      } else if (canon === 'totalvolume' || canon === 'volume') {
        volume = m.value;
        if (m.unit) volumeUnit = m.unit;
      } else if (canon === 'calc.e1rm' || canon === 'e1rm') {
        e1rm = m.value;
        if (m.unit) e1rmUnit = m.unit;
      } else if (canon === 'power') {
        power = m.value;
        if (m.unit) powerUnit = m.unit;
      } else if (canon === 'pace') {
        const normalized = normalizePaceToSecPerKm(m.value, m.unit);
        if (normalized !== null) {
          const u = (m.unit ?? '').trim().toLowerCase();
          const isExplicitPace =
            !u ||
            u === 'min/km' ||
            u === 'sec/km' ||
            u === 's/km' ||
            u === 'min/mi' ||
            u === 'sec/mi' ||
            u === 's/mi';
          if (paceSecPerKm === null || isExplicitPace || isUser) {
            paceSecPerKm = normalized;
          }
        }
      } else if (canon === 'rounds' || canon === 'currentround' || lower === 'current-round') {
        round = Math.round(m.value);
      } else if (!KNOWN_CANONICAL_KEYS.has(canon) && !KNOWN_CANONICAL_KEYS.has(lower)) {
        const key = canon || lower;
        custom[key] = {
          label: humanizeSlug(mType),
          value: m.value,
          ...(m.unit ? { unit: m.unit } : {}),
          modified: isUser,
        };
      }
    }

    if (!movement) {
      movement = effortSlug ? humanizeSlug(effortSlug) : `Split ${index + 1}`;
    }
    if (splitSec === null && ev.timeSpan?.started !== undefined && ev.timeSpan?.ended !== undefined) {
      splitSec = Math.max(0, (ev.timeSpan.ended - ev.timeSpan.started) / 1000);
    }
    if (volume === null && reps !== null && load !== null && reps > 0 && load > 0) {
      volume = reps * load;
    }
    if (paceSecPerKm === null && distance !== null && distance > 0 && splitSec !== null && splitSec > 0) {
      const meters = distanceUnit === 'km' ? distance * 1000 : distanceUnit === 'mi' ? distance * 1609.34 : distance;
      if (meters > 0) paceSecPerKm = (splitSec / meters) * 1000;
    }

    const offsetSec =
      ev.timeSpan?.started !== undefined
        ? Math.max(0, Math.round((ev.timeSpan.started - sessionStart) / 1000))
        : 0;
    const rowKey = ev.id !== undefined ? String(ev.id) : undefined;
    const prHighlight =
      (rowKey ? prMap.get(rowKey) : undefined) ??
      (ev.sourceBlockKey ? prMap.get(ev.sourceBlockKey) : undefined);

    return {
      id: ev.id ?? `${run.resultId}:seg:${index}`,
      index: index + 1,
      event: ev,
      sourceBlockKey: ev.sourceBlockKey,
      sourceStatementId: ev.sourceStatementId,
      stackLevel: ev.stackLevel,
      effortSlug: effortSlug.toLowerCase(),
      movement,
      round,
      reps,
      repsType,
      repsModified,
      load,
      loadUnit,
      loadType,
      loadModified,
      splitSec,
      splitModified,
      offsetSec,
      distance,
      distanceUnit,
      distanceModified,
      volume,
      volumeUnit,
      e1rm,
      e1rmUnit,
      power,
      powerUnit,
      paceSecPerKm,
      isModified: repsModified || loadModified || splitModified || distanceModified,
      prHighlight,
      custom,
    };
  });
}

interface ColumnDef {
  id: string;
  label: string;
  align: 'left' | 'right';
  editableField?: EditableMetricField;
  presets: readonly ColumnPresetId[];
  mobileGroup: MobileColumnGroupId;
  hasData: (rows: readonly SpreadsheetSplitRow[]) => boolean;
  sortValue: (row: SpreadsheetSplitRow) => number | string;
}

const STATIC_COLUMNS: readonly ColumnDef[] = [
  {
    id: 'reps',
    label: 'Reps',
    align: 'right',
    editableField: 'reps',
    presets: ['execution', 'strength', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.reps !== null),
    sortValue: (r) => r.reps ?? -1,
  },
  {
    id: 'load',
    label: 'Load',
    align: 'right',
    editableField: 'load',
    presets: ['execution', 'strength', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.load !== null),
    sortValue: (r) => r.load ?? -1,
  },
  {
    id: 'split',
    label: 'Split',
    align: 'right',
    editableField: 'split',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.splitSec !== null),
    sortValue: (r) => r.splitSec ?? -1,
  },
  {
    id: 'distance',
    label: 'Distance',
    align: 'right',
    editableField: 'distance',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.distance !== null),
    sortValue: (r) => r.distance ?? -1,
  },
  {
    id: 'offset',
    label: 'Offset',
    align: 'right',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.length > 0,
    sortValue: (r) => r.offsetSec,
  },
  {
    id: 'volume',
    label: 'Volume',
    align: 'right',
    presets: ['execution', 'strength', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.volume !== null && r.volume > 0),
    sortValue: (r) => r.volume ?? -1,
  },
  {
    id: 'e1rm',
    label: 'e1RM',
    align: 'right',
    presets: ['strength', 'all'],
    mobileGroup: 'strength',
    hasData: (rows) => rows.some((r) => r.e1rm !== null && r.e1rm > 0),
    sortValue: (r) => r.e1rm ?? -1,
  },
  {
    id: 'power',
    label: 'Power',
    align: 'right',
    presets: ['pacing', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.power !== null && r.power > 0),
    sortValue: (r) => r.power ?? -1,
  },
  {
    id: 'pace',
    label: 'Pace',
    align: 'right',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.paceSecPerKm !== null && r.paceSecPerKm > 0),
    sortValue: (r) => r.paceSecPerKm ?? -1,
  },
];

function fieldLabel(field: EditableMetricField, row: SpreadsheetSplitRow): string {
  switch (field) {
    case 'reps':
      return 'Reps';
    case 'load':
      return `Load (${row.loadUnit})`;
    case 'split':
      return 'Split Duration (s)';
    case 'distance':
      return `Distance (${row.distanceUnit})`;
  }
}

function getEditableValue(row: SpreadsheetSplitRow, field: EditableMetricField): number | null {
  switch (field) {
    case 'reps':
      return row.reps;
    case 'load':
      return row.load;
    case 'split':
      return row.splitSec !== null ? cleanNum(row.splitSec, 1) : null;
    case 'distance':
      return row.distance;
  }
}

function buildEditPayload(
  row: SpreadsheetSplitRow,
  field: EditableMetricField,
  value: number,
): InlineMetricEditPayload {
  const occurrence = {
    blockKey: row.sourceBlockKey ?? row.id,
    ...(row.sourceStatementId !== undefined ? { sourceStatementId: row.sourceStatementId } : {}),
    ...(row.stackLevel !== undefined ? { stackLevel: row.stackLevel } : {}),
  };
  switch (field) {
    case 'reps':
      return {
        occurrence,
        metric: { type: row.repsType, value, image: String(value) },
      };
    case 'load':
      return {
        occurrence,
        metric: {
          type: row.loadType,
          value,
          image: `${value} ${row.loadUnit}`,
        },
      };
    case 'split':
      return {
        occurrence,
        metric: {
          type: 'duration',
          value,
          image: formatSummaryDurationMMSS(value * 1000),
        },
      };
    case 'distance':
      return {
        occurrence,
        metric: {
          type: 'distance',
          value,
          image: `${value} ${row.distanceUnit}`,
        },
      };
  }
}

function metricTypeForField(row: SpreadsheetSplitRow, field: EditableMetricField): string {
  switch (field) {
    case 'reps':
      return row.repsType;
    case 'load':
      return row.loadType;
    case 'split':
      return 'duration';
    case 'distance':
      return 'distance';
  }
}

function formatCellDisplay(row: SpreadsheetSplitRow, colId: string): string {
  switch (colId) {
    case 'reps':
      return row.reps !== null ? formatNum(row.reps, 0) : '—';
    case 'load':
      return row.load !== null ? `${formatNum(row.load, 1)} ${row.loadUnit}` : '—';
    case 'split':
      return row.splitSec !== null ? formatSummaryDurationMMSS(row.splitSec * 1000) : '—';
    case 'distance':
      return row.distance !== null ? `${formatNum(row.distance, 1)} ${row.distanceUnit}` : '—';
    case 'offset':
      return `+${formatSummaryDurationMMSS(row.offsetSec * 1000)}`;
    case 'volume':
      return row.volume !== null ? `${formatNum(row.volume, 0)} ${row.volumeUnit}` : '—';
    case 'e1rm':
      return row.e1rm !== null ? `${formatNum(row.e1rm, 1)} ${row.e1rmUnit}` : '—';
    case 'power':
      return row.power !== null ? `${formatNum(row.power, 0)} ${row.powerUnit}` : '—';
    case 'pace':
      return formatPaceMMSS(row.paceSecPerKm);
    default: {
      const custom = row.custom[colId];
      if (!custom) return '—';
      const displayVal = Number.isInteger(custom.value)
        ? formatNum(custom.value, 0)
        : formatAnalyticsFloat(custom.value);
      return `${displayVal}${custom.unit ? ` ${custom.unit}` : ''}`;
    }
  }
}

function rowsToCsv(rows: readonly SpreadsheetSplitRow[], columns: readonly ColumnDef[]): string {
  const esc = (s: string) => (s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s);
  const header = ['#', 'Movement', 'Round', ...columns.map((c) => c.label)].map(esc).join(',');
  const body = rows.map((r) =>
    [
      String(r.index),
      r.movement,
      r.round !== null ? String(r.round) : '',
      ...columns.map((c) => formatCellDisplay(r, c.id)),
    ]
      .map(esc)
      .join(','),
  );
  return [header, ...body].join('\n');
}

function BuiltInMetricKeypad({
  ctx,
}: {
  ctx: SpreadsheetEditSheetContext;
}) {
  const [draft, setDraft] = useState(() => (ctx.currentValue !== null ? String(ctx.currentValue) : ''));
  const [saving, setSaving] = useState(false);

  const stepDelta = ctx.field === 'load' ? 2.5 : ctx.field === 'distance' ? 50 : ctx.field === 'split' ? 5 : 1;

  const adjust = (delta: number) => {
    const base = Number.parseFloat(draft) || 0;
    const next = Math.max(0, Math.round((base + delta) * 10) / 10);
    setDraft(String(next));
  };

  const submit = async () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed < 0 || saving) return;
    setSaving(true);
    try {
      await ctx.onSave(parsed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Segment <span className="font-semibold text-foreground">#{ctx.row.index} · {ctx.row.movement}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => adjust(-stepDelta)}
          className="min-h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm font-medium text-foreground hover:bg-muted"
        >
          −{stepDelta}
        </button>
        <input
          type="number"
          step="any"
          min={0}
          data-autofocus="true"
          data-testid="spreadsheet-edit-input"
          aria-label={ctx.label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-center font-mono text-lg font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={() => adjust(stepDelta)}
          className="min-h-11 rounded-lg border border-border bg-background px-3 font-mono text-sm font-medium text-foreground hover:bg-muted"
        >
          +{stepDelta}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {ctx.onClear && (
          <button
            type="button"
            data-testid="spreadsheet-edit-clear"
            onClick={() => void ctx.onClear?.()}
            className="mr-auto inline-flex items-center gap-1.5 min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Revert override
          </button>
        )}
        <button
          type="button"
          onClick={ctx.onClose}
          className="min-h-11 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !Number.isFinite(Number.parseFloat(draft))}
          data-testid="spreadsheet-edit-save"
          onClick={() => void submit()}
          className="min-h-11 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save value'}
        </button>
      </div>
    </div>
  );
}

/**
 * ResultsSpreadsheetGrid — Production 4-tab execution workbook (`Splits`,
 * `By Movement`, `Compare Runs`, `Raw Events`) with desktop frozen identity
 * column, semantic multi-sort headers, arrow-key navigation, column presets,
 * pinned footer totals, CSV export, and mobile 3-column group pills / cards.
 */
export function ResultsSpreadsheetGrid({
  run,
  compareRuns = [],
  prHighlights,
  noteTitle,
  tableTestId = 'results-spreadsheet-table',
  onEditMetric,
  onClearMetric,
  onCaptureRpe,
  onAddToDashboard,
  onSelectCompareRun,
  showCustomSummariesStrip = false,
  activeTab: controlledTab,
  onTabChange,
  mobileViewMode: controlledMobileView,
  onMobileViewModeChange,
  renderEditSheet,
  readOnly = false,
  className,
}: ResultsSpreadsheetGridProps) {
  const [internalTab, setInternalTab] = useState<SpreadsheetTabId>('splits');
  const activeTab = controlledTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  const [preset, setPreset] = useState<ColumnPresetId>('execution');
  const [mobileGroup, setMobileGroup] = useState<MobileColumnGroupId>('core');
  const [internalMobileView, setInternalMobileView] = useState<'grid' | 'cards'>('grid');
  const mobileView = controlledMobileView ?? internalMobileView;
  const setMobileView = onMobileViewModeChange ?? setInternalMobileView;

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set());
  const [colChooserOpen, setColChooserOpen] = useState(false);
  const [sorts, setSorts] = useState<SortSpec[]>([]);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [rawFilter, setRawFilter] = useState('');
  const [editingCell, setEditingCell] = useState<{
    row: SpreadsheetSplitRow;
    field: EditableMetricField;
  } | null>(null);

  const colChooserRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colChooserOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (colChooserRef.current && !colChooserRef.current.contains(e.target as Node)) {
        setColChooserOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [colChooserOpen]);

  const summary = useMemo(
    () => run.summary ?? computeRowsRunSummary(run, { noteTitle }),
    [run, noteTitle],
  );
  const rows = useMemo(() => buildSpreadsheetRows(run, prHighlights), [run, prHighlights]);

  const dynamicColumns = useMemo<ColumnDef[]>(() => {
    const keys = new Map<string, string>();
    for (const r of rows) {
      for (const [k, meta] of Object.entries(r.custom)) {
        if (!keys.has(k)) keys.set(k, meta.label);
      }
    }
    return [...keys.entries()].map(([id, label]) => ({
      id,
      label,
      align: 'right',
      presets: ['all'],
      mobileGroup: 'output',
      hasData: (rs) => rs.some((r) => r.custom[id] !== undefined),
      sortValue: (r) => r.custom[id]?.value ?? -1,
    }));
  }, [rows]);

  const allColumns = useMemo(() => [...STATIC_COLUMNS, ...dynamicColumns], [dynamicColumns]);

  const availableColumns = useMemo(
    () => allColumns.filter((col) => col.hasData(rows) || (preset === 'all' && STATIC_COLUMNS.includes(col))),
    [allColumns, rows, preset],
  );

  const visibleColumns = useMemo(() => {
    const byPreset =
      preset === 'all'
        ? availableColumns
        : availableColumns.filter((col) => col.presets.includes(preset));
    const finalList = byPreset.filter((col) => !hiddenCols.has(col.id));
    return finalList.length > 0 ? finalList : availableColumns.slice(0, 3);
  }, [availableColumns, preset, hiddenCols]);

  const mobileColumns = useMemo(() => {
    const matching = availableColumns.filter((c) => c.mobileGroup === mobileGroup);
    if (matching.length > 0) return matching.slice(0, 3);
    return availableColumns.slice(0, 3);
  }, [availableColumns, mobileGroup]);

  const sortedRows = useMemo(() => {
    if (sorts.length === 0) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      for (const spec of sorts) {
        const col = allColumns.find((c) => c.id === spec.col);
        if (!col) continue;
        const av = col.sortValue(a);
        const bv = col.sortValue(b);
        if (av === bv) continue;
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        if (cmp !== 0) return spec.dir === 'asc' ? cmp : -cmp;
      }
      return a.index - b.index;
    });
    return copy;
  }, [rows, sorts, allColumns]);

  const handleSortClick = (colId: string, shiftKey: boolean) => {
    setSorts((prev) => {
      const existingIdx = prev.findIndex((s) => s.col === colId);
      const nextDir: 'asc' | 'desc' =
        existingIdx >= 0 && prev[existingIdx]!.dir === 'asc' ? 'desc' : 'asc';
      if (!shiftKey) {
        return [{ col: colId, dir: nextDir }];
      }
      if (existingIdx >= 0) {
        return prev.map((s, idx) => (idx === existingIdx ? { ...s, dir: nextDir } : s));
      }
      return [...prev, { col: colId, dir: nextDir }];
    });
  };

  const handleCellKeyDown = (e: KeyboardEvent<HTMLElement>, rowIdx: number, colIdx: number) => {
    const maxRow = sortedRows.length - 1;
    const maxCol = visibleColumns.length - 1;
    let nextRow = rowIdx;
    let nextCol = colIdx;
    if (e.key === 'ArrowRight') nextCol = Math.min(maxCol, colIdx + 1);
    else if (e.key === 'ArrowLeft') nextCol = Math.max(0, colIdx - 1);
    else if (e.key === 'ArrowDown') nextRow = Math.min(maxRow, rowIdx + 1);
    else if (e.key === 'ArrowUp') nextRow = Math.max(0, rowIdx - 1);
    else return;
    if (nextRow === rowIdx && nextCol === colIdx) return;
    e.preventDefault();
    const target = (e.currentTarget.closest('table')?.querySelector(
      `[data-grid-cell="${nextRow}:${nextCol}"]`,
    ) ?? null) as HTMLElement | null;
    target?.focus();
  };

  const handleCopyCsv = () => {
    const csv = rowsToCsv(sortedRows, visibleColumns);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(csv).catch(() => {});
    }
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 1600);
  };

  // Custom shake-out / workout summary strip entries
  const summaryAnalyticsRows = useMemo(() => {
    if (!showCustomSummariesStrip) return [];
    const seen = new Set<string>();
    const items: Array<{ key: string; label: string; value: string; origin?: string }> = [];
    const hasGrainSummary = (run.events ?? []).some((e) => e.grain === 'summary');
    for (const ev of run.events ?? []) {
      if (ev.outputType !== 'analytics' && ev.grain !== 'summary') continue;
      if (hasGrainSummary && ev.grain !== 'summary') continue;
      for (const m of extractVisibleMetrics(ev)) {
        const mType = String(m.type ?? '');
        if (!mType || mType === 'label' || mType === 'hint' || mType === 'diagnostic') continue;
        if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;
        const canonKey = String((m.metadata as Record<string, unknown> | undefined)?.canonicalKey ?? mType);
        if (seen.has(canonKey)) continue;
        seen.add(canonKey);
        const formatted = Number.isInteger(m.value) && (m.unit === 'reps' || m.unit === 'rounds')
          ? formatNum(m.value, 0)
          : formatAnalyticsFloat(m.value);
        items.push({
          key: canonKey,
          label: computeColumnLabel(canonKey),
          value: `${formatted}${m.unit ? ` ${m.unit}` : ''}`,
          origin: m.origin,
        });
      }
    }
    return items;
  }, [run.events, showCustomSummariesStrip]);

  // Footer totals
  const footerTotals = useMemo(() => {
    const totalReps = sortedRows.reduce((acc, r) => acc + (r.reps ?? 0), 0);
    const totalVolume = sortedRows.reduce((acc, r) => acc + (r.volume ?? 0), 0);
    const volumeUnit = sortedRows.find((r) => r.volume !== null)?.volumeUnit ?? 'kg';
    const totalDist = sortedRows.reduce((acc, r) => acc + (r.distance ?? 0), 0);
    const distUnit = sortedRows.find((r) => r.distance !== null)?.distanceUnit ?? 'm';
    const totalSplitSec = sortedRows.reduce((acc, r) => acc + (r.splitSec ?? 0), 0);
    const maxLoad = sortedRows.reduce<number | null>(
      (max, r) => (r.load !== null ? (max === null ? r.load : Math.max(max, r.load)) : max),
      null,
    );
    const loadUnit = sortedRows.find((r) => r.load !== null)?.loadUnit ?? 'kg';
    return { totalReps, totalVolume, volumeUnit, totalDist, distUnit, totalSplitSec, maxLoad, loadUnit };
  }, [sortedRows]);

  const actionContext: SessionActionContext = {
    resultId: run.resultId,
    noteId: run.noteId,
    noteTitle: noteTitle ?? summary.noteTitle,
    blockContentId: summary.blockContentId,
    notebooks: summary.notebooks,
    summary,
  };

  const editCtx: SpreadsheetEditSheetContext | null = editingCell
    ? {
        field: editingCell.field,
        label: fieldLabel(editingCell.field, editingCell.row),
        currentValue: getEditableValue(editingCell.row, editingCell.field),
        unit: editingCell.field === 'load' ? editingCell.row.loadUnit : editingCell.field === 'distance' ? editingCell.row.distanceUnit : undefined,
        row: editingCell.row,
        onSave: async (nextValue) => {
          if (!onEditMetric) return;
          await onEditMetric(run.resultId, buildEditPayload(editingCell.row, editingCell.field, nextValue));
          setEditingCell(null);
        },
        onClear:
          onClearMetric &&
          ((editingCell.field === 'reps' && editingCell.row.repsModified) ||
            (editingCell.field === 'load' && editingCell.row.loadModified) ||
            (editingCell.field === 'split' && editingCell.row.splitModified) ||
            (editingCell.field === 'distance' && editingCell.row.distanceModified))
            ? async () => {
                await onClearMetric(run.resultId, {
                  sourceBlockKey: editingCell.row.sourceBlockKey,
                  sourceStatementId: editingCell.row.sourceStatementId,
                  metricType: metricTypeForField(editingCell.row, editingCell.field),
                });
                setEditingCell(null);
              }
            : undefined,
        onClose: () => setEditingCell(null),
      }
    : null;

  return (
    <div data-testid="results-spreadsheet-grid" className={cn('space-y-3', className)}>
      {/* Optional Shake-Out Custom Summaries Strip */}
      {showCustomSummariesStrip && summaryAnalyticsRows.length > 0 && (
        <section
          aria-label="Computed workout summary metrics"
          data-testid="custom-summaries-strip"
          className="rounded-xl border border-border bg-card p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Computed Analytics &amp; Shake-Out Summary
            </span>
          </div>
          <div role="table" aria-label="Analytics summary rows" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {summaryAnalyticsRows.map((item) => (
              <div
                key={item.key}
                role="row"
                className="flex flex-col rounded-lg border border-border/70 bg-muted/25 px-3 py-2"
              >
                <span role="cell" className="text-[11px] font-mono text-muted-foreground">
                  {item.label}
                </span>
                <span role="cell" className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Primary Workbook Header: Tabs + Right Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div role="tablist" aria-label="Results workbook views" className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: 'splits', label: `Splits (${rows.length})`, icon: Table2 },
              { id: 'movement', label: `By Movement (${summary.movementRollup.length})`, icon: LayoutList },
              { id: 'compare', label: `Compare Runs (${compareRuns.length})`, icon: GitCompareArrows },
              { id: 'raw', label: `Raw Events (${run.events.length})`, icon: Columns3 },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`results-tab-${tab.id}`}
                onClick={() => setTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors min-h-10 sm:min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onCaptureRpe && (
            <RpePopoverControl
              rpe={summary.rpe ?? null}
              resultId={run.resultId}
              readOnly={readOnly}
              onChange={(next) => onCaptureRpe(run.resultId, next)}
            />
          )}
          {onAddToDashboard && (
            <button
              type="button"
              data-testid="spreadsheet-add-dashboard"
              onClick={() => onAddToDashboard(actionContext)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors min-h-10 sm:min-h-8"
            >
              <BarChart3 className="size-3.5 text-primary" aria-hidden="true" />
              <span>Add to Dashboard</span>
            </button>
          )}
          <button
            type="button"
            data-testid="spreadsheet-copy-csv"
            onClick={handleCopyCsv}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors min-h-10 sm:min-h-8"
            title="Copy CSV to clipboard"
          >
            {copiedCsv ? <Check className="size-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            <span>{copiedCsv ? 'Copied CSV' : 'CSV'}</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Splits Spreadsheet */}
      {activeTab === 'splits' && (
        <div className="space-y-2.5">
          {/* Desktop Preset & Column Chooser */}
          <div className="hidden sm:flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Column presets">
              {(
                [
                  { id: 'execution', label: 'Execution' },
                  { id: 'strength', label: 'Strength' },
                  { id: 'pacing', label: 'Pacing' },
                  { id: 'all', label: 'All Columns' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`spreadsheet-preset-${p.id}`}
                  aria-pressed={preset === p.id}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    preset === p.id
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {sorts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSorts([])}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  Reset sort ({sorts.length})
                </button>
              )}
              <div ref={colChooserRef} className="relative">
                <button
                  type="button"
                  aria-expanded={colChooserOpen}
                  data-testid="spreadsheet-columns-btn"
                  onClick={() => setColChooserOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Columns3 className="size-3.5" aria-hidden="true" />
                  <span>Columns</span>
                </button>
                {colChooserOpen && (
                  <div
                    role="dialog"
                    aria-label="Visible columns"
                    className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-popover p-2 shadow-lg space-y-1"
                  >
                    {availableColumns.map((col) => {
                      const checked = !hiddenCols.has(col.id);
                      return (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setHiddenCols((prev) => {
                                const next = new Set(prev);
                                if (next.has(col.id)) next.delete(col.id);
                                else next.add(col.id);
                                return next;
                              })
                            }
                          />
                          <span>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Controls (<640px): 3-Col Group Pills + Grid/Cards Toggle */}
          <div className="flex sm:hidden flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5" role="group" aria-label="Column group">
              {(
                [
                  { id: 'core', label: 'Core' },
                  { id: 'output', label: 'Output' },
                  { id: 'strength', label: 'Strength' },
                ] as const
              ).map((grp) => (
                <button
                  key={grp.id}
                  type="button"
                  data-testid={`mobile-group-${grp.id}`}
                  aria-pressed={mobileGroup === grp.id}
                  onClick={() => setMobileGroup(grp.id)}
                  className={cn(
                    'min-h-10 rounded-md px-2.5 text-xs font-medium transition-colors',
                    mobileGroup === grp.id
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground',
                  )}
                >
                  {grp.label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5" role="group" aria-label="Mobile layout">
              <button
                type="button"
                data-testid="mobile-view-grid"
                aria-pressed={mobileView === 'grid'}
                onClick={() => setMobileView('grid')}
                className={cn(
                  'min-h-10 rounded-md px-2.5 text-xs font-medium',
                  mobileView === 'grid' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground',
                )}
              >
                Grid
              </button>
              <button
                type="button"
                data-testid="mobile-view-cards"
                aria-pressed={mobileView === 'cards'}
                onClick={() => setMobileView('cards')}
                className={cn(
                  'min-h-10 rounded-md px-2.5 text-xs font-medium',
                  mobileView === 'cards' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground',
                )}
              >
                Cards
              </button>
            </div>
          </div>

          {/* Empty Splits State */}
          {sortedRows.length === 0 ? (
            <div
              data-testid="spreadsheet-empty-splits"
              className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
            >
              No segment splits recorded for this session. Switch to{' '}
              <button
                type="button"
                onClick={() => setTab('raw')}
                className="font-medium text-primary underline underline-offset-2"
              >
                Raw Events
              </button>{' '}
              to inspect summary or system rows.
            </div>
          ) : (
            <>
              {/* Mobile Cards Mode (<640px) */}
              {mobileView === 'cards' && (
                <div data-testid="mobile-split-cards" className="grid grid-cols-1 gap-2 sm:hidden">
                  {sortedRows.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-xl border border-border bg-card p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            #{row.index}
                          </span>
                          <span className="font-semibold text-sm text-foreground truncate">
                            {row.movement}
                          </span>
                          {row.round !== null && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                              R{row.round}
                            </span>
                          )}
                        </div>
                        {row.prHighlight && (
                          <PRBadge improvement={row.prHighlight.improvement} unit={row.prHighlight.unit} />
                        )}
                      </div>
                      <dl className="grid grid-cols-2 gap-1.5 text-xs">
                        {mobileColumns.map((col) => {
                          const canEdit = !readOnly && Boolean(onEditMetric) && col.editableField !== undefined;
                          const valStr = formatCellDisplay(row, col.id);
                          return (
                            <div
                              key={col.id}
                              className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-1.5"
                            >
                              <dt className="text-muted-foreground">{col.label}</dt>
                              <dd className="font-mono font-medium tabular-nums text-foreground">
                                {canEdit && col.editableField ? (
                                  <button
                                    type="button"
                                    onClick={() => setEditingCell({ row, field: col.editableField! })}
                                    className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 text-foreground"
                                  >
                                    <span>{valStr}</span>
                                    <Pencil className="size-3 text-muted-foreground" aria-hidden="true" />
                                  </button>
                                ) : (
                                  valStr
                                )}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  ))}
                </div>
              )}

              {/* Spreadsheet Table (Always on >=640px desktop; on <640px when Grid mode) */}
              <div
                className={cn(
                  'relative overflow-x-auto rounded-xl border border-border bg-card shadow-xs',
                  mobileView === 'cards' ? 'hidden sm:block' : 'block',
                )}
              >
                <table
                  data-testid={tableTestId}
                  className="w-full border-collapse text-left text-xs sm:text-sm"
                >
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                      <th
                        scope="col"
                        className="sticky left-0 z-10 min-w-[140px] sm:min-w-[180px] border-r border-border/80 bg-muted px-3 py-2.5 text-left"
                      >
                        # · Movement
                      </th>
                      {visibleColumns.map((col, colIdx) => {
                        const sortIdx = sorts.findIndex((s) => s.col === col.id);
                        const sortSpec = sortIdx >= 0 ? sorts[sortIdx] : undefined;
                        const ariaSort =
                          sortSpec?.dir === 'asc'
                            ? 'ascending'
                            : sortSpec?.dir === 'desc'
                              ? 'descending'
                              : 'none';
                        return (
                          <th
                            key={col.id}
                            scope="col"
                            aria-sort={ariaSort}
                            data-testid={`spreadsheet-col-${col.id}`}
                            className={cn(
                              'whitespace-nowrap px-3 py-2.5',
                              col.align === 'right' ? 'text-right' : 'text-left',
                              colIdx >= 3 && 'max-sm:hidden',
                              !mobileColumns.some((mc) => mc.id === col.id) && 'max-sm:hidden',
                            )}
                          >
                            <button
                              type="button"
                              onClick={(e) => handleSortClick(col.id, e.shiftKey)}
                              title="Click to sort; Shift+Click to add multi-column sort"
                              className={cn(
                                'inline-flex items-center gap-1 font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1 py-0.5',
                                col.align === 'right' && 'ml-auto flex-row-reverse',
                                sortSpec && 'text-primary',
                              )}
                            >
                              <span>{col.label}</span>
                              {sortSpec?.dir === 'asc' ? (
                                <ArrowUp className="size-3.5" aria-hidden="true" />
                              ) : sortSpec?.dir === 'desc' ? (
                                <ArrowDown className="size-3.5" aria-hidden="true" />
                              ) : (
                                <ArrowUpDown className="size-3 opacity-50" aria-hidden="true" />
                              )}
                              {sortSpec && sorts.length > 1 && (
                                <span className="text-[10px] font-mono">{sortIdx + 1}</span>
                              )}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {sortedRows.map((row, rowIdx) => (
                      <tr
                        key={row.id}
                        className="group hover:bg-muted/25 transition-colors"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 border-r border-border/80 bg-card group-hover:bg-muted/25 px-3 py-2 text-left font-normal"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[11px] text-muted-foreground tabular-nums w-5 shrink-0">
                              {row.index}
                            </span>
                            <span className="font-medium text-foreground truncate">{row.movement}</span>
                            {row.round !== null && (
                              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
                                R{row.round}
                              </span>
                            )}
                            {row.prHighlight && (
                              <PRBadge
                                improvement={row.prHighlight.improvement}
                                unit={row.prHighlight.unit}
                              />
                            )}
                          </div>
                        </th>
                        {visibleColumns.map((col, colIdx) => {
                          const display = formatCellDisplay(row, col.id);
                          const isEditable = !readOnly && Boolean(onEditMetric) && col.editableField !== undefined;
                          const isModifiedCell =
                            (col.id === 'reps' && row.repsModified) ||
                            (col.id === 'load' && row.loadModified) ||
                            (col.id === 'split' && row.splitModified) ||
                            (col.id === 'distance' && row.distanceModified);
                          const hiddenOnMobile = !mobileColumns.some((mc) => mc.id === col.id);
                          return (
                            <td
                              key={col.id}
                              className={cn(
                                'whitespace-nowrap px-3 py-2 font-mono tabular-nums',
                                col.align === 'right' ? 'text-right' : 'text-left',
                                hiddenOnMobile && 'max-sm:hidden',
                                isModifiedCell && 'bg-amber-500/10 text-amber-900 dark:text-amber-200',
                              )}
                            >
                              {isEditable && col.editableField ? (
                                <button
                                  type="button"
                                  data-grid-cell={`${rowIdx}:${colIdx}`}
                                  data-testid={`spreadsheet-edit-${col.id}-${rowIdx}`}
                                  onClick={() => setEditingCell({ row, field: col.editableField! })}
                                  onKeyDown={(e) => handleCellKeyDown(e, rowIdx, colIdx)}
                                  className="inline-flex items-center justify-end gap-1 rounded px-1.5 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  title="Edit metric override"
                                >
                                  <span>{display}</span>
                                  {isModifiedCell && (
                                    <span className="size-1.5 rounded-full bg-amber-500" title="Edited actual value" />
                                  )}
                                  <Pencil className="size-3 opacity-0 group-hover:opacity-60 transition-opacity" aria-hidden="true" />
                                </button>
                              ) : (
                                <span
                                  tabIndex={0}
                                  data-grid-cell={`${rowIdx}:${colIdx}`}
                                  onKeyDown={(e) => handleCellKeyDown(e, rowIdx, colIdx)}
                                  className="inline-block rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {display}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/50 font-semibold text-foreground">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 border-r border-border/80 bg-muted/90 px-3 py-2 text-left text-xs uppercase tracking-wider"
                      >
                        Totals ({sortedRows.length})
                      </th>
                      {visibleColumns.map((col) => {
                        const hiddenOnMobile = !mobileColumns.some((mc) => mc.id === col.id);
                        let summaryCell = '—';
                        if (col.id === 'reps' && footerTotals.totalReps > 0) {
                          summaryCell = formatNum(footerTotals.totalReps, 0);
                        } else if (col.id === 'load' && footerTotals.maxLoad !== null) {
                          summaryCell = `max ${formatNum(footerTotals.maxLoad, 1)} ${footerTotals.loadUnit}`;
                        } else if (col.id === 'volume' && footerTotals.totalVolume > 0) {
                          summaryCell = `${formatNum(footerTotals.totalVolume, 0)} ${footerTotals.volumeUnit}`;
                        } else if (col.id === 'distance' && footerTotals.totalDist > 0) {
                          summaryCell = `${formatNum(footerTotals.totalDist, 1)} ${footerTotals.distUnit}`;
                        } else if (col.id === 'split' && footerTotals.totalSplitSec > 0) {
                          summaryCell = formatSummaryDurationMMSS(footerTotals.totalSplitSec * 1000);
                        }
                        return (
                          <td
                            key={col.id}
                            className={cn(
                              'whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums',
                              col.align === 'right' ? 'text-right' : 'text-left',
                              hiddenOnMobile && 'max-sm:hidden',
                            )}
                          >
                            {summaryCell}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: By Movement Rollup */}
      {activeTab === 'movement' && (
        <div data-testid="results-tab-panel-movement" className="overflow-x-auto rounded-xl border border-border bg-card">
          {summary.movementRollup.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No effort-level movements attributed in this workout yet.
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5">Movement</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Sets</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Reps</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Best Load / e1RM</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Volume / Dist</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {summary.movementRollup.map((item) => (
                  <tr key={item.effortSlug} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-medium text-foreground">{item.label}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{item.splits}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {item.totalReps > 0 ? formatNum(item.totalReps, 0) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {item.bestE1rm
                        ? `e1RM ${formatNum(item.bestE1rm, 1)} ${item.volumeUnit ?? ''}`
                        : item.bestWeight
                          ? `${formatNum(item.bestWeight, 1)} ${item.volumeUnit ?? ''}`
                          : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {item.totalVolume > 0
                        ? `${formatNum(item.totalVolume, 0)} ${item.volumeUnit ?? ''}`
                        : item.totalDistance > 0
                          ? `${formatNum(item.totalDistance, 0)} ${item.distanceUnit ?? ''}`
                          : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {formatSummaryDurationMMSS(item.totalElapsedMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: Compare Runs */}
      {activeTab === 'compare' && (
        <div data-testid="results-tab-panel-compare" className="overflow-x-auto rounded-xl border border-border bg-card">
          {compareRuns.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No prior runs recorded for this block yet. Complete another attempt to compare split deltas side-by-side.
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5">Attempt / Date</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Duration</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Volume / Dist</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Reps</th>
                  <th scope="col" className="px-3 py-2.5 text-right">TIS</th>
                  <th scope="col" className="px-3 py-2.5 text-right">RPE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {[run, ...compareRuns].map((cand, idx) => {
                  const s = cand.summary ?? computeRowsRunSummary(cand);
                  const isCurrent = cand.resultId === run.resultId;
                  const deltaMs = !isCurrent && summary.elapsedMs > 0 && s.elapsedMs > 0
                    ? summary.elapsedMs - s.elapsedMs
                    : null;
                  return (
                    <tr
                      key={cand.resultId}
                      className={cn(isCurrent ? 'bg-primary/[0.06] font-medium' : 'hover:bg-muted/20')}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span>
                            {new Date(cand.timestamp).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                          {isCurrent ? (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              Current
                            </span>
                          ) : (
                            onSelectCompareRun && (
                              <button
                                type="button"
                                onClick={() => onSelectCompareRun(cand.resultId)}
                                className="text-xs text-primary underline underline-offset-2"
                              >
                                Open
                              </button>
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        <span>{formatSummaryDurationMMSS(s.elapsedMs)}</span>
                        {deltaMs !== null && idx > 0 && (
                          <span
                            className={cn(
                              'ml-1.5 text-[11px]',
                              deltaMs <= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300',
                            )}
                          >
                            ({deltaMs <= 0 ? '' : '+'}{Math.round(deltaMs / 1000)}s)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {s.totalVolume > 0
                          ? `${formatNum(s.totalVolume, 0)} ${s.volumeUnit ?? ''}`
                          : s.totalDistance > 0
                            ? `${formatNum(s.totalDistance, 0)} ${s.distanceUnit ?? ''}`
                            : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {s.totalReps > 0 ? formatNum(s.totalReps, 0) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {s.tis !== undefined ? `${formatAnalyticsFloat(s.tis)} pts` : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {s.rpe !== undefined ? `${s.rpe}/10` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 4: Raw Events OutputStatementsTable */}
      {activeTab === 'raw' && (() => {
        const events = run.events ?? [];
        let activeMinStart: number | undefined;
        let anyMinStart: number | undefined;
        for (const e of events) {
          const s = e.timeSpan?.started;
          if (typeof s !== 'number' || !Number.isFinite(s)) continue;
          anyMinStart = anyMinStart === undefined ? s : Math.min(anyMinStart, s);
          const key = String(e.sourceBlockKey ?? '').toLowerCase();
          if (e.outputType === 'segment' && !key.startsWith('waiting-to-start')) {
            activeMinStart = activeMinStart === undefined ? s : Math.min(activeMinStart, s);
          }
        }
        const rawTimeOrigin = activeMinStart ?? anyMinStart ?? run.timestamp;
        return (
          <div data-testid="results-tab-panel-raw" className="space-y-2.5">
            <OutputFilterPills
              presets={DEFAULT_OUTPUT_FILTERS.map(normalizeOutputFilter)}
              filter={rawFilter}
              onChange={setRawFilter}
            />
            <OutputStatementsTable
              outputs={events as unknown as OutputStatementRow[]}
              filter={rawFilter}
              timeOrigin={rawTimeOrigin}
              onClearFilter={() => setRawFilter('')}
              onEditMetric={onEditMetric ? (p) => onEditMetric(run.resultId, p) : undefined}
              prHighlights={prHighlights}
            />
          </div>
        );
      })()}

      {/* Bottom Sheet / Dialog Editor */}
      <EditorDialog
        open={Boolean(editCtx)}
        onClose={() => setEditingCell(null)}
        presentation="sheet"
        title={editCtx ? `Edit ${editCtx.label}` : 'Edit Metric'}
      >
        {editCtx && (renderEditSheet ? renderEditSheet(editCtx) : <BuiltInMetricKeypad ctx={editCtx} />)}
      </EditorDialog>
    </div>
  );
}
