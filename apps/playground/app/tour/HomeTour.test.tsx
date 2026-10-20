/**
 * HomeTour.test.tsx — route-level component test for the home page.
 *
 * Asserts the new flow: hero Run → fullscreen run → recorded results back
 * in the hero; the insights section showing the run-to-view CTA before any
 * run and the Rest/Test Ratio + Reaction Time cards after one; the sample
 * boards section; the jump section exits; and the note lifecycle contracts
 * (fresh identity per Run, record-once finalize, failed-start toast).
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest, Chapter } from '../canvas/parseCanvasMarkdown'
import type { ScriptBlock, Sessions, StoredOutputStatement } from '@/components/Editor/types'
import { telemetry } from '@/services/telemetry'

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
  ends: number
  failStarts: boolean
  recorded: boolean
}
const runControl: RunControl = {
  run: null,
  starts: 0,
  finalizes: [],
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
    end: mock(async () => {
      runControl.ends += 1
      runControl.run = null
    }),
  }),
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

import { HomeTour } from './HomeTour'

// jsdom lacks ResizeObserver; Headless UI's combobox machine touches it when
// the option list closes after a selection.
const globalWithResizeObserver = globalThis as unknown as { ResizeObserver?: unknown }
globalWithResizeObserver.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type TimerPanelControl = {
  mockTimerPanelMounts?: number
  fireTimerComplete?: (results: Sessions) => void
}
const timerPanelControl = () => globalThis as unknown as TimerPanelControl

// ── Test data ───────────────────────────────────────────────────────────────

const BARE_WELCOME = '```time\n0:03 Count Down\n10 Pushups\n```'

const wodFiles: Record<string, string> = {
  '../../markdown/canvas/home/welcome-1.md': BARE_WELCOME,
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
]

/** A block-level segment with only the fields the insights derivation reads. */
function segment(overrides: Partial<StoredOutputStatement>): StoredOutputStatement {
  return {
    outputType: 'segment',
    stackLevel: 1,
    line: 1,
    completionReason: 'user-advance',
    timeSpan: { started: 0, ended: 1000 },
    metrics: [{ type: 'rep', value: 10, origin: 'parser' }],
    ...overrides,
  } as StoredOutputStatement
}

/** The home example's shape: 3s countdown, 1.8s to Next, 42s of work, Next. */
const completedResults = (): Sessions =>
  ({
    startTime: 1000,
    endTime: 47800,
    duration: 46800,
    completed: true,
    logs: [
      segment({ line: 1, completionReason: 'timer-expired', timeSpan: { started: 1000, ended: 4000 }, metrics: [{ type: 'duration', value: 3000, origin: 'parser' }, { type: 'effort', value: 'Count Down', origin: 'parser' }] }),
      segment({ line: 2, timeSpan: { started: 4000, ended: 5800 }, metrics: [{ type: 'rep', value: 10, origin: 'parser' }, { type: 'effort', value: 'Pushups', origin: 'parser' }] }),
      segment({ line: 3, timeSpan: { started: 5800, ended: 47800 }, metrics: [{ type: 'rep', value: 10, origin: 'parser' }, { type: 'effort', value: 'Situps', origin: 'parser' }] }),
    ],
  }) as unknown as Sessions

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

