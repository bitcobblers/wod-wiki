/**
 * calendarModel — pure calendar geometry for the CAL (calendar) layout mode.
 *
 * The CAL layout is a SPATIAL projection of the same entry set the Cards /
 * Rows / Feed layouts show flat: the entry's `date` becomes its position on
 * a time axis, its `sourceNotebook` becomes its color identity. Everything
 * here is pure and DOM-free so the desktop grid, the mobile agenda and the
 * month picker all derive from ONE geometry.
 *
 * Week starts Monday — the app's own convention (CalendarCard, WqlWindowPicker
 * both use `Mo` first). Date keys are LOCAL civil days (`formatDateKey`), the
 * same shape `Entry.date` carries, so a note never drifts a day across
 * timezones.
 *
 * The undated problem: `Entry.date` is nullable. A calendar has nowhere to
 * put an undated note, so it is never silently dropped — it is returned
 * separately as a shelf for the surface to render.
 */
import type { Entry } from './entryMapper'
import { formatDateKey } from '../services/dateUtils'

// ── Types ──────────────────────────────────────────────────────────────────

/** One calendar day — a date plus the entries that land on it. */
export interface CalendarDay {
  /** Local civil day key, `YYYY-MM-DD`. */
  key: string
  /** The day as a local Date (midnight). */
  date: Date
  /** Day of month, 1–31. */
  dayOfMonth: number
  /** False for the leading/trailing days borrowed from the adjacent months. */
  inMonth: boolean
  /** True for the current local day. */
  isToday: boolean
  /** Saturday or Sunday. */
  isWeekend: boolean
  /** Entries dated this day, in the order given. */
  entries: Entry[]
}

/** A calendar week — seven days, Monday first. */
export interface CalendarWeek {
  /** ISO-ish week label, e.g. `Oct 27`. */
  label: string
  days: CalendarDay[]
}

/** Entries bucketed by their day, plus the undated remainder. */
export interface DayBuckets {
  /** `YYYY-MM-DD` → the entries on that day. */
  byDay: Map<string, Entry[]>
  /** Entries with no `date` — the calendar's undated shelf. */
  undated: Entry[]
}

// ── Day keys ───────────────────────────────────────────────────────────────

/** Local civil day key for a Date. */
export function dayKey(date: Date): string {
  return formatDateKey(date)
}

/** Parse a `YYYY-MM-DD` key into a local Date at midnight. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

/** True when the key parses as a real `YYYY-MM-DD` day. */
export function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = parseDayKey(key)
  return !Number.isNaN(date.getTime()) && dayKey(date) === key
}

// ── Bucketing ──────────────────────────────────────────────────────────────

/**
 * Split entries into day buckets and an undated remainder. An entry with no
 * `date` NEVER disappears — it lands in `undated` so the surface can render
 * the shelf instead of silently shrinking the set.
 */
export function buildDayBuckets(entries: readonly Entry[]): DayBuckets {
  const byDay = new Map<string, Entry[]>()
  const undated: Entry[] = []
  for (const entry of entries) {
    const key = entry.date
    if (!key) {
      undated.push(entry)
      continue
    }
    const bucket = byDay.get(key)
    if (bucket) bucket.push(entry)
    else byDay.set(key, [entry])
  }
  return { byDay, undated }
}

// ── Grid geometry ──────────────────────────────────────────────────────────

/** Monday-first weekday index (0 = Monday … 6 = Sunday). */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function makeDay(date: Date, inMonth: boolean, buckets: DayBuckets, todayKey: string): CalendarDay {
  const key = dayKey(date)
  const weekday = date.getDay()
  return {
    key,
    date,
    dayOfMonth: date.getDate(),
    inMonth,
    isToday: key === todayKey,
    isWeekend: weekday === 0 || weekday === 6,
    entries: buckets.byDay.get(key) ?? [],
  }
}

/**
 * The month grid around `anchor` — always six rows of seven days, so the
 * calendar's height never jumps between months. Leading/trailing days belong
 * to the adjacent months and carry `inMonth: false`.
 */
