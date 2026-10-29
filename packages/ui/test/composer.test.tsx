import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { autocompletion, completionStatus, selectedCompletionIndex, startCompletion } from '@codemirror/autocomplete';
import { parseQuery, isFindQuery, wqlLanguage } from '@bitcobblers/wod-wiki-wql';
import { WqlComposer } from '../src/composer/WqlComposer';
import { WqlDiagnosticsStrip } from '../src/composer/WqlDiagnosticsStrip';
import { WqlTextEditor, wqlEditorKeymap, wqlLint } from '../src/composer/WqlTextEditor';

afterEach(cleanup);

describe('current visible draft actions', () => {
  it('first Run includes pending text without Enter or a debounce', () => {
    const submit = vi.fn();
    render(<WqlComposer initialQuery=":note{source:journal}" onSubmit={submit} actionLabel="Run" />);
    fireEvent.change(screen.getByLabelText('Search text or WQL'), { target: { value: 'snatch' } });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    const submitted = parseQuery(submit.mock.calls[0][0]);
    expect(isFindQuery(submitted)).toBe(true);
    if (isFindQuery(submitted)) {
      expect(submitted.filters).toEqual([
        { key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }] },
        { key: 'text', negate: false, values: [{ value: 'snatch', wildcard: false }] },
      ]);
    }
  });

  it('invalid exact input prevents both button and shortcut submission', () => {
    const submit = vi.fn();
    const change = vi.fn();
    render(<WqlComposer initialQuery=':note' onSubmit={submit} onQueryChange={change} actionLabel="Apply" />);
    const input = screen.getByLabelText('Search text or WQL');
    fireEvent.change(input, { target: { value: ':note{tags:' } });
    expect(change).toHaveBeenLastCalledWith(':note{tags:');
    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }));
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert')[0].textContent).toBeTruthy();
  });

  it('opening a picker emits no rewrite and starts without an active option', () => {
    const change = vi.fn();
    const query = ':segment{effort:snatch}  by {effort} in lb | limit 5';
    render(<WqlComposer initialQuery={query} onQueryChange={change} />);
    fireEvent.click(screen.getByTestId('token-slot-time'));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByTestId('wql-picker-search').getAttribute('aria-activedescendant')).toBeNull();
  });
  it('opens an externally targeted segment without rewriting the query', () => {
    const change = vi.fn();
    const { rerender } = render(<WqlComposer initialQuery=':note{text:snatch}' onQueryChange={change} />);
    rerender(<WqlComposer initialQuery=':note{text:snatch}' onQueryChange={change} segmentEditRequest={{ type: 'text', token: 1 }} />);
    expect(screen.getByTestId('wql-picker-search')).toBeDefined();
    expect(screen.getByTestId('token-slot-text').getAttribute('aria-pressed')).toBe('true');
    expect(change).not.toHaveBeenCalled();
  });

  it('moves the lower writer with Tab and Shift-Tab', () => {
    render(<WqlComposer initialQuery=':note{text:snatch} by {week}' />);
    fireEvent.click(screen.getByTestId('token-slot-text'));
    fireEvent.keyDown(screen.getByTestId('wql-picker-search'), { key: 'Tab' });
    expect(screen.getByTestId('token-slot-groupby').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(screen.getByTestId('wql-picker-search'), { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('token-slot-text').getAttribute('aria-pressed')).toBe('true');
  });

  it('opening a picker from typed suggestions inserts no empty filter', () => {
    const change = vi.fn();
    render(<WqlComposer initialQuery=':note' onQueryChange={change} />);
    fireEvent.change(screen.getByLabelText('Search text or WQL'), { target: { value: 'effort' } });
    fireEvent.click(screen.getByTestId('wql-filter-typeahead-effort'));
    expect(screen.getByTestId('wql-clause-editor')).toBeDefined();
    expect(screen.queryByTestId('token-slot-effort')).toBeNull();
    for (const [wql] of change.mock.calls) {
      expect(parseQuery(wql).filters.every(f => f.values.length > 0)).toBe(true);
    }
  });

  it('keyboard reaches the exact typed action when suggestions remain', () => {
    const change = vi.fn();
    render(<WqlComposer initialQuery=":note{text:prefix*}" onQueryChange={change} />);
    fireEvent.click(screen.getByTestId('token-slot-text'));
    const input = screen.getByTestId('wql-picker-search');
    fireEvent.change(input, { target: { value: 'my exact phrase' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    const last = change.mock.calls.at(-1);
    if (!last) throw new Error('Exact value did not update the draft');
    const exactDraft = parseQuery(last[0]);
    expect(isFindQuery(exactDraft)).toBe(true);
    if (isFindQuery(exactDraft)) {
      expect(exactDraft.filters).toEqual([{ key: 'text', negate: false, values: [{ value: 'my exact phrase', wildcard: false }] }]);
    }
  });

  it('external replacement discards pending text without replaying an edit', () => {
    const change = vi.fn();
    const { rerender } = render(<WqlComposer query=':note' onQueryChange={change} />);
    fireEvent.change(screen.getByLabelText('Search text or WQL'), { target: { value: 'snatch' } });
    change.mockClear();
    rerender(<WqlComposer query=":block{source:notebooks}" onQueryChange={change} />);
    expect(screen.getByLabelText('Search text or WQL').getAttribute('value')).toBe('');
    expect(screen.getByTestId('token-slot-value-target').textContent).toBe('block');
    expect(change).not.toHaveBeenCalled();
  });

  it('returning to an echoed checkpoint clears pending text', () => {
    const change = vi.fn();
    const { rerender } = render(<WqlComposer query=":note{source:notebooks}" onQueryChange={change} />);
    fireEvent.change(screen.getByLabelText('Search text or WQL'), { target: { value: 'fresh' } });
    rerender(<WqlComposer query={change.mock.calls.at(-1)![0]} onQueryChange={change} />);
    rerender(<WqlComposer query=":note{source:notebooks}" onQueryChange={change} />);
    expect(screen.getByLabelText('Search text or WQL').getAttribute('value')).toBe('');
    expect(screen.queryByTestId('token-slot-text')).toBeNull();
  });

  it('Escape dismisses one picker level without reaching its host', () => {
    const host = vi.fn();
    render(<div onKeyDown={host}><WqlComposer initialQuery=':note' /></div>);
    fireEvent.click(screen.getByTestId('token-slot-time'));
    fireEvent.keyDown(screen.getByTestId('wql-picker-search'), { key: 'Escape' });
    expect(screen.queryByTestId('wql-clause-editor')).toBeNull();
    expect(host).not.toHaveBeenCalled();
  });

  it('group toggles preserve multiple dimensions and their order', () => {
    const change = vi.fn();
    render(<WqlComposer initialQuery="sum:tis{} by {week, effort}" onQueryChange={change} />);
    fireEvent.click(screen.getByTestId('token-slot-groupby'));
    const input = screen.getByTestId('wql-picker-search');
    fireEvent.change(input, { target: { value: 'session' } });
    fireEvent.click(screen.getByRole('option', { name: /^session$/ }));
    const last = change.mock.calls.at(-1);
    if (!last) throw new Error('Grouping did not update');
    expect(parseQuery(last[0]).groupBy).toEqual(['week', 'effort', 'session']);
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    fireEvent.click(screen.getByTestId('token-slot-groupby'));
    expect(screen.getByTestId('token-slot-value-groupby').textContent).toContain('week|effort|session');
  });

  it('empty Backspace only focuses, then explicit chip removal can be undone', () => {
    const change = vi.fn();
    const query = ':note{tags:strength}';
    render(<WqlComposer initialQuery={query} onQueryChange={change} />);
    const input = screen.getByLabelText('Search text or WQL');
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(document.activeElement).toBe(screen.getByTestId('token-slot-tag'));
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    expect(parseQuery(change.mock.calls.at(-1)![0]).filters).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo removal' }));
    expect(change).toHaveBeenLastCalledWith(query);
  });

  it('requires confirmation before a kind pivot discards presentation pipes', () => {
    const change = vi.fn();
    const query = ':segment{effort:snatch} by {effort} in lb | limit 5';
    render(<WqlComposer initialQuery={query} onQueryChange={change} actionLabel="Run" />);
    fireEvent.click(screen.getByTestId('token-slot-kind'));
    fireEvent.click(screen.getByRole('option', { name: 'Measure' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Presentation pipes');
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('token-slot-value-pipes').textContent).toBe('limit 5');
    expect(change).not.toHaveBeenCalled();
  });

  it('Enter does not submit during IME composition', () => {
    const submit = vi.fn();
    render(<WqlComposer initialQuery=':note' onSubmit={submit} />);
    fireEvent.keyDown(screen.getByLabelText('Search text or WQL'), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(submit).not.toHaveBeenCalled();
  });

  it('favorite choices change priority without excluding non-favorites', () => {
    render(<WqlComposer initialQuery=":note{source:journal}" preferredChoices={['guides']} />);
    fireEvent.click(screen.getByTestId('token-slot-source'));
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('Guides');
    expect(screen.getByRole('option', { name: /Notebooks/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /Journal/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('untouched unsupported or invalid seed remains in exact WQL text', () => {
    const query = ':note{tags:';
    const change = vi.fn();
    render(<WqlComposer initialQuery={query} onQueryChange={change} />);
    expect(screen.getByLabelText('WQL').textContent).toBe(query);
    expect(change).not.toHaveBeenCalled();
  });
});

describe('WQL text editor keyboard and lint', () => {
  const views: EditorView[] = [];
  afterEach(() => {
    cleanup();
    for (const view of views.splice(0)) view.destroy();
    vi.useRealTimers();
  });

  it('completion grid nav wraps, Home/End select edges, Tab accepts a slot hop, IME Enter is inert', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const submit = vi.fn();
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: ':note{so',
        extensions: [
          wqlLanguage,
          autocompletion({
            defaultKeymap: false, selectOnOpen: false, interactionDelay: 0, icons: false,
            override: [context => ({
              from: context.matchBefore(/[\w-]*/)!.from,
              options: [
                { label: 'source', type: 'property' as const },
                { label: 'scope', type: 'property' as const },
                { label: 'session', type: 'property' as const },
              ],
              validFor: /^[\w-]*$/,
              filter: false,
            })],
          }),
          keymap.of(wqlEditorKeymap(submit, () => false)),
        ],
      }),
    });
    views.push(view);
    vi.useFakeTimers({ toFake: ['Date'] });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe('active'));
    fireEvent.keyDown(view.contentDOM, { key: 'ArrowDown' });
    expect(selectedCompletionIndex(view.state)).toBe(0);
    fireEvent.keyDown(view.contentDOM, { key: 'End' });
    expect(selectedCompletionIndex(view.state)).toBe(2);
    fireEvent.keyDown(view.contentDOM, { key: 'ArrowDown' });
    expect(selectedCompletionIndex(view.state)).toBe(0);
    fireEvent.keyDown(view.contentDOM, { key: 'Home' });
    expect(selectedCompletionIndex(view.state)).toBe(0);
    fireEvent.keyDown(view.contentDOM, { key: 'Tab' });
    expect(view.state.doc.toString()).toBe(':note{source');
    // CM's Safari path swallows a keydown within ~100ms of compositionend —
    // cross that native cooldown on the fake clock before the real Enter.
    fireEvent.compositionStart(view.contentDOM);
    fireEvent.keyDown(view.contentDOM, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(':note{source');
    fireEvent.compositionEnd(view.contentDOM);
    expect(view.compositionStarted).toBe(false);
    vi.setSystemTime(Date.now() + 150);
    fireEvent.keyDown(view.contentDOM, { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('reports the semantic filter when Tab lands on its WQL slot', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const activate = vi.fn();
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: ':note{text:snatch} by {week}',
        extensions: [wqlLanguage, keymap.of(wqlEditorKeymap(() => {}, () => false, activate))],
      }),
    });
    views.push(view);
    view.dispatch({ selection: { anchor: 0 } });
    fireEvent.keyDown(view.contentDOM, { key: 'Tab' });
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ node: 'Filter', filterIndex: 0 }));
  });
  it('decorates the active clause in the CodeMirror editor when activeClause is provided', () => {
    const clause = { id: 'c-filter-0', type: 'text', label: 'Contains', value: 'snatch', filterIndex: 0 };
    const { container } = render(
      <WqlTextEditor
        value=":note{text:snatch} by {week}"
        onChange={() => {}}
        onSubmit={() => {}}
        onEscape={() => false}
        activeClause={clause}
      />,
    );
    const marked = container.querySelector('.wql-active-segment');
    expect(marked).not.toBeNull();
    expect(marked?.textContent).toContain('text:snatch');
  });

  it('real editor: Enter during an active composition never submits', () => {
    const submit = vi.fn();
    render(<WqlTextEditor value=":note{source:journal}" onChange={() => {}} onSubmit={submit} onEscape={() => false} autoFocus />);
    const content = screen.getByLabelText('WQL');
    vi.useFakeTimers({ toFake: ['Date'] });
    fireEvent.compositionStart(content);
    fireEvent.keyDown(content, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    expect(content.textContent).toBe(':note{source:journal}');
    fireEvent.compositionEnd(content);
    vi.setSystemTime(Date.now() + 150);
    fireEvent.keyDown(content, { key: 'Enter' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('lint marks unsupported filter keys and parse errors at their text', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const capable = new EditorView({ parent: container, state: EditorState.create({ doc: ':note{session:morning}', extensions: [wqlLanguage] }) });
    views.push(capable);
    const marks = wqlLint(capable);
    const [mark] = marks;
    if (!mark) throw new Error('Expected an unsupported-filter squiggle');
    expect(mark.severity).toBe('warning');
    expect(capable.state.sliceDoc(mark.from, mark.to)).toBe('session:morning');
    const broken = new EditorView({ parent: container, state: EditorState.create({ doc: ':note{tags:', extensions: [wqlLanguage] }) });
    views.push(broken);
    const [errorMark] = wqlLint(broken);
    if (!errorMark) throw new Error('Expected a parse-error squiggle');
    expect(errorMark.severity).toBe('error');
  });

  it('strip reports matched of selected, explicit status words, and unsupported dims', () => {
    const query = ':note{tags:x} by {bogus}';
    const { unmount } = render(
      <WqlDiagnosticsStrip
        diagnostics={{ valid: true, wql: query, ast: parseQuery(query) }}
        stages={{ kind: 'find', selected: 5, matched: 2 }}
      />,
    );
    expect(screen.getByTestId('diag-stage-counts').textContent).toBe('2 matched of 5');
    const badge = screen.getByTestId('wql-validity-badge');
    expect(badge.textContent).toContain('Warning');
    expect(badge.textContent).not.toContain('Invalid');
    expect(screen.getByTestId('diag-summary-groupby').getAttribute('title')).toContain('bogus');
    expect(screen.getByTestId('wql-diagnostics-strip').getAttribute('aria-live')).toBe('polite');
    unmount();
    render(<WqlDiagnosticsStrip diagnostics={{ valid: false, wql: ':note{tags:', ast: parseQuery(':note{tags:'), error: 'Unexpected end of query' }} />);
    expect(screen.getByTestId('wql-validity-badge').textContent).toContain('Invalid');
  });
});
