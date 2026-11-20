import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Check,
  Columns3,
  Copy,
  FileCode2,
  GitCompareArrows,
  Info,
  Pencil,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  LayoutList,
} from 'lucide-react';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { ClockValueEntry } from '@/clock/ClockValueEntry';
import type { ClockEntry } from '@/clock/clockCommands';
import { cn } from '@/lib/utils';
import {
  computeSplitDerived,
  formatDurationMMSS,
  formatPace,
  formatSignedDeltaSec,
  splitsToCsv,
  type ProtoSplitDerived,
  type ProtoSplitRow,
  type ProtoSummaryMetrics,
  type ProtoWorkoutFixture,
} from './protoData';
import { RpePopoverControl } from './SessionSummaryCard';

export type SpreadsheetTabId = 'splits' | 'movement' | 'compare' | 'raw';
export type ColumnPresetId = 'execution' | 'strength' | 'pacing' | 'all';
export type MobileColumnGroupId = 'core' | 'output' | 'strength';
export type EditableMetricField = 'reps' | 'load' | 'split' | 'distance';

interface SortSpec {
  col: string;
  dir: 'asc' | 'desc';
}

interface ColumnMeta {
  id: string;
  label: string;
  align: 'left' | 'right';
  editableField?: EditableMetricField;
  presets: ColumnPresetId[];
  mobileGroup?: MobileColumnGroupId;
  hasData: (rows: readonly ProtoSplitDerived[]) => boolean;
  sortValue: (row: ProtoSplitDerived) => number | string;
}

const COLUMNS: readonly ColumnMeta[] = [
  {
    id: 'reps',
    label: 'Reps',
    align: 'right',
    editableField: 'reps',
    presets: ['execution', 'strength', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.actualReps != null || r.targetReps != null),
    sortValue: (r) => r.actualReps ?? r.targetReps ?? -1,
  },
  {
    id: 'load',
    label: 'Load (lb)',
    align: 'right',
    editableField: 'load',
    presets: ['execution', 'strength', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.actualLoadLbs != null || r.targetLoadLbs != null),
    sortValue: (r) => r.actualLoadLbs ?? r.targetLoadLbs ?? -1,
  },
  {
    id: 'split',
    label: 'Split',
    align: 'right',
    editableField: 'split',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'core',
    hasData: () => true,
    sortValue: (r) => r.actualDurationSec ?? r.targetDurationSec ?? -1,
  },
  {
    id: 'distance',
    label: 'Distance (m)',
    align: 'right',
    editableField: 'distance',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'core',
    hasData: (rows) => rows.some((r) => r.actualDistanceM != null || r.targetDistanceM != null),
    sortValue: (r) => r.actualDistanceM ?? r.targetDistanceM ?? -1,
  },
  {
    id: 'offset',
    label: 'Offset',
    align: 'right',
    presets: ['execution', 'all'],
    mobileGroup: 'output',
    hasData: () => true,
    sortValue: (r) => r.elapsedOffsetSec,
  },
  {
    id: 'volume',
    label: 'Volume (lb)',
    align: 'right',
    presets: ['execution', 'strength', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.volumeLbs != null),
    sortValue: (r) => r.volumeLbs ?? -1,
  },
  {
    id: 'e1rm',
    label: 'e1RM (lb)',
    align: 'right',
    presets: ['strength', 'all'],
    mobileGroup: 'strength',
    hasData: (rows) => rows.some((r) => r.e1rmLbs != null),
    sortValue: (r) => r.e1rmLbs ?? -1,
  },
  {
    id: 'pct1rm',
    label: '% 1RM',
    align: 'right',
    presets: ['strength', 'all'],
    mobileGroup: 'strength',
    hasData: (rows) => rows.some((r) => r.pct1rm != null),
    sortValue: (r) => r.pct1rm ?? -1,
  },
  {
    id: 'power',
    label: 'Power (lb/s)',
    align: 'right',
    presets: ['pacing', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.powerLbsPerSec != null),
    sortValue: (r) => r.powerLbsPerSec ?? -1,
  },
  {
    id: 'pace',
    label: 'Pace',
    align: 'right',
    presets: ['execution', 'pacing', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.paceSecPerKm != null),
    sortValue: (r) => r.paceSecPerKm ?? -1,
  },
  {
    id: 'hr',
    label: 'HR (bpm)',
    align: 'right',
    presets: ['pacing', 'all'],
    mobileGroup: 'output',
    hasData: (rows) => rows.some((r) => r.hrBpm != null),
    sortValue: (r) => r.hrBpm ?? -1,
  },
];

function fieldLabel(field: EditableMetricField): string {
  switch (field) {
    case 'reps':
      return 'Reps';
    case 'load':
      return 'Load (lb)';
    case 'split':
      return 'Split Duration';
    case 'distance':
      return 'Distance (m)';
  }
}

function getFieldValue(row: ProtoSplitRow, field: EditableMetricField): number | null {
  switch (field) {
    case 'reps':
      return row.actualReps;
    case 'load':
      return row.actualLoadLbs;
    case 'split':
      return row.actualDurationSec;
    case 'distance':
      return row.actualDistanceM;
  }
}

function getTargetValue(row: ProtoSplitRow, field: EditableMetricField): number | null {
  switch (field) {
    case 'reps':
      return row.targetReps;
    case 'load':
      return row.targetLoadLbs;
    case 'split':
      return row.targetDurationSec;
    case 'distance':
      return row.targetDistanceM;
  }
}

