/**
 * CalendarAgendaView — the AGENDA layout: a month laid out as a list of days.
 *
 * The Cards layout shows the whole result set, grouped by whatever the query
 * groups by. The Agenda is the same set as a CALENDAR viewport: one month,
 * each day a group with a calendar-shaped header, the entries beneath it.
 *
 * What makes it a calendar and not a list:
 * - a month navigator and a one-row density ribbon (how loaded the month is),
 * - day headers that read as dates (weekday over a big day number), sticky
 *   under the page's sticky boundary,
 * - and an explicit statement of how much of the result set is in view.
 *
 * Entries are the house `LibraryRow`, so the agenda keeps every action the
 * Cards layout offers (Open, Run, Add to today, Move notebook).
 */
import { useMemo } from 'react'
import type { Entry } from '../../lib/entryMapper'
import {
  buildDayBuckets,
  buildMonthAgenda,
  buildMonthGrid,
  densityLevel,
  monthLabel,
  shortMonthLabel,
  WEEKDAY_SHORT,
  type CalendarDay,
} from '../../lib/calendarModel'
import { LibraryRow } from '../library/LibraryRow'
import {
  CalendarMonthBar,
  CalendarUndatedShelf,
  useCalendarMonth,
} from './CalendarChrome'

export interface CalendarAgendaViewProps {
  /** The query's result set — the same entries Cards/Rows/Feed render. */
  entries: Entry[]
  /** The page's sticky boundary offset (day headers stack under it). */
  stickyOffset: number
  /** Optional projected visible fields for the entry rows. */
  visibleFieldIds?: readonly string[]
  /** Optional Add-to-today handler. */
  onAddToToday?: (entry: Entry) => void
  /** Optional Run handler — stages a pending runtime and navigates. */
  onRunStart?: (entry: Entry) => void
  /** User-owned notebooks a note can move into, and the handler. */
  moveNotebookTargets?: ReadonlyArray<{ id: string; name: string; icon: string }>
  onMoveNotebook?: (entry: Entry, notebookId: string) => void
}

/** The calendar-shaped day header: weekday over a big day number. */
function AgendaDayHeader({ day, top }: { day: CalendarDay; top: number }) {
  const weekday = WEEKDAY_SHORT[(day.date.getDay() + 6) % 7]
  return (
    <div
      id={`calendar-day-${day.key}`}
      style={{ top: `${top}px` }}
      className="sticky z-10 flex items-center gap-3 border-y border-border/60 bg-card/95 px-4 py-1.5 backdrop-blur"
      data-testid="calendar-agenda-day"
    >
      <div className="flex w-9 shrink-0 flex-col items-center leading-none">
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{weekday}</span>
        <span className={`text-xl font-extrabold tracking-tight ${day.isToday ? 'text-primary' : 'text-foreground'}`}>
          {day.dayOfMonth}
        </span>
      </div>
      <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {shortMonthLabel(day.date)} {day.date.getFullYear()}
      </div>
      {day.isToday && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
          Today
        </span>
      )}
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}
      </span>
    </div>
  )
}

/**
 * The density ribbon — one cell per day of the month, tinted by how many
 * entries land there. A glance at "how loaded was this month", in one row.
 */
function DensityRibbon({ days }: { days: CalendarDay[] }) {
  const monthDays = days.filter(day => day.inMonth)
  const month = monthDays[0]?.date.getMonth() ?? 0
  const year = monthDays[0]?.date.getFullYear() ?? new Date().getFullYear()
  const dayCount = new Date(year, month + 1, 0).getDate()
  const byNumber = new Map(monthDays.map(day => [day.dayOfMonth, day]))
  const cells = []
  for (let day = 1; day <= dayCount; day++) {
    const entry = byNumber.get(day)
    const level = densityLevel(entry?.entries.length ?? 0)
    const shade = level === 0
      ? 'bg-muted'
      : level === 1
        ? 'bg-primary/25'
        : level === 2
          ? 'bg-primary/50'
          : 'bg-primary'
    cells.push(
      <button
        key={day}
        type="button"
        onClick={() => document.getElementById(`calendar-day-${entry?.key}`)?.scrollIntoView({ block: 'start' })}
        disabled={!entry}
        title={`${day} ${shortMonthLabel(new Date(year, month, day))} — ${entry?.entries.length ?? 0} entries`}
        aria-label={`${day} ${shortMonthLabel(new Date(year, month, day))} — ${entry?.entries.length ?? 0} entries`}
        className={`h-6 flex-1 rounded-sm ${shade} ${entry ? 'cursor-pointer' : 'cursor-default'}`}
      />,
    )
  }
  return (
    <div className="hidden items-center gap-3 border-b border-border/60 px-4 py-2 lg:flex">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Load</span>
      <div className="flex flex-1 gap-0.5">{cells}</div>
      <span className="font-mono text-[10px] text-muted-foreground">1 → {dayCount}</span>
    </div>
  )
}

export function CalendarAgendaView({
  entries,
  stickyOffset,
  visibleFieldIds,
  onAddToToday,
  onRunStart,
  moveNotebookTargets,
  onMoveNotebook,
}: CalendarAgendaViewProps) {
  const nav = useCalendarMonth()
  const buckets = useMemo(() => buildDayBuckets(entries), [entries])
  const agenda = useMemo(() => buildMonthAgenda(nav.anchor, buckets), [nav.anchor, buckets])
  const grid = useMemo(() => buildMonthGrid(nav.anchor, buckets), [nav.anchor, buckets])

  const monthPrefix = `${nav.anchor.getFullYear()}-${String(nav.anchor.getMonth() + 1).padStart(2, '0')}`
  const inMonth = entries.filter(entry => entry.date?.startsWith(monthPrefix))
  const dated = entries.filter(entry => entry.date).length

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col bg-background" data-testid="calendar-agenda-view">
        <CalendarMonthBar nav={nav} />
        <p className="px-4 py-16 text-center text-xs text-muted-foreground">No entries match your search.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-background" data-testid="calendar-agenda-view">
      <CalendarMonthBar
        nav={nav}
        meta={`${inMonth.length} of ${dated} dated ${dated === 1 ? 'entry' : 'entries'} in ${nav.label}`}
      />
      <DensityRibbon days={grid.flatMap(week => week.days)} />

      {agenda.length === 0 ? (
        <p className="px-4 py-16 text-center text-xs text-muted-foreground">
          Nothing dated in {nav.label}. Step to another month, or widen the date window.
        </p>
      ) : (
        <div className="flex-1 pb-6">
          {agenda.map(day => (
            <section key={day.key}>
              <AgendaDayHeader day={day} top={stickyOffset} />
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
            </section>
          ))}
        </div>
      )}

      <CalendarUndatedShelf entries={buckets.undated} />
    </div>
  )
}
