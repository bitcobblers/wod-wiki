import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/QueryService';
import type { BlockIndexRow, Note } from '@bitcobblers/wod-wiki-core';
import type { ParsedFindQuery } from '../src/wql';
import { actionableFixture } from './harness/actionable';

const TS_BASE = 1_700_000_000_000;
const DAY = 86_400_000;

function makeNote(id: string, createdAt: number): Note {
  return actionableFixture({ id, title: id, createdAt, type: 'note' }, [{ id: 's', body: '10 Push-ups' }]).note;
}

function makeBlock(noteId: string, createdAt: number): BlockIndexRow {
  return actionableFixture({ id: noteId, title: noteId, createdAt }, [{ id: 's', body: '10 Push-ups' }]).blocks[0]!;
}

const T0 = TS_BASE;
const T_RECENT = TS_BASE - 5 * DAY;
const T_OLD = TS_BASE - 30 * DAY;

const NOTES: Note[] = [
  makeNote('old', T_OLD),
  makeNote('recent', T_RECENT),
  makeNote('newest', T0),
];
const BLOCKS: BlockIndexRow[] = NOTES.map(n => makeBlock(n.id, n.createdAt));

function makeService(notes: Note[] = NOTES, blocks: BlockIndexRow[] = BLOCKS) {
  return new QueryService({
    noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    blockStore: { getAllBlocks: async () => blocks },
  });
}

const LAST_2W: ParsedFindQuery = {
  family: 'find',
  raw: ':note{source:journal} last 2w', target: 'note',
  filters: [{ key: 'source', negate: false, values: [{ value: 'journal', wildcard: false }] }],
  window: { kind: 'relative', size: 2, unit: 'w' },
};

describe("wall-clock window anchoring (#1009)", () => {
  it('windows against anchorNow timestamp', async () => {
    const service = makeService();
    const result = await service.runFind(LAST_2W, { anchorNow: T0 });
    expect(result.notes.map(n => n.id).sort()).toEqual(['newest', 'recent']);
  });

  it('default (no anchorNow) checks against wall-clock now', async () => {
    const service = makeService();
    const result = await service.runFind(LAST_2W);
    expect(result.notes).toEqual([]);
  });

  it('the query window wins over the host range option (ticket 12 precedence)', async () => {
    const service = makeService();
    // `last 2w` anchored at T0 → [recent, newest]; the host range around
    // T_OLD is only a default and does not override the explicit window.
    const result = await service.runFind(LAST_2W, {
      anchorNow: T0,
      range: { start: T_OLD, end: T_OLD, endExclusive: false },
    });
    expect(result.notes.map(n => n.id).sort()).toEqual(['newest', 'recent']);
  });
});
