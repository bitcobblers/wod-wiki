import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { TEST_IDS } from '@/lib/testIds';
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

  it('keeps the live token rail + syntax keys in Type mode and supports delete + undo', async () => {
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
      view!.dispatch({ selection: { anchor: lineStart + 6 } });
    });

    await screen.findByTestId('mobile-wheel-composer');
    await waitFor(() => {
      expect(screen.getByTestId('mobile-wheel-slot-1').textContent).toBe('15');
    });

    // Step to "15", delete it, and undo back
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-slot-1'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId(TEST_IDS.EDITOR_TOKEN_DELETE_BTN));
    });
    expect(view.state.doc.toString()).not.toContain('10:00 15 Kettlebell Swing');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo last edit' }));
    });
    await waitFor(() => {
      expect(view!.state.doc.toString()).toContain('10:00 15 Kettlebell Swing');
    });

    // Enter Type mode and verify persistent Live Token Rail + syntax accessory keys
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-type-btn'));
    });
    const typingBar = screen.getByTestId('mobile-typing-bar');
    expect(typingBar.textContent).toContain('L2');
    expect(typingBar.textContent).toContain('Kettlebell Swing');

    const starKey = screen.getByRole('button', { name: 'Insert rest prefix *' });
    act(() => {
      fireEvent.click(starKey);
    });
    expect(view.state.doc.toString()).toContain('*');
  });

  it('opens prose directly in typing mode (inputmode="text" + mobile-typing-bar) and workout blocks in deck mode with safe-area padding', async () => {
    const doc = '# Morning Notes\n\nFeeling strong today.\n\n```time\n10:00 15 Kettlebell Swing\n```';
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

    // Focusing inside Markdown prose enters typing mode directly without an extra Type tap
    const prosePos = doc.indexOf('Feeling strong') + 2;
    act(() => {
      view!.dispatch({ selection: { anchor: prosePos } });
      view!.contentDOM.focus();
      fireEvent.focus(view!.contentDOM);
    });

    const typingBar = await screen.findByTestId('mobile-typing-bar');
    expect(typingBar.className).toContain('pb-[env(safe-area-inset-bottom,0px)]');
    expect(screen.queryByTestId('mobile-wheel-composer')).toBeNull();
    await waitFor(() => {
      expect(view!.contentDOM.getAttribute('inputmode')).toBe('text');
    });

    // Blur, move selection inside ```time workout fence, and focus -> enters 3-region wheel deck
    const workoutPos = doc.indexOf('10:00') + 1;
    act(() => {
      fireEvent.blur(view!.contentDOM);
      view!.dispatch({ selection: { anchor: workoutPos } });
      view!.contentDOM.focus();
      fireEvent.focus(view!.contentDOM);
    });

    const deck = await screen.findByTestId('mobile-wheel-composer');
    expect(deck.className).toContain('pb-[env(safe-area-inset-bottom,0px)]');
    expect(screen.queryByTestId('mobile-typing-bar')).toBeNull();
    await waitFor(() => {
      expect(view!.contentDOM.getAttribute('inputmode')).toBe('none');
    });
  });

  it('opens duration scrubber on + Duration click, wires query rail Chart stage, and marks data-mobile-editor-open', async () => {
    const doc = '```time\n10:00 15 Kettlebell Swing\n```\n\n```query\n:sum{metric:reps} by {week} last 4w | :bar{}\n```';
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

    const lineStart = doc.indexOf('10:00') + 1;
    act(() => {
      view!.contentDOM.focus();
      fireEvent.focus(view!.contentDOM);
      view!.dispatch({ selection: { anchor: lineStart } });
    });

    await screen.findByTestId('mobile-wheel-composer');
    expect(document.documentElement.dataset.mobileEditorOpen).toBe('true');

    // Click + Add -> Duration / Timer (`wheel-option-add-duration`) auto-opens scrubber
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-slot-add'));
    });
    const addDurationBtn = await screen.findByTestId('wheel-option-add-duration');
    act(() => {
      fireEvent.click(addDurationBtn);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId(TEST_IDS.EDITOR_INSPECTOR_SCRUBBER).length).toBeGreaterThanOrEqual(1);
    });

    // Move cursor into query block body (accounting for inserted ` 1:00`) -> tap "Chart" slot -> select Timeseries stage
    const qPos = view!.state.doc.toString().indexOf(':sum') + 2;
    act(() => {
      view!.dispatch({ selection: { anchor: qPos } });
    });
    const chartSlot = await screen.findByRole('button', { name: 'Chart' });
    act(() => {
      fireEvent.click(chartSlot);
    });
    const tsBtn = await screen.findByRole('button', { name: 'Timeseries' });
    act(() => {
      fireEvent.click(tsBtn);
    });
    await waitFor(() => {
      expect(view!.state.doc.toString()).toContain('| :timeseries{}');
    });

    // Closing deck clears data-mobile-editor-open
    act(() => {
      fireEvent.click(screen.getByTestId('mobile-wheel-done-btn'));
    });
    await waitFor(() => {
      expect(document.documentElement.dataset.mobileEditorOpen).toBeUndefined();
    });
  });

  it('publishes --mobile-editor-inset, avoids pb-[48dvh], strips bottom safe-area padding when keyboard opens, and respects autoFocus={false}', async () => {
    const originalVisualViewport = window.visualViewport;
    const originalInnerHeight = window.innerHeight;
    const vvListeners = new Map<string, Set<EventListener>>();
    const mockVv = {
      height: 844,
      offsetTop: 0,
      scale: 1,
      addEventListener: (type: string, cb: EventListener) => {
        if (!vvListeners.has(type)) vvListeners.set(type, new Set());
        vvListeners.get(type)!.add(cb);
      },
      removeEventListener: (type: string, cb: EventListener) => {
        vvListeners.get(type)?.delete(cb);
      },
    };
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 844 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: mockVv });

    try {
      const doc = '# Note\n\nProse line\n\n```time\n10:00 15 Kettlebell Swing\n```';
      let view: EditorView | undefined;
      const { container } = render(
        <NoteEditor
          value={doc}
          onChange={() => {}}
          onViewCreated={(v) => {
            view = v;
          }}
        />,
      );
      if (!view) throw new Error('Editor did not mount');

      const workoutPos = doc.indexOf('10:00') + 1;
      act(() => {
        view!.dispatch({ selection: { anchor: workoutPos } });
        view!.contentDOM.focus();
        fireEvent.focus(view!.contentDOM);
      });

      await screen.findByTestId('mobile-wheel-composer');
      const editorHost = container.querySelector('.cm-note-editor') as HTMLElement;
      expect(editorHost.dataset.mobileEditing).toBe('true');
      expect(editorHost.className).not.toContain('pb-[48dvh]');
      expect(document.documentElement.style.getPropertyValue('--mobile-editor-inset')).not.toBe('');

      // Switch to typing mode and simulate native OS keyboard opening
      act(() => {
        fireEvent.click(screen.getByTestId('mobile-wheel-type-btn'));
      });
      const typingBar = await screen.findByTestId('mobile-typing-bar');
      act(() => {
        mockVv.height = 500;
        for (const cb of vvListeners.get('resize') ?? []) cb(new Event('resize'));
      });
      await waitFor(() => {
        expect(typingBar.style.bottom).toBe('344px');
        expect(typingBar.style.paddingBottom).toBe('0px');
      });

      // Done clears inset and editing marker
      act(() => {
        fireEvent.click(screen.getByTestId('mobile-wheel-done-btn'));
      });
      await waitFor(() => {
        expect(document.documentElement.style.getPropertyValue('--mobile-editor-inset')).toBe('');
        expect(editorHost.dataset.mobileEditing).toBeUndefined();
      });

      // Desktop autoFocus={false} stays blurred on mount
      cleanup();
      setMobileMatchMedia(false);
      let desktopView: EditorView | undefined;
      render(
        <NoteEditor
          value="```time\n5:00 Run\n```"
          onChange={() => {}}
          autoFocus={false}
          onViewCreated={(v) => {
            desktopView = v;
          }}
        />,
      );
      expect(desktopView).toBeDefined();
      expect(document.activeElement).not.toBe(desktopView!.contentDOM);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: originalInnerHeight });
      Object.defineProperty(window, 'visualViewport', { configurable: true, writable: true, value: originalVisualViewport });
    }
  });
});
