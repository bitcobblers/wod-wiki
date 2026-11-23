import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  autocompletion,
  completionStatus,
  currentCompletions,
  setSelectedCompletion,
  startCompletion,
} from '@codemirror/autocomplete';

const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => zeroRect });
}

import {
  editorPreset,
  wodCompletionKeymap,
  wodIndentKeymap,
} from '../index';
import { sectionField } from './section-state';

const hosts: HTMLElement[] = [];

function createPresetView(
  docWithCaret: string,
  dialect: 'markdown' | 'wod' = 'markdown',
  extraExtensions: import('@codemirror/state').Extension[] = [],
) {
  const caret = docWithCaret.indexOf('|');
  const doc = caret >= 0 ? docWithCaret.slice(0, caret) + docWithCaret.slice(caret + 1) : docWithCaret;
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: caret >= 0 ? caret : doc.length },
      extensions: [
        ...editorPreset({
          dialect,
          whiteboardScript: {
            efforts: () => [{ value: 'Back Squat', label: 'Back Squat' }],
          },
        }),
        ...extraExtensions,
      ],
    }),
    parent: host,
  });
  return view;
}

function pressKey(view: EditorView, key: string, opts: { shiftKey?: boolean } = {}) {
  return runScopeHandlers(
    view,
    new KeyboardEvent('keydown', { key, shiftKey: Boolean(opts.shiftKey), bubbles: true, cancelable: true }),
    'editor',
  );
}

function docWithCaret(view: EditorView): string {
  const doc = view.state.doc.toString();
  const pos = view.state.selection.main.head;
  return doc.slice(0, pos) + '|' + doc.slice(pos);
}

afterEach(() => {
  while (hosts.length) hosts.pop()?.remove();
});

