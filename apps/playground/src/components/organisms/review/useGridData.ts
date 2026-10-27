/**
 * Review Grid — useGridData Hook
 *
 * Transforms Segment[] (from AnalyticsTransformer) + user overrides into
 * GridRow[] / ColumnDef[] ready for table rendering via the CDL ColumnSet.
 *
 * Responsibilities:
 * - Pivot metrics from each segment into column-keyed cells
 * - Merge user overrides on top of runtime metric
 * - Apply preset filters, column filters, and global search
 * - Apply sorting (single or multi-column)
 * - Use ColumnSet for visibility, ordering, and discoverability
 */

import { useMemo } from 'react';
import { MetricType, type IMetric } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import type { Segment } from '@bitcobblers/wod-wiki-engine';
import type {
  GridRow,
  GridCell,
  GridFilterConfig,
  GridSortConfig,
} from './types';
import { GRID_COLUMN_SET_CONFIG, makeMetricColumn } from './cdlColumnDefinitions';
import { ColumnSet } from './ColumnSet';
import type { ColumnSetContext } from './ColumnSet';
import type { ColumnDef, ComputeContext } from './column-definition-language';
import {
  extractSortValue,
  compareSortValues,
  extractFilterText,
  matchColumnFilter,
} from './interpreters';

// ─── Public Hook ───────────────────────────────────────────────

export interface UseGridDataOptions {
  /** Analytics segments produced by AnalyticsTransformer */
  segments: Segment[];
  /** User-supplied overrides keyed by sourceBlockKey */
  userOutputOverrides: Map<string, MetricContainer>;
  /** Active preset id */
  presetId: string;
  /** Whether the workbench is in debug mode */
  isDebugMode: boolean;
  /** Current sort configuration (may be empty) */
  sortConfigs: GridSortConfig[];
  /** Additional filter overrides on top of the preset's filters */
  filterOverrides?: Partial<GridFilterConfig>;
  /** Columns currently tagged for graphing (column ids) */
  graphTaggedColumns?: Set<string>;
  /** User-added metric types to show as columns even when no segment data exists */
  extraMetricTypes?: Set<MetricType>;
  /** Per-column visibility overrides from user (id → forced visible/hidden) */
  columnVisibilityOverrides?: Record<string, boolean>;
  /** Column IDs explicitly added by the user */
  addedColumnIds?: Set<string>;
}

export interface UseGridDataReturn {
  /** Filtered and sorted rows ready for rendering */
  rows: GridRow[];
  /** Columns currently visible in the grid, in display order */
  visibleColumns: ColumnDef[];
  /** Columns the user can toggle on (not currently visible but available) */
  availableColumns: ColumnDef[];
  /** Column ids currently tagged for graphing */
  graphTaggedColumnIds: string[];
}


