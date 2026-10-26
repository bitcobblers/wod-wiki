import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBStorage } from '@/services/storage';
import { compileSeedRow } from '../../../../../packages/tools/src/seedbuild/compiler';
import { SEED_SCHEMA, emptySeedMeta, seedMetaKey } from '@/types/seed';
import { seedNoteId } from './FeedImporter';
import { IndexedDBFeedImportStorage, type SeedChunkWrite } from './FeedImportStorage';

const key = seedMetaKey('core');
const originalIndexedDB = globalThis.indexedDB;
let idb: IndexedDBStorage;
let storage: IndexedDBFeedImportStorage;
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); idb = new IndexedDBStorage(); storage = new IndexedDBFeedImportStorage(idb); });
afterEach(async () => { await idb.close(); if (originalIndexedDB === undefined) Reflect.deleteProperty(globalThis, 'indexedDB'); else globalThis.indexedDB = originalIndexedDB; });

async function writeFixture(): Promise<SeedChunkWrite> {
  const row = compileSeedRow('markdown/notebooks/test/a.md', '# A\n\n```time\n10 Push-ups\n```\n');
  const id = await seedNoteId(row.path);
  return { chunkId: 'notebook.test', rows: [row], manifest: { schema: SEED_SCHEMA, version: 1, builtAt: new Date(1).toISOString(), chunks: [] }, expectedMeta: undefined, meta: { ...emptySeedMeta(key), importedAt: 1, chunks: { 'notebook.test': { sha256: 'a'.repeat(64), noteIds: [id] } } } };
}

describe('atomic sparse seed storage', () => {
  it('commits source map, immutable history, projections and checkpoint together', async () => {
    const write = await writeFixture();
    await storage.applyChunk(write);
    expect(await storage.getSeedMeta(key)).toEqual(write.meta);
    expect(await idb.readonly('notes').count()).toBe(1);
    expect(await idb.readonly('block_revisions').count()).toBe(1);
    expect(await idb.readonly('block_index').count()).toBe(1);
  });
  it('commit failure rolls back source, revisions, projections and checkpoint, then retries', async () => {
    const write = await writeFixture();
    const failing = new IndexedDBFeedImportStorage({
      readonly: idb.readonly.bind(idb), readwrite: idb.readwrite.bind(idb),
      wipe: idb.wipe.bind(idb), close: idb.close.bind(idb),
      transaction: (stores, mode, fn) => idb.transaction(stores, mode, async (tx) => {
        await fn(tx);
        throw new Error('forced commit failure');
      }),
    });
    await expect(failing.applyChunk(write)).rejects.toThrow(/forced commit failure/);
    expect(await idb.readonly('notes').count()).toBe(0);
    expect(await idb.readonly('block_index').count()).toBe(0);
    expect(await storage.getSeedMeta(key)).toBeUndefined();
    expect(await idb.readonly('block_revisions').count()).toBe(0);
    await storage.applyChunk(write);
    expect(await idb.readonly('block_revisions').count()).toBe(1);
  });
  it('immutable v1 collision aborts a later chunk transaction', async () => {
    const write = await writeFixture();
    const block = Object.values(write.rows[0].blocks)[0];
    const noteId = await seedNoteId(write.rows[0].path);
    await idb.readwrite('block_revisions').put({ noteId, blockId: block.id, version: 1, kind: block.kind, rawContent: write.rows[0].content.slice(block.from, block.to), dialect: 'time', savedAt: 0 });
    const original = idb.transaction.bind(idb);
    const failing = new IndexedDBFeedImportStorage({
      readonly: idb.readonly.bind(idb), readwrite: idb.readwrite.bind(idb), wipe: idb.wipe.bind(idb), close: idb.close.bind(idb),
      transaction: (stores, mode, fn) => original(stores, mode, async (tx) => {
        const result = await fn(tx);
        await tx.readwrite('block_revisions').put({ noteId, blockId: block.id, version: 1, kind: block.kind, rawContent: 'conflicting source', dialect: 'time', savedAt: 0 });
        return result;
      }),
    });
    await expect(failing.applyChunk(write)).rejects.toThrow();
    expect(await idb.readonly('notes').count()).toBe(0);
    expect(await idb.readonly('block_index').count()).toBe(0);
    expect(await storage.getSeedMeta(key)).toBeUndefined();
    expect(await idb.readonly('block_revisions').count()).toBe(1);
  });
  it('checkpoint race rejects all planned mutations', async () => {
    const write = await writeFixture();
    await storage.putSeedMeta({ ...emptySeedMeta(key), claim: { owner: 'other', at: 1 } });
    await expect(storage.applyChunk(write)).rejects.toThrow(/checkpoint changed/);
    expect(await idb.readonly('notes').count()).toBe(0);
  });
  it('definition chunk commits the note and its projection together — never half-imported', async () => {
    const effortDoc = ['---', 'id: effort-seed-1', 'slug: turkish-get-up', 'label: Turkish Get-Up', 'aliases: []', 'baseAttributes:', '  met: 5.5', '---', '', 'Ground to standing.', ''].join('\n');
    const row = compileSeedRow('markdown/efforts/strength/turkish-get-up.md', effortDoc);
    const id = await seedNoteId(row.path);
    const write: SeedChunkWrite = { chunkId: 'efforts', rows: [row], manifest: { schema: SEED_SCHEMA, version: 1, builtAt: new Date(1).toISOString(), chunks: [] }, expectedMeta: undefined, meta: { ...emptySeedMeta(key), importedAt: 1, chunks: { efforts: { sha256: 'b'.repeat(64), noteIds: [id] } } } };

    await storage.applyChunk(write);
    // The note is the storage form; the typed row is its projection.
    expect(await idb.readonly('notes').count()).toBe(1);
    expect((await idb.readonly('notes').get(id))?.rawContent).toBe(effortDoc);
    const projection = await idb.readonly('efforts').get('turkish-get-up');
    expect(projection?.ownerNoteId).toBe(id);
    expect(projection?.registrySource).toBe('bundled');

    // A commit failure rolls back BOTH — no half-imported definition.
    globalThis.indexedDB = new IDBFactory();
    const idb2 = new IndexedDBStorage();
    const failing = new IndexedDBFeedImportStorage({
      readonly: idb2.readonly.bind(idb2), readwrite: idb2.readwrite.bind(idb2),
      wipe: idb2.wipe.bind(idb2), close: idb2.close.bind(idb2),
      transaction: (stores, mode, fn) => idb2.transaction(stores, mode, async (tx) => {
        await fn(tx);
        throw new Error('forced commit failure');
      }),
    });
    await expect(failing.applyChunk(write)).rejects.toThrow(/forced commit failure/);
    expect(await idb2.readonly('notes').count()).toBe(0);
    expect(await idb2.readonly('efforts').count()).toBe(0);
    await idb2.close();
  });
  it('claim acquisition verifies the original full row in the transaction', async () => {
    const claimed = { ...emptySeedMeta(key), claim: { owner: 'first', at: 1 } };
    await storage.putSeedMeta(claimed, null);
    await expect(storage.putSeedMeta({ ...claimed, claim: { owner: 'second', at: 2 } }, null)).rejects.toThrow(/checkpoint changed/);
    expect(await storage.getSeedMeta(key)).toEqual(claimed);
  });
});
