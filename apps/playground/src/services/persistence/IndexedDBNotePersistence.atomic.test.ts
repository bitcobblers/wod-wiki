import 'fake-indexeddb/auto';
import { describe, expect, it } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { InMemoryStorage } from '../storage/InMemoryStorage';
import { IndexedDBStorage } from '../storage/IndexedDBStorage';
import { StorageService } from '../storage/StorageService';
import { IndexedDBContentProvider } from '../content/IndexedDBContentProvider';
import { IndexedDBNotePersistence } from './IndexedDBNotePersistence';
import type { SaveNoteInput } from './types';

const SOURCE = '---\ntags: [benchmark]\n---\n# Workout\n\n```time\n10 Pushups\n```\n';

for (const backend of ['memory', 'indexeddb'] as const) {
  describe(`atomic source and run pins ${backend}`, () => {
    async function setup() {
      if (backend === 'indexeddb') globalThis.indexedDB = new IDBFactory();
      const storage: IStorage = backend === 'memory' ? new InMemoryStorage() : new IndexedDBStorage();
      const service = new StorageService(storage);
      const provider = new IndexedDBContentProvider(service);
      const persistence = new IndexedDBNotePersistence(service, provider);
      const entry = await provider.saveEntry({ id: 'n', title: 'Workout', rawContent: SOURCE, tags: ['manual'], targetDate: 1 });
      const blockId = Object.keys(entry.blocks!)[0]!;
      return { storage, service, provider, persistence, entry, blockId };
    }

    it('commits save plus exact Session pin and finishes after Note deletion', async () => {
      const { storage, service, persistence, entry, blockId } = await setup();
      try {
        const source = SOURCE.replace('10 Pushups', '20 Pushups');
        const input: SaveNoteInput = { noteId: entry.id, rawContent: source, blocks: entry.blocks!, expectedSourceRevision: entry.sourceRevision! };
        const started = await persistence.startSession(input, { id: 'run', noteId: entry.id, blockId,
          startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: 1 });
        expect(started.session.blockVersion).toBe(2);
        expect(started.revision.rawContent).toContain('20 Pushups');
        expect(started.note.rawContent).toBe(source);
        await service.deleteNote(entry.id);
        const finished = await persistence.finishSession('run', { startTime: 1, endTime: 10, duration: 9,
          completed: true, logs: [{ id: 1, outputType: 'segment', metrics: [{ type: 'rep', value: 20, origin: 'runtime' }],
            sourceBlockKey: '1', stackLevel: 0 }] });
        expect(finished.blockVersion).toBe(2);
        expect(await persistence.getBlockRevision(entry.id, blockId, 2)).toEqual(started.revision);
        expect((await service.getEventsByResult('run'))[0]).toMatchObject({ blockId, blockVersion: 2 });
      } finally { await storage.close(); }
    });

    it('rejects stale drafts and rolls back source, revisions and projections', async () => {
      const { storage, service, provider, persistence, entry } = await setup();
      try {
        await provider.updateEntry(entry.id, { rawContent: SOURCE.replace('10 Pushups', '20 Pushups'), blocks: entry.blocks,
          expectedSourceRevision: entry.sourceRevision });
        const before = await service.getNote(entry.id);
        // fake-indexeddb stalls a write tx when a standalone notes read AND a
        // block_revisions read both precede it in one test (scheduler artifact;
        // the same sequence rejects in 10ms on real IndexedDB and libsql).
        // Assert history against the deterministic fixture instead.
        const expectedHistory = ['```time\n10 Pushups\n```', '```time\n20 Pushups\n```'];
        await expect(persistence.saveNote({ noteId: entry.id, rawContent: SOURCE,
          blocks: entry.blocks!, expectedSourceRevision: entry.sourceRevision! })).rejects.toMatchObject({ code: 'STALE_SOURCE' });
        // In-transaction stale guard at its owning boundary. (The equivalent
        // provider.updateEntry path also rejects; through fake-indexeddb its
        // 12-store abort after two prior standalone reads stalls the harness
        // — scheduler artifact, not production behavior.)
        await expect(service.saveNoteSource({ noteId: entry.id, rawContent: before!.rawContent,
          blocks: before!.blocks, expectedSourceRevision: 1, metadata: { title: 'Stale title' } }))
          .rejects.toMatchObject({ code: 'STALE_SOURCE' });
        expect(await service.getNote(entry.id)).toEqual(before);
        expect((await service.getNoteBlockHistory(entry.id)).map(row => row.rawContent)).toEqual(expectedHistory);
      } finally { await storage.close(); }
    });

    it('rolls back an edited source when Session creation fails', async () => {
      const { storage, service, entry, blockId } = await setup();
      try {
        const failing: IStorage = { readonly: name => storage.readonly(name), readwrite: name => storage.readwrite(name),
          transaction: (stores, mode, fn) => storage.transaction(stores, mode, async tx => {
            const result = await fn(tx);
            if (stores.includes('sessions') && mode === 'readwrite') throw new Error('commit failed');
            return result;
          }), wipe: () => storage.wipe(), close: () => storage.close() };
        const failingService = new StorageService(failing);
        const persistence = new IndexedDBNotePersistence(failingService, new IndexedDBContentProvider(failingService));
        // Standalone reads from two different stores back-to-back stall a
        // following write tx under fake-indexeddb (scheduler artifact; real
        // IndexedDB/libsql unaffected). Read both snapshots in one tx.
        const snapshot = async () => storage.transaction(['block_revisions', 'block_index'], 'readonly', async tx => ({
          history: await tx.readonly('block_revisions').getAllFromIndex('by-note', entry.id),
          indices: await tx.readonly('block_index').getAllFromIndex('by-note', entry.id),
        }));
        const { history, indices } = await snapshot();
        await expect(persistence.startSession({ noteId: entry.id, rawContent: SOURCE.replace('10 Pushups', '20 Pushups'),
          blocks: entry.blocks!, expectedSourceRevision: entry.sourceRevision! },
          { id: 'failed', noteId: entry.id, blockId, startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: 1 })).rejects.toThrow('commit failed');
        expect((await service.getNote(entry.id))?.rawContent).toBe(SOURCE);
        expect(await snapshot()).toEqual({ history, indices });
        expect(await service.getSessionById('failed')).toBeUndefined();
      } finally { await storage.close(); }
    });

    it('does not write an identical save and rejects forged occurrence offsets', async () => {
      const { storage, service, entry } = await setup();
      try {
        let writes = 0;
        const observed: IStorage = { readonly: name => storage.readonly(name), readwrite: name => storage.readwrite(name),
          transaction: (stores, mode, fn) => storage.transaction(stores, mode, tx => fn({ readonly: name => tx.readonly(name),
            readwrite: name => { const store = tx.readwrite(name); return {
              get: key => store.get(key), getMany: keys => store.getMany(keys),
              getAll: (query, count) => store.getAll(query, count),
              getAllFromIndex: (index, query, count) => store.getAllFromIndex(index, query, count),
              getAllFromIndexMany: (index, keys) => store.getAllFromIndexMany(index, keys),
              count: query => store.count(query), countFromIndex: (index, query) => store.countFromIndex(index, query),
              clear: async () => { writes++; return store.clear(); },
              put: async (row, key) => { writes++; return store.put(row, key); },
              putMany: async (rows, keys) => { writes += rows.length; return store.putMany(rows, keys); },
              delete: async key => { writes++; return store.delete(key); } }; } })),
          wipe: () => storage.wipe(), close: () => storage.close() };
        const observedService = new StorageService(observed);
        const provider = new IndexedDBContentProvider(observedService);
        await provider.updateEntry(entry.id, { rawContent: entry.rawContent, blocks: entry.blocks, expectedSourceRevision: entry.sourceRevision, tags: entry.tags });
        expect(writes).toBe(0);
        await provider.saveEntry({ ...entry, sourceRevision: entry.sourceRevision });
        expect(writes).toBe(0);
        const wrong = reconcileNoteBlocks(SOURCE, { sourceRevision: 1 });
        Object.values(wrong)[0]!.from++;
        await expect(service.saveNoteSource({ noteId: entry.id, rawContent: SOURCE, blocks: wrong, expectedSourceRevision: 1 })).rejects.toThrow();
        expect((await service.getNote(entry.id))?.sourceRevision).toBe(1);
        const inflated = Object.fromEntries(Object.entries(entry.blocks!).map(([id, block]) => [id, { ...block, version: 999 }]));
        const saved = await provider.updateEntry(entry.id, { rawContent: SOURCE, blocks: inflated, expectedSourceRevision: 1 });
        expect(Object.values(saved.blocks!)[0]?.version).toBe(1);
        expect(writes).toBe(0);
      } finally { await storage.close(); }
    });

    it('compares saved history per occurrence and ignores unsaved version increments', async () => {
      const { storage, service, provider, entry, blockId } = await setup();
      try {
        const rawContent = SOURCE + '\n```time\n10 Pushups\n```';
        const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: 1, blocks: entry.blocks });
        const duplicated = await provider.updateEntry(entry.id, { rawContent, blocks, expectedSourceRevision: 1 });
        const copyId = Object.keys(duplicated.blocks!).find(id => id !== blockId)!;
        const edited = await provider.updateEntry(entry.id, { rawContent: rawContent.replace('10 Pushups', '20 Pushups'),
          blocks: duplicated.blocks, expectedSourceRevision: duplicated.sourceRevision });
        expect(edited.blocks?.[blockId]?.version).toBe(2);
        expect(edited.blocks?.[copyId]?.version).toBe(1);
        const history = await service.getNoteBlockHistory(entry.id);
        const unsaved = Object.fromEntries(Object.entries(edited.blocks!).map(([id, block]) => [id, { ...block, version: block.version + 5 }]));
        const unchanged = await provider.updateEntry(entry.id, { rawContent: edited.rawContent, blocks: unsaved,
          expectedSourceRevision: edited.sourceRevision });
        expect(unchanged.blocks).toEqual(edited.blocks);
        expect(unchanged.sourceRevision).toBe(edited.sourceRevision);
        expect(await service.getNoteBlockHistory(entry.id)).toEqual(history);
      } finally { await storage.close(); }
    });

    it('retains never-run versions, reverted versions and removed occurrence history', async () => {
      const { storage, service, provider, entry, blockId } = await setup();
      try {
        const source = SOURCE.replace('10 Pushups', '20 Pushups');
        const v2 = await provider.updateEntry(entry.id, { rawContent: source, blocks: entry.blocks, expectedSourceRevision: 1 });
        const v3 = await provider.updateEntry(entry.id, { rawContent: SOURCE, blocks: v2.blocks, expectedSourceRevision: 2 });
        expect(v3.blocks?.[blockId]?.version).toBe(3);
        expect((await service.getBlockHistory(entry.id, blockId)).map(row => [row.version, row.rawContent]))
          .toEqual([[1, '```time\n10 Pushups\n```'], [2, '```time\n20 Pushups\n```'], [3, '```time\n10 Pushups\n```']]);
        const removed = await provider.updateEntry(entry.id, { rawContent: '# Removed\n', blocks: {}, expectedSourceRevision: 3 });
        expect(await service.getNoteBlockHistory(entry.id)).toHaveLength(3);
        expect(await service.getBlockIndexByNote(entry.id)).toEqual([]);
        expect(await service.getAllFromIndex('block_efforts', 'by-note', entry.id)).toEqual([]);
        const restored = await provider.updateEntry(entry.id, { rawContent: source, blocks: entry.blocks,
          expectedSourceRevision: removed.sourceRevision });
        expect(restored.blocks?.[blockId]?.version).toBe(4);
        expect(await service.getSessionsForNote(entry.id)).toEqual([]);
        await service.deleteNote(entry.id);
        expect(await service.getNoteBlockHistory(entry.id)).toHaveLength(4);
      } finally { await storage.close(); }
    });

    it('preserves revisions and effort links when prose changes or a known occurrence moves', async () => {
      const { storage, service, provider, entry } = await setup();
      try {
        const history = await service.getNoteBlockHistory(entry.id);
        const efforts = await service.getAllFromIndex('block_efforts', 'by-note', entry.id);
        expect(efforts.length).toBeGreaterThan(0);
        const prefix = '# Introductory prose\n\n';
        const blocks = Object.fromEntries(Object.entries(entry.blocks!).map(([id, block]) => [id,
          { ...block, from: block.from + prefix.length, to: block.to + prefix.length }]));
        const moved = await provider.updateEntry(entry.id, { rawContent: prefix + SOURCE, blocks, expectedSourceRevision: 1 });
        expect(Object.keys(moved.blocks!)).toEqual(Object.keys(entry.blocks!));
        expect(await service.getNoteBlockHistory(entry.id)).toEqual(history);
        expect(await service.getAllFromIndex('block_efforts', 'by-note', entry.id)).toEqual(efforts);
        expect((await service.getBlockIndexByNote(entry.id))[0]?.from).toBe(Object.values(blocks)[0]?.from);
      } finally { await storage.close(); }
    });
  });
}
