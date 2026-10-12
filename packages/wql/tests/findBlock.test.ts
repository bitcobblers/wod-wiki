import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/QueryService';
import { parseQuery, isFindQuery } from '../src/wql';
import { actionableFixture } from './harness/actionable';
import type { BlockIndexRow } from '@bitcobblers/wod-wiki-core';

const fixtures = [
  actionableFixture({ id: 'n1', title: 'Fran', createdAt: 1 }, [{ id: 'w1', body: '21-15-9\nThrusters 95lb\nPull-ups', blockContentId: 'bc-fran' }]),
  actionableFixture({ id: 'n2', title: 'Queries', createdAt: 2 }, [{ id: 'q1', kind: 'query', body: ':note{text:Fran}' }]),
  actionableFixture({ id: 'n3', title: 'Hints', createdAt: 3 }, [{ id: 'h1', kind: 'widget', body: 'Remember to scale Fran' }]),
];
const notes = fixtures.map(f => f.note);
const blocks = fixtures.flatMap(f => f.blocks);
function service(rows = blocks) {
  return new QueryService({
    noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
    blockStore: { getAllBlocks: async () => rows },
  });
}
async function find(raw: string, rows = blocks) {
  const parsed = parseQuery(raw);
  if (!isFindQuery(parsed) || parsed.error) throw new Error(raw);
  return service(rows).runFind(parsed);
}

describe(':block actionable source', () => {
  it('returns actionable workout, query and registered widget occurrences', async () => {
    const result = await find(':block{}');
    expect(result.blocks.map(b => b.dataType)).toEqual(['wod', 'query', 'widget']);
    expect(result.stages).toEqual({ selected: 3, matched: 3 });
    expect(result.notes).toEqual([]);
  });
  it('searches exact authored slices and combines type and text filters', async () => {
    expect((await find(':block{text:Fran}')).blocks.map(b => b.blockId)).toEqual(['q1', 'h1']);
    expect((await find(':block{text:thrusters,type:wod}')).blocks.map(b => b.blockId)).toEqual(['w1']);
  });
  it('does not trust projected content as authored source', async () => {
    const result = await find(':block{text:thrusters}', [{ ...blocks[0]!, rawContent: 'wrong projection' }]);
    expect(result.blocks[0]?.rawContent).toBe(notes[0]!.rawContent.slice(blocks[0]!.from, blocks[0]!.to));
  });
  it.each([
    { blockVersion: 2 }, { sourceRevision: 2 }, { from: 1 }, { to: 1 }, { blockId: 'missing' },
    { noteId: 'missing' }, { dataType: 'prose' }, { id: 'old-version-key' },
  ])('fails closed for mismatched projection %o', async invalid => {
    const rows = [{ ...blocks[0]!, ...invalid } as BlockIndexRow];
    expect((await find(':block{}', rows)).blocks).toEqual([]);
  });
  it('does not hydrate from a corrupt or missing parent source map', async () => {
    for (const blocks of [undefined, { w1: { ...notes[0]!.blocks.w1!, from: 1 } }]) {
      const note = { ...notes[0]!, blocks };
      const engine = new QueryService({
        noteStore: { getAllNotes: async () => [note] as typeof notes, getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
        blockStore: { getAllBlocks: async () => fixtures[0]!.blocks },
      });
      const parsed = parseQuery(':block{}');
      if (!isFindQuery(parsed)) throw new Error('find');
      expect((await engine.runFind(parsed)).blocks).toEqual([]);
    }
  });
  it('applies order and pagination to validated occurrences', async () => {
    expect((await find(':block{} | order by noteTitle desc | limit 1 offset 1')).blocks.map(b => b.blockId)).toEqual(['h1']);
  });
  it('searches prose-only Note bodies without producing blocks', async () => {
    const note = { id: 'prose', title: 'Journal', createdAt: 1, rawContent: '# Recovery\n\nBody-only café phrase.', sourceRevision: 1, blocks: {} };
    const engine = new QueryService({ noteStore: { getAllNotes: async () => [note], getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] } });
    const parsed = parseQuery(':note{text:"CAFÉ phrase"}');
    if (!isFindQuery(parsed)) throw new Error('find');
    expect((await engine.runFind(parsed)).notes).toEqual([note]);
  });
  it('validates interactive embed ranges without treating prose as blocks', async () => {
    const rawContent = '[Training video](https://youtu.be/example)';
    const note = { id: 'embed-note', title: 'Video', createdAt: 1, rawContent, sourceRevision: 1,
      blocks: { e1: { id: 'e1', kind: 'embed' as const, version: 1, sourceRevision: 1, from: 0, to: rawContent.length } } };
    const row: BlockIndexRow = { id: 'embed-note:e1', noteId: note.id, blockId: 'e1', blockVersion: 1,
      sourceRevision: 1, from: 0, to: rawContent.length, dataType: 'embed', rawContent, noteTitle: note.title, createdAt: 1 };
    const engine = new QueryService({
      noteStore: { getAllNotes: async () => [note], getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
      blockStore: { getAllBlocks: async () => [row] },
    });
    const parsed = parseQuery(':block{type:embed,text:video}');
    if (!isFindQuery(parsed)) throw new Error('find');
    expect((await engine.runFind(parsed)).blocks).toEqual([row]);
  });
  it('reapplies counts and pagination when a candidate page is stale', async () => {
    const stale = { ...blocks[0]!, sourceRevision: 2 };
    const engine = new QueryService({
      noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
      blockStore: { getAllBlocks: async () => [stale, blocks[1]!, blocks[2]!], queryDomain: async () => ({
        plan: 'blocks', projectionVersion: 1, selectedCount: 3, matchedCount: 3, rows: [stale],
      }) },
    });
    const parsed = parseQuery(':block{} | limit 1');
    if (!isFindQuery(parsed)) throw new Error('find');
    const result = await engine.runFind(parsed);
    expect(result.blocks.map(block => block.blockId)).toEqual(['q1']);
    expect(result.stages).toEqual({ selected: 2, matched: 1 });
  });
  it('keeps effort containment occurrence-scoped even for equal fingerprints', async () => {
    const duplicate = actionableFixture({ id: 'duplicate', title: 'Duplicate', createdAt: 4 }, [
      { id: 'a', body: '10 Thrusters', blockContentId: 'same' },
      { id: 'b', body: '10 Thrusters', blockContentId: 'same' },
    ]);
    const engine = new QueryService({
      noteStore: { getAllNotes: async () => [duplicate.note], getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
      blockStore: { getAllBlocks: async () => duplicate.blocks },
      blockEffortsStore: { getAllFromIndex: async () => [{ noteId: 'duplicate', blockId: 'a', effortSlug: 'thruster' }] },
    });
    const parsed = parseQuery(':block{effort:thruster}');
    if (!isFindQuery(parsed)) throw new Error('find');
    expect((await engine.runFind(parsed)).blocks.map(block => block.blockId)).toEqual(['a']);
  });
});
