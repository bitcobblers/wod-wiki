import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Entry } from '../../lib/entryMapper'
import { shortMonthLabel } from '../../lib/calendarModel'
import { CalendarAgendaView, formatEntryCount } from './CalendarAgendaView'

afterEach(cleanup)

function makeDatedEntry(id: string, date: string, title: string): Entry {
  return {
    id,
    kind: 'note',
    sourceNotebook: 'journal',
    sourceNote: id,
    title,
    date,
    editable: true,
  }
}

describe('CalendarAgendaView entry-count pluralization (WW-011)', () => {
  it('formats singular vs plural entry counts cleanly', () => {
    expect(formatEntryCount(0)).toBe('0 entries')
    expect(formatEntryCount(1)).toBe('1 entry')
    expect(formatEntryCount(2)).toBe('2 entries')
  })

  it('uses "1 entry" vs "2 entries" on day-cell aria-label and title attributes', () => {
    const now = new Date()
    const year = now.getFullYear()
    const monthIndex = now.getMonth()
    const monthStr = String(monthIndex + 1).padStart(2, '0')
    const shortMonth = shortMonthLabel(new Date(year, monthIndex, 1))

    const entries: Entry[] = [
      makeDatedEntry('n-1', `${year}-${monthStr}-05`, 'Single Entry Day'),
      makeDatedEntry('n-2', `${year}-${monthStr}-10`, 'First Entry'),
      makeDatedEntry('n-3', `${year}-${monthStr}-10`, 'Second Entry'),
    ]

    const { container } = render(
      <MemoryRouter>
        <CalendarAgendaView entries={entries} stickyOffset={0} />
      </MemoryRouter>,
    )

    const day5Button = container.querySelector(`button[aria-label="5 ${shortMonth} — 1 entry"]`)
    expect(day5Button).not.toBeNull()
    expect(day5Button?.getAttribute('title')).toBe(`5 ${shortMonth} — 1 entry`)

    const day10Button = container.querySelector(`button[aria-label="10 ${shortMonth} — 2 entries"]`)
    expect(day10Button).not.toBeNull()
    expect(day10Button?.getAttribute('title')).toBe(`10 ${shortMonth} — 2 entries`)

    const day1Button = container.querySelector(`button[aria-label="1 ${shortMonth} — 0 entries"]`)
    expect(day1Button).not.toBeNull()
    expect(day1Button?.getAttribute('title')).toBe(`1 ${shortMonth} — 0 entries`)

    expect(container.querySelector('[aria-label*="— 1 entries"]')).toBeNull()
  })
})
