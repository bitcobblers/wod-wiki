import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { TEST_IDS } from '@/lib/testIds';
import { storageService } from '@/hooks/useBrowserServices';
import { createInlineTagFromSlug } from '@/app/editor/noteEditorServices';
import { setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host';

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

function setDesktopMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
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

function mountEditor(doc: string): { view: EditorView; restoreCoords: () => void } {
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
  if (!view) throw new Error('NoteEditor did not mount');
  const coords = spyOn(view, 'coordsAtPos').mockReturnValue({
    left: 24,
    right: 140,
    top: 24,
    bottom: 44,
  });
  return {
    view,
    restoreCoords: () => coords.mockRestore(),
  };
}

let host: PlaygroundHostHandle;

beforeEach(async () => {
  host = await setupPlaygroundTestHost({
    world: {
      propertyNotes: [
        {
          kind: 'effort',
          slug: 'kettlebell-swing',
          label: 'Kettlebell Swing',
          aliases: ['swing', 'kb swing', 'kbs'],
        },
        {
          kind: 'effort',
          slug: 'burpee',
          label: 'Burpee',
          aliases: ['burpees'],
        },
      ],
    },
  });
  setDesktopMatchMedia();
});

afterEach(async () => {
  cleanup();
  await host.cleanup();
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  }
});

