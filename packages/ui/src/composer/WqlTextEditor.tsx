import { createElement, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChartNoAxesCombined, ListFilter, Search, Tag } from 'lucide-react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, tooltips, Decoration, type KeyBinding, type DecorationSet } from '@codemirror/view';
import { cursorDocEnd, cursorDocStart, cursorPageDown, cursorPageUp, history, historyKeymap } from '@codemirror/commands';
import {
  acceptCompletion, autocompletion, closeCompletion, completionStatus, currentCompletions, moveCompletionSelection,
  setSelectedCompletion, startCompletion,
} from '@codemirror/autocomplete';
import { syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import { parseQuery, isPipelineQuery, resolveWqlCursorStage, supportsWqlFilterKey, wqlCompletionSource, wqlHighlightStyle, wqlLanguage, type WqlCursorStageInfo } from '@bitcobblers/wod-wiki-wql';
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
 *  value, grouping dimensions, rollup, and suffix windows/units. */
const SLOT_NODES: Record<string, true> = { Head: true, Filter: true, TagValue: true, Rollup: true };

export interface WqlSlotActivation {
  node: 'Head' | 'Filter' | 'GroupBy' | 'Rollup' | 'Time' | 'Unit';
  headPart?: 'agg' | 'metric' | 'target';
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

function findHeadSubRange(state: EditorState, headFrom: number, headTo: number, clauseType: string): { from: number; to: number } {
  const headText = state.sliceDoc(headFrom, headTo);
  const colonIdx = headText.indexOf(':');
  if (clauseType === 'agg' && colonIdx > 0) {
    return { from: headFrom, to: headFrom + colonIdx };
  }
  if ((clauseType === 'metric' || clauseType === 'target') && colonIdx >= 0 && colonIdx + 1 < headText.length) {
    return { from: headFrom + colonIdx + 1, to: headTo };
  }
  return { from: headFrom, to: headTo };
}

const TIME_SUFFIX_RE = /\b(last\s+\d+[dw]|from\s+\S+(?:\s+to\s+\S+)?)\b/i;
const UNIT_SUFFIX_RE = /\bin\s+([a-z0-9_%/-]+)/i;

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
          range = findHeadSubRange(state, node.from, node.to, clause.type);
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
    const match = TIME_SUFFIX_RE.exec(doc);
    if (match) return { from: match.index, to: match.index + match[0].length };
  }
  if (clause.type === 'unit') {
    const doc = state.doc.toString();
    const match = UNIT_SUFFIX_RE.exec(doc);
    if (match) return { from: match.index, to: match.index + match[0].length };
  }
  return undefined;
}

function findSuffixSlots(doc: string): { node: 'Time' | 'Unit'; from: number; to: number; text: string }[] {
  const out: { node: 'Time' | 'Unit'; from: number; to: number; text: string }[] = [];
  const timeMatch = TIME_SUFFIX_RE.exec(doc);
  if (timeMatch) {
    out.push({ node: 'Time', from: timeMatch.index, to: timeMatch.index + timeMatch[0].length, text: timeMatch[0] });
  }
  const unitMatch = UNIT_SUFFIX_RE.exec(doc);
  if (unitMatch) {
    out.push({ node: 'Unit', from: unitMatch.index, to: unitMatch.index + unitMatch[0].length, text: unitMatch[0] });
  }
  return out;
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
  for (const suffix of findSuffixSlots(state.doc.toString())) {
    if (!slots.includes(suffix.from)) slots.push(suffix.from);
  }
  return slots.sort((a, b) => a - b);
}

