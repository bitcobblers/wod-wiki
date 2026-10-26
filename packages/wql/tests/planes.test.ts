import { describe, expect, it } from 'vitest';
import { QueryService } from '../src/QueryService';
import { parseQuery, type ParsedFindQuery } from '../src/wql';
import type { Note, Page, PageNote, Tag } from '@bitcobblers/wod-wiki-core';
import type { NoteQueryStore, QueryServiceStores, WqlDomainPredicate } from '../src/stores';

const T0 = 1_700_000_000_000;

const note = (id: string, extra: Partial<Note> = {}): Note => ({
  id, title: id, type: 'note', createdAt: T0, rawContent: '', sourceRevision: 1, blocks: {},
  ...extra,
});

const noteStore = (notes: Note[]): NoteQueryStore => ({
  getAllNotes: async () => notes,
  getNoteIdsForTag: async (tag: string) => new Set(notes.filter((n) => n.tags?.includes(tag)).map((n) => n.id)),
  getNoteTagLabels: async () => [],
} as unknown as NoteQueryStore);

const find = (raw: string): ParsedFindQuery => {
  const parsed = parseQuery(raw);
  expect(parsed.error, raw).toBeUndefined();
  return parsed as ParsedFindQuery;
};

// ── :page{} — the placement plane ────────────────────────────────────────

describe(':page{} — the placement plane', () => {
  const pages: Page[] = [
    { id: '2026-10-24', date: '2026-10-24', createdAt: T0 },
    { id: 'pg-back-log', slug: 'back-log', title: 'Back Log', createdAt: T0 },
  ];
  const links: PageNote[] = [
    { id: 'l1', pageId: '2026-10-24', noteId: 'n-daily', position: 0, createdAt: T0 },
    { id: 'l2', pageId: 'pg-back-log', noteId: 'n-idea', position: 0, createdAt: T0 },
    // Many-to-many: one note sits on both pages.
    { id: 'l3', pageId: '2026-10-24', noteId: 'n-shared', position: 1, createdAt: T0 },
    { id: 'l4', pageId: 'pg-back-log', noteId: 'n-shared', position: 1, createdAt: T0 },
  ];
  const notes = [
    note('n-daily', { title: 'Daily Training' }),
    note('n-idea', { title: 'Idea Queue' }),
    note('n-shared', { title: 'Shared Note' }),
    note('n-orphan', { title: 'Orphan Note' }),
  ];
  const make = (): QueryService => new QueryService({
    noteStore: noteStore(notes),
    blockStore: { getAllBlocks: async () => [] },
    pageStore: {
      getNotePages: async () => [],
      getPage: async () => undefined,
      getAllPages: async () => pages,
      getAllLinks: async () => links,
    },
  } as unknown as QueryServiceStores);

  it('lists every placement — placed notes with their page containers', async () => {
    const result = await make().runFind(find(':page{}'));
    expect(result.notes.map((n) => n.id)).toEqual(['n-daily', 'n-idea', 'n-shared']);
    expect(result.placements?.['n-shared']).toHaveLength(2);
    // The primary container is the note's first (canonical-order) placement.
    expect(result.containers?.['n-shared']).toMatchObject({ kind: 'page', id: '2026-10-24', date: '2026-10-24' });
    expect(result.stages).toMatchObject({ selected: 3, matched: 3 });
  });

  it('page:YYYY-MM-DD narrows to that page’s placements', async () => {
    const result = await make().runFind(find(':page{page:2026-10-24}'));
    expect(result.notes.map((n) => n.id).sort()).toEqual(['n-daily', 'n-shared']);
  });

  it('page:<slug> narrows by the named page', async () => {
    const result = await make().runFind(find(':page{page:back-log}'));
    expect(result.notes.map((n) => n.id).sort()).toEqual(['n-idea', 'n-shared']);
  });

  it('negation drops the page’s placements (a note’s other placements survive)', async () => {
    const result = await make().runFind(find(':page{!page:back-log}'));
    expect(result.notes.map((n) => n.id)).toEqual(['n-daily', 'n-shared']);
    expect(result.placements?.['n-shared']).toHaveLength(1);
    expect(result.containers?.['n-shared']).toMatchObject({ id: '2026-10-24' });
  });

  it('notebook: narrows the placed notes by their notebook', async () => {
    const scoped = notes.map((n) =>
      n.id === 'n-daily' ? n : ({ ...n, notebookId: 'notebook/playground' } as Note));
    const service = new QueryService({
      noteStore: noteStore(scoped),
      blockStore: { getAllBlocks: async () => [] },
      pageStore: {
        getNotePages: async () => [],
        getPage: async () => undefined,
        getAllPages: async () => pages,
        getAllLinks: async () => links,
      },
    } as unknown as QueryServiceStores);
    const result = await service.runFind(find(':page{notebook:journal}'));
    expect(result.notes.map((n) => n.id)).toEqual(['n-daily']);
  });

  it('without a page store the plane answers empty (optional seam)', async () => {
    const bare = new QueryService({
      noteStore: noteStore(notes),
      blockStore: { getAllBlocks: async () => [] },
    } as unknown as QueryServiceStores);
    const result = await bare.runFind(find(':page{}'));
    expect(result.notes).toEqual([]);
  });
});

