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
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarIcon, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDot, SkipForward } from 'lucide-react'
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { formatDurationMMSS } from '@bitcobblers/wod-wiki-core'
import { TEST_IDS } from '@/lib/testIds'
import type { Entry } from '../../lib/entryMapper'
import { entryOpenHref } from '../../lib/entryActions'
import {
  calendarNotebookKey,
  monthLabel,
  notebookAccent,
  parseDayKey,
  shiftMonth,
  WEEKDAY_SHORT,
  type CalendarDay,
} from '../../lib/calendarModel'

export type OverlayFilterMode = 'all' | 'planned' | 'logged'

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

function monthAnchorKey(anchor: Date): string {
  return `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`
}

function parseMonthAnchorKey(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null
  return parseDayKey(`${value}-01`)
}

/** The month anchor the calendar layouts navigate with, optionally controlled via ?month=YYYY-MM. */
export function useCalendarMonth(
  initial?: Date | string,
  onMonthChange?: (monthKey: string) => void,
): CalendarMonthNav {
  const initialKey = typeof initial === 'string' ? initial : ''
  const controlledDate = initialKey ? parseMonthAnchorKey(initialKey) : undefined
  const [internalAnchor, setInternalAnchor] = useState(() =>
    controlledDate ?? (initial instanceof Date ? initial : new Date()),
  )
  useEffect(() => {
    const parsed = initialKey ? parseMonthAnchorKey(initialKey) : null
    if (parsed) setInternalAnchor(parsed)
  }, [initialKey])
  const anchor = controlledDate ?? internalAnchor
  const setAnchorAndNotify = useCallback(
    (compute: (current: Date) => Date) => {
      const next = compute(anchor)
      setInternalAnchor(next)
      onMonthChange?.(monthAnchorKey(next))
    },
    [anchor, onMonthChange],
  )
  return {
    anchor,
    label: monthLabel(anchor),
    previous: useCallback(() => setAnchorAndNotify((a) => shiftMonth(a, -1)), [setAnchorAndNotify]),
    next: useCallback(() => setAnchorAndNotify((a) => shiftMonth(a, 1)), [setAnchorAndNotify]),
    today: useCallback(() => setAnchorAndNotify(() => new Date()), [setAnchorAndNotify]),
  }
}

// ── Month bar ──────────────────────────────────────────────────────────────

const OVERLAY_OPTIONS: ReadonlyArray<{ id: OverlayFilterMode; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'planned', label: 'Planned' },
  { id: 'logged', label: 'Logged' },
]

/**
 * The calendar's own toolbar. The stream surfaces have no page header below
 * `lg` (the app navbar is the only header there), so the calendar owns its
 * navigation on every viewport.
 */
