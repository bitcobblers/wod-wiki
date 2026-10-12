/**
 * entryRun tests — the feed's Run seam. Observable contract: after
 * startEntryRun resolves, pendingRuntimes holds a runtime keyed by a fresh
 * UUID (what WallClockPage consumes) and navigation targets the matching
 * route. Playground entries retain the entry's Note UUID; catalog entries
 * adopt into today's journal (existing behavior).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'

const createFromWorkoutMock = mock(() =>
  Promise.resolve({ id: 'journal-note-1', journalDate: '2026-09-05', blocks: { 'journal-workout': { id: 'journal-workout', kind: 'wod', version: 1, sourceRevision: 1, from: 0, to: 30 } } } as never),
)
mock.module('../services/journalWorkout', () => ({
  createJournalNoteFromWorkout: createFromWorkoutMock,
}))

import type { NavigateFunction } from 'react-router-dom'
import { pendingRuntimes } from '../runtimeStore'
import { journalNotes } from '../services/journalNotes'
import { entryCanRun, startEntryRun } from './entryRun'
import type { Entry } from './entryMapper'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'crossfit-girls/grace',
    kind: 'session',
    sourceCatalog: 'crossfit-girls',
    sourceItem: 'grace',
    title: 'Grace',
    date: null,
    sourceId: 'collection:crossfit-girls',
    ...overrides,
  }
}

function makeNavigate() {
  const calls: string[] = []
  const navigate = ((to: string) => {
    calls.push(to)
  }) as NavigateFunction
  return { navigate, calls }
}

beforeEach(() => {
  pendingRuntimes.clear()
  createFromWorkoutMock.mockClear()
})

describe('entryCanRun', () => {
  it('offers Run for content entries — notes (journal included), sessions, posts', () => {
    expect(entryCanRun(makeEntry())).toBe(true)
    expect(entryCanRun(makeEntry({ kind: 'post', sourceCatalog: 'crossfit-programming' }))).toBe(true)
    expect(entryCanRun(makeEntry({ kind: 'note', sourceCatalog: 'journal' }))).toBe(true)
    expect(
      entryCanRun(
        makeEntry({ id: 'uuid-1', kind: 'note', sourceCatalog: 'playground', sourceItem: 'x', sourceId: 'playground' }),
      ),
    ).toBe(true)
    expect(entryCanRun(makeEntry({ kind: 'effort', id: 'back-squat' }))).toBe(false)
    expect(entryCanRun(makeEntry({ kind: 'result', id: 'res-1' }))).toBe(false)
  })
})

describe('startEntryRun — playground entries', () => {
  it('stages a pending runtime retaining the Note UUID with origin/returnTo, then navigates', async () => {
    const entry = makeEntry({
      id: 'uuid-1',
      kind: 'note',
      sourceCatalog: 'playground',
      sourceItem: 'fran-experiment',
      sourceId: 'playground',
      wodBlock: { blockId: 'playground-workout', blockVersion: 1, blockContentId: 'wod-hash-1', content: '21-15-9 Thrusters / Pull-ups' },
    })
    const { navigate, calls } = makeNavigate()
    const original = journalNotes.getById;
    journalNotes.getById = mock(async () => ({ id: entry.id, blocks: { 'playground-workout': { id: 'playground-workout', kind: 'wod' } } }) as never);

    try { await startEntryRun(entry, navigate); } finally { journalNotes.getById = original; }

    expect(pendingRuntimes.size).toBe(1)
    const [runtimeId, pending] = [...pendingRuntimes.entries()][0]!
    expect(runtimeId).toBeTruthy()
    expect(pending?.noteId).toBe('uuid-1')
    expect(pending?.origin).toBe('playground')
    expect(pending?.returnTo).toBe('/playground/fran-experiment')
    expect(pending?.block.content).toBe('21-15-9 Thrusters / Pull-ups')
    expect(calls).toEqual([`/run/${runtimeId}`])
  })
})

describe('startEntryRun — catalog adoption', () => {
  it('writes the block to today\'s journal and auto-starts on the journal date', async () => {
    const entry = makeEntry({
      wodBlock: { blockId: 'source-workout', blockVersion: 1, blockContentId: 'wod-grace', content: '30 Clean & Jerks for time' },
    })
    const { navigate, calls } = makeNavigate()

    await startEntryRun(entry, navigate)

    expect(createFromWorkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ workoutName: 'Grace', category: 'crossfit-girls' }),
    )
    expect(pendingRuntimes.size).toBe(1)
    const [runtimeId, pending] = [...pendingRuntimes.entries()][0]!
    expect(pending?.noteId).toBe('journal-note-1')
    expect(calls).toEqual([`/journal/2026-09-05?autoStart=${runtimeId}`])
  })

  it('falls back to resolving the note and extracting its first time fence', async () => {
    const originalResolve = journalNotes.resolve
    journalNotes.resolve = mock(async () => ({
      id: 'crossfit-girls/grace',
      rawContent: '# Grace\n\n```time\n30 Clean & Jerks\n```\n',
    }) as never)
    try {
      const { navigate } = makeNavigate()
      await startEntryRun(makeEntry(), navigate)
      const [, pending] = [...pendingRuntimes.entries()][0]!
      expect(pending?.block.content.trim()).toBe('30 Clean & Jerks')
    } finally {
      journalNotes.resolve = originalResolve
    }
  })
})

describe('startEntryRun — failure', () => {
  it('throws without staging or navigating when no runnable block exists', async () => {
    const originalResolve = journalNotes.resolve
    journalNotes.resolve = mock(async () => ({ id: 'n', rawContent: '# Just prose' }) as never)
    try {
      const { navigate, calls } = makeNavigate()
      await expect(startEntryRun(makeEntry(), navigate)).rejects.toThrow(/No runnable workout block/)
      expect(pendingRuntimes.size).toBe(0)
      expect(calls).toEqual([])
    } finally {
      journalNotes.resolve = originalResolve
    }
  })
})
