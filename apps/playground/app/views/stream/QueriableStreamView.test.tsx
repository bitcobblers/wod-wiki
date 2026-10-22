import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { Entry } from '../../lib/entryMapper'
import { StreamQueryEngine } from '../../lib/entrySearch'
import { writeViewSettings } from '../../lib/viewSettingsStorage'
import type { ParsedFindQuery, ParsedRowsQuery } from '@bitcobblers/wod-wiki-engine'
import { QueriableStreamView } from './QueriableStreamView'
import type { Note, BlockIndexRow } from '@/types/storage'
import { pendingRuntimes } from '../../runtimeStore'
import { InMemoryStorage, setStorageForTesting, resetStorageForTesting, storageService } from '@/services/storage'
import { usePaletteStore } from '@/components/organisms/command-palette/palette-store'
import {
  CATALOGS_STREAM_PROFILE,
  EFFORTS_STREAM_PROFILE,
  FEEDS_STREAM_PROFILE,
  JOURNAL_STREAM_PROFILE,
  PLAYGROUNDS_STREAM_PROFILE,
  SESSIONS_STREAM_PROFILE,
  createResultDetailProfile,
  createCollectionCatalogProfile,
} from './streamProfile'
import { journalNotes } from '../../services/journalNotes'
import { resetSeedSubscriptionsForTest, setSeedSubscribed } from '@/services/seed/seedSubscriptions'
import { NavContext, initialNavState, type StreamNavControls } from '../../nav/NavContext'
import type { NavItemL3 } from '../../nav/navTypes'

// The notice's inline sync goes through syncSeedSource; the coverage probe
// must report "no manual library" so seedNotice routes render the banner.
let communitySyncOutcome: 'imported' | 'current' | 'error' | 'busy' = 'imported'
let coverageMock: { coreImported: boolean; libraryImported: boolean } = { coreImported: true, libraryImported: false }
const syncSeedSourceMock = mock(
  async (id: string, deps?: { force?: boolean; onProgress?: (event: Record<string, unknown>) => void }) => {
    deps?.onProgress?.({ sourceId: id, sourceLabel: 'Community', sourceIndex: 1, totalSources: 1, phase: 'checking' })
    deps?.onProgress?.({
      sourceId: id,
      sourceLabel: 'Community',
      sourceIndex: 1,
      totalSources: 1,
      phase: 'finished',
      outcome: communitySyncOutcome,
      error: communitySyncOutcome === 'error' ? 'Community seed unreachable' : null,
    })
    return communitySyncOutcome
  },
)

// defaultSeedSources stays REAL. Static import cannot work: it would bind
// the mock.module replacement below. Top-level dynamic import placed BEFORE
// the mock.module call resolves the real module (same load-boundary
// exception as the seedContent/entrySearch mocks): the notice's sync
// worklist is the registry filtered by subscription, and tests drive
// subscriptions through the real seedSubscriptions store.
const realSeedSync = await import('@/services/seed/seedSync')

// Radix overlays crash under this bun+jsdom setup (cross-realm Event
// objects — see tests/unit-setup.ts), so the drawer and toaster are asserted
// at their seams: the URL param drives the drawer, and toast() payloads are
// what the app's Toaster would display.
mock.module('../../pages/CatalogsManagerDrawer', () => ({
  CatalogsManagerDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="catalogs-manager-drawer-open" /> : null,
}))

const realUseToast = await import('@/hooks/use-toast')
let toastCalls: { title?: unknown; description?: unknown; variant?: unknown }[] = []
mock.module('@/hooks/use-toast', () => ({
  ...realUseToast,
  toast: (props: { title?: unknown; description?: unknown; variant?: unknown }) => {
    toastCalls.push(props)
  },
}))

mock.module('@/services/seed/seedSync', () => ({
  SEED_BROADCAST_CHANNEL: 'wodwiki-seed',
  SEED_CLAIM_TTL_MS: 45_000,
  // Real probe resolves past a fake-indexeddb transaction (a macrotask); a
  // bare microtask here would settle outside act and spam act warnings.
  readSeedCoverage: () => {
    const { promise, resolve } = Promise.withResolvers<{ coreImported: boolean; libraryImported: boolean }>()
    setTimeout(() => resolve(coverageMock), 0)
    return promise
  },
  runBootSeedSync: async () => 'current' as const,
  syncSeedSource: (...args: [string, { force?: boolean; onProgress?: (event: Record<string, unknown>) => void }?]) =>
    syncSeedSourceMock(...args),
  defaultSeedSources: realSeedSync.defaultSeedSources,
  // The subscribe offer opens the manager drawer, which mounts SyncSection —
  // an empty registry is enough for it to render.
  readSeedStatus: async () => ({ sources: [] }),
  subscribeCatalogUpdates: () => () => {},
}))

// Collection READMEs read through useSeedContent; tests drive the readme by
// pointing it at an in-memory corpus file. The default-engine override feeds
// {{:wql}} token blocks — the view's own queryEngine prop is untouched.
// Dynamic import (load-boundary exception): static bindings would resolve to
// the mock.module replacement; we need the real module to spread it.
const realSeedContent = await import('@/services/content/seedContent')
let seedFilesMock: Record<string, string> | null = null
mock.module('@/services/content/seedContent', () => ({
  ...realSeedContent,
  useSeedContent: () => seedFilesMock,
}))

