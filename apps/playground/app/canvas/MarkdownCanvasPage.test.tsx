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
import { buildSyntaxGuideReference } from '@/content/syntaxGuideReference'
import { AppRoutes } from '../AppRoutes'
import { EditorWindow } from '../components/organisms/editor/EditorWindow'
import { RunwayShell } from './RunwayShell'

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
      data-readonly={String(Boolean(props.readonly))}
      data-hide-default-commands={String(Boolean(props.hideDefaultCommands))}
      data-commands-count={String(props.commands?.length ?? 0)}
      readOnly={props.readonly}
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

function StubMacOSChrome({ title, headerActions, children }: { title: string; headerActions?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="chrome">
      <div data-testid="chrome-title">{title}</div>
      {headerActions}
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
      screen.getByRole('radio', { name: 'With weight' }).click()
    })

    await waitFor(() => {
      expect(getRenderedEditors().every((editor) => editor.getAttribute('data-editor-source') === '5 deadlift 225lb')).toBe(true)
    })
  })

  it('keeps /page/guide-* editors editable (readonly=false) while keeping non-guide /page/:slug read-only', async () => {
    class IntersectingObserver {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      disconnect() {}
      unobserve() {}
    }
    ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = IntersectingObserver

    const guidePage: ParsedCanvasPage = {
      frontmatter: { type: 'guide', title: 'First Workout' },
      template: 'canvas',
      type: 'guide',
      route: '/page/guide-start',
      quests: [],
      chapters: [],
      sections: [
        {
          id: 'hero',
          heading: 'First Workout',
          level: 1,
          attrs: [],
          prose: 'Edit the live example as you read.',
          proseChunks: [{ kind: 'prose', text: 'Edit the live example as you read.' }],
          view: {
            name: 'preview',
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
          id: 'fences',
          heading: 'Fences',
          level: 2,
          attrs: [],
          prose: 'A workout lives inside a fenced block.',
          proseChunks: [{ kind: 'prose', text: 'A workout lives inside a fenced block.' }],
          commands: [],
          buttons: [],
        },
      ],
    }

    host = await renderWithPlaygroundHost(
      <MarkdownCanvasPage
        page={guidePage}
        wodFiles={{ '../../markdown/home-source.md': '```time\n10 Pushups\n```' }}
        theme="light"
      />,
      { route: '/page/guide-start' },
    )

    await waitFor(() => expect(getRenderedEditors().length).toBeGreaterThan(0))
    expect(getRenderedEditors().every((editor) => editor.getAttribute('data-readonly') === 'false')).toBe(true)

    cleanup()
    await host.cleanup()
    host = null

    const staticPage: ParsedCanvasPage = {
      ...guidePage,
      frontmatter: { title: 'Static Page' },
      type: undefined,
      route: '/page/static-reference',
    }

    host = await renderWithPlaygroundHost(
      <MarkdownCanvasPage
        page={staticPage}
        wodFiles={{ '../../markdown/home-source.md': '```time\n10 Pushups\n```' }}
        theme="light"
      />,
      { route: '/page/static-reference' },
    )

    await waitFor(() => expect(getRenderedEditors().length).toBeGreaterThan(0))
    expect(getRenderedEditors().every((editor) => editor.getAttribute('data-readonly') === 'true')).toBe(true)
  })

  it('redirects legacy /guide/:slug routes to /page/guide-:slug preserving search and hash, and emits /page/guide-* docsPath', async () => {
    host = await renderWithPlaygroundHost(
      <AppRoutes pageSettlingFallback={<div data-testid="settled-page" />} />,
      { route: '/guide/start?h=first-workout#section-1' },
    )

    await waitFor(() => expect(screen.getByTestId('settled-page')).toBeDefined())
    expect(host.getLocation().pathname).toBe('/page/guide-start')
    expect(host.getLocation().search).toBe('?h=first-workout')
    expect(host.getLocation().hash).toBe('#section-1')

    const refs = buildSyntaxGuideReference({
      'markdown/canvas/syntax/core-rules.md': '---\ntitle: "Core Rules"\nsubtitle: "Basics"\n---\n```time\n10 Pushups\n```\n',
      'markdown/canvas/syntax/classic-amrap.md': '---\ntitle: "AMRAP"\nsubtitle: "As many rounds"\n---\n```time\n20:00 AMRAP\n```\n',
    })
    expect(refs.coreRules?.docsPath).toBe('/page/guide-start?h=first-workout')
    expect(refs.classicAmrap?.docsPath).toBe('/page/guide-protocols?h=amrap')
  })

  it('deduplicates competing Run commands when EditorWindow owns the title-bar Run CTA', () => {
    render(
      <EditorWindow
        title="start.md"
        doc="```time\n10 Pushups\n```"
        onDocChange={() => {}}
        commands={[{ id: 'run', label: 'Run', icon: null, onClick: () => {} }]}
        hideDefaultCommands={false}
        run={{ onRun: () => {} }}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Run' })).toHaveLength(1)
    const editor = screen.getByTestId('note-editor')
    expect(editor.getAttribute('data-hide-default-commands')).toBe('true')
    expect(editor.getAttribute('data-commands-count')).toBe('0')
  })

  it('measures [data-page-sticky-boundary] height for RunwayShell sticky offsets', () => {
    const boundary = document.createElement('header')
    boundary.setAttribute('data-page-sticky-boundary', 'true')
    boundary.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 390,
      bottom: 76,
      width: 390,
      height: 76,
      toJSON: () => ({}),
    })
    document.body.appendChild(boundary)

    render(
      <RunwayShell
        trackRef={{ current: null }}
        height="200vh"
        stages={[{ id: 'stage-1' }, { id: 'stage-2' }]}
        activeIndex={0}
        pane={<div>Pane</div>}
        captions={<div>Captions</div>}
        testId="measured-runway"
      />,
    )

    const shell = screen.getByTestId('measured-runway')
    const stickyWindow = shell.firstElementChild as HTMLElement
    expect(stickyWindow.style.top).toBe('76px')
    expect(stickyWindow.style.height).toBe('calc(100dvh - 76px)')
  })
})
