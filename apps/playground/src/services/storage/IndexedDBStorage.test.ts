import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { DB_VERSION, STORE_DEFS, type BlockRevision, type Note, type Session } from '@bitcobblers/wod-wiki-storage';
import { IndexedDBStorage } from './IndexedDBStorage';
import { InMemoryStorage } from './InMemoryStorage';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { Reflect.deleteProperty(globalThis, 'indexedDB'); });

it.each([28, DB_VERSION + 1])('rejects incompatible schema v%s without upgrading or wiping data', async version => {
  const legacy = await openDB('wodwiki-db', version, { upgrade(db) { db.createObjectStore('notes', { keyPath: 'id' }); } });
  await legacy.put('notes', { id: 'retained', title: 'Do not erase' });
  legacy.close();
  const incompatible = new IndexedDBStorage();
  await expect(incompatible.readonly('notes').get('retained')).rejects.toThrow('recreation required');
  const retained = await openDB('wodwiki-db', version);
  expect(await retained.get('notes', 'retained')).toEqual({ id: 'retained', title: 'Do not erase' });
  retained.close();
});

it('creates history compound indexes from shared definitions', async () => {
  const storage = new IndexedDBStorage();
  const db = await storage.open();
  expect(db.version).toBe(DB_VERSION);
  expect(Array.from(db.objectStoreNames).sort()).toEqual(STORE_DEFS.map(def => def.name).sort());
  expect(db.objectStoreNames.contains('segments')).toBe(false);
  const tx = db.transaction('block_revisions');
  expect(tx.store.keyPath).toEqual(['noteId', 'blockId', 'version']);
  expect(tx.store.index('by-block').keyPath).toEqual(['noteId', 'blockId']);
  await tx.done;
  await storage.close();
});

it('settles an early stale-source abort and permits the next transaction', async () => {
  const storage = new IndexedDBStorage();
  const note: Note = { id: 'n', title: 'Original', rawContent: 'Saved', sourceRevision: 1, blocks: {}, createdAt: 1 };
  try {
    await storage.readwrite('notes').put(note);
    const stale = new Error('STALE_SOURCE');
    await expect(storage.transaction(['notes'], 'readwrite', async tx => {
      await tx.readonly('notes').get('n');
      throw stale;
    })).rejects.toBe(stale);
    await expect(storage.transaction(['notes', 'meta'], 'readwrite', async tx => {
      const saved = await tx.readonly('notes').get('n');
      await tx.readwrite('meta').put({ key: 'rollback', value: true });
      await tx.readwrite('notes').put({ ...saved!, rawContent: 'Stale edit' });
    })).rejects.toThrow('stale');
    expect(await storage.readonly('notes').get('n')).toEqual(note);
    expect(await storage.readonly('meta').get('rollback')).toBeUndefined();
    await storage.readwrite('notes').put({ ...note, rawContent: 'Retry', sourceRevision: 2 });
    expect((await storage.readonly('notes').get('n'))?.rawContent).toBe('Retry');
  } finally {
    await storage.close();
  }
});

for (const backend of ['indexeddb', 'memory'] as const) describe(`${backend} saved history`, () => {
  it('keeps unsessioned revisions and immutable replay after Note removal; rejects pins and collisions atomically', async () => {
    const storage = backend === 'indexeddb' ? new IndexedDBStorage() : new InMemoryStorage();
    const rawContent = '```time\n10 Pushups\n```';
    const note: Note = { id: 'n', title: 'Saved', createdAt: 1, rawContent, sourceRevision: 1,
      blocks: { b: { id: 'b', kind: 'wod', version: 1, sourceRevision: 1, from: 0, to: rawContent.length, dialect: 'time' } } };
    const revision: BlockRevision = { noteId: 'n', blockId: 'b', version: 1, kind: 'wod', dialect: 'time', rawContent, savedAt: 1 };
    const pin: Session = { id: 's', noteId: 'n', blockId: 'b', blockVersion: 1, startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: 1, status: 'in-progress' };
    await storage.transaction(['notes', 'block_revisions', 'sessions'], 'readwrite', async tx => {
      await tx.readwrite('notes').put(note);
      await tx.readwrite('block_revisions').put(revision);
      await tx.readwrite('sessions').put(pin);
    });
    await storage.readwrite('block_revisions').put({ ...revision });
    const attempts = await Promise.allSettled([
      storage.readwrite('notes').put({ ...note, rawContent: `First\n${rawContent}`, sourceRevision: 2,
        blocks: { b: { ...note.blocks.b, sourceRevision: 2, from: 6, to: rawContent.length + 6 } } }),
      storage.readwrite('notes').put({ ...note, rawContent: `Other\n${rawContent}`, sourceRevision: 2,
        blocks: { b: { ...note.blocks.b, sourceRevision: 2, from: 6, to: rawContent.length + 6 } } }),
    ]);
    expect(attempts.filter(attempt => attempt.status === 'fulfilled').length).toBe(1);
    const concurrent = await storage.readonly('notes').get('n');
    expect(concurrent?.sourceRevision).toBe(2);
    const current = { ...note, sourceRevision: 3, blocks: { b: { ...note.blocks.b, sourceRevision: 3 } } };
    await storage.readwrite('notes').put(current);
    await expect(storage.transaction(['notes', 'block_revisions', 'meta'], 'readwrite', async tx => {
      await tx.readwrite('notes').put({ ...current, title: 'Must roll back' });
      await tx.readwrite('meta').put({ key: 'checkpoint', value: 2 });
      await tx.readwrite('block_revisions').put({ ...revision, savedAt: 2 });
    })).rejects.toThrow('collision');
    expect((await storage.readonly('notes').get('n'))?.title).toBe('Saved');
    expect(await storage.readonly('meta').get('checkpoint')).toBeUndefined();
    await expect(storage.readwrite('sessions').put({ ...pin, id: 'invalid', blockVersion: 99 })).rejects.toThrow('pin');
    await storage.readwrite('notes').delete('n');
    expect(await storage.readonly('block_revisions').getAllFromIndex('by-note', 'n')).toEqual([revision]);
    expect(await storage.readonly('block_revisions').getAllFromIndex('by-block', ['n', 'b'])).toEqual([revision]);
    expect(await storage.readonly('block_revisions').get(['n', 'b', pin.blockVersion])).toEqual(revision);
    await expect(storage.readwrite('block_revisions').delete(['n', 'b', 1])).rejects.toThrow('wipe');
    await expect(storage.readwrite('block_revisions').clear()).rejects.toThrow('wipe');
    await storage.readwrite('memberships').put({ id: 'default', displayName: 'Retained', createdAt: 1 });
    await storage.wipe();
    expect(await storage.readonly('block_revisions').count()).toBe(0);
    expect((await storage.readonly('memberships').get('default'))?.displayName).toBe('Retained');
    await storage.close();
  });
});
