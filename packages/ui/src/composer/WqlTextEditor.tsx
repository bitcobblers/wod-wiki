import { createElement, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartNoAxesCombined, ListFilter, Search, Tag } from 'lucide-react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, Decoration, type KeyBinding, type DecorationSet } from '@codemirror/view';
import { cursorDocEnd, cursorDocStart, cursorPageDown, cursorPageUp, history, historyKeymap } from '@codemirror/commands';
import {
  acceptCompletion, autocompletion, closeCompletion, completionStatus, currentCompletions, moveCompletionSelection,
  setSelectedCompletion, startCompletion,
} from '@codemirror/autocomplete';
import { syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import { parseQuery, isPipelineQuery, supportsWqlFilterKey, wqlCompletionSource, wqlHighlightStyle, wqlLanguage } from '@bitcobblers/wod-wiki-wql';
import { autocompleteTooltipTheme } from '../extensions/autocomplete-theme';
import { loadSuggestions } from './suggestionSources';
import type { QueryClause } from './queryClauses';

const completionIcons = {
  search: renderToStaticMarkup(createElement(Search, { size: 16 })),
  metric: renderToStaticMarkup(createElement(ChartNoAxesCombined, { size: 16 })),
  filter: renderToStaticMarkup(createElement(ListFilter, { size: 16 })),
  value: renderToStaticMarkup(createElement(Tag, { size: 16 })),
};

/** Slot starts Tab/Shift-Tab hops between: head, each filter key, each filter
 *  value, grouping dimensions and suffix nodes (rollup). */
const SLOT_NODES: Record<string, true> = { Head: true, Filter: true, TagValue: true, Rollup: true };
export interface WqlSlotActivation {
  node: 'Head' | 'Filter' | 'GroupBy' | 'Rollup';
  filterIndex?: number;
  from: number;
  to: number;
  text: string;
}
const activeSegmentEffect = StateEffect.define<{ from: number; to: number } | null>();
const activeSegmentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    const mapped = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(activeSegmentEffect)) continue;
      const range = effect.value;
      if (!range || range.from >= range.to) return Decoration.none;
      return Decoration.set([Decoration.mark({ class: 'wql-active-segment' }).range(range.from, range.to)]);
    }
    return mapped;
  },
  provide: field => EditorView.decorations.from(field),
});
function findClauseRange(state: EditorState, clause: QueryClause | undefined): { from: number; to: number } | undefined {
  if (!clause) return undefined;
  let range: { from: number; to: number } | undefined;
  const tree = syntaxTree(state);
  if (clause.filterIndex !== undefined) {
    let index = 0;
    tree.iterate({
      enter: node => {
        if (node.name === 'Filter') {
          if (index === clause.filterIndex) {
            range = { from: node.from, to: node.to };
            return false;
          }
          index++;
        }
        return true;
      },
    });
    return range;
  }
  if (['kind', 'target', 'agg', 'metric'].includes(clause.type)) {
    tree.iterate({
      enter: node => {
        if (node.name === 'Head') {
          range = { from: node.from, to: node.to };
          return false;
        }
        return true;
      },
    });
    return range;
  }
  if (clause.type === 'groupby') {
    tree.iterate({
      enter: node => {
        if (node.name === 'GroupBy') {
          range = { from: node.from, to: node.to };
          return false;
        }
        return true;
      },
    });
    return range;
  }
  if (clause.type === 'rollup') {
    tree.iterate({
      enter: node => {
        if (node.name === 'Rollup') {
          range = { from: node.from, to: node.to };
          return false;
        }
        return true;
      },
    });
    return range;
  }
  if (clause.type === 'time') {
    const doc = state.doc.toString();
    const match = /\b(last\s+\d+[dw]|from\s+\S+(?:\s+to\s+\S+)?)/i.exec(doc);
    if (match) return { from: match.index, to: match.index + match[0].length };
  }
  return undefined;
}

