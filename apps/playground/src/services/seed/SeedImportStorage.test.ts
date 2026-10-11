import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBStorage } from '@/services/storage';
import { emptySeedMeta, seedMetaKey, seedSegmentId } from '@/types/seed';

const META_KEY = seedMetaKey('core');
import type { BlockIndexRow, Note, NoteSegment } from '@/types/storage';
import { IndexedDBSeedImportStorage, type SeedChunkWrite } from './SeedImportStorage';

// applyChunk enqueues the multi-thousand-row derived-chunk writes with
// Promise.all (#1066). Batching must not change the transaction contract:
// everything commits, or a failed write aborts the whole chunk.

const originalIndexedDB = globalThis.indexedDB;

function note(id: string): Note {
  return {
    id,
    title: id,
    createdAt: 1,
    type: 'note',
    sourceId: 'collections:test',
    catalog: 'test',
    seedOrigin: 'seed',
    seedVersion: 7,
    seedChunkId: 'canvas',
    sourcePath: `seed/${id}.md`,
  };
}

function segmentFor(id: string): NoteSegment {
  return {
    id: seedSegmentId(id),
    version: 1,
    noteId: id,
    position: 0,
    dataType: 'markdown',
    data: null,
    rawContent: `# ${id}`,
    createdAt: 1,
  };
}

function blockRow(i: number): BlockIndexRow {
  return {
    id: `static:block-${i}`,
    noteId: 'note-0',
    segmentId: seedSegmentId('note-0'),
    segmentVersion: 1,
    dataType: 'markdown',
    rawContent: '',
    noteTitle: 'n',
    createdAt: 1,
    isStatic: true,
  };
}

function chunkWrite(partial: Partial<SeedChunkWrite>): SeedChunkWrite {
  return {
    notes: [],
    segments: [],
    efforts: [],
    blocks: [],
    blockEfforts: [],
    deleteNoteIds: [],
    deleteEffortSlugs: [],
    deleteBlockIds: [],
    deleteBlockEffortIds: [],
    meta: emptySeedMeta(META_KEY),
    ...partial,
  };
}

describe('IndexedDBSeedImportStorage.applyChunk', () => {
  let seedStorage: IndexedDBSeedImportStorage;
  let idb: IndexedDBStorage;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    idb = new IndexedDBStorage();
    seedStorage = new IndexedDBSeedImportStorage(idb);
  });

  afterEach(async () => {
    await idb.close();
    if (originalIndexedDB === undefined) {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    } else {
      globalThis.indexedDB = originalIndexedDB;
    }
  });

  it('commits every batched row and the checkpoint in one transaction', async () => {
    const meta = { ...emptySeedMeta(META_KEY), seedVersion: 7, chunks: { canvas: { sha256: 'a' } } };
    await seedStorage.applyChunk(
      chunkWrite({
        notes: [note('note-0'), note('note-1')],
        segments: [segmentFor('note-0'), segmentFor('note-1')],
        blocks: Array.from({ length: 300 }, (_, i) => blockRow(i)),
        meta,
      }),
    );

    expect(await seedStorage.getSeedMeta(META_KEY)).toEqual(meta);
    expect(await idb.readonly('block_index').count()).toBe(300);
    expect(await idb.readonly('notes').get('note-1')).toMatchObject({ seedOrigin: 'seed' });
    expect(await idb.readonly('segments').get([seedSegmentId('note-0'), 1])).toMatchObject({ noteId: 'note-0' });
  });

  it('aborts the whole chunk when one batched write fails', async () => {
    const invalid = blockRow(999);
    Reflect.deleteProperty(invalid, 'id');

    await expect(
      seedStorage.applyChunk(
        chunkWrite({
          blocks: [...Array.from({ length: 50 }, (_, i) => blockRow(i)), invalid],
          meta: { ...emptySeedMeta(META_KEY), seedVersion: 9 },
        }),
      ),
    ).rejects.toThrow();

    expect(await idb.readonly('block_index').count()).toBe(0);
    expect(await idb.readonly('meta').get(META_KEY)).toBeUndefined();
  });
});