describe('wodIndentKeymap', () => {
  it('auto-indents after rounds headers, preserves indent, and resets to col 0 on double-Enter inside ```time fences', () => {
    const view = createPresetView('```time\n(3)|\n```');
    try {
      expect(pressKey(view, 'Enter')).toBe(true);
      expect(docWithCaret(view)).toBe('```time\n(3)\n  |\n```');

      view.dispatch({ changes: { from: view.state.selection.main.head, insert: '10 Pull-ups' }, selection: { anchor: view.state.selection.main.head + 11 } });
      expect(pressKey(view, 'Enter')).toBe(true);
      expect(docWithCaret(view)).toBe('```time\n(3)\n  10 Pull-ups\n  |\n```');

      // Double-Enter on blank indented line resets cursor to col 0 without trailing spaces.
      expect(pressKey(view, 'Enter')).toBe(true);
      expect(docWithCaret(view)).toBe('```time\n(3)\n  10 Pull-ups\n\n|\n```');
    } finally {
      view.destroy();
    }
  });

  it('auto-continues + and - markers and exits cleanly on double-Enter inside ```log and standalone wod dialect', () => {
    for (const dialect of ['markdown', 'wod'] as const) {
      const initial = dialect === 'markdown' ? '```log\n  + 5 Burpees|\n```' : '  + 5 Burpees|';
      const view = createPresetView(initial, dialect);
      try {
        expect(pressKey(view, 'Enter')).toBe(true);
        expect(docWithCaret(view)).toBe(
          dialect === 'markdown' ? '```log\n  + 5 Burpees\n  + |\n```' : '  + 5 Burpees\n  + |',
        );

        expect(pressKey(view, 'Enter')).toBe(true);
        expect(docWithCaret(view)).toBe(
          dialect === 'markdown' ? '```log\n  + 5 Burpees\n\n|\n```' : '  + 5 Burpees\n\n|',
        );

        view.dispatch({
          changes: { from: view.state.selection.main.head, insert: '- 10 Air Squats' },
          selection: { anchor: view.state.selection.main.head + 15 },
        });
        expect(pressKey(view, 'Enter')).toBe(true);
        expect(docWithCaret(view)).toBe(
          dialect === 'markdown'
            ? '```log\n  + 5 Burpees\n\n- 10 Air Squats\n- |\n```'
            : '  + 5 Burpees\n\n- 10 Air Squats\n- |',
        );
        expect(pressKey(view, 'Enter')).toBe(true);
        expect(docWithCaret(view)).toBe(
          dialect === 'markdown'
            ? '```log\n  + 5 Burpees\n\n- 10 Air Squats\n\n|\n```'
            : '  + 5 Burpees\n\n- 10 Air Squats\n\n|',
        );
      } finally {
        view.destroy();
      }
    }
  });

  it('supports Tab and Shift-Tab indentation alongside marker and line indent', () => {
    const view = createPresetView('```time\n  |\n```');
    try {
      pressKey(view, 'Tab');
      expect(docWithCaret(view)).toBe('```time\n    |\n```');
      pressKey(view, 'Tab', { shiftKey: true });
      expect(docWithCaret(view)).toBe('```time\n  |\n```');
      pressKey(view, 'Tab', { shiftKey: true });
      expect(docWithCaret(view)).toBe('```time\n|\n```');

      view.dispatch({
        changes: { from: view.state.selection.main.head, insert: '  + ' },
        selection: { anchor: view.state.selection.main.head + 4 },
      });
      pressKey(view, 'Tab');
      expect(docWithCaret(view)).toBe('```time\n    + |\n```');
    } finally {
      view.destroy();
    }
  });

  it('does not hijack Markdown prose lists, query blocks, or opening/closing fence lines', () => {
    const prose = createPresetView('- item|');
    try {
      pressKey(prose, 'Enter');
      expect(docWithCaret(prose)).toBe('- item\n- |');
    } finally {
      prose.destroy();
    }

    const query = createPresetView('```query\n(3)|\n```');
    try {
      pressKey(query, 'Enter');
      // Outside time/log fence bodies, default newline handler runs untouched (no rounds auto-indent).
      expect(docWithCaret(query)).toBe('```query\n(3)\n|\n```');
    } finally {
      query.destroy();
    }

    const fenceOpen = createPresetView('```time|\n(3)\n```');
    try {
      pressKey(fenceOpen, 'Enter');
      expect(docWithCaret(fenceOpen)).toBe('```time\n|\n(3)\n```');
    } finally {
      fenceOpen.destroy();
    }

    const fenceClose = createPresetView('```time\n(3)\n```|');
    try {
      pressKey(fenceClose, 'Enter');
      expect(docWithCaret(fenceClose)).toBe('```time\n(3)\n```\n|');
    } finally {
      fenceClose.destroy();
    }
  });

  it('cooperates with wodCompletionKeymap so unselected Enter closes completion and indents while selected Enter accepts', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    const view = new EditorView({
      state: EditorState.create({
        doc: '```time\n3 rounds\n```',
        selection: { anchor: '```time\n3 rounds'.length },
        extensions: [
          sectionField,
          wodCompletionKeymap,
          wodIndentKeymap,
          autocompletion({
            selectOnOpen: false,
            interactionDelay: 0,
            override: [() => ({ from: '```time\n3 rounds'.length - 6, options: [{ label: 'rounds', type: 'unit' }] })],
          }),
        ],
      }),
      parent: host,
    });

    try {
      startCompletion(view);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
      pressKey(view, 'Enter');
      expect(completionStatus(view.state)).toBeNull();
      expect(docWithCaret(view)).toBe('```time\n3 rounds\n  |\n```');

      view.dispatch({
        changes: { from: '```time\n'.length, to: view.state.doc.length - '\n```'.length, insert: '3 r' },
        selection: { anchor: '```time\n3 r'.length },
      });
      startCompletion(view);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
      const idx = currentCompletions(view.state).findIndex((o) => o.label === 'rounds');
      view.dispatch({ effects: setSelectedCompletion(idx) });
      pressKey(view, 'Enter');
      expect(docWithCaret(view)).toBe('```time\n3 rounds|\n```');
    } finally {
      view.destroy();
    }
  });
});
