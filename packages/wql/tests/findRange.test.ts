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
const T_OLD = TS_BASE - 30 * DAY;
const T_NEW = TS_BASE + DAY;

const NOTES: Note[] = [
  makeNote('old', T_OLD),
  makeNote('mid', T0),
  makeNote('new', T_NEW),
];
const BLOCKS: BlockIndexRow[] = NOTES.map(n => makeBlock(n.id, n.createdAt));

function makeService() {
  return new QueryService({
    noteStore: { getAllNotes: async () => NOTES, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    blockStore: { getAllBlocks: async () => BLOCKS },
  });
}

describe('range parameter — runFind', () => {
  it('drops notes outside the [start, end] range', async () => {
    const service = makeService();
    const parsed: ParsedFindQuery = {
      family: 'find', raw: ':note', target: 'note', filters: [] };
    const result = await service.runFind(parsed, { range: { start: T0, end: T0 } });
    expect(result.notes.map(n => n.id)).toEqual(['mid']);
  });
  it('is inclusive at the boundary (start === note.createdAt)', async () => {
    const service = makeService();
    const parsed: ParsedFindQuery = {
      family: 'find', raw: ':note', target: 'note', filters: [] };
    const result = await service.runFind(parsed, { range: { start: T0, end: T_NEW } });
    expect(result.notes.map(n => n.id).sort()).toEqual(['mid', 'new']);
  });

  it('the WQL window wins over the host range; the range applies alone (ticket 12)', async () => {
    const service = makeService();
    const parsed: ParsedFindQuery = {
      family: 'find',
      raw: ':note last 8w',
      target: 'note',
      filters: [],
      window: { kind: 'relative', size: 8, unit: 'w' },
    };
    // Query window wins — the old host range around T_OLD does not override it.
    const result = await service.runFind(parsed, {
      range: { start: T_OLD, end: T_OLD, endExclusive: false },
      anchorNow: TS_BASE,
    });
    // Query window wins — the old host range around T_OLD does not override
    // it. `last 8w` ends at the captured instant: 'new' (T0+1d, the future)
    // is excluded, never silently extended into.
    expect(result.notes.map(n => n.id).sort()).toEqual(['mid', 'old']);

    // Without a window, the host range is the default.
    const noWindow: ParsedFindQuery = { family: 'find', raw: ':note', target: 'note', filters: [] };
    const byRange = await service.runFind(noWindow, { range: { start: T_OLD, end: T_OLD, endExclusive: false } });
    expect(byRange.notes.map(n => n.id)).toEqual(['old']);
  });

  it('omitting the range leaves the WQL `last` clause in effect', async () => {
    const service = makeService();
    const parsed: ParsedFindQuery = {
      family: 'find',
      raw: ':note last 8w',
      target: 'note',
      filters: [],
      window: { kind: 'relative', size: 8, unit: 'w' },
    };
    const result = await service.runFind(parsed);
    expect(result.notes).toEqual([]);
  });
});

describe('range parameter — runFindBlock', () => {
  it('filters blocks by the range parameter', async () => {
    const service = makeService();
    const parsed: ParsedFindQuery = {
      family: 'find', raw: ':block', target: 'block', filters: [] };
    const result = await service.runFind(parsed, { range: { start: T0, end: T0 } });
    expect(result.blocks.map(b => b.noteId)).toEqual(['mid']);
  });
});
