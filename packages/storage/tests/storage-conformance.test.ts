import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { createClient } from '@libsql/client';
import { InMemoryStorage } from '../src/memory';
import { SqlStorage, libsqlDatabase } from '../src/sql';
import { IndexedDBStorage } from '../src/idb';
import { ApiStorage } from '../src/api';
import { createHandler } from '@bitcobblers/wod-wiki-tools/server';
import type { IStorage } from '../src/contract';
import type { Note } from '../src/entities';
import { DOMAIN_PROJECTION_VERSION } from '../src/domain';

interface StorageFixture {
  name: string;
  create: () => Promise<{ storage: IStorage; cleanup: () => Promise<void> }>;
  supportsQueryDomain: boolean;
}

function makeNote(id: string, date = 1000, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: `Note ${id}`,
    rawContent: '',
    sourceRevision: 1,
    blocks: {},
    date,
    createdAt: date,
    ...overrides,
  };
}

const adapters: StorageFixture[] = [
  {
    name: 'InMemoryStorage',
    supportsQueryDomain: false,
    create: async () => {
      const storage = new InMemoryStorage();
      return {
        storage,
        cleanup: async () => {
          await storage.close();
        },
      };
    },
  },
  {
    name: "SqlStorage(':memory:')",
    supportsQueryDomain: true,
    create: async () => {
      const client = createClient({ url: ':memory:' });
      const db = libsqlDatabase(client);
      const storage = new SqlStorage(db);
      await storage.ready();
      return {
        storage,
        cleanup: async () => {
          await storage.close();
          client.close();
        },
      };
    },
  },
  {
    name: 'IndexedDBStorage',
    supportsQueryDomain: false,
    create: async () => {
      const dbName = `conformance-${crypto.randomUUID()}`;
      const storage = new IndexedDBStorage({ dbName });
      await storage.open();
      return {
        storage,
        cleanup: async () => {
          await storage.close();
        },
      };
    },
  },
  {
    name: 'ApiStorage',
    supportsQueryDomain: true,
    create: async () => {
      const client = createClient({ url: ':memory:' });
      const db = libsqlDatabase(client);
      const sqlStorage = new SqlStorage(db);
      await sqlStorage.ready();
      const handler = createHandler(db, { playgroundDist: '' });
      const fetchImpl: typeof fetch = async (input, init) => {
        const req = new Request(input, init);
        return handler(req);
      };
      const storage = new ApiStorage('http://localhost/api', fetchImpl);
      return {
        storage,
        cleanup: async () => {
          await storage.close();
          await sqlStorage.close();
          client.close();
        },
      };
    },
  },
];

