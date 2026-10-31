/**
 * CalendarChrome — the pieces the CAL layouts share.
 *
 * The two calendar layouts (Agenda / Planner) are the same idea seen two
 * ways: the query's result set laid out on a time axis. They share a month
 * navigator, an undated shelf (the calendar's honesty about entries it
 * cannot place) and a compact entry chip for the planner's cells.
 *
 * Everything here is pure presentation over the geometry in
 * `app/lib/calendarModel.ts` — no fetching, no query mutation.
 */
import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/atoms/primitives/button'
import type { Entry } from '../../lib/entryMapper'
import { entryOpenHref } from '../../lib/entryActions'
import {
  calendarNotebookKey,
  monthLabel,
  notebookAccent,
  shiftMonth,
  WEEKDAY_SHORT,
  type CalendarDay,
} from '../../lib/calendarModel'

// ── Month navigator ────────────────────────────────────────────────────────

export interface CalendarMonthNav {
  /** The month the views are showing. */
  anchor: Date
  /** Human label, e.g. `October 2026`. */
  label: string
  /** Step one month back. */
  previous: () => void
  /** Step one month forward. */
  next: () => void
  /** Jump back to the current month. */
  today: () => void
}

/** The month anchor the calendar layouts navigate with. */
export function useCalendarMonth(initial?: Date): CalendarMonthNav {
  const [anchor, setAnchor] = useState(() => initial ?? new Date())
  return {
    anchor,
    label: monthLabel(anchor),
    previous: useCallback(() => setAnchor(a => shiftMonth(a, -1)), []),
    next: useCallback(() => setAnchor(a => shiftMonth(a, 1)), []),
    today: useCallback(() => setAnchor(new Date()), []),
  }
}

// ── Month bar ──────────────────────────────────────────────────────────────

/**
 * The calendar's own toolbar. The stream surfaces have no page header below
 * `lg` (the app navbar is the only header there), so the calendar owns its
 * navigation on every viewport.
 */
export function CalendarMonthBar({
  nav,
  meta,
  right,
}: {
  nav: CalendarMonthNav
  /** Context line — e.g. "12 of 45 notes in October". */
  meta?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="border-b border-border/60 px-4 py-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={nav.previous} aria-label="Previous month" className="size-11 shrink-0">
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-sm font-bold text-foreground">{nav.label}</div>
          {meta && <div className="truncate text-[11px] text-muted-foreground">{meta}</div>}
        </div>
        <Button variant="ghost" size="icon" onClick={nav.next} aria-label="Next month" className="size-11 shrink-0">
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={nav.today} className="min-h-11 shrink-0">
          Today
        </Button>
        {right}
      </div>
    </div>
  )
}

// ── Day label ──────────────────────────────────────────────────────────────

/** `Thu 1` — the day a cell or group belongs to. */
export function calendarDayLabel(day: CalendarDay): string {
  return `${WEEKDAY_SHORT[(day.date.getDay() + 6) % 7]} ${day.dayOfMonth}`
}

// ── Compact entry chip (planner cells) ─────────────────────────────────────

/**
 * A planner cell holds a handful of entries in a seventh of the width, so
 * the entry is a chip: a notebook-colored bar and a truncated title. The
 * whole chip is the link to the entry.
 */
export function CalendarEntryChip({ entry }: { entry: Entry }) {
  const accent = notebookAccent(calendarNotebookKey(entry))
  return (
    <Link
      to={entryOpenHref(entry)}
      className="flex min-h-6 items-center gap-1.5 rounded border border-border/60 bg-card px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted/60"
      title={`${entry.title} — ${calendarNotebookKey(entry)}`}
      data-testid="calendar-entry-chip"
    >
      <span className={`h-3 w-0.5 shrink-0 rounded-full ${accent.bar}`} aria-hidden />
      <span className="min-w-0 truncate">{entry.title || 'Untitled'}</span>
    </Link>
  )
}

// ── Undated shelf ──────────────────────────────────────────────────────────

/**
 * The shelf for entries the calendar cannot place.
 *
 * An entry with no date is NEVER silently dropped — dropping a third of the
 * result set would make the calendar lie about coverage. The shelf names the
 * problem instead.
 */
export function CalendarUndatedShelf({ entries }: { entries: readonly Entry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="mx-4 mb-6 rounded-lg border border-dashed border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5">
        <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Undated · {entries.length}
        </h3>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        The calendar has no day for these. Give them one to place them.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map(entry => (
          <span
            key={entry.id}
            className="inline-flex min-h-6 items-center gap-1.5 rounded border border-border/60 bg-card px-1.5 py-0.5 text-[11px]"
          >
            <span
              className={`h-3 w-0.5 shrink-0 rounded-full ${notebookAccent(calendarNotebookKey(entry)).bar}`}
              aria-hidden
            />
            <span className="max-w-[16rem] truncate">{entry.title || 'Untitled'}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