// ── :tag{} — the tag plane with contributions ────────────────────────────

describe(':tag{} — the tag plane', () => {
  const tags: Tag[] = [
    {
      label: 'kettlebell', type: 'equipment', createdAt: T0,
      contributions: [
        { kind: 'metric', type: 'rpe' },
        { kind: 'tag', slug: 'mobility' },
        { kind: 'function', name: 'calc.e1rm' },
      ],
    } as Tag,
    { label: 'for-time', createdAt: T0 + 1 } as Tag,
  ];
  const make = (): QueryService => new QueryService({
    noteStore: noteStore([]),
    blockStore: { getAllBlocks: async () => [] },
    tagsStore: {
      getAllFromIndex: async () => [],
      getAll: async () => tags,
    },
  } as unknown as QueryServiceStores);

  it('lists every tag as a note row carrying its contributions', async () => {
    const result = await make().runFind(find(':tag{}'));
    expect(result.notes.map((n) => n.id)).toEqual(['tag/equipment/kettlebell', 'tag/general/for-time']);
    const kettlebell = result.notes[0]!;
    expect(kettlebell).toMatchObject({ title: 'kettlebell', type: 'tag', tagType: 'equipment' });
    expect(kettlebell.contributions).toHaveLength(3);
    expect(kettlebell.content).toContain('metric rpe');
    expect(kettlebell.content).toContain('function calc.e1rm');
    // The label-only tag contributes nothing.
    expect(result.notes[1]!.contributions).toEqual([]);
  });

  it('tag:<label> narrows by label and negation excludes', async () => {
    const result = await make().runFind(find(':tag{tag:kettlebell}'));
    expect(result.notes.map((n) => n.title)).toEqual(['kettlebell']);
    const excluded = await make().runFind(find(':tag{!tag:kettlebell}'));
    expect(excluded.notes.map((n) => n.title)).toEqual(['for-time']);
  });

  it('type:<tagType> narrows by the tag’s record type, negation excludes it', async () => {
    const result = await make().runFind(find(':tag{type:equipment}'));
    expect(result.notes.map((n) => n.title)).toEqual(['kettlebell']);
    const excluded = await make().runFind(find(':tag{!type:equipment}'));
    expect(excluded.notes.map((n) => n.title)).toEqual(['for-time']);
    // Untyped records count as "not the wanted type" under negation.
    const untypedExcluded = await make().runFind(find(':tag{!type:movement}'));
    expect(untypedExcluded.notes.map((n) => n.title).sort()).toEqual(['for-time', 'kettlebell']);
  });

  it('contributes: matches the contribution kinds — never label filters', async () => {
    expect((await make().runFind(find(':tag{contributes:metric}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
    expect((await make().runFind(find(':tag{contributes:metric:rpe}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
    expect((await make().runFind(find(':tag{contributes:metric:sound}'))).notes).toEqual([]);
    expect((await make().runFind(find(':tag{contributes:tag:mobility}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
    expect((await make().runFind(find(':tag{contributes:function:calc.e1rm}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
    // Two contributes: filters AND — kettlebell satisfies both kinds.
    expect((await make().runFind(find(':tag{contributes:metric,contributes:function}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
    // for-time contributes nothing — every contributes: narrow excludes it.
    const bare = await make().runFind(find(':tag{contributes:metric}'));
    expect(bare.notes.map((n) => n.title)).not.toContain('for-time');
  });

  it('text: matches the label and the contribution summary', async () => {
    expect((await make().runFind(find(':tag{text:mobility}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
    expect((await make().runFind(find(':tag{text:e1rm}'))).notes.map((n) => n.title)).toEqual(['kettlebell']);
  });
});

// ── :equipment{} — the equipment library plane ───────────────────────────

describe(':equipment{} — the equipment plane', () => {
  const notes = [
    note('eq-kettlebell', { title: 'Kettlebell', notebookId: 'notebook/equipment', type: 'equipment', tags: ['kettlebell'] }),
    note('eq-barbell', { title: 'Barbell', notebookId: 'notebook/equipment', type: 'equipment', tags: ['barbell'] }),
    note('eq-tagged', { title: 'Ab Wheel', type: 'equipment', tags: ['equipment:ab-wheel'] }),
    note('n-journal', { title: 'Journal kettlebell workout', tags: ['kettlebell'] }),
  ];
  const stores = {
    noteStore: noteStore(notes),
    blockStore: { getAllBlocks: async () => [] },
    // The typed-tag index: by-label finds the tag record, by-tag its links.
    tagsStore: {
      getAllFromIndex: async (_index: string, key: string) =>
        key === 'ab-wheel' ? [{ id: 'tag-ab', type: 'equipment', label: 'ab-wheel' }] : [],
    },
    noteTagsStore: {
      getAllFromIndex: async (_index: string, key: string) =>
        key === 'tag-ab' ? [{ noteId: 'eq-tagged' }] : [],
    },
  };
  const make = (): QueryService => new QueryService(stores as unknown as QueryServiceStores);

  it('lists the equipment library notes only', async () => {
    const result = await make().runFind(find(':equipment{}'));
    expect(result.notes.map((n) => n.id).sort()).toEqual(['eq-barbell', 'eq-kettlebell', 'eq-tagged']);
  });

  it('equipment:<label> narrows by the equipment typed tag, negation excludes it', async () => {
    const result = await make().runFind(find(':equipment{equipment:ab-wheel}'));
    expect(result.notes.map((n) => n.id)).toEqual(['eq-tagged']);
    const excluded = await make().runFind(find(':equipment{!equipment:ab-wheel}'));
    expect(excluded.notes.map((n) => n.id).sort()).toEqual(['eq-barbell', 'eq-kettlebell']);
  });

  it('tags:<label> narrows by the plain tag label', async () => {
    const result = await make().runFind(find(':equipment{tags:barbell}'));
    expect(result.notes.map((n) => n.id)).toEqual(['eq-barbell']);
  });

  it('negation excludes a label across the plane', async () => {
    const result = await make().runFind(find(':equipment{!tags:barbell}'));
    expect(result.notes.map((n) => n.id).sort()).toEqual(['eq-kettlebell', 'eq-tagged']);
  });
});

// ── Typed-tag filter pushdown through the domain read (ticket 08) ────────

describe('typed-tag filter pushdown', () => {
  const notes = [
    note('eq-kettlebell', { title: 'Kettlebell', tags: ['equipment:kettlebell'] }),
    note('n-plain', { title: 'Plain', tags: [] }),
  ];
  const tagIndex = {
    tagsStore: {
      getAllFromIndex: async (_index: string, key: string) =>
        key === 'kettlebell' ? [{ id: 'tag-k', type: 'equipment', label: 'kettlebell' }] : [],
    },
    noteTagsStore: {
      getAllFromIndex: async (_index: string, key: string) =>
        key === 'tag-k' ? [{ noteId: 'eq-kettlebell' }] : [],
    },
  };

  function makeCapturing() {
    const captured: WqlDomainPredicate[][] = [];
    const store: NoteQueryStore = {
      ...noteStore(notes),
      queryDomain: async (req: { filters?: WqlDomainPredicate[] }) => {
        captured.push(req.filters ?? []);
        return { plan: 'notes', projectionVersion: 1, selectedCount: 2, matchedCount: 2, rows: notes };
      },
    } as unknown as NoteQueryStore;
    const service = new QueryService({
      noteStore: store,
      blockStore: {
        getAllBlocks: async () => [],
        queryDomain: async (req: { filters?: WqlDomainPredicate[] }) => {
          captured.push(req.filters ?? []);
          return { plan: 'blocks', projectionVersion: 1, selectedCount: 0, matchedCount: 0, rows: [] };
        },
      },
      ...tagIndex,
    } as unknown as QueryServiceStores);
    return { service, captured };
  }

  it(':note{equipment:<label>} compiles a typedTag domain predicate', async () => {
    const { service, captured } = makeCapturing();
    const result = await service.runFind(find(':note{equipment:kettlebell}'));
    expect(result.notes.map((n) => n.id)).toEqual(['eq-kettlebell']);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toContainEqual({ field: 'typedTag', tagType: 'equipment', values: ['kettlebell'] });
  });

  it(':block does not push typed tags down (the block executor never applies them)', async () => {
    const { service, captured } = makeCapturing();
    await service.runFind(find(':block{equipment:kettlebell}'));
    for (const filters of captured) {
      expect(filters.some((p) => p.field === 'typedTag')).toBe(false);
    }
  });
});
