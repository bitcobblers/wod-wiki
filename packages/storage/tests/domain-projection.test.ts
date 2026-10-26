import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { SqlStorage, libsqlDatabase } from '../src/sql';
import type { Note } from '../src/entities';
import { notebookSlugOfSourceId, notebookOfItem, sourceMatches } from '@bitcobblers/wod-wiki-wql';

/**
 * Ticket 02 — the storage wire's source predicates and the JS predicate are
 * one decision. `sourceKindSql` (SQL over `source_id`) and `sourceMatches`
 * (residual JS filter) must derive from the SAME sourceId-shape table, and
 * the materialized `journal` column must equal the resolver's answer —
 * never a second, prefix-only decision.
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
  note({ id: uuid(2), title: 'Fran', sourceId: 'notebook:girls/fran', seedOrigin: 'seed', sourcePath: 'markdown/notebooks/girls/fran.md' }),
  note({ id: uuid(3), title: 'Girls', sourceId: 'page:girls', notebookId: 'notebook/girls', seedOrigin: 'seed' }),
  note({ id: uuid(4), title: 'Post', sourceId: 'notebook:community/2024-01-01/post', seedOrigin: 'seed', sourcePath: 'markdown/notebooks/community/2024-01-01/post.md' }),
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
  // A feed-delivered note the user has taken ownership of: the seed stamp
  // alone would place it in the journal, the feed stamp keeps it out — the
  // wire and the JS filter must read the same provenance.
  note({ id: uuid(17), title: 'Feed delivered', seedOrigin: 'user', feedOrigin: 'feed', feedSourceId: 'core' }),
];

const SOURCE_KINDS = ['notebooks', 'pages', 'guides', 'playground', 'efforts', 'equipment', 'dashboards', 'journal', 'page', 'guide'] as const;

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

  it('materializes the journal column as the resolver\'s answer', async () => {
    const { server } = await makeStorage();
    try {
      const result = await server.queryDomain({ plan: 'notes' });
      expect(result).toBeDefined();
      const byId = new Map((result!.rows as Note[]).map((n) => [n.id, n]));
      for (const n of notes) {
        expect(byId.get(n.id), n.id).toBeDefined();
        // Bare page rows (the home page) are the one identity outside every
        // notebook — and so is a feed-delivered note with no corpus identity:
        // its feed stamp claims no container, only its provenance.
        if (n.sourceId !== 'page' && !n.feedSourceId) expect(notebookOfItem(n), n.id).toBeDefined();
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
      // The feed stamp alone keeps a feed-delivered note out of the journal
      // fallback — the wire reads the same provenance the JS filter does.
      expect(journalIds.has(uuid(17))).toBe(false);
      expect(sourceMatches(notes.find((n) => n.id === uuid(17))!, 'journal')).toBe(false);
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
      // The notebook-slug projection stays the sourceId answer for corpus
      // rows — and path-only corpus rows carry no sourceId slug.
      expect(notebookSlugOfSourceId(byId.get(uuid(2))!.sourceId)).toBe('girls');
      expect(notebookSlugOfSourceId(byId.get(uuid(4))!.sourceId)).toBe('community');
      expect(notebookSlugOfSourceId(byId.get(uuid(10))!.sourceId)).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});

describe('typed-tag predicate — SQL pushdown through the tags by-type index (ticket 08)', () => {
  it('resolves type+label pairs in SQL, honors negation, and ignores label-only matches', async () => {
    const db = libsqlDatabase(createClient({ url: ':memory:' }));
    const server = new SqlStorage(db);
    const tagRow = (id: string, label: string, type?: string) => ({ id, label, type, createdAt: 1000 });
    const link = (id: string, noteId: string, tagId: string) => ({ id, noteId, tagId, createdAt: 1000 });
    await server.transaction(['notes', 'tags', 'note_tags'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(note({ id: uuid(21), title: 'Kettlebell note', tags: ['kettlebell'] }));
      await tx.readwrite('notes').put(note({ id: uuid(22), title: 'Timed note', tags: ['kettlebell', 'for-time'] }));
      await tx.readwrite('notes').put(note({ id: uuid(23), title: 'Plain note' }));
      await tx.readwrite('tags').put(tagRow('tag-k', 'kettlebell', 'equipment'));
      await tx.readwrite('tags').put(tagRow('tag-f', 'for-time'));
      await tx.readwrite('note_tags').put(link('nt-1', uuid(21), 'tag-k'));
      await tx.readwrite('note_tags').put(link('nt-2', uuid(22), 'tag-f'));
    });
    try {
      // The label `kettlebell` alone is not enough — the TYPE must match.
      const typed = await server.queryDomain({
        plan: 'notes',
        filters: [{ field: 'typedTag', tagType: 'equipment', values: ['kettlebell'] }],
      });
      expect(typed?.rows.map((n) => (n as Note).id)).toEqual([uuid(21)]);
      // Negation excludes the typed-tag carriers.
      const negated = await server.queryDomain({
        plan: 'notes',
        filters: [{ field: 'typedTag', tagType: 'equipment', values: ['kettlebell'], negate: true }],
      });
      expect(negated?.rows.map((n) => (n as Note).id).sort()).toEqual([uuid(22), uuid(23)]);
      // An unknown label narrows to nothing.
      const unknown = await server.queryDomain({
        plan: 'notes',
        filters: [{ field: 'typedTag', tagType: 'equipment', values: ['snorkel'] }],
      });
      expect(unknown?.rows).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
