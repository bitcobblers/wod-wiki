import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { deleteCharBackward } from '@codemirror/commands';
import { completionStatus, currentCompletions, selectedCompletionIndex, setSelectedCompletion, startCompletion } from '@codemirror/autocomplete';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { createInlineTagFromSlug } from '@/app/editor/noteEditorServices';
import { InMemoryStorage, resetStorageForTesting, setStorageForTesting, storageService } from '@/hooks/useBrowserServices';
import type { Tag } from '@/types/storage';

const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
Object.defineProperty(window.Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => zeroRect });

beforeEach(async () => {
  setStorageForTesting(new InMemoryStorage());
  for (const name of ['domain', 'format']) {
    await storageService.putTagType({ id: name, name, label: name, createdAt: 1 });
  }
  await storageService.putTag({ id: 'climbing', label: 'climbing', type: 'domain', createdAt: 1 });
  await storageService.putTag({ id: 'running', label: 'running', type: 'domain', createdAt: 1 });
  await storageService.putTag({ id: 'amrap', label: 'amrap', type: 'format', createdAt: 1 });
});

afterEach(() => {
  cleanup();
  resetStorageForTesting();
});

function editor(doc: string, cursor = doc.length, { preview = false }: { preview?: boolean } = {}) {
  let createdView: EditorView | undefined;
  render(<NoteEditor value={doc} onChange={() => {}} enablePreview={preview} enableLinting={false}
    hideDefaultCommands onViewCreated={(view) => { createdView = view; }} />);
  if (!createdView) throw new Error('Editor did not mount');
  const view = createdView;
  act(() => {
    view.dispatch({ selection: { anchor: cursor } });
    view.focus();
  });
  return view;
}

function key(view: EditorView, key: string, opts: { shiftKey?: boolean } = {}) {
  act(() => { fireEvent.keyDown(view.contentDOM, { key, code: key, shiftKey: Boolean(opts.shiftKey) }); });
}

async function complete(view: EditorView, label: string) {
  act(() => { startCompletion(view); });
  await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain(label));
}

