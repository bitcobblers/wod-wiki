import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import {
  InMemoryStorage,
  resetStorageForTesting,
  setStorageForTesting,
  storageService,
} from '@/hooks/useBrowserServices';
import { getAppEffortRegistry } from '@/services/effortRegistry';

const zeroRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};
Object.defineProperty(window.Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [],
});
Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => zeroRect,
});

const originalMatchMedia = window.matchMedia;

function setMobileMatchMedia(isMobile: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('max-width') ? isMobile : !isMobile,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(async () => {
  setStorageForTesting(new InMemoryStorage());
  setMobileMatchMedia(true);
});

afterEach(() => {
  cleanup();
  resetStorageForTesting();
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  }
});

describe('MobileWheelComposer in NoteEditor', () => {
  it('mounts blurred on mobile without opening the wheel composer or native keyboard', () => {
    let view: EditorView | undefined;
    render(
      <NoteEditor
        value={'# Session\n\n```time\n10:00 15 Kettlebell Swing\n```'}
        onChange={() => {}}
        onViewCreated={(v) => {
          view = v;
        }}
      />,
    );

    expect(view).toBeDefined();
    expect(document.activeElement).not.toBe(view!.contentDOM);
    expect(screen.queryByTestId('mobile-wheel-composer')).toBeNull();
    expect(view!.contentDOM.getAttribute('inputmode')).toBe('none');
  });

  it('extracts metric slots + trailing + Add slot, steps horizontally, inserts a new metric, and switches to Type mode', async () => {
    const doc = '```time\n10:00 15 Kettlebell Swing\n```';
    let view: EditorView | undefined;
    render(
      <NoteEditor
        value={doc}
        onChange={() => {}}
        onViewCreated={(v) => {
          view = v;
        }}
      />,
    );
    if (!view) throw new Error('Editor did not mount');

    const lineStart = doc.indexOf('10:00');
    act(() => {
      view!.contentDOM.focus();
      fireEvent.focus(view!.contentDOM);
      view!.dispatch({ selection: { anchor: lineStart + 1 } });
    });

    const composer = await screen.findByTestId('mobile-wheel-composer');
    expect(composer).not.toBeNull();

    // Slots: [10:00] [15] [Kettlebell Swing] [+ Add]
    await waitFor(() => {
      expect(screen.getByTestId('mobile-wheel-slot-0').textContent).toBe('10:00');
    });
    expect(screen.getByTestId('mobile-wheel-slot-1').textContent).toBe('15');
    expect(screen.getByTestId('mobile-wheel-slot-2').textContent).toBe('Kettlebell Swing');
    expect(screen.getByTestId('mobile-wheel-slot-add').textContent).toBe('+ Add');

    // Step right onto [15] and verify CodeMirror selection syncs onto "15"
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-next-slot'));
    });
    const selAfterStep = view.state.selection.main;
    expect(view.state.doc.sliceString(selAfterStep.from, selAfterStep.to)).toBe('15');

    // Click "+ Add" slot -> select "Weight / Load" -> appends " 20kg" and shifts onto Load drum
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-slot-add'));
    });
    const addWeightOption = await screen.findByTestId('wheel-option-add-weight');
    act(() => {
      fireEvent.click(addWeightOption);
    });

    expect(view.state.doc.toString()).toContain('10:00 15 Kettlebell Swing 20kg');
    await waitFor(() => {
      expect(screen.getByTestId('wheel-drum-unit-amount')).not.toBeNull();
    });

    // Switch to native keyboard via [Type], then return via [Wheel]
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-type-btn'));
    });
    expect(view.contentDOM.getAttribute('inputmode')).toBe('text');
    expect(screen.getByTestId('mobile-typing-bar')).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId('mobile-return-wheel-btn'));
    });
    expect(view.contentDOM.getAttribute('inputmode')).toBe('none');
    expect(screen.getByTestId('mobile-wheel-composer')).not.toBeNull();
  });

  it('scopes movement options from Notebook and Frontmatter tags without any sport field', async () => {
    const registry = getAppEffortRegistry();
    await registry.loadBundled();
    await registry.upsert({
      id: 'climb-hang',
      slug: 'dead-hang',
      label: 'Dead Hang',
      aliases: ['hangboard'],
      baseAttributes: { met: 4.5 },
      registrySource: 'user',
      sourcePath: 'climbing/dead-hang.md',
    });

    const landingContent = '---\nmetrics.effort: dead-hang\ntags:\n  - climbing\n---\n# Climbing\n';
    const createdLanding = await storageService.saveNoteSource({
      noteId: 'notebook/climbing',
      metadata: { title: 'Climbing', tags: ['climbing'] },
      rawContent: landingContent,
      expectedSourceRevision: 0,
    });
    await storageService.saveNote({
      ...createdLanding,
      notebookId: 'notebook/climbing',
    });

    const noteContent = '```time\n0:10 \n```';
    const createdNote = await storageService.saveNoteSource({
      noteId: 'note-climb-1',
      metadata: { title: 'Tuesday Hangboard', tags: ['climbing'] },
      rawContent: noteContent,
      expectedSourceRevision: 0,
    });
    await storageService.saveNote({
      ...createdNote,
      notebookId: 'notebook/climbing',
    });

    const doc = '```time\n0:10\n```';
    let view: EditorView | undefined;
    render(
      <NoteEditor
        noteId="note-climb-1"
        value={doc}
        onChange={() => {}}
        onViewCreated={(v) => {
          view = v;
        }}
      />,
    );
    if (!view) throw new Error('Editor did not mount');

    const lineEnd = doc.indexOf('0:10') + 4;
    act(() => {
      view!.contentDOM.focus();
      fireEvent.focus(view!.contentDOM);
      view!.dispatch({ selection: { anchor: lineEnd } });
    });

    await screen.findByTestId('mobile-wheel-composer');
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-slot-add'));
    });

    await waitFor(() => {
      const addEffortBtn = screen.getByTestId('wheel-option-add-effort');
      expect(addEffortBtn.textContent).toContain('Dead Hang');
    });
  });
});
