import { describe, it, expect } from 'bun:test'
import { noteOwnership } from './shared/noteContextLinks'
import { notePath } from '../lib/routes'

describe('NoteByIdPage header logic', () => {
  it('resolves Journal breadcrumb for journal entries', () => {
    const ownership = noteOwnership({
      id: '01a16c20-5c42-7536-a0a4-744369be4e4a',
      type: 'journal',
      journalDate: '2026-10-24',
    })
    expect(ownership.up).toEqual({
      id: '2026-10-24',
      title: 'Journal',
      to: '/day/2026-10-24',
    })
  })

  it('formats canonical note path for copy action', () => {
    expect(notePath('01a16c20-5c42-7536-a0a4-744369be4e4a')).toBe(
      '/note/01a16c20-5c42-7536-a0a4-744369be4e4a',
    )
  })

  it('determines when body date is redundant with title', () => {
    const entry = { title: '2026-10-24', journalDate: '2026-10-24' }
    const showBodyDate = Boolean(entry.journalDate && entry.journalDate !== entry.title)
    expect(showBodyDate).toBe(false)

    const titledEntry = { title: 'Fran', journalDate: '2026-10-24' }
    const showTitledBodyDate = Boolean(titledEntry.journalDate && titledEntry.journalDate !== titledEntry.title)
    expect(showTitledBodyDate).toBe(true)
  })
})
