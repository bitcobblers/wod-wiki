import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { ApiStorage } from '../src/api';
import { parseDomainQueryResult } from '../src/domain';
import { keyInRange, rangeFromIDB, type RangeDTO } from '../src/wire';

function noteServer() {
  let rows = [
    { id: 'a', title: 'A', date: 10, createdAt: 10 },
    { id: 'b', title: 'B', date: 20, createdAt: 20 },
    { id: 'c', title: 'C', date: 30, createdAt: 30 },
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
    const selected = rows.filter(row => !range || keyInRange(index ? row.date : row.id, range));
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
      await tx.readwrite('notes').put({ id: 'aa', title: 'New', date: 15, createdAt: 15 });
      expect((await tx.readonly('notes').getAll(undefined, 2)).map(row => row.id)).toEqual(['aa', 'b']);
    });
  });

  it('rechecks range and index order when buffered values move into and out of a window', async () => {
    const storage = noteServer();
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').put({ id: 'a', title: 'A moved in', date: 25, createdAt: 10 });
      await tx.readwrite('notes').put({ id: 'b', title: 'B moved out', date: 5, createdAt: 20 });
      const window = IDBKeyRange.bound(20, 30);
      expect((await tx.readonly('notes').getAllFromIndex('by-date', window, 2)).map(row => row.id)).toEqual(['a', 'c']);
    });
  });

  it('counts only primary-key matches after buffered writes', async () => {
    const storage = noteServer();
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').put({ id: 'z', title: 'Outside', createdAt: 40 });
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
      await tx.readwrite('notes').put({ id: 'aa', title: 'Reinserted', date: 15, createdAt: 15 });
    });
    expect((await storage.readonly('notes').getAll()).map(row => row.id)).toEqual(['aa', 'c']);
  });
});

it('rejects stale domain projection data rather than treating it as a valid empty result', () => {
  expect(() => parseDomainQueryResult({ plan: 'notes', rows: [], selectedCount: 0, matchedCount: 0, projectionVersion: 0 }, 'notes')).toThrow('stale');
});

it('rejects response counts that could hide missing or unexpected matches', () => {
  expect(() => parseDomainQueryResult({ plan: 'notes', rows: [], selectedCount: 1, matchedCount: 2, projectionVersion: 1 }, 'notes')).toThrow('invalid');
  expect(() => parseDomainQueryResult({ plan: 'notes', rows: [{ id: 'a', title: 'A', createdAt: 1 }], selectedCount: 1, matchedCount: 0, projectionVersion: 1 }, 'notes')).toThrow('invalid');
});

it('rejects malformed metadata before consumers hydrate entries', () => {
  const note = { id: 'a', title: 'A', createdAt: 1 };
  const response = { plan: 'entries', projectionVersion: 1, selectedCount: 1, matchedCount: 1 };
  for (const entry of [
    { note: { ...note, tags: [42] }, segments: [], tags: [], links: [], pages: [] },
    { note, segments: [], tags: [], links: [], pages: [{ id: 'p', date: 42, createdAt: 1 }] },
    { note, segments: [{ id: 's', noteId: 'a', version: 1, dataType: 'markdown', rawContent: '', data: null, createdAt: 1, isHistory: 'false' }], tags: [], links: [], pages: [] },
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
