import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/QueryService';
import { parseQuery, type ParsedFindQuery } from '../src/wql';
import type { BlockIndexRow, Note } from '@bitcobblers/wod-wiki-core';
import { actionableFixture } from './harness/actionable';

const TS = 1_700_000_000_000;

function makeNote(id: string, sourceId: string | undefined): Note {
  return actionableFixture({ id, title: id, createdAt: TS, type: 'note', sourceId }, [{ id: 's', body: '10 Push-ups' }]).note;
}

function makeBlock(noteId: string, sourceId: string | undefined): BlockIndexRow {
  return actionableFixture({ id: noteId, title: noteId, createdAt: TS, sourceId }, [{ id: 's', body: '10 Push-ups' }]).blocks[0]!;
}

const NOTES: Note[] = [
  makeNote('jrnl-1', undefined),
  makeNote('nb-girls', 'notebook:crossfit-girls'),
  makeNote('nb-prog', 'notebook:crossfit-programming/2026-01-12'),
  makeNote('guide-1', 'guides:guide/syntax/basics'),
  { ...makeNote('pg-1', 'playground'), type: 'playground' },
  { ...makeNote('pg-legacy', undefined), id: 'pg-legacy', type: 'playground' },
  { ...makeNote('page-1', 'notebook:crossfit-girls'), type: 'page' },
  // ── Seed corpus shapes (importer attribution + legacy rows) ──
  makeNote('seed-effort', 'efforts'),
  { ...makeNote('legacy-effort', undefined), seedOrigin: 'seed', seedChunkId: 'efforts', sourcePath: 'markdown/efforts/fran.md' } as Note,
  // User-edited legacy seed: seedOrigin flipped to 'user', provenance retained.
  { ...makeNote('edited-effort', undefined), seedOrigin: 'user', seedChunkId: 'efforts', sourcePath: 'markdown/efforts/fran.md' } as Note,
  // Legacy equipment row: sourceless, seed tree path only.
  { ...makeNote('legacy-equipment', undefined), sourcePath: 'markdown/equipment/barbell.md' } as Note,
  // Sourceless user note (no sourceId, no provenance stamps).
  { ...makeNote('user-note', undefined) } as Note,
  // Prebuilt dashboard, attributed; user vault dashboard, typed.
  { ...makeNote('seed-dash', 'dashboards'), type: 'dashboard' },
  { ...makeNote('user-dash', 'dashboards'), type: 'dashboard' },
];

const BLOCKS: BlockIndexRow[] = [
  makeBlock('jrnl-1', undefined),
  makeBlock('nb-girls', 'notebook:crossfit-girls'),
  makeBlock('nb-prog', 'notebook:crossfit-programming/2026-01-12'),
  makeBlock('guide-1', 'guides:guide/syntax/basics'),
  makeBlock('pg-1', 'playground'),
  makeBlock('pg-legacy', 'playground'),
];

