import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'bun:test';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import { queryService, indexedDbBlockStore, indexedDbNoteStore } from './queryService';
import { storage } from '@/services/storage';
import type { BlockIndexRow, BlockRevision, Note } from '@/types/storage';
import { QueryService } from '@bitcobblers/wod-wiki-wql';

function parseFindQuery(raw: string) {
  const parsed = parseQuery(raw);
  if (!isFindQuery(parsed) || parsed.error) throw new Error(`Expected a find query: ${raw}`);
  return parsed;
}
const body = '```time\n21 Thrusters\n```';
const query = '```query\n:note{text:recovery}\n```';
const FRAN: Note = {
  id: '0f0e0d0c-0b0a-4998-8765-4321fedcba98', title: 'Fran', createdAt: 0, type: 'note',
  sourceId: 'collection:crossfit-girls/fran', catalog: 'crossfit-girls',
  sourcePath: 'collections/crossfit-girls/fran.md', seedOrigin: 'seed',
  rawContent: `${body}\n\n${query}`, sourceRevision: 1,
  blocks: {
    w1: { id: 'w1', kind: 'wod', version: 1, sourceRevision: 1, from: 0, to: body.length, dialect: 'time' },
    q1: { id: 'q1', kind: 'query', version: 1, sourceRevision: 1, from: body.length + 2, to: body.length + 2 + query.length },
  },
};
const DAY_01: Note = {
  id: '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d', title: 'Day 01',
  createdAt: Date.parse('2026-01-12T12:00:00Z'), type: 'note',
  sourceId: 'feed:feeds/dan-john/2026-01-12/day-01', catalog: 'dan-john', seedOrigin: 'seed',
  rawContent: 'Prose-only recovery café observations.', sourceRevision: 1, blocks: {},
};
beforeAll(async () => {
  await storage.transaction(['notes', 'block_revisions', 'block_index'], 'readwrite', async tx => {
    for (const block of Object.values(FRAN.blocks)) {
      const rawContent = FRAN.rawContent.slice(block.from, block.to);
      const revision: BlockRevision = { noteId: FRAN.id, blockId: block.id, version: block.version,
        kind: block.kind, rawContent, savedAt: FRAN.createdAt, dialect: block.dialect, sport: block.sport };
      await tx.readwrite('block_revisions').put(revision);
      const row: BlockIndexRow = { id: `${FRAN.id}:${block.id}`, noteId: FRAN.id, blockId: block.id,
        blockVersion: block.version, sourceRevision: FRAN.sourceRevision, from: block.from, to: block.to,
        dataType: block.kind, rawContent, noteTitle: FRAN.title,
        createdAt: FRAN.createdAt, sourceId: FRAN.sourceId, isStatic: true };
      await tx.readwrite('block_index').put(row);
    }
    for (const note of [FRAN, DAY_01]) await tx.readwrite('notes').put(note);
  });
});
const service = () => new QueryService({ noteStore: indexedDbNoteStore, blockStore: indexedDbBlockStore });

describe('queryService sparse corpus', () => {
  it('intersects repeated type and note clauses without duplicate results', async () => {
    for (const raw of [':block{type:wod,type:query} | limit 1', ':block{note:missing} | limit 1']) {
      expect((await service().runFind(parseFindQuery(raw))).blocks).toEqual([]);
    }
    expect((await service().runFind(parseFindQuery(':block{type:wod,type:wod}'))).blocks.map(row => row.blockId)).toEqual(['w1']);
  });
  it('discovers canonical imported Notes in feed scope', async () => {
    expect((await queryService.runFind(parseFindQuery(':note in feeds'))).notes.map(note => note.id)).toEqual([FRAN.id]);
    expect(parseQuery(':note in collections').error).toBeDefined();
  });
  it('searches complete prose-only Note bodies', async () => {
    expect((await queryService.runFind(parseFindQuery(':note{text:"CAFÉ observations"} in all'))).notes.map(note => note.id)).toEqual([DAY_01.id]);
  });
  it('returns actionable query and workout source with valid pins', async () => {
    const result = await service().runFind(parseFindQuery(':block{}'));
    expect(result.blocks.map(block => block.blockId)).toEqual(['q1', 'w1']);
    expect(result.stages).toEqual({ selected: 2, matched: 2 });
    expect(result.blocks.find(block => block.blockId === 'q1')?.rawContent).toBe(query);
  });
  it('keeps counts and paging on the actionable population', async () => {
    const result = await service().runFind(parseFindQuery(':block{type:wod} | limit 1'));
    expect(result.stages).toEqual({ selected: 2, matched: 1 });
    expect(result.blocks.map(block => block.blockId)).toEqual(['w1']);
  });
});