function formatCellDisplay(row: ProtoSplitDerived, colId: string): string {
  switch (colId) {
    case 'reps':
      return row.actualReps != null ? String(row.actualReps) : '—';
    case 'load':
      return row.actualLoadLbs != null ? `${row.actualLoadLbs} lb` : '—';
    case 'split':
      return formatDurationMMSS(row.actualDurationSec);
    case 'distance':
      return row.actualDistanceM != null ? `${row.actualDistanceM} m` : '—';
    case 'offset':
      return `+${formatDurationMMSS(row.elapsedOffsetSec)}`;
    case 'volume':
      return row.volumeLbs != null ? row.volumeLbs.toLocaleString() : '—';
    case 'e1rm':
      return row.e1rmLbs != null ? row.e1rmLbs.toFixed(1) : '—';
    case 'pct1rm':
      return row.pct1rm != null ? `${row.pct1rm}%` : '—';
    case 'power':
      return row.powerLbsPerSec != null ? row.powerLbsPerSec.toFixed(1) : '—';
    case 'pace':
      return formatPace(row.paceSecPerKm);
    case 'hr':
      return row.hrBpm != null ? `${row.hrBpm}` : '—';
    default:
      return '—';
  }
}

function formatFooterTotal(
  colId: string,
  rows: readonly ProtoSplitDerived[],
  summary: ProtoSummaryMetrics,
): string {
  switch (colId) {
    case 'reps':
      return summary.totalReps > 0 ? `Σ ${summary.totalReps}` : '—';
    case 'load': {
      const vals = rows
        .map((r) => r.actualLoadLbs)
        .filter((v): v is number => v != null && v > 0);
      if (vals.length === 0) return '—';
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return `Avg ${Math.round(avg * 10) / 10} lb`;
    }
    case 'split':
      return `Σ ${formatDurationMMSS(summary.elapsedSec)}`;
    case 'distance':
      return summary.totalDistanceM != null ? `Σ ${summary.totalDistanceM} m` : '—';
    case 'offset':
      return formatDurationMMSS(summary.elapsedSec);
    case 'volume':
      return summary.totalVolumeLbs != null
        ? `Σ ${summary.totalVolumeLbs.toLocaleString()}`
        : '—';
    case 'e1rm':
      return summary.maxE1rmLbs != null ? `Max ${summary.maxE1rmLbs.toFixed(1)}` : '—';
    case 'pct1rm': {
      const vals = rows.map((r) => r.pct1rm).filter((v): v is number => v != null);
      if (vals.length === 0) return '—';
      return `Avg ${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}%`;
    }
    case 'power': {
      const vals = rows.map((r) => r.powerLbsPerSec).filter((v): v is number => v != null);
      if (vals.length === 0) return '—';
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return `Avg ${avg.toFixed(1)}`;
    }
    case 'pace':
      return summary.avgPaceSecPerKm != null
        ? `Avg ${formatPace(summary.avgPaceSecPerKm)}`
        : '—';
    case 'hr': {
      const vals = rows.map((r) => r.hrBpm).filter((v): v is number => v != null);
      if (vals.length === 0) return '—';
      return `Avg ${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)}`;
    }
    default:
      return '—';
  }
}

export interface ResultsSpreadsheetViewProps {
  fixture: ProtoWorkoutFixture;
  splits: readonly ProtoSplitRow[];
  summary: ProtoSummaryMetrics;
  rpe: number | null;
  compactMobile: boolean;
  onUpdateCell: (splitId: string, field: EditableMetricField, value: number | null) => void;
  onResetSplit: (splitId: string) => void;
  onChangeRpe: (nextRpe: number) => void;
  onBackToNote: () => void;
  onOpenAddToDashboard: () => void;
}

