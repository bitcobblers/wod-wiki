import { describe, expect, it } from 'vitest';
import { QueryService, sourceMatches } from '../src/QueryService';
import { WQL_SOURCE_VALUES } from '../src/vocabulary';
import type { BlockIndexRow, Note } from '@bitcobblers/wod-wiki-core';
import type {
  BlockQueryStore,
  NoteQueryStore,
  QueryServiceStores,
  WqlDomainPredicate,
  WqlDomainReadResult,
} from '../src/stores';
import type { ParsedFindQuery, TagFilter } from '../src/wql';
import { actionableFixture } from './harness/actionable';

/**
 * Candidate/domain read parity at the public runFind/runFindBlock seams:
 * a store that serves domain candidates (selection = source clauses + the
 * explicit source fence counted before post-count filters; type/noteId as
 * post-count filters; natural id order paging) must return IDENTICAL rows,
 * identities, order, and stage counts to the whole-store path. The wire's
 * selectedCount baselines the historical pre-filter stages.selected, and
 * server paging rides only when no residual filter precedes the slice.
 */

const T0 = 1_700_000_000_000;

const fixtures = [
  actionableFixture({ id: 'n1', title: 'one', createdAt: T0, type: 'note' },
    [{ id: 'b0', body: 'fran-seeded' }, { id: 'b1', body: 'fran' }]),
  actionableFixture({ id: 'n2', title: 'two', createdAt: T0 + 1, type: 'note' },
    [{ id: 'b2', body: 'diane' }, { id: 'b4', body: 'annie squat clean' }]),
  actionableFixture({ id: 'npage', title: 'guide', createdAt: T0 + 2, type: 'page', sourceId: 'guides:my-guide' }, []),
  actionableFixture({ id: 'scol', title: 'cats', createdAt: T0 + 3, type: 'feed', sourceId: 'page:collection:cats', catalog: 'cats' },
    [{ id: 'b3', kind: 'query', body: ':note{text:squat}' }]),
  actionableFixture({ id: 's1', title: 'fran', createdAt: T0 + 4, type: 'note', sourceId: 'collection:girls', catalog: 'girls' }, []),
];
const userNotes = fixtures.map(f => f.note);
const blocks = fixtures.flatMap(f => f.blocks).sort((a, b) => a.id.localeCompare(b.id));

type AnyRow = Note | BlockIndexRow;
type DomainRequest = Parameters<NonNullable<BlockQueryStore['queryDomain']>>[0] | Parameters<NonNullable<NoteQueryStore['queryDomain']>>[0];
type DomainRead = (request: DomainRequest) => Promise<WqlDomainReadResult>;

/** Page-like kinds — the isPage composite's type half. */
const PAGE_LIKE = ['feed', 'syntax', 'behavior', 'analytics', 'dashboard', 'home', 'page'];

function isPageRow(row: AnyRow): boolean {
  if ('dataType' in row) return false;
  return row.type !== 'note'
    && ((!!row.sourceId && (row.sourceId.startsWith('page:') || row.sourceId.startsWith('guides:')))
      || PAGE_LIKE.includes(row.type ?? ''));
}

function predicateHit(row: AnyRow, p: WqlDomainPredicate): boolean {
  const values = 'values' in p ? p.values : [];
  switch (p.field) {
    case 'sourceFence':
      return !row.sourceId || WQL_SOURCE_VALUES.some((k) => sourceMatches(row, k));
    case 'source':
      return values.some((k) => sourceMatches(row, k));
    case 'defaultNotes':
      return p.feeds ? row.type !== 'page' : !isPageRow(row);
    case 'text': {
      // Wire text = case-insensitive substring on the plane's text column.
      const needle = p.value.toLowerCase();
      return 'dataType' in row ? row.rawContent.toLowerCase().includes(needle)
        : row.title.toLowerCase().includes(needle) || row.rawContent.toLowerCase().includes(needle);
    }
    case 'type':
      return 'dataType' in row ? values.includes(row.dataType) : values.includes(row.type ?? '');
    case 'id':
      return values.includes(row.id);
    case 'noteId':
      return 'noteId' in row && values.includes(row.noteId);
    default:
      return true;
  }
}

