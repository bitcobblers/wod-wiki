/**
 * HomeTour.test.tsx — route-level component test for the home page.
 *
 * Asserts the four tagged runway sections (write / run / own / explore), the
 * jump section exits, the chapter picker, per-stage drop-off hrefs, and the
 * telemetry funnel events, arrival auto-start, record-once finalization,
 * and note-scoped results.
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest, Chapter, ScrollStage } from '../canvas/parseCanvasMarkdown'
import type { ScriptBlock, Sessions } from '@/components/Editor/types'
import { telemetry, HOME_EVENTS } from '@/services/telemetry'

// ── Heavy / browser-only dependencies ───────────────────────────────────────

mock.module('@/components/organisms/editor/NoteEditor', () => ({
  NoteEditor: (props: {
    value?: string
    onChange?: (value: string) => void
    onBlocksChange?: (blocks: ScriptBlock[]) => void
    onStartWorkout?: (block: ScriptBlock) => void
  }) => {
    const React = require('react')
    React.useEffect(() => {
      // Inject a minimal block so the Run action has a compiled block to use.
      props.onBlocksChange?.([{ id: 'block-1', type: 'Timer' } as unknown as ScriptBlock])
    }, [])
    return (
      <div>
        <textarea
          data-testid="mock-note-editor"
          value={props.value ?? ''}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
        {props.onStartWorkout && (
          <button onClick={() => props.onStartWorkout?.({ id: 'block-1' } as unknown as ScriptBlock)}>Run</button>
        )}
        {/* Stand-ins for previewDecorations' styled fence lines, which the
            card-2 block highlight measures (#884). */}
        {(props.value ?? '').includes('```') && (
          <>
            <div className="cm-wod-fence-open" />
            <div className="cm-wod-inner" />
            <div className="cm-wod-fence-close" />
          </>
        )}
      </div>
    )
  },
}))