// Same load-boundary exception: capture the real entrySearch before the
// mock.module replacement so {{:wql}} token blocks get a controllable engine.
const realEntrySearch = await import('../../lib/entrySearch')
let tokenEntries: Entry[] = []
mock.module('../../lib/entrySearch', () => ({
  ...realEntrySearch,
  defaultStreamQueryEngine: {
    query: mock(async () => tokenEntries),
    withNoteBlockInfo: () => realEntrySearch.defaultStreamQueryEngine,
  },
}))

beforeEach(() => {
  communitySyncOutcome = 'imported'
  coverageMock = { coreImported: true, libraryImported: false }
  seedFilesMock = null
  tokenEntries = []
  toastCalls = []
  window.localStorage.clear()
  // The subscriptions module caches its map — drop it so each test starts
  // from the (unsubscribed) cleared localStorage.
  resetSeedSubscriptionsForTest()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('QueriableStreamView component', () => {
  const sampleEffortEntries: Entry[] = [
    {
      id: 'back-squat',
      kind: 'effort',
      sourceCatalog: 'canonical',
      sourceItem: 'back-squat',
      title: 'Back Squat',
      date: null,
      effort: {
        slug: 'back-squat',
        label: 'Back Squat',
        discipline: 'strength',
        met: 6.0,
        intensityTier: 'heavy',
      },
    },
    {
      id: 'pull-up',
      kind: 'effort',
      sourceCatalog: 'canonical',
      sourceItem: 'pull-up',
      title: 'Pull-up',
      date: null,
      effort: {
        slug: 'pull-up',
        label: 'Pull-up',
        discipline: 'gymnastics',
        met: 5.0,
        intensityTier: 'moderate',
      },
    },
  ]

  function createMockEngine(entries: Entry[] = []) {
    const engine = new StreamQueryEngine({
      runFind: mock(async () => ({ parsed: { raw: '', target: 'note', filters: [] } as unknown as ParsedFindQuery, notes: [], blocks: [], stages: { selected: 0, matched: 0 } })),
      runFindEffort: mock(async () => ({ parsed: { raw: '', target: 'effort', filters: [] } as unknown as ParsedFindQuery, notes: [], blocks: [], efforts: [], stages: { selected: 0, matched: 0 } })),
      runRows: mock(async () => ({ parsed: { raw: '', outputType: 'all', filters: [] } as unknown as ParsedRowsQuery, runs: [] })),
    })
    engine.query = mock(async () => entries)
    return engine
  }

  it('renders the sticky header without a page title — the query bar fills the row', async () => {
    const engine = createMockEngine([])

    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <QueriableStreamView profile={EFFORTS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('queriable-stream-view')).toBeDefined()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByTestId('stream-query-bar')).toBeDefined()
  })
  it('renders entries in card stream layout by default', async () => {
    const engine = createMockEngine(sampleEffortEntries)

    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <QueriableStreamView profile={EFFORTS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Back Squat')).toBeDefined()
      expect(screen.getByText('Pull-up')).toBeDefined()
    })
    // In stream layout, rows are rendered as LibraryRows
    expect(screen.getAllByTestId('library-row-effort').length).toBe(2)
    expect(screen.queryByTestId('property-table')).toBeNull()
  })

  it('renders entries in property table layout when settings.layout is rows', async () => {
    writeViewSettings('/efforts', {
      level: 'effort',
      layout: 'rows',
      visibleFields: ['label', 'canonicalSlug', 'discipline'],
    })

    const engine = createMockEngine(sampleEffortEntries)

    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <QueriableStreamView profile={EFFORTS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('property-table')).toBeDefined()
      expect(screen.getByTestId('property-table-header-label')).toBeDefined()
      expect(screen.getByTestId('property-table-header-discipline')).toBeDefined()
    })
  })

  it('renders custom actions in the header action slot', async () => {
    const engine = createMockEngine([])

    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <QueriableStreamView
          profile={EFFORTS_STREAM_PROFILE}
          queryEngine={engine}
          actions={<button data-testid="custom-action-btn">New Effort</button>}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('custom-action-btn')).toBeDefined()
  })

  it('enforces scope lock by hiding scope radio for locked profiles', async () => {
    const engine = createMockEngine([])

    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <QueriableStreamView profile={EFFORTS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId('source-scope-radio')).toBeNull()
  })

  it('hides scope radio on the journal stream profile since selection moved to nav menu', async () => {
    const engine = createMockEngine()
    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByTestId('library-source-scope')).toBeNull()
    })
  })

  it('migrates legacy query parameters on mount to canonical WQL query', async () => {
    const { engine, executed } = stubEngine(() => [])

    render(
      <MemoryRouter initialEntries={['/journal?text=snatch']}>
        <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(executed.at(-1)).toBe(':journal{text:snatch} last 2w')
    })
  })

  it('renders Results stream cleanly without error banner on default query', async () => {
    const engine = createMockEngine([])

    render(
      <MemoryRouter initialEntries={['/results']}>
        <QueriableStreamView profile={SESSIONS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('stream-query-bar')).toBeDefined()
    await waitFor(() => {
      expect(screen.getByText('No completed session results recorded in this period.')).toBeDefined()
    })
    expect(screen.queryByTestId('stream-query-error')).toBeNull()
  })

  it('renders result detail stream profile at /results/:resultId with segment rows', async () => {
    const sampleSegmentEntries: Entry[] = [
      {
        id: 'res-42:0',
        kind: 'segment',
        sourceCatalog: 'results',
        sourceItem: 'res-42',
        title: 'Session Result',
        date: '2026-06-01',
        segment: {
          resultId: 'res-42',
          segmentIndex: 0,
          splitDurationMs: 120000,
          workReps: 21,
          roundIndex: 1,
        },
      },
    ]
    const engine = createMockEngine(sampleSegmentEntries)
    const profile = createResultDetailProfile('res-42')

    render(
      <MemoryRouter initialEntries={['/results/res-42']}>
        <QueriableStreamView profile={profile} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Session Result')).toBeDefined()
    })
    expect(screen.queryByTestId('stream-query-error')).toBeNull()
  })

  it('passes onAddToToday handler to result and segment cards with noteId', async () => {
    const handleAdd = mock(() => {})
    const sampleResultEntries: Entry[] = [
      {
        id: 'res-42',
        kind: 'result',
        sourceCatalog: 'results',
        sourceItem: 'res-42',
        title: 'Fran Workout',
        date: '2026-06-01',
        execution: {
          resultId: 'res-42',
          noteId: 'crossfit-girls/fran',
          timestamp: 1700000000000,
          outputType: 'all',
        },
      },
    ]
    const engine = createMockEngine(sampleResultEntries)

    render(
      <MemoryRouter initialEntries={['/results']}>
        <QueriableStreamView
          profile={SESSIONS_STREAM_PROFILE}
          queryEngine={engine}
          onAddToToday={handleAdd}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Fran Workout')).toBeDefined()
    })

    const addButton = screen.getByTestId('action-add')
    fireEvent.click(addButton)
    expect(handleAdd).toHaveBeenCalledTimes(1)
    expect(handleAdd.mock.calls[0][0].id).toBe('res-42')
  })

  it('defaultAddToToday resolves parent note and creates journal note', async () => {
    const originalGetById = journalNotes.getById
    const originalCreate = journalNotes.create
    try {
      journalNotes.getById = mock(async () => ({
        id: 'crossfit-girls/fran',
        title: 'Fran',
        rawContent: '21-15-9\nThrusters\nPull-ups',
        type: 'journal',
      } as any))
      journalNotes.create = mock(async () => ({} as any))

      const sampleResultEntries: Entry[] = [
        {
          id: 'res-42',
          kind: 'result',
          sourceCatalog: 'results',
          sourceItem: 'res-42',
          title: 'Fran Workout',
          date: '2026-06-01',
          execution: {
            resultId: 'res-42',
            noteId: 'crossfit-girls/fran',
            timestamp: 1700000000000,
            outputType: 'all',
          },
        },
      ]
      const engine = createMockEngine(sampleResultEntries)

      render(
        <MemoryRouter initialEntries={['/results']}>
          <QueriableStreamView profile={SESSIONS_STREAM_PROFILE} queryEngine={engine} />
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(screen.getByText('Fran Workout')).toBeDefined()
      })

      const addButton = screen.getByTestId('action-add')
      fireEvent.click(addButton)

      await waitFor(() => {
        expect(journalNotes.create).toHaveBeenCalledTimes(1)
      })
      const createCall = (journalNotes.create as any).mock.calls[0][0]
      expect(createCall.title).toBe('Fran Workout')
      expect(createCall.rawContent).toContain('Thrusters')
    } finally {
      journalNotes.getById = originalGetById
      journalNotes.create = originalCreate
    }
  })

  it('publishes dynamic section links to NavContext and updates them when WQL grouping changes', async () => {
    const datedEntries: Entry[] = [
      {
        id: 'note-1',
        kind: 'note',
        sourceCatalog: 'canonical',
        sourceItem: 'item-1',
        title: 'Workout 1',
        date: '2026-09-04',
        effort: { slug: 'fran', label: 'Fran', discipline: 'gymnastics' },
      },
      {
        id: 'note-2',
        kind: 'note',
        sourceCatalog: 'canonical',
        sourceItem: 'item-2',
        title: 'Workout 2',
        date: '2026-08-15',
        effort: { slug: 'grace', label: 'Grace', discipline: 'strength' },
      },
    ]

    let capturedLinks: NavItemL3[] = []
    const setL3Items = mock((items: NavItemL3[]) => {
      capturedLinks = items
    })

    const engine = createMockEngine(datedEntries)

    const { unmount } = render(
      <MemoryRouter initialEntries={['/journal']}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items,
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
          }}
        >
          <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
        </NavContext.Provider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(capturedLinks.length).toBeGreaterThan(0)
    })
    // Default date grouping
    expect(capturedLinks.some(l => l.id.includes('2026-09-04'))).toBe(true)
    expect(capturedLinks.some(l => l.id.includes('2026-08-15'))).toBe(true)

    unmount()
    cleanup()

    // When WQL has `by {discipline}`, grouping updates to discipline
    let disciplineLinks: NavItemL3[] = []
    const setL3Discipline = mock((items: NavItemL3[]) => {
      disciplineLinks = items
    })

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: setL3Discipline,
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
          }}
        >
          <QueriableStreamView
            profile={{ ...JOURNAL_STREAM_PROFILE, defaultWql: ':journal{} by {discipline}' }}
            queryEngine={engine}
          />
        </NavContext.Provider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(disciplineLinks.some(l => l.label === 'Gymnastics')).toBe(true)
      expect(disciplineLinks.some(l => l.label === 'Strength')).toBe(true)
    })
  })

  it('renders the feed layout with rich previews and working actions for playground entries', async () => {
    writeViewSettings('/playgrounds', {
      level: 'note',
      layout: 'feed',
      visibleFields: ['title', 'excerpt', 'date'],
    })

    const memory = new InMemoryStorage()
    setStorageForTesting(memory)
    try {
    const note: Note = {
      id: 'uuid-1',
      title: 'Fran Experiment',
      createdAt: 1_700_000_000_000,
      type: 'playground',
      sourceId: 'playground',
      rawContent: '```time\n21-15-9\nThrusters\nPull-ups\n```',
      sourceRevision: 1,
      blocks: { s1: { id: 's1', kind: 'wod', version: 1, sourceRevision: 1, from: 0, to: 38, dialect: 'time' } },
    }
    await storageService.saveNoteSource({ noteId: note.id, rawContent: note.rawContent,
      blocks: note.blocks, expectedSourceRevision: 0, createdAt: note.createdAt,
      metadata: { title: note.title, type: note.type, sourceId: note.sourceId } })
    const wodBlock: BlockIndexRow = {
      id: `${note.id}:s1`,
      noteId: 'uuid-1',
      blockId: 's1',
      blockVersion: 1,
      sourceRevision: 1, from: 0, to: 38,
      position: 0,
      dataType: 'wod',
      rawContent: note.rawContent,
      noteTitle: 'Fran Experiment',
      createdAt: 1_700_000_000_000,
      blockContentId: 'wod-hash-1',
    }
    const engine = new StreamQueryEngine({
      service: {
        runFind: mock(async () => ({
          parsed: { raw: '', target: 'note', filters: [] } as unknown as ParsedFindQuery,
          notes: [note],
          blocks: [wodBlock],
          stages: { selected: 1, matched: 1 },
        })),
      },
    })

    render(
      <MemoryRouter initialEntries={[`/playgrounds?q=${encodeURIComponent(':note{source:playground}')}`]}>
        <QueriableStreamView profile={PLAYGROUNDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(
      () => {
        expect(screen.getByTestId('stream-feed')).toBeDefined()
      },
      { timeout: 5000 },
    )

    // Rich preview: real block content, readable, no editor mounted.
    expect(screen.getByTestId('stream-feed-preview')).toBeDefined()
    expect(screen.getByText(/21-15-9/)).toBeDefined()
    expect(screen.queryByTestId('stream-feed-playground')).toBeNull()

    // Actions function on the actual entry kind: Open → /playground/:name.
    const openLink = screen.getByTestId('stream-feed-open') as HTMLAnchorElement
    expect(openLink.getAttribute('href')).toBe('/playground/uuid-1')

    // Playground scope: the note has no journal date, so grouping falls back
    // to createdAt — a real date group, never the "Catalog Sessions" shelf,
    // never the "Undated" bucket. Asserted BEFORE the Run click — Run
    // navigates to /run/:id, which drops ?q and resets the composer to the
    // profile default (in-app the view unmounts on that navigation).
    expect(screen.getByTestId('stream-feed-group-2023-11-14')).toBeDefined()
    expect(screen.queryByText('Undated')).toBeNull()
    expect(screen.queryByText('Catalog Sessions')).toBeNull()

    // Run stages a pending runtime (what WallClockPage consumes) — retaining
    // the entry's Note UUID with playground origin/returnTo — then navigates.
    fireEvent.click(screen.getByTestId('stream-feed-run'))

    await waitFor(() => {
      expect(pendingRuntimes.size).toBe(1)
    })
    const [runtimeId, pending] = [...pendingRuntimes.entries()][0]!
    expect(runtimeId).not.toBe('wod-hash-1')
    expect(pending?.noteId).toBe('uuid-1')
    expect(pending?.origin).toBe('playground')
    expect(pending?.returnTo).toBe('/playground/uuid-1')
    expect(pending?.block.content).toContain('21-15-9')
    pendingRuntimes.clear()
    } finally {
      pendingRuntimes.clear()
      resetStorageForTesting()
      await memory.close()
    }
  })

  it('L3 toggleGroupDim writes through to the WQL line and the grid follows', async () => {
    const engine = createMockEngine(sampleEffortEntries)
    let capturedControls: StreamNavControls | null = null
    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: () => {},
            l3Items: [],
            setL3Items: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            setContextNav: () => {},
            setStreamControls: (c) => { capturedControls = c },
          }}
        >
          <QueriableStreamView profile={EFFORTS_STREAM_PROFILE} queryEngine={engine} />
        </NavContext.Provider>
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(capturedControls).not.toBeNull()
    })
    act(() => {
      capturedControls?.onToggleGroupDim('tag')
    })
    await waitFor(() => {
      expect(screen.getByTestId('stream-query-status').textContent).toContain('by tag (query)')
    })
  })

  it('keeps grouping when switching layouts — groupBy survives mode changes', async () => {
    writeViewSettings('/journal', {
      level: 'note',
      layout: 'feed',
      visibleFields: ['title', 'date'],
      groupBy: 'discipline',
    })

    const datedEntries: Entry[] = [
      {
        id: 'note-1',
        kind: 'note',
        sourceCatalog: 'canonical',
        sourceItem: 'item-1',
        title: 'Workout 1',
        date: '2026-09-04',
        tags: ['strength'],
        createdAt: 1_700_000_000_000,
      },
    ]
    const engine = createMockEngine(datedEntries)

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(
      () => {
        expect(screen.getByTestId('stream-feed')).toBeDefined()
      },
      { timeout: 5000 },
    )
    // Feed renders the shared grouped sections — discipline, not date.
    expect(screen.getByTestId('stream-feed-group-Strength')).toBeDefined()
    expect(screen.queryByTestId('stream-feed-group-2026-09-04')).toBeNull()
  })

  it('feed Playground action persists via the intake helper before navigating', async () => {
    writeViewSettings('/journal', {
      level: 'note',
      layout: 'feed',
      visibleFields: ['title', 'date'],
    })

    const ensureMock = mock(() => Promise.resolve({ noteId: 'uuid-9', routeId: 'playground/grace-copy' }))
    mock.module('../../services/createPlaygroundPage', () => ({
      ensurePlaygroundEntry: ensureMock,
      createPlaygroundPage: mock(() => Promise.resolve('x')),
      movePlaygroundToJournal: mock(() => Promise.resolve({})),
    }))

    const originalResolve = journalNotes.resolve
    journalNotes.resolve = mock(async () => ({ id: 'n1', rawContent: '30 Clean & Jerks' }) as any)
    try {
      const catalogEntry: Entry = {
        id: 'crossfit-girls/grace',
        kind: 'session',
        sourceCatalog: 'crossfit-girls',
        sourceItem: 'grace',
        title: 'Grace',
        date: null,
        sourceId: 'collection:crossfit-girls',
      }
      const engine = createMockEngine([catalogEntry])

      render(
        <MemoryRouter initialEntries={['/journal']}>
          <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
        </MemoryRouter>,
      )

      await waitFor(
        () => {
          expect(screen.getByTestId('stream-feed-playground')).toBeDefined()
        },
        { timeout: 5000 },
      )

      fireEvent.click(screen.getByTestId('stream-feed-playground'))

      await waitFor(() => {
        expect(ensureMock).toHaveBeenCalledWith('30 Clean & Jerks', { title: 'Grace' })
      })
    } finally {
      journalNotes.resolve = originalResolve
    }
  })

  it('shows the sync notice on seedNotice routes when no manual library has imported', async () => {
    const engine = createMockEngine([])
    // jsdom has no IndexedDB: the coverage probe cannot find an imported
    // library — the honest answer is "missing", so the notice must render.
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const notice = await waitFor(() => screen.getByTestId('seed-library-notice'))
    expect(notice.textContent).toContain('Only the core seed is imported')
    expect(screen.getByTestId('seed-library-notice-sync')).toBeDefined()
    expect(screen.getByTestId('seed-library-notice-settings')).toBeDefined()
  })

  it('with nothing subscribed, the notice routes the primary action to the source manager instead of syncing', async () => {
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/catalogs']}>
        <LocationProbe />
        <QueriableStreamView profile={CATALOGS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const primary = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    expect(primary.textContent).toContain('Browse libraries')
    await act(async () => {
      fireEvent.click(primary)
    })

    // The in-place manager drawer deep-link — never a sync call against a
    // worklist that does not exist.
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').getAttribute('data-search')).toContain('manage=1')
      expect(screen.getByTestId('catalogs-manager-drawer-open')).toBeDefined()
    })
    expect(syncSeedSourceMock).not.toHaveBeenCalled()
  })

  it('with nothing subscribed on /feeds, the subscribe offer routes to Sync settings', async () => {
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <LocationProbe />
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const primary = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    await act(async () => {
      fireEvent.click(primary)
    })

    // No drawer outside /catalogs — the Sync settings route is the manager.
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').getAttribute('data-path')).toBe('/settings/sync')
    })
    expect(syncSeedSourceMock).not.toHaveBeenCalled()
  })

  it('a subscribed source that is already current shows an up-to-date confirmation', async () => {
    communitySyncOutcome = 'current'
    setSeedSubscribed('seed-crossfit', true)
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const syncButton = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    expect(syncButton.textContent).toContain('Sync now')
    await act(async () => {
      fireEvent.click(syncButton)
    })

    expect(syncSeedSourceMock).toHaveBeenCalledWith('seed-crossfit', expect.anything())
    await waitFor(() => {
      expect(toastCalls.some(t => t.title === 'Everything is up to date')).toBe(true)
    })
  })

  it('syncs the subscribed libraries inline and drops the notice on success', async () => {
    setSeedSubscribed('seed-crossfit', true)
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const syncButton = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    await act(async () => {
      fireEvent.click(syncButton)
    })

    expect(syncSeedSourceMock).toHaveBeenCalledWith('seed-crossfit', expect.anything())
    await waitFor(() => {
      expect(screen.queryByTestId('seed-library-notice')).toBeNull()
    })
  })

  it('syncs without force so the executor can report "current" for an up-to-date source', async () => {
    // A forced sync always decides "import" (it skips the version-equality
    // check), so the executor could never report "current" and the
    // up-to-date case stayed silent — the dead-button bug.
    communitySyncOutcome = 'current'
    setSeedSubscribed('seed-crossfit', true)
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const syncButton = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    await act(async () => {
      fireEvent.click(syncButton)
    })

    expect(syncSeedSourceMock).toHaveBeenCalledWith('seed-crossfit', expect.not.objectContaining({ force: true }))
  })

  it('never syncs the auto-importing core registry as a library', async () => {
    // seed-core auto-imports at boot and is autoImport:true — it is not a
    // "library" by the coverage probe's own rule. Syncing it would satisfy
    // the notice with the Core Registry while the community library the
    // page needs is still missing.
    setSeedSubscribed('seed-core', true)
    setSeedSubscribed('seed-crossfit', true)
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const syncButton = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    await act(async () => {
      fireEvent.click(syncButton)
    })

    const syncedIds = syncSeedSourceMock.mock.calls.map(([id]) => id)
    expect(syncedIds).not.toContain('seed-core')
    expect(syncedIds).toContain('seed-crossfit')
  })

  it('keeps the notice and shows a visible error when the inline sync fails', async () => {
    communitySyncOutcome = 'error'
    setSeedSubscribed('seed-crossfit', true)
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const syncButton = await waitFor(() => screen.getByTestId('seed-library-notice-sync'))
    await act(async () => {
      fireEvent.click(syncButton)
    })

    const error = await waitFor(() => screen.getByTestId('seed-library-notice-error'))
    expect(error.textContent).toContain('Sync failed')
    expect(screen.getByTestId('seed-library-notice')).toBeDefined()
  })

  it('empty state on an unimported library route names the missing corpus, not the search', async () => {
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/feeds']}>
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const empty = await waitFor(() => screen.getByTestId('stream-empty-state'))
    // The copy names the route's own corpus ("notes" here, "notebooks" on
    // /catalogs) — a hardcoded "notebooks" would misname the Notes page.
    // The library-coverage probe settles on a macrotask, so the empty state
    // first paints with the pre-settle copy: wait for the settled one.
    await waitFor(() => expect(empty.textContent).toContain('No notes are imported yet.'))
    expect(empty.textContent).not.toContain('match your search')
    // Exactly one remedy — the import/subscribe action. No search remedies:
    // the parser-injected scope/type filters are not the user's, so there
    // is nothing to clear.
    const buttons = within(empty).queryAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.textContent).toContain('Browse libraries')
  })

  it('empty state on /catalogs names notebooks as the missing corpus', async () => {
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/catalogs']}>
        <QueriableStreamView profile={CATALOGS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const empty = await waitFor(() => screen.getByTestId('stream-empty-state'))
    await waitFor(() => expect(empty.textContent).toContain('No notebooks are imported yet.'))
    expect(empty.textContent).not.toContain('match your search')
  })

  it('head-injected filters never offer Clear filter; an authored text clause stays removable', async () => {
    // Content imported: the corpus is present, so an empty result IS the
    // query's doing. The authored query rides the URL's verbatim `q` param
    // (useComposerQueryState's contract) — keystrokes in the composer stay
    // an uncommitted draft.
    coverageMock = { coreImported: true, libraryImported: true }
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={[`/feeds?q=${encodeURIComponent(':notebook{text:foo}')}`]}>
        <LocationProbe />
        <QueriableStreamView profile={FEEDS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    const empty = await waitFor(() => screen.getByTestId('stream-empty-state'))
    // The corpus IS imported here (coverageMock above), so the emptiness is
    // the query's doing — but the probe settles on a macrotask, so wait for
    // the settled copy before reading it.
    await waitFor(() => expect(empty.textContent).toContain('No note entries match your search.'))
    const clear = within(empty).getByRole('button', { name: 'Clear filter' })
    fireEvent.click(clear)

    // The authored text clause is gone; the notebook head's scope and plane
    // type survive as explicit filters (serializer emits plain `:note`). The
    // URL `q` is the committed query's home — the composer input keeps its
    // own draft.
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').getAttribute('data-search')).toContain(encodeURIComponent(':note{source:feeds,type:feed}'))
    })
    await waitFor(() => {
      expect(within(screen.getByTestId('stream-empty-state')).queryByRole('button', { name: 'Clear filter' })).toBeNull()
    })
  })

  it('catalog readme [heading](:query)! embeds inject results and suppress the default stream', async () => {
    seedFilesMock = {
      'markdown/collections/testcat/README.md':
        'About this catalog.\n\n[Recent entries](:feed{catalog:testcat})!\n\nMore copy after.',
    }
    tokenEntries = [
      { id: 'injected-1', kind: 'note', sourceCatalog: 'testcat', sourceItem: 'injected-1', title: 'Injected Entry', date: null },
    ]
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/c/testcat']}>
        <QueriableStreamView profile={createCollectionCatalogProfile('testcat')} queryEngine={engine} />
      </MemoryRouter>,
    )

    const block = await waitFor(() => screen.getByTestId('readme-query-block'), { timeout: 5000 })
    expect(block.textContent).toContain('Injected Entry')
    // The embed link text becomes the block heading.
    expect(screen.getByTestId('readme-query-heading').textContent).toBe('Recent entries')
    expect(screen.getByTestId('collection-readme-note').textContent).toContain('About this catalog.')
    expect(screen.getByTestId('collection-readme-note').textContent).toContain('More copy after.')
    // The override replaces the default feed stream below the readme.
    expect(screen.queryByTestId('stream-empty-state')).toBeNull()
  })

  it('embed with an empty heading renders no heading element', async () => {
    seedFilesMock = { 'markdown/collections/testcat/README.md': '[](:feed{catalog:testcat})!' }
    tokenEntries = [
      { id: 'injected-2', kind: 'note', sourceCatalog: 'testcat', sourceItem: 'injected-2', title: 'Injected Entry', date: null },
    ]
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/c/testcat']}>
        <QueriableStreamView profile={createCollectionCatalogProfile('testcat')} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByTestId('readme-query-block'), { timeout: 5000 })
    expect(screen.queryByTestId('readme-query-heading')).toBeNull()
  })

  it('bang-less WQL links in the readme stay navigation links and keep the default stream', async () => {
    seedFilesMock = { 'markdown/collections/testcat/README.md': 'Browse [all feeds](:feed{catalog:testcat}).' }
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/c/testcat']}>
        <QueriableStreamView profile={createCollectionCatalogProfile('testcat')} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByTestId('collection-readme-note'), { timeout: 5000 })
    const link = screen.getByRole('link', { name: 'all feeds' })
    expect(link.getAttribute('href')).toBe(`/c/testcat?q=${encodeURIComponent(':feed{catalog:testcat}')}`)
    expect(screen.queryByTestId('readme-query-block')).toBeNull()
    expect(screen.getByTestId('stream-empty-state')).toBeDefined()
  })

  it('catalog page keeps the default stream when the readme has no query tokens', async () => {
    seedFilesMock = { 'markdown/collections/testcat/README.md': 'Plain readme, no tokens.' }
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/c/testcat']}>
        <QueriableStreamView profile={createCollectionCatalogProfile('testcat')} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => screen.getByTestId('collection-readme-note'), { timeout: 5000 })
    expect(screen.getByTestId('stream-empty-state')).toBeDefined()
    expect(screen.queryByTestId('readme-query-block')).toBeNull()
  })

  it('never shows the sync notice on routes whose corpus is not seed-sourced', () => {
    const engine = createMockEngine([])
    render(
      <MemoryRouter initialEntries={['/efforts']}>
        <QueriableStreamView profile={EFFORTS_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    expect(screen.queryByTestId('seed-library-notice')).toBeNull()
  })
})