async function heroRun() {
  const runButton = await within(screen.getByTestId('tour-hero')).findByRole('button', { name: 'Run' })
  await act(async () => {
    fireEvent.click(runButton)
    await Promise.resolve()
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('HomeTour', () => {
  let recorded: Array<{ name: string; payload?: Record<string, unknown> }> = []
  let unsubscribe: () => void = () => {}

  beforeEach(() => {
    recorded = []
    runControl.run = null
    runControl.starts = 0
    runControl.finalizes = []
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

  it('shows the run-to-view CTA before any run and the boards section beside it', async () => {
    await renderHomeTour()
    const insights = screen.getByTestId('tour-section-insights')
    expect(within(insights).getByTestId('tour-insights-empty')).toBeTruthy()
    expect(within(insights).getByTestId('tour-insights-run').textContent).toContain('Run to view the results')
    // The two sample boards render over example data — no run required.
    const boards = screen.getByTestId('tour-section-boards')
    await within(boards).findAllByTestId('tour-session-dashboard')
    expect(within(boards).getAllByTestId('tour-session-dashboard')).toHaveLength(2)
  })

  it('the CTA button starts the fullscreen run', async () => {
    await renderHomeTour()
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('tour-section-insights')).getByTestId('tour-insights-run'))
      await Promise.resolve()
    })
    expect(runControl.starts).toBe(1)
    expect(runControl.run?.noteId).toBe('note-1')
    expect(screen.getByTestId('mock-timer-panel')).toBeTruthy()
  })

  it('hero Run persists a fresh note and runs in place — no scrolling', async () => {
    await renderHomeTour()
    await heroRun()

    // Fresh identity minted in place — save-first contract.
    expect(runControl.starts).toBe(1)
    expect(runControl.run?.noteId).toBe('note-1')
    // The timer opens fullscreen; the editor stays in the hero viewport.
    expect(screen.getByTestId('mock-timer-panel')).toBeTruthy()
    expect(within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor')).toBeTruthy()
    expect(screen.getAllByTestId('mock-timer-panel')).toHaveLength(1)
  })

  it('every explicit Run after a recorded run mints a NEW note', async () => {
    await renderHomeTour()
    const hero = () => screen.getByTestId('tour-hero')
    await heroRun()
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
    // identity (second note), not a reuse. The dismiss slides back before
    // swapping, so the editor returns asynchronously.
    await act(async () => {
      fireEvent.click(within(hero()).getByTestId('tour-session-result-dismiss'))
    })
    await waitFor(() => expect(within(hero()).getByRole('button', { name: 'Run' })).toBeTruthy())
    await act(async () => {
      fireEvent.click(within(hero()).getByRole('button', { name: 'Run' }))
      await Promise.resolve()
    })
    expect(runControl.starts).toBe(2)
    expect(runControl.run?.noteId).toBe('note-2')
  })

  it('feeds the insights section after a recorded run — ratio, reaction, timeline', async () => {
    await renderHomeTour()
    await heroRun()
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })

    const insights = screen.getByTestId('tour-section-insights')
    expect(within(insights).getByTestId('tour-insights-timeline')).toBeTruthy()
    // 3s countdown vs 43.8s to Next → 1 : 14.6
    expect(within(insights).getByTestId('tour-insights-ratio')!.textContent).toContain('1 : 14.6')
    // avg (1.8s + 42s) / 2 over 2 clicks.
    expect(within(insights).getByTestId('tour-insights-reaction')!.textContent).toContain('21.9s')
    expect(within(insights).getByTestId('tour-insights-reaction')!.textContent).toContain('2 clicks')
  })

  it('keeps the insights data when the hero resets back to the arrival document', async () => {
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
      await renderHomeTour()
      await heroRun()
      await act(async () => {
        timerPanelControl().fireTimerComplete?.(completedResults())
        await Promise.resolve()
      })
      expect(screen.getByTestId('tour-section-insights').textContent).toContain('1 : 14.6')

      // Dismiss the hero result ("Edit again") — the recorded session
      // survives the identity clear. Then leave the hero and come back:
      // the editor resets to arrival content, and the insights keep their
      // data.
      await act(async () => {
        fireEvent.click(within(screen.getByTestId('tour-hero')).getByTestId('tour-session-result-dismiss'))
      })
      await waitFor(() => expect(within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor')).toBeTruthy())
      const heroSentinel = observers.find(
        (o) => o.el.parentElement?.getAttribute('data-testid') === 'home-tour' && o.el.getAttribute('aria-hidden') === 'true',
      )
      expect(heroSentinel).toBeTruthy()
      await act(async () => {
        heroSentinel!.fire(true)
        heroSentinel!.fire(false)
        heroSentinel!.fire(true)
        await Promise.resolve()
      })
      await waitFor(() => expect(within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor')).toBeTruthy())
      expect(within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor')!.textContent).toBe(BARE_WELCOME)
      expect(screen.getByTestId('tour-section-insights').textContent).toContain('1 : 14.6')
    } finally {
      delete scope.IntersectionObserver
    }
  })

  it('records completion against the run identity exactly once', async () => {
    await renderHomeTour()
    await heroRun()
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
    await heroRun()

    // No identity and the failure is visible.
    expect(runControl.starts).toBe(0)
    expect(runControl.run).toBeNull()
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
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
    // The dismiss slides back before swapping; the editor returns async.
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('tour-hero')).getByTestId('tour-session-result-dismiss'))
    })
    await waitFor(() => expect(within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor')).toBeTruthy())
    expect((within(screen.getByTestId('tour-hero')).getByTestId('mock-note-editor') as HTMLTextAreaElement).value).toBe('EDIT ACROSS WIDTHS')
  })

})
