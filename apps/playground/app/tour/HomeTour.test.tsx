/**
 * HomeTour.test.tsx — route-level component test for the home page.
 *
 * Asserts the new flow: editor Run → fullscreen run (its review panel owns
 * the raw results) → closing it glides to the dashboards section, whose
 * Session Insights scope (Impatience Score + Reaction Time) renders the
 * recorded run; the run-to-view CTA before any run; the boards carousel
 * tabs; the pane-header back-to-editor reset; the jump section exits; and
 * the note lifecycle contracts (fresh identity per Run, record-once
 * finalize, failed-start toast).
 */

import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest } from '../canvas/parseCanvasMarkdown'
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
    onClose?: () => void
    externalStop?: boolean
  }) => {
    const control = globalThis as unknown as {
      mockTimerPanelMounts?: number
      fireTimerComplete?: (results: Sessions) => void
      fireTimerClose?: () => void
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
    control.fireTimerClose = () => props.onClose?.()
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
import * as feedSyncModule from '@/services/feed/feedSync'
mock.module('@/services/feed/feedSync', () => ({
  ...feedSyncModule,
  readFeedCoverage: async () => ({ coreImported: true, libraryImported: true }),
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
import { HomeView } from '../views/HomeView'

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
  fireTimerClose?: () => void
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
        />
      </NuqsAdapter>
    </MemoryRouter>,
  )
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

async function editorRun() {
  const runButton = await within(screen.getByTestId('tour-section-editor')).findByRole('button', { name: 'Run' })
  await act(async () => {
    fireEvent.click(runButton)
    await Promise.resolve()
  })
}

async function renderHomeViewWithoutCorpus() {
  const result = render(
    <MemoryRouter>
      <NuqsAdapter>
        <HomeView wodFiles={{}} theme="light" />
      </NuqsAdapter>
    </MemoryRouter>,
  )
  await act(async () => {
    await Promise.resolve()
  })
  return result
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

  // The parallax section mounts its scopes twice (desktop sticky pane +
  // mobile steps); scope queries to the sticky pane or the active scope
  // to stay unique.
  const stickyPane = () => within(screen.getByTestId('tour-sticky-pane'))
  const activeScope = () =>
    within(screen.getByTestId('tour-section-insights').querySelector('[data-scope-active="true"]') as HTMLElement)

  it('renders the baked arrival document when no seeded files exist', async () => {
    await renderHomeViewWithoutCorpus()
    expect(screen.queryByText(/Home canvas content not found/)).toBeNull()
    expect(screen.getByTestId('mock-note-editor')).toHaveProperty(
      'value',
      expect.stringContaining('0:03 Count Down'),
    )
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

  it('shows the run-to-view CTA before any run and the boards carousel beside it', async () => {
    await renderHomeTour()
    const active = activeScope()
    expect(active.getByTestId('tour-insights-empty')).toBeTruthy()
    expect(active.getByTestId('tour-insights-run').textContent).toContain('Run to view the results')
    // The boards scope renders the seeded dashboards behind their tabs.
    const sticky = stickyPane()
    expect(sticky.getByTestId('dashboard-slide-tab-road-to-560-total')).toBeTruthy()
    await act(async () => {
      fireEvent.click(sticky.getByTestId('dashboard-slide-tab-polarized-base-marathon'))
      await Promise.resolve()
    })
    await sticky.findAllByTestId('tour-session-dashboard')
    expect(sticky.getAllByTestId('tour-session-dashboard')).toHaveLength(1)
  })

  it('the CTA button starts the fullscreen run', async () => {
    await renderHomeTour()
    await act(async () => {
      fireEvent.click(activeScope().getByTestId('tour-insights-run'))
      await Promise.resolve()
    })
    expect(runControl.starts).toBe(1)
    expect(runControl.run?.noteId).toBe('note-1')
    expect(screen.getByTestId('mock-timer-panel')).toBeTruthy()
  })

  it('editor Run persists a fresh note and runs fullscreen — the editor stays an editor', async () => {
    await renderHomeTour()
    await editorRun()

    // Fresh identity minted in place — save-first contract.
    expect(runControl.starts).toBe(1)
    expect(runControl.run?.noteId).toBe('note-1')
    // The timer opens fullscreen; the editor viewport keeps the editor.
    expect(screen.getByTestId('mock-timer-panel')).toBeTruthy()
    expect(within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor')).toBeTruthy()
    expect(screen.getAllByTestId('mock-timer-panel')).toHaveLength(1)
  })

  it('every explicit Run after a recorded run mints a NEW note', async () => {
    await renderHomeTour()
    const editor = () => screen.getByTestId('tour-section-editor')
    await editorRun()
    expect(runControl.starts).toBe(1)

    // The first run completes and is recorded — the insights section
    // settles on the Session Insights pane…
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })
    expect(runControl.finalizes).toHaveLength(1)
    expect(stickyPane().getByTestId('tour-insights')).toBeTruthy()
    // …while the editor viewport keeps the editor.
    expect(within(editor()).getByTestId('mock-note-editor')).toBeTruthy()

    // …and the next Run from the editor mints a fresh identity (second
    // note), not a reuse.
    await act(async () => {
      fireEvent.click(within(editor()).getByRole('button', { name: 'Run' }))
      await Promise.resolve()
    })
    expect(runControl.starts).toBe(2)
    expect(runControl.run?.noteId).toBe('note-2')
  })

  it('feeds the analytics scope after a recorded run — impatience, reaction, timeline', async () => {
    await renderHomeTour()
    await editorRun()
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })

    // The sticky pane holds the session analytics.
    const sticky = stickyPane()
    expect(sticky.getByTestId('tour-insights')).toBeTruthy()

    // The session analytics render in the analytics scope.
    expect(sticky.getByTestId('tour-insights-timeline')).toBeTruthy()
    // The 3s countdown expired naturally — nothing clicked early.
    expect(sticky.getByTestId('tour-insights-impatience')!.textContent).toContain('0.0s')
    // avg (1.8s + 42s) / 2 over 2 clicks.
    expect(sticky.getByTestId('tour-insights-reaction')!.textContent).toContain('21.9s')
    expect(sticky.getByTestId('tour-insights-reaction')!.textContent).toContain('2 clicks')
  })

  it('keeps the insights data when the editor resets back to the arrival document', async () => {
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
    const previousIO = scope.IntersectionObserver
    scope.IntersectionObserver = MockIO
    try {
      await renderHomeTour()
      await editorRun()
      await act(async () => {
        timerPanelControl().fireTimerComplete?.(completedResults())
        await Promise.resolve()
      })
      expect(screen.getByTestId('tour-section-insights').querySelector('[data-testid="tour-insights-timeline"]')).toBeTruthy()

      // Leave the editor section and come back: the editor resets to the
      // arrival content, and the recorded session survives in the
      // insights section.
      const editorObserver = observers.find(
        (o) => o.el.getAttribute('data-testid') === 'tour-section-editor',
      )
      expect(editorObserver).toBeTruthy()
      await act(async () => {
        editorObserver!.fire(true)
        editorObserver!.fire(false)
        editorObserver!.fire(true)
        await Promise.resolve()
      })
      await waitFor(() => expect(within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor')).toBeTruthy())
      expect(within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor')!.textContent).toBe(BARE_WELCOME)
      expect(screen.getByTestId('tour-section-insights').querySelector('[data-testid="tour-insights-timeline"]')).toBeTruthy()
    } finally {
      scope.IntersectionObserver = previousIO
    }
  })

  it('closing a run with the pitch open collapses it before gliding to the dashboards', async () => {
    const scrollCalls: Array<{ top: number }> = []
    const windowWithScroll = window as unknown as { scrollTo: (o: { top: number }) => void }
    const previousScrollTo = windowWithScroll.scrollTo
    windowWithScroll.scrollTo = (options) => {
      scrollCalls.push({ top: options.top })
    }
    try {
      await renderHomeTour()
      await editorRun()
      await act(async () => {
        timerPanelControl().fireTimerComplete?.(completedResults())
        await Promise.resolve()
      })
      // The recorded review panel stays open; closing it is what hands the
      // hero back — the pitch collapses with the close (before the glide
      // starts, so the target never shifts), then the glide parks the dashboards.
      await act(async () => {
        timerPanelControl().fireTimerClose?.()
        await Promise.resolve()
      })
      expect(screen.getByTestId('tour-why-video').closest('#tour-why-video-wrap')?.className).toContain('invisible')
      expect(screen.getByTestId('tour-why-watch-again')).toBeTruthy()
      await act(async () => {
        const settled = Promise.withResolvers<void>()
        setTimeout(settled.resolve, 400)
        await settled.promise
      })
      expect(scrollCalls.length).toBeGreaterThan(0)
    } finally {
      windowWithScroll.scrollTo = previousScrollTo
    }
  })

  it('collapses the pitch video after watching and hands the hero to the editor', async () => {
    await renderHomeTour()
    // Video open, no tab yet.
    expect(screen.getByTestId('tour-why-video')).toBeTruthy()
    expect(screen.queryByTestId('tour-why-watch-again')).toBeNull()

    // Watch: open the lightbox, close it — watched.
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-why-video'))
      await Promise.resolve()
    })
    fireEvent.click(screen.getByTestId('youtube-lightbox-close'))

    // The pitch collapses (visibility-hidden wrapper) and the Watch again
    // tab takes its place above the editor viewport.
    expect(screen.getByTestId('tour-why-video').closest('#tour-why-video-wrap')?.className).toContain('invisible')
    expect(screen.getByTestId('tour-why-watch-again')).toBeTruthy()
    expect(within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor')).toBeTruthy()

    // Watch again re-expands the pitch over the editor.
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-why-watch-again'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('tour-why-video').closest('#tour-why-video-wrap')?.className).not.toContain('invisible')
    expect(screen.queryByTestId('tour-why-watch-again')).toBeNull()
  })

  it('the skip button dismisses the pitch the same way watching it does', async () => {
    await renderHomeTour()
    // The pitch is up, no tab yet.
    expect(screen.getByTestId('tour-why-video')).toBeTruthy()
    expect(screen.queryByTestId('tour-why-watch-again')).toBeNull()

    // Skip: no lightbox, but the same collapse watching produces.
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-why-video-skip'))
      await Promise.resolve()
    })
    expect(screen.queryByTestId('youtube-lightbox')).toBeNull()
    expect(screen.getByTestId('tour-why-video').closest('#tour-why-video-wrap')?.className).toContain('invisible')
    expect(screen.getByTestId('tour-why-watch-again')).toBeTruthy()
    expect(within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor')).toBeTruthy()
  })

  it('the pane-header button slides back to the editor and resets the runtime', async () => {
    const scrollMock = mock(() => {})
    const windowWithScroll = window as unknown as { scrollTo: unknown }
    const previousScrollTo = windowWithScroll.scrollTo
    windowWithScroll.scrollTo = scrollMock
    try {
      await renderHomeTour()
      await editorRun()
      await act(async () => {
        timerPanelControl().fireTimerComplete?.(completedResults())
        await Promise.resolve()
      })

      // Dirty the editor so the reset has something to discard.
      await act(async () => {
        fireEvent.change(
          within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor') as HTMLTextAreaElement,
          { target: { value: 'DIRTY DOCUMENT' } },
        )
        await Promise.resolve()
      })

      await act(async () => {
        fireEvent.click(activeScope().getByTestId('tour-pane-back-to-editor'))
        await Promise.resolve()
      })

      // Runtime reset: the editor is back to the arrival document…
      await waitFor(() =>
        expect((within(screen.getByTestId('tour-section-editor')).getByTestId('mock-note-editor') as HTMLTextAreaElement).value).toBe(BARE_WELCOME),
      )
      // …and the page glides up to the editor viewport.
      expect(scrollMock).toHaveBeenCalled()
    } finally {
      windowWithScroll.scrollTo = previousScrollTo
    }
  })

  it('records completion against the run identity exactly once', async () => {
    await renderHomeTour()
    await editorRun()
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
    await editorRun()

    // No identity and the failure is visible.
    expect(runControl.starts).toBe(0)
    expect(runControl.run).toBeNull()
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('keeps the edited document and a fullscreen run alive across a desktop→phone viewport change', async () => {
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

    // Edit the shared document, then Run — the pane lives in the editor section.
    const editor = () => screen.getByTestId('tour-section-editor')
    const heroEditor = within(editor()).getByTestId('mock-note-editor') as HTMLTextAreaElement
    await act(async () => {
      fireEvent.change(heroEditor, { target: { value: 'EDIT ACROSS WIDTHS' } })
      fireEvent.click(within(editor()).getByRole('button', { name: 'Run' }))
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

    // Completion lands the session in the insights section, and the edit
    // survives in the editor viewport.
    await act(async () => {
      timerPanelControl().fireTimerComplete?.(completedResults())
      await Promise.resolve()
    })
    expect(stickyPane().getByTestId('tour-insights')).toBeTruthy()
    expect((within(editor()).getByTestId('mock-note-editor') as HTMLTextAreaElement).value).toBe('EDIT ACROSS WIDTHS')
  })

})
