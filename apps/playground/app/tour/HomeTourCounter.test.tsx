/**
 * HomeTourCounter.test.tsx — focused integration test for the header stage
 * counter derivation on the home page.
 *
 * The home header chip shows completed / total home quests (5). At fresh load
 * while the hero is still visible, only the arrival quest should be counted;
 * the first tour stage must not be marked complete until the runway actually
 * scrolls into view.
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { render, cleanup, act } from '@testing-library/react'
import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest, Chapter } from '../canvas/parseCanvasMarkdown'

const STORAGE_KEY = 'wodwiki.quests.v1'

mock.module('@/components/organisms/editor/NoteEditor', () => ({
  NoteEditor: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (value: string) => void
  }) => (
    <textarea
      data-testid="note-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

mock.module('@/components/organisms/editor/RuntimeTimerPanel', () => ({
  RuntimeTimerPanel: () => <div data-testid="mock-timer-panel" />,
}))

mock.module('@/components/organisms/review/AnalyticsScorecard', () => ({
  AnalyticsScorecard: () => null,
}))

mock.module('@/components/organisms/review/ReviewGrid', () => ({
  ReviewGrid: () => null,
}))

mock.module('@/components/organisms/cast/CastButtonRpc', () => ({
  CastButtonRpc: () => null,
}))

mock.module('../hooks/useCompletionChallenge', () => ({
  useCompletionChallenge: () => {},
}))

mock.module('../hooks/useRunStartedChallenge', () => ({
  useRunStartedChallenge: () => {},
}))

mock.module('@/services/resultRecorder', () => ({
  playgroundRecorder: { record: async () => {} },
}))

mock.module('../services/createPlaygroundPage', () => ({
  ensurePlaygroundEntry: mock(async () => ({ noteId: 'playground-note-test', routeId: 'playground/test' })),
  createPlaygroundPage: mock(async () => 'test-page'),
  movePlaygroundToJournal: mock(async (noteId: string) => ({ id: noteId })),
}))

mock.module('../services/journalWorkout', () => ({
  createJournalNoteFromWorkout: async () => ({ id: 'note-clone' }),
}))

mock.module('../services/journalNotes', () => ({
  journalNotes: { create: async () => ({ id: 'note-new' }) },
}))

mock.module('@/services/telemetry', () => ({
  telemetry: { record: () => {}, events: { subscribe: () => () => {} } },
  HOME_EVENTS: {
    demoOpened: 'home:demo_opened',
    demoRun: 'home:demo_run',
    feedsOpened: 'home:feeds_opened',
    analyticsGuideOpened: 'home:analytics_guide_opened',
    chapterHeroViewed: 'home:chapter_hero_viewed',
    chapterExampleRun: 'home:chapter_example_run',
    chapterGuideClicked: 'home:chapter_guide_clicked',
    demoShared: 'home:demo_shared',
    demoEdited: 'home:demo_edited',
    libraryOpened: 'home:library_opened',
    noteCreated: 'home:note_created',
    lessonStarted: 'home:lesson_started',
    cheatsheetOpened: 'home:cheatsheet_opened',
    behaviorsOpened: 'home:behaviors_opened',
    explorerOpened: 'home:explorer_opened',
    dashboardViewed: 'home:dashboard_viewed',
    effortsOpened: 'home:efforts_opened',
    referenceOpened: 'home:reference_opened',
  },
  useTelemetry: () => () => undefined,
}))

type TestSlice = {
  index: number
  stage: { id: string; screen: string; accent: string; label: string }
  t: number
  ring: { key: string; tag?: string } | null
}

function makeSlice(): TestSlice {
  return {
    index: 0,
    stage: {
      id: 'timer-wallclock',
      screen: 'timer',
      accent: 'hsl(var(--metric-effort))',
      label: 'What Happens When It Runs',
    },
    t: 0,
    ring: { key: 'timer.floor', tag: 'Clock' },
  }
}

const store: { slice: TestSlice; runwayReached: boolean; listeners: Set<() => void> } = {
  slice: makeSlice(),
  runwayReached: false,
  listeners: new Set(),
}

function setTestRunwayReached(reached: boolean) {
  store.runwayReached = reached
  store.listeners.forEach((cb) => cb())
}

mock.module('../canvas/useScrollRunway', () => {
  return {
    useScrollRunway: () => {
      const [, force] = React.useReducer((n: number) => n + 1, 0)
      React.useEffect(() => {
        store.listeners.add(force)
        return () => store.listeners.delete(force)
      }, [])
      return {
        slice: store.slice,
        progress: 0,
        runwayReached: store.runwayReached,
        subscribe: () => () => {},
        resync: () => {},
      }
    },
    scrollRunwayTo: () => {},
  }
})

import { HomeTour } from './HomeTour'

const wodFiles: Record<string, string> = {
  'wods/examples/home/welcome-1.md': 'AMRAP 10\n  10 Pull-ups\n  15 Push-ups\n  20 Air Squats\n',
}

const homeQuests: Quest[] = [
  { id: 'qs-arrive', label: 'Welcome to WOD Wiki', desc: 'Arrived' },
  { id: 'qs-edit', label: 'Change the workout', desc: 'Edit' },
  { id: 'qs-run', label: 'Run it to the finish', desc: 'Run' },
  { id: 'qs-tour-timer', label: 'See the timer run it', desc: 'Timer' },
  { id: 'qs-tour-analytics', label: 'Review the session', desc: 'Analytics' },
]

const chapters: Chapter[] = []

function readHomeProgress(): Record<string, boolean> {
  const ledger = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
  return ledger['/'] ?? {}
}

function renderHomeTour() {
  return render(
    <MemoryRouter>
      <NuqsAdapter>
        <HomeTour
          wodFiles={wodFiles}
          theme="light"
          quests={homeQuests}
          chapters={chapters}
        />
      </NuqsAdapter>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  store.slice = makeSlice()
  store.runwayReached = false

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('HomeTour stage counter derivation', () => {
  it('counts only the arrival quest while the hero is still visible', () => {
    store.runwayReached = false
    renderHomeTour()

    const progress = readHomeProgress()
    expect(progress['qs-arrive']).toBe(true)
    expect(progress['qs-tour-timer']).toBeUndefined()
    expect(progress['qs-tour-analytics']).toBeUndefined()
  })

  it('advances the counter when the runway enters view and marks the timer stage', () => {
    store.runwayReached = false
    renderHomeTour()

    expect(readHomeProgress()['qs-tour-timer']).toBeUndefined()

    act(() => {
      setTestRunwayReached(true)
    })

    const progress = readHomeProgress()
    expect(progress['qs-arrive']).toBe(true)
    expect(progress['qs-tour-timer']).toBe(true)
  })
})