export function useGridData(options: UseGridDataOptions): UseGridDataReturn {
  const {
    segments,
    userOutputOverrides,
    presetId,
    isDebugMode,
    sortConfigs,
    filterOverrides,
    graphTaggedColumns,
    extraMetricTypes,
    columnVisibilityOverrides,
    addedColumnIds,
  } = options;

  // 1. Build rows from segments + overrides
  const rows = useMemo(
    () => segmentsToRows(segments, userOutputOverrides),
    [segments, userOutputOverrides],
  );

  // Custom Property Note metrics and Summary Metrics are data-named types
  // (work, power, totalWork), so a fixed catalogue cannot know them up front.
  // Discover their definitions from the rows; metric-type columns become
  // visible when they have data through the normal ColumnSet contract.
  const columnSet = useMemo(() => {
    const definitions = [...GRID_COLUMN_SET_CONFIG.definitions];
    const known = new Set(definitions.map((definition) => definition.id));
    for (const row of rows) {
      for (const metricType of row.cells.keys()) {
        if (known.has(metricType)) continue;
        definitions.push(makeMetricColumn(metricType));
        known.add(metricType);
      }
    }
    return new ColumnSet({ ...GRID_COLUMN_SET_CONFIG, definitions });
  }, [rows]);

  // 2. Build ColumnSetContext
  const effectiveAddedColumnIds = useMemo(() => {
    const merged = new Set<string>(addedColumnIds ?? []);
    for (const metricType of extraMetricTypes ?? []) {
      merged.add(metricType);
    }
    return merged;
  }, [addedColumnIds, extraMetricTypes]);

  const columnSetContext = useMemo<ColumnSetContext>(
    () => ({
      rows,
      activePresetId: presetId,
      isDebugMode,
      graphTaggedColumnIds: graphTaggedColumns,
      visibilityOverrides: columnVisibilityOverrides,
      addedColumnIds: effectiveAddedColumnIds,
    }),
    [rows, presetId, isDebugMode, graphTaggedColumns, columnVisibilityOverrides, effectiveAddedColumnIds],
  );

  // 3. Compute visible and available columns via ColumnSet
  const visibleColumns = useMemo(
    () => columnSet.getVisibleColumns(columnSetContext),
    [columnSet, columnSetContext],
  );

  const availableColumns = useMemo(
    () => columnSet.getAvailableColumns(columnSetContext),
    [columnSet, columnSetContext],
  );

  // 4. Merge filter: preset filters + user overrides
  const mergedFilter = useMemo<GridFilterConfig>(
    () => ({
      ...(columnSet.getPreset(presetId).filters ?? {}),
      ...filterOverrides,
    }),
    [presetId, filterOverrides, columnSet],
  );

  // 5. Apply filters and sorting
  const filteredSortedRows = useMemo(() => {
    const filtered = applyFilters(rows, mergedFilter, visibleColumns, columnSet.definitions);
    return applySorting(filtered, sortConfigs, visibleColumns, columnSet.definitions);
  }, [rows, mergedFilter, sortConfigs, visibleColumns, columnSet]);

  const graphTaggedColumnIds = useMemo(
    () => Array.from(graphTaggedColumns ?? []),
    [graphTaggedColumns],
  );

  return {
    rows: filteredSortedRows,
    visibleColumns,
    availableColumns,
    graphTaggedColumnIds,
  };
}

// ─── Row Construction ──────────────────────────────────────────

/**
 * Convert Segment[] into GridRow[], pivoting metrics into cells.
 * User overrides are merged into the cell data.
 */
interface SegmentWithContext extends Segment {
  context?: Record<string, unknown>;
}

function segmentsToRows(
  segments: Segment[],
  userOverrides: Map<string, MetricContainer>,
): GridRow[] {
  return segments.map((seg, idx) => {
    const cells = new Map<MetricType, GridCell>();

    if (seg.metrics) {
      for (const frag of seg.metrics) {
        groupFragmentIntoCell(cells, frag);
      }
    }

    const blockKey = extractBlockKey(seg);
    const overrides = blockKey ? userOverrides.get(blockKey) : undefined;
    if (overrides) {
      for (const frag of overrides) {
        groupFragmentIntoCell(cells, frag);
      }
    }

    for (const [, cell] of cells) {
      (cell as { hasUserOverride: boolean }).hasUserOverride = cell.metrics.some(
        (f) => f.origin === 'user',
      );
    }

    const outputType = ((seg as SegmentWithContext).context?.outputType as string) ?? seg.type;

    return {
      id: seg.id,
      index: idx + 1,
      sourceBlockKey: blockKey ?? `segment-${seg.id}`,
      sourceStatementId: (seg as SegmentWithContext).context?.sourceStatementId as number | undefined,
      outputType: outputType as GridRow['outputType'],
      stackLevel: seg.depth,
      absoluteStartTime: seg.absoluteStartTime,
      duration: seg.duration,
      elapsed: seg.elapsed,
      total: seg.total,
      spans: seg.spans ? [...seg.spans] : [],
      completionReason: (seg as SegmentWithContext).context?.completionReason as string | undefined,
      cells,
    } satisfies GridRow;
  });
}

