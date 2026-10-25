import { describe, expect, it  } from 'vitest';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { history, undo, redo, isolateHistory, moveLineDown } from '@codemirror/commands';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { whiteboardScriptCompletionSource, whiteboardScriptLanguage } from '@bitcobblers/wod-wiki-lang';
import { wqlCompletionSource, wqlLanguage } from '@bitcobblers/wod-wiki-wql';
import {
  editorPreset,
  resolveCodeLanguage,
  sectionField,
  sectionIdentity,
  sectionIdentityHistory,
  sectionMove,
  sectionSaved,
  sectionRestore,
  registeredSectionWidgets,
  sessionQueryInsert,
  sectionGeometry,
  linkOpen,
  navigationFacet,
  editorTheme,
  previewDecorations,
  autocompleteTooltipTheme,
  customCompletionSources,
  nestedCompletionOptions,
  type NestedCompletionOptions,
  nestedCompletion,
  wodCompletionSource,
  wodAutocompletion,
  wodAutoWrap,
  handleFenceAutoWrap,
  wodEditorKeymap,
} from '../src/extensions';
import { EditorView, runScopeHandlers } from '@codemirror/view';

describe('@bitcobblers/wod-wiki-ui/extensions and editorPreset suite', () => {
  it('editorPreset(dialect) returns a functional extension array', () => {
    const preset = editorPreset('markdown');
    expect(Array.isArray(preset)).toBe(true);
    expect(preset.length).toBeGreaterThan(5);

    const state = EditorState.create({
      doc: '# Header\n\n```time\n10:00 Run\n```\n',
      extensions: preset,
    });

    const sections = state.field(sectionField).sections;
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.some((s) => s.type === 'time')).toBe(true);
  });

  it('editorPreset("wql") configures WQL language support', () => {
    const preset = editorPreset('wql');
    const state = EditorState.create({
      doc: 'sum:totalVolume{effort:bench-press} every week',
      extensions: preset,
    });
    expect(state.doc.toString()).toContain('sum:totalVolume');
  });

  it('navigationFacet provides custom navigation hook for linkOpen extension', () => {
    let navigatedUrl = '';
    const state = EditorState.create({
      doc: '[workout](wod:note-1)',
      extensions: [
        linkOpen,
        navigationFacet.of((url) => {
          navigatedUrl = url;
        }),
      ],
    });

    const hook = state.facet(navigationFacet);
    expect(hook).toBeDefined();
    if (hook) {
      hook('wod:note-1', {} as any);
      expect(navigatedUrl).toBe('wod:note-1');
    }
  });

  it('editorTheme generates extension for light and dark modes', () => {
    const darkTheme = editorTheme(true);
    const lightTheme = editorTheme(false);
    expect(darkTheme).toBeDefined();
    expect(lightTheme).toBeDefined();
  });

  it('sectionGeometry computes non-zero document-space top for later sections', () => {
    const state = EditorState.create({
      doc: '# Header\n\n```time\n10:00 Run\n```\n',
      extensions: [sectionField, sectionGeometry],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    const plugin = view.plugin(sectionGeometry);
    expect(plugin).toBeDefined();
    expect(plugin?.rects.length).toBeGreaterThanOrEqual(2);

    const timeRect = plugin?.rects.find((r) => r.type === 'time');
    expect(timeRect).toBeDefined();
    expect(timeRect?.top).toBeGreaterThan(0);

    view.destroy();
    container.remove();
  });

  it('parses query fences with attributes into query sections', () => {
    const state = EditorState.create({
      doc: '```query:goal-rings-2 goal=$hangGoal\nsum:reps{}\n```\n',
      extensions: [sectionField],
    });

    const sections = state.field(sectionField).sections;
    const querySection = sections.find((s) => s.type === 'query');
    expect(querySection).toBeDefined();
    expect(querySection?.queryType).toBe('goal-rings');
  });

  it('previewDecorations adds footer block widget when inactive, shifts space to active line when selected', () => {
    const doc = '# Workout\n\n```time\n(21-15-9)\nThrusters\nPull-ups\n```\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, previewDecorations],
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });

    // Inactive: closing fence has footer block widget
    expect(container.querySelector('.cm-wod-block-footer')).not.toBeNull();
    expect(container.querySelector('.cm-wod-insert-spacer')).toBeNull();

    // Select Thrusters line (inside workout section)
    const thrustersPos = doc.indexOf('Thrusters');
    view.dispatch({ selection: { anchor: thrustersPos, head: thrustersPos } });

    // Active line should now have insert-spacer widget and footer widget is removed
    expect(container.querySelector('.cm-wod-insert-spacer')).not.toBeNull();
    expect(container.querySelector('.cm-wod-block-footer')).toBeNull();

    view.destroy();
    container.remove();
  });

  it('isolates per-editor custom completion sources through real editor state', async () => {
    const forEditorA = customCompletionSources.of(() => ({ from: 0, options: [{ label: 'editor-a' }] }));
    const forEditorB = customCompletionSources.of(() => ({ from: 0, options: [{ label: 'editor-b' }] }));
    const labels = async (state: EditorState) =>
      (await wodCompletionSource(new CompletionContext(state, state.doc.length, true)))?.options.map((option) => option.label) ?? [];

    const stateA = EditorState.create({ doc: 'x', extensions: [wodAutocompletion, forEditorA] });
    const stateB = EditorState.create({ doc: 'x', extensions: [wodAutocompletion, forEditorB] });
    const stateC = EditorState.create({ doc: 'x', extensions: [wodAutocompletion] });
    expect(await labels(stateA)).toEqual(['editor-a']);
    expect(await labels(stateB)).toEqual(['editor-b']);
    expect(await labels(stateC)).toEqual([]);
  });

  it('runs providers in explicit order — custom sources, opening fences, nested bodies', async () => {
    // A custom source shadows the fence snippets at the same cursor.
    const withCustom = EditorState.create({
      doc: '`',
      extensions: [wodAutocompletion, customCompletionSources.of(() => ({ from: 0, options: [{ label: 'custom' }] }))],
    });
    const custom = await wodCompletionSource(new CompletionContext(withCustom, 1, true));
    expect(custom?.options.map((option) => option.label)).toEqual(['custom']);

    // Without one, the same cursor yields the opening-fence snippets.
    const fenced = EditorState.create({ doc: '`', extensions: [wodAutocompletion] });
    const fences = await wodCompletionSource(new CompletionContext(fenced, 1, true));
    expect(fences?.options.map((option) => option.label)).toContain('```time');
  });

  it('nested query bodies match the standalone WQL source options and ranges', async () => {
    const wqlOptions = { effortNames: () => ['fran'] };
    // ':no' pins the colon-head slot — the path a live editor reaches through
    // its parsed language state. Both the runtime-recognized ```query fence
    // and the highlight-only ```wql code fence dispatch nested WQL.
    for (const fence of ['query', 'wql'] as const) {
      for (const body of ['find session{effort:fr', ':no']) {
        const standalone = await wqlCompletionSource(wqlOptions)(
          new CompletionContext(EditorState.create({ doc: body, extensions: [wqlLanguage] }), body.length, true),
        );

        const note = '```' + fence + '\n' + body + '\n```';
        const nestedState = EditorState.create({
          doc: note,
          extensions: [sectionField, nestedCompletionOptions.of({ wql: wqlOptions })],
        });
        const nested = await nestedCompletion(new CompletionContext(nestedState, note.length - 4, true));

        expect(nested).not.toBeNull();
        expect(nested!.options.map((option) => option.label)).toEqual(standalone!.options.map((option) => option.label));
        expect(nested!.options.map((option) => option.apply ?? option.label))
          .toEqual(standalone!.options.map((option) => option.apply ?? option.label));
        expect(nested!.from).toBe(standalone!.from + ('```' + fence + '\n').length);
      }
    }
    // Value-slot fixture proves options threading; colon-head proves the
    // language-parsed slot list.
    const threaded = await nestedCompletion(new CompletionContext(
      EditorState.create({
        doc: '```query\nfind session{effort:fr\n```',
        extensions: [sectionField, nestedCompletionOptions.of({ wql: wqlOptions })],
      }),
      '```query\nfind session{effort:fr'.length,
      true,
    ));
    expect(threaded!.options.map((option) => option.label)).toContain('fran');
    const colonHead = await nestedCompletion(new CompletionContext(
      EditorState.create({
        doc: '```query\n:no\n```',
        extensions: [sectionField, nestedCompletionOptions.of({ wql: wqlOptions })],
      }),
      '```query\n:no'.length,
      true,
    ));
    expect(colonHead!.options.map((option) => option.label)).toContain('note');
  });

  it('nested time and log bodies match the standalone Whiteboard Script source options and ranges', async () => {
    const wbOptions = { efforts: () => [{ value: 'fran', label: 'Fran' }] };
    const body = '21-15-9 Thrusters ';
    const standalone = await whiteboardScriptCompletionSource(wbOptions)(
      new CompletionContext(EditorState.create({ doc: body, extensions: [whiteboardScriptLanguage] }), body.length, true),
    );

    for (const fence of ['time', 'log'] as const) {
      const note = '```' + fence + '\n' + body + '\n```';
      const nestedState = EditorState.create({
        doc: note,
        extensions: [sectionField, nestedCompletionOptions.of({ whiteboardScript: wbOptions })],
      });
      const nested = await nestedCompletion(new CompletionContext(nestedState, note.length - 4, true));

      expect(nested).not.toBeNull();
      expect(nested!.options.map((option) => option.label)).toEqual(standalone!.options.map((option) => option.label));
      expect(nested!.options.map((option) => option.apply ?? option.label))
        .toEqual(standalone!.options.map((option) => option.apply ?? option.label));
      expect(nested!.from).toBe(standalone!.from + ('```' + fence + '\n').length);
      expect(nested!.options.map((option) => option.label)).toContain('Fran');

      // Snippets are available on an empty body line, like a standalone editor.
      const blankNote = '```' + fence + '\n\n```';
      const blankState = EditorState.create({
        doc: blankNote,
        extensions: [sectionField, nestedCompletionOptions.of({ whiteboardScript: wbOptions })],
      });
      const blank = await nestedCompletion(new CompletionContext(blankState, blankNote.indexOf('\n') + 1, true));
      expect(blank?.options.map((option) => option.label)).toContain('Circuit');
    }
  });

  it('nested time bodies offer effort, unit, and property suggestions inside the body', async () => {
    const wbOptions = {
      efforts: () => [{ value: 'fran', label: 'Fran' }],
      equipment: () => [{ value: 'barbell', label: 'Barbell' }],
    };
    const nested = (body: string) =>
      EditorState.create({
        doc: '```time\n' + body + '\n```',
        extensions: [sectionField, nestedCompletionOptions.of({ whiteboardScript: wbOptions })],
      });
    const at = async (state: EditorState, needle: string) => {
      const pos = state.doc.toString().indexOf(needle) + needle.length;
      return nestedCompletion(new CompletionContext(state, pos, true));
    };

    // Bare word at line start: property keys share the slot with efforts.
    const keys = await at(nested('eff'), 'eff');
    expect(keys?.options.map((option) => option.label)).toContain('effort');
    expect(keys?.options.map((option) => option.label)).toContain('Fran');
    // `key: value` resolves the matching host catalog by slug.
    const efforts = await at(nested('effort:fr'), 'effort:fr');
    expect(efforts?.options.map((option) => option.apply)).toContain('fran');
    const equipment = await at(nested('equipment:bar'), 'equipment:bar');
    expect(equipment?.options.map((option) => option.apply)).toContain('barbell');
    // Units after a number.
    const units = await at(nested('10 cal'), '10 cal');
    expect(units?.options.map((option) => option.label)).toContain('km');
  });

  it('nested log bodies add climb vocabulary from the fence sport', async () => {
    const options: NestedCompletionOptions = { whiteboardScript: {} };
    const at = async (note: string) => {
      const state = EditorState.create({ doc: note, extensions: [sectionField, nestedCompletionOptions.of(options)] });
      const pos = note.indexOf('Redpoint ') + 'Redpoint '.length;
      return (await nestedCompletion(new CompletionContext(state, pos, true)))?.options.map((option) => option.label) ?? [];
    };

    expect(await at('```log:climbing\nRedpoint \n```')).toContain('flash');
    expect(await at('```log\nRedpoint \n```')).not.toContain('flash');
  });

  it('keeps nested Whiteboard Script catalog callbacks per editor', async () => {
    const doc = '```time\n21-15-9 Thrusters \n```';
    const labels = async (options: NestedCompletionOptions) => {
      const state = EditorState.create({ doc, extensions: [sectionField, nestedCompletionOptions.of(options)] });
      const pos = doc.indexOf('Thrusters ') + 'Thrusters '.length;
      return (await nestedCompletion(new CompletionContext(state, pos, true)))?.options.map((option) => option.label) ?? [];
    };

    expect(await labels({ whiteboardScript: { efforts: () => [{ value: 'fran' }] } })).toContain('fran');
    expect(await labels({ whiteboardScript: { efforts: () => [{ value: 'grace' }] } })).not.toContain('fran');
    // No options: grammar-aware defaults only — no host efforts leak across editors.
    expect(await labels({})).not.toContain('fran');
  });

  it('keeps fence and nested suggestions inside their own sections', async () => {
    const doc = '---\ntags: x\n---\n\n# Note\n\n```query\nfind session{effort:fr\n```\n\n```time\n10:00 Run\n```\n';
    const state = EditorState.create({
      doc,
      extensions: [sectionField, wodAutocompletion, nestedCompletionOptions.of({ wql: { effortNames: () => ['fran'] } })],
    });
    const offset = (needle: string) => doc.indexOf(needle) + needle.length;
    const labels = async (pos: number) =>
      (await wodCompletionSource(new CompletionContext(state, pos, true)))?.options.map((option) => option.label) ?? [];

    // Prose and frontmatter: no fence snippets, no nested WQL.
    expect(await labels(offset('# Note'))).toEqual([]);
    expect(await labels(offset('tags: x'))).toEqual([]);
    // Query body: WQL options only — no opening-fence suggestions leak in.
    const inQuery = await labels(offset('effort:fr'));
    expect(inQuery).toContain('fran');
    expect(inQuery.every((label) => !label.startsWith('```'))).toBe(true);
    // Time body: Whiteboard Script suggestions only — no WQL, no fences.
    const inTime = await labels(offset('10:00 Run'));
    expect(inTime).toContain('FOR TIME');
    expect(inTime.every((label) => !label.startsWith('```'))).toBe(true);
    expect(inTime).not.toContain('fran');
  });

  it('exposes one fence-language resolver and the shared tooltip theme', () => {
    expect(resolveCodeLanguage('time')).toBe(whiteboardScriptLanguage);
    expect(resolveCodeLanguage('time:crossfit')).toBe(whiteboardScriptLanguage);
    expect(resolveCodeLanguage('LOG')).toBe(whiteboardScriptLanguage);
    expect(resolveCodeLanguage('wod')).toBe(whiteboardScriptLanguage);
    expect(resolveCodeLanguage('whiteboard')).toBe(whiteboardScriptLanguage);
    expect(resolveCodeLanguage('query')).toBe(wqlLanguage);
    expect(resolveCodeLanguage('wql')).toBe(wqlLanguage);
    expect(resolveCodeLanguage('python')).toBeNull();
    for (const dialect of ['markdown', 'wql', 'wod', 'whiteboard', 'time']) {
      expect(editorPreset(dialect).includes(autocompleteTooltipTheme)).toBe(true);
    }
  });

  it('guards backtick auto-wrap to markdown sections', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const markdownView = new EditorView({
      state: EditorState.create({ doc: 'sel', extensions: [wodAutoWrap] }),
      parent: host,
    });
    markdownView.dispatch({ selection: EditorSelection.range(0, 3) });
    expect(handleFenceAutoWrap({ data: '`' } as InputEvent, markdownView)).toBe(true);
    expect(markdownView.state.doc.toString()).toBe('```time\nsel\n```');

    const queryDoc = '```query\nsel\n```';
    const queryView = new EditorView({
      state: EditorState.create({ doc: queryDoc, extensions: [sectionField, wodAutoWrap] }),
      parent: host,
    });
    queryView.dispatch({ selection: EditorSelection.range(9, 12) });
    expect(handleFenceAutoWrap({ data: '`' } as InputEvent, queryView)).toBe(false);
    expect(queryView.state.doc.toString()).toBe(queryDoc);

    markdownView.destroy();
    queryView.destroy();
    host.remove();
  });

  it('keeps the Mod-Alt-w wrap chord out of code sections and frontmatter', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const wrapKey = (doc: string, from: number, to: number) => {
      const view = new EditorView({
        state: EditorState.create({ doc, extensions: [sectionField, wodEditorKeymap] }),
        parent: host,
      });
      view.dispatch({ selection: EditorSelection.range(from, to) });
      const handled = runScopeHandlers(view, new KeyboardEvent('keydown', {
        key: 'w', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
      }), 'editor');
      const after = view.state.doc.toString();
      view.destroy();
      return { handled, after };
    };

    // Markdown prose: wraps the selection into a ```time fence (control).
    expect(wrapKey('sel', 0, 3)).toEqual({ handled: true, after: '```time\nsel\n```' });

    // Query/time bodies and frontmatter: no nested fences, no document change.
    const queryDoc = '```query\nsel\n```';
    expect(wrapKey(queryDoc, 9, 12)).toEqual({ handled: false, after: queryDoc });
    const timeDoc = '```time\nsel\n```';
    expect(wrapKey(timeDoc, 9, 12)).toEqual({ handled: false, after: timeDoc });
    const frontmatterDoc = '---\ntags: x\n---\nsel';
    expect(wrapKey(frontmatterDoc, 4, 11)).toEqual({ handled: false, after: frontmatterDoc });

    host.remove();
  });
});

