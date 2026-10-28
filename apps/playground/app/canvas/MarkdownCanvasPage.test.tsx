import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'

import type { NoteEditorProps } from '@/components/organisms/editor/NoteEditor'
import type { HistoryRecord } from '@/types/history'
import type {
  INotePersistence,
  NoteLocator,
  NoteMutation,
  NoteQuery,
} from '@/services/persistence'
import type { Session } from '@/types/storage'
import { parseDocumentSections, reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { Note } from '@/types/storage';

import type { PanelActions } from './MarkdownCanvasPage'
import type { ParsedCanvasPage } from './parseCanvasMarkdown'

const editorSnapshots: Array<{ noteId?: string; resultCount: number; source?: string }> = []
const storedResults: Session[] = []
const savedSessionCalls: Session[] = []
const editorFocusCalls: string[] = []

const playgroundNoteId = '01990e80-0000-7000-8000-000000000001'
let snapshotSource = '';
let startedSession: Session | null = null;

mock.module('../services/createPlaygroundPage', () => ({
  ensurePlaygroundEntry: async () => ({ noteId: playgroundNoteId, routeId: 'playground/canvas-home' }),
  // The run lifecycle captures a persisted note before opening its timer.
  playgroundIntake: {
    snapshotEntry: async (source: string) => { snapshotSource = source; return { noteId: playgroundNoteId, routeId: 'playground/canvas-home' }; },
  },
}))
const sampleSessions = {
  completed: true,
  startTime: 1_700_000_000_000,
  endTime: 1_700_000_030_000,
  duration: 30_000,
  logs: [{ id: 'log-1' }],
}

mock.module('react-router-dom', () => ({
  BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  MemoryRouter: ({ children }: { children: React.ReactNode }) => children,
  Routes: ({ children }: { children: React.ReactNode }) => children,
  Route: () => null,
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
  NavLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
  Navigate: () => null,
  Outlet: () => null,
  useNavigate: () => () => {},
  useParams: () => ({}),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'test' }),
  useSearchParams: () => [new URLSearchParams(), () => {}],
  useMatch: () => null,
  useResolvedPath: () => ({ pathname: '/' }),
  generatePath: (path: string) => path,
}))

mock.module('nuqs', () => ({
  useQueryState: () => [null, () => {}],
  parseAsStringEnum: () => ({ withDefault: () => 'all' }),
}))

// The canvas page pulls in the workbench runtime via `@/panels/page-shells`
// (useStickyBoundaryOffset), whose providers call createNotePersistence —
// the mock must export it or ESM linking against the mock fails.
const fakeNotePersistence: INotePersistence = {
  async createNote() {
    return fakeEntry('created')
  },
  async getNote(locator: NoteLocator) {
    return fakeEntry(typeof locator === 'string' ? locator : locator.id)
  },
  async listNotes(query: NoteQuery = {}) {
    const ids = query.ids ?? []
    if (ids.length === 0) return []
    return ids.map(id => ({
      ...fakeEntry(id),
      extendedResults: storedResults.filter(r => r.noteId === id),
    }))
  },
  async saveNote(input) { snapshotSource = input.rawContent; return fakeEntry(input.noteId); },
  async startSession(input, session) {
    const block = input.blocks[session.blockId];
    if (!block) throw new Error('Selected occurrence missing');
    startedSession = { ...session, blockVersion: 1 };
    const entry = fakeEntry(input.noteId);
    const note: Note = { id: entry.id, title: entry.title, createdAt: 0, rawContent: input.rawContent, blocks: input.blocks, sourceRevision: 1 };
    return { note, session: startedSession, revision: { noteId: note.id, blockId: block.id, version: 1, kind: block.kind, dialect: block.dialect, sport: block.sport, rawContent: input.rawContent.slice(block.from, block.to), savedAt: 0 } };
  },
  async finishSession(resultId, data) {
    if (!startedSession || startedSession.id !== resultId) throw new Error('Pinned Session missing');
    const saved = { ...startedSession, ...data };
    savedSessionCalls.push(saved);
    storedResults.unshift(saved);
    return saved;
  },
  async getBlockRevision() { return undefined; },
  async getBlockHistory() { return []; },
  async getNoteBlockHistory() { return []; },
  async mutateNote(locator: NoteLocator, _mutation: NoteMutation) { return fakeEntry(typeof locator === 'string' ? locator : locator.id ?? ''); },
  async deleteNote() {},
}

function fakeEntry(id: string): HistoryRecord {
  return {
    id,
    title: id,
    createdAt: 0,
    updatedAt: 0,
    targetDate: 0,
    rawContent: snapshotSource,
    blocks: reconcileNoteBlocks(snapshotSource, { sourceRevision: 1, createId: () => 'block-1' }),
    sourceRevision: 1,
    tags: [],
    schemaVersion: 1,
  }
}

mock.module('@/services/persistence', () => ({
  createNotePersistence: () => fakeNotePersistence,
  notePersistence: fakeNotePersistence,
  IndexedDBNotePersistence: class IndexedDBNotePersistence {},
}))

