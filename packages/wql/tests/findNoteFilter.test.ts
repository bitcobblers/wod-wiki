import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/QueryService';
import { parseQuery, type ParsedFindQuery } from '../src/wql';
import { actionableFixture } from './harness/actionable';

const fixtures = ['Fran', 'Cindy', 'Murph'].map((title, index) => actionableFixture(
  { id: `note-${index + 1}`, title: `${title} Note`, createdAt: (index + 1) * 1000, type: 'note' },
  index < 2 ? [{ id: 'seg-1', body: `${title} WOD`, blockContentId: `bc-${index + 1}` }] : [],
));
const testNotes = fixtures.map(fixture => fixture.note);
const testBlocks = fixtures.flatMap(fixture => fixture.blocks);

function makeService() {
  return new QueryService({
    noteStore: { getAllNotes: async () => testNotes, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    blockStore: { getAllBlocks: async () => testBlocks },
  });
}

describe('note: filter in runFind and runFindBlock', () => {
  it('filters notes by exact note id', async () => {
    const service = makeService();
    const parsed = parseQuery(':note{note:note-2}') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.notes.map(n => n.id)).toEqual(['note-2']);
  });

  it('filters notes with negated note id', async () => {
    const service = makeService();
    const parsed = parseQuery(':note{!note:note-2}') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.notes.map(n => n.id)).toEqual(['note-1', 'note-3']);
  });

  it('filters notes with multiple OR values for note id', async () => {
    const service = makeService();
    const parsed = parseQuery(':note{note:note-1|note-3}') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.notes.map(n => n.id)).toEqual(['note-1', 'note-3']);
  });

  it('filters blocks by parent noteId', async () => {
    const service = makeService();
    const parsed = parseQuery(':block{note:note-1}') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.blocks.map(b => b.id)).toEqual(['note-1:seg-1']);
  });

  it('filters blocks with negated parent noteId', async () => {
    const service = makeService();
    const parsed = parseQuery(':block{!note:note-1}') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.blocks.map(b => b.id)).toEqual(['note-2:seg-1']);
  });
});

describe('#1047 — pipes on find queries', () => {
  it(':note | order by title | limit N returns N notes in title order', async () => {
    const service = makeService();
    const parsed = parseQuery(':note | order by title | limit 2') as ParsedFindQuery;
    expect(parsed.error).toBeUndefined();
    const result = await service.runFind(parsed);
    expect(result.notes.map(n => n.title)).toEqual(['Cindy Note', 'Fran Note']);
  });

  it(':note | order by title desc reverses the order', async () => {
    const service = makeService();
    const parsed = parseQuery(':note | order by title desc') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.notes.map(n => n.title)).toEqual(['Murph Note', 'Fran Note', 'Cindy Note']);
  });

  it(':block | limit N caps the block list', async () => {
    const service = makeService();
    const parsed = parseQuery(':block | limit 1') as ParsedFindQuery;
    expect(parsed.error).toBeUndefined();
    const result = await service.runFind(parsed);
    expect(result.blocks).toHaveLength(1);
  });

  it(':note | limit N offset M pages the list', async () => {
    const service = makeService();
    const parsed = parseQuery(':note | order by title | limit 1 offset 1') as ParsedFindQuery;
    const result = await service.runFind(parsed);
    expect(result.notes.map(n => n.title)).toEqual(['Fran Note']);
  });
});
