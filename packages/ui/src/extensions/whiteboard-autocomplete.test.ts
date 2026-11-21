import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';

const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => zeroRect });
}
import {
  CompletionContext,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import {
  SLASH_COMMANDS,
  nestedCompletion,
  nestedCompletionOptions,
  wodAutocompletion,
  wodCompletionKeymap,
} from './whiteboard-autocomplete';
import { sectionField } from './section-state';
import { editingQuerySectionsField, setQuerySourceEditing } from './query-block-preview';

describe('SLASH_COMMANDS', () => {
  it('assigns distinct, non-empty detail descriptions to every slash command', () => {
    const details = SLASH_COMMANDS.map((c) => c.detail);
    expect(details.every((d) => typeof d === 'string' && d.trim().length > 0)).toBe(true);
    expect(new Set(details).size).toBe(SLASH_COMMANDS.length);
  });

  it('distinguishes /time from /wod and demotes /wod below canonical workout blocks', () => {
    const timeCmd = SLASH_COMMANDS.find((c) => c.label === '/time');
    const logCmd = SLASH_COMMANDS.find((c) => c.label === '/log');
    const queryCmd = SLASH_COMMANDS.find((c) => c.label === '/query');
    const wodCmd = SLASH_COMMANDS.find((c) => c.label === '/wod');
    expect(timeCmd).toBeDefined();
    expect(wodCmd).toBeDefined();
    expect(timeCmd?.detail).not.toBe(wodCmd?.detail);
    expect(wodCmd?.boost ?? 0).toBeLessThan(timeCmd?.boost ?? 0);
    expect(wodCmd?.boost ?? 0).toBeLessThan(logCmd?.boost ?? 0);
    expect(wodCmd?.boost ?? 0).toBeLessThan(queryCmd?.boost ?? 0);
  });

  it('uses canonical syntax in /query and /log slash command templates', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const applyCmd = (label: string) => {
      const cmd = SLASH_COMMANDS.find((c) => c.label === label)!;
      const view = new EditorView({
        state: EditorState.create({ doc: label }),
        parent: host,
      });
      if (typeof cmd.apply === 'function') {
        cmd.apply(view, cmd, 0, label.length);
      } else {
        view.dispatch({ changes: { from: 0, to: label.length, insert: cmd.apply ?? cmd.label } });
      }
      const doc = view.state.doc.toString();
      view.destroy();
      return doc;
    };

    try {
      expect(applyCmd('/query')).toContain(':sum{metric:reps} by {week} last 4w | :bar{}');
      expect(applyCmd('/log')).toContain('@100kg');
    } finally {
      host.remove();
    }
  });
});

describe('nestedCompletion & wodCompletionKeymap', () => {
  it('suppresses WQL completion in collapsed ```query blocks and restores when source editing', async () => {
    const doc = '```query\n:sum{metric:re\n```';
    const pos = doc.indexOf(':re') + 3;
    const base = EditorState.create({
      doc,
      selection: { anchor: pos },
      extensions: [sectionField, editingQuerySectionsField, nestedCompletionOptions.of({})],
    });
    const sec = base.field(sectionField).sections.find((s) => s.type === 'query')!;
    expect(sec).toBeDefined();

    const suppressed = await nestedCompletion(new CompletionContext(base, pos, true));
    expect(suppressed).toBeNull();

    const editingState = base.update({
      effects: setQuerySourceEditing.of({ sectionId: sec.id, editing: true }),
    }).state;
    const enabled = await nestedCompletion(new CompletionContext(editingState, pos, true));
    expect(enabled).not.toBeNull();
    expect(enabled!.options.map((o) => o.label)).toContain('reps');
  });

  it('leaves selectOnOpen=false, accepts top item on Tab, and preserves Enter newline unless explicitly selected', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: '/ti',
        selection: { anchor: 3 },
        extensions: [sectionField, wodCompletionKeymap, wodAutocompletion],
      }),
      parent: host,
    });

    try {
      startCompletion(view);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
      expect(selectedCompletionIndex(view.state)).toBeNull();

      // Enter without arrow selection closes completion and returns false for newline insertion.
      const enterHandled = runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        'editor',
      );
      expect(enterHandled).toBe(false);
      expect(completionStatus(view.state)).toBeNull();
      expect(view.state.doc.toString()).toBe('/ti');

      // Re-open: Tab commits top candidate even with no highlighted row.
      startCompletion(view);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
      expect(currentCompletions(view.state).length).toBeGreaterThan(0);
      expect(selectedCompletionIndex(view.state)).toBeNull();
      const tabHandled = runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        'editor',
      );
      expect(tabHandled).toBe(true);
      expect(view.state.doc.toString()).toContain('```time');

      // Re-open, arrow-select explicit row, and confirm Enter accepts it.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '/lo' }, selection: { anchor: 3 } });
      startCompletion(view);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
      const logIdx = currentCompletions(view.state).findIndex((c) => c.label === '/log');
      expect(logIdx).toBeGreaterThanOrEqual(0);
      view.dispatch({ effects: setSelectedCompletion(logIdx) });
      const enterSelectedHandled = runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        'editor',
      );
      expect(enterSelectedHandled).toBe(true);
      expect(view.state.doc.toString()).toContain('```log');
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
