import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { deleteCharBackward } from '@codemirror/commands';

const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => zeroRect });
}
import {
  acceptCompletion,
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
import { editorPreset } from './editorPreset';
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

describe('wodBackspaceCompletion', () => {
  function mountWorkoutEditor(docWithCaret: string) {
    const caret = docWithCaret.indexOf('|');
    const doc = docWithCaret.slice(0, caret) + docWithCaret.slice(caret + 1);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: caret },
        extensions: editorPreset({
          dialect: 'markdown',
          whiteboardScript: {
            efforts: () => [
              { value: 'back-squat', label: 'Back Squat' },
              { value: 'run', label: 'Run' },
            ],
            tags: () => [{ value: 'heavy' }, { value: 'hero' }],
          },
        }),
      }),
      parent: host,
    });
    return {
      view,
      cleanup: () => {
        view.destroy();
        host.remove();
      },
    };
  }

  it('re-opens unit typeahead when backspacing a unit down to a glued number', async () => {
    const { view, cleanup } = mountWorkoutEditor('```time\n10kg|\n```');
    try {
      deleteCharBackward(view); // -> 10k|
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
      expect(currentCompletions(view.state).map((c) => c.label)).toContain('kg');

      deleteCharBackward(view); // -> 10|
      await vi.waitFor(() => {
        expect(completionStatus(view.state)).toBe('active');
        const labels = currentCompletions(view.state).map((c) => c.label);
        expect(labels).toContain('reps');
        expect(labels).toContain('rounds');
        expect(labels).toContain('kg');
        expect(labels).toContain('m');
      });
    } finally {
      cleanup();
    }
  });

  it('re-opens units across spaced unit deletion, @quantity, and pre-effort unit deletion', async () => {
    const spaced = mountWorkoutEditor('```time\n10 kg|\n```');
    try {
      deleteCharBackward(spaced.view); // -> 10 k|
      await vi.waitFor(() => expect(completionStatus(spaced.view.state)).toBe('active'));
      expect(currentCompletions(spaced.view.state).map((c) => c.label)).toContain('kg');

      deleteCharBackward(spaced.view); // -> 10 |
      await vi.waitFor(() => expect(completionStatus(spaced.view.state)).toBe('active'));
      expect(currentCompletions(spaced.view.state).map((c) => c.label)).toContain('Back Squat');

      deleteCharBackward(spaced.view); // -> 10|
      await vi.waitFor(() => {
        expect(completionStatus(spaced.view.state)).toBe('active');
        expect(currentCompletions(spaced.view.state).map((c) => c.label)).toEqual(
          expect.arrayContaining(['reps', 'rounds', 'kg']),
        );
      });
    } finally {
      spaced.cleanup();
    }

    const atMass = mountWorkoutEditor('```time\n@100kg|\n```');
    try {
      deleteCharBackward(atMass.view); // -> @100k|
      deleteCharBackward(atMass.view); // -> @100|
      await vi.waitFor(() => {
        expect(completionStatus(atMass.view.state)).toBe('active');
        const labels = currentCompletions(atMass.view.state).map((c) => c.label);
        expect(labels).toContain('kg');
        expect(labels).not.toContain('m');
      });
    } finally {
      atMass.cleanup();
    }

    const preEffort = mountWorkoutEditor('```time\n100m| Run\n```');
    try {
      deleteCharBackward(preEffort.view); // -> 100| Run
      await vi.waitFor(() => {
        expect(completionStatus(preEffort.view.state)).toBe('active');
        expect(currentCompletions(preEffort.view.state).map((c) => c.label)).toEqual(
          expect.arrayContaining(['m', 'reps', 'rounds']),
        );
      });
    } finally {
      preEffort.cleanup();
    }
  });

  it('re-opens effort completion from the beginning of the effort when deleting letters', async () => {
    const { view, cleanup } = mountWorkoutEditor('```time\n10 Back Squat|\n```');
    try {
      deleteCharBackward(view); // -> 10 Back Squa|
      await vi.waitFor(() => {
        expect(completionStatus(view.state)).toBe('active');
        expect(currentCompletions(view.state).map((c) => c.label)).toContain('Back Squat');
      });
      const idx = currentCompletions(view.state).findIndex((c) => c.label === 'Back Squat');
      view.dispatch({ effects: setSelectedCompletion(idx) });
      acceptCompletion(view);
      expect(view.state.doc.toString()).toBe('```time\n10 Back Squat\n```');
    } finally {
      cleanup();
    }
  });

  it('re-opens tag completion when deleting letters of a tag or backspacing onto the end of a tag', async () => {
    const editingTag = mountWorkoutEditor('```time\n10 Back Squat #heavy|\n```');
    try {
      deleteCharBackward(editingTag.view); // -> #heav|
      await vi.waitFor(() => {
        expect(completionStatus(editingTag.view.state)).toBe('active');
        expect(currentCompletions(editingTag.view.state).map((c) => c.label)).toContain('heavy');
      });
      for (let i = 0; i < 4; i++) deleteCharBackward(editingTag.view); // -> #|
      await vi.waitFor(() => {
        expect(completionStatus(editingTag.view.state)).toBe('active');
        expect(currentCompletions(editingTag.view.state).map((c) => c.label)).toEqual(
          expect.arrayContaining(['heavy', 'hero']),
        );
      });
    } finally {
      editingTag.cleanup();
    }

    const landingAtEnd = mountWorkoutEditor('```time\n10 Back Squat #heavy |\n```');
    try {
      deleteCharBackward(landingAtEnd.view); // -> #heavy|
      await vi.waitFor(() => {
        expect(completionStatus(landingAtEnd.view.state)).toBe('active');
        expect(currentCompletions(landingAtEnd.view.state).map((c) => c.label)).toContain('heavy');
      });
    } finally {
      landingAtEnd.cleanup();
    }
  });

  it('stays quiet on empty lines, line joins, comments, headings, and plain Markdown prose', async () => {
    for (const sample of [
      '```time\n1|\n```',
      '```time\n10\n|5\n```',
      '```time\n// note|\n```',
      '```time\n# Title|\n```',
      'Hello world|\n',
    ]) {
      const { view, cleanup } = mountWorkoutEditor(sample);
      try {
        deleteCharBackward(view);
        await new Promise((r) => setTimeout(r, 40));
        expect(completionStatus(view.state), sample).toBeNull();
      } finally {
        cleanup();
      }
    }
  });
});