function extractBlockKey(seg: Segment): string | undefined {
  const ctx = (seg as SegmentWithContext).context;
  if (ctx?.sourceBlockKey) return ctx.sourceBlockKey as string;
  return seg.name;
}

function groupFragmentIntoCell(
  cells: Map<MetricType, GridCell>,
  frag: IMetric,
): void {
  const ft = frag.type as MetricType;

  if (ft === MetricType.Sound) {
    return;
  }

  const existing = cells.get(ft);
  if (existing) {
    cells.set(ft, {
      metrics: existing.metrics.clone().add(frag),
      hasUserOverride: existing.hasUserOverride,
    });
  } else {
    cells.set(ft, {
      metrics: MetricContainer.empty(ft).add(frag),
      hasUserOverride: false,
    });
  }
}

// ─── Filtering ─────────────────────────────────────────────────

function applyFilters(
  rows: GridRow[],
  filter: GridFilterConfig,
  columns: ColumnDef[],
  definitionMap?: ReadonlyMap<string, ColumnDef>,
): GridRow[] {
  let result = rows;

  if (filter.outputTypes && filter.outputTypes.length > 0) {
    const allowed = new Set<string>(filter.outputTypes);
    result = result.filter((r) => allowed.has(r.outputType));
  }

  if (filter.origins && filter.origins.length > 0) {
    const allowed = new Set(filter.origins);
    result = result.filter((r) => {
      for (const [, cell] of r.cells) {
        if (cell.metrics.some((f) => f.origin && allowed.has(f.origin))) {
          return true;
        }
      }
      return false;
    });
  }

  if (filter.searchText && filter.searchText.trim().length > 0) {
    const needle = filter.searchText.trim().toLowerCase();
    result = result.filter((r) => {
      for (const col of columns) {
        if (!col.filter) continue;
        const ctx: ComputeContext = {
          allRows: rows,
          rowIndex: rows.indexOf(r),
          columnDef: col,
          dependencies: new Map(),
        };
        const cellText = extractFilterText(r, col, ctx, definitionMap).toLowerCase();
        if (cellText.includes(needle)) return true;
      }
      return false;
    });
  }

  if (filter.columnFilters) {
    for (const [colId, filterText] of Object.entries(filter.columnFilters)) {
      if (!filterText || filterText.trim().length === 0) continue;
      const col = columns.find((c) => c.id === colId);
      if (!col) continue;
      result = result.filter((r) => {
        const ctx: ComputeContext = {
          allRows: rows,
          rowIndex: rows.indexOf(r),
          columnDef: col,
          dependencies: new Map(),
        };
        return matchColumnFilter(r, col, filterText, ctx, definitionMap);
      });
    }
  }

  return result;
}

// ─── Sorting ───────────────────────────────────────────────────

function applySorting(
  rows: GridRow[],
  sortConfigs: GridSortConfig[],
  columns: ColumnDef[],
  definitionMap?: ReadonlyMap<string, ColumnDef>,
): GridRow[] {
  if (sortConfigs.length === 0) return rows;

  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const config of sortConfigs) {
      const col = columns.find((c) => c.id === config.columnId);
      if (!col || !col.sort) continue;

      const ctxA: ComputeContext = {
        allRows: rows,
        rowIndex: rows.indexOf(a),
        columnDef: col,
        dependencies: new Map(),
      };
      const ctxB: ComputeContext = {
        allRows: rows,
        rowIndex: rows.indexOf(b),
        columnDef: col,
        dependencies: new Map(),
      };
      const valA = extractSortValue(a, col, ctxA, definitionMap);
      const valB = extractSortValue(b, col, ctxB, definitionMap);
      const cmp = compareSortValues(valA, valB);
      if (cmp !== 0) return config.direction === 'asc' ? cmp : -cmp;
    }
    return a.index - b.index;
  });

  return sorted;
}
