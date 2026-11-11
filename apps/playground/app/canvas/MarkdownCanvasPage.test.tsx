import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
// React 19 only flushes updates inside act() when the test environment opts
// in; the historical full-suite run got this from a sibling file's global.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core'

import * as NoteEditorModule from '@/components/organisms/editor/NoteEditor'
import type { NoteEditorProps } from '@/components/organisms/editor/NoteEditor'
import type { Sessions } from '@/components/Editor/types'
import * as RuntimeTimerPanelModule from '@/components/organisms/editor/RuntimeTimerPanel'
import * as MacOSChromeModule from '../components/atoms/MacOSChrome'
import * as CanvasProseModule from './CanvasProse'
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host'

import { MarkdownCanvasPage, type PanelActions } from './MarkdownCanvasPage'
import type { ParsedCanvasPage } from './parseCanvasMarkdown'

const sampleSessions = {
  completed: true,
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_030_000,
  duration: 30_000,
  logs: [{ id: 1, outputType: 'segment', metrics: [{ type: 'rep', value: 10, origin: 'runtime' }], sourceBlockKey: '1', stackLevel: 0 }],
  metrics: [],
} as unknown as Sessions

// Interactive stubs swapped over the real modules via namespace spies
// (restored in afterEach): these tests exercise the page's wiring and the
// real persistence plane, not CodeMirror itself. The editor stub keeps the
// last reported payload semantics the runtime flow relies on.
let editorFocusCalls: string[] = []

function StubNoteEditor(props: NoteEditorProps) {
  useEffect(() => {
    props.onViewCreated?.({
      focus: () => editorFocusCalls.push(props.value),
    } as never)
    props.onBlocksChange?.(parseDocumentSections(props.value).flatMap(section => section.scriptBlock ? [{ ...section.scriptBlock, id: 'block-1' }] : []))
  }, [props])

  return (
    <textarea
      data-testid="note-editor"
      data-note-id={props.noteId}
      data-editor-source={typeof props.value === 'string' ? props.value : ''}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

function StubRuntimeTimerPanel(props: { onComplete?: (blockId: string, results: Sessions) => void }) {
  return (
    <button data-testid="complete-fullscreen" onClick={() => props.onComplete?.('block-1', sampleSessions)}>
      Complete fullscreen
    </button>
  )
}

function StubMacOSChrome({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-testid="chrome">
      <div data-testid="chrome-title">{title}</div>
      {children}
    </div>
  )
}

function StubCanvasProse({ prose }: { prose: string }) {
  return <div>{prose}</div>
}

const page: ParsedCanvasPage = {
  frontmatter: {},
  template: 'canvas',
  route: '/',
  quests: [],
  chapters: [],
  sections: [
    {
      id: 'hero',
      heading: 'Hero',
      level: 1,
      attrs: [],
      prose: '',
      proseChunks: [],
      view: {
        name: 'home',
        state: 'note',
        source: 'home-source.md',
        align: 'right',
        width: '50%',
        buttons: [],
      },
      commands: [],
      buttons: [],
    },
    {
      id: 'step-1',
      heading: 'Step 1',
      level: 2,
      attrs: [],
      prose: 'Run a workout.',
      proseChunks: [],
      commands: [],
      buttons: [],
    },
  ],
}

const examplePage: ParsedCanvasPage = {
  frontmatter: {},
  template: 'canvas',
  route: '/',
  quests: [],
  chapters: [],
  sections: [
    {
      id: 'hero',
      heading: 'Hero',
      level: 1,
      attrs: [],
      prose: '',
      proseChunks: [],
      view: {
        name: 'examples',
        state: 'note',
        source: 'initial.md',
        align: 'right',
        width: '50%',
        buttons: [],
      },
      commands: [],
      buttons: [],
    },
    {
      id: 'examples',
      heading: 'Examples',
      level: 2,
      attrs: ['density:compact', 'theme:emerald'],
      prose: 'Try different source variants.',
      proseChunks: [],
      commands: [],
      buttons: [],
      examples: [
        { label: 'Reps only', source: 'example-1.md' },
        { label: 'With weight', source: 'example-2.md' },
      ],
    },
  ],
}

let host: PlaygroundRenderResult | null = null

function getRenderedEditors() {
  return screen.getAllByTestId('note-editor')
}

function getRenderedRuntimeButtons() {
  return screen.getAllByTestId('complete-fullscreen')
}

function getEditorValue() {
  return (getRenderedEditors()[0] as HTMLTextAreaElement).value
}

beforeEach(() => {
  class MockIntersectionObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver
  ;(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false },
  })
  Object.defineProperty(window, 'scrollY', {
    value: 0,
    writable: true,
    configurable: true,
  })
  editorFocusCalls = []

  spyOn(NoteEditorModule, 'NoteEditor').mockImplementation(StubNoteEditor)
  spyOn(RuntimeTimerPanelModule, 'RuntimeTimerPanel').mockImplementation(StubRuntimeTimerPanel)
  spyOn(MacOSChromeModule, 'MacOSChrome').mockImplementation(StubMacOSChrome)
  spyOn(CanvasProseModule, 'CanvasProse').mockImplementation(StubCanvasProse)
})