mock.module('@/components/organisms/editor/RuntimeTimerPanel', () => ({
  RuntimeTimerPanel: (props: {
    autoStart?: boolean
    onComplete?: (blockId: string, results: Sessions) => void
    onRunStarted?: () => void
    externalStop?: boolean
  }) => {
    const control = globalThis as unknown as {
      mockTimerPanelMounts?: number
      fireTimerComplete?: (results: Sessions) => void
    }
    const React = require('react')
    React.useEffect(() => {
      control.mockTimerPanelMounts = (control.mockTimerPanelMounts ?? 0) + 1
      // Model the real panel: autoStart begins execution → idle→running.
      if (props.autoStart) props.onRunStarted?.()
    }, [])
    // Model the real panel's host-driven stop: flipping externalStop halts
    // the live execution and reports the partial once.
    React.useEffect(() => {
      if (props.externalStop) {
        props.onComplete?.('block-1', {
          startTime: 0,
          endTime: 30_000,
          duration: 30_000,
          completed: false,
          logs: [{ outputType: 'segment' }],
        } as unknown as Sessions)
      }
    }, [props.externalStop])
    control.fireTimerComplete = (results: Sessions) =>
      props.onComplete?.('block-1', results)
    return (
      <div
        data-testid="mock-timer-panel"
        data-external-stop={String(props.externalStop ?? false)}
      />
    )
  },
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

mock.module('@/components/atoms/AudioToggle', () => ({
  AudioToggle: () => null,
}))

mock.module('@/components/organisms/analytics', () => ({
  ParsedQueryChips: () => null,
}))

mock.module('../hooks/useQuickStartAutoComplete', () => ({
  useQuickStartAutoComplete: () => {},
}))

// The jump section's Library exit reads real IndexedDB coverage, which is
// empty in tests and would disable the card — pin a populated library.
import * as seedSyncModule from '@/services/seed/seedSync'
mock.module('@/services/seed/seedSync', () => ({
  ...seedSyncModule,
  readSeedCoverage: async () => ({ coreImported: true, libraryImported: true }),
}))

mock.module('../hooks/useCompletionChallenge', () => ({
  useCompletionChallenge: () => {},
}))

mock.module('../hooks/useRunStartedChallenge', () => ({
  useRunStartedChallenge: () => {},
}))

mock.module('../hooks/useTourScrollQuests', () => ({
  useTourScrollQuests: () => () => {},
}))

// ── usePlaygroundRun mock — the shared lifecycle contract ───────────────────

type RunControl = {
  run: { noteId: string; resultId: string; block: ScriptBlock } | null
  starts: number
  finalizes: Array<{ results: Sessions; completed: boolean }>
  resets: number
  ends: number
  failStarts: boolean
  recorded: boolean
}
const runControl: RunControl = {
  run: null,
  starts: 0,
  finalizes: [],
  resets: 0,
  ends: 0,
  failStarts: false,
  recorded: false,
}

mock.module('../hooks/usePlaygroundRun', () => ({
  usePlaygroundRun: () => ({
    get run() {
      return runControl.run
    },
    get recorded() {
      return runControl.recorded
    },
    pendingResults: null,
    start: mock(async (doc: string, block: ScriptBlock) => {
      if (runControl.failStarts) throw new Error('storage blocked')
      runControl.starts += 1
      runControl.run = { noteId: `note-${runControl.starts}`, resultId: `res-${runControl.starts}`, block }
      runControl.recorded = false
      return runControl.run
    }),
    finalize: mock(async (results: Sessions, completed: boolean) => {
      // Record-exactly-once, mirroring the real hook.
      if (runControl.recorded) return
      runControl.recorded = true
      runControl.finalizes.push({ results, completed })
    }),
    reset: mock(async () => {
      runControl.resets += 1
      runControl.run = null
    }),
    end: mock(async () => {
      runControl.ends += 1
      runControl.run = null
    }),
  }),
}))

// The run source remains note-scoped when the journal query fails.
const queryCalls: string[] = []
mock.module('@/services/queryService', () => ({
  queryService: {
    runQuery: mock(async (q: string) => {
      queryCalls.push(q)
      throw new Error('no store in tests')
    }),
  },
}))


mock.module('@/services/content/seedContent', () => ({
  useSeedContent: () => null,
}))

mock.module('../../views/dashboards/WidgetComposerDialog', () => ({
  WidgetComposerDialog: () => null,
}))

const toastMock = mock((..._args: unknown[]) => {})
mock.module('@/hooks/use-toast', () => ({
  toast: toastMock,
}))

mock.module('../services/journalWorkout', () => ({
  createJournalNoteFromWorkout: async () => ({ id: 'note-clone' }),
}))

mock.module('../services/journalNotes', () => ({
  journalNotes: { create: async () => ({ id: 'note-new' }) },
}))

// ── useScrollRunway mock — section-aware, driven by one global progress ──────

mock.module('../canvas/useScrollRunway', () => {
  const React = require('react')
  const store = {
    progress: 0.5,
    listeners: new Set<() => void>(),
  }

  function sliceFor(stages: ScrollStage[], progress: number) {
    const len = Math.max(1, stages.length)
    const index = Math.min(len - 1, Math.floor(progress * len))
    const stage = stages[index]!
    return {
      index,
      stage: {
        id: stage.id,
        screen: String(stage.screen),
        accent: stage.accent,
        label: stage.label,
        ring: stage.ring,
      },
      t: 0.5,
    }
  }

  function emit() {
    store.listeners.forEach((cb) => cb())
  }

  function setTestTourProgress(progress: number) {
    store.progress = progress
    emit()
  }

  const control = globalThis as unknown as {
    setTestTourProgress?: (p: number) => void
    scrollRunwayToCalls?: number
  }
  control.setTestTourProgress = setTestTourProgress

  return {
    useScrollRunway: (_ref: unknown, _frozen: boolean, stages: ScrollStage[]) => {
      const [, force] = React.useReducer((n: number) => n + 1, 0)
      React.useEffect(() => {
        store.listeners.add(force)
        return () => {
          store.listeners.delete(force)
        }
      }, [])
      return {
        slice: sliceFor(stages, store.progress),
        progress: store.progress,
        runwayReached: true,
        subscribe: () => () => {},
        resync: () => {},
      }
    },
    scrollRunwayTo: () => {
      control.scrollRunwayToCalls = (control.scrollRunwayToCalls ?? 0) + 1
    },
  }
})

import { HomeTour } from './HomeTour'
import { NavContext, initialNavState } from '../nav/NavContext'
import type { NavItemL3 } from '../nav/navTypes'

// jsdom lacks ResizeObserver; Headless UI's combobox machine touches it when
// the option list closes after a selection.
const globalWithResizeObserver = globalThis as unknown as { ResizeObserver?: unknown }
globalWithResizeObserver.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const setTestTourProgress = (progress: number) => {
  const control = globalThis as unknown as { setTestTourProgress?: (p: number) => void }
  control.setTestTourProgress?.(progress)
}

type ScrollSpy = { scrollRunwayToCalls?: number }
const scrollSpyControl = () => globalThis as unknown as ScrollSpy
const resetScrollSpy = () => {
  scrollSpyControl().scrollRunwayToCalls = 0
}
const scrollRunwayToCallCount = () => scrollSpyControl().scrollRunwayToCalls ?? 0

type TimerPanelControl = {
  mockTimerPanelMounts?: number
  fireTimerComplete?: (results: Sessions) => void
}
const timerPanelControl = () => globalThis as unknown as TimerPanelControl
const completedResults = (): Sessions =>
  ({
    startTime: 0,
    endTime: 60_000,
    duration: 60_000,
    completed: true,
    logs: [{ outputType: 'segment', timeSpan: { started: 0 }, metrics: [] }],
  }) as unknown as Sessions
// ── Test data ───────────────────────────────────────────────────────────────

const BARE_WELCOME = '```time\n0:03 Count Down\n10 Pushups\n```'
const BASICS_EXAMPLE = '```time\nPushups\n```'
const PROTOCOLS_EXAMPLE = '```time\n5:00 Run\n*:30 Rest\n10 Burpees\n```'

const wodFiles: Record<string, string> = {
  '../../markdown/canvas/home/welcome-1.md': BARE_WELCOME,
  '../../markdown/canvas/syntax/single-movement.md': BASICS_EXAMPLE,
  '../../markdown/canvas/syntax/timers-rest.md': PROTOCOLS_EXAMPLE,
}

const homeQuests: Quest[] = [
  { id: 'qs-arrive', label: 'Welcome to WOD Wiki' },
  { id: 'qs-tour-timer', label: 'See the timer run it' },
  { id: 'qs-tour-analytics', label: 'Review the session' },
]

const chapters: Chapter[] = [
  {
    id: 'home-tour',
    title: 'Take the Tour',
    badge: 'play',
    questIds: ['qs-arrive', 'qs-tour-timer', 'qs-tour-analytics'],
    sectionIds: [],
  },
  {
    id: 'basics',
    title: 'Basics',
    badge: 'trophy',
    questIds: ['basics-movement'],
    sectionIds: [],
  },
  {
    id: 'protocols',
    title: 'Protocols',
    badge: 'timer',
    questIds: ['protocols-timer'],
    sectionIds: [],
  },
]

/** Timer-backed delay (Promise.withResolvers form). */
const delay = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

async function renderHomeTour() {
  const result = render(
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
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

async function startRunAtTimerStage() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('tour-caption-command-editor-run-try'))
    setTestTourProgress(0.50)
    await Promise.resolve()
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('HomeTour', () => {
  let recorded: Array<{ name: string; payload?: Record<string, unknown> }> = []
  let unsubscribe: () => void = () => {}

  beforeEach(() => {
    setTestTourProgress(0.05)
    resetScrollSpy()
    recorded = []
    queryCalls.length = 0
    runControl.run = null
    runControl.starts = 0
    runControl.finalizes = []
    runControl.resets = 0
    runControl.ends = 0
    runControl.failStarts = false
    runControl.recorded = false
    unsubscribe = telemetry.events.subscribe((event) => recorded.push(event))
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    })
  })

  afterEach(() => {
    unsubscribe()
    cleanup()
    window.localStorage.clear()
  })

  it('renders the jump section with library and journal exits, no playground exit', async () => {
    await renderHomeTour()
    const jump = await screen.findByTestId('tour-jump-section')
    expect(jump).toBeTruthy()

    const libraryLink = within(jump).getByTestId('jump-library')
    expect(libraryLink.getAttribute('href')).toBe('/catalogs')

    expect(within(jump).getByTestId('jump-new-note')).toBeTruthy()
    expect(within(jump).queryByTestId('jump-playgrounds')).toBeNull()
  })

  it('exposes timer drop-offs with correct hrefs', async () => {
    await renderHomeTour()

    // Native caption flow renders the write captions in sequence — several
    // stages share the clock drop-off, so assert across all of them.
    const clockLinks = await screen.findAllByRole('link', { name: /Read the behaviors explainer/i })
    expect(clockLinks.length).toBeGreaterThan(0)
    for (const link of clockLinks) {
      expect(link.getAttribute('href')).toBe('/guide/clock#run-next')
    }
  })



  it('publishes a stop-the-timer outline button on the metrics row only while a run is live', async () => {
    const published: NavItemL3[][] = []
    render(
      <MemoryRouter>
        <NuqsAdapter>
          <NavContext.Provider
            value={{
              tree: [],
              navState: initialNavState,
              dispatch: () => {},
              l3Items: [],
              setL3Items: (items) => {
                published.push(items)
              },
              secondarySpec: undefined,
              setSecondarySpec: () => {},
              scrollToSection: () => {},
              registerScrollFn: () => {},
              setStreamControls: () => {},
              openCreateJournal: () => {},
              registerCreateJournal: () => {},
              setContextNav: () => {},
            }}
          >
            <HomeTour wodFiles={wodFiles} theme="light" quests={homeQuests} chapters={chapters} />
          </NavContext.Provider>
        </NuqsAdapter>
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    const lastOutline = () => published[published.length - 1] ?? []
    expect(lastOutline().find((i) => i.id === 'own')?.secondaryAction).toBeUndefined()

    await startRunAtTimerStage()
    await act(async () => {
      await Promise.resolve()
    })
    const own = lastOutline().find((i) => i.id === 'own')
    expect(own?.secondaryAction?.id).toBe('run-stop')
    expect(own?.secondaryRunIcon).toBe('stop')
  })
  it('renders a run button in the timer header and center view that flashes and starts', async () => {
    await renderHomeTour()
    // Wait for editor in hero to initialize and parse blocks
    await within(screen.getByTestId('tour-hero')).findByRole('button', { name: 'Run' })

    const runSection = screen.getByTestId('tour-section-run')
    const centerBtn = within(runSection).getByTestId('tour-timer-center-run')
    const headerBtn = within(runSection).getByTestId('tour-timer-header-run')
    expect(centerBtn).toBeTruthy()
    expect(headerBtn).toBeTruthy()
    expect(centerBtn.textContent).toContain('Run')

    await act(async () => {
      fireEvent.click(centerBtn)
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 550)
      await promise
    })
    await waitFor(() => expect(runControl.starts).toBe(1))
  })

  it('does not start a hidden run when the visitor blows past the timer stages', async () => {
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
    const globalScope = globalThis as unknown as Record<string, unknown>
    globalScope.IntersectionObserver = MockIO

    try {
      await renderHomeTour()
      await act(async () => {
        setTestTourProgress(0.10)
        await Promise.resolve()
      })
      await act(async () => {
        for (const o of observers) {
          if (o.el instanceof HTMLElement && o.el.closest('[data-testid="tour-section-run"]')) o.fire(false)
        }
        await Promise.resolve()
      })
      await act(async () => {
        await delay(500)
      })
      expect(runControl.starts).toBe(0)
    } finally {
      delete (globalThis as unknown as Record<string, unknown>).IntersectionObserver
    }
  })

  it('hero Run persists a fresh note and runs in place — no scrolling', async () => {
    await renderHomeTour()
    const runButton = await within(screen.getByTestId('tour-hero')).findByRole('button', { name: 'Run' })
    await act(async () => {
      fireEvent.click(runButton)
      await Promise.resolve()
    })

    // Fresh identity minted in place — save-first contract, no glide.
    expect(runControl.starts).toBe(1)
    expect(runControl.run?.noteId).toBe('note-1')
    expect(scrollRunwayToCallCount()).toBe(0)
    // The timer opens fullscreen; the editor stays in the hero viewport.
    expect(screen.getByTestId('mock-timer-panel')).toBeTruthy()
    expect(within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor')).toBeTruthy()
    expect(screen.getAllByTestId('mock-timer-panel')).toHaveLength(1)
  })

  it('every explicit Run after a recorded run mints a NEW note', async () => {
    await renderHomeTour()
    const hero = () => screen.getByTestId('tour-hero')
    const runButton = await within(hero()).findByRole('button', { name: 'Run' })
    await act(async () => {
      fireEvent.click(runButton)
      await Promise.resolve()
    })
    expect(runControl.starts).toBe(1)

    // The first run completes and is recorded — the hero settles on the
    // in-place result view…
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })
    expect(runControl.finalizes).toHaveLength(1)
    expect(within(hero()).getByTestId('tour-session-result')).toBeTruthy()

    // …and after dismissing back to the editor, the next Run mints a fresh
    // identity (second note), not a reuse.
    await act(async () => {
      fireEvent.click(within(hero()).getByTestId('tour-session-result-dismiss'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(within(hero()).getByRole('button', { name: 'Run' }))
      await Promise.resolve()
    })
    expect(runControl.starts).toBe(2)
    expect(runControl.run?.noteId).toBe('note-2')
  })

  it('records completion against the run identity exactly once', async () => {
    await renderHomeTour()
    await startRunAtTimerStage()
    expect(runControl.starts).toBe(1)

    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      // A duplicate completion report (Stop after natural complete) must be
      // absorbed by the record-once guard.
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })

    expect(runControl.finalizes).toHaveLength(1)
    expect(runControl.finalizes[0]).toMatchObject({ completed: true })
  })

  it('aborts the run with a toast when the note cannot be persisted', async () => {
    runControl.failStarts = true
    await renderHomeTour()
    const runButton = await within(screen.getByTestId('tour-hero')).findByRole('button', { name: 'Run' })
    await act(async () => {
      fireEvent.click(runButton)
      await Promise.resolve()
    })

    // No identity, no scroll onto the stage, and the failure is visible.
    expect(runControl.starts).toBe(0)
    expect(runControl.run).toBeNull()
    expect(scrollRunwayToCallCount()).toBe(0)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('shows the one shared document in both the hero and write displays', async () => {
    await renderHomeTour()
    // The hero view hosts a live editor at first paint; the write section's
    // sticky pane is a second display of the SAME doc state — no reset at
    // the boundary between them.
    const heroEditor = within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor') as HTMLTextAreaElement
    const writeSection = screen.getByTestId('tour-section-write')
    const writeEditor = within(writeSection).getByTestId('mock-note-editor') as HTMLTextAreaElement
    expect(writeEditor.value).toBe(heroEditor.value)

    await act(async () => {
      fireEvent.change(heroEditor, { target: { value: 'EDIT IN HERO' } })
      await Promise.resolve()
    })
    expect(writeEditor.value).toBe('EDIT IN HERO')
  })

  it('restarts the run from the timer header Reset button (#885)', async () => {
    await renderHomeTour()
    await startRunAtTimerStage()
    await screen.findByTestId('mock-timer-panel')

    const resetButton = await screen.findByRole('button', { name: /Reset timer/i })
    await act(async () => {
      fireEvent.click(resetButton)
      await Promise.resolve()
    })

    expect(runControl.finalizes).toHaveLength(1)
    expect(runControl.finalizes[0].completed).toBe(false)
    expect(runControl.resets).toBe(1)
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('tour-section-run')).getByRole('button', { name: 'Run this example' }))
      await Promise.resolve()
    })
    expect(runControl.run?.noteId).toBe('note-2')
    expect(runControl.finalizes).toHaveLength(1)
  })


  it('starts the tour once on timer arrival without a Run click', async () => {
    const observers: Array<{ el: Element; fire: (visible: boolean) => void }> = []
    class MockIO {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(el: Element) {
        observers.push({ el, fire: (visible) => this.callback([{ target: el, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver) })
      }
      disconnect() {}
      unobserve() {}
    }
    const scope = globalThis as unknown as { IntersectionObserver?: unknown }
    scope.IntersectionObserver = MockIO
    try {
      await renderHomeTour()
      expect(runControl.starts).toBe(0)
      await act(async () => {
        for (const observer of observers) {
          if (observer.el instanceof HTMLElement && observer.el.closest('[data-testid="tour-section-run"]')) observer.fire(true)
        }
        setTestTourProgress(0.5)
        await Promise.resolve()
      })
      await waitFor(() => expect(runControl.starts).toBe(1))
      await act(async () => {
        for (const observer of observers) {
          if (observer.el instanceof HTMLElement && observer.el.closest('[data-testid="tour-section-run"]')) observer.fire(false)
        }
        await Promise.resolve()
      })
      await waitFor(() => expect(runControl.finalizes).toHaveLength(1))
      expect(runControl.finalizes[0].completed).toBe(false)
      await act(async () => {
        for (const observer of observers) {
          if (observer.el instanceof HTMLElement && observer.el.closest('[data-testid="tour-section-run"]')) observer.fire(true)
        }
        await Promise.resolve()
      })
      expect(runControl.starts).toBe(1)
    } finally {
      delete scope.IntersectionObserver
    }
  })

  it('records completion in place — the visitor is never pulled elsewhere', async () => {
    await renderHomeTour()
    await startRunAtTimerStage()
    await screen.findByTestId('mock-timer-panel')

    resetScrollSpy()
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })
    // No slide to the metrics section; the result settles where the run ran.
    expect(scrollRunwayToCallCount()).toBe(0)
    expect(runControl.finalizes).toHaveLength(1)
  })

  it('stops a live hero run on metrics arrival and shows the recorded $session segments', async () => {
    // Stub IntersectionObserver so the test can toggle the run section's
    // viewport signal — leaving it is what "arriving at Own-the-Metrics"
    // means on the real page.
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
    const globalScope = globalThis as unknown as Record<string, unknown>
    globalScope.IntersectionObserver = MockIO

    try {
      await renderHomeTour()
      const hero = () => screen.getByTestId('tour-hero')
      await act(async () => {
        fireEvent.click(within(hero()).getByRole('button', { name: 'Run' }))
        await Promise.resolve()
      })
      expect(screen.getByTestId('mock-timer-panel')).toBeTruthy()

      // Scroll past the run section into Own-the-Metrics — the live runtime
      // is stopped and its partial recorded.
      await act(async () => {
        for (const o of observers) {
          if (o.el instanceof HTMLElement && o.el.closest('[data-testid="tour-section-run"]')) o.fire(false)
          if (o.el instanceof HTMLElement && o.el.closest('[data-testid="tour-section-own"]')) o.fire(true)
        }
        setTestTourProgress(0.90)
        await Promise.resolve()
      })
      await waitFor(() => expect(runControl.finalizes).toHaveLength(1))
      // The hero settles on the in-place result view…
      expect(within(hero()).getByTestId('tour-session-result')).toBeTruthy()
      // …and the metrics section pane answers with the recorded segments
      // instead of the WQL table.
      const own = screen.getByTestId('tour-section-own')
      expect(within(own).getByTestId('tour-session-result')).toBeTruthy()
    } finally {
      delete globalScope.IntersectionObserver
    }
  })

  it('scopes the WQL table to the current note only when This run is selected', async () => {
    await renderHomeTour()
    await startRunAtTimerStage()
    expect(runControl.run?.noteId).toBe('note-1')
    const own = within(screen.getByTestId('tour-section-own'))
    expect(own.getByTestId('tour-session-source-label').textContent).toBe('Example data')
    expect(queryCalls).toEqual([])
    await act(async () => {
      fireEvent.click(own.getByRole('button', { name: 'This run' }))
      await Promise.resolve()
    })
    await waitFor(() => expect(queryCalls.some((q) => q.includes('note:note-1'))).toBe(true))
    expect(own.getByTestId('tour-session-source-label').textContent).toBe('This run')
  })

  it('scopes explore queries AST-safely — empty and preset filters parse with the real parser', async () => {
    const { parseQuery } = require('@bitcobblers/wod-wiki-engine')
    const { scopeQueryToNote } = require('./screens/TourSessionAnalytics')
    const noteId = '01a108c8-ad19-7004-81c1-e737f63f2350'

    // Empty filter braces: no trailing comma.
    const empty = scopeQueryToNote('sum:totalReps{} by {effort}', noteId)
    expect(empty).toBe(`sum:totalReps{note:${noteId}} by {effort}`)
    expect(parseQuery(empty).filters.map((f: { key: string }) => f.key)).toEqual(['note'])

    // Existing filters merge before the original keys, comma-separated.
    const preset = scopeQueryToNote('sum:totalVolume{discipline:strength} by {week}', noteId)
    expect(parseQuery(preset).filters.map((f: { key: string }) => f.key)).toEqual(['note', 'discipline'])

    // Window suffix survives.
    expect(scopeQueryToNote('avg:tis{} last 6w', noteId)).toBe(`avg:tis{note:${noteId}} last 6w`)
  })

  it('chapter runway loads the scrolled-to example in both directions and links out to guides', async () => {
    await renderHomeTour()
    const picker = screen.getByTestId('tour-chapter-picker')
    const pickerEditors = within(picker).getAllByTestId('mock-note-editor') as HTMLTextAreaElement[]
    expect(pickerEditors).toHaveLength(1)

    await act(async () => {
      setTestTourProgress(0.6)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(pickerEditors[0].value).toBe(PROTOCOLS_EXAMPLE)
    })

    // Scrolling back up restores the prior chapter's example.
    await act(async () => {
      setTestTourProgress(0.0)
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(pickerEditors[0].value).toBe(BASICS_EXAMPLE)
    })

    // The guide action stays live for every chapter caption.
    const guideLink = within(picker).getByTestId('chapter-picker-guide-protocols')
    expect(guideLink.getAttribute('href')).toBe('/guide/protocols')
    fireEvent.click(guideLink)
    expect(recorded.map((e) => e.name)).toContain(HOME_EVENTS.chapterGuideClicked)
  })

  it('keeps the edited document and an in-place hero run alive across a desktop→phone viewport change', async () => {
    // Width drives CSS only: crossing the device breakpoint must not remount
    // the tree (it used to swap the hero for the mobile runway, opening the
    // fullscreen dialog and dropping the live run).
    const mqlListeners = new Map<string, Set<(e: { matches: boolean; media: string }) => void>>()
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: (e: { matches: boolean; media: string }) => void) => {
          if (!mqlListeners.has(query)) mqlListeners.set(query, new Set())
          mqlListeners.get(query)!.add(cb)
        },
        removeEventListener: (_: string, cb: (e: { matches: boolean; media: string }) => void) => {
          mqlListeners.get(query)?.delete(cb)
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
    await renderHomeTour()

    // Edit the shared document, then Run in place — the pane lives in the hero.
    const heroEditor = within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.change(heroEditor, { target: { value: 'EDIT ACROSS WIDTHS' } })
      fireEvent.click(within(screen.getByTestId('tour-hero')).getByRole('button', { name: 'Run' }))
      await Promise.resolve()
    })
    const paneBefore = screen.getByTestId('mock-timer-panel')

    // Cross the breakpoint the way a real viewport change reports it.
    await act(async () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
      window.dispatchEvent(new window.Event('resize'))
      for (const [query, cbs] of mqlListeners) {
        if (!query.includes('width')) continue
        const matches = window.innerWidth <= 1024
        for (const cb of cbs) cb({ matches, media: query })
      }
      await Promise.resolve()
    })

    // Same timer panel node in fullscreen — persists across viewport change.
    expect(screen.getByTestId('mock-timer-panel')).toBe(paneBefore)
    expect(screen.getAllByTestId('mock-timer-panel')).toHaveLength(1)

    // Stop → result remains usable in place, and the edit survives the trip
    // back to the editor.
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })
    expect(within(screen.getByTestId('tour-hero')).getByTestId('tour-session-result')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('tour-hero')).getByTestId('tour-session-result-dismiss'))
      await Promise.resolve()
    })
    expect((within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor') as HTMLTextAreaElement).value).toBe('EDIT ACROSS WIDTHS')
  })

})