describe('editor occurrence lineage', () => {
  const fence = '```time\n5:00 Run\n```';

  it('maps duplicates through prose and copies one-to-one', () => {
    let state = EditorState.create({ doc: fence + '\n\n' + fence, extensions: [sectionField] });
    const original = Object.keys(state.field(sectionField).noteBlocks);
    state = state.update({ changes: { from: 0, insert: '# 😀\n\n' } }).state;
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual(original);
    state = state.update({ changes: { from: 0, insert: fence + '\n\n' } }).state;
    const copied = Object.keys(state.field(sectionField).noteBlocks);
    expect(copied.slice(1)).toEqual(original);
    expect(original).not.toContain(copied[0]);
    expect(sessionQueryInsert(state, 'removed', 'result')).toBeNull();
    expect(sessionQueryInsert(state, original[1], 'result')?.from).toBe(state.field(sectionField).sections.find(section => section.id === original[1])?.to);
  });

  it('creates fresh IDs for ambiguous whole replacements even with identical text', () => {
    const source = fence + '\n\n' + fence;
    let state = EditorState.create({ doc: source, extensions: [sectionField] });
    const original = Object.keys(state.field(sectionField).noteBlocks);
    state = state.update({ changes: { from: 0, to: source.length, insert: source } }).state;
    for (const id of Object.keys(state.field(sectionField).noteBlocks)) expect(original).not.toContain(id);
  });

  it('tracks explicit moves and native drag moves without guessing duplicate content', () => {
    const source = fence + '\n\n' + fence;
    let state = EditorState.create({ doc: source, extensions: [sectionField] });
    const original = Object.keys(state.field(sectionField).noteBlocks);
    state = state.update({
      changes: [{ from: 0, to: fence.length + 2 }, { from: source.length, insert: '\n\n' + fence }],
      effects: sectionMove.of({ id: original[0], from: fence.length + 2, to: source.length }),
    }).state;
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([original[1], original[0]]);
    const dragSource = fence + '\n\n# End\n\n';
    state = EditorState.create({ doc: dragSource, extensions: [sectionField] });
    const draggedId = Object.keys(state.field(sectionField).noteBlocks)[0];
    state = state.update({
      changes: [{ from: 0, to: fence.length + 2 }, { from: dragSource.length, insert: fence + '\n\n' }],
      userEvent: 'move.drop',
    }).state;
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([draggedId]);
    expect(state.field(sectionField).rawContent).toBe('# End\n\n' + fence + '\n\n');
  });

  it('preserves the selected occurrence through the native line-move command', () => {
    let state = EditorState.create({ doc: fence + '\n\n# End', selection: { anchor: 0, head: fence.length }, extensions: [sectionField] });
    const id = Object.keys(state.field(sectionField).noteBlocks)[0];
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    expect(moveLineDown({ state, dispatch })).toBe(true);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([id]);
    expect(state.field(sectionField).noteBlocks[id].from).toBe(1);
  });

  it('restores deletion and copy IDs through real undo and redo', () => {
    let state = EditorState.create({ doc: fence, extensions: [sectionField, history(), sectionIdentityHistory] });
    const original = Object.keys(state.field(sectionField).noteBlocks)[0];
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    state = state.update({ changes: { from: 0, to: fence.length }, annotations: isolateHistory.of('full') }).state;
    expect(Object.keys(state.field(sectionField).noteBlocks)).toHaveLength(0);
    expect(undo({ state, dispatch })).toBe(true);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([original]);
    expect(redo({ state, dispatch })).toBe(true);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toHaveLength(0);
    expect(undo({ state, dispatch })).toBe(true);
    state = state.update({ changes: { from: 0, insert: fence + '\n\n' }, annotations: isolateHistory.of('full') }).state;
    const copy = Object.keys(state.field(sectionField).noteBlocks)[0];
    expect(copy).not.toBe(original);
    expect(undo({ state, dispatch })).toBe(true);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([original]);
    expect(redo({ state, dispatch })).toBe(true);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([copy, original]);
  });

  it('restores grouped typing lineage in both undo directions', () => {
    let state = EditorState.create({ doc: fence, extensions: [sectionField, history(), sectionIdentityHistory] });
    const id = Object.keys(state.field(sectionField).noteBlocks)[0];
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    const position = fence.indexOf('5:00');
    state = state.update({ changes: { from: position, to: position + 1, insert: '6' }, userEvent: 'input.type' }).state;
    state = state.update({ changes: { from: position + 1, insert: '0' }, userEvent: 'input.type' }).state;
    const edited = state.field(sectionField).rawContent;
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(sectionField).rawContent).toBe(fence);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([id]);
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(sectionField).rawContent).toBe(edited);
    expect(Object.keys(state.field(sectionField).noteBlocks)).toEqual([id]);
  });

  it('keeps unsaved edits and undo from incrementing saved versions', () => {
    const blocks = reconcileNoteBlocks(fence, { sourceRevision: 1 });
    const id = Object.keys(blocks)[0];
    let state = EditorState.create({ doc: fence, extensions: [sectionField, sectionIdentity.of({ blocks, sourceRevision: 1 }), history(), sectionIdentityHistory] });
    const position = fence.indexOf('5:00');
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    state = state.update({ changes: { from: position, to: position + 4, insert: '6:00' }, annotations: isolateHistory.of('full') }).state;
    expect(state.field(sectionField).noteBlocks[id].version).toBe(1);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(sectionField).rawContent).toBe(fence);
    expect(state.field(sectionField).noteBlocks[id].version).toBe(1);
    expect(redo({ state, dispatch })).toBe(true);
    const saved = { ...state.field(sectionField).noteBlocks[id], sourceRevision: 2, version: 2 };
    state = state.update({ effects: sectionSaved.of({ blocks: { [id]: saved }, sourceRevision: 2 }) }).state;
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(sectionField).noteBlocks[id].version).toBe(2);
    expect(state.field(sectionField).sourceRevision).toBe(2);
    expect(state.field(sectionField).rawContent).toBe(fence);
  });

  it('rebases an asynchronous save without overwriting newer draft source or ranges', () => {
    const blocks = reconcileNoteBlocks(fence, { sourceRevision: 1 });
    const id = Object.keys(blocks)[0];
    let state = EditorState.create({ doc: fence, extensions: [sectionField, sectionIdentity.of({ blocks, sourceRevision: 1 })] });
    state = state.update({ changes: { from: 0, insert: '# New prose\n\n' } }).state;
    const draft = state.field(sectionField);
    state = state.update({ effects: sectionSaved.of({ blocks: { [id]: { ...blocks[id], version: 2, sourceRevision: 2 } }, sourceRevision: 2 }) }).state;
    expect(state.field(sectionField).rawContent).toBe(draft.rawContent);
    expect(state.field(sectionField).noteBlocks[id].from).toBe(draft.noteBlocks[id].from);
    expect(state.field(sectionField).noteBlocks[id].version).toBe(2);
    expect(state.field(sectionField).noteBlocks[id].sourceRevision).toBe(2);
  });

  it('reopens exact CRLF source and keeps authored slices through edit, undo and redo', () => {
    const source = '# 😀\r\n\r\n```log:running\r\n5:00 Run\r\n```\r\n';
    const blocks = reconcileNoteBlocks(source, { sourceRevision: 4 });
    const id = Object.keys(blocks)[0];
    let state = EditorState.create({ doc: source, extensions: [sectionField, sectionIdentity.of({ rawContent: source, blocks, sourceRevision: 4 }), history(), sectionIdentityHistory] });
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    state = state.update({ changes: { from: 0, insert: 'New 😀\n\n' }, annotations: isolateHistory.of('full') }).state;
    const current = state.field(sectionField);
    expect(current.rawContent).toBe('New 😀\r\n\r\n' + source);
    expect(current.rawContent.slice(current.noteBlocks[id].from, current.noteBlocks[id].to)).toBe('```log:running\r\n5:00 Run\r\n```');
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(sectionField).rawContent).toBe(source);
    expect(state.field(sectionField).noteBlocks[id]).toEqual(blocks[id]);
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(sectionField).rawContent).toBe(current.rawContent);
  });

  it('keeps the frontmatter separator when replacing a serialized property body', () => {
    const source = '---\r\nformat: ""\r\ndomain: ""\r\n---\r\nBody';
    let state = EditorState.create({ doc: source, extensions: [sectionField, sectionIdentity.of({ rawContent: source, blocks: {}, sourceRevision: 1 })] });
    const section = state.field(sectionField).sections.find(section => section.type === 'frontmatter')!;
    state = state.update({ changes: { from: section.contentFrom!, to: section.contentTo!, insert: 'format: amrap\ndomain: parkour' } }).state;
    expect(state.field(sectionField).rawContent).toBe('---\r\nformat: amrap\r\ndomain: parkour\r\n---\r\nBody');
    expect(state.field(sectionField).sections[0].type).toBe('frontmatter');
    expect(state.field(sectionField).sections[0].id).toBe(section.id);
  });

  it('uses actual widget registration and authoritative external restore', () => {
    const source = '```widget:custom\ntext\n```';
    const blocks = reconcileNoteBlocks(source, { sourceRevision: 5, registeredWidgets: ['custom'] });
    let state = EditorState.create({ doc: '', extensions: [sectionField, registeredSectionWidgets.of(['custom'])] });
    state = state.update({ changes: { from: 0, insert: source }, effects: sectionRestore.of({ rawContent: source, blocks, sourceRevision: 5 }) }).state;
    expect(state.field(sectionField).noteBlocks).toEqual(blocks);
    expect(state.field(sectionField).sections[0].type).toBe('widget');
    const reopened = EditorState.create({ doc: source, extensions: [sectionField, registeredSectionWidgets.of(['custom']), sectionIdentity.of({ rawContent: source, blocks, sourceRevision: 5 })] });
    expect(reopened.field(sectionField).noteBlocks).toEqual(blocks);
  });
});
