import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import { QUERY_SEED_PRESETS } from '@/components/organisms/editor/whiteboard-inspector/TokenInspectorPanel';
import { TokenScrubber } from '@/components/organisms/editor/whiteboard-inspector/TokenScrubber';
import { QUERY_STAGES } from '@/components/organisms/editor/wheelSources';
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
  it('opens Option A popover from chip click & Alt+. (leaving Ctrl+. for L3), mutates tokens, and closes on Escape', async () => {
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

      // Ctrl+. does NOT open Option A popover (owned by SidebarLayout L3)
      act(() => {
        fireEvent.keyDown(document, { key: '.', ctrlKey: true });
      });
      expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER)).toBeNull();

      // Alt+. does NOT fire when focus is outside NoteEditor on document.body
      act(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        document.body.focus();
        fireEvent.keyDown(document, { key: '.', altKey: true });
      });
      expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER)).toBeNull();

      // Alt+. reopens unified popover when focused inside NoteEditor
      act(() => {
        view.focus();
        fireEvent.keyDown(document, { key: '.', altKey: true });
      });
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER)).toBeDefined();
      });
    } finally {
      restoreCoords();
    }
  });

  it('toggles Option B inspector drawer via Mod+Alt+I, shows live diff badge, and lists block timeline rows', async () => {
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
      expect(drawer.textContent).toContain('Ctrl+Space Typeahead');
      expect(drawer.textContent).toContain('/ Blocks');

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

      // Ctrl+Shift+I does NOT close drawer (rebound to Mod+Alt+I to avoid DevTools clash)
      act(() => {
        fireEvent.keyDown(document, { key: 'I', ctrlKey: true, shiftKey: true });
      });
      expect(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER)).toBeDefined();

      // Mod+Alt+I closes drawer
      act(() => {
        fireEvent.keyDown(document, { key: 'i', ctrlKey: true, altKey: true });
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

      // Open Effort token inspector via Mod+Alt+I and test fuzzy alias query `kbs`
      const swingPos = view.state.doc.toString().indexOf('Kettlebell Swing') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: swingPos } });
        view.focus();
        fireEvent.keyDown(document, { key: 'i', ctrlKey: true, altKey: true });
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

  it('renders WqlComposer in mode="query" and updates only the YAML query line', async () => {
    const doc = '# Analytics\n\n```query\nview: summary\nquery: sum:totalVolume{}\n```';
    const { view, restoreCoords } = mountEditor(doc);

    try {
      const qPos = doc.indexOf('sum:totalVolume{}') + 2;
      act(() => {
        view.dispatch({ selection: { anchor: qPos } });
        view.focus();
        fireEvent.keyDown(document, { key: '.', altKey: true });
      });

      const popover = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER);
      expect(popover).toBeDefined();
      expect(await screen.findByTestId('wql-composer')).toBeDefined();

      // Expand quick-seed presets and seed "Find Sessions" -> preserves `view: summary`
      const presetsBtn = screen.getByRole('button', { name: /Quick-seed presets/i });
      act(() => {
        fireEvent.click(presetsBtn);
      });
      const findSessionsBtn = await screen.findByRole('button', { name: /Find Sessions/i });
      act(() => {
        fireEvent.click(findSessionsBtn);
      });

      await waitFor(() => {
        const updated = view.state.doc.toString();
        expect(updated).toContain('view: summary');
        expect(updated).toContain('query: :session{} last 4w');
      });
    } finally {
      restoreCoords();
    }
  });

  it('validates every QUERY_SEED_PRESETS and QUERY_STAGES preset against @bitcobblers/wod-wiki-wql parseQuery', () => {
    expect(QUERY_SEED_PRESETS.length).toBeGreaterThan(0);
    for (const preset of QUERY_SEED_PRESETS) {
      const parsed = parseQuery(preset.val);
      expect(parsed.error).toBeUndefined();
    }
    for (const stage of QUERY_STAGES) {
      for (const opt of stage.options) {
        if (opt.value.startsWith('replace:')) {
          const parsed = parseQuery(opt.value.slice('replace:'.length));
          expect(parsed.error).toBeUndefined();
        }
      }
    }
  });

  it('auto-commits TokenScrubber on scrollsnapchange and keyboard ArrowDown while ignoring mount sync', async () => {
    const selected: string[] = [];
    render(
      <TokenScrubber
        label="Load (kg)"
        options={[
          { id: '16', label: '16kg', value: '16' },
          { id: '24', label: '24kg', value: '24' },
          { id: '32', label: '32kg', value: '32' },
        ]}
        selectedValue="24"
        onSelect={(opt) => selected.push(opt.value)}
      />,
    );

    const listbox = screen.getByRole('listbox', { name: 'Load (kg)' });
    expect(selected).toEqual([]);

    act(() => {
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    });
    expect(selected).toEqual(['32']);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    if ('onscrollsnapchange' in HTMLElement.prototype) {
      const target16 = screen.getByRole('option', { name: '16kg' });
      act(() => {
        const ev = new Event('scrollsnapchange');
        Object.defineProperty(ev, 'snapTargetBlock', { value: target16 });
        listbox.dispatchEvent(ev);
      });
      expect(selected).toEqual(['32', '16']);
    }
  });

  it('anchors Alt+. on a query block to its rendered preview DOM rect instead of degenerate coordinates', async () => {
    const doc = '# Metrics\n\n```query\n:sum{metric:reps} by {week} last 4w | :bar{}\n```';
    const { view, restoreCoords } = mountEditor(doc);
    restoreCoords();

    const previewEl = document.createElement('div');
    previewEl.className = 'cm-query-block-preview';
    document.body.appendChild(previewEl);

    const spyPreviewRect = spyOn(previewEl, 'getBoundingClientRect').mockReturnValue({
      top: 220,
      left: 64,
      right: 420,
      bottom: 320,
      width: 356,
      height: 100,
      x: 64,
      y: 220,
      toJSON: () => ({}),
    });
    const spyDomAtPos = spyOn(view, 'domAtPos').mockReturnValue({ node: previewEl, offset: 0 });
    const spyCoords = spyOn(view, 'coordsAtPos').mockReturnValue(null);

    try {
      const qPos = doc.indexOf(':sum') + 1;
      act(() => {
        view.dispatch({ selection: { anchor: qPos } });
        view.focus();
        fireEvent.keyDown(document, { key: '.', altKey: true });
      });

      const popover = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER);
      expect(popover.style.left).toBe('64px');
      expect(popover.style.top).toBe('328px');
    } finally {
      spyPreviewRect.mockRestore();
      spyDomAtPos.mockRestore();
      spyCoords.mockRestore();
      previewEl.remove();
    }
  });

  it('closes active autocomplete when NoteEditor blurs and positions SelectionFormatBar below headings', async () => {
    const doc = '# Heading\nSubheading text';
    const { view, restoreCoords } = mountEditor(doc);
    restoreCoords();

    const spyFocus = spyOn(document, 'hasFocus').mockReturnValue(true);
    const spyCoords = spyOn(view, 'coordsAtPos').mockReturnValue({
      left: 40,
      right: 120,
      top: 100,
      bottom: 120,
    });
    const spyRect = spyOn(view.dom, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      right: 500,
      bottom: 300,
      width: 500,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    try {
      const subStart = doc.indexOf('Subheading');
      act(() => {
        view.focus();
        view.dispatch({ selection: { anchor: subStart, head: subStart + 10 } });
      });

      const bar = await screen.findByTestId('selection-format-bar');
      // Even though rawTop (100 - 38 = 62) >= 48, line above is H1 (`# Heading`) -> flips below (`120 + 6 = 126px`)
      expect(bar.style.top).toBe('126px');
      expect(screen.getByRole('button', { name: 'Insert link (Ctrl+Shift+K)' })).toBeDefined();

      // Trigger completion and blur NoteEditor -> completion closes
      act(() => {
        startCompletion(view);
      });
      act(() => {
        fireEvent.blur(view.contentDOM);
      });
      expect(currentCompletions(view.state)).toHaveLength(0);
    } finally {
      spyFocus.mockRestore();
      spyCoords.mockRestore();
      spyRect.mockRestore();
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
