/**
 * calendarModel — the CAL layout's pure geometry.
 *
 * The cases that matter are the ones a phone will hit first: a month that
 * starts on a Monday, a leap February, a month whose last week spills into
 * the next one, and the undated entries a calendar cannot place.
 */
import { describe, expect, it } from 'bun:test'
import type { Entry } from './entryMapper'
import {
  buildDayBuckets,
  buildMonthAgenda,
  buildMonthGrid,
  buildMonthWeeks,
  buildWeekStrip,
  dayKey,
  densityLevel,
  isDayKey,
  monthLabel,
  notebookAccent,
  parseDayKey,
  shiftDay,
  shiftMonth,
} from './calendarModel'

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: 'note',
    sourceNotebook: 'journal',
    sourceNote: id,
    title: id,
    date: null,
    ...overrides,
  } as Entry
}

describe('buildDayBuckets', () => {
  it('buckets entries by their date and keeps the undated ones apart', () => {
    const buckets = buildDayBuckets([
      entry('a', { date: '2026-10-01' }),
      entry('b', { date: '2026-10-01' }),
      entry('c', { date: '2026-10-02' }),
      entry('undated'),
    ])

    expect(buckets.byDay.get('2026-10-01')?.map(e => e.id)).toEqual(['a', 'b'])
    expect(buckets.byDay.get('2026-10-02')?.map(e => e.id)).toEqual(['c'])
    // An undated entry is never silently dropped — it lands in the shelf.
    expect(buckets.undated.map(e => e.id)).toEqual(['undated'])
  })

  it('keeps every entry — dated or not — in exactly one bucket', () => {
    const entries = [
      entry('a', { date: '2026-10-01' }),
      entry('b', { date: null }),
      entry('c', { date: '2026-10-03' }),
    ]
    const buckets = buildDayBuckets(entries)
    const total = [...buckets.byDay.values()].reduce((sum, list) => sum + list.length, 0) + buckets.undated.length
    expect(total).toBe(entries.length)
  })
})

describe('buildMonthGrid', () => {
  it('is always six rows of seven days, Monday first', () => {
    const weeks = buildMonthGrid(new Date(2026, 9, 1), buildDayBuckets([]))

    expect(weeks).toHaveLength(6)
    for (const week of weeks) {
      expect(week.days).toHaveLength(7)
    }
    // October 2026 starts on a Thursday → the week starts Monday Sep 28.
    expect(weeks[0]!.days[0]!.key).toBe('2026-09-28')
    expect(weeks[0]!.days[0]!.inMonth).toBe(false)
    expect(weeks[0]!.days[3]!.key).toBe('2026-10-01')
    expect(weeks[0]!.days[3]!.inMonth).toBe(true)
  })

  it('spills into the next month when the month needs a sixth row', () => {
    // October 2026 ends on a Saturday → the sixth row is November.
    const weeks = buildMonthGrid(new Date(2026, 9, 1), buildDayBuckets([]))
    const lastWeek = weeks[5]!
    expect(lastWeek.days[0]!.inMonth).toBe(false)
    expect(lastWeek.days[0]!.key).toBe('2026-11-02')
  })

  it('handles a leap February without losing a day', () => {
    const weeks = buildMonthGrid(new Date(2028, 1, 1), buildDayBuckets([]))
    const februaryDays = weeks.flatMap(w => w.days).filter(d => d.inMonth)
    expect(februaryDays).toHaveLength(29)
    expect(februaryDays[28]!.key).toBe('2028-02-29')
  })

  it('places entries on their own day', () => {
    const buckets = buildDayBuckets([entry('a', { date: '2026-10-16' })])
    const weeks = buildMonthGrid(new Date(2026, 9, 1), buckets)
    const day = weeks.flatMap(w => w.days).find(d => d.key === '2026-10-16')
    expect(day?.entries.map(e => e.id)).toEqual(['a'])
  })

  it('marks today and weekends', () => {
    const weeks = buildMonthGrid(new Date(2026, 9, 1), buildDayBuckets([]), '2026-10-30')
    const days = weeks.flatMap(w => w.days)
    expect(days.find(d => d.key === '2026-10-30')?.isToday).toBe(true)
    expect(days.find(d => d.key === '2026-10-31')?.isWeekend).toBe(true)
    expect(days.find(d => d.key === '2026-10-29')?.isWeekend).toBe(false)
  })
})

