/**
 * CalcLineEditor (#880) — a single CodeMirror 6 field for calc-line
 * authoring with syntax highlighting + contextual typeahead. Lightweight,
 * controlled (`value`/`onChange`), scope-aware.
 */

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { CalcScope } from '@bitcobblers/wod-wiki-engine';
import { autocompleteTooltipTheme } from '@bitcobblers/wod-wiki-ui/extensions';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { calcLineSupport } from './calcLineLanguage';
import { calcCompletion } from './calcCompletion';

export interface CalcLineEditorProps {
  value: string;
  onChange: (value: string) => void;
  scope?: CalcScope;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function CalcLineEditor({
  value,
  onChange,
  scope = 'segment',
  placeholder,
  readOnly = false,
  autoFocus = false,
  className,
}: CalcLineEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    viewRef.current?.destroy();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString());
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          calcLineSupport(),
          calcCompletion({
            scope,
            // Live effort keys from the app effort registry (bundled + user
            // tiers); falls back to the static sample list until hydration.
            effortKeys: () => getAppEffortRegistry().list().map((effort) => effort.slug),
          }),
          autocompleteTooltipTheme,
          lineNumbers(),
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          updateListener,
          EditorView.theme({
            '&': { height: 'auto', minHeight: '120px', fontSize: '13px', border: '1px solid rgb(63 63 70)', borderRadius: '8px' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.55' },
            '.cm-content': { padding: '8px 4px' },
            '.cm-gutters': { borderRight: '1px solid rgb(63 63 70)', minWidth: '28px' },
            '&.cm-focused': { outline: '2px solid rgb(139 92 246 / 0.5)', outlineOffset: '1px' },
          }),
        ],
      }),
      parent: host,
    });
    if (autoFocus) {
      requestAnimationFrame(() => view.focus());
    }
    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, readOnly]);

  // Sync external value changes (e.g. picking a saved calc) without recreating.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: value },
      });
    }
  }, [value]);

  void placeholder;
  return <div ref={hostRef} className={`calc-line-editor ${className ?? ''}`} data-testid="calc-line-editor" />;
}
