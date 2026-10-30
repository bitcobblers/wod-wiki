/**
 * CalendarStreamView — the CAL layout for the notes stream, MOBILE.
 *
 * The desktop CAL is a month grid. A month grid at 375px is a lie: seven
 * columns of 44px cells with a title in each is unreadable, and the thumb
 * can only reach the lower half. So the mobile CAL is a DIFFERENT shape, not
 * a shrunken one:
 *
 *   A · Agenda  — the month as a vertical day list. Days are the unit; each
 *                 day's entries are cards. Thumb-reachable, scroll-native.
 *   B · Week    — a horizontal week strip pinned at the top, one day's
 *                 entries below. Constant height, no scrolling to find today.
 *   C · Month   — a compact month heatmap whose cells open the day as a
 *                 bottom sheet. The grid survives because the cells carry
 *                 DOTS, not text.
 *
 * Every variant obeys the house mobile contract:
 * - No page header on mobile (`StickyPageHeader` is `max-lg:hidden`); the
 *   calendar owns its own compact toolbar instead.
 * - Touch targets ≥ 44px (`min-h-11`).
 * - The day detail is a bottom SHEET (`EditorDialog presentation="sheet"`),
 *   never a centered dialog.
 * - `env(safe-area-inset-bottom)` padding on anything pinned to the bottom.
 * - The layout switcher lives in the ⋯ thumb sheet (the L3 rail is desktop-
 *   only), so this view never draws its own layout picker.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarIcon, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { EditorDialog } from '@bitcobblers/wod-wiki-ui'
import { Button } from '@/components/atoms/primitives/button'
import type { Entry } from '../../lib/entryMapper'
import {
  buildDayBuckets,
  buildMonthAgenda,
  buildMonthGrid,
  buildWeekStrip,
  dayKey,
  densityLevel,
  monthLabel,
  notebookAccent,
  shiftDay,
  shiftMonth,
  shortMonthLabel,
  WEEKDAY_SHORT,
  type CalendarDay,
  type CalendarWeek,
} from '../../lib/calendarModel'
import { entryOpenHref, entryNotebookHref } from '../../lib/entryActions'

export interface CalendarStreamViewProps {
  /** The query's result set — the SAME entries Cards/Rows/Feed render. */
  entries: Entry[]
  /** Month anchor; defaults to the current month. */
  initialMonth?: Date
  /** Which calendar shape to render. */
  variant?: CalendarVariant
  /** Fired when the shape switcher is used; omit to render the switcher uncontrolled. */
  onVariantChange?: (variant: CalendarVariant) => void
}

/** The three calendar shapes the mobile CAL can take. */
export type CalendarVariant = 'agenda' | 'week' | 'month'

const VARIANTS: readonly { id: CalendarVariant; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

// ── Shared atoms ───────────────────────────────────────────────────────────

/** One entry as a card: notebook bar, title, tags, actions. */
function EntryCard({ entry, onOpen }: { entry: Entry; onOpen?: () => void }) {
  const navigate = useNavigate()
  const accent = notebookAccent(entry.sourceNotebook)
  const href = entryOpenHref(entry)
  const notebookHref = entryNotebookHref(entry)
  return (
    // The CARD is the tap target, not the title text — the same contract as
    // LibraryRow. A 20px-tall title link is not a touch target; the whole
    // card is, and it is comfortably over 44px.
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (href) navigate(href)
        onOpen?.()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (href) navigate(href)
          onOpen?.()
        }
      }}
      className="flex min-h-11 items-stretch gap-2.5 rounded-lg border border-border/60 bg-card text-left transition-colors hover:bg-muted/40"
      data-testid="cal-entry-card"
    >
      <span className={`w-1 shrink-0 rounded-l-lg ${accent.bar}`} aria-hidden />
      <div className="min-w-0 flex-1 py-2.5 pr-2">
        <span className="block truncate text-sm font-semibold text-foreground">{entry.title || 'Untitled'}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className={`rounded-full px-1.5 py-0.5 font-medium ${accent.chip}`}>
            {entry.sourceNotebook}
          </span>
          {entry.kind !== 'note' && <span className="uppercase tracking-wide">{entry.kind}</span>}
          {(entry.tags ?? []).slice(0, 3).map(tag => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 pr-2">
        {entry.wodBlock && (
          <span className="rounded-full border border-metric-effort/40 bg-metric-effort/15 px-2 py-0.5 text-[10px] font-bold text-metric-effort">
            RUN
          </span>
        )}
        {notebookHref && (
          <Link
            to={notebookHref}
            onClick={e => e.stopPropagation()}
            className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            NOTEBOOK
          </Link>
        )}
      </div>
    </div>
  )
}