function makeService() {
  return new QueryService({
    noteStore: { getAllNotes: async () => NOTES, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    blockStore: { getAllBlocks: async () => BLOCKS },
  });
}

describe('source: filter — runFind (Note[])', () => {
  it('keeps journal notes when source:journal is set — the sourceless fallback note journals too', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{source:journal} in all') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['jrnl-1', 'user-note']);
  });

  it('keeps notebook notes when source:notebooks is set — pages included', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{source:notebooks} in all') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['nb-girls', 'nb-prog', 'page-1']);
  });

  it('source:notebook:<slug> targets one notebook across id conventions', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{source:notebook:crossfit-programming} in all') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['nb-prog']);
  });

  it('source:notebook:<slug>/<date> targets that notebook item specifically', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{source:"notebook:crossfit-programming/2026-01-12"} in all') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['nb-prog']);
    const miss = await service.runFind(parseQuery(':note{source:"notebook:crossfit-programming/2026-01-13"} in all') as ParsedFindQuery);
    expect(miss.notes.map(n => n.id)).not.toContain('nb-prog');
  });

  it('!source:notebook:<slug> negation removes that notebook but keeps other sources', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{!source:notebook:crossfit-programming}') as ParsedFindQuery);
    const ids = result.notes.map(n => n.id);
    expect(ids).not.toContain('nb-prog');
    expect(ids).toContain('nb-girls');
    expect(ids).toContain('jrnl-1');
  });

  it('the retired source:feeds / source:feed forms no longer parse (ticket 12 — no alias)', () => {
    expect(parseQuery(':note{source:feeds}').error).toBeDefined();
    expect(parseQuery(':note{source:feed}').error).toBeDefined();
  });

  it(':note is the inclusive plane — notebooks, arbitrary sources, pages, typed dashboards', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note') as ParsedFindQuery);
    expect(result.notes.map(n => n.id).sort()).toEqual([
      'edited-effort', 'guide-1', 'jrnl-1', 'legacy-effort', 'legacy-equipment',
      'nb-girls', 'nb-prog', 'page-1', 'pg-1', 'pg-legacy',
      'seed-dash', 'seed-effort', 'user-dash', 'user-note',
    ]);
  });

  it('keeps only guide notes when source:guides is set', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{source:guides} in all') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['guide-1']);
  });

  it('parse-validates source:guides as a known source value', () => {
    const parsed = parseQuery(':note{source:guides}');
    expect(parsed.error).toBeUndefined();
  });

  it(':note{!source:playground} includes every note kind/source except playground', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{!source:playground}') as ParsedFindQuery);
    const ids = result.notes.map(n => n.id);
    expect(ids).toContain('jrnl-1');           // journal
    expect(ids).toContain('nb-girls');         // notebooks
    expect(ids).toContain('guide-1');          // guides
    expect(ids).toContain('nb-prog');          // notebooks (inclusive plane)
    expect(ids).toContain('page-1');           // typed pages survive
    expect(ids).toContain('seed-effort');      // attributed seed efforts
    expect(ids).toContain('legacy-effort');    // sourceless legacy seed rows
    expect(ids).toContain('legacy-equipment'); // path-classified equipment rows
    expect(ids).toContain('seed-dash');        // typed dashboards (seeded + user)
    expect(ids).toContain('user-dash');
    expect(ids).not.toContain('pg-1');
    expect(ids).not.toContain('pg-legacy');
  });

  it('regression: :journal{} never matches the seed corpus — imports leaked 1004 notes', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':journal{}') as ParsedFindQuery);
    // The seed-corpus rows stay out; the sourceless user note journals via
    // the resolver fallback.
    expect(result.notes.map(n => n.id)).toEqual(['jrnl-1', 'user-note']);
  });

  it(':dashboard{} returns seeded and user dashboards and honors text', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':dashboard{}') as ParsedFindQuery);
    expect(result.notes.map(n => n.id).sort()).toEqual(['seed-dash', 'user-dash']);
    const titled = await service.runFind(parseQuery(':dashboard{text:user}') as ParsedFindQuery);
    expect(titled.notes.map(n => n.id)).toEqual(['user-dash']);
  });

  it('source:all fails to parse with a hint', () => {
    const parsed = parseQuery(':note{source:all}');
    expect(parsed.error).toContain('source:all is retired');
  });

  it('keeps only playground entries when source:playground is set (sourceId convention and legacy type)', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{source:playground} in all') as ParsedFindQuery);
    expect(result.notes.map(n => n.id).sort()).toEqual(['pg-1', 'pg-legacy']);
  });

  it('parse-validates source:playground as a known source value', () => {
    const parsed = parseQuery(':note{source:playground}');
    expect(parsed.error).toBeUndefined();
  });

  it(':page parses to the placement plane (ticket 08)', async () => {
    const parsed = parseQuery(':page');
    expect(parsed.error).toBeUndefined();
    expect(parsed).toMatchObject({ family: 'find', target: 'page' });
    const service = new QueryService({
      noteStore: { getAllNotes: async () => NOTES, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
      blockStore: { getAllBlocks: async () => BLOCKS },
      pageStore: {
        getAllPages: async () => [{ id: '2026-10-24', slug: '2026-10-24', date: '2026-10-24', createdAt: TS }],
        getAllLinks: async () => [{ id: 'l1', pageId: '2026-10-24', noteId: 'jrnl-1', position: 0, createdAt: TS }],
      },
    });
    const result = await service.runFind(parsed as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['jrnl-1']);
    expect(result.containers['jrnl-1']).toMatchObject({ kind: 'page', slug: '2026-10-24' });
  });

  it(':note{type:page} targets notes with type page', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{type:page}') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['page-1']);
  });

  it(':note{page:true} targets notes with type page', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':note{page:true}') as ParsedFindQuery);
    expect(result.notes.map(n => n.id)).toEqual(['page-1']);
  });

  it('source:page fails to parse with a hint', () => {
    const parsed = parseQuery(':note{source:page}');
    expect(parsed.error).toContain('source:page is retired');
  });
});

describe('source: filter — runFindBlock (BlockIndexRow[])', () => {
  it('keeps only journal blocks when source:journal is set', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':block{source:journal} in all') as ParsedFindQuery);
    expect(result.blocks.map(b => b.noteId)).toEqual(['jrnl-1']);
  });

  it('keeps only notebook blocks when source:notebooks is set', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':block{source:notebooks} in all') as ParsedFindQuery);
    expect(result.blocks.map(b => b.noteId).sort()).toEqual(['nb-girls', 'nb-prog']);
  });

  it('supports exact notebook-prefixed sourceId matching', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':block{source:notebook:crossfit-girls} in all') as ParsedFindQuery);
    expect(result.blocks.map(b => b.noteId)).toEqual(['nb-girls']);
  });

  it('default (no source filter) returns blocks from the allowed source kinds only', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':block') as ParsedFindQuery);
    expect(result.blocks.map(b => b.noteId).sort()).toEqual(['guide-1', 'jrnl-1', 'nb-girls', 'nb-prog', 'pg-1', 'pg-legacy']);
  });

  it('keeps only playground blocks (denormalized sourceId) when source:playground is set', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':block{source:playground} in all') as ParsedFindQuery);
    expect(result.blocks.map(b => b.noteId).sort()).toEqual(['pg-1', 'pg-legacy']);
  });

  it('legacy in journal maps to source:journal correctly at runtime', async () => {
    const service = makeService();
    const result = await service.runFind(parseQuery(':block in journal') as ParsedFindQuery);
    expect(result.blocks.map(b => b.noteId)).toEqual(['jrnl-1']);
  });
});
