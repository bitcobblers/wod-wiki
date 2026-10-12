import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { ApiStorage } from '../src/api';
import { parseDomainQueryResult } from '../src/domain';
import { keyInRange, rangeFromIDB, type RangeDTO } from '../src/wire';
import type { Note } from '../src/entities';
import { DOMAIN_PROJECTION_VERSION } from '../src/domain';
import { createClient } from '@libsql/client';
import { SqlStorage, StorageError, libsqlDatabase, refreshDomain } from '../src/sql';
import type { TxOp } from '../src/wire';

function noteServer() {
  let rows: Note[] = [
    { id: 'a', title: 'A', date: 10, createdAt: 10, rawContent: '', sourceRevision: 1, blocks: {} },
    { id: 'b', title: 'B', date: 20, createdAt: 20, rawContent: '', sourceRevision: 1, blocks: {} },
    { id: 'c', title: 'C', date: 30, createdAt: 30, rawContent: '', sourceRevision: 1, blocks: {} },
  ];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/tx')) {
      const { ops } = JSON.parse(String(init?.body));
      for (const op of ops) {
        if (op.op === 'delete') rows = rows.filter(row => row.id !== op.key);
        if (op.op === 'put') rows = [...rows.filter(row => row.id !== op.value.id), op.value];
      }
      rows.sort((a, b) => a.id.localeCompare(b.id));
      return Response.json({ results: [] });
    }
    if (init?.method === 'DELETE') {
      const range = JSON.parse(url.searchParams.get('key') ?? '{}');
      rows = rows.filter(row => !keyInRange(row.id, range));
      return Response.json({});
    }
    const range: RangeDTO | undefined = url.searchParams.has('range')
      ? JSON.parse(url.searchParams.get('range') ?? '{}') : undefined;
    const index = url.pathname.includes('/index/');
    const selected = rows.filter(row => !range || keyInRange(index ? row.date ?? row.createdAt : row.id, range));
    const count = url.searchParams.get('count');
    return Response.json(count === null ? selected : selected.slice(0, Number(count)));
  };
  return new ApiStorage('http://storage.test/api', transport);
}

describe('API transaction reads', () => {
  it('pages the remaining ordered rows after a buffered delete and insert', async () => {
    const storage = noteServer();
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').delete('a');
      await tx.readwrite('notes').put({ id: 'aa', title: 'New', date: 15, createdAt: 15, rawContent: '', sourceRevision: 1, blocks: {} });
      expect((await tx.readonly('notes').getAll(undefined, 2)).map(row => row.id)).toEqual(['aa', 'b']);
    });
  });

  it('rechecks range and index order when buffered values move into and out of a window', async () => {
    const storage = noteServer();
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').put({ id: 'a', title: 'A moved in', date: 25, createdAt: 10, rawContent: '', sourceRevision: 1, blocks: {} });
      await tx.readwrite('notes').put({ id: 'b', title: 'B moved out', date: 5, createdAt: 20, rawContent: '', sourceRevision: 1, blocks: {} });
      const window = IDBKeyRange.bound(20, 30);
      expect((await tx.readonly('notes').getAllFromIndex('by-date', window, 2)).map(row => row.id)).toEqual(['a', 'c']);
    });
  });

  it('counts only primary-key matches after buffered writes', async () => {
    const storage = noteServer();
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').put({ id: 'z', title: 'Outside', createdAt: 40, rawContent: '', sourceRevision: 1, blocks: {} });
      await tx.readwrite('notes').delete('b');
      expect(await tx.readonly('notes').count(IDBKeyRange.bound('a', 'c'))).toBe(2);
    });
  });

  it('keeps range deletions uncommitted when the source mutation fails', async () => {
    const storage = noteServer();
    await expect(storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').delete(IDBKeyRange.bound('a', 'b'));
      expect((await tx.readonly('notes').getAll()).map(row => row.id)).toEqual(['c']);
      throw new Error('projection failed');
    })).rejects.toThrow('projection failed');
    expect((await storage.readonly('notes').getAll()).map(row => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('commits range deletions and later inserts together', async () => {
    const storage = noteServer();
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').delete(IDBKeyRange.bound('a', 'b'));
      await tx.readwrite('notes').put({ id: 'aa', title: 'Reinserted', date: 15, createdAt: 15, rawContent: '', sourceRevision: 1, blocks: {} });
    });
    expect((await storage.readonly('notes').getAll()).map(row => row.id)).toEqual(['aa', 'c']);
  });
});

it('rejects stale domain projection data rather than treating it as a valid empty result', () => {
  expect(() => parseDomainQueryResult({ plan: 'notes', rows: [], selectedCount: 0, matchedCount: 0, projectionVersion: 0 }, 'notes')).toThrow('stale');
});

