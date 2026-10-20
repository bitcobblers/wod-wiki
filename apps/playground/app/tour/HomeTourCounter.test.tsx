/**
 * HomeTourCounter.test.tsx — focused integration test for the header stage
 * counter derivation on the home page.
 *
 * The home header chip shows completed / total home quests. At fresh load
 * only the arrival quest is counted. The timer quest completes when a run
 * actually starts (run-started validation), and the analytics quest when
 * the session-insights section scrolls into view.
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, within, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest, Chapter } from '../canvas/parseCanvasMarkdown'
import type { ScriptBlock } from '@/components/Editor/types'

const STORAGE_KEY = 'wodwiki.quests.v1'

mock.module('@/components/organisms/editor/NoteEditor', () => ({
  NoteEditor: ({
    value,
    onChange,
    onBlocksChange,
    onStartWorkout,
  }: {
    value: string
    onChange?: (value: string) => void
    onBlocksChange?: (blocks: ScriptBlock[]) => void
    onStartWorkout?: (block: ScriptBlock) => void
  }) => {
    const React = require('react')
    React.useEffect(() => {
      onBlocksChange?.([{ id: 'block-1', type: 'Timer' } as unknown as ScriptBlock])
    }, [])
    return (
      <div>
        <textarea
          data-testid="note-editor"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
        {onStartWorkout && (
          <button onClick={() => onStartWorkout?.({ id: 'block-1' } as unknown as ScriptBlock)}>Run</button>
        )}
      </div>
    )
  },
}))

mock.module('@/components/organisms/editor/RuntimeTimerPanel', () => ({
  RuntimeTimerPanel: () => <div data-testid="mock-timer-panel" />,
}))

// FullscreenTimer's chrome needs the app's AudioProvider; the counter test
// only verifies the run-started quest marking, not the overlay itself.
mock.module('@/components/atoms/AudioToggle', () => ({
  AudioToggle: () => null,
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

// useRunStartedChallenge and useTourScrollQuests stay REAL — they are the
// units whose quest-marking this suite verifies.

mock.module('../hooks/usePlaygroundRun', () => ({
  usePlaygroundRun: () => ({
    run: { noteId: 'note-1', resultId: 'res-1', block: { id: 'block-1' } as unknown as ScriptBlock },
    pendingResults: null,
    recorded: false,
    start: async () => ({ noteId: 'note-1' }),
    finalize: async () => {},
    end: async () => {},
  }),
}))

import { HomeTour } from './HomeTour'

const wodFiles: Record<string, string> = {
  'wods/examples/home/welcome-1.md': 'AMRAP 10\n  10 Pull-ups\n  15 Push-ups\n  20 Air Squats\n',
}

const homeQuests: Quest[] = [
  { id: 'qs-arrive', label: 'Welcome to WOD Wiki', desc: 'Arrived' },
  { id: 'qs-edit', label: 'Change the workout', desc: 'Edit' },
  { id: 'qs-run', label: 'Run it to the finish', desc: 'Run' },
  { id: 'qs-tour-timer', label: 'See the timer run it', desc: 'Timer', validation: { type: 'run-started' } },
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
  it('counts only the arrival quest while nothing was run or scrolled', () => {
    renderHomeTour()

    const progress = readHomeProgress()
    expect(progress['qs-arrive']).toBe(true)
    expect(progress['qs-tour-timer']).toBeUndefined()
    expect(progress['qs-tour-analytics']).toBeUndefined()
  })

  it('marks the timer quest when a run actually starts', async () => {
    renderHomeTour()

    expect(readHomeProgress()['qs-tour-timer']).toBeUndefined()

    // Run from the hero editor — the run-started validation completes
    // qs-tour-timer; scrolling alone never fakes a run.
    const runButton = await within(screen.getByTestId('tour-hero')).findByRole('button', { name: 'Run' })
    await act(async () => {
      fireEvent.click(runButton)
      await Promise.resolve()
    })

    const progress = readHomeProgress()
    expect(progress['qs-arrive']).toBe(true)
    expect(progress['qs-tour-timer']).toBe(true)
    expect(progress['qs-tour-analytics']).toBeUndefined()
  })

  it('marks the analytics quest when the insights section enters the viewport', async () => {
    type MockEntry = { el: Element; fire: (v: boolean) => void }
    const observers: MockEntry[] = []
    class MockIO {
      cb: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb
      }
      observe(el: Element) {
        const entry = {
          el,
          fire: (v: boolean) =>
            this.cb([{ isIntersecting: v } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver),
        }
        observers.push(entry)
        entry.fire(false)
      }
      unobserve() {}
      disconnect() {}
    }
    const scope = globalThis as unknown as { IntersectionObserver?: unknown }
    scope.IntersectionObserver = MockIO
    try {
      renderHomeTour()
      expect(readHomeProgress()['qs-tour-analytics']).toBeUndefined()

      const insights = observers.find((o) => o.el.id === 'tour-section-insights')
      expect(insights).toBeTruthy()
      await act(async () => {
        insights!.fire(true)
        await Promise.resolve()
      })

      expect(readHomeProgress()['qs-tour-analytics']).toBe(true)
    } finally {
      delete scope.IntersectionObserver
    }
  })
})