describe('Unified Whiteboard Syntax Inspector & Prose Completions', () => {
  it('opens Option A popover from chip click & Ctrl+., mutates tokens, and closes on Escape', async () => {
    const doc = '# Session\n\n```time\n10:00 15 Kettlebell Swing @24kg\n```';
    const { view, restoreCoords } = mountEditor(doc);

    try {
      const offset = doc.indexOf('10:00') + 1;
      act(() => {
        view.dispatch({ selection: { anchor: offset } });
        view.focus();
      });

      const strip = await screen.findByTestId(TEST_IDS.EDITOR_TOKEN_STRIP);
      const chipBtn = strip.querySelector('button[data-inspector-trigger="true"]');
      expect(chipBtn).not.toBeNull();

      act(() => {
        fireEvent.click(chipBtn!);
      });

      const popover = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER);
      expect(popover).toBeDefined();

      // Switch timer token to Rest mode via Option A popover button
      const restModeBtn = await screen.findByRole('button', { name: /Rest \(\*1:00\)/i });
      act(() => {
        fireEvent.click(restModeBtn);
      });

      await waitFor(() => {
        expect(view.state.doc.toString()).toContain('*10:00');
      });

      // Escape dismisses Option A popover
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      await waitFor(() => {
        expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER)).toBeNull();
      });

      // Ctrl+. reopens unified popover at cursor
      act(() => {
        fireEvent.keyDown(document, { key: '.', ctrlKey: true });
      });
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER)).toBeDefined();
      });
    } finally {
      restoreCoords();
    }
  });

  it('toggles Option B inspector drawer, shows live diff badge, and lists block timeline rows', async () => {
    const doc = '```time\n10:00 15 Kettlebell Swing @24kg\n  *1:00 Rest\n```';
    const { view, restoreCoords } = mountEditor(doc);

    try {
      const offset = doc.indexOf('@24kg') + 1;
      act(() => {
        view.dispatch({ selection: { anchor: offset } });
        view.focus();
      });

      const drawerToggle = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER_TOGGLE);
      act(() => {
        fireEvent.click(drawerToggle);
      });

      const drawer = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER);
      expect(drawer).toBeDefined();

      const timelineRows = await screen.findAllByTestId(TEST_IDS.EDITOR_BLOCK_TIMELINE_ROW);
      expect(timelineRows.length).toBeGreaterThanOrEqual(2);

      // Edit token via a load preset/scrubber item to verify live diff badge
      const thirtyTwo = Array.from(drawer.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '@32kg' || b.textContent?.trim() === '32',
      );
      if (thirtyTwo) {
        act(() => {
          fireEvent.click(thirtyTwo);
        });
        await waitFor(() => {
          expect(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_DIFF_BADGE)).toBeDefined();
        });
      }

      // Ctrl+Shift+I closes drawer
      act(() => {
        fireEvent.keyDown(document, { key: 'I', ctrlKey: true, shiftKey: true });
      });
      await waitFor(() => {
        expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER)).toBeNull();
      });
    } finally {
      restoreCoords();
    }
  });

  it('surfaces fuzzy alias matching in Effort inspector and repairs :rest / ladder syntax', async () => {
    const doc = '```time\n21-15-9 Kettlebell Swing\n:rest\n```';
    const { view, restoreCoords } = mountEditor(doc);

    try {
      // Focus `:rest` line -> apply quick fix `*1:00`
      const restPos = doc.indexOf(':rest') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: restPos } });
        view.focus();
      });

      const quickFixes = await screen.findAllByTestId(TEST_IDS.EDITOR_LINT_QUICK_FIX);
      expect(quickFixes.length).toBeGreaterThanOrEqual(1);

      act(() => {
        fireEvent.click(quickFixes[0]!);
      });

      await waitFor(() => {
        expect(view.state.doc.toString()).toContain('*1:00');
      });

      // Focus `21-15-9 Kettlebell Swing` -> repair unparenthesized ladder
      const ladderPos = view.state.doc.toString().indexOf('21-15-9') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: ladderPos } });
        view.focus();
      });

      const ladderFix = await screen.findByTestId(TEST_IDS.EDITOR_LINT_QUICK_FIX);
      expect(ladderFix.textContent).toContain('(21-15-9)');
      act(() => {
        fireEvent.click(ladderFix);
      });

      await waitFor(() => {
        expect(view.state.doc.toString()).toContain('(21-15-9)');
      });

      // Open Effort token inspector and test fuzzy alias query `kbs`
      const swingPos = view.state.doc.toString().indexOf('Kettlebell Swing') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: swingPos } });
        fireEvent.keyDown(document, { key: 'I', ctrlKey: true, shiftKey: true });
      });

      const searchInput = await screen.findByLabelText('Search effort catalog');
      act(() => {
        fireEvent.change(searchInput, { target: { value: 'kbs' } });
      });

      await waitFor(() => {
        const drawer = screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER);
        expect(drawer.textContent).toContain('Kettlebell Swing');
      });
    } finally {
      restoreCoords();
    }
  });

  it('completes [[wiki links]] and inline #tags in Markdown prose without hijacking # Headings', async () => {
    await createInlineTagFromSlug('heavy');
    const created = await storageService.saveNoteSource({
      noteId: 'note-fran',
      metadata: { title: 'Fran Benchmark', tags: ['benchmark'] },
      rawContent: '# Fran Benchmark\n',
      expectedSourceRevision: 0,
    });
    await storageService.saveNote(created);

    const doc = '# Heading Line\n\nSee [[\nInline tag #';
    const { view, restoreCoords } = mountEditor(doc);

    try {
      // Cursor after `[[` -> yields Fran Benchmark
      const wikiPos = doc.indexOf('[[') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: wikiPos } });
        startCompletion(view);
      });

      await waitFor(() => {
        const opts = currentCompletions(view.state);
        expect(opts.some((o) => o.label === 'Fran Benchmark')).toBe(true);
      });

      // Cursor on `# ` heading start -> does NOT produce tag completions
      const headingPos = doc.indexOf('# ') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: headingPos } });
        startCompletion(view);
      });

      await waitFor(() => {
        const opts = currentCompletions(view.state);
        expect(opts.some((o) => o.label.startsWith('#'))).toBe(false);
      });

      // Cursor after ` #` inline -> yields #heavy completions
      const inlineHashPos = doc.lastIndexOf('#') + 1;
      act(() => {
        view.dispatch({ selection: { anchor: inlineHashPos } });
        startCompletion(view);
      });

      await waitFor(() => {
        const opts = currentCompletions(view.state);
        expect(opts.some((o) => o.label === '#heavy')).toBe(true);
      });
    } finally {
      restoreCoords();
    }
  });
});
