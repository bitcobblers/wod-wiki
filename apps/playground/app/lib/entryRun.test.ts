/**
 * entryRun tests — the feed's Run seam. Observable contract: after
 * startEntryRun resolves, pendingRuntimes holds a runtime keyed by a fresh
 * UUID (what WallClockPage consumes) and navigation targets the matching
 * route. Playground entries retain the entry's Note UUID; catalog entries
 * adopt into today's journal (existing behavior).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createFromWorkoutMock = vi.fn(() =>
  Promise.resolve({ id: 'journal-note-1', journalDate: '2026-09-05', blocks: { 'journal-workout': { id: 'journal-workout', kind: 'wod', version: 1, sourceRevision: 1, from: 0, to: 30 } } } as never),
)

import type { NavigateFunction } from 'react-router-dom'
import { reconcileNoteBlocks, type Note } from '@bitcobblers/wod-wiki-core'
import { InMemoryStorage } from '@/services/storage/InMemoryStorage'
import { resetStorageForTesting, setStorageForTesting, storageService } from '@/services/storage'
import { pendingRuntimes } from '../runtimeStore'
import { journalNotes } from '../services/journalNotes'
import { entryCanRun, startEntryRun } from './entryRun'
import type { Entry } from './entryMapper'

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'crossfit-girls/grace',
    kind: 'note',
    sourceNotebook: 'crossfit-girls',
    sourceNote: 'grace',
    title: 'Grace',
    date: null,
    sourceId: 'collection:crossfit-girls/grace',
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
  setStorageForTesting(new InMemoryStorage())
  pendingRuntimes.clear()
  createFromWorkoutMock.mockClear()
})

afterEach(() => {
  resetStorageForTesting()
})

describe('entryCanRun', () => {
  it('offers Run for content entries — journal, collection items and feed posts are all notes', () => {
    expect(entryCanRun(makeEntry())).toBe(true)
    expect(entryCanRun(makeEntry({ sourceId: 'feed:feeds/crossfit-programming/2026-01-12/monday', sourceNotebook: 'crossfit-programming' }))).toBe(true)
    expect(entryCanRun(makeEntry({ kind: 'note', sourceNotebook: 'journal' }))).toBe(true)
    expect(
      entryCanRun(
        makeEntry({ id: 'uuid-1', kind: 'note', sourceNotebook: 'playground', sourceNote: 'x', sourceId: 'playground' }),
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
      sourceNotebook: 'playground',
      sourceNote: 'fran-experiment',
      sourceId: 'playground',
      wodBlock: { blockId: 'playground-workout', blockVersion: 1, blockContentId: 'wod-hash-1', content: '21-15-9 Thrusters / Pull-ups' },
    })
    const { navigate, calls } = makeNavigate()
    const original = journalNotes.getById;
    journalNotes.getById = vi.fn(async () => ({ id: entry.id, blocks: { 'playground-workout': { id: 'playground-workout', kind: 'wod' } } }) as never);

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

    await startEntryRun(entry, navigate, { createJournalNoteFromWorkout: createFromWorkoutMock })

    expect(createFromWorkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({ workoutName: 'Grace', category: 'crossfit-girls' }),
    )
    expect(pendingRuntimes.size).toBe(1)
    const [runtimeId, pending] = [...pendingRuntimes.entries()][0]!
    expect(pending?.noteId).toBe('journal-note-1')
    expect(calls).toEqual([`/day/2026-09-05?autoStart=${runtimeId}`])
  })

  it('falls back to resolving the note and extracting its first time fence', async () => {
    const originalResolve = journalNotes.resolve
    journalNotes.resolve = vi.fn(async () => ({
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

describe('startEntryRun — external & remote pin-and-log', () => {
  it('lazily resolves remote:<feedId>:<uuid> indexed entries via resolveRemoteWorkout and pins one archival copy', async () => {
    const raw = '# Fran\n\n```time\n21-15-9\nThrusters\nPull-ups\n```\n'
    const entry = makeEntry({
      id: 'remote:daily-feed:uuid-fran-1',
      sourceNotebook: 'daily-feed',
      sourceNote: '2026-11-10/fran',
      title: 'Fran',
      sourceId: 'notebook:daily-feed/2026-11-10/fran',
      feedId: 'daily-feed',
      isRemotePreview: true,
      ownership: {
        kind: 'feed',
        editable: false,
        canPublish: false,
        feedSourceId: 'daily-feed',
        sourceNotebookId: 'notebook/daily-feed',
      },
    })
    const { navigate, calls } = makeNavigate()

    await startEntryRun(entry, navigate, {
      resolveRemoteWorkout: async () => ({
        id: 'uuid-fran-1',
        title: 'Fran',
        rawContent: raw,
        feedSourceId: 'daily-feed',
        sourceNotebookId: 'notebook/daily-feed',
        sourcePath: '2026-11-10/fran.md',
        version: 2,
      }),
    })

    expect(pendingRuntimes.size).toBe(1)
    const [runtimeId, pending] = [...pendingRuntimes.entries()][0]!
    expect(pending?.noteId).toBe('uuid-fran-1')
    expect(pending?.block.content).toContain('21-15-9')
    expect(pending?.returnTo).toBe('/notebook/daily-feed/2026-11-10/fran?feed=daily-feed&remote=uuid-fran-1')
    expect(calls[0]).toContain(`autoStart=${runtimeId}`)

    const stored = await storageService.getNote('uuid-fran-1')
    expect(stored?.retention).toBe('session-pinned')
    expect(stored?.feedOrigin).toBe('feed')
    expect(stored?.feedSourceId).toBe('daily-feed')
    expect(await storageService.getAllNotes()).toHaveLength(1)
  })

  it('pins an existing subscribed feed entry as one archival copy instead of spawning duplicates', async () => {
    const raw = '# Karen\n\n```time\n150 Wall Balls\n```\n'
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 })
    const wodBlock = Object.values(blocks).find(b => b.kind === 'wod')!
    await storageService.saveNoteSource({
      noteId: 'feed-karen-id',
      rawContent: raw,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'Karen', type: 'note', sourceId: 'notebook:daily-feed/karen' },
    })
    const base = await storageService.getNote('feed-karen-id')
    await storageService.saveNote({
      ...base!,
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'daily-feed',
      notebookId: 'notebook/daily-feed',
      notebookIds: ['notebook/daily-feed'],
      retention: 'cached',
    } as Note)

    const entry = makeEntry({
      id: 'feed-karen-id',
      sourceNotebook: 'daily-feed',
      sourceNote: 'karen',
      title: 'Karen',
      sourceId: 'notebook:daily-feed/karen',
      wodBlock: { blockId: wodBlock.id, blockVersion: 1, blockContentId: 'wod-karen', content: '150 Wall Balls' },
      ownership: {
        kind: 'feed',
        editable: false,
        canPublish: false,
        feedSourceId: 'daily-feed',
        sourceNotebookId: 'notebook/daily-feed',
      },
    })
    const { navigate } = makeNavigate()

    await startEntryRun(entry, navigate)

    const [, pending] = [...pendingRuntimes.entries()][0]!
    expect(pending?.noteId).toBe('feed-karen-id')
    const stored = await storageService.getNote('feed-karen-id')
    expect(stored?.retention).toBe('session-pinned')
    expect(await storageService.getAllNotes()).toHaveLength(1)
  })

  it('runs user-owned non-playground notes directly on their canonical Note UUID', async () => {
    const raw = '# User Session WOD\n\n```time\n100 Burpees\n```\n'
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 })
    const wodBlock = Object.values(blocks).find(b => b.kind === 'wod')!
    await storageService.saveNoteSource({
      noteId: 'user-note-1',
      rawContent: raw,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'User Session WOD', type: 'journal', journalDate: '2026-11-10' },
    })
    const savedUserNote = await storageService.getNote('user-note-1')
    await storageService.saveNote({
      ...savedUserNote!,
      notebookId: 'notebook/journal',
      notebookIds: ['notebook/journal'],
    } as Note)

    const entry = makeEntry({
      id: 'user-note-1',
      sourceNotebook: 'journal',
      sourceNote: '2026-11-10',
      title: 'User Session WOD',
      sourceId: 'journal:2026-11-10',
      wodBlock: { blockId: wodBlock.id, blockVersion: 1, blockContentId: 'wod-user-1', content: '100 Burpees' },
      ownership: {
        kind: 'user',
        editable: true,
        canPublish: true,
      },
    })
    const { navigate, calls } = makeNavigate()

    await startEntryRun(entry, navigate)

    const [runtimeId, pending] = [...pendingRuntimes.entries()][0]!
    expect(pending?.noteId).toBe('user-note-1')
    expect(calls).toEqual([`/run/${runtimeId}`])
    expect(await storageService.getAllNotes()).toHaveLength(1)
  })
})

describe('startEntryRun — failure', () => {
  it('throws without staging or navigating when no runnable block exists', async () => {
    const originalResolve = journalNotes.resolve
    journalNotes.resolve = vi.fn(async () => ({ id: 'n', rawContent: '# Just prose' }) as never)
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