/** URL observer — routing assertions without coupling to drawer internals. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe" data-path={location.pathname} data-search={location.search} />
}

/** Engine stub whose query override records the executed string and can push
 *  the run's stage counts — the view's only counts source (no extra scans). */
function stubEngine(respond: (q: string, onStages?: (s: { selected: number; matched: number }) => void) => Entry[] | Promise<Entry[]>) {
  const engine = new StreamQueryEngine({
    service: {
      runFind: mock(async () => ({
        parsed: { raw: '', target: 'note', filters: [] } as unknown as ParsedFindQuery,
        notes: [],
        blocks: [],
        stages: { selected: 0, matched: 0 },
      })),
    },
  })
  const executed: string[] = []
  engine.query = mock(async (input: unknown, onStages?: (s: { selected: number; matched: number }) => void) => {
    const q = typeof input === 'string' ? input : ''
    executed.push(q)
    return respond(q, onStages)
  })
  return { engine, executed }
}

const DATED_NOTE_ENTRIES: Entry[] = [
  {
    id: 'note-1',
    kind: 'note',
    sourceCatalog: 'canonical',
    sourceItem: 'item-1',
    title: 'Workout 1',
    date: '2026-09-04',
    tags: ['strength'],
  },
  {
    id: 'note-2',
    kind: 'note',
    sourceCatalog: 'canonical',
    sourceItem: 'item-2',
    title: 'Workout 2',
    date: '2026-08-15',
    tags: ['strength'],
  },
]

