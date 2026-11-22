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
import { CalendarAgendaView } from './CalendarAgendaView'
import { SchedulePeekDrawer } from './SchedulePeekDrawer'
import { StreamViewPopover } from './StreamViewPopover'
import { JournalDatePage } from '../../pages/JournalDatePage'
import { NavContext, initialNavState } from '../../nav/NavContext'
import type { NavStateAction } from '../../nav/navTypes'
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

  it('saves inline Day Cue (ScheduleItem.notes) and updates multi-block target (blockId) in SchedulePeekDrawer', async () => {
    const raw = [
      '# Dual Block Session',
      '',
      '```time',
      '5x5 Back Squat',
      '```',
      '',
      '```time',
      '12:00 AMRAP',
      '10 Burpees',
      '```',
      '',
    ].join('\n')
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 })
    const wodBlockIds = Object.values(blocks)
      .filter((b) => b.kind === 'wod')
      .sort((a, b) => a.from - b.from)
      .map((b) => b.id)
    expect(wodBlockIds.length).toBe(2)

    await storageService.saveNoteSource({
      noteId: 'note-multi-block',
      rawContent: raw,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'Dual Block Session', type: 'note' },
    })
    const sched = await journalSchedule.scheduleNote({
      id: 'sched-multi-1',
      noteId: 'note-multi-block',
      date: '2026-11-23',
      slot: 'AM',
    })

    const dispatched: NavStateAction[] = []
    let mutated = 0
    const { unmount } = render(
      <MemoryRouter>
        <NavContext.Provider
          value={{
            tree: [],
            navState: initialNavState,
            dispatch: (action) => {
              dispatched.push(action)
            },
            l3Items: [],
            setL3Items: () => {},
            secondarySpec: undefined,
            setSecondarySpec: () => {},
            contextNav: undefined,
            setContextNav: () => {},
            streamControls: null,
            setStreamControls: () => {},
            scrollToSection: () => {},
            registerScrollFn: () => {},
            openCreateJournal: () => {},
            registerCreateJournal: () => {},
          }}
        >
          <SchedulePeekDrawer
            entry={{
              id: 'note-multi-block',
              kind: 'note',
              sourceNotebook: 'strength',
              sourceNote: 'note-multi-block',
              title: 'Dual Block Session',
              date: '2026-11-23',
              overlayKind: 'planned',
              scheduleItemId: sched.id,
              scheduleSlot: 'AM',
              scheduleStatus: 'planned',
            }}
            onClose={() => {}}
            onMutated={() => {
              mutated += 1
            }}
          />
        </NavContext.Provider>
      </MemoryRouter>,
    )

    // Coordinates mutually exclusively with SidebarLayout's 340px right-edge rail slot
    expect(dispatched).toContainEqual({ type: 'SET_INSPECTOR_DRAWER', open: true })
    expect(screen.getByTestId(TEST_IDS.CALENDAR_PEEK_BACKDROP)).toBeDefined()

    // Inline Day Cue save
    const cueInput = screen.getByTestId(TEST_IDS.SCHEDULE_PEEK_DAY_CUE_INPUT) as HTMLTextAreaElement
    fireEvent.change(cueInput, { target: { value: 'Build to 85% if legs feel fresh' } })
    fireEvent.click(screen.getByTestId(TEST_IDS.SCHEDULE_PEEK_DAY_CUE_SAVE))

    await waitFor(async () => {
      const saved = await storageService.storage.readonly('schedule_items').get(sched.id)
      expect(saved?.notes).toBe('Build to 85% if legs feel fresh')
    })
    expect(mutated).toBeGreaterThanOrEqual(1)

    // Multi-block blockId selector appears for 2+ wod blocks and persists selection
    const blockSelect = (await waitFor(() =>
      screen.getByTestId(TEST_IDS.SCHEDULE_PEEK_BLOCK_SELECT),
    )) as HTMLSelectElement
    expect(blockSelect.options.length).toBe(3) // Whole note + 2 blocks
    fireEvent.change(blockSelect, { target: { value: wodBlockIds[1]! } })

    await waitFor(async () => {
      const saved = await storageService.storage.readonly('schedule_items').get(sched.id)
      expect(saved?.blockId).toBe(wodBlockIds[1])
    })

    // Canonical Note content stays unmodified by Day Cue / blockId edits
    const canonical = await storageService.getNote('note-multi-block')
    expect(canonical?.rawContent).toBe(raw)

    unmount()
    expect(dispatched).toContainEqual({ type: 'SET_INSPECTOR_DRAWER', open: false })
  })

  it('forks a copy for this day from SchedulePeekDrawer without modifying other scheduled dates', async () => {
    const raw = '# Back Squat 5x5\n\n```time\n5 rounds\n5 Back Squat\n```\n'
    await storageService.saveNoteSource({
      noteId: 'note-squat-canonical',
      rawContent: raw,
      blocks: reconcileNoteBlocks(raw, { sourceRevision: 1 }),
      expectedSourceRevision: 0,
      metadata: { title: 'Back Squat 5x5', type: 'note' },
    })
    const day1 = await journalSchedule.scheduleNote({
      id: 'sched-squat-day1',
      noteId: 'note-squat-canonical',
      date: '2026-11-23',
      slot: 'AM',
      notes: 'Keep tempo crisp',
    })
    const day2 = await journalSchedule.scheduleNote({
      id: 'sched-squat-day2',
      noteId: 'note-squat-canonical',
      date: '2026-11-26',
      slot: 'AM',
    })

    let closed = false
    let mutated = 0
    render(
      <MemoryRouter>
        <SchedulePeekDrawer
          entry={{
            id: 'note-squat-canonical',
            kind: 'note',
            sourceNotebook: 'strength',
            sourceNote: 'note-squat-canonical',
            title: 'Back Squat 5x5',
            date: '2026-11-23',
            overlayKind: 'planned',
            scheduleItemId: day1.id,
            scheduleSlot: 'AM',
            scheduleNotes: 'Keep tempo crisp',
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

    fireEvent.click(screen.getByTestId(TEST_IDS.SCHEDULE_PEEK_FORK_BTN))

    await waitFor(() => expect(mutated).toBe(1))
    expect(closed).toBe(true)

    const updatedDay1 = await storageService.storage.readonly('schedule_items').get(day1.id)
    const unchangedDay2 = await storageService.storage.readonly('schedule_items').get(day2.id)
    expect(updatedDay1?.noteId).not.toBe('note-squat-canonical')
    expect(updatedDay1?.notes).toBe('Keep tempo crisp')
    expect(unchangedDay2?.noteId).toBe('note-squat-canonical')

    const forkedNote = await storageService.getNote(updatedDay1!.noteId)
    expect(forkedNote).toBeDefined()
    expect(forkedNote?.seedOrigin).toBe('user')
    expect(forkedNote?.provenance?.sourceNoteId).toBe('note-squat-canonical')
  })

  it('triggers Day-header peek from Planner and Agenda and renders Day-level peek mode', async () => {
    let inspectedPlannerDay = ''
    let inspectedAgendaDay = ''

    const { unmount } = render(
      <MemoryRouter initialEntries={['/journal?layout=planner&month=2026-11']}>
        <CalendarPlannerView
          entries={makeCalendarEntries()}
          monthParam="2026-11"
          onInspectDay={(d) => {
            inspectedPlannerDay = d
          }}
        />
      </MemoryRouter>,
    )

    const plannerHeaders = screen.getAllByTestId(TEST_IDS.CALENDAR_DAY_HEADER)
    const nov23Header = plannerHeaders.find((el) => el.getAttribute('aria-label') === 'Inspect Nov 23')
    expect(nov23Header).toBeDefined()
    fireEvent.click(nov23Header!)
    expect(inspectedPlannerDay).toBe('2026-11-23')
    unmount()

    const agendaView = render(
      <MemoryRouter initialEntries={['/journal?layout=agenda&month=2026-11']}>
        <CalendarAgendaView
          entries={makeCalendarEntries()}
          stickyOffset={0}
          monthParam="2026-11"
          onInspectDay={(d) => {
            inspectedAgendaDay = d
          }}
        />
      </MemoryRouter>,
    )
    const agendaHeaders = screen.getAllByTestId(TEST_IDS.CALENDAR_DAY_HEADER)
    expect(agendaHeaders.length).toBeGreaterThan(0)
    fireEvent.click(agendaHeaders[0]!)
    expect(inspectedAgendaDay).toBe('2026-11-23')
    agendaView.unmount()

    // Seed real planned item + ad-hoc session for Day-level peek mode
    const raw = '# Day Peek Note\n\n```time\n10 Burpees\n```\n'
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 })
    const blockId = Object.keys(blocks)[0]!
    await storageService.saveNoteSource({
      noteId: 'note-day-peek',
      rawContent: raw,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'Day Peek Note', type: 'note' },
    })
    await journalSchedule.scheduleNote({
      id: 'sched-day-peek',
      noteId: 'note-day-peek',
      date: '2026-11-23',
      slot: 'AM',
      notes: 'Focus on breathing',
    })
    await storageService.storage.readwrite('sessions').put({
      id: 'sess-day-peek-adhoc',
      noteId: 'note-day-peek',
      blockId,
      blockVersion: 1,
      sessionDate: '2026-11-23',
      startTime: 1000,
      endTime: 121_000,
      duration: 120_000,
      completed: true,
      createdAt: 1000,
    })

    let plannedDate = ''
    render(
      <MemoryRouter>
        <SchedulePeekDrawer
          entry={null}
          dayDate="2026-11-23"
          onClose={() => {}}
          onPlanForDate={(dateKey) => {
            plannedDate = dateKey
          }}
        />
      </MemoryRouter>,
    )

    const drawer = screen.getByTestId(TEST_IDS.CALENDAR_PEEK_DRAWER)
    expect(drawer.getAttribute('data-peek-mode')).toBe('day')
    await waitFor(() => {
      expect(drawer.textContent).toContain('Day Peek Note')
      expect(drawer.textContent).toContain('Focus on breathing')
      expect(drawer.textContent).toContain('Logged Sessions (1)')
    })
    const openDayLink = screen.getByTestId(TEST_IDS.SCHEDULE_PEEK_OPEN_DAY) as HTMLAnchorElement
    expect(openDayLink.getAttribute('href')).toBe('/day/2026-11-23')
    fireEvent.click(screen.getByTestId(TEST_IDS.SCHEDULE_PEEK_PLAN_FOR_DATE))
    expect(plannedDate).toBe('2026-11-23')
  })

  it('hides Date window and calendar grouping options on undated StreamViewPopover routes', async () => {
    let added = false
    render(
      <StreamViewPopover
        level="effort"
        settings={{ level: 'effort', layout: 'cards', visibleFields: ['label'] }}
        availableLayouts={['cards', 'rows']}
        availableGroupDims={['date', 'week', 'discipline']}
        groupDims={['discipline']}
        calendarCapable={false}
        query=":effort"
        onQueryChange={() => {}}
        onLayoutChange={() => {}}
        onToggleGroupDim={() => {}}
        onToggleField={() => {}}
        addActionLabel="+ New effort"
        onAddAction={() => {
          added = true
        }}
      />,
    )

    fireEvent.click(screen.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_TRIGGER))
    const popover = await waitFor(() => screen.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_CONTENT))
    expect(popover.textContent).not.toContain('Date window')
    expect(screen.queryByRole('button', { name: 'date' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'week' })).toBeNull()
    expect(screen.getByRole('button', { name: 'discipline' })).toBeDefined()

    fireEvent.click(screen.getByTestId(TEST_IDS.STREAM_VIEW_ADD_ACTION))
    expect(added).toBe(true)
  })

  it('supports inline Day Cue save and Fork for this day on JournalDatePage scheduled plan cards', async () => {
    const raw = '# Threshold Run\n\n```time\n20:00 Run\n```\n'
    await storageService.saveNoteSource({
      noteId: 'note-day-card',
      rawContent: raw,
      blocks: reconcileNoteBlocks(raw, { sourceRevision: 1 }),
      expectedSourceRevision: 0,
      metadata: { title: 'Threshold Run', type: 'note' },
    })
    const sched = await journalSchedule.scheduleNote({
      id: 'sched-day-card-1',
      noteId: 'note-day-card',
      date: '2026-11-26',
      slot: 'AM',
    })
    const otherDay = await journalSchedule.scheduleNote({
      id: 'sched-day-card-2',
      noteId: 'note-day-card',
      date: '2026-11-28',
      slot: 'AM',
    })

    render(
      <MemoryRouter initialEntries={['/day/2026-11-26']}>
        <JournalDatePage journalDate="2026-11-26" theme="light" />
      </MemoryRouter>,
    )

    const cueInput = (await waitFor(() =>
      screen.getByTestId(TEST_IDS.DAY_PLAN_CUE_INPUT),
    )) as HTMLInputElement
    fireEvent.change(cueInput, { target: { value: 'Negative split final 5 minutes' } })
    fireEvent.click(screen.getByTestId(TEST_IDS.DAY_PLAN_CUE_SAVE))

    await waitFor(async () => {
      const updated = await storageService.storage.readonly('schedule_items').get(sched.id)
      expect(updated?.notes).toBe('Negative split final 5 minutes')
    })

    fireEvent.click(screen.getByTestId(TEST_IDS.DAY_PLAN_FORK_BTN))
    await waitFor(async () => {
      const repointed = await storageService.storage.readonly('schedule_items').get(sched.id)
      expect(repointed?.noteId).not.toBe('note-day-card')
    })
    const untouched = await storageService.storage.readonly('schedule_items').get(otherDay.id)
    expect(untouched?.noteId).toBe('note-day-card')
  })
})
