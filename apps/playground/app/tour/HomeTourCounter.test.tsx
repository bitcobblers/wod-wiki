/**
 * HomeTourCounter.test.tsx — focused integration test for the header stage
 * counter derivation on the home page.
 *
 * The home header chip shows completed / total home quests. At fresh load
 * only the arrival quest is counted. The timer quest completes when a run
 * actually starts (run-started validation), and the analytics quest when
 * the session-insights section scrolls into view.
 *
 * The CodeMirror editor, the fullscreen overlay, and the run lifecycle are
 * injected through HomeTour's test seams (`editorSlot`, `timerSlot`,
 * `deps`) instead of module mocks. useRunStartedChallenge and
 * useTourScrollQuests stay REAL — they are the units whose quest-marking
 * this suite verifies.
 */

import { useEffect, type ReactElement } from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'bun:test'
import { render, screen, within, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest } from '../canvas/parseCanvasMarkdown'
import type { ScriptBlock } from '@/components/Editor/types'
import type { UsePlaygroundRunReturn } from '../hooks/usePlaygroundRun'
import { useCompletionChallenge } from '../hooks/useCompletionChallenge'
import { HomeTour } from './HomeTour'

const STORAGE_KEY = 'wodwiki.quests.v1'

// ── Seams ───────────────────────────────────────────────────────────────────

function MockNoteEditor(props: {
  value: string
  onChange?: (value: string) => void
  onBlocksChange?: (blocks: ScriptBlock[]) => void
  onStartWorkout?: (block: ScriptBlock) => void
}): ReactElement {
  useEffect(() => {
    props.onBlocksChange?.([{ id: 'block-1', type: 'Timer' } as unknown as ScriptBlock])
  }, [])
  return (
    <div>
      <textarea
        data-testid="note-editor"
        value={props.value}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      {props.onStartWorkout && (
        <button onClick={() => props.onStartWorkout?.({ id: 'block-1' } as unknown as ScriptBlock)}>Run</button>
      )}
    </div>
  )
}

function TimerStub(): ReactElement {
  return <div data-testid="mock-timer-panel" />
}

/** Fixed run identity — the run-started quest marking, not persistence, is under test. */
function useFakePlaygroundRun(): UsePlaygroundRunReturn {
  const run = { noteId: 'note-1', resultId: 'res-1', block: { id: 'block-1' } as unknown as ScriptBlock }
  return {
    run,
    recorded: false,
    pendingResults: null,
    start: async () => run,
    finalize: async () => {},
    reset: async () => {},
    end: async () => {},
  }
}

/** Real hook would fight the fixed run identity; the counter only reads quest marks. */
const completionChallengeStub: typeof useCompletionChallenge = () => ({ questIds: [] })

const homeTourDeps = {
  usePlaygroundRun: useFakePlaygroundRun,
  useCompletionChallenge: completionChallengeStub,
}

// ── Test data ───────────────────────────────────────────────────────────────

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
          editorSlot={MockNoteEditor}
          timerSlot={TimerStub}
          deps={homeTourDeps}
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

    // Run from the live-preview editor — the run-started validation completes
    // qs-tour-timer; scrolling alone never fakes a run.
    const runButton = await within(screen.getByTestId('tour-section-editor')).findByRole('button', { name: 'Run' })
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
