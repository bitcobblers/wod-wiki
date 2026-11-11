/**
 * HomeTour.arrival.test.tsx — ticket #882: arrival & editor-reset contract.
 *
 * Locked contract (wayfinder map #881, revised mid-walk):
 *  1. Arrival — `/load?z=<gzip>&by=<name>` persists the shared script to
 *     localStorage (see useZipProcessor.test.ts); on home the live-preview
 *     editor shows it instead of welcome-1.md.
 *  2. Attribution — while shared content is active the editor header reads
 *     `shared by: {by}` (fallback `anonymous`).
 *  3. Reset button — clears the stored script and restores welcome-1.md.
 *  4. Editor re-entry — always resets the editor to the initial load content
 *     (shared script while active, else welcome-1.md); the initial viewport
 *     entry is arrival, not a re-entry.
 *
 * The CodeMirror editor is injected through HomeTour's `editorSlot` seam —
 * a controlled textarea — instead of a module mock. Hooks and services run
 * real: the arrival flow never starts a run, so persistence is untouched.
 */

import { useEffect, type ReactElement } from 'react'
import { beforeEach, afterEach, describe, expect, it } from 'bun:test'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NuqsAdapter } from 'nuqs/adapters/react-router'
import type { Quest } from '../canvas/parseCanvasMarkdown'
import type { ScriptBlock } from '@/components/Editor/types'
import { HomeTour } from './HomeTour'

// ── Editor seam ─────────────────────────────────────────────────────────────

function MockNoteEditor(props: {
  value?: string
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
        data-testid="mock-note-editor"
        value={props.value ?? ''}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      {props.onStartWorkout && (
        <button onClick={() => props.onStartWorkout?.({ id: 'block-1' } as unknown as ScriptBlock)}>Run</button>
      )}
    </div>
  )
}

// ── IntersectionObserver stub — the test drives hero visibility ─────────────

type IOCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void
let ioCallbacks: Array<{ callback: IOCallback; target: Element }> = []

async function simulateEditorVisibility(visible: boolean) {
  await act(async () => {
    for (const { callback, target } of ioCallbacks) {
      if (target.getAttribute('data-testid') === 'tour-section-editor') {
        callback([{ isIntersecting: visible, target }])
      }
    }
  })
}

// ── Test data ───────────────────────────────────────────────────────────────

const WELCOME = 'AMRAP 10\n  10 Pull-ups\n  15 Push-ups\n  20 Air Squats\n'
const SHARED = '5 Rounds\n  10 Burpees\n  200m Run\n'
const SHARED_KEY = 'wodwiki.homeShared.v1'

// Production wodFiles keys are Vite-glob paths; resolveSource maps
// 'wods/examples/home/welcome-1.md' onto this key.
const wodFiles: Record<string, string> = {
  '../../markdown/canvas/home/welcome-1.md': WELCOME,
}

const homeQuests: Quest[] = []

function editorInput(): HTMLTextAreaElement {
  return screen.getAllByTestId('mock-note-editor')[0] as HTMLTextAreaElement
}

function seedShared(script: { content: string; by?: string }) {
  window.localStorage.setItem(SHARED_KEY, JSON.stringify(script))
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('HomeTour arrival & hero-reset contract', () => {
  beforeEach(() => {
    ioCallbacks = []
    window.localStorage.clear()

    class MockIntersectionObserver {
      constructor(private callback: IOCallback) {}
      observe(target: Element) {
        ioCallbacks.push({ callback: this.callback, target })
      }
      unobserve(target: Element) {
        ioCallbacks = ioCallbacks.filter((entry) => entry.callback !== this.callback || entry.target !== target)
      }
      disconnect() {
        ioCallbacks = ioCallbacks.filter((entry) => entry.callback !== this.callback)
      }
    }
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    })

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
    cleanup()
    window.localStorage.clear()
  })

  async function renderHomeTour(initialEntry = '/') {
    const result = render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <NuqsAdapter>
          <HomeTour
            wodFiles={wodFiles}
            theme="light"
            quests={homeQuests}
            editorSlot={MockNoteEditor}
          />
        </NuqsAdapter>
      </MemoryRouter>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    return result
  }

  it('loads welcome-1.md into the hero editor when no shared script is stored', async () => {
    await renderHomeTour()
    expect(editorInput().value).toBe(WELCOME)
    expect(screen.queryByText('Home / Notes / welcome-1.md')).toBeNull()
  })

  it('shows the stored shared script with a "shared by" attribution', async () => {
    seedShared({ content: SHARED, by: 'serge' })
    await renderHomeTour()
    expect(editorInput().value).toBe(SHARED)
    expect(screen.getAllByText(/shared by: serge/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Home / Notes / welcome-1.md')).toBeNull()
  })

  it('falls back to "anonymous" when the shared script has no author', async () => {
    seedShared({ content: SHARED })
    await renderHomeTour()
    expect(editorInput().value).toBe(SHARED)
    expect(screen.getAllByText(/shared by: anonymous/).length).toBeGreaterThan(0)
  })

  it('restores welcome-1.md and clears the stored script when Reset is clicked', async () => {
    seedShared({ content: SHARED, by: 'serge' })
    await renderHomeTour()
    expect(editorInput().value).toBe(SHARED)

    const resetButton = screen.getAllByTitle('Reset')[0]
    fireEvent.click(resetButton)

    expect(editorInput().value).toBe(WELCOME)
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull()
    expect(screen.queryByText(/shared by/)).toBeNull()
  })

  it('resets the editor to the initial content when the editor section re-enters the viewport', async () => {
    await renderHomeTour()

    fireEvent.change(editorInput(), { target: { value: 'MY EDITS' } })
    expect(editorInput().value).toBe('MY EDITS')

    // Leaving the viewport alone does not reset.
    await simulateEditorVisibility(false)
    expect(editorInput().value).toBe('MY EDITS')

    // Re-entry resets, discarding the in-progress edits.
    await simulateEditorVisibility(true)
    expect(editorInput().value).toBe(WELCOME)
  })

  it('does not reset on the initial viewport entry', async () => {
    await renderHomeTour()

    fireEvent.change(editorInput(), { target: { value: 'MY EDITS' } })
    expect(editorInput().value).toBe('MY EDITS')

    // The first observed entry is the arrival itself — not a re-entry.
    await simulateEditorVisibility(true)
    expect(editorInput().value).toBe('MY EDITS')
  })

  it('resets to the shared script (not welcome-1.md) on editor re-entry while shared', async () => {
    seedShared({ content: SHARED, by: 'serge' })
    await renderHomeTour()
    expect(editorInput().value).toBe(SHARED)

    fireEvent.change(editorInput(), { target: { value: 'MY EDITS' } })
    await simulateEditorVisibility(false)
    await simulateEditorVisibility(true)
    expect(editorInput().value).toBe(SHARED)
  })
})
