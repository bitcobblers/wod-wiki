import { describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks, mapNoteBlockChanges } from '@bitcobblers/wod-wiki-core';
import { deriveWorkbenchDocumentState } from './workbenchDocumentModel';

const content = '# Workout\n\n```time\n5:00 Run\n```';

describe('deriveWorkbenchDocumentState', () => {
  it('returns an empty sparse map with empty presentation', () => {
    expect(deriveWorkbenchDocumentState('')).toEqual({ sections: [], blocks: [], noteBlocks: {}, rawContent: '', sourceRevision: 1 });
  });

  it('hydrates workout bodies with parsed statements and persisted IDs on reopen', () => {
    const noteBlocks = reconcileNoteBlocks(content, { sourceRevision: 3 });
    const block = Object.values(noteBlocks)[0];
    block.version = 7;
    const state = deriveWorkbenchDocumentState(content, { noteBlocks, sourceRevision: 3 });
    expect(state.blocks[0].statements?.length).toBeGreaterThan(0);
    expect(state.blocks[0].state).toBe('parsed');
    expect(state.blocks[0].id).toBe(block.id);
    expect(state.blocks[0].version).toBe(7);
    expect(state.noteBlocks).toEqual(noteBlocks);
  });

  it('uses mapped lineage after prose insertion rather than guessing by position', () => {
    const previous = deriveWorkbenchDocumentState(content);
    const insert = 'Prose 😀\n\n';
    const next = deriveWorkbenchDocumentState(insert + content, { noteBlocks: mapNoteBlockChanges(previous.noteBlocks, [{ from: 0, to: 0, insert }]) });
    expect(next.blocks[0].id).toBe(previous.blocks[0].id);
    expect(next.noteBlocks[next.blocks[0].id].from).toBe(previous.noteBlocks[previous.blocks[0].id].from + insert.length);
  });

  it('keeps duplicate histories separate and recognizes only actionables', () => {
    const source = '```time\n5:00 Run\n```\n\n```time\n5:00 Run\n```\n\n```query\n:block{}\n```';
    const state = deriveWorkbenchDocumentState(source);
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[0].id).not.toBe(state.blocks[1].id);
    expect(state.blocks[0].contentId).toBe(state.blocks[1].contentId);
    expect(Object.values(state.noteBlocks).map(block => block.kind)).toEqual(['wod', 'wod', 'query']);
  });

  it('retains exact CRLF source and full fence history ranges', () => {
    const source = '# 😀\r\n\r\n```log:running\r\n5:00 Run\r\n```\r\n';
    const state = deriveWorkbenchDocumentState(source);
    const block = Object.values(state.noteBlocks)[0];
    expect(state.rawContent).toBe(source);
    expect(source.slice(block.from, block.to)).toBe('```log:running\r\n5:00 Run\r\n```');
    expect(state.blocks[0].content).toBe('5:00 Run\r\n');
  });

  it('does not turn prose into persisted blocks', () => {
    const state = deriveWorkbenchDocumentState('# Notes\n\nSome text');
    expect(state.blocks).toHaveLength(0);
    expect(Object.keys(state.noteBlocks)).toHaveLength(0);
    expect(state.sections.length).toBeGreaterThan(0);
  });
});