describe.each(adapters)('Storage Conformance: $name', ({ create, supportsQueryDomain }) => {
  it('performs CRUD operations (get, put, getMany, getAll, count, delete, clear)', async () => {
    const { storage, cleanup } = await create();
    try {
      const store = storage.readwrite('notes');

      // 1. Initial state
      expect(await store.count()).toBe(0);
      expect(await store.get('n1')).toBeUndefined();

      // 2. Put single
      const n1 = makeNote('n1', 100);
      await store.put(n1);
      expect(await store.count()).toBe(1);
      const fetchedN1 = await store.get('n1');
      expect(fetchedN1).toEqual(n1);

      // 3. Put overwrite
      const n1Updated = makeNote('n1', 150, { title: 'Updated N1' });
      await store.put(n1Updated);
      expect(await store.count()).toBe(1);
      expect(await store.get('n1')).toEqual(n1Updated);

      // 4. Put many & get many
      const n2 = makeNote('n2', 200);
      const n3 = makeNote('n3', 300);
      await store.putMany([n2, n3]);
      expect(await store.count()).toBe(3);

      const many = await store.getMany(['n1', 'n2', 'non-existent', 'n3']);
      expect(many).toEqual([n1Updated, n2, undefined, n3]);

      // 5. Get all (sorted by primary key)
      const all = await store.getAll();
      expect(all.map(n => n.id)).toEqual(['n1', 'n2', 'n3']);

      // 6. Delete
      await store.delete('n2');
      expect(await store.count()).toBe(2);
      expect(await store.get('n2')).toBeUndefined();
      expect((await store.getAll()).map(n => n.id)).toEqual(['n1', 'n3']);

      // 7. Clear
      await store.clear();
      expect(await store.count()).toBe(0);
      expect(await store.getAll()).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('queries indexes and respects index-range bounds (exact, bound, lowerBound, countFromIndex, getAllFromIndexMany)', async () => {
    const { storage, cleanup } = await create();
    try {
      const store = storage.readwrite('notes');

      const notes = [
        makeNote('a', 10),
        makeNote('b', 20),
        makeNote('c', 30),
        makeNote('d', 40),
        makeNote('e', 50),
      ];
      await store.putMany(notes);

      // 1. All ordered by index
      const indexedAll = await store.getAllFromIndex('by-date');
      expect(indexedAll.map(n => n.id)).toEqual(['a', 'b', 'c', 'd', 'e']);

      // 2. Exact match on index
      const exact20 = await store.getAllFromIndex('by-date', 20);
      expect(exact20.map(n => n.id)).toEqual(['b']);

      // 3. Inclusive range bound [20, 40]
      const boundInclusive = await store.getAllFromIndex('by-date', IDBKeyRange.bound(20, 40));
      expect(boundInclusive.map(n => n.id)).toEqual(['b', 'c', 'd']);
      expect(await store.countFromIndex('by-date', IDBKeyRange.bound(20, 40))).toBe(3);

      // 4. Exclusive lower bound (20, 40]
      const lowerOpen = await store.getAllFromIndex('by-date', IDBKeyRange.bound(20, 40, true, false));
      expect(lowerOpen.map(n => n.id)).toEqual(['c', 'd']);

      // 5. Lower bound > 30 (exclusive)
      const lowerBoundOpen = await store.getAllFromIndex('by-date', IDBKeyRange.lowerBound(30, true));
      expect(lowerBoundOpen.map(n => n.id)).toEqual(['d', 'e']);

      // 6. Upper bound <= 30 (inclusive)
      const upperBound = await store.getAllFromIndex('by-date', IDBKeyRange.upperBound(30, false));
      expect(upperBound.map(n => n.id)).toEqual(['a', 'b', 'c']);

      // 7. getAllFromIndexMany
      const multi = await store.getAllFromIndexMany('by-date', [20, 999, 50]);
      expect(multi).toHaveLength(3);
      expect(multi[0].map(n => n.id)).toEqual(['b']);
      expect(multi[1]).toEqual([]);
      expect(multi[2].map(n => n.id)).toEqual(['e']);
    } finally {
      await cleanup();
    }
  });

  it('rolls back buffered-transaction changes on error and commits on success', async () => {
    const { storage, cleanup } = await create();
    try {
      // Seed initial record
      await storage.readwrite('notes').put(makeNote('initial', 100));
      expect(await storage.readonly('notes').count()).toBe(1);

      // Attempt transaction that throws
      let txThrew = false;
      try {
        await storage.transaction(['notes'], 'readwrite', async tx => {
          await tx.readwrite('notes').put(makeNote('tx-fail', 200));
          await tx.readwrite('notes').delete('initial');
          throw new Error('intentional transaction rollback');
        });
      } catch (err) {
        txThrew = true;
        expect((err as Error).message).toContain('intentional transaction rollback');
      }
      expect(txThrew).toBe(true);

      // Verify rollback: 'initial' must still exist, 'tx-fail' must NOT exist
      expect(await storage.readonly('notes').get('initial')).toBeDefined();
      expect(await storage.readonly('notes').get('tx-fail')).toBeUndefined();
      expect(await storage.readonly('notes').count()).toBe(1);

      // Successful transaction
      await storage.transaction(['notes'], 'readwrite', async tx => {
        await tx.readwrite('notes').put(makeNote('tx-success', 300));
        await tx.readwrite('notes').delete('initial');
      });

      // Verify commit
      expect(await storage.readonly('notes').get('initial')).toBeUndefined();
      expect(await storage.readonly('notes').get('tx-success')).toBeDefined();
      expect(await storage.readonly('notes').count()).toBe(1);
    } finally {
      await cleanup();
    }
  });

  if (supportsQueryDomain) {
    it('executes queryDomain returning valid projections and counts', async () => {
      const { storage, cleanup } = await create();
      try {
        expect(storage.queryDomain).toBeDefined();

        const n1 = makeNote('qn-1', 100, { title: 'Query Note 1' });
        const n2 = makeNote('qn-2', 200, { title: 'Query Note 2' });
        await storage.readwrite('notes').putMany([n1, n2]);

        const res = await storage.queryDomain!({ plan: 'notes' });
        expect(res).toBeDefined();
        expect(res?.projectionVersion).toBe(DOMAIN_PROJECTION_VERSION);
        expect(res?.plan).toBe('notes');
        if (res?.plan === 'notes') {
          expect(res.selectedCount).toBe(2);
          expect(res.matchedCount).toBe(2);
          expect(res.rows.map(r => r.id).sort()).toEqual(['qn-1', 'qn-2']);
        }
      } finally {
        await cleanup();
      }
    });
  }
});