function clauseHolds(row: AnyRow, p: WqlDomainPredicate): boolean {
  const hit = predicateHit(row, p);
  return p.negate ? !hit : hit;
}

/** Domain-backed store fake for one plane: wire contract verbatim —
 *  selectedCount after selection before filters, matchedCount after filters
 *  before limit, rows the paged page. */
function makeDomainRead(all: AnyRow[], captured: Array<Record<string, unknown>>): DomainRead {
  return async (req: DomainRequest): Promise<WqlDomainReadResult> => {
    captured.push({ ...req });
    const selectedRows = all.filter((row) => (req.selection ?? []).every((p) => clauseHolds(row, p)));
    const filtered = selectedRows.filter((row) => (req.filters ?? []).every((p) => clauseHolds(row, p)));
    let rows = [...filtered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const offset = req.offset ?? 0;
    rows = req.limit !== undefined ? rows.slice(offset, offset + req.limit) : rows.slice(offset);
    if (req.plan === 'notes') {
      return {
        plan: 'notes', projectionVersion: 1,
        selectedCount: selectedRows.length, matchedCount: filtered.length,
        rows: rows.filter((r): r is Note => !('dataType' in r)),
      };
    }
    return {
      plan: 'blocks', projectionVersion: 1,
      selectedCount: selectedRows.length, matchedCount: filtered.length,
      rows: rows.filter((r): r is BlockIndexRow => 'dataType' in r),
    };
  };
}

function makeNoteStore(all: Note[], domainRead?: DomainRead): NoteQueryStore {
  return {
    getAllNotes: async () => all,
    getNoteIdsForTag: async () => new Set<string>(),
    getNoteTagLabels: async () => [],
    ...(domainRead ? { queryDomain: domainRead } : {}),
  };
}

function makeBlockStore(all: BlockIndexRow[], domainRead?: DomainRead): BlockQueryStore {
  return {
    getAllBlocks: async () => all,
    ...(domainRead ? { queryDomain: domainRead } : {}),
  };
}


function makeService(withDomain: boolean): { service: QueryService; captured: Array<Record<string, unknown>> } {
  const captured: Array<Record<string, unknown>> = [];
  const stores: QueryServiceStores = {
    noteStore: makeNoteStore(userNotes, withDomain ? makeDomainRead([...userNotes], captured) : undefined),
    blockStore: makeBlockStore(blocks, withDomain ? makeDomainRead([...blocks], captured) : undefined),
  };
  return { service: new QueryService(stores), captured };
}

function find(target: string, filters: TagFilter[], pipes?: ParsedFindQuery['pipes']): ParsedFindQuery {
  return { family: 'find', raw: '', target, filters, ...(pipes ? { pipes } : {}) };
}

const val = (v: string): TagFilter['values'][number] => ({ value: v, wildcard: false });

async function outcome(service: QueryService, parsed: ParsedFindQuery) {
  const res = await service.runFind(parsed, {});
  return {
    noteIds: res.notes.map((n) => n.id),
    blockIds: res.blocks.map((b) => b.id),
    stages: res.stages,
  };
}

describe('domain candidate reads — parity with the whole-store path', () => {
  it('matches full Note bodies in domain and whole-store adapters before paging', async () => {
    const rows: Note[] = ['a', 'b', 'c'].map(id => ({ id, title: 'Journal', createdAt: T0,
      rawContent: id === 'a' ? 'Unrelated.' : 'Recovery café body phrase.', sourceRevision: 1, blocks: {} }));
    const parsed = find('note', [{ key: 'text', negate: false, values: [val('CAFÉ body')] }], { limit: 1, offset: 1 });
    const plain = new QueryService({ noteStore: makeNoteStore(rows) });
    const domain = new QueryService({ noteStore: makeNoteStore(rows, makeDomainRead(rows, [])) });
    const result = await outcome(domain, parsed);
    expect(result).toEqual(await outcome(plain, parsed));
    expect(result.noteIds).toEqual(['c']);
    expect(result.stages).toEqual({ selected: 3, matched: 1 });
  });
  it('applies the parser source scope before counts and paging', async () => {
    const rows: Note[] = [
      { id: 'a-guide', title: 'bench', type: 'note', sourceId: 'guides:bench', createdAt: T0 },
      { id: 'b-user', title: 'bench', type: 'note', sourceId: 'journal', createdAt: T0 },
      { id: 'c-user', title: 'bench', type: 'note', sourceId: 'journal', createdAt: T0 },
    ].map(row => ({ ...row, rawContent: 'Bench practice.', sourceRevision: 1, blocks: {} }));
    const parsed = { ...find('note', [{ key: 'text', negate: false, values: [val('bench')] }], { limit: 1 }),
      sourceScope: ['journal', 'feeds', 'playground'] };
    const plain = new QueryService({ noteStore: makeNoteStore(rows) });
    const domain = new QueryService({ noteStore: makeNoteStore(rows, makeDomainRead(rows, [])) });
    const result = await outcome(domain, parsed);
    expect(result).toEqual(await outcome(plain, parsed));
    expect(result.noteIds).toEqual(['b-user']);
    expect(result.stages.selected).toBe(2);
  });

  it(':journal lists a lineage-stamped clone beside its original — once each, corpus still excluded', async () => {
    // Deterministic UUID ids in natural (lexicographic) order — the plain
    // path surfaces store iteration order, the domain path sorts by id, and
    // both must agree.
    const rows: Note[] = [
      // Clone: sourceId stamps the original note's UUID, not a provenance token.
      { id: '01990e80-0000-7000-8000-000000000001', title: 'same', type: 'journal', sourceId: '01990e80-0000-7000-8000-000000000002', createdAt: T0 },
      { id: '01990e80-0000-7000-8000-000000000002', title: 'same', type: 'journal', sourceId: 'journal', createdAt: T0 },
      { id: '01990e80-0000-7000-8000-000000000005', title: 'same', type: 'journal', sourceId: 'journal/2026-10-09', createdAt: T0 },
      // Lineage never overrides corpus ownership: UUID-stamped dashboards /
      // imported rows stay excluded, as do unknown source strings.
      { id: '01990e80-0000-7000-8000-000000000003', title: 'same', type: 'dashboard', sourceId: '01990e80-0000-7000-8000-000000000002', createdAt: T0 },
      { id: '01990e80-0000-7000-8000-000000000004', title: 'same', type: 'note', sourceId: '01990e80-0000-7000-8000-000000000002', catalog: 'girls', createdAt: T0 },
      { id: 'zz-dash', title: 'same', type: 'dashboard', sourceId: 'dashboards', createdAt: T0 },
      { id: 'zz-seed', title: 'same', type: 'note', sourceId: 'collection:girls', catalog: 'girls', createdAt: T0 },
      { id: 'zz-stray', title: 'same', type: 'journal', sourceId: 'unknown-source', createdAt: T0 },
    ].map(row => ({ ...row, rawContent: '', sourceRevision: 1, blocks: {} }));
    const parsed = { ...find('note', [{ key: 'text', negate: false, values: [val('same')] }]), sourceScope: ['journal'] };
    const plain = new QueryService({ noteStore: makeNoteStore(rows) });
    const domain = new QueryService({ noteStore: makeNoteStore(rows, makeDomainRead(rows, [])) });
    const result = await outcome(domain, parsed);
    expect(result).toEqual(await outcome(plain, parsed));
    expect(result.noteIds).toEqual([
      '01990e80-0000-7000-8000-000000000001',
      '01990e80-0000-7000-8000-000000000002',
      '01990e80-0000-7000-8000-000000000005',
    ]);
  });

  it('preserves page-like notes when negated or wildcard type clauses disable default exclusion', async () => {
    const rows: Note[] = [
      { id: 'n', title: 'note', type: 'note', createdAt: T0 },
      { id: 's', title: 'syntax', type: 'syntax', createdAt: T0 },
    ].map(row => ({ ...row, rawContent: '', sourceRevision: 1, blocks: {} }));
    for (const filter of [
      { key: 'type', negate: true, values: [val('page')] },
      { key: 'type', negate: false, values: [{ value: 'syntax', wildcard: true }] },
    ]) {
      const parsed = find('note', [filter]);
      const plain = new QueryService({ noteStore: makeNoteStore(rows) });
      const domain = new QueryService({ noteStore: makeNoteStore(rows, makeDomainRead(rows, [])) });
      const result = await outcome(domain, parsed);
      expect(result).toEqual(await outcome(plain, parsed));
      expect(result.noteIds).toEqual(filter.negate ? ['n', 's'] : ['s']);
    }
  });

  it(':block{type:wod} | limit 2 — server paging bounds the payload, counts stay baselined', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('block', [{ key: 'type', negate: false, values: [val('wod')] }], { limit: 2 });
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    expect(domain.captured[0]).toMatchObject({ plan: 'blocks', limit: 2, order: [{ field: 'id', direction: 'asc' }] });
    // The baseline selected count is the post-fence population BEFORE the
    // type filter — never the narrowed candidate rows.
    expect((await outcome(domain.service, parsed)).stages.selected).toBe(blocks.length);
    expect((await outcome(domain.service, parsed)).stages.matched).toBe(2);
  });

  it(':block{type:wod,tags:x} | limit 2 — residual tag filter forbids server paging', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('block', [
      { key: 'type', negate: false, values: [val('wod')] },
      { key: 'tags', negate: false, values: [val('x')] },
    ], { limit: 2 });
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    expect(domain.captured[0]).toMatchObject({ plan: 'blocks' });
    // Residual tags filter: no server offset/limit — the JS pipeline owns
    // the slice. Natural id order still rides the read.
    expect(domain.captured[0].limit).toBeUndefined();
    expect(domain.captured[0].offset).toBeUndefined();
    expect(domain.captured[0].order).toEqual([{ field: 'id', direction: 'asc' }]);
  });

  it(':block{note:n2} — exact-id filter rides as a post-count filter, baseline preserved', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('block', [{ key: 'note', negate: false, values: [val('n2')] }]);
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    expect((await outcome(domain.service, parsed)).stages.selected).toBe(blocks.length);
  });

  it(':note{type:page} counts the unified note population', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('note', [{ key: 'type', negate: false, values: [val('page')] }]);
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    expect((await outcome(domain.service, parsed)).stages.selected)
      .toBe(userNotes.length);
  });

  it(':note{type:page} | limit 1 composes identically', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('note', [{ key: 'type', negate: false, values: [val('page')] }], { limit: 1 });
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
  });


  it(':note | limit 2 pages the inclusive note plane', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('note', [], { limit: 2 });
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    // The baseline includes authored and imported Notes exactly once.
    expect((await outcome(domain.service, parsed)).stages.selected).toBe(5);
    expect((await outcome(domain.service, parsed)).stages.matched).toBe(2);
  });

  it(':block{text:squat,type:wod} | limit 2 — literal text compiles as the wire text filter and pages', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('block', [
      { key: 'text', negate: false, values: [val('squat')] },
      { key: 'type', negate: false, values: [val('wod')] },
    ], { limit: 2 });
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    expect(domain.captured[0]).toMatchObject({
      plan: 'blocks',
      filters: [{ field: 'text', value: 'squat' }, { field: 'type', values: ['wod'] }],
      limit: 2,
    });
    // The query block matches text but not workout type.
    expect((await outcome(domain.service, parsed)).stages.matched).toBe(1);
  });

  it('source:feeds compiles into selection and counts before filters', async () => {
    const plain = makeService(false);
    const domain = makeService(true);
    const parsed = find('block', [
      { key: 'source', negate: false, values: [val('feeds')] },
      { key: 'type', negate: false, values: [val('wod')] },
    ]);
    expect(await outcome(domain.service, parsed)).toEqual(await outcome(plain.service, parsed));
    expect(domain.captured[0]).toMatchObject({
      plan: 'blocks',
      selection: [{ field: 'source', values: ['feeds'] }, { field: 'sourceFence' }],
      filters: [{ field: 'type', values: ['wod'] }],
    });
  });
});