function slotPositions(state: EditorState): number[] {
  const slots: number[] = [];
  syntaxTree(state).iterate({
    enter: node => {
      if (SLOT_NODES[node.name]) slots.push(node.from);
      else if (node.name === 'Word' && ['GroupBy', 'Dimension'].includes(node.node.parent?.name ?? '')) slots.push(node.from);
      return true;
    },
  });
  return slots.sort((a, b) => a - b);
}
function activateSlot(view: EditorView, position: number, onActivate?: (slot: WqlSlotActivation) => void): void {
  if (!onActivate) return;
  let node = syntaxTree(view.state).resolveInner(position, 1);
  while (node.parent && !['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name)) node = node.parent;
  if (!['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name)) return;
  let filterIndex: number | undefined;
  if (node.name === 'Filter') {
    filterIndex = 0;
    syntaxTree(view.state).iterate({
      enter: candidate => {
        if (candidate.name === 'Filter') {
          if (candidate.from === node.from) return false;
          if (candidate.from < node.from) filterIndex! += 1;
        }
        return true;
      },
    });
  }
  let text = view.state.sliceDoc(node.from, node.to);
  if (node.name === 'Head') {
    const line = view.state.doc.lineAt(position);
    const word = Array.from(line.text.matchAll(/[\w.*-]+/g)).find(match => line.from + match.index! <= position && position <= line.from + match.index! + match[0].length);
    if (word) text = word[0];
  }
  onActivate({ node: node.name as WqlSlotActivation['node'], filterIndex, from: node.from, to: node.to, text });
}

function advanceSlot(view: EditorView, dir: 1 | -1, onActivate?: (slot: WqlSlotActivation) => void): boolean {
  const head = view.state.selection.main.head;
  const slots = slotPositions(view.state);
  const next = dir > 0 ? slots.find(slot => slot > head) : [...slots].reverse().find(slot => slot < head);
  if (next === undefined) return false;
  view.dispatch({ selection: { anchor: next }, scrollIntoView: true });
  activateSlot(view, next, onActivate);
  return true;
}

/** Parse-error and ignored-filter squiggles. Errors sit on the Lezer error
 *  nodes (whole query as fallback); warnings sit on the exact filter text the
 *  target's capability table rejects — unsupported key or operator alike. */
export function wqlLint(view: EditorView): Diagnostic[] {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return [];
  const ast = parseQuery(doc);
  if (ast.error) {
    const spans: { from: number; to: number }[] = [];
    syntaxTree(view.state).iterate({
      enter: node => {
        if (node.type.isError) spans.push({ from: node.from, to: node.to });
        return true;
      },
    });
    return (spans.length ? spans : [{ from: 0, to: doc.length }]).map(span => {
      const to = Math.min(Math.max(span.to, span.from + 1), doc.length);
      return { from: Math.min(span.from, to - 1), to, severity: 'error' as const, message: ast.error! };
    });
  }
  // Pipeline stages own their filters; top-level capability warnings don't apply.
  if (isPipelineQuery(ast)) return [];
  const filters: { from: number; to: number; text: string }[] = [];
  syntaxTree(view.state).iterate({
    enter: node => {
      if (node.name === 'Filter') filters.push({ from: node.from, to: node.to, text: doc.slice(node.from, node.to) });
      return true;
    },
  });
  if (filters.length !== ast.filters.length) return [];
  const where = ast.family === 'find' ? ast.target : 'this query';
  const out: Diagnostic[] = [];
  ast.filters.forEach((filter, index) => {
    if (supportsWqlFilterKey(ast.family === 'find' ? ast.target : '', ast.family, filter.key)) return;
    const node = filters[index]!;
    out.push({
      from: node.from,
      to: node.to,
      severity: 'warning',
      message: /^[^\s:]+\s*[<>=~]/.test(node.text)
        ? `Operators on "${filter.key}" are ignored for ${where}`
        : `Filter "${filter.key}" is ignored for ${where}`,
    });
  });
  return out;
}

/** Key bindings shared with the regression tests: completion-first navigation
 *  (wrapping via moveCompletionSelection, page via `by: 'page'` clamps, Home/
 *  End select first/last row), Tab accepts-then-hops the next syntactic slot
 *  and Shift-Tab the previous, Enter accepts or closes-and-submits, Escape
 *  closes then blurs. Snippet fields keep their own higher-precedence
 *  Tab/Shift-Tab bindings. While an IME composition is active
 *  (`view.compositionStarted`, true from compositionstart to compositionend)
 *  every binding bows out; ArrowLeft/Right stay native cursor motion. */
export function wqlEditorKeymap(onSubmit: () => void, onEscape: () => boolean, onSlotActivate?: (slot: WqlSlotActivation) => void): KeyBinding[] {
  return [
    { key: 'Mod-Enter', run: () => { onSubmit(); return true; } },
    { key: 'Ctrl-Space', run: startCompletion },
    { key: 'ArrowDown', run: view => completionStatus(view.state) === 'active' && moveCompletionSelection(true)(view) },
    { key: 'ArrowUp', run: view => completionStatus(view.state) === 'active' && moveCompletionSelection(false)(view) },
    { key: 'PageUp', run: view => completionStatus(view.state) === 'active' ? moveCompletionSelection(false, 'page')(view) : cursorPageUp(view) },
    { key: 'PageDown', run: view => completionStatus(view.state) === 'active' ? moveCompletionSelection(true, 'page')(view) : cursorPageDown(view) },
    {
      key: 'Home',
      run: view => completionStatus(view.state) === 'active'
        ? (view.dispatch({ effects: setSelectedCompletion(0) }), true)
        : cursorDocStart(view),
    },
    {
      key: 'End',
      run: view => completionStatus(view.state) === 'active'
        ? (view.dispatch({ effects: setSelectedCompletion(currentCompletions(view.state).length - 1) }), true)
        : cursorDocEnd(view),
    },
    {
      key: 'Tab',
      run: view => {
        if (view.compositionStarted) return false;
        const accepted = acceptCompletion(view);
        return advanceSlot(view, 1, onSlotActivate) || accepted;
      },
    },
    {
      key: 'Shift-Tab',
      run: view => {
        if (view.compositionStarted) return false;
        const accepted = acceptCompletion(view);
        return advanceSlot(view, -1, onSlotActivate) || accepted;
      },
    },
    {
      key: 'Enter',
      run: view => {
        if (view.compositionStarted) return false;
        if (acceptCompletion(view)) return true;
        closeCompletion(view);
        onSubmit();
        return true;
      },
    },
    // First Escape closes the popup; the second blurs back to the host
    // (onEscape) or the editor itself — never two levels at once.
    { key: 'Escape', run: view => view.compositionStarted || (closeCompletion(view) || onEscape() || (view.contentDOM.blur(), true)) },
    ...historyKeymap,
  ];
}

export function WqlTextEditor({ value, onChange, onSubmit, onEscape, placeholder, autoFocus = false, dense = false, onSlotActivate, activeRange, activeClause }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onEscape: () => boolean;
  /** Shown while the draft is empty. */
  placeholder?: string;
  autoFocus?: boolean;
  /** Compact single-line height (~36px) for inline toolbars (the stream
   *  sticky header); the default is the roomy 48px form height. */
  dense?: boolean;
  onSlotActivate?: (slot: WqlSlotActivation) => void;
  activeRange?: { from: number; to: number };
  activeClause?: QueryClause;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const callbacks = useRef({ onChange, onSubmit, onEscape, onSlotActivate });
  callbacks.current = { onChange, onSubmit, onEscape, onSlotActivate };
  const replacing = useRef(false);
  const initialValue = useRef(value);

  useEffect(() => {
    if (!host.current) return;
    const source = wqlCompletionSource({
      values: async key => (await loadSuggestions(key === 'tags' ? 'tag' : key)).map(item => ({ label: item.value, detail: item.label, type: 'constant' })),
    });
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          wqlLanguage, syntaxHighlighting(wqlHighlightStyle), history(), EditorView.lineWrapping,
          activeSegmentField,
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          EditorView.contentAttributes.of({ 'aria-label': 'WQL', 'data-testid': 'wql-text-input' }),
          autocompletion({
            defaultKeymap: false, selectOnOpen: false,
            // Keyboard nav/accept must never wait out the pointer-intent delay.
            interactionDelay: 0,
            override: [source],
            icons: false,
            addToOptions: [{ position: 20, render: completion => {
              const icon = document.createElement('span');
              icon.className = 'wql-completion-icon';
              icon.setAttribute('aria-hidden', 'true');
              icon.innerHTML = completion.label === 'find' ? completionIcons.search
                : completion.type === 'keyword' || completion.type === 'variable' ? completionIcons.metric
                : completion.type === 'property' ? completionIcons.filter : completionIcons.value;
              return icon;
            } }],
          }),
          linter(wqlLint),
          keymap.of(wqlEditorKeymap(
            () => callbacks.current.onSubmit(),
            () => callbacks.current.onEscape(),
            slot => callbacks.current.onSlotActivate?.(slot),
          )),
          EditorView.domEventHandlers({
            // Host composers open the contextual writer; standalone editors
            // retain token selection and in-row completion.
            mouseup: (event, editor) => {
              if (event.button !== 0) return false;
              let { from, to } = editor.state.selection.main;
              if (from === to) {
                const line = editor.state.doc.lineAt(from);
                const word = Array.from(line.text.matchAll(/[\w.*-]+/g)).find(m => line.from + m.index! <= from && from <= line.from + m.index! + m[0].length);
                if (!word) return false;
                from = line.from + word.index!;
                to = from + word[0].length;
                let node = syntaxTree(editor.state).resolveInner(to, -1);
                while (node.parent && !['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name)) node = node.parent;
                if (!['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name)) return false;
                editor.dispatch({ selection: { anchor: from, head: to } });
              }
              if (callbacks.current.onSlotActivate) activateSlot(editor, from, slot => callbacks.current.onSlotActivate?.(slot));
              else startCompletion(editor);
              return false;
            },
            keydown: (event, editor) => {
              // IME safety: while composing (or once a composition has started
              // and not yet ended) swallow every key this editor owns so no
              // accept/close/navigation fires mid-composition.
              if (event.isComposing || editor.compositionStarted) return true;
              if (event.key === 'Enter' || event.key === 'Escape' || (['ArrowDown', 'ArrowUp'].includes(event.key) && completionStatus(editor.state) === 'active')) event.stopPropagation();
              return false;
            },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !replacing.current) callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { width: '100%', fontSize: '14px', backgroundColor: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', padding: dense ? '8px 0' : '12px 0', minHeight: dense ? '34px' : '48px' },
            '.cm-line': { padding: '0 12px' },
            '.cm-line span[class*="tok-"]:hover, .cm-line span[class^="tok-"]:hover': { fontWeight: '700', textShadow: '0 0 0.5px currentColor', cursor: 'pointer' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-placeholder': { color: 'hsl(var(--muted-foreground))' },
            '.wql-completion-icon': { display: 'inline-flex', flexShrink: '0', color: 'hsl(var(--primary))' },
            '.wql-active-segment': { backgroundColor: 'hsl(var(--primary) / 0.16)', boxShadow: 'inset 0 -2px hsl(var(--primary))', borderRadius: '3px' },
          }),
          autocompleteTooltipTheme,
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => { editor.destroy(); view.current = undefined; };
  }, [autoFocus, placeholder, dense]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    replacing.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    replacing.current = false;
  }, [value]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const resolvedRange = activeRange ?? findClauseRange(editor.state, activeClause);
    editor.dispatch({ effects: activeSegmentEffect.of(resolvedRange ?? null) });
  }, [activeRange, activeClause, value]);

  return <div ref={host} className="min-w-0 w-full rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-ring" data-testid="wql-text-editor" />;
}