/** The day heading: weekday, date, and the entry count. */
function DayHeading({ day, sticky }: { day: CalendarDay; sticky?: boolean }) {
  const weekday = WEEKDAY_SHORT[(day.date.getDay() + 6) % 7]
  return (
    <div
      className={`flex items-baseline gap-2 pb-1 ${sticky ? 'sticky top-0 z-10 -mx-3 bg-background/95 px-3 py-1 backdrop-blur' : ''}`}
    >
      <span className="font-mono text-xs font-bold text-muted-foreground">{weekday}</span>
      <span className={`text-sm font-bold ${day.isToday ? 'text-primary' : 'text-foreground'}`}>
        {day.dayOfMonth}
      </span>
      {day.isToday && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
          Today
        </span>
      )}
      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
        {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}
      </span>
    </div>
  )
}

/** The compact toolbar the calendar owns on mobile (no page header below lg). */
function CalendarToolbar({
  label,
  onPrev,
  onNext,
  onToday,
  right,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="border-b border-border/60 px-3 py-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onPrev} aria-label="Previous period" className="size-11 shrink-0">
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        {/* The label owns the row: at 375px the arrows + a Today button + a
            shape switcher do not fit beside a title, so the title gets its
            own line under them. */}
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-bold text-foreground">{label}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={onNext} aria-label="Next period" className="size-11 shrink-0">
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday} className="min-h-11 shrink-0">
          Today
        </Button>
      </div>
      {right && <div className="mt-2 flex justify-center">{right}</div>}
    </div>
  )
}

// ── Variant A · Agenda ─────────────────────────────────────────────────────

/**
 * The month as a vertical list of days. The thumb reaches everything; each
 * day is a group; the group's entries are cards. This is the mobile
 * equivalent of the desktop "Cards" layout with the date group made
 * structural — the same `groupEntriesByDimension` output, vertical.
 */
