import { describe, expect, it  } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { history, undo, redo, isolateHistory, moveLineDown } from '@codemirror/commands';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import {
  editorPreset,
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
  registerCustomCompletionSource,
  unregisterCustomCompletionSource,
  wodAutocompletion,
} from '../src/extensions';
import { EditorView } from '@codemirror/view';

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

  it('registerCustomCompletionSource allows custom sources to participate in autocompletion', () => {
    let sourceInvoked = false;
    const dummySource = () => {
      sourceInvoked = true;
      return null;
    };

    registerCustomCompletionSource(dummySource);
    const state = EditorState.create({
      doc: 'test',
      extensions: [wodAutocompletion],
    });
    expect(state).toBeDefined();
    unregisterCustomCompletionSource(dummySource);
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
