/**
 * TourSessionResult.tsx — the recorded-run review pane: the $session value
 * made visible. Header stats (elapsed, completion state, rounds/reps) plus
 * the session output statements table — matching the note table data format
 * after a workout completes.
 */
import { useState } from 'react'
import type { Sessions } from '@/components/Editor/types'
import {
  OutputStatementsTable,
  OutputFilterPills,
  DEFAULT_OUTPUT_FILTERS,
  DEFAULT_PRIMARY_FILTER,
  type OutputStatementRow,
} from '@bitcobblers/wod-wiki-ui'

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface TourSessionResultProps {
  result: Sessions
  /** Optional footer action (hero: back to the editor after reviewing). */
  onDismiss?: () => void
  dismissLabel?: string
}

export function TourSessionResult({ result, onDismiss, dismissLabel }: TourSessionResultProps) {
  // ponytail: table renders directly over stored statements; upgrade to full WQL QueryExecutor if custom column projection needed.
  const [filter, setFilter] = useState(DEFAULT_PRIMARY_FILTER)
  const statements = (result.logs ?? []) as unknown as OutputStatementRow[]

  return (
    // Header and footer stay pinned; only the statements table scrolls, so
    // short embedded panes never hide the session stats or the dismiss action.
    <div className="flex h-full w-full flex-col overflow-hidden p-4" data-testid="tour-session-result">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Session recorded
          </div>
          <div className="text-2xl font-extrabold tabular-nums tracking-tight">
            {fmtClock(result.duration)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span
            className={
              result.completed
                ? 'rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400'
                : 'rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400'
            }
          >
            {result.completed ? 'Completed' : 'Stopped early'}
          </span>
          {result.roundsCompleted != null && (
            <span className="tabular-nums">
              Rounds {result.roundsCompleted}
              {result.totalRounds != null ? `/${result.totalRounds}` : ''}
            </span>
          )}
          {result.repsCompleted != null && (
            <span className="tabular-nums">Reps {result.repsCompleted}</span>
          )}
        </div>
        {onDismiss && (
          // The pane grows to the table's full height, so the footer action
          // can sit below the fold — repeat it at the top of the pane.
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent"
            data-testid="tour-session-result-dismiss-top"
          >
            {dismissLabel}
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-3">
        <OutputFilterPills
          presets={DEFAULT_OUTPUT_FILTERS}
          filter={filter}
          onChange={setFilter}
        />
        <OutputStatementsTable
          outputs={statements}
          filter={filter}
          timeOrigin={result.startTime}
          onClearFilter={() => setFilter('')}
        />
      </div>

      {onDismiss && (
        <div className="flex justify-end border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent"
            data-testid="tour-session-result-dismiss"
          >
            {dismissLabel ?? 'Back'}
          </button>
        </div>
      )}
    </div>
  )
}

export default TourSessionResult
