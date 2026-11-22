import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core'
import { InMemoryStorage } from '@/services/storage/InMemoryStorage'
import { resetStorageForTesting, setStorageForTesting, storageService } from '@/services/storage'
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider'
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence'
import { TEST_IDS } from '@/lib/testIds'
import type { Entry } from '../../lib/entryMapper'
import { CalendarPlannerView } from './CalendarPlannerView'
import { SchedulePeekDrawer } from './SchedulePeekDrawer'
import { StreamViewPopover } from './StreamViewPopover'
import { journalSchedule } from '../../services/journalSchedule'
import { QueryService } from '@bitcobblers/wod-wiki-engine'
import { buildQueryServiceStoresFromStorage } from '@bitcobblers/wod-wiki-engine'
import { parseQuery } from '@bitcobblers/wod-wiki-wql'

function makeCalendarEntries(): Entry[] {
  return [
    {
      id: 'n-planned',
      kind: 'note',
      sourceNotebook: 'strength',
      sourceNote: 'n-planned',
      notebookId: 'notebook/strength',
      title: 'Back Squat 5x5',
      date: '2026-11-23',
      scheduledDates: ['2026-11-23'],
      overlayKind: 'planned',
      scheduleItemId: 'sched-planned',
      scheduleSlot: 'AM',
      scheduleStatus: 'planned',
    },
    {
      id: 'n-completed',
      kind: 'note',
      sourceNotebook: 'benchmarks',
      sourceNote: 'n-completed',
      notebookId: 'notebook/benchmarks',
      title: 'Fran',
      date: '2026-11-24',
      scheduledDates: ['2026-11-24'],
      overlayKind: 'logged',
      scheduleItemId: 'sched-done',
      scheduleStatus: 'completed',
      pairedSessions: [{ sessionId: 'sess-fran', duration: 245000, completed: true, startTime: 1 }],
    },
    {
      id: 'n-adhoc',
      kind: 'note',
      sourceNotebook: 'recovery',
      sourceNote: 'n-adhoc',
      notebookId: 'notebook/recovery',
      title: 'Mobility Flow',
      date: '2026-11-24',
      scheduledDates: ['2026-11-24'],
      overlayKind: 'logged',
      adHocSessionId: 'sess-mob',
      adHocSessionDate: '2026-11-24',
      pairedSessions: [{ sessionId: 'sess-mob', duration: 600000, completed: true, startTime: 2 }],
    },
    {
      id: 'n-undated',
      kind: 'note',
      sourceNotebook: 'custom',
      sourceNote: 'n-undated',
      notebookId: 'notebook/custom',
      title: 'Unscheduled Recipe',
      date: null,
    },
    // Extra items on 2026-11-24 to trigger +N more popover (CELL_ENTRY_LIMIT = 3)
    {
      id: 'n-extra-1',
      kind: 'note',
      sourceNotebook: 'strength',
      sourceNote: 'n-extra-1',
      title: 'Accessory Core',
      date: '2026-11-24',
      scheduledDates: ['2026-11-24'],
      overlayKind: 'planned',
      scheduleItemId: 'sched-extra-1',
      scheduleStatus: 'planned',
    },
    {
      id: 'n-extra-2',
      kind: 'note',
      sourceNotebook: 'strength',
      sourceNote: 'n-extra-2',
      title: 'Cooldown Row',
      date: '2026-11-24',
      scheduledDates: ['2026-11-24'],
      overlayKind: 'planned',
      scheduleItemId: 'sched-extra-2',
      scheduleStatus: 'planned',
    },
  ]
}