describe('NoteEditor frontmatter keyboard behavior', () => {
  it('accepts a property with Tab without indenting and opens its empty value list', async () => {
    const view = editor('---\ndom');
    await complete(view, 'domain');
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndomain:\n  - ');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain('climbing'));
    act(() => { view.dispatch({ effects: setSelectedCompletion(1) }); });
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndomain:\n  - running');
  });

  it('accepts the top suggestion on Tab even when no option is arrow-selected', async () => {
    const view = editor('---\ndom');
    await complete(view, 'domain');
    expect(selectedCompletionIndex(view.state)).toBeNull();
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndomain:\n  - ');
  });

  for (const context of ['domain:', 'domain:\n  - ']) {
    for (const ready of [false, true]) {
      it(`inserts a newline at an empty ${context.includes('-') ? 'list' : 'inline'} value with ${ready ? 'ready' : 'pending'} suggestions`, async () => {
        const doc = `---\n${context}`;
        const view = editor(doc);
        act(() => { startCompletion(view); });
        if (ready) await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain('climbing'));
        key(view, 'Enter');
        expect(view.state.doc.toString()).toBe(`${doc}\n${context.includes('-') ? '  ' : ''}`);
        expect(completionStatus(view.state)).toBeNull();
      });
    }
  }

  it('keeps Enter for newlines unless an option is explicitly selected, and accepts when selected', async () => {
    const view = editor('---\ndom');
    await complete(view, 'domain');
    expect(selectedCompletionIndex(view.state)).toBeNull();
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('---\ndom\n');
    expect(completionStatus(view.state)).toBeNull();

    // Explicit arrow/index selection + Enter commits in frontmatter.
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '---\ndom' }, selection: { anchor: 7 } });
    });
    await complete(view, 'domain');
    const domIdx = currentCompletions(view.state).findIndex((o) => o.label === 'domain');
    act(() => { view.dispatch({ effects: setSelectedCompletion(domIdx) }); });
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('---\ndomain:\n  - ');

    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '---\nformat:a' }, selection: { anchor: 12 } });
    });
    await complete(view, 'amrap');
    const amrapIdx = currentCompletions(view.state).findIndex((o) => o.label === 'amrap');
    act(() => { view.dispatch({ effects: setSelectedCompletion(amrapIdx) }); });
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('---\nformat:amrap');
  });

  it('preserves Enter for newlines inside workout blocks when typeahead is open without selection', async () => {
    const doc = '```time\n10\n```';
    const pos = doc.indexOf('10') + 2;
    const view = editor(doc, pos);
    await complete(view, 'kg');
    expect(selectedCompletionIndex(view.state)).toBeNull();
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n10\n\n```');
    expect(completionStatus(view.state)).toBeNull();
  });

  it('offers effort, discipline, and intensity completions in raw frontmatter YAML', async () => {
    await getAppEffortRegistry().upsert({
      id: 'eff-bs',
      slug: 'back-squat',
      label: 'Back Squat',
      aliases: [],
      baseAttributes: { met: 5.5, discipline: 'strength' },
      registrySource: 'user',
    });

    const effView = editor('---\neffort: ');
    await complete(effView, 'Back Squat (back-squat)');

    const discView = editor('---\ndiscipline: ');
    await complete(discView, 'strength');

    const intView = editor('---\nintensity: ');
    await complete(intView, 'high');
  });

  it('shows all values again after deleting a filter to empty', async () => {
    const view = editor('---\ndomain:cl');
    await complete(view, 'climbing');
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length - 2, to: view.state.doc.length }, userEvent: 'delete.backward' });
    });
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toEqual(['climbing', 'running']));
    expect(view.state.doc.toString()).toBe('---\ndomain:');
  });

  it('does not offer tag properties in markdown after the closing fence', async () => {
    const view = editor('---\ndomain: climbing\n---\ndom');
    act(() => { startCompletion(view); });
    await waitFor(() => expect(completionStatus(view.state)).toBeNull());
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it('refreshes metrics after editing a workout without changing lines', async () => {
    const doc = '```time\n10 Sit Ups\n```';
    const view = editor(doc, doc.indexOf('Sit'));
    const coords = spyOn(view, 'coordsAtPos').mockReturnValue({ left: 0, right: 100, top: 0, bottom: 20 });
    try {
      act(() => {
        const line = view.state.doc.line(2);
        view.dispatch({ changes: { from: line.from, to: line.to, insert: '5 Push Ups' }, selection: { anchor: line.from + 2 } });
      });
      const panel = await screen.findByLabelText('Metric inline panel');
      await waitFor(() => {
        expect(panel.textContent).toContain('Push Ups');
        expect(panel.textContent).toContain('5');
        expect(panel.textContent).not.toContain('Sit Ups');
      });
      expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
    } finally {
      coords.mockRestore();
    }
  });
});

describe('NoteEditor frontmatter raw editing reachability (preview on)', () => {
  it('reveals closed frontmatter for completion while raw editing and restores the widget on exit', async () => {
    const doc = '---\ndomain: climbing\n---\n\nBody text.';
    const view = editor(doc, doc.length, { preview: true });
    await waitFor(() => expect(document.querySelector('[data-frontmatter-summary]')?.textContent).toContain('#climbing'));
    act(() => { fireEvent.click(screen.getByLabelText('Show property details')); });
    await waitFor(() => expect(
      within(document.querySelector('[data-frontmatter-row="domain"]') as HTMLElement)
        .getByLabelText('Property key: domain'),
    ).toBeTruthy());
    expect(view.contentDOM.textContent).not.toContain('domain: climbing');

    act(() => { fireEvent.click(screen.getByLabelText('Edit YAML')); });
    await waitFor(() => expect(view.contentDOM.textContent).toContain('domain: climbing'));
    await waitFor(() => expect(
      document.querySelector('[data-frontmatter-row="domain"]'),
    ).toBeNull());

    // New property typed on a fresh line inside the closed block.
    const at = view.state.doc.line(2).to;
    act(() => {
      view.dispatch({ changes: { from: at, insert: '\nfor' }, selection: { anchor: at + 4 }, userEvent: 'input.type' });
    });
    await complete(view, 'format');
    act(() => { view.dispatch({ effects: setSelectedCompletion(1) }); });
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndomain: climbing\nformat:\n  - \n---\n\nBody text.');
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain('amrap'));
    act(() => { view.dispatch({ effects: setSelectedCompletion(0) }); });
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndomain: climbing\nformat:\n  - amrap\n---\n\nBody text.');

    act(() => { view.dispatch({ selection: { anchor: view.state.doc.length } }); });
    await waitFor(() => expect(
      within(document.querySelector('[data-frontmatter-row="format"]') as HTMLElement)
        .getByLabelText('Property key: format'),
    ).toBeTruthy());
    expect(view.contentDOM.textContent).not.toContain('format:\n  - amrap');
  });

  it('keeps completion reachable in open frontmatter with preview enabled', async () => {
    const view = editor('---\ndom', undefined, { preview: true });
    await complete(view, 'domain');
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndomain:\n  - ');
    await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain('climbing'));
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('consumes Tab without changes while a gated value source is in flight, then accepts', async () => {
    const view = editor('---\ndom');
    await complete(view, 'domain');
    const realGetAllTags = storageService.getAllTags.bind(storageService);
    let release: (tags: Tag[]) => void = () => {};
    const gate = new Promise<Tag[]>((resolve) => { release = resolve; });
    storageService.getAllTags = () => gate;
    try {
      key(view, 'Tab');
      expect(view.state.doc.toString()).toBe('---\ndomain:\n  - ');

      // Type while the value source triggered by the scaffold acceptance is
      // gated: Tab must neither indent nor accept anything yet.
      const at = view.state.doc.length;
      act(() => {
        view.dispatch({ changes: { from: at, insert: 'c' }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      });
      key(view, 'Tab');
      expect(view.state.doc.toString()).toBe('---\ndomain:\n  - c');
      expect(view.state.doc.sliceString(at)).not.toContain('\t');

      release(await realGetAllTags());
      await waitFor(() => expect(currentCompletions(view.state).map((option) => option.label)).toContain('climbing'));
      key(view, 'Tab');
      expect(view.state.doc.toString()).toBe('---\ndomain:\n  - climbing');
    } finally {
      storageService.getAllTags = realGetAllTags;
    }
  });
});

describe('NoteEditor workout block indentation and lap-marker continuation', () => {
  it('auto-indents rounds headers, preserves indent, resets on double-Enter, continues +/- markers, and supports Tab/Shift-Tab', () => {
    const doc = '```time\n(3)\n```';
    const view = editor(doc, doc.indexOf('(3)') + 3);

    // 1. Enter after `(3)` -> auto-indented two spaces
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  \n```');
    expect(view.state.selection.main.head).toBe('```time\n(3)\n  '.length);

    // 2. Type child line and press Enter -> preserves two-space indent
    act(() => {
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: '10 Pull-ups' }, selection: { anchor: pos + 11 } });
    });
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n  \n```');

    // 3. Double-Enter on blank indented line -> resets cursor to column 0 without trailing spaces
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n\n\n```');
    expect(view.state.selection.main.head).toBe('```time\n(3)\n  10 Pull-ups\n\n'.length);

    // 4. `+` lap line continues `+ `, and Enter on empty `+ ` resets cleanly
    act(() => {
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: '  + 5 Burpees' }, selection: { anchor: pos + 13 } });
    });
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n\n  + 5 Burpees\n  + \n```');
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n\n  + 5 Burpees\n\n\n```');

    // 5. `-` lap line continues `- `, and Tab / Shift-Tab indent & outdent when completion is closed
    act(() => {
      const pos = view.state.selection.main.head;
      view.dispatch({ changes: { from: pos, insert: '- 10 Air Squats' }, selection: { anchor: pos + 15 } });
    });
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n\n  + 5 Burpees\n\n- 10 Air Squats\n- \n```');

    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n\n  + 5 Burpees\n\n- 10 Air Squats\n  - \n```');

    key(view, 'Tab', { shiftKey: true });
    expect(view.state.doc.toString()).toBe('```time\n(3)\n  10 Pull-ups\n\n  + 5 Burpees\n\n- 10 Air Squats\n- \n```');
  });

  it('triggers unit, effort, and tag typeahead when backspacing inside NoteEditor', async () => {
    await getAppEffortRegistry().upsert({
      id: 'eff-bs-back',
      slug: 'back-squat',
      label: 'Back Squat',
      aliases: [],
      baseAttributes: { met: 6, discipline: 'strength' },
      registrySource: 'user',
    });
    await createInlineTagFromSlug('heavy');

    // 1. Deleting unit back to number offers kg / reps / rounds.
    const unitDoc = '```time\n10kg\n```';
    const unitView = editor(unitDoc, unitDoc.indexOf('10kg') + 4);
    act(() => { deleteCharBackward(unitView); });
    act(() => { deleteCharBackward(unitView); });
    await waitFor(() => {
      expect(completionStatus(unitView.state)).toBe('active');
      const labels = currentCompletions(unitView.state).map((o) => o.label);
      expect(labels).toContain('kg');
      expect(labels).toContain('reps');
      expect(labels).toContain('rounds');
    });

    // 2. Deleting letters of effort re-opens from effort start and Tab restores full phrase.
    const effortDoc = '```time\n10 Back Squat\n```';
    const effortView = editor(effortDoc, effortDoc.indexOf('Squat') + 5);
    act(() => { deleteCharBackward(effortView); });
    await waitFor(() => {
      expect(completionStatus(effortView.state)).toBe('active');
      expect(currentCompletions(effortView.state).map((o) => o.label)).toContain('Back Squat');
    });
    key(effortView, 'Tab');
    expect(effortView.state.doc.toString()).toBe('```time\n10 Back Squat\n```');

    // 3. Backspacing space onto end of tag & deleting letters inside workout block opens tag completion.
    const tagEndDoc = '```time\n10 Back Squat #heavy \n```';
    const tagEndView = editor(tagEndDoc, tagEndDoc.indexOf('#heavy ') + 7);
    act(() => { deleteCharBackward(tagEndView); });
    await waitFor(() => {
      expect(completionStatus(tagEndView.state)).toBe('active');
      expect(currentCompletions(tagEndView.state).map((o) => o.label)).toContain('heavy');
    });
    act(() => { deleteCharBackward(tagEndView); });
    await waitFor(() => {
      expect(completionStatus(tagEndView.state)).toBe('active');
      expect(currentCompletions(tagEndView.state).map((o) => o.label)).toContain('heavy');
    });

    // 4. Backspacing space onto end of Markdown inline prose tag & deleting letters opens #tag completion.
    const proseDoc = 'See #heavy ';
    const proseView = editor(proseDoc, proseDoc.length);
    act(() => { deleteCharBackward(proseView); });
    await waitFor(() => {
      expect(completionStatus(proseView.state)).toBe('active');
      expect(currentCompletions(proseView.state).map((o) => o.label)).toContain('#heavy');
    });
    act(() => { deleteCharBackward(proseView); });
    await waitFor(() => {
      expect(completionStatus(proseView.state)).toBe('active');
      expect(currentCompletions(proseView.state).map((o) => o.label)).toContain('#heavy');
    });
  });
});