/** Resolve the syntactic clause slot under `position` without changing focus. */
export function resolveSlotAtPosition(state: EditorState, position: number): WqlSlotActivation | null {
  const doc = state.doc.toString();
  if (!doc.trim()) return null;

  // Check suffix clauses (Time / Unit) first if position sits directly on them.
  for (const suffix of findSuffixSlots(doc)) {
    if (position >= suffix.from && position <= suffix.to) {
      return { node: suffix.node, from: suffix.from, to: suffix.to, text: suffix.text };
    }
  }

  let node = syntaxTree(state).resolveInner(position, 1);
  if (!['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name) && position > 0) {
    let leftNode = syntaxTree(state).resolveInner(position, -1);
    while (leftNode.parent && !['Head', 'Filter', 'GroupBy', 'Rollup'].includes(leftNode.name)) leftNode = leftNode.parent;
    if (['Head', 'Filter', 'GroupBy', 'Rollup'].includes(leftNode.name)) node = leftNode;
  }
  while (node.parent && !['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name)) node = node.parent;
  if (!['Head', 'Filter', 'GroupBy', 'Rollup'].includes(node.name)) return null;

  if (node.name === 'Filter') {
    let filterIndex = 0;
    syntaxTree(state).iterate({
      enter: candidate => {
        if (candidate.name === 'Filter') {
          if (candidate.from === node.from) return false;
          if (candidate.from < node.from) filterIndex += 1;
        }
        return true;
      },
    });
    return { node: 'Filter', filterIndex, from: node.from, to: node.to, text: state.sliceDoc(node.from, node.to) };
  }

  if (node.name === 'Head') {
    const headText = state.sliceDoc(node.from, node.to);
    const colonIdx = headText.indexOf(':');
    if (colonIdx > 0) {
      const colonPos = node.from + colonIdx;
      const headPart = position <= colonPos ? 'agg' : 'metric';
      const range = findHeadSubRange(state, node.from, node.to, headPart);
      return { node: 'Head', headPart, from: range.from, to: range.to, text: state.sliceDoc(range.from, range.to) };
    }
    const range = findHeadSubRange(state, node.from, node.to, 'target');
    return { node: 'Head', headPart: 'target', from: range.from, to: range.to, text: state.sliceDoc(range.from, range.to) };
  }

  return {
    node: node.name as 'GroupBy' | 'Rollup',
    from: node.from,
    to: node.to,
    text: state.sliceDoc(node.from, node.to),
  };
}

function activateSlot(view: EditorView, position: number, onActivate?: (slot: WqlSlotActivation) => void): void {
  if (!onActivate) return;
  const slot = resolveSlotAtPosition(view.state, position);
  if (slot) onActivate(slot);
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

/** Parse-error and ignored-filter squiggles. */
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

export function wqlEditorKeymap(onSubmit: () => void, onEscape: () => boolean, onSlotActivate?: (slot: WqlSlotActivation) => void): KeyBinding[] {
  return [
    { key: 'Mod-Enter', run: view => { if (view.compositionStarted) return false; onSubmit(); return true; } },
    { key: 'Ctrl-Space', run: startCompletion },
    { key: 'Alt-ArrowDown', run: view => { if (!onSlotActivate) return false; activateSlot(view, view.state.selection.main.head, onSlotActivate); return true; } },
    { key: 'ArrowDown', run: view => completionStatus(view.state) === 'active' && moveCompletionSelection(true)(view) },
    { key: 'ArrowUp', run: view => completionStatus(view.state) === 'active' && moveCompletionSelection(false)(view) },
    { key: 'PageUp', run: view => completionStatus(view.state) === 'active' ? moveCompletionSelection(false, 'page')(view) : cursorPageUp(view) },
    { key: 'PageDown', run: view => completionStatus(view.state) === 'active' ? moveCompletionSelection(true, 'page')(view) : cursorPageDown(view) },
    {
      key: 'Home',
      run: view => {
        if (completionStatus(view.state) === 'active') {
          view.dispatch({ effects: setSelectedCompletion(0) });
          return true;
        }
        return cursorDocStart(view);
      },
    },
    {
      key: 'End',
      run: view => {
        if (completionStatus(view.state) === 'active') {
          view.dispatch({ effects: setSelectedCompletion(currentCompletions(view.state).length - 1) });
          return true;
        }
        return cursorDocEnd(view);
      },
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
    {
      key: 'Escape',
      run: view => {
        if (view.compositionStarted || closeCompletion(view) || onEscape()) return true;
        view.contentDOM.blur();
        return false;
      },
    },
    ...historyKeymap,
  ];
}

export function WqlTextEditor({
  value,
  onChange,
  onSubmit,
  onEscape,
  placeholder,
  autoFocus = false,
  dense = false,
  modalOverlay = true,
  onSlotActivate,
  onCursorClauseChange,
  onCursorStageChange,
  activeRange,
  activeClause,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onEscape: () => boolean;
  /** Shown while the draft is empty. */
  placeholder?: string;
  autoFocus?: boolean;
  /** Compact single-line height (~36px) for inline toolbars; default is roomy 48px. */
  dense?: boolean;
  /** Elevate `.cm-tooltip` above modal overlays (e.g. PaletteShell `z-[200]`); defaults to `true`. */
  modalOverlay?: boolean;
  onSlotActivate?: (slot: WqlSlotActivation) => void;
  /** Passive caret-to-clause sync — fires as cursor moves without stealing focus. */
  onCursorClauseChange?: (slot: WqlSlotActivation | null) => void;
  onCursorStageChange?: (stage: WqlCursorStageInfo) => void;
  activeRange?: { from: number; to: number };
  activeClause?: QueryClause;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const callbacks = useRef({ onChange, onSubmit, onEscape, onSlotActivate, onCursorClauseChange, onCursorStageChange });
  callbacks.current = { onChange, onSubmit, onEscape, onSlotActivate, onCursorClauseChange, onCursorStageChange };
  const replacing = useRef(false);
  const initialValue = useRef(value);

  useEffect(() => {
    if (!host.current) return;
    const source = wqlCompletionSource({
      values: async key => (await loadSuggestions(key === 'tags' ? 'tag' : key)).map(item => ({ label: item.value, detail: item.label, type: 'constant' })),
    });
    const emitPassiveCursorClause = (editor: EditorView) => {
      if (!callbacks.current.onCursorClauseChange) return;
      const pos = editor.state.selection.main.head;
      callbacks.current.onCursorClauseChange(resolveSlotAtPosition(editor.state, pos));
    };

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: [
          wqlLanguage,
          syntaxHighlighting(wqlHighlightStyle),
          history(),
          EditorView.lineWrapping,
          tooltips({ parent: document.body }),
          activeSegmentField,
          ...(placeholder ? [cmPlaceholder(placeholder)] : []),
          EditorView.contentAttributes.of({ 'aria-label': 'WQL', 'data-testid': 'wql-text-input' }),
          autocompletion({
            defaultKeymap: false,
            selectOnOpen: false,
            interactionDelay: 0,
            override: [source],
            icons: false,
            addToOptions: [{
              position: 20,
              render: completion => {
                const icon = document.createElement('span');
                icon.className = 'wql-completion-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.innerHTML = completion.label === 'find' ? completionIcons.search
                  : completion.type === 'keyword' || completion.type === 'variable' ? completionIcons.metric
                  : completion.type === 'property' ? completionIcons.filter : completionIcons.value;
                return icon;
              },
            }],
          }),
          linter(wqlLint),
          keymap.of(wqlEditorKeymap(
            () => callbacks.current.onSubmit(),
            () => callbacks.current.onEscape(),
            slot => callbacks.current.onSlotActivate?.(slot),
          )),
          EditorView.domEventHandlers({
            // Keep pointer focus inside CodeMirror; passively highlight the matching slot below.
            mouseup: (_event, editor) => {
              emitPassiveCursorClause(editor);
              return false;
            },
            touchend: (_event, editor) => {
              emitPassiveCursorClause(editor);
              return false;
            },
            blur: (event, editor) => {
              const related = event.relatedTarget as HTMLElement | null;
              if (!related || !related.closest('.cm-tooltip')) {
                closeCompletion(editor);
              }
              return false;
            },
            keydown: (event, editor) => {
              if (event.isComposing || editor.compositionStarted) return true;
              if (event.key === 'Enter' || (['ArrowDown', 'ArrowUp'].includes(event.key) && completionStatus(editor.state) === 'active')) event.stopPropagation();
              return false;
            },
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !replacing.current) callbacks.current.onChange(update.state.doc.toString());
            if ((update.selectionSet || update.docChanged) && callbacks.current.onCursorStageChange) {
              const docText = update.state.doc.toString();
              const pos = update.state.selection.main.head;
              callbacks.current.onCursorStageChange(resolveWqlCursorStage(docText, pos));
            }
            if ((update.selectionSet || update.docChanged) && callbacks.current.onCursorClauseChange) {
              emitPassiveCursorClause(update.view);
            }
          }),
          EditorView.theme({
            '&': { width: '100%', fontSize: '14px', backgroundColor: 'transparent' },
            '&.cm-focused': { outline: 'none' },
            '.cm-content': {
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              padding: dense ? '6px 4px' : '10px 4px',
              minHeight: dense ? '32px' : '44px',
              minWidth: '0',
              maxWidth: '100%',
              overflowWrap: 'anywhere',
            },
            '.cm-line': { padding: '0 12px' },
            '.cm-line span[class*="tok-"]:hover, .cm-line span[class^="tok-"]:hover': { textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-placeholder': { color: 'hsl(var(--field-placeholder, var(--muted-foreground)))' },
            '.wql-completion-icon': { display: 'inline-flex', flexShrink: '0', color: 'hsl(var(--primary))' },
            '.wql-active-segment': { backgroundColor: 'hsl(var(--primary) / 0.11)', boxShadow: 'inset 0 -2px hsl(var(--primary))', borderRadius: '3px', padding: '1px 2px', margin: '0 -2px', fontWeight: '600' },
          }),
          autocompleteTooltipTheme,
          ...(modalOverlay ? [EditorView.theme({ '.cm-tooltip.cm-tooltip': { zIndex: '250' } })] : []),
        ],
      }),
    });
    view.current = editor;
    if (autoFocus) editor.focus();
    return () => { editor.destroy(); view.current = undefined; };
  }, [autoFocus, placeholder, dense, modalOverlay]);

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

  return <div ref={host} className={className ?? 'min-w-0 w-full rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-ring'} data-testid="wql-text-editor" />;
}