function AgendaVariant({
  days,
  onPlan,
}: {
  days: CalendarDay[]
  onPlan: (day: CalendarDay) => void
}) {
  if (days.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-semibold text-foreground">Nothing scheduled this month</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Notes without a date can be planned onto a day from the library.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-4 px-3 pb-6">
      {days.map(day => (
        <section key={day.key} data-testid={`cal-agenda-day-${day.key}`}>
          <DayHeading day={day} />
          <div className="mt-1.5 space-y-2">
            {day.entries.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
            <button
              type="button"
              onClick={() => onPlan(day)}
              className="flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-primary"
            >
              <Plus className="size-3.5" aria-hidden />
              Plan a workout on this day
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}

// ── Variant B · Week strip ─────────────────────────────────────────────────

/**
 * A pinned horizontal week strip over the selected day's entries. Constant
 * height, no scrolling to find today, and the strip doubles as the month
 * navigator (swipe the strip, or use the arrows).
 */
function WeekVariant({
  days,
  selectedKey,
  onSelect,
  onPlan,
}: {
  days: CalendarDay[]
  selectedKey: string
  onSelect: (day: CalendarDay) => void
  onPlan: (day: CalendarDay) => void
}) {
  const selected = days.find(d => d.key === selectedKey) ?? days[0]
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-2 py-2" data-testid="cal-week-strip">
        {days.map(day => {
          const active = day.key === selectedKey
          const weekday = WEEKDAY_SHORT[(day.date.getDay() + 6) % 7]
          // A strip that straddles a month boundary shows bare day numbers
          // that silently belong to the wrong month ("28" meaning Sep 28).
          // The first cell of a new month carries its short month name.
          const startsMonth = day.dayOfMonth === 1
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={active}
              aria-label={`${weekday} ${day.dayOfMonth}${startsMonth ? ' ' + shortMonthLabel(day.date) : ''}`}
              className={`flex min-h-11 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-[10px] transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-muted/60'
              }`}
            >
              <span>{weekday}</span>
              <span className="text-sm font-bold">{day.dayOfMonth}</span>
              <span className="h-3 text-[9px] font-semibold leading-3">
                {startsMonth ? shortMonthLabel(day.date) : ''}
              </span>
              {day.entries.length > 0 && (
                <span
                  className={`size-1.5 rounded-full ${day.isToday ? 'bg-primary' : 'bg-muted-foreground/60'}`}
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>
      {selected && (
        <div className="space-y-2 px-3 py-3">
          <DayHeading day={selected} />
          {selected.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing on this day.
            </p>
          ) : (
            selected.entries.map(entry => <EntryCard key={entry.id} entry={entry} />)
          )}
          <button
            type="button"
            onClick={() => onPlan(selected)}
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-primary"
          >
            <Plus className="size-3.5" aria-hidden />
            Plan a workout on this day
          </button>
        </div>
      )}
    </div>
  )
}

// ── Variant C · Month heatmap + day sheet ──────────────────────────────────

/**
 * The month grid survives on a phone ONLY because the cells carry dots, not
 * text. Tapping a day opens it as a bottom sheet — the house's phone pattern
 * for "one thing, in detail" (`EditorDialog presentation="sheet"`).
 */
function MonthVariant({
  weeks,
  onOpenDay,
}: {
  weeks: CalendarWeek[]
  onOpenDay: (day: CalendarDay) => void
}) {
  return (
    <div className="px-2 py-2">
      <div className="grid grid-cols-7 gap-1" data-testid="cal-month-grid">
        {WEEKDAY_SHORT.map(day => (
          <div key={day} className="pb-1 text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {day}
          </div>
        ))}
        {weeks.flatMap(week =>
          week.days.map(day => {
            const level = densityLevel(day.entries.length)
            const shade = level === 0 ? '' : level === 1 ? 'bg-primary/15' : level === 2 ? 'bg-primary/35' : 'bg-primary/70'
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`${day.dayOfMonth}, ${day.entries.length} entries`}
                className={`flex min-h-11 flex-col items-center justify-center rounded-lg text-xs font-semibold ${
                  day.inMonth ? 'text-foreground' : 'text-muted-foreground/40'
                } ${shade} ${day.isToday ? 'ring-1 ring-primary' : ''}`}
              >
                <span>{day.dayOfMonth}</span>
                {day.entries.length > 0 && (
                  <span className="mt-0.5 flex gap-0.5" aria-hidden>
                    {day.entries.slice(0, 3).map(entry => (
                      <span
                        key={entry.id}
                        className={`size-1 rounded-full ${notebookAccent(entry.sourceNotebook).bar}`}
                      />
                    ))}
                  </span>
                )}
              </button>
            )
          }),
        )}
      </div>
      <p className="px-2 pt-3 text-center text-[11px] text-muted-foreground">
        Tap a day for its notes. Dots show which notebooks have entries.
      </p>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export function CalendarStreamView({
  entries,
  initialMonth,
  variant: controlledVariant,
  onVariantChange,
}: CalendarStreamViewProps) {
  const [uncontrolledVariant, setUncontrolledVariant] = useState<CalendarVariant>('agenda')
  const variant = controlledVariant ?? uncontrolledVariant
  const setVariant = useCallback(
    (next: CalendarVariant) => {
      setUncontrolledVariant(next)
      onVariantChange?.(next)
    },
    [onVariantChange],
  )
  const [month, setMonth] = useState(() => initialMonth ?? new Date())
  // The week strip has its own anchor: a week is a different unit from a
  // month, and anchoring the strip to the 1st of the month would open on a
  // mostly-empty week. It follows the SELECTED day instead.
  const [weekAnchor, setWeekAnchor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()))

  const buckets = useMemo(() => buildDayBuckets(entries), [entries])
  const agenda = useMemo(() => buildMonthAgenda(month, buckets), [month, buckets])
  const grid = useMemo(() => buildMonthGrid(month, buckets), [month, buckets])
  const strip = useMemo(() => buildWeekStrip(weekAnchor, buckets), [weekAnchor, buckets])

  const undated = buckets.undated

  const openDay = useCallback((day: CalendarDay) => {
    setSelectedDay(day)
  }, [])

  const selectDay = useCallback((day: CalendarDay) => {
    setSelectedKey(day.key)
    setWeekAnchor(day.date)
    // Keep the month anchor in step, so switching shapes never jumps.
    setMonth(new Date(day.date.getFullYear(), day.date.getMonth(), 1))
  }, [])

  const label = variant === 'week'
    ? `Week of ${monthLabel(weekAnchor)}`
    : monthLabel(month)

  return (
    <div className="flex flex-1 flex-col bg-background" data-testid="calendar-stream-view">
      <CalendarToolbar
        label={label}
        onPrev={() => {
          if (variant === 'week') {
            setWeekAnchor(d => shiftDay(d, -7))
            return
          }
          setMonth(m => shiftMonth(m, -1))
        }}
        onNext={() => {
          if (variant === 'week') {
            setWeekAnchor(d => shiftDay(d, 7))
            return
          }
          setMonth(m => shiftMonth(m, 1))
        }}
        onToday={() => {
          const now = new Date()
          setMonth(now)
          setWeekAnchor(now)
          setSelectedKey(dayKey(now))
        }}
        right={
          <div className="flex w-full gap-0.5 rounded-pill border border-border bg-card p-0.5" data-testid="cal-variant-switch">
            {VARIANTS.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariant(v.id)}
                aria-pressed={variant === v.id}
                className={`min-h-11 flex-1 rounded-pill px-2.5 text-[11px] font-semibold transition-colors ${
                  variant === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        }
      />

      {variant === 'agenda' && <AgendaVariant days={agenda} onPlan={openDay} />}
      {variant === 'week' && (
        <WeekVariant
          days={strip}
          selectedKey={selectedKey}
          onSelect={selectDay}
          onPlan={openDay}
        />
      )}
      {variant === 'month' && <MonthVariant weeks={grid} onOpenDay={openDay} />}

      {/* The undated shelf — a calendar cannot place these, so they are named
          as a problem instead of vanishing. */}
      {undated.length > 0 && (
        <div className="mx-3 mb-3 rounded-lg border border-dashed border-border bg-muted/40 p-3">
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Undated · {undated.length}
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The calendar has no day for these. Give them one to place them.
          </p>
          <div className="mt-2 space-y-2">
            {undated.map(entry => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* The day sheet — a bottom sheet on phones, a centered panel on desktop. */}
      <EditorDialog
        open={selectedDay !== null}
        onClose={() => setSelectedDay(null)}
        title={selectedDay ? `${WEEKDAY_SHORT[(selectedDay.date.getDay() + 6) % 7]} ${selectedDay.dayOfMonth}` : ''}
        description={
          selectedDay
            ? `${selectedDay.entries.length} ${selectedDay.entries.length === 1 ? 'entry' : 'entries'} · ${selectedDay.key}`
            : undefined
        }
        presentation="sheet"
        footer={
          <div className="flex w-full gap-2 pb-[env(safe-area-inset-bottom)]">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setSelectedDay(null)}>
              Close
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setSelectedDay(null)}>
              Plan here
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          {selectedDay?.entries.length ? (
            selectedDay.entries.map(entry => <EntryCard key={entry.id} entry={entry} />)
          ) : (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              Nothing on this day yet.
            </p>
          )}
        </div>
      </EditorDialog>
    </div>
  )
}
