import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { completionStatus, currentCompletions, setSelectedCompletion, startCompletion } from '@codemirror/autocomplete';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
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

function key(view: EditorView, key: string) {
  act(() => { fireEvent.keyDown(view.contentDOM, { key, code: key }); });
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

  it('consumes Tab rather than indenting when completion has no selected option', async () => {
    const view = editor('---\ndom');
    await complete(view, 'domain');
    act(() => { view.dispatch({ effects: setSelectedCompletion(-1) }); });
    key(view, 'Tab');
    expect(view.state.doc.toString()).toBe('---\ndom');
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

  it('preserves typed property and value acceptance with Enter', async () => {
    const view = editor('---\ndom');
    await complete(view, 'domain');
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('---\ndomain:\n  - ');
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '---\nformat:a' }, selection: { anchor: 12 } });
    });
    await complete(view, 'amrap');
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('---\nformat:amrap');
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
    await waitFor(() => expect(
      document.querySelector('[data-frontmatter-row="domain"] input[aria-label="Property key"]'),
    ).toBeTruthy());
    expect(view.contentDOM.textContent).not.toContain('domain: climbing');

    act(() => { fireEvent.click(screen.getByLabelText('Edit YAML')); });
    await waitFor(() => expect(view.contentDOM.textContent).toContain('domain: climbing'));
    await waitFor(() => expect(
      document.querySelector('[data-frontmatter-row="domain"] input[aria-label="Property key"]'),
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
      document.querySelector('[data-frontmatter-row="format"] input[aria-label="Property key"]'),
    ).toBeTruthy());
    expect(view.contentDOM.textContent).not.toContain('format:\n  - amrap');
  });

  it('keeps completion reachable in open frontmatter with preview enabled', async () => {
    const view = editor('---\ndom', undefined, { preview: true });
    await complete(view, 'domain');
    key(view, 'Enter');
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
