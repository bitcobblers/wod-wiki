/**
 * CalendarPlannerView — the PLANNER layout: a board of weeks.
 *
 * The Agenda answers "what happened"; the Planner answers "when am I free
 * next". It is the planning counterpart of the calendar: the same month, but
 * organised by WEEK — the unit a training week is actually planned in.
 *
 * On a desktop the board is the board: rows are weeks, columns are days, and
 * an empty cell is an opening. On a phone seven columns are unreadable, so
 * the board turns vertical — the same weeks, each a card holding its days.
 * The planner never shows LESS of the month than the agenda does.
 */
import { useMemo } from 'react'
import { CalendarIcon, Plus } from 'lucide-react'
import type { Entry } from '../../lib/entryMapper'
import {
  buildDayBuckets,
  buildMonthWeeks,
  calendarNotebookKey,
  notebookAccent,
  shortMonthLabel,
  WEEKDAY_SHORT,
  type CalendarDay,
  type CalendarWeek,
} from '../../lib/calendarModel'
import { useIsMobile } from '../../hooks/useIsMobile'
import { LibraryRow } from '../library/LibraryRow'
import {
  CalendarEntryChip,
  CalendarMonthBar,
  CalendarUndatedShelf,
  useCalendarMonth,
} from './CalendarChrome'

export interface CalendarPlannerViewProps {
  /** The query's result set — the same entries Cards/Rows/Feed render. */
  entries: Entry[]
  /** Optional projected visible fields for the entry rows. */
  visibleFieldIds?: readonly string[]
  /** Optional Add-to-today handler. */
  onAddToToday?: (entry: Entry) => void
  /** Optional Run handler — stages a pending runtime and navigates. */
  onRunStart?: (entry: Entry) => void
  /** User-owned notebooks a note can move into, and the handler. */
  moveNotebookTargets?: ReadonlyArray<{ id: string; name: string; icon: string }>
  onMoveNotebook?: (entry: Entry, notebookId: string) => void
  /**
   * Start a new entry on a given day — the board's empty space and its "+"
   * button both call this. The host opens the new-note dialog for that date.
   */
  onCreateOnDay?: (dateKey: string) => void
}

/** How many entries one board cell shows before it counts the rest. */
const CELL_ENTRY_LIMIT = 3

/**
 * One day cell of the board: the date, its entries, and its count.
 *
 * The EMPTY SPACE of a cell is a create affordance — clicking it starts a
 * new entry on that day, which is how a planner is actually used ("this
 * Thursday is free, put something there"). The explicit "+" button says so
 * without a hover; the cell-wide target does it with one tap.
 */
function PlannerCell({ day, onCreateOnDay }: { day: CalendarDay; onCreateOnDay: (dateKey: string) => void }) {
  const shown = day.entries.slice(0, CELL_ENTRY_LIMIT)
  const hidden = day.entries.length - shown.length
  const label = `${shortMonthLabel(day.date)} ${day.dayOfMonth}`
  return (
    <div
      className={`group/cell relative flex min-h-[5.5rem] min-w-0 flex-col gap-1 border-l border-border/50 p-1.5 first:border-l-0 ${
        day.inMonth ? '' : 'bg-muted/40'
      }`}
      data-testid="calendar-planner-cell"
    >
      {/* The cell-wide target sits UNDER the content, so an entry chip keeps
          its own click and the empty space belongs to the calendar. */}
      <button
        type="button"
        onClick={() => onCreateOnDay(day.key)}
        className="absolute inset-0 h-full w-full cursor-pointer"
        aria-label={`Add an entry on ${label}`}
        data-testid="calendar-planner-cell-add"
      />
      <div className="pointer-events-none relative flex items-baseline gap-1">
        <span
          className={`font-mono text-[11px] font-bold ${
            day.isToday ? 'text-primary' : day.inMonth ? 'text-foreground' : 'text-muted-foreground/50'
          }`}
        >
          {day.dayOfMonth}
        </span>
        {day.isToday && (
          <span className="rounded-full bg-primary/10 px-1 text-[8px] font-bold uppercase tracking-wider text-primary">
            Today
          </span>
        )}
        <button
          type="button"
          onClick={() => onCreateOnDay(day.key)}
          className="pointer-events-auto ml-auto grid size-5 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
          aria-label={`Add an entry on ${label}`}
          title="Add an entry on this day"
          data-testid="calendar-planner-add-button"
        >
          <Plus className="size-3" aria-hidden />
        </button>
        {day.entries.length > 0 && (
          <span className="font-mono text-[9px] text-muted-foreground">{day.entries.length}</span>
        )}
      </div>
      <div className="pointer-events-none relative flex flex-col gap-1">
        {shown.map(entry => (
          <span key={entry.id} className="pointer-events-auto">
            <CalendarEntryChip entry={entry} />
          </span>
        ))}
        {hidden > 0 && (
          <span className="px-1 text-[10px] font-medium text-muted-foreground">+{hidden} more</span>
        )}
      </div>
    </div>
  )
}

/** One week row of the board: the week label and its seven day cells. */
function PlannerWeek({
  week,
  onCreateOnDay,
}: {
  week: CalendarWeek
  onCreateOnDay: (dateKey: string) => void
}) {
  return (
    <div
      className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-t border-border/60"
      data-testid="calendar-planner-week"
    >
      <div className="flex flex-col justify-start gap-0.5 p-1.5">
        <span className="font-mono text-[10px] font-bold text-muted-foreground">{week.label}</span>
        <span className="font-mono text-[9px] text-muted-foreground/70">
          {week.days.reduce((sum, day) => sum + day.entries.length, 0)}
        </span>
      </div>
      {week.days.map(day => (
        <PlannerCell key={day.key} day={day} onCreateOnDay={onCreateOnDay} />
      ))}
    </div>
  )
}

