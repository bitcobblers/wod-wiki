import { useMemo, useState, type ReactNode } from 'react';
import type { RowsQueryResult, RowsRun } from '@bitcobblers/wod-wiki-wql';
import {
  OutputStatementsTable,
  OutputFilterPills,
  DEFAULT_OUTPUT_FILTERS,
  DEFAULT_PRIMARY_FILTER,
  normalizeOutputFilter,
  type InlineMetricEditPayload,
  type OutputFilterInput,
  type OutputStatementRow,
  type RowPrHighlight,
  type SessionTableSortSpec,
} from './OutputStatementsTable';

export interface RowsTableProps {
  result: RowsQueryResult;
  /** Optional per-run chrome rendered inside the section header (#948 RPE). */
  renderRunHeaderExtra?: (run: RowsRun) => ReactNode;
  /** Filter presets for the pills row (defaults to All/Segments/Events). */
  presets?: OutputFilterInput[];
  /** Controlled filter expression — omit to let the table own its filter state. */
  filter?: string;
  onFilterChange?: (filter: string) => void;
  /** Optional explicit column whitelist & order (from YAML `columns: [...]`). */
  columns?: readonly string[];
  /** Optional initial or controlled sort specs (from YAML `sort: [...]`). */
  sort?: readonly SessionTableSortSpec[];
  onSortChange?: (next: SessionTableSortSpec[]) => void;
  /** Optional row cap after filtering and sorting. */
  limit?: number;
  /** Optional inline actuals editor (`captureMetricCorrection`), scoped per run `resultId`. */
  onEditMetric?: (resultId: string, payload: InlineMetricEditPayload) => void | Promise<void>;
  /** Optional PR highlights keyed by row `id` or `sourceBlockKey`. */
  prHighlights?: ReadonlyMap<string | number, RowPrHighlight> | Record<string, RowPrHighlight>;
}

function formatRunHeader(run: RowsRun): string {
  const date = new Date(run.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return date;
}

/** The Session Results Table — renders a Rows Query result: one section per
 *  run, filter pills on top, and the shared statement table as the body. */
export function RowsTable({
  result,
  renderRunHeaderExtra,
  presets,
  filter,
  onFilterChange,
  columns,
  sort,
  onSortChange,
  limit,
  onEditMetric,
  prHighlights,
}: RowsTableProps) {
  const [internalFilter, setInternalFilter] = useState(DEFAULT_PRIMARY_FILTER);
  const activeFilter = filter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;

  const normalizedPresets = useMemo(
    () => (presets ?? DEFAULT_OUTPUT_FILTERS).map(normalizeOutputFilter),
    [presets],
  );

  const runs = useMemo(
    () =>
      result.runs.map((run) => ({
        run,
        // Event rows are the promoted statement snapshots — structurally the
        // same shape as stored output statements.
        statements: run.events as unknown as OutputStatementRow[],
        startTime: run.events[0]?.timeSpan?.started ?? run.timestamp,
      })),
    [result],
  );

  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground px-4 py-6 text-center">
        No workout logs matched this rows query.
      </div>
    );
  }

  return (
    <div data-testid="rows-table" className="flex flex-col gap-3">
      <OutputFilterPills
        presets={normalizedPresets}
        filter={activeFilter}
        onChange={setFilter}
      />
      {runs.map(({ run, statements, startTime }) => (
        <section key={run.resultId}>
          {runs.length > 1 && (
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground px-2 py-1.5 bg-muted/40 rounded-t-md border-b border-border/60">
              <span>{formatRunHeader(run)}</span>
              {renderRunHeaderExtra?.(run)}
            </div>
          )}
          <OutputStatementsTable
            outputs={statements}
            filter={activeFilter}
            timeOrigin={startTime}
            onClearFilter={() => setFilter('')}
            columns={columns}
            sort={sort}
            onSortChange={onSortChange}
            limit={limit}
            onEditMetric={
              onEditMetric
                ? (payload) => onEditMetric(run.resultId, payload)
                : undefined
            }
            prHighlights={prHighlights}
          />
        </section>
      ))}
    </div>
  );
}