export function buildMonthGrid(anchor: Date, buckets: DayBuckets, todayKey = dayKey(new Date())): CalendarWeek[] {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const first = new Date(year, month, 1)
  const gridStart = addDays(first, -mondayIndex(first))
  const weeks: CalendarWeek[] = []
  for (let w = 0; w < 6; w++) {
    const days: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(gridStart, w * 7 + d)
      days.push(makeDay(date, date.getMonth() === month && date.getFullYear() === year, buckets, todayKey))
    }
    weeks.push({ label: `${MONTHS_SHORT[days[0]!.date.getMonth()]} ${days[0]!.date.getDate()}`, days })
  }
  return weeks
}

/**
 * The seven days of the week containing `anchor` — the mobile jump strip.
 */
export function buildWeekStrip(anchor: Date, buckets: DayBuckets, todayKey = dayKey(new Date())): CalendarDay[] {
  const start = addDays(anchor, -mondayIndex(anchor))
  const days: CalendarDay[] = []
  for (let d = 0; d < 7; d++) {
    const date = addDays(start, d)
    days.push(makeDay(date, true, buckets, todayKey))
  }
  return days
}

/**
 * The days of `anchor`'s month that carry entries, ascending — the mobile
 * agenda's spine.
 */
export function buildMonthAgenda(anchor: Date, buckets: DayBuckets, todayKey = dayKey(new Date())): CalendarDay[] {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  return [...buckets.byDay.keys()]
    .filter(key => {
      const date = parseDayKey(key)
      return date.getFullYear() === year && date.getMonth() === month
    })
    .sort()
    .map(key => {
      const date = parseDayKey(key)
      return makeDay(date, true, buckets, todayKey)
    })
}

/** Month label, e.g. `October 2026`. */
export function monthLabel(anchor: Date): string {
  return `${MONTHS_FULL[anchor.getMonth()]} ${anchor.getFullYear()}`
}

/** Short month label, e.g. `Oct`. */
export function shortMonthLabel(anchor: Date): string {
  return MONTHS_SHORT[anchor.getMonth()]
}

/** Shift a month anchor by `delta` months, clamped to the 1st. */
export function shiftMonth(anchor: Date, delta: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)
}

/** Shift a day anchor by `delta` days. */
export function shiftDay(anchor: Date, delta: number): Date {
  return addDays(anchor, delta)
}

// ── Density ────────────────────────────────────────────────────────────────

/**
 * Heat level for a day, 0–3, by entry count. Used by the month heatmap; the
 * scale is deliberately shallow so "3 entries" already reads as a full cell.
 */
export function densityLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  return 3
}

// ── Notebook identity ──────────────────────────────────────────────────────

/**
 * The notebook accent — the color a notebook wears in the calendar.
 *
 * Same hue families as the library's monogram covers
 * (`notebookGalleryModel.MONOGRAM_TINTS`), so a notebook looks identical in
 * the notebook cards and on the calendar. Deterministic per slug: a notebook
 * keeps its color across sessions, routes and themes.
 */
const NOTEBOOK_ACCENTS = [
  { bar: 'bg-rose-500', chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-300' },
  { bar: 'bg-amber-500', chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-300' },
  { bar: 'bg-emerald-500', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  { bar: 'bg-sky-500', chip: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  { bar: 'bg-violet-500', chip: 'bg-violet-500/12 text-violet-700 dark:text-violet-300' },
  { bar: 'bg-cyan-500', chip: 'bg-cyan-500/12 text-cyan-700 dark:text-cyan-300' },
] as const

export interface NotebookAccent {
  /** Solid fill — a 3px bar on a calendar entry. */
  bar: string
  /** Tinted surface + text — a notebook chip. */
  chip: string
}

/** The accent for a notebook slug (empty slug → the muted fallback). */
export function notebookAccent(slug: string): NotebookAccent {
  if (!slug) return { bar: 'bg-muted-foreground', chip: 'bg-muted text-muted-foreground' }
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  return NOTEBOOK_ACCENTS[Math.abs(hash) % NOTEBOOK_ACCENTS.length]!
}

// ── Labels ─────────────────────────────────────────────────────────────────

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

export const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const WEEKDAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const
