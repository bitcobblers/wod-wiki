import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBStorage } from './IndexedDBStorage';
import { InMemoryStorage } from './InMemoryStorage';
import type { Note } from '@bitcobblers/wod-wiki-storage';

const row: Note = { id: 'n1', title: 'Note', rawContent: 'Prose', sourceRevision: 1, blocks: {}, createdAt: 1 };
const seedRow: Note = { ...row, id: 'n2', seedOrigin: 'seed' };

for (const backend of ['indexeddb', 'memory'] as const) describe(`${backend} ownership`, () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
  afterEach(() => { Reflect.deleteProperty(globalThis, 'indexedDB'); });
  it('stamps user rows idempotently, preserves seed ownership and system identity', async () => {
    const storage = backend === 'indexeddb' ? new IndexedDBStorage({ getUserId: () => 'user-1' }) : new InMemoryStorage({ getUserId: () => 'user-1' });
    await storage.readwrite('notes').put(row);
    await storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readwrite('notes').put(seedRow);
      await tx.readwrite('notes').put(row);
    });
    expect(await storage.readonly('notes').get('n1')).toEqual({ ...row, userId: 'user-1' });
    expect(await storage.readonly('notes').get('n2')).toEqual(seedRow);
    expect(await storage.readonly('notes').getAllFromIndex('by-user', 'user-1')).toEqual([{ ...row, userId: 'user-1' }]);
    const membership = { id: 'default', displayName: 'Me', createdAt: 1 };
    await storage.readwrite('memberships').put(membership);
    await storage.wipe();
    expect(await storage.readonly('memberships').get('default')).toEqual(membership);
    await storage.close();
  });
});
