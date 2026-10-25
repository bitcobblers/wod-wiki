import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import { CompletionContext, completionStatus, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { wodCompletionSource } from '@bitcobblers/wod-wiki-ui/extensions';
import { InMemoryStorage, resetStorageForTesting, setStorageForTesting } from '@/hooks/useBrowserServices';

const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
Object.defineProperty(window.Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => zeroRect });

beforeEach(() => {
  setStorageForTesting(new InMemoryStorage());
});

afterEach(() => {
  cleanup();
  resetStorageForTesting();
});

function editor(doc: string, cursor: number) {
  let createdView: EditorView | undefined;
  render(<NoteEditor value={doc} onChange={() => {}} enablePreview={false} enableLinting={false}
    hideDefaultCommands onViewCreated={(view) => { createdView = view; }} />);
  if (!createdView) throw new Error('Editor did not mount');
  const view = createdView;
  act(() => {
    view.dispatch({ selection: { anchor: cursor } });
    view.focus();
  });
  return view;
}

function labels(view: EditorView): string[] {
  return currentCompletions(view.state).map((option) => option.label);
}

describe('NoteEditor nested completion', () => {
  it('completes query fence bodies with the standalone WQL vocabulary', async () => {
    const doc = '```query\nfind session{metric:re\n```';
    const view = editor(doc, doc.indexOf('{metric:re') + '{metric:re'.length);
    act(() => { startCompletion(view); });
    await waitFor(() => expect(labels(view)).toContain('reps'));
    // Opening-fence suggestions never leak into the code body.
    expect(labels(view).every((label) => !label.startsWith('```'))).toBe(true);
  });

  it('keeps markdown prose free of options and gives time bodies Whiteboard Script only', async () => {
    const prose = editor('# Note\n\nSome prose\n', '# Note\n\nSome prose\n'.length);
    act(() => { startCompletion(prose); });
    await waitFor(() => expect(completionStatus(prose.state)).toBeNull());
    expect(labels(prose)).toEqual([]);

    // Async sources resolve in this harness too, but with a small timer hop —
    // the live path is covered below. This direct invocation of the editor's
    // own provider chain additionally pins the contract: same state, same
    // facet wiring, first result wins.
    const time = editor('```time\n10:00 \n```', '```time\n10:00 '.length);
    const result = await wodCompletionSource(
      new CompletionContext(time.state, time.state.selection.main.head, true),
    );
    const timeLabels = result?.options.map((option) => option.label) ?? [];
    // Grammar-aware Whiteboard Script suggestions — no WQL, no opening fences.
    expect(timeLabels).toContain('FOR TIME');
    expect(timeLabels.every((label) => !label.startsWith('```'))).toBe(true);
    expect(timeLabels).not.toContain('reps');
  });

  it('offers time-body vocabulary live through startCompletion', async () => {
    const doc = '```time\n10:00 \n```';
    const view = editor(doc, '```time\n10:00 '.length);
    act(() => { startCompletion(view); });
    await waitFor(() => expect(labels(view)).toContain('FOR TIME'));
    // Whiteboard Script only — no WQL, no opening-fence suggestions.
    expect(labels(view)).not.toContain('reps');
    expect(labels(view).every((label) => !label.startsWith('```'))).toBe(true);
  });
});