describe('QueriableStreamView — query truth and retained state', () => {
  beforeEach(() => {
    usePaletteStore.setState({ isOpen: false, request: null, _resolve: null })
  })

  it('shows query truth — target, matched of total, filters, grouping precedence — from the stage callback', async () => {
    const { engine } = stubEngine((_q, onStages) => {
      onStages?.({ selected: 7, matched: 2 })
      return DATED_NOTE_ENTRIES
    })

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stream-query-counts').textContent).toBe('2 of 7')
    })
    const status = screen.getByTestId('stream-query-status').textContent ?? ''
    expect(status).toContain(':note')
    expect(status).toContain('1 applied')
    expect(status).toContain('by date (level)')
    expect(screen.queryByText('Invalid query — showing previous results')).toBeNull()
  })

  it('keeps previous results, their grouping, and their counts under an invalid draft', async () => {
    const { engine } = stubEngine(() => DATED_NOTE_ENTRIES)

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView profile={JOURNAL_STREAM_PROFILE} queryEngine={engine} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Workout 1')).toBeDefined()
    })

    fireEvent.change(screen.getByPlaceholderText('Filter or search…'), {
      target: { value: ':note{oops' },
    })

    // Exact invalid draft: error surfaced, previous results retained under
    // the previous date grouping — not regrouped by settings, not blanked.
    expect(screen.getByTestId('stream-query-error')).toBeDefined()
    expect(screen.getByText('Invalid query — showing previous results')).toBeDefined()
    expect(screen.getByText('Workout 1')).toBeDefined()
    expect(screen.getByTestId('date-group-2026-09-04')).toBeDefined()
    expect(screen.queryByTestId('stream-grouping-fallback')).toBeNull()
  })

  it('keeps the committed run\'s grouping while a newer draft has not committed yet', async () => {
    let calls = 0
    const { engine } = stubEngine(() => {
      // Run 1 commits; the next (intermediate-draft) run hangs like an
      // expensive query — the previous results stay grouped by their run.
      calls += 1
      return calls === 1 ? DATED_NOTE_ENTRIES : Promise.withResolvers<Entry[]>().promise
    })

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView
          profile={{ ...JOURNAL_STREAM_PROFILE, defaultWql: ':journal{} by {tag}' }}
          queryEngine={engine}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Workout 1')).toBeDefined()
    })
    expect(screen.getByTestId('stream-query-status').textContent).toContain('by tag (query)')

    // A valid intermediate draft re-parses immediately but its run never
    // commits — the displayed grouping must stay the committed run's.
    fireEvent.change(screen.getByPlaceholderText('Filter or search…'), {
      target: { value: ':note' },
    })

    expect(screen.getByTestId('stream-query-status').textContent).toContain('by tag (query)')
    expect(screen.queryByTestId('date-group-2026-09-04')).toBeNull()
  })

  it('groups an open property dimension without a fallback badge', async () => {
    const { engine } = stubEngine(() => DATED_NOTE_ENTRIES)

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView
          profile={{ ...JOURNAL_STREAM_PROFILE, defaultWql: ':journal{} by {domain}' }}
          queryEngine={engine}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stream-query-status').textContent).toContain('by domain (query)')
    })
    // Entries carry no domain typed tags → one Unassigned property group;
    // no fallback badge, no silent tag-bucket switch.
    expect(screen.getByTestId('stream-dated-content')).toBeDefined()
    expect(screen.queryByTestId('stream-grouping-fallback-badge')).toBeNull()
    expect(screen.queryByTestId('stream-grouping-fallback')).toBeNull()
  })

  it('offers Edit query first when an advisory no-ops the empty result', async () => {
    const { engine } = stubEngine(() => [])
    const authored = ':journal{discipline:strength}'

    render(
      <MemoryRouter initialEntries={['/journal']}>
        <QueriableStreamView
          profile={{ ...JOURNAL_STREAM_PROFILE, defaultWql: authored }}
          queryEngine={engine}
        />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('stream-empty-state')).toBeDefined()
    })

    // The header toolbar's ⌘/ control shares the Edit query name — the
    // remedy is the one inside the empty state.
    fireEvent.click(within(screen.getByTestId('stream-empty-state')).getByRole('button', { name: 'Edit query' }))
    const state = usePaletteStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.request?.wql?.initialQuery).toBe(authored)
  })
  it('renders with collection catalog profile and default cards layout', async () => {
    const profile = createCollectionCatalogProfile('dan-john')
    const { engine } = stubEngine(() => DATED_NOTE_ENTRIES)

    render(
      <MemoryRouter initialEntries={['/c/dan-john']}>
        <QueriableStreamView profile={profile} queryEngine={engine} />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('wql-composer')).toBeDefined()
    await waitFor(() => {
      expect(screen.getByTestId('stream-dated-content')).toBeDefined()
    })
  })
})