/**
 * The phone shape: the board turned vertical — one card per week, each
 * holding the days that carry entries. Same weeks, same days; a phone gets
 * them stacked instead of side by side.
 */
function PlannerPhone({
  weeks,
  visibleFieldIds,
  onAddToToday,
  onRunStart,
  moveNotebookTargets,
  onMoveNotebook,
  onCreateOnDay,
}: {
  weeks: CalendarWeek[]
  visibleFieldIds?: readonly string[]
  onAddToToday?: (entry: Entry) => void
  onRunStart?: (entry: Entry) => void
  moveNotebookTargets?: ReadonlyArray<{ id: string; name: string; icon: string }>
  onMoveNotebook?: (entry: Entry, notebookId: string) => void
  onCreateOnDay: (dateKey: string) => void
}) {
  const weeksWithEntries = weeks.filter(week => week.days.some(day => day.entries.length > 0))
  if (weeksWithEntries.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-xs text-muted-foreground">
        No dated entries in this month.
      </p>
    )
  }
  return (
    <div className="space-y-3 p-3">
      {weeksWithEntries.map(week => (
        <section
          key={week.label}
          className="overflow-hidden rounded-lg border border-border/60 bg-card"
          data-testid="calendar-planner-week-card"
        >
          <header className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
            <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-mono text-[11px] font-bold text-foreground">Week of {week.label}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {week.days.reduce((sum, day) => sum + day.entries.length, 0)}{' '}
              {week.days.reduce((sum, day) => sum + day.entries.length, 0) === 1 ? 'entry' : 'entries'}
            </span>
          </header>
          {week.days
            .filter(day => day.entries.length > 0)
            .map(day => (
              <div key={day.key} className="border-b border-border/40 last:border-b-0">
                <div className="flex items-center gap-2 px-3 pt-2">
                  <span
                    className={`font-mono text-[11px] font-bold ${day.isToday ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {WEEKDAY_SHORT[(day.date.getDay() + 6) % 7]} {day.dayOfMonth}
                  </span>
                  {day.isToday && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                      Today
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5">
                    {day.entries.slice(0, 4).map(entry => (
                      <span
                        key={entry.id}
                        className={`size-1.5 rounded-full ${notebookAccent(calendarNotebookKey(entry)).bar}`}
                        title={entry.title}
                        aria-hidden
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => onCreateOnDay(day.key)}
                      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                      aria-label={`Add an entry on ${WEEKDAY_SHORT[(day.date.getDay() + 6) % 7]} ${day.dayOfMonth}`}
                      title="Add an entry on this day"
                      data-testid="calendar-planner-add-button"
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </button>
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {day.entries.map(entry => (
                    <LibraryRow
                      key={entry.id}
                      entry={entry}
                      visibleFieldIds={visibleFieldIds}
                      tone={day.isToday ? 'primary' : 'secondary'}
                      onAddToToday={onAddToToday}
                      onRunStart={onRunStart}
                      moveNotebookTargets={moveNotebookTargets}
                      onMoveNotebook={onMoveNotebook}
                    />
                  ))}
                </div>
              </div>
            ))}
        </section>
      ))}
    </div>
  )
}

export function CalendarPlannerView({
  entries,
  visibleFieldIds,
  onAddToToday,
  onRunStart,
  moveNotebookTargets,
  onMoveNotebook,
  onCreateOnDay,
}: CalendarPlannerViewProps) {
  const isMobile = useIsMobile()
  const nav = useCalendarMonth()
  const buckets = useMemo(() => buildDayBuckets(entries), [entries])
  const weeks = useMemo(() => buildMonthWeeks(nav.anchor, buckets), [nav.anchor, buckets])

  const monthPrefix = `${nav.anchor.getFullYear()}-${String(nav.anchor.getMonth() + 1).padStart(2, '0')}`
  const inMonth = entries.filter(entry => entry.date?.startsWith(monthPrefix)).length

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col bg-background" data-testid="calendar-planner-view">
        <CalendarMonthBar nav={nav} />
        <p className="px-4 py-16 text-center text-xs text-muted-foreground">No entries match your search.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-background" data-testid="calendar-planner-view">
      <CalendarMonthBar
        nav={nav}
        meta={`${inMonth} dated ${inMonth === 1 ? 'entry' : 'entries'} in ${nav.label}`}
      />

      {isMobile ? (
        <PlannerPhone
          weeks={weeks}
          visibleFieldIds={visibleFieldIds}
          onAddToToday={onAddToToday}
          onRunStart={onRunStart}
          moveNotebookTargets={moveNotebookTargets}
          onMoveNotebook={onMoveNotebook}
          onCreateOnDay={onCreateOnDay ?? (() => {})}
        />
      ) : (
        <div className="flex-1 overflow-x-auto pb-6">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] bg-muted/40">
              <div />
              {WEEKDAY_SHORT.map(day => (
                <div
                  key={day}
                  className="border-l border-border/50 px-1.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground first:border-l-0"
                >
                  {day}
                </div>
              ))}
            </div>
            {weeks.map(week => (
              <PlannerWeek key={week.label} week={week} onCreateOnDay={onCreateOnDay ?? (() => {})} />
            ))}
          </div>
        </div>
      )}

      <CalendarUndatedShelf entries={buckets.undated} />
    </div>
  )
}