it('rejects response counts that could hide missing or unexpected matches', () => {
  expect(() => parseDomainQueryResult({ plan: 'notes', rows: [], selectedCount: 1, matchedCount: 2, projectionVersion: DOMAIN_PROJECTION_VERSION }, 'notes')).toThrow('invalid');
  expect(() => parseDomainQueryResult({ plan: 'notes', rows: [{ id: 'a', title: 'A', createdAt: 1, rawContent: '', sourceRevision: 1, blocks: {} }], selectedCount: 1, matchedCount: 0, projectionVersion: DOMAIN_PROJECTION_VERSION }, 'notes')).toThrow('invalid');
});

it('rejects malformed metadata before consumers hydrate entries', () => {
  const note = { id: 'a', title: 'A', createdAt: 1, rawContent: '', sourceRevision: 1, blocks: {} };
  const response = { plan: 'entries', projectionVersion: DOMAIN_PROJECTION_VERSION, selectedCount: 1, matchedCount: 1 };
  for (const entry of [
    { note: { ...note, tags: [42] }, tags: [], links: [], pages: [] },
    { note, tags: [], links: [], pages: [{ id: 'p', date: 42, createdAt: 1 }] },
    { note: { ...note, sourceRevision: 0 }, tags: [], links: [], pages: [] },
  ]) {
    expect(() => parseDomainQueryResult({ ...response, rows: [entry] }, 'entries')).toThrow('invalid');
  }
});

it('falls back only for an explicit unavailable projection gate', async () => {
  const unavailable = new ApiStorage('http://storage.test', async () =>
    Response.json({ code: 'domain_projection_unavailable', error: 'unresolved identity' }, { status: 409 }));
  expect(await unavailable.queryDomain({ plan: 'notes' })).toBeUndefined();
  for (const status of [409, 500]) {
    const failing = new ApiStorage('http://storage.test', async () =>
      Response.json({ error: 'query failed' }, { status }));
    await expect(failing.queryDomain({ plan: 'notes' })).rejects.toThrow(String(status));
  }
});

it('normalizes IDB compound upper bound empty array to scalar string', () => {
  const range = IDBKeyRange.bound(['res-1', ''], ['res-1', []]);
  const wire = rangeFromIDB(range);
  expect(wire?.upper).toEqual(['res-1', '\uffff']);
});

it.each(['unchanged', 'ownership', 'absence', 'listed row'] as const)('preserves buffered reads and rejects a concurrent %s change before commit', async race => {
  const original: Note = { id: 'n', title: 'Original', rawContent: 'Body', sourceRevision: 1, blocks: {}, createdAt: 1, date: 1, seedOrigin: 'seed' };
  const listed: Note = { ...original, id: 'listed', title: 'Listed', date: 2 };
  const edited: Note = { ...original, title: 'Edited', seedOrigin: 'user' };
  const db = libsqlDatabase(createClient({ url: ':memory:' }));
  const server = new SqlStorage(db);
  try {
    await server.readwrite('notes').putMany([original, listed]);
    const storage = new ApiStorage('http://storage.test', async (input, init) => {
      const url = new URL(String(input));
      try {
        if (url.pathname.endsWith('/tx')) {
          const { ops }: { ops: TxOp[] } = JSON.parse(String(init?.body));
          await db.transaction(tx => refreshDomain(tx, ops));
          return Response.json({});
        }
        if (url.pathname.endsWith('/get')) {
          const row = await server.readonly('notes').get(JSON.parse(url.searchParams.get('key')!));
          return row ? Response.json(row) : Response.json({}, { status: 404 });
        }
        return Response.json(await server.readonly('notes').getAllFromIndex('by-date'));
      } catch (error) {
        if (error instanceof StorageError) return Response.json({ code: error.code }, { status: error.status });
        throw error;
      }
    });
    const transaction = storage.transaction(['notes'], 'readwrite', async tx => {
      expect(await tx.readonly('notes').getMany(['n', 'missing'])).toEqual([original, undefined]);
      await tx.readwrite('notes').put(edited);
      expect((await tx.readonly('notes').get('n'))?.title).toBe('Edited');
      expect((await tx.readonly('notes').getAllFromIndex('by-date')).map(row => row.title)).toEqual(['Edited', 'Listed']);
      if (race === 'ownership') await server.readwrite('notes').put({ ...original, seedOrigin: 'user' });
      if (race === 'absence') await server.readwrite('notes').put({ ...listed, id: 'missing' });
      if (race === 'listed row') await server.readwrite('notes').put({ ...listed, title: 'Concurrent list change' });
    });
    if (race === 'unchanged') await transaction;
    else await expect(transaction).rejects.toThrow('409');
    expect(await server.readonly('notes').get('n')).toEqual(race === 'unchanged' ? edited : race === 'ownership' ? { ...original, seedOrigin: 'user' } : original);
    expect(await server.readonly('notes').get('missing')).toEqual(race === 'absence' ? { ...listed, id: 'missing' } : undefined);
    expect(await server.readonly('notes').get('listed')).toEqual(race === 'listed row' ? { ...listed, title: 'Concurrent list change' } : listed);
  } finally {
    await server.close();
  }
});
