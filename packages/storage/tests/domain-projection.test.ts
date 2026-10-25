import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '../src/sql';
import type { Note } from '../src/entities';
import { catalogOfItem, notebookOfItem, sourceMatches } from '@bitcobblers/wod-wiki-wql';

/**
 * Ticket 02 — the storage wire's source predicates and the JS predicate are
 * one decision. `sourceKindSql` (SQL over `source_id`) and `sourceMatches`
 * (residual JS filter) must derive from the SAME sourceId-shape table, and
 * the materialized `journal`/`catalog` columns must equal the resolver's
 * answer — never a second, prefix-only decision.
 */

const uuid = (n: number): string => `01950000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: overrides.id,
    rawContent: '',
    sourceRevision: 1,
    blocks: {},
    createdAt: 1000,
    ...overrides,
  };
}

/** One note per storage-identity shape, including the two-convention corpus
 *  rows (sourceId-stamped and sourcePath-only legacy rows). */
const notes: Note[] = [
  note({ id: uuid(1), title: 'Journal' }),
  note({ id: uuid(2), title: 'Fran', sourceId: 'collection:girls/fran', catalog: 'girls', seedOrigin: 'seed', sourcePath: 'markdown/collections/girls/fran.md' }),
  note({ id: uuid(3), title: 'Girls', sourceId: 'page:collection:girls', catalog: 'girls', notebookId: 'notebook/girls', seedOrigin: 'seed' }),
  note({ id: uuid(4), title: 'Post', sourceId: 'feed:feeds/community/2024-01-01/post', seedOrigin: 'seed', sourcePath: 'markdown/feeds/community/2024-01-01/post.md' }),
  note({ id: uuid(5), title: 'Home', sourceId: 'page', seedOrigin: 'seed' }),
  note({ id: uuid(6), title: 'Guide', sourceId: 'guides:guide/clock', seedOrigin: 'seed', sourcePath: 'markdown/canvas/guide/clock.md' }),
  note({ id: uuid(7), title: 'Draft', sourceId: 'playground', type: 'playground', seedOrigin: 'user' }),
  note({ id: uuid(8), title: 'Legacy draft', type: 'playground', seedOrigin: 'user' }),
  note({ id: uuid(9), title: 'Air Squat', sourceId: 'efforts', seedOrigin: 'seed', sourcePath: 'markdown/efforts/bodyweight/air-squat.md' }),
  note({ id: uuid(10), title: 'Path-only effort', seedOrigin: 'seed', sourcePath: 'markdown/efforts/running/5k.md' }),
  note({ id: uuid(11), title: 'Air Bike', sourceId: 'equipment', seedOrigin: 'seed', sourcePath: 'markdown/equipment/air-bike.md' }),
  note({ id: uuid(12), title: 'PR Board', sourceId: 'dashboards', type: 'dashboard', seedOrigin: 'seed', sourcePath: 'markdown/dashboards/benchmark-pr-board.md' }),
  note({ id: uuid(13), title: 'Typed dashboard', type: 'dashboard', seedOrigin: 'user' }),
  note({ id: uuid(14), title: 'Open Prep', notebookId: 'notebook/open-prep', seedOrigin: 'user' }),
  note({ id: uuid(15), title: 'Peaking Squat', tags: ['notebook:mine'], seedOrigin: 'user' }),
  note({ id: uuid(16), title: 'Equipment row', sourceId: 'equipment', seedOrigin: 'seed' }),
];

const SOURCE_KINDS = ['feeds', 'pages', 'guides', 'playground', 'efforts', 'equipment', 'dashboards', 'journal', 'feed', 'page', 'guide'] as const;

async function makeStorage() {
  const db = libsqlDatabase(createClient({ url: ':memory:' }));
  const server = new SqlStorage(db);
  await server.transaction(['notes'], 'readwrite', async (tx) => {
    for (const n of notes) await tx.readwrite('notes').put(n);
  });
  return { db, server };
}

describe('domain source identity — one shared projection', () => {
  it('matches source: kinds identically on the storage wire and in the JS predicate', async () => {
    const { server } = await makeStorage();
    try {
      for (const kind of SOURCE_KINDS) {
        const result = await server.queryDomain({
          plan: 'notes',
          selection: [{ field: 'source', values: [kind] }],
        });
        expect(result, kind).toBeDefined();
        const sqlIds = (result!.rows as Note[]).map((n) => n.id).sort();
        const jsIds = notes.filter((n) => sourceMatches(n, kind)).map((n) => n.id).sort();
        expect(sqlIds, kind).toEqual(jsIds);
      }
    } finally {
      await server.close();
    }
  });

  it('materializes the journal column and the catalog column as the resolver\'s answer', async () => {
    const { server } = await makeStorage();
    try {
      const result = await server.queryDomain({ plan: 'notes' });
      expect(result).toBeDefined();
      const byId = new Map((result!.rows as Note[]).map((n) => [n.id, n]));
      for (const n of notes) {
        expect(byId.get(n.id), n.id).toBeDefined();
        // Bare page rows (the home page) are the one identity outside every notebook.
        if (n.sourceId !== 'page') expect(notebookOfItem(n), n.id).toBeDefined();
      }
      // Journal projection: exactly the resolver's journal answer.
      const journal = await server.queryDomain({
        plan: 'notes',
        selection: [{ field: 'source', values: ['journal'] }],
      });
      expect((journal!.rows as Note[]).map((n) => n.id).sort()).toEqual(
        notes.filter((n) => sourceMatches(n, 'journal')).map((n) => n.id).sort(),
      );
      // User-notebook notes are NOT journal — the explicit notebookId and the
      // notebook: tag outrank the journal fallback on the wire and in JS.
      const journalIds = new Set((journal!.rows as Note[]).map((n) => n.id));
      for (const userNb of [uuid(14), uuid(15)]) {
        expect(journalIds.has(userNb), userNb).toBe(false);
        expect(sourceMatches(notes.find((n) => n.id === userNb)!, 'journal'), userNb).toBe(false);
        expect(notebookOfItem(notes.find((n) => n.id === userNb)!), userNb).not.toBe('notebook/journal');
      }
      // Ordinary journal notes remain.
      expect(journalIds.has(uuid(1))).toBe(true);
      // The WQL source fence spans the whole domain on both planes —
      // including the equipment identity the hand list used to drop.
      const fence = await server.queryDomain({
        plan: 'notes',
        selection: [{ field: 'sourceFence' }],
      });
      const fenceIds = (fence!.rows as Note[]).map((n) => n.id).sort();
      expect(fenceIds).toEqual(notes.filter((n) => sourceMatches(n, 'all')).map((n) => n.id).sort());
      expect(fenceIds).toContain(uuid(11));
      expect(fenceIds).toContain(uuid(16));
      // Corpus rows resolve through the corpus-path tier and the source-id
      // tier to the same notebook.
      expect(notebookOfItem(byId.get(uuid(9))!)).toBe('notebook/efforts');
      expect(notebookOfItem(byId.get(uuid(10))!)).toBe('notebook/efforts');
      expect(notebookOfItem(byId.get(uuid(4))!)).toBe('notebook/community');
      expect(notebookOfItem(byId.get(uuid(13))!)).toBe('notebook/dashboards');
      // Catalog projection stays the sourceId/catalog answer for collections
      // and feeds — and path-only corpus rows carry no catalog.
      expect(catalogOfItem(byId.get(uuid(2))!)).toBe('girls');
      expect(catalogOfItem(byId.get(uuid(4))!)).toBe('community');
      expect(catalogOfItem(byId.get(uuid(10))!)).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
