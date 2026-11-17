import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host';

let host: PlaygroundHostHandle;

beforeEach(async () => {
  host = await setupPlaygroundTestHost();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await host.cleanup();
});

function mountEditor(
  doc: string,
  options: {
    readonly?: boolean;
    enablePreview?: boolean;
    enableLinting?: boolean;
    onChange?: (next: string) => void;
  } = {},
) {
  let createdView: EditorView | undefined;
  const onChange = options.onChange ?? (() => {});
  render(
    <NoteEditor
      value={doc}
      onChange={onChange}
      readonly={options.readonly ?? false}
      enablePreview={options.enablePreview ?? true}
      enableLinting={options.enableLinting ?? true}
      onViewCreated={(view) => {
        createdView = view;
      }}
    />,
  );
  if (!createdView) throw new Error('NoteEditor did not expose EditorView');
  return createdView;
}

describe('NoteEditor editing, WOD fence resilience, and cursor navigation (Tier 2a)', () => {
  it('accepts typing and Enter inside wod/time code fences without CM6 TreeBuffer errors', () => {
    const content = '# Repro\n\n```time\nTimer: 1:00\n```\n';
    const consoleErrors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
      origError(...args);
    };

    try {
      const view = mountEditor(content);
      const pos = content.indexOf('Timer: 1:00') + 'Timer'.length;
      act(() => {
        view.dispatch({ selection: { anchor: pos } });
        view.focus();
      });

      const beforeHead = view.state.selection.main.head;
      expect(view.state.doc.toString()).toBe(content);

      // Type 'X', insert newline, type 'Y' inside the ```time fence
      act(() => {
        view.dispatch({
          changes: { from: beforeHead, to: beforeHead, insert: 'X' },
          selection: { anchor: beforeHead + 1 },
          userEvent: 'input.type',
        });
      });
      const afterXHead = view.state.selection.main.head;
      act(() => {
        view.dispatch({
          changes: { from: afterXHead, to: afterXHead, insert: '\nY' },
          selection: { anchor: afterXHead + 2 },
          userEvent: 'input.type',
        });
      });

      expect(view.state.doc.toString()).toContain('TimerX\nY: 1:00');
      expect(view.state.selection.main.head).toBeGreaterThan(beforeHead);
      expect(
        consoleErrors.filter((e) =>
          /hasChild|TreeBuffer|CodeMirror plugin crashed|Cannot read properties of undefined/i.test(e),
        ),
      ).toEqual([]);
    } finally {
      console.error = origError;
    }
  });

  it('tolerates unclosed wod fences without crashing', () => {
    const doc = '# Unclosed\n\n```time\n5 Burpees';
    const view = mountEditor(doc);
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true');
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('surfaces lint diagnostics on syntactically broken wod blocks and tolerates invalid timer values', async () => {
    const brokenDoc = '# Bad\n\n```time\n(2\n  5 Burpees\n```\n';
    const { container, unmount } = render(
      <NoteEditor value={brokenDoc} onChange={() => {}} enableLinting enablePreview />,
    );
    await waitFor(
      () => {
        const gutterErr = container.querySelector('.cm-unified-gutter-marker.cm-gutter-error');
        const lintDiag = container.querySelector('.cm-lintPoint-error, .cm-lintRange-error');
        expect(gutterErr || lintDiag).toBeTruthy();
      },
      { timeout: 3000 },
    );
    unmount();

    // Bad timer value is tolerated (dropped) rather than crashing or hiding Run
    const badTimerDoc = '# Bad timer\n\n```time\nTimer: banana\n5 Burpees\n```\n';
    render(<NoteEditor value={badTimerDoc} onChange={() => {}} enableLinting enablePreview />);
    expect(await screen.findByRole('button', { name: 'Run' })).toBeTruthy();
  });

  it('self-focuses when transitioning editable, treats Home on empty line as no-op, and clears stale state on doc replacement', async () => {
    const lines = [
      '---',
      'title: Nav Regression',
      '---',
      '',
      '# Navigation regression',
      '',
      'Body line.',
      '',
      '```time',
      'Timer: 1:00',
      '10 Burpees',
      '',
      '10 Push Ups',
      '```',
    ];
    const content = lines.join('\n');
    const lineStart = (idx: number) => lines.slice(0, idx).reduce((sum, l) => sum + l.length + 1, 0);

    let viewRef: EditorView | undefined;
    const { rerender } = render(
      <NoteEditor
        value={content}
        onChange={() => {}}
        readonly
        enablePreview
        onViewCreated={(v) => {
          viewRef = v;
        }}
      />,
    );
    if (!viewRef) throw new Error('Expected EditorView');

    // Transition readonly -> editable triggers self-focus on .cm-content
    rerender(
      <NoteEditor
        value={content}
        onChange={() => {}}
        readonly={false}
        enablePreview
        onViewCreated={(v) => {
          viewRef = v;
        }}
      />,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(viewRef!.contentDOM);
    });

    // Home on empty line is a no-op
    act(() => {
      viewRef!.dispatch({ selection: { anchor: lineStart(11) } });
      fireEvent.keyDown(viewRef!.contentDOM, { key: 'Home', code: 'Home' });
    });
    expect(viewRef.state.selection.main.head).toBe(lineStart(11));

    // Replacing doc clears stale frontmatter draft state
    act(() => {
      viewRef!.dispatch({ selection: { anchor: content.length } });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add property' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    const keyInput = screen.getByLabelText('Property key: property') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'stale_draft' } });

    act(() => {
      viewRef!.dispatch({
        changes: { from: 0, to: viewRef!.state.doc.length, insert: content },
        selection: { anchor: content.length },
      });
    });
    expect(viewRef.state.doc.toString()).toBe(content);
    expect(screen.queryByDisplayValue('stale_draft')).toBeNull();
    expect(screen.queryByLabelText('Property key: property')).toBeNull();
  });
});
