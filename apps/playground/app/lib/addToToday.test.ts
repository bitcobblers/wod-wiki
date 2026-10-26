/**
 * addEntryToTodayInput tests (#813 slice 11) — the pure mapper from an
 * Entry + a target date to a `CreateJournalNoteInput`. The Library page
 * composes the source's `rawContent` (block-index for static, journal
 * store for Note) and passes the result to `journalNotes.create`. The
 * test seam is the input shape; the IO is the page's responsibility.
 */
import { describe, it, expect } from 'bun:test'
import { addEntryToTodayInput } from './addToToday'
import type { Entry } from './entryMapper'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'crossfit-girls/fran',
    kind: 'note',
    sourceCatalog: 'crossfit-girls',
    sourceItem: 'fran',
    title: 'Fran',
    date: null,
    ...overrides,
  }
}

describe('addEntryToTodayInput', () => {
  it('maps a Note to a journal note input on the target date', () => {
    const input = addEntryToTodayInput(makeEntry({
      id: 'journal-2026-07-15',
      kind: 'note',
      sourceCatalog: 'journal',
      sourceItem: 'journal-2026-07-15',
      date: '2026-07-15',
    }), '21-15-9\nFran', '2026-07-29')
    expect(input).toEqual({
      journalDate: '2026-07-29',
      title: 'Fran',
      rawContent: '21-15-9\nFran',
      sourceId: undefined,
      type: 'journal',
    })
  })

  it('maps a Post to a journal note input (today), preserving the sourceId', () => {
    const input = addEntryToTodayInput(makeEntry({
      id: 'feeds/crossfit-programming/2026-01-12/monday',
      kind: 'note',
      sourceCatalog: 'crossfit-programming',
      sourceItem: 'monday',
      title: 'Monday',
      date: '2026-01-12',
      sourceId: 'feed:feeds/crossfit-programming/2026-01-12/monday',
    }), 'WOD: 5RM back squat, 3-round AMRAP', '2026-07-29')
    expect(input).toEqual({
      journalDate: '2026-07-29',
      title: 'Monday',
      rawContent: 'WOD: 5RM back squat, 3-round AMRAP',
      sourceId: 'feed:feeds/crossfit-programming/2026-01-12/monday',
      type: 'journal',
    })
  })
  it('maps a Session to a journal note input (today), preserving the sourceId', () => {
    const input = addEntryToTodayInput(makeEntry({
      id: 'crossfit-girls/fran',
      kind: 'note',
      sourceCatalog: 'crossfit-girls',
      sourceItem: 'fran',
      sourceId: 'collection:crossfit-girls/fran',
    }), '21-15-9\nThrusters 95lb\nPull-ups', '2026-07-29')
    expect(input).toEqual({
      journalDate: '2026-07-29',
      title: 'Fran',
      rawContent: '21-15-9\nThrusters 95lb\nPull-ups',
      sourceId: 'collection:crossfit-girls/fran',
      type: 'journal',
    })
  })
})