describe('Doc A/B Calendar Overlay, Peek Drawer, View Popover & Annotations 1–2', () => {
  beforeEach(() => {
    setStorageForTesting(new InMemoryStorage())
  })

  afterEach(() => {
    cleanup()
    resetStorageForTesting()
  })

  it('renders 4-state chips, overlay filter, interactive +N more popover, and collapsible undated shelf', async () => {
    let currentMode: 'all' | 'planned' | 'logged' = 'all'
    let inspected: Entry | null = null

    render(
      <MemoryRouter initialEntries={['/journal?layout=planner&month=2026-11']}>
        <CalendarPlannerView
          entries={makeCalendarEntries()}
          monthParam="2026-11"
          overlayMode={currentMode}
          onOverlayModeChange={(m) => {
            currentMode = m
          }}
          onInspectEntry={(entry) => {
            inspected = entry
          }}
        />
      </MemoryRouter>,
    )

    // Overlay filter switch renders All | Planned | Logged
    const filterGroup = screen.getByTestId(TEST_IDS.CALENDAR_OVERLAY_FILTER)
    expect(filterGroup).toBeDefined()
    fireEvent.click(screen.getByText('Planned'))
    expect(currentMode).toBe('planned')

    // Chip overlay states
    const chips = screen.getAllByTestId('calendar-entry-chip')
    expect(chips.some((c) => c.getAttribute('data-overlay-state') === 'planned')).toBe(true)
    expect(chips.some((c) => c.getAttribute('data-overlay-state') === 'completed')).toBe(true)

    fireEvent.click(chips[0]!)
    expect(inspected).not.toBeNull()

    // +1 more button opens interactive day overflow popover
    const moreBtn = screen.getByRole('button', { name: '+1 more' })
    fireEvent.click(moreBtn)
    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.CALENDAR_MORE_POPOVER)).toBeDefined()
    })

    // Undated shelf defaults collapsed, expands on click
    const undatedToggle = screen.getByTestId(TEST_IDS.CALENDAR_UNDATED_TOGGLE)
    expect(undatedToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Unscheduled Recipe')).toBeNull()
    fireEvent.click(undatedToggle)
    expect(screen.getByText('Unscheduled Recipe')).toBeDefined()
  })

  it('opens SchedulePeekDrawer and supports rescheduling & unscheduling without deleting the Note', async () => {
    const raw = '# Cindy\n\n```time\n20:00 AMRAP\n5 Pull-ups\n```\n'
    await storageService.saveNoteSource({
      noteId: 'note-cindy-peek',
      rawContent: raw,
      blocks: reconcileNoteBlocks(raw, { sourceRevision: 1 }),
      expectedSourceRevision: 0,
      metadata: { title: 'Cindy', type: 'note' },
    })
    const sched = await journalSchedule.scheduleNote({
      id: 'sched-peek-1',
      noteId: 'note-cindy-peek',
      date: '2026-11-23',
      slot: 'AM',
    })

    let closed = false
    let mutated = 0
    render(
      <MemoryRouter>
        <SchedulePeekDrawer
          entry={{
            id: 'note-cindy-peek',
            kind: 'note',
            sourceNotebook: 'benchmarks',
            sourceNote: 'note-cindy-peek',
            title: 'Cindy',
            date: '2026-11-23',
            overlayKind: 'planned',
            scheduleItemId: sched.id,
            scheduleSlot: 'AM',
            scheduleStatus: 'planned',
          }}
          onClose={() => {
            closed = true
          }}
          onMutated={() => {
            mutated += 1
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId(TEST_IDS.CALENDAR_PEEK_DRAWER)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Unschedule' }))
    await waitFor(() => expect(mutated).toBe(1))
    expect(closed).toBe(true)
    expect(await journalSchedule.listForNote('note-cindy-peek')).toEqual([])
    expect(await storageService.getNote('note-cindy-peek')).toBeDefined()
  })

  it('renders Doc B StreamViewPopover and switches layouts & grouping dimensions', async () => {
    let layout: 'cards' | 'planner' = 'cards'
    let toggledDim = ''

    render(
      <StreamViewPopover
        level="note"
        settings={{ level: 'note', layout: 'cards', visibleFields: ['title', 'date'] }}
        availableLayouts={['cards', 'rows', 'agenda', 'planner']}
        availableGroupDims={['date', 'notebook']}
        groupDims={['date']}
        onLayoutChange={(next) => {
          layout = next as 'cards' | 'planner'
        }}
        onToggleGroupDim={(dim) => {
          toggledDim = dim
        }}
        onToggleField={() => {}}
      />,
    )

    fireEvent.click(screen.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_TRIGGER))
    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_CONTENT)).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Planner' }))
    expect(layout).toBe('planner')
    fireEvent.click(screen.getByRole('button', { name: 'notebook' }))
    expect(toggledDim).toBe('notebook')
  })

  it('snapshots NoteRevision via StorageService.saveNoteSource when editing a session-bearing Note & discovers unfiled orphaned notes', async () => {
    const provider = new IndexedDBContentProvider(storageService)
    const persistence = new IndexedDBNotePersistence(storageService, provider)
    const rawV1 = '# Quick Orphan WOD\n\n```time\n10 Burpees\n```\n'

    // Create unfiled Note (notebookIds: []) -> Orphaned Note (Annotation 2)
    const created = await provider.saveRecord({
      id: 'orphan-session-note',
      title: 'Quick Orphan WOD',
      rawContent: rawV1,
      tags: [],
      targetDate: Date.parse('2026-11-23T12:00:00Z'),
      notebookIds: [],
    })
    const wodBlockId = Object.keys(created.blocks!)[0]!

    // Run a session against v1
    const started = await persistence.startSession(
      {
        noteId: created.id,
        rawContent: rawV1,
        blocks: created.blocks!,
        expectedSourceRevision: 1,
      },
      {
        id: 'sess-orphan-v1',
        noteId: created.id,
        blockId: wodBlockId,
        sessionDate: '2026-11-23',
        startTime: 1000,
        endTime: 1000,
        duration: 0,
        completed: false,
        createdAt: 1000,
      },
    )
    expect(started.session.noteSourceRevision).toBe(1)
    await persistence.finishSession(started.session.id, {
      startTime: 1000,
      endTime: 61_000,
      duration: 60_000,
      completed: true,
    })

    // Edit Note -> StorageService.saveNoteSource must snapshot v1 into note_revisions & bump to v2
    const rawV2 = '# Quick Orphan WOD v2\n\n```time\n20 Burpees\n```\n'
    const updated = await storageService.saveNoteSource({
      noteId: created.id,
      rawContent: rawV2,
      expectedSourceRevision: 1,
      metadata: { title: 'Quick Orphan WOD v2' },
    })
    expect(updated.sourceRevision).toBe(2)

    const rev1 = await storageService.getNoteRevision(created.id, 1)
    expect(rev1).toBeDefined()
    expect(rev1?.title).toBe('Quick Orphan WOD')
    expect(rev1?.rawContent).toBe(rawV1)

    const qs = new QueryService(buildQueryServiceStoresFromStorage(storageService.storage))
    const orphanRes = await qs.runFind(parseQuery(':note{!notebook:*}') as never)
    expect(orphanRes.notes.map((n) => n.id)).toEqual(['orphan-session-note'])
  })
})