describe('buildMonthWeeks — the planner board', () => {
  it('returns the weeks the anchor month touches, not a fixed six rows', () => {
    // October 2026 starts Thursday and ends Saturday → five overlapping weeks.
    const weeks = buildMonthWeeks(new Date(2026, 9, 1), buildDayBuckets([]))
    expect(weeks).toHaveLength(5)
    expect(weeks[0]!.days[0]!.key).toBe('2026-09-28')
    expect(weeks[4]!.days[6]!.key).toBe('2026-11-01')
  })

  it('covers every day of the month exactly once', () => {
    const weeks = buildMonthWeeks(new Date(2026, 9, 1), buildDayBuckets([]))
    const inMonth = weeks.flatMap(w => w.days).filter(d => d.inMonth)
    expect(inMonth).toHaveLength(31)
    expect(new Set(inMonth.map(d => d.key)).size).toBe(31)
  })

  it('yields six rows for a month that needs them', () => {
    // August 2026 starts Saturday and ends Monday → six overlapping weeks.
    expect(buildMonthWeeks(new Date(2026, 7, 1), buildDayBuckets([]))).toHaveLength(6)
  })

  it('places entries on their own day', () => {
    const buckets = buildDayBuckets([entry('a', { date: '2026-10-16' })])
    const weeks = buildMonthWeeks(new Date(2026, 9, 1), buckets)
    const day = weeks.flatMap(w => w.days).find(d => d.key === '2026-10-16')
    expect(day?.entries.map(e => e.id)).toEqual(['a'])
  })
})

describe('buildWeekStrip', () => {
  it('returns the seven days of the anchor week, Monday first', () => {
    // Oct 30 2026 is a Friday → its week runs Mon Oct 26 to Sun Nov 1.
    const strip = buildWeekStrip(new Date(2026, 9, 30), buildDayBuckets([]))
    expect(strip).toHaveLength(7)
    expect(strip[0]!.key).toBe('2026-10-26')
    expect(strip[6]!.key).toBe('2026-11-01')
  })
})

describe('buildMonthAgenda', () => {
  it('lists only the days of the anchor month that carry entries, ascending', () => {
    const buckets = buildDayBuckets([
      entry('oct', { date: '2026-10-20' }),
      entry('sep', { date: '2026-09-30' }),
      entry('nov', { date: '2026-11-01' }),
      entry('oct2', { date: '2026-10-05' }),
    ])
    const agenda = buildMonthAgenda(new Date(2026, 9, 1), buckets)
    expect(agenda.map(d => d.key)).toEqual(['2026-10-05', '2026-10-20'])
  })
})

describe('day keys', () => {
  it('round-trips a key through a Date', () => {
    expect(dayKey(parseDayKey('2026-10-30'))).toBe('2026-10-30')
  })

  it('rejects malformed keys', () => {
    expect(isDayKey('2026-10-30')).toBe(true)
    expect(isDayKey('2026-13-01')).toBe(false)
    expect(isDayKey('2026-02-30')).toBe(false)
    expect(isDayKey('not-a-date')).toBe(false)
  })
})

describe('navigation', () => {
  it('shifts months and clamps to the first of the month', () => {
    expect(monthLabel(shiftMonth(new Date(2026, 9, 30), -1))).toBe('September 2026')
    expect(monthLabel(shiftMonth(new Date(2026, 9, 30), 1))).toBe('November 2026')
    expect(shiftMonth(new Date(2026, 9, 30), 1).getDate()).toBe(1)
  })

  it('shifts days across a month boundary', () => {
    expect(dayKey(shiftDay(parseDayKey('2026-10-31'), 1))).toBe('2026-11-01')
    expect(dayKey(shiftDay(parseDayKey('2026-03-01'), -1))).toBe('2026-02-28')
  })
})

describe('densityLevel', () => {
  it('scales 0–3 entries to four levels', () => {
    expect(densityLevel(0)).toBe(0)
    expect(densityLevel(1)).toBe(1)
    expect(densityLevel(2)).toBe(2)
    expect(densityLevel(5)).toBe(3)
  })
})

describe('notebookAccent', () => {
  it('is deterministic per slug', () => {
    expect(notebookAccent('journal')).toEqual(notebookAccent('journal'))
  })

  it('gives different notebooks different accents', () => {
    const accents = new Set(
      ['journal', 'girls', 'strength', 'engine', 'pullup', 'canvas'].map(s => notebookAccent(s).bar),
    )
    expect(accents.size).toBeGreaterThan(1)
  })

  it('falls back to a muted accent for an empty slug', () => {
    expect(notebookAccent('').bar).toContain('muted-foreground')
  })
})