afterEach(async () => {
  cleanup()
  document.body.innerHTML = ''
  mock.restore()
  await host?.cleanup()
  host = null
})

describe('MarkdownCanvasPage result persistence', () => {
  it('persists the first inline canvas completion', async () => {
    let panelActions: PanelActions | null = null

    const mounted = await renderWithPlaygroundHost(
      <MarkdownCanvasPage
        page={page}
        wodFiles={{ '../../markdown/home-source.md': '```time\n10 thrusters\n```' }}
        theme="light"
        onPanelActionsReady={(actions) => {
          panelActions = actions
        }}
      />,
    )
    host = mounted

    await waitFor(() => expect(panelActions).toBeTruthy())

    act(() => {
      panelActions?.run()
    })

    await waitFor(() => expect(getRenderedRuntimeButtons()).toHaveLength(1))

    act(() => {
      getRenderedRuntimeButtons()[0].click()
    })

    // The real persistence plane recorded the completed session against the
    // intake snapshot note — duration and completed flag survive the write.
    await waitFor(async () => {
      const notes = await mounted.notePersistence.listNotes({ projection: 'history-detail' })
      expect(
        notes.some((note) =>
          note.extendedResults?.some((row) => row.completed === true && row.duration === sampleSessions.duration),
        ),
      ).toBe(true)
    })

    act(() => {
      panelActions?.reset()
    })
  })

  it('mounts canvas page with initial source', async () => {
    const mounted = await renderWithPlaygroundHost(
      <MarkdownCanvasPage
        page={page}
        wodFiles={{ '../../markdown/home-source.md': '10 thrusters' }}
        theme="light"
      />,
    )
    host = mounted

    await waitFor(() => expect(getRenderedEditors()).toHaveLength(2))
  })

  it('keeps edits per example and can reset the active example', async () => {
    const editablePage: ParsedCanvasPage = {
      ...page,
      sections: [
        page.sections[0],
        {
          ...page.sections[1],
          buttons: [
            {
              label: 'Load Alt',
              target: 'home',
              pipeline: [{ action: 'set-source', value: 'alt-source.md' }],
            },
            {
              label: 'Load Initial',
              target: 'home',
              pipeline: [{ action: 'set-source', value: 'home-source.md' }],
            },
          ],
        },
      ],
    }

    const mounted = await renderWithPlaygroundHost(
      <MarkdownCanvasPage
        page={editablePage}
        wodFiles={{
          '../../markdown/home-source.md': 'initial source',
          '../../markdown/alt-source.md': 'alt source',
        }}
        theme="light"
      />,
    )
    host = mounted

    await waitFor(() => expect(getRenderedEditors()).toHaveLength(2))
    expect(screen.getAllByText('Try editing this example ↓')).toHaveLength(2)

    fireEvent.change(getRenderedEditors()[0], { target: { value: 'edited initial' } })
    expect(screen.getAllByRole('button', { name: 'Reset to example' })).toHaveLength(2)

    act(() => {
      screen.getByRole('button', { name: 'Load Alt' }).click()
    })
    await waitFor(() => expect(getEditorValue()).toBe('alt source'))
    await waitFor(() => expect(editorFocusCalls.length).toBeGreaterThan(0))

    fireEvent.change(getRenderedEditors()[0], { target: { value: 'edited alt' } })

    act(() => {
      screen.getByRole('button', { name: 'Load Initial' }).click()
    })
    await waitFor(() => expect(getEditorValue()).toBe('edited initial'))

    act(() => {
      screen.getByRole('button', { name: 'Load Alt' }).click()
    })
    await waitFor(() => expect(getEditorValue()).toBe('edited alt'))

    act(() => {
      screen.getAllByRole('button', { name: 'Reset to example' })[0].click()
    })
    await waitFor(() => expect(getEditorValue()).toBe('alt source'))
  })

  it('shows the active section title and swaps inline examples without scrolling', async () => {
    const mounted = await renderWithPlaygroundHost(
      <MarkdownCanvasPage
        page={examplePage}
        wodFiles={{
          '../../markdown/initial.md': 'Initial source',
          '../../markdown/example-1.md': '10 pushups',
          '../../markdown/example-2.md': '5 deadlift 225lb',
        }}
        theme="light"
      />,
    )
    host = mounted

    await waitFor(() => expect(screen.getAllByTestId('chrome-title')[0]?.textContent).toBe('Examples'))

    act(() => {
      screen.getByRole('button', { name: 'With weight' }).click()
    })

    await waitFor(() => {
      expect(getRenderedEditors().every((editor) => editor.getAttribute('data-editor-source') === '5 deadlift 225lb')).toBe(true)
    })
  })
})