mock.module('@/components/organisms/editor/NoteEditor', () => ({
  NoteEditor: (props: NoteEditorProps) => {
    useEffect(() => {
      props.onViewCreated?.({
        focus: () => editorFocusCalls.push(props.value),
      } as any)
      props.onBlocksChange?.(parseDocumentSections(props.value).flatMap(section => section.scriptBlock ? [{ ...section.scriptBlock, id: 'block-1' }] : []))
    }, [props])

    editorSnapshots.push({
      noteId: props.noteId,
      resultCount: 0,
      source: typeof props.value === 'string' ? props.value : undefined,
    })

    return (
      <textarea
        data-testid="note-editor"
        data-note-id={props.noteId}
        data-result-count="0"
        data-editor-source={typeof props.value === 'string' ? props.value : ''}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    )
  },
}))

mock.module('@/components/organisms/editor/RuntimeTimerPanel', () => ({
  RuntimeTimerPanel: (props: { onComplete?: (blockId: string, results: typeof sampleSessions) => void }) => (
    <button data-testid="complete-fullscreen" onClick={() => props.onComplete?.('block-1', sampleSessions)}>
      Complete fullscreen
    </button>
  ),
}))

mock.module('@/components/organisms/review/ReviewGrid', () => ({
  ReviewGrid: () => <div data-testid="review-grid" />,
}))
mock.module('@/services/AnalyticsTransformer', () => ({
  getAnalyticsFromRuntime: () => ({
    segments: [{ id: 1, label: 'segment-1' }],
    groups: [],
  }),
  getAnalyticsFromLogs: () => ({
    segments: [{ id: 1, label: 'segment-1' }],
    groups: [],
  }),
}))

mock.module('../components/atoms/MacOSChrome', () => ({
  MacOSChrome: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="chrome">
      <div data-testid="chrome-title">{title}</div>
      {children}
    </div>
  ),
}))

mock.module('./CanvasProse', () => ({
  CanvasProse: ({ prose }: { prose: string }) => <div>{prose}</div>,
}))

mock.module('../views/queriable-list/CollectionWorkoutsList', () => ({
  CollectionWorkoutsList: () => null,
}))

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

const markdownCanvasPageModule = import('./MarkdownCanvasPage')

function getRenderedEditors() {
  return screen.getAllByTestId('note-editor')
}

function getRenderedRuntimeButtons() {
  return screen.getAllByTestId('complete-fullscreen')
}

function getEditorValue() {
  return (getRenderedEditors()[0] as HTMLTextAreaElement).value
}

describe('MarkdownCanvasPage result persistence', () => {
  beforeEach(() => {
    class MockIntersectionObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    ;(globalThis as any).IntersectionObserver = MockIntersectionObserver
    ;(window as any).matchMedia = () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false },
    })
    editorSnapshots.length = 0
    storedResults.length = 0
    savedSessionCalls.length = 0
    editorFocusCalls.length = 0
    snapshotSource = '';
    startedSession = null;
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
  })

  it('persists the first inline canvas completion', async () => {
    const { MarkdownCanvasPage } = await markdownCanvasPageModule
    let panelActions: PanelActions | null = null

    render(
      <MarkdownCanvasPage
        page={page}
        wodFiles={{ '../../markdown/home-source.md': '```time\n10 thrusters\n```' }}
        theme="light"
        onPanelActionsReady={(actions) => {
          panelActions = actions
        }}
      />,
    )

    await waitFor(() => expect(panelActions).toBeTruthy())

    act(() => {
      panelActions?.run()
    })

    await waitFor(() => expect(getRenderedRuntimeButtons()).toHaveLength(1))

    act(() => {
      getRenderedRuntimeButtons()[0].click()
    })

    await waitFor(() => expect(savedSessionCalls).toHaveLength(1))
    expect(savedSessionCalls[0]).toMatchObject({
      noteId: playgroundNoteId,
      blockId: 'block-1',
      blockVersion: 1,
      duration: sampleSessions.duration,
      completed: true,
    })

    act(() => {
      panelActions?.reset()
    })
  })

  it('mounts canvas page with initial source', async () => {
    const { MarkdownCanvasPage } = await markdownCanvasPageModule

    render(
      <MarkdownCanvasPage
        page={page}
        wodFiles={{ '../../markdown/home-source.md': '10 thrusters' }}
        theme="light"
      />,
    )

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
    const { MarkdownCanvasPage } = await markdownCanvasPageModule

    render(
      <MarkdownCanvasPage
        page={editablePage}
        wodFiles={{
          '../../markdown/home-source.md': 'initial source',
          '../../markdown/alt-source.md': 'alt source',
        }}
        theme="light"
      />,
    )

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
    const { MarkdownCanvasPage } = await markdownCanvasPageModule

    render(
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

    await waitFor(() => expect(screen.getAllByTestId('chrome-title')[0]?.textContent).toBe('Examples'))

    act(() => {
      screen.getByRole('button', { name: 'With weight' }).click()
    })

    await waitFor(() => {
      expect(getRenderedEditors().every((editor) => editor.getAttribute('data-editor-source') === '5 deadlift 225lb')).toBe(true)
    })
  })
})