export function CalendarMonthBar({
  nav,
  meta,
  right,
  overlayMode,
  onOverlayModeChange,
}: {
  nav: CalendarMonthNav
  /** Context line — e.g. "12 of 45 notes in October". */
  meta?: ReactNode
  right?: ReactNode
  overlayMode?: OverlayFilterMode
  onOverlayModeChange?: (mode: OverlayFilterMode) => void
}) {
  return (
    <div className="border-b border-border/60 px-4 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="icon" onClick={nav.previous} aria-label="Previous month" className="size-11 shrink-0">
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-sm font-bold text-foreground">{nav.label}</div>
          {meta && <div className="truncate text-xs text-muted-foreground">{meta}</div>}
        </div>
        {onOverlayModeChange && (
          <div
            data-testid={TEST_IDS.CALENDAR_OVERLAY_FILTER}
            role="group"
            aria-label="Overlay filter"
            className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5"
          >
            {OVERLAY_OPTIONS.map((opt) => {
              const active = (overlayMode ?? 'all') === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onOverlayModeChange(opt.id)}
                  aria-pressed={active}
                  className={`rounded px-2.5 py-1 text-xs font-semibold max-lg:min-h-11 transition-colors ${
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}
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
export function CalendarEntryChip({
  entry,
  onInspect,
}: {
  entry: Entry
  onInspect?: (entry: Entry) => void
}) {
  const accent = notebookAccent(calendarNotebookKey(entry))
  const pairedDuration = entry.pairedSessions?.[0]?.duration
  const isCompleted = entry.scheduleStatus === 'completed' || (entry.pairedSessions?.length ?? 0) > 0
  const isSkipped = entry.scheduleStatus === 'skipped'
  const isAdhocLogged = entry.overlayKind === 'logged' && !entry.scheduleItemId
  const isPlannedOnly = entry.overlayKind === 'planned' && !isCompleted && !isSkipped

  const chipTone = isSkipped
    ? 'border-border/50 bg-muted/40 text-muted-foreground line-through'
    : isCompleted
      ? 'border-emerald-500/40 bg-emerald-500/10 text-foreground hover:bg-emerald-500/15'
      : isPlannedOnly
        ? 'border-dashed border-border bg-card/70 text-foreground hover:bg-muted/60'
        : isAdhocLogged
          ? 'border-sky-500/40 bg-sky-500/10 text-foreground hover:bg-sky-500/15'
          : 'border-border/60 bg-card text-foreground hover:bg-muted/60'

  const chipBody = (
    <>
      <span className={`h-3 w-0.5 shrink-0 rounded-full ${accent.bar}`} aria-hidden />
      {isCompleted && <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
      {isSkipped && <SkipForward className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      {isAdhocLogged && <CircleDot className="size-3 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{entry.title || 'Untitled'}</span>
      {entry.scheduleSlot && (
        <span className="shrink-0 rounded bg-muted px-1 text-[11px] font-bold uppercase text-muted-foreground">
          {entry.scheduleSlot}
        </span>
      )}
      {typeof pairedDuration === 'number' && pairedDuration > 0 && (
        <span className="shrink-0 font-mono text-[11px] text-emerald-800 dark:text-emerald-300">
          {formatDurationMMSS(pairedDuration)}
        </span>
      )}
    </>
  )

  if (onInspect) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onInspect(entry)
        }}
        className={`flex min-h-6 w-full items-center gap-1 rounded border px-1.5 py-0.5 text-left text-[11px] transition-colors ${chipTone}`}
        title={`${entry.title} — ${calendarNotebookKey(entry)}`}
        data-testid="calendar-entry-chip"
        data-overlay-state={
          isSkipped ? 'skipped' : isCompleted ? 'completed' : isAdhocLogged ? 'logged' : isPlannedOnly ? 'planned' : 'note'
        }
      >
        {chipBody}
      </button>
    )
  }

  return (
    <Link
      to={entryOpenHref(entry)}
      onClick={(e) => e.stopPropagation()}
      className={`flex min-h-6 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${chipTone}`}
      title={`${entry.title} — ${calendarNotebookKey(entry)}`}
      data-testid="calendar-entry-chip"
    >
      {chipBody}
    </Link>
  )
}

// ── Undated shelf ──────────────────────────────────────────────────────────

/**
 * The collapsible shelf for entries the calendar cannot place.
 * Defaults collapsed so unfiled/undated library notes never visually bloat
 * the planner board, while staying honest and one tap away.
 */
export function CalendarUndatedShelf({ entries }: { entries: readonly Entry[] }) {
  const [expanded, setExpanded] = useState(false)
  if (entries.length === 0) return null
  return (
    <div className="mx-4 mb-6 rounded-lg border border-dashed border-border bg-muted/30 p-2.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        data-testid={TEST_IDS.CALENDAR_UNDATED_TOGGLE}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Undated · {entries.length}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {expanded ? 'Hide undated notes' : 'Show undated notes'}
        </span>
      </button>
      {expanded && (
        <>
          <p className="mt-1.5 text-xs text-muted-foreground">
            The calendar has no day for these. Open or schedule one onto a day to place it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entries.map((entry) => (
              <Link
                key={entry.id}
                to={entryOpenHref(entry)}
                className="inline-flex min-h-7 items-center gap-1.5 rounded border border-border/60 bg-card px-2 py-0.5 text-xs text-foreground hover:bg-muted/60"
              >
                <span
                  className={`h-3 w-0.5 shrink-0 rounded-full ${notebookAccent(calendarNotebookKey(entry)).bar}`}
                  aria-hidden
                />
                <span className="max-w-[16rem] truncate">{entry.title || 'Untitled'}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
