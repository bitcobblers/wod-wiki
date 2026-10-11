import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'bun:test';
import { parseQuery, isFindQuery } from '@bitcobblers/wod-wiki-engine';
import { queryService, indexedDbBlockStore } from './queryService';
import { storage } from '@/services/storage';
import type { BlockIndexRow, Note } from '@/types/storage';
import { QueryService } from '@bitcobblers/wod-wiki-wql';

function parseFindQuery(raw: string) {
  const parsed = parseQuery(raw);
  if (!isFindQuery(parsed)) {
    throw new Error(`Expected a find query: ${raw}`);
  }
  return parsed;
}

function corpusRow(partial: Partial<BlockIndexRow>): BlockIndexRow {
  return {
    id: 'static:note:seg:1',
    noteId: 'note',
    segmentId: 'seg',
    segmentVersion: 1,
    position: 0,
    dataType: 'markdown',
    rawContent: '',
    noteTitle: 'Note',
    createdAt: 0,
    isStatic: true,
    sourceId: 'collection:note',
    ...partial,
  } as BlockIndexRow;
}

// The importer's actual output: every corpus note lands in `notes` with its
// canonical UUID identity, catalog family and sourceId. This fixture plays
// that — canonical notes for the note plane; the path-keyed block rows below
// stay the block-plane filter fixture (block regressions are separate).
const FRAN: Note = {
  id: '0f0e0d0c-0b0a-4998-8765-4321fedcba98',
  title: 'Fran',
  createdAt: 0,
  type: 'note',
  sourceId: 'collection:crossfit-girls/fran',
  catalog: 'crossfit-girls',
  sourcePath: 'collections/crossfit-girls/fran.md',
  seedOrigin: 'seed',
};
const DAY_01: Note = {
  id: '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
  title: 'Day 01',
  createdAt: Date.parse('2026-01-12T12:00:00Z'),
  type: 'note',
  sourceId: 'feed:feeds/dan-john/2026-01-12/day-01',
  catalog: 'dan-john',
  sourcePath: 'feeds/dan-john/2026-01-12/day-01.md',
  seedOrigin: 'seed',
};

beforeAll(async () => {
  for (const note of [FRAN, DAY_01]) await storage.readwrite('notes').put(note);
  const rows: BlockIndexRow[] = [
    corpusRow({ id: 'static:crossfit-girls/fran:front:1', noteId: 'crossfit-girls/fran', sourceId: 'collection:crossfit-girls/fran', dataType: 'frontmatter', rawContent: 'tags: [benchmark]' }),
    corpusRow({ id: 'static:crossfit-girls/fran:body:1', noteId: 'crossfit-girls/fran', sourceId: 'collection:crossfit-girls/fran', noteTitle: 'Fran' }),
    corpusRow({ id: 'static:feeds/dan-john/2026-01-12/day-01:body:1', noteId: 'feeds/dan-john/2026-01-12/day-01', sourceId: 'feed:feeds/dan-john/2026-01-12/day-01', noteTitle: 'Day 01' }),
  ];
  for (const row of rows) await storage.readwrite('block_index').put(row);
});

describe('queryService with the seeded corpus', () => {
  it('intersects repeated type and note clauses on the offline block adapter', async () => {
    const service = new QueryService({ blockStore: indexedDbBlockStore });
    for (const raw of [
      ':block{type:markdown,type:frontmatter} | limit 1',
      ':block{note:"crossfit-girls/fran",note:missing} | limit 1',
    ]) {
      const result = await service.runFind(parseFindQuery(raw));
      expect(result.blocks).toEqual([]);
      expect(result.stages.matched).toBe(0);
    }
  });
  it('does not duplicate rows when a block clause repeats', async () => {
    const service = new QueryService({ blockStore: indexedDbBlockStore });
    for (const raw of [
      ':block{type:markdown,type:markdown}',
      ':block{note:"crossfit-girls/fran",note:"crossfit-girls/fran"}',
    ]) {
      const result = await service.runFind(parseFindQuery(raw));
      expect(result.blocks.map(row => row.id)).toEqual(raw.includes('type:')
        ? ['static:crossfit-girls/fran:body:1']
        : ['static:crossfit-girls/fran:body:1', 'static:crossfit-girls/fran:front:1']);
    }
  });


  it('discovers the collection corpus from canonical notes when querying scope feeds', async () => {
    const query = parseFindQuery(':note in feeds');
    const result = await queryService.runFind(query);
    // The feeds scope selects collection-family notes by sourceId — the
    // feed-dated journal note (DAY_01) must never leak into the result.
    expect(result.notes.map((n) => n.id)).toEqual([FRAN.id]);
    expect(result.notes[0]).toMatchObject({
      title: 'Fran',
      sourceId: 'collection:crossfit-girls/fran',
      catalog: 'crossfit-girls',
    });
  });

  it('rejects the retired collections source scope', () => {
    const query = parseQuery(':note in collections');
    expect(query.error).toBeDefined();
  });


  it('discovers blocks from the corpus when querying :block in all', async () => {
    const query = parseFindQuery(':block in all');
    const result = await queryService.runFind(query);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.some((b) => b.sourceId?.startsWith('collection:'))).toBe(true);
    expect(result.blocks.some((b) => b.sourceId?.startsWith('feed:'))).toBe(false);
  });
});