export function ResultsSpreadsheetView({
  fixture,
  splits,
  summary,
  rpe,
  compactMobile,
  onUpdateCell,
  onResetSplit,
  onChangeRpe,
  onBackToNote,
  onOpenAddToDashboard,
}: ResultsSpreadsheetViewProps) {
  const [activeTab, setActiveTab] = useState<SpreadsheetTabId>('splits');
  const [preset, setPreset] = useState<ColumnPresetId>('execution');
  const [mobileGroup, setMobileGroup] = useState<MobileColumnGroupId>('core');
  const [mobileDisplay, setMobileDisplay] = useState<'sheet' | 'cards'>('sheet');
  const [runScope, setRunScope] = useState<'current' | 'vs-prior' | 'all'>('current');
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>([]);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set());
  const [focusedCell, setFocusedCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{
    splitId: string;
    field: EditableMetricField;
    draft: string;
    error?: string;
  } | null>(null);
  const [mobileSheetEdit, setMobileSheetEdit] = useState<{
    splitId: string;
    field: EditableMetricField;
  } | null>(null);
  const [csvCopied, setCsvCopied] = useState(false);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayNote, setReplayNote] = useState<string | null>(null);

  const columnMenuRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    setSortSpecs([]);
    setInlineEdit(null);
    setMobileSheetEdit(null);
    setFocusedCell(null);
    setReplayNote(null);
  }, [fixture.id]);

  useEffect(() => {
    if (!columnMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [columnMenuOpen]);

  const derivedRows = useMemo(() => computeSplitDerived(splits), [splits]);

  const populatedColumns = useMemo(
    () => COLUMNS.filter((c) => c.hasData(derivedRows)),
    [derivedRows],
  );

  const visibleColumns = useMemo(() => {
    if (compactMobile) {
      const groupCols = populatedColumns.filter((c) => c.mobileGroup === mobileGroup);
      return groupCols.length > 0 ? groupCols : populatedColumns.slice(0, 3);
    }
    return populatedColumns.filter(
      (c) => (preset === 'all' || c.presets.includes(preset)) && !hiddenCols.has(c.id),
    );
  }, [compactMobile, populatedColumns, mobileGroup, preset, hiddenCols]);

  const sortedRows = useMemo(() => {
    const copy = [...derivedRows];
    if (sortSpecs.length === 0) return copy;
    copy.sort((a, b) => {
      for (const spec of sortSpecs) {
        const col = COLUMNS.find((c) => c.id === spec.col);
        if (!col) continue;
        const va = col.sortValue(a);
        const vb = col.sortValue(b);
        const cmp =
          typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb));
        if (cmp !== 0) return spec.dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    return copy;
  }, [derivedRows, sortSpecs]);

  const handleSortClick = (colId: string, shiftKey: boolean) => {
    setSortSpecs((prev) => {
      const existing = prev.find((s) => s.col === colId);
      if (shiftKey) {
        if (!existing) return [...prev, { col: colId, dir: 'asc' }];
        if (existing.dir === 'asc') {
          return prev.map((s) => (s.col === colId ? { ...s, dir: 'desc' } : s));
        }
        return prev.filter((s) => s.col !== colId);
      }
      if (!existing) return [{ col: colId, dir: 'asc' }];
      if (existing.dir === 'asc') return [{ col: colId, dir: 'desc' }];
      return [];
    });
  };

  const handleCopyCsv = () => {
    const csv = splitsToCsv(fixture, splits);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(csv).catch(() => {});
    }
    setCsvCopied(true);
    setTimeout(() => setCsvCopied(false), 1800);
  };

  const handleReplayAnalytics = () => {
    setReplaying(true);
    setReplayNote(null);
    setTimeout(() => {
      setReplaying(false);
      setReplayNote('Analytics recomputed in place from pinned workout v1.');
    }, 300);
  };

  const startDesktopInlineEdit = (row: ProtoSplitDerived, col: ColumnMeta) => {
    if (!col.editableField) return;
    const current = getFieldValue(row, col.editableField);
    const initialDraft =
      col.editableField === 'split'
        ? formatDurationMMSS(current)
        : current != null
          ? String(current)
          : '';
    setInlineEdit({
      splitId: row.id,
      field: col.editableField,
      draft: initialDraft,
    });
  };

  const commitDesktopInlineEdit = () => {
    if (!inlineEdit) return;
    const trimmed = inlineEdit.draft.trim();
    if (!trimmed) {
      setInlineEdit((prev) => (prev ? { ...prev, error: 'Enter a value' } : null));
      return;
    }

    let parsedNum: number;
    if (inlineEdit.field === 'split') {
      const parts = /^(\d+):(\d{1,2})$/.exec(trimmed);
      if (parts) {
        parsedNum = Number(parts[1]) * 60 + Number(parts[2]);
      } else {
        parsedNum = Number(trimmed);
      }
    } else {
      parsedNum = Number(trimmed);
    }

    if (!Number.isFinite(parsedNum) || parsedNum < 0) {
      setInlineEdit((prev) =>
        prev ? { ...prev, error: 'Enter a valid number ≥ 0' } : null,
      );
      return;
    }
    if (inlineEdit.field === 'reps' && !Number.isSafeInteger(parsedNum)) {
      setInlineEdit((prev) =>
        prev ? { ...prev, error: 'Reps must be a whole number' } : null,
      );
      return;
    }

    onUpdateCell(inlineEdit.splitId, inlineEdit.field, parsedNum);
    setInlineEdit(null);
  };

  const handleGridKeyDown = (
    e: React.KeyboardEvent,
    rowIdx: number,
    colIdx: number,
    row: ProtoSplitDerived,
    col: ColumnMeta,
  ) => {
    if (inlineEdit) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      let nextRow = rowIdx;
      let nextCol = colIdx;
      if (e.key === 'ArrowRight') nextCol = Math.min(visibleColumns.length - 1, colIdx + 1);
      if (e.key === 'ArrowLeft') nextCol = Math.max(0, colIdx - 1);
      if (e.key === 'ArrowDown') nextRow = Math.min(sortedRows.length - 1, rowIdx + 1);
      if (e.key === 'ArrowUp') nextRow = Math.max(0, rowIdx - 1);
      setFocusedCell({ rowIdx: nextRow, colIdx: nextCol });
      cellRefs.current.get(`${nextRow}:${nextCol}`)?.focus();
    } else if (e.key === 'Enter' && col.editableField) {
      e.preventDefault();
      if (compactMobile) {
        setMobileSheetEdit({ splitId: row.id, field: col.editableField });
      } else {
        startDesktopInlineEdit(row, col);
      }
    }
  };

  const activeMobileRow = mobileSheetEdit
    ? derivedRows.find((r) => r.id === mobileSheetEdit.splitId)
    : undefined;

  const mobileClockEntry: ClockEntry | null = useMemo(() => {
    if (!mobileSheetEdit || !activeMobileRow) return null;
    const current = getFieldValue(activeMobileRow, mobileSheetEdit.field);
    return {
      fieldId: `${activeMobileRow.id}:${mobileSheetEdit.field}`,
      label: `${activeMobileRow.movement} · ${fieldLabel(mobileSheetEdit.field)}`,
      metricType: mobileSheetEdit.field,
      domain:
        mobileSheetEdit.field === 'split'
          ? 'duration'
          : mobileSheetEdit.field === 'reps'
            ? 'integer'
            : 'decimal',
      intent: 'actual',
      required: false,
      value: current,
      unit:
        mobileSheetEdit.field === 'load'
          ? 'lb'
          : mobileSheetEdit.field === 'distance'
            ? 'm'
            : '',
      index: 0,
      total: 1,
    };
  }, [mobileSheetEdit, activeMobileRow]);

  const mobileInitialDraft = useMemo(() => {
    if (!mobileSheetEdit || !activeMobileRow) return '';
    const current = getFieldValue(activeMobileRow, mobileSheetEdit.field);
    if (current == null) return '';
    if (mobileSheetEdit.field === 'split') return formatDurationMMSS(current);
    return String(current);
  }, [mobileSheetEdit, activeMobileRow]);

  return (
    <div
      className={cn('space-y-4', compactMobile && 'pb-20')}
      data-testid="proto-results-spreadsheet-view"
    >
      {/* Dedicated Session Header — zero debug clutter atop the table */}
      <header className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5 sm:py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <button
              type="button"
              data-testid="proto-back-to-note"
              onClick={onBackToNote}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
              )}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>Note</span>
            </button>
            <h2 className="text-base sm:text-lg font-bold text-foreground truncate">
              {fixture.title}
            </h2>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {fixture.notebookTitle}
            </span>
          </div>

          {!compactMobile && (
            <div className="flex flex-wrap items-center gap-2">
              <RpePopoverControl rpe={rpe} onChange={onChangeRpe} />
              <button
                type="button"
                data-testid="proto-copy-csv"
                onClick={handleCopyCsv}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {csvCopied ? (
                  <Check className="size-3.5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
                <span>{csvCopied ? 'Copied CSV' : 'Copy CSV'}</span>
              </button>
              <button
                type="button"
                data-testid="proto-source-drawer-btn"
                onClick={() => setSourceDrawerOpen(true)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileCode2 className="size-3.5" aria-hidden="true" />
                <span>Source &amp; History</span>
              </button>
              <button
                type="button"
                data-testid="proto-spreadsheet-add-dashboard"
                onClick={onOpenAddToDashboard}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BarChart3 className="size-3.5" aria-hidden="true" />
                <span>Add to Dashboard</span>
              </button>
            </div>
          )}
        </div>

        {/* Compact inline KPI summary strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 tabular-nums">
            <div>
              <span className="text-muted-foreground">Time: </span>
              <span className="font-bold text-foreground">
                {formatDurationMMSS(summary.elapsedSec)}
              </span>
              {summary.priorDeltaSec != null && (
                <span className="ml-1.5 font-medium text-emerald-800 dark:text-emerald-300">
                  ({formatSignedDeltaSec(summary.priorDeltaSec)} vs prior)
                </span>
              )}
            </div>
            {summary.totalVolumeLbs != null && (
              <div>
                <span className="text-muted-foreground">Volume: </span>
                <span className="font-bold text-foreground">
                  {summary.totalVolumeLbs.toLocaleString()} lb
                </span>
              </div>
            )}
            {summary.totalDistanceM != null && (
              <div>
                <span className="text-muted-foreground">Distance: </span>
                <span className="font-bold text-foreground">
                  {(summary.totalDistanceM / 1000).toFixed(2)} km
                </span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">TIS: </span>
              <span className="font-bold text-foreground">{summary.tis.toFixed(1)} pts</span>
            </div>
            <div>
              <span className="text-muted-foreground">Load: </span>
              <span className="font-bold text-foreground">{summary.sessionLoadAu} AU</span>
            </div>
          </div>

          {/* Run Scope Switcher */}
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            {(
              [
                ['current', `${fixture.attemptLabel}`],
                ['vs-prior', 'Compare vs prior'],
                ['all', `All ${fixture.priorRuns.length + 1} runs`],
              ] as const
            ).map(([scopeId, label]) => (
              <button
                key={scopeId}
                type="button"
                aria-pressed={runScope === scopeId}
                onClick={() => {
                  setRunScope(scopeId);
                  if (scopeId !== 'current') setActiveTab('compare');
                }}
                className={cn(
                  'rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-7',
                  runScope === scopeId
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Graceful fallback banner when session has no runtime segment events */}
      {!fixture.hasSegments && (
        <div
          role="status"
          data-testid="proto-manual-log-fallback-banner"
          className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/35 px-4 py-3 text-xs text-foreground"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <span className="font-semibold">Summary-only / manual log session:</span>{' '}
            <span className="text-muted-foreground">
              This entry has no live timer segment events, so the Results view automatically projects
              your logged sets into the editable spreadsheet instead of showing an empty segment filter.
            </span>
          </div>
        </div>
      )}

      {/* Workbench Tabs + Preset / Column Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Results view modes"
          className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
        >
          {(
            [
              ['splits', 'Splits'],
              ['movement', 'By Movement'],
              ['compare', 'Compare Runs'],
              ['raw', 'Raw Events'],
            ] as const
          ).map(([tabId, label]) => (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={activeTab === tabId}
              data-testid={`proto-tab-${tabId}`}
              onClick={() => setActiveTab(tabId)}
              className={cn(
                'rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                compactMobile ? 'min-h-11' : 'min-h-11 sm:min-h-8',
                activeTab === tabId
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'splits' && !compactMobile && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {(
                [
                  ['execution', 'Execution'],
                  ['strength', 'Strength / e1RM'],
                  ['pacing', 'Pacing / Power'],
                  ['all', 'All Columns'],
                ] as const
              ).map(([presetId, label]) => (
                <button
                  key={presetId}
                  type="button"
                  aria-pressed={preset === presetId}
                  onClick={() => setPreset(presetId)}
                  className={cn(
                    'min-h-8 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    preset === presetId
                      ? 'bg-muted text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div ref={columnMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={columnMenuOpen}
                onClick={() => setColumnMenuOpen((v) => !v)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Columns3 className="size-3.5" aria-hidden="true" />
                <span>Columns</span>
              </button>
              {columnMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    Show / Hide Columns
                  </div>
                  {populatedColumns.map((col) => {
                    const checked = !hiddenCols.has(col.id);
                    return (
                      <label
                        key={col.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setHiddenCols((prev) => {
                              const next = new Set(prev);
                              if (next.has(col.id)) next.delete(col.id);
                              else next.add(col.id);
                              return next;
                            });
                          }}
                          className="rounded border-border"
                        />
                        <span>{col.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* TAB 1: SPLITS SPREADSHEET (Desktop + Mobile) */}
      {activeTab === 'splits' && (
        <div className="space-y-2">
          {/* Mobile 3-column group pills + Table/Cards toggle */}
          {compactMobile && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                role="group"
                aria-label="Mobile column groups"
                className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
              >
                {(
                  [
                    ['core', fixture.domain === 'endurance' ? 'Dist · Split · Pace' : 'Reps · Load · Split'],
                    ['output', 'Vol · Power · Offset'],
                    ['strength', 'e1RM · %1RM'],
                  ] as const
                ).map(([groupId, label]) => (
                  <button
                    key={groupId}
                    type="button"
                    data-testid={`proto-mobile-colgroup-${groupId}`}
                    aria-pressed={mobileGroup === groupId}
                    onClick={() => setMobileGroup(groupId)}
                    className={cn(
                      'min-h-11 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      mobileGroup === groupId
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="inline-flex rounded-xl border border-border bg-card p-1">
                <button
                  type="button"
                  aria-label="Mobile spreadsheet table view"
                  aria-pressed={mobileDisplay === 'sheet'}
                  onClick={() => setMobileDisplay('sheet')}
                  className={cn(
                    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium',
                    mobileDisplay === 'sheet'
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  <Table2 className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Mobile card list view"
                  aria-pressed={mobileDisplay === 'cards'}
                  onClick={() => setMobileDisplay('cards')}
                  className={cn(
                    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2.5 text-xs font-medium',
                    mobileDisplay === 'cards'
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  <LayoutList className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {compactMobile && mobileDisplay === 'cards' ? (
            /* Optional Mobile Card list view with tap-to-edit bottom sheet */
            <div className="space-y-2.5" data-testid="proto-mobile-cards-list">
              {sortedRows.map((row) => (
                <article
                  key={row.id}
                  className="rounded-xl border border-border bg-card p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground">
                        R{row.round}
                      </span>
                      <span className="text-sm font-semibold text-foreground truncate">
                        {row.movement}
                      </span>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      +{formatDurationMMSS(row.elapsedOffsetSec)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['reps', 'load', 'split'] as const).map((field) => {
                      const val =
                        field === 'reps'
                          ? row.actualReps != null
                            ? `${row.actualReps}`
                            : '—'
                          : field === 'load'
                            ? row.actualLoadLbs != null
                              ? `${row.actualLoadLbs} lb`
                              : '—'
                            : formatDurationMMSS(row.actualDurationSec);
                      return (
                        <button
                          key={field}
                          type="button"
                          onClick={() => setMobileSheetEdit({ splitId: row.id, field })}
                          className="min-h-11 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left hover:bg-muted transition-colors"
                        >
                          <div className="text-xs text-muted-foreground capitalize">
                            {field}
                          </div>
                          <div className="font-mono text-xs font-semibold tabular-nums text-foreground">
                            {val}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            /* True Spreadsheet Grid (Desktop + Mobile Frozen-Left Scrollable Table) */
            <div
              className="overflow-x-auto rounded-xl border border-border bg-card"
              data-testid="proto-spreadsheet-scroll-container"
            >
              <table
                data-testid="proto-results-spreadsheet"
                className="w-full border-collapse text-left text-xs"
              >
                <thead>
                  <tr className="border-b border-border bg-muted text-foreground">
                    <th
                      scope="col"
                      className={cn(
                        'sticky left-0 z-20 bg-muted border-r border-border px-3 py-2.5 text-left font-semibold whitespace-nowrap',
                        compactMobile ? 'min-w-[126px] max-w-[136px]' : 'min-w-[180px]',
                      )}
                    >
                      {compactMobile ? 'Rd · Movement' : '# · Round · Movement'}
                    </th>
                    {visibleColumns.map((col) => {
                      const sortIdx = sortSpecs.findIndex((s) => s.col === col.id);
                      const sortEntry = sortIdx >= 0 ? sortSpecs[sortIdx] : undefined;
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
                          className="px-2 py-1.5 text-right font-semibold whitespace-nowrap"
                        >
                          <button
                            type="button"
                            data-testid={`proto-sort-${col.id}`}
                            onClick={(e) => handleSortClick(col.id, e.shiftKey)}
                            className={cn(
                              'inline-flex w-full items-center justify-end gap-1 rounded px-1.5 text-xs font-semibold text-foreground hover:bg-background/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              compactMobile ? 'min-h-11' : 'min-h-8',
                            )}
                          >
                            <span>{col.label}</span>
                            {sortEntry ? (
                              <span className="inline-flex items-center text-primary">
                                {sortSpecs.length > 1 && (
                                  <span className="mr-0.5 text-xs tabular-nums">
                                    {sortIdx + 1}
                                  </span>
                                )}
                                {sortEntry.dir === 'asc' ? (
                                  <ArrowUp className="size-3.5" aria-hidden="true" />
                                ) : (
                                  <ArrowDown className="size-3.5" aria-hidden="true" />
                                )}
                              </span>
                            ) : (
                              <ArrowUpDown
                                className="size-3 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody className="divide-y divide-border/60">
                  {sortedRows.map((row, rowIdx) => (
                    <tr
                      key={row.id}
                      data-testid={`proto-spreadsheet-row-${row.id}`}
                      className="group bg-card hover:bg-muted transition-colors"
                    >
                      {/* Frozen opaque left identity cell */}
                      <th
                        scope="row"
                        className="sticky left-0 z-10 border-r border-border bg-card group-hover:bg-muted px-3 py-2 text-left font-medium text-foreground whitespace-nowrap transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex min-w-6 items-center justify-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground tabular-nums">
                            R{row.round}
                          </span>
                          <span className="truncate font-semibold text-foreground">
                            {row.movement}
                          </span>
                        </div>
                      </th>

                      {visibleColumns.map((col, colIdx) => {
                        const isFocused =
                          focusedCell?.rowIdx === rowIdx && focusedCell?.colIdx === colIdx;
                        const isInlineEditing =
                          inlineEdit?.splitId === row.id &&
                          inlineEdit.field === col.editableField;
                        const displayVal = formatCellDisplay(row, col.id);

                        const targetVal = col.editableField
                          ? getTargetValue(row, col.editableField)
                          : null;
                        const actualVal = col.editableField
                          ? getFieldValue(row, col.editableField)
                          : null;
                        const cellModified =
                          col.editableField != null &&
                          actualVal != null &&
                          targetVal != null &&
                          actualVal !== targetVal;

                        if (isInlineEditing && inlineEdit) {
                          return (
                            <td
                              key={col.id}
                              className="px-2 py-1 text-right whitespace-nowrap bg-card"
                            >
                              <form
                                className="inline-flex flex-col items-end gap-1"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  commitDesktopInlineEdit();
                                }}
                              >
                                <div className="inline-flex items-center gap-1">
                                  <input
                                    type="text"
                                    autoFocus
                                    aria-label={`Edit ${row.movement} ${col.label}`}
                                    data-testid="proto-inline-cell-input"
                                    value={inlineEdit.draft}
                                    onChange={(e) =>
                                      setInlineEdit((prev) =>
                                        prev
                                          ? { ...prev, draft: e.target.value, error: undefined }
                                          : null,
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        e.stopPropagation();
                                        setInlineEdit(null);
                                      }
                                    }}
                                    className="w-20 rounded-md border border-primary bg-background px-2 py-1 text-right font-mono text-xs tabular-nums text-foreground focus:outline-none"
                                  />
                                  <button
                                    type="submit"
                                    data-testid="proto-inline-cell-save"
                                    className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                                  >
                                    Save
                                  </button>
                                  {cellModified && (
                                    <button
                                      type="button"
                                      aria-label={`Revert ${row.movement} ${col.label} to target`}
                                      onClick={() => {
                                        if (col.editableField) {
                                          onUpdateCell(row.id, col.editableField, targetVal);
                                        }
                                        setInlineEdit(null);
                                      }}
                                      className="rounded-md border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
                                    >
                                      <RotateCcw className="size-3.5" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                                {inlineEdit.error && (
                                  <span role="alert" className="text-xs text-destructive">
                                    {inlineEdit.error}
                                  </span>
                                )}
                              </form>
                            </td>
                          );
                        }

                        if (col.editableField) {
                          return (
                            <td key={col.id} className="px-1.5 py-1 text-right whitespace-nowrap">
                              <button
                                type="button"
                                ref={(el) => {
                                  const key = `${rowIdx}:${colIdx}`;
                                  if (el) cellRefs.current.set(key, el);
                                  else cellRefs.current.delete(key);
                                }}
                                data-testid={`proto-cell-${row.id}-${col.id}`}
                                onFocus={() => setFocusedCell({ rowIdx, colIdx })}
                                onKeyDown={(e) => handleGridKeyDown(e, rowIdx, colIdx, row, col)}
                                onClick={() => {
                                  if (compactMobile) {
                                    setMobileSheetEdit({
                                      splitId: row.id,
                                      field: col.editableField!,
                                    });
                                  } else {
                                    startDesktopInlineEdit(row, col);
                                  }
                                }}
                                title={`Edit ${row.movement} ${col.label}`}
                                className={cn(
                                  'group/cell inline-flex w-full items-center justify-end gap-1.5 rounded-md px-2 font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  compactMobile ? 'min-h-11' : 'min-h-8',
                                  isFocused && 'ring-1 ring-primary/60',
                                  cellModified
                                    ? 'bg-amber-500/10 text-amber-900 dark:text-amber-200 font-semibold'
                                    : 'text-foreground hover:bg-background/80',
                                )}
                              >
                                <Pencil
                                  className="size-3 opacity-0 group-hover/cell:opacity-70 group-focus-visible/cell:opacity-70 text-muted-foreground transition-opacity"
                                  aria-hidden="true"
                                />
                                <span>{displayVal}</span>
                                {cellModified && targetVal != null && (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    (vs {col.editableField === 'split' ? formatDurationMMSS(targetVal) : targetVal})
                                  </span>
                                )}
                              </button>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={col.id}
                            tabIndex={0}
                            ref={(el) => {
                              const key = `${rowIdx}:${colIdx}`;
                              if (el) cellRefs.current.set(key, el);
                              else cellRefs.current.delete(key);
                            }}
                            onFocus={() => setFocusedCell({ rowIdx, colIdx })}
                            onKeyDown={(e) => handleGridKeyDown(e, rowIdx, colIdx, row, col)}
                            title="Computed metric (updates automatically when actuals change)"
                            className={cn(
                              'px-3 py-2 text-right font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              isFocused && 'bg-muted/70 text-foreground',
                            )}
                          >
                            {displayVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr className="border-t-2 border-border bg-muted font-mono text-xs font-bold text-foreground">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-2.5 text-left font-sans font-bold text-foreground whitespace-nowrap"
                    >
                      Total / Avg
                    </th>
                    {visibleColumns.map((col) => (
                      <td
                        key={col.id}
                        data-testid={`proto-footer-${col.id}`}
                        className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap"
                      >
                        {formatFooterTotal(col.id, derivedRows, summary)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {compactMobile
              ? 'Frozen left column stays pinned as you swipe. Tap any Reps, Load, Split, or Distance cell to edit via the bottom keypad.'
              : 'Tip: Use Arrow keys to navigate cells, Enter or click to edit actuals, and Shift+Click column headers for multi-column sorting.'}
          </p>
        </div>
      )}

      {/* TAB 2: BY MOVEMENT ROLLUP */}
      {activeTab === 'movement' && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted text-foreground">
                <th className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-2.5 font-semibold">
                  Movement
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Sets</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total Reps</th>
                <th className="px-3 py-2.5 text-right font-semibold">Avg Load</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total Volume</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total Time</th>
                <th className="px-3 py-2.5 text-right font-semibold">Best e1RM / Pace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {summary.movementRollup.map((m) => (
                <tr key={m.effortSlug} className="group bg-card hover:bg-muted">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-border bg-card group-hover:bg-muted px-3 py-2.5 font-semibold text-foreground whitespace-nowrap"
                  >
                    {m.movement}
                  </th>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{m.sets}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {m.totalReps > 0 ? m.totalReps : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {m.avgLoadLbs != null ? `${m.avgLoadLbs} lb` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {m.totalVolumeLbs != null ? `${m.totalVolumeLbs.toLocaleString()} lb` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {formatDurationMMSS(m.totalDurationSec)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {m.bestE1rmLbs != null
                      ? `${m.bestE1rmLbs.toFixed(1)} lb e1RM`
                      : m.avgPaceSecPerKm != null
                        ? formatPace(m.avgPaceSecPerKm)
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: COMPARE RUNS */}
      {activeTab === 'compare' && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted text-foreground">
                <th className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-2.5 font-semibold">
                  Split
                </th>
                {fixture.priorRuns.map((pr) => (
                  <th key={pr.resultId} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                    {pr.attemptLabel} ({pr.dateLabel})
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap text-primary">
                  {fixture.attemptLabel} (Current)
                </th>
                <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                  Delta vs Last
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {derivedRows.map((row, idx) => {
                const curr = row.actualDurationSec ?? row.targetDurationSec ?? 0;
                const latestPrior = fixture.priorRuns[fixture.priorRuns.length - 1];
                const prevDur = latestPrior?.splitDurationsSec[idx];
                const delta = prevDur != null ? curr - prevDur : null;
                return (
                  <tr key={row.id} className="group bg-card hover:bg-muted">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-border bg-card group-hover:bg-muted px-3 py-2 font-semibold text-foreground whitespace-nowrap"
                    >
                      R{row.round} · {row.movement}
                    </th>
                    {fixture.priorRuns.map((pr) => (
                      <td
                        key={pr.resultId}
                        className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground"
                      >
                        {formatDurationMMSS(pr.splitDurationsSec[idx])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-foreground">
                      {formatDurationMMSS(curr)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-mono font-semibold tabular-nums',
                        delta != null && delta < 0
                          ? 'text-emerald-800 dark:text-emerald-300'
                          : delta != null && delta > 0
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {delta != null ? formatSignedDeltaSec(delta) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted font-mono text-xs font-bold text-foreground">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-border bg-muted px-3 py-2.5 text-left font-sans font-bold"
                >
                  Total Elapsed
                </th>
                {fixture.priorRuns.map((pr) => (
                  <td key={pr.resultId} className="px-3 py-2.5 text-right tabular-nums">
                    {formatDurationMMSS(pr.elapsedSec)}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right tabular-nums text-primary">
                  {formatDurationMMSS(summary.elapsedSec)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-800 dark:text-emerald-300">
                  {summary.priorDeltaSec != null
                    ? formatSignedDeltaSec(summary.priorDeltaSec)
                    : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* TAB 4: RAW EVENTS (Debug Frames Isolated from Main View) */}
      {activeTab === 'raw' && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full border-collapse text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-border bg-muted text-foreground">
                <th className="px-3 py-2.5 font-semibold">Offset</th>
                <th className="px-3 py-2.5 font-semibold">Type</th>
                <th className="px-3 py-2.5 font-semibold">Source Block Key</th>
                <th className="px-3 py-2.5 font-semibold">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {fixture.rawFrames.map((frame) => (
                <tr key={frame.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    +{formatDurationMMSS(frame.offsetSec)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                      {frame.outputType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground">{frame.sourceBlockKey}</td>
                  <td className="px-3 py-2 text-muted-foreground">{frame.payloadPreview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile Sticky Bottom Action Bar */}
      {compactMobile && (
        <div className="sticky bottom-2 z-20 flex items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
          <RpePopoverControl rpe={rpe} onChange={onChangeRpe} compact />
          <button
            type="button"
            onClick={() => setActiveTab('compare')}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
          >
            <GitCompareArrows className="size-3.5" aria-hidden="true" />
            <span>Compare</span>
          </button>
          <button
            type="button"
            data-testid="proto-mobile-add-dashboard"
            onClick={onOpenAddToDashboard}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <BarChart3 className="size-3.5" aria-hidden="true" />
            <span>Add to Dashboard</span>
          </button>
        </div>
      )}

      {/* Mobile Tap-to-Edit Bottom Sheet via ClockValueEntry */}
      <EditorDialog
        open={Boolean(mobileSheetEdit && mobileClockEntry)}
        onClose={() => setMobileSheetEdit(null)}
        presentation="sheet"
        title={
          activeMobileRow && mobileSheetEdit
            ? `Edit ${activeMobileRow.movement} · ${fieldLabel(mobileSheetEdit.field)}`
            : 'Edit metric'
        }
        description={
          activeMobileRow && mobileSheetEdit
            ? `Round ${activeMobileRow.round} · Target: ${
                getTargetValue(activeMobileRow, mobileSheetEdit.field) ?? 'none'
              }`
            : undefined
        }
      >
        {mobileSheetEdit && activeMobileRow && mobileClockEntry && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Target:{' '}
                <strong className="font-mono text-foreground">
                  {(() => {
                    const t = getTargetValue(activeMobileRow, mobileSheetEdit.field);
                    if (t == null) return '—';
                    return mobileSheetEdit.field === 'split'
                      ? formatDurationMMSS(t)
                      : String(t);
                  })()}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  onResetSplit(activeMobileRow.id);
                  setMobileSheetEdit(null);
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                <span>Reset row</span>
              </button>
            </div>

            {/* Quick Delta Chips */}
            <div className="grid grid-cols-4 gap-2">
              {(mobileSheetEdit.field === 'load'
                ? [-10, -5, 5, 10]
                : mobileSheetEdit.field === 'split'
                  ? [-5, -1, 1, 5]
                  : [-5, -1, 1, 5]
              ).map((delta) => {
                const current = getFieldValue(activeMobileRow, mobileSheetEdit.field) ?? 0;
                return (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => {
                      const next = Math.max(0, current + delta);
                      onUpdateCell(activeMobileRow.id, mobileSheetEdit.field, next);
                      setMobileSheetEdit(null);
                    }}
                    className="min-h-11 rounded-lg border border-border bg-background font-mono text-xs font-semibold tabular-nums text-foreground hover:bg-muted"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                    {mobileSheetEdit.field === 'split' ? 's' : ''}
                  </button>
                );
              })}
            </div>

            <ClockValueEntry
              key={mobileClockEntry.fieldId}
              entry={mobileClockEntry}
              initialDraft={mobileInitialDraft}
              saving={false}
              error={null}
              onSave={(val) => {
                onUpdateCell(activeMobileRow.id, mobileSheetEdit.field, val);
                setMobileSheetEdit(null);
              }}
              onCancel={() => setMobileSheetEdit(null)}
            />
          </div>
        )}
      </EditorDialog>

      {/* Collapsible Source & History Slide-Over Drawer */}
      <EditorDialog
        open={sourceDrawerOpen}
        onClose={() => setSourceDrawerOpen(false)}
        presentation="sheet"
        title="Pinned Workout Source & Block History"
        description={`Result ${fixture.resultId} · ${fixture.blockContentId}`}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-foreground">
              Saved workout block used by this session (v1)
            </h3>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
              {`\`\`\`${fixture.wodBlockTag}\n${fixture.wodScript}\n\`\`\``}
            </pre>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleReplayAnalytics}
                disabled={replaying}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw
                  className={cn('size-3.5', replaying && 'animate-spin')}
                  aria-hidden="true"
                />
                <span>{replaying ? 'Replaying…' : 'Replay saved analytics'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyCsv}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                <span>{csvCopied ? 'Copied CSV' : 'Export CSV'}</span>
              </button>
            </div>
            {replayNote && (
              <p role="status" className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                {replayNote}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <h3 className="text-xs font-semibold text-foreground">Block Revisions</h3>
            <ul className="divide-y divide-border/60 text-xs">
              <li className="flex items-center justify-between py-2">
                <span className="font-mono font-medium text-foreground">v1 · Current pinned</span>
                <span className="text-muted-foreground">{fixture.dateLabel}</span>
              </li>
              {fixture.priorRuns.map((pr) => (
                <li key={pr.resultId} className="flex items-center justify-between py-2">
                  <span className="font-mono text-muted-foreground">
                    {pr.attemptLabel} · {formatDurationMMSS(pr.elapsedSec)}
                  </span>
                  <span className="text-muted-foreground">{pr.dateLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </EditorDialog>
    </div>
  );
}
