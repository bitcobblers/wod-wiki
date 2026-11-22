import { describe, it, expect } from 'bun:test'
import { noteOwnership } from './shared/noteContextLinks'
import { notePath } from '../lib/routes'

describe('NoteByIdPage header logic', () => {
  it('resolves Journal zone and breadcrumb for journal entries (with /journal fallback when undated)', () => {
    const dated = noteOwnership({
      id: '01a16c20-5c42-7536-a0a4-744369be4e4a',
      type: 'journal',
      journalDate: '2026-10-24',
    })
    expect(dated.zone).toBe('journal')
    expect(dated.up).toEqual({
      id: '2026-10-24',
      title: 'Journal',
      to: '/day/2026-10-24',
    })

    const undated = noteOwnership({
      id: '01a16c20-5c42-7536-a0a4-744369be4e4b',
      type: 'journal',
    })
    expect(undated.zone).toBe('journal')
    expect(undated.up).toEqual({
      id: 'journal',
      title: 'Journal',
      to: '/journal',
    })
  })

  it('resolves Pages zone for page-typed notes', () => {
    const page = noteOwnership({
      id: '01a16c20-5c42-7536-a0a4-744369be4e4c',
      type: 'page',
    })
    expect(page.zone).toBe('pages')
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
