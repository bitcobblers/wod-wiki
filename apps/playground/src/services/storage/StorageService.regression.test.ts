/** StorageService behavior against real local stores and remote bundle plans. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBStorage, InMemoryStorage, StorageService } from './index';
import type { IStorage } from './IStorage';
import { DOMAIN_PROJECTION_VERSION, DB_VERSION, type DomainEntry, userDeletedSeedKey } from '@bitcobblers/wod-wiki-storage';
import { applySeedChunk, seedNoteId } from '../../../../../packages/engine/src/seed/runtime';
import { emptySeedMeta, SEED_SCHEMA } from '../../../../../packages/engine/src/seed/contract';
import type { BlockIndexRow, EventRecord, Note, Session } from '@/types/storage';

const T0 = 1_700_000_000_000;

function makeNote(overrides: Partial<Note> = {}): Note {
  return { id: 'note-1', title: 'Note 1', createdAt: T0, rawContent: '', sourceRevision: 1, blocks: {}, ...overrides };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'run-1',
    noteId: 'note-1',
    blockId: 'block-1',
    blockVersion: 1,
    blockContentId: 'bc-1',
    origin: 'journal',
    startTime: T0,
    endTime: T0 + 60_000,
    duration: 60_000,
    completed: true,
    createdAt: T0 + 60_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventRecord> & { id: string; resultId: string }): EventRecord {
  return {
    noteId: 'note-1',
    timestamp: T0,
    grain: 'event',
    outputType: 'segment',
    metrics: [],
    ...overrides,
  };
}

async function seedEventCorpus(service: StorageService): Promise<void> {
  for (const noteId of ['note-1', 'note-2']) {
    await service.saveNoteSource({ noteId, rawContent: '```time\n10 Pushups\n```', expectedSourceRevision: 0,
      blocks: { 'block-1': { id: 'block-1', kind: 'wod', dialect: 'time', version: 1, sourceRevision: 1, from: 0, to: '```time\n10 Pushups\n```'.length } },
      metadata: { title: noteId }, createdAt: T0 });
  }
  await service.saveSession(makeSession());
  await service.saveSession(makeSession({ id: 'run-2', noteId: 'note-2' }));
  await service.appendEvents([
    // run-1 detail + summary + wellness — the full grain set for note-1
    makeEvent({ id: 'run-1:0', resultId: 'run-1', blockContentId: 'bc-1', timestamp: T0 + 1000 }),
    makeEvent({ id: 'run-1:summary:rep', resultId: 'run-1', grain: 'summary', timestamp: T0 }),
    makeEvent({
      id: 'wellness:note-1:sleep', resultId: 'wellness:note-1', grain: 'summary',
      outputType: 'sleep', timestamp: T0, metricDateKeys: ['2026-01-01'],
    }),
    // metric-date rows across two results
    makeEvent({ id: 'run-1:1', resultId: 'run-1', timestamp: T0 + 2000, metricDateKeys: ['2026-01-02', '2026-01-03'] }),
    makeEvent({ id: 'run-2:0', resultId: 'run-2', noteId: 'note-2', timestamp: T0 + 3000, metricDateKeys: ['2026-01-03'] }),
    // content-scoped row on another result
    makeEvent({ id: 'run-2:1', resultId: 'run-2', noteId: 'note-2', blockContentId: 'bc-1', timestamp: T0 + 4000 }),
  ]);
}

const sortedIds = (rows: EventRecord[]) => rows.map((r) => r.id).sort();

describe('StorageService indexed event reads — parity across backends', () => {
  const makeService = async () => {
    const service = new StorageService(new InMemoryStorage());
    await seedEventCorpus(service);
    return service;
  };

  let local: StorageService;
  let remote: StorageService;
  let remoteStorage: IndexedDBStorage;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    local = await makeService();
    remoteStorage = new IndexedDBStorage();
    remote = new StorageService(remoteStorage);
    await seedEventCorpus(remote);
  });

  afterEach(async () => {
    await remote.wipe();
    await remoteStorage.close();
    Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  it('getEventsForNote includes every session row across ALL grains plus the wellness pseudo-result', async () => {
    for (const service of [local, remote]) {
      const events = await service.getEventsForNote('note-1');
      // run-1 detail + run-1 summary + wellness — the detail grain is the
      // regression: the old read fetched only [resultId, 'summary'].
      expect(sortedIds(events)).toEqual([
        'run-1:0',
        'run-1:1',
        'run-1:summary:rep',
        'wellness:note-1:sleep',
      ]);
    }
    expect(sortedIds(await local.getEventsForNote('note-1')))
      .toEqual(sortedIds(await remote.getEventsForNote('note-1')));
  });

  it('getEventsByResult / ByTimeRange / ByMetricDates / ByContent match the previous full-scan row sets', async () => {
    expect(sortedIds(await local.getEventsByResult('run-2')))
      .toEqual(sortedIds(await remote.getEventsByResult('run-2')));
    expect(sortedIds(await local.getEventsByResult('run-2'))).toEqual(['run-2:0', 'run-2:1']);

    // inclusive bounds on both ends — unchanged timestamp semantics
    expect(sortedIds(await local.getEventsByTimeRange(T0 + 1000, T0 + 2000)))
      .toEqual(sortedIds(await remote.getEventsByTimeRange(T0 + 1000, T0 + 2000)));
    expect(sortedIds(await local.getEventsByTimeRange(T0 + 1000, T0 + 2000)))
      .toEqual(['run-1:0', 'run-1:1']);

    // union over dates, deduped by row id (run-1:1 and run-2:0 share 2026-01-03)
    expect(sortedIds(await local.getEventsByMetricDates(['2026-01-02', '2026-01-03'])))
      .toEqual(sortedIds(await remote.getEventsByMetricDates(['2026-01-02', '2026-01-03'])));
    expect(sortedIds(await local.getEventsByMetricDates(['2026-01-02', '2026-01-03'])))
      .toEqual(['run-1:1', 'run-2:0']);
    expect(await local.getEventsByMetricDates([])).toEqual([]);

    // content join spans every result/grain for the block
    expect(sortedIds(await local.getEventsByContent('bc-1')))
      .toEqual(sortedIds(await remote.getEventsByContent('bc-1')));
    expect(sortedIds(await local.getEventsByContent('bc-1')))
      .toEqual(['run-1:0', 'run-2:1']);

    // selective block candidates are indexed, not scans
    expect((await local.getBlockIndexByType('wod')).map((r) => r.id).sort())
      .toEqual((await remote.getBlockIndexByType('wod')).map((r) => r.id).sort());
    expect(await local.countBlockIndex()).toBe(await remote.countBlockIndex());
  });
});

describe('StorageService live Note deletion', () => {
  it('retains immutable history, Sessions and events while deleting live projections', async () => {
    const storage = new InMemoryStorage();
    const service = new StorageService(storage);
    await service.saveNote(makeNote({ id: 'doomed' }));
    await service.saveNote(makeNote({ id: 'survivor' }));
    await storage.readwrite('block_revisions').put({ noteId: 'doomed', blockId: 'b', version: 1,
      kind: 'wod', rawContent: '```time\n10 Pushups\n```', dialect: 'time', savedAt: T0 });
    await service.saveSession(makeSession({ id: 'doomed-run', noteId: 'doomed', blockId: 'b' }));
    await service.appendEvents([makeEvent({ id: 'doomed-run:0', resultId: 'doomed-run', noteId: 'doomed' })]);
    await service.setNoteTags('doomed', ['tag-x']);
    await storage.readwrite('block_efforts').put({ id: 'doomed:b:push-up', noteId: 'doomed', blockId: 'b', effortSlug: 'push-up', createdAt: T0 });
    await storage.readwrite('block_efforts').put({ id: 'survivor:b:run', noteId: 'survivor', blockId: 'b', effortSlug: 'run', createdAt: T0 });
    await service.deleteNote('doomed');
    expect(await service.getNote('doomed')).toBeUndefined();
    expect(await service.getBlockHistory('doomed', 'b')).toHaveLength(1);
    expect(await service.getSessionsForNote('doomed')).toHaveLength(1);
    expect(await service.getEventsForNote('doomed')).toHaveLength(1);
    expect(await service.getTagsForNote('doomed')).toEqual([]);
    expect(await service.getBlockIndexByNote('doomed')).toEqual([]);
    expect(await service.getAllFromIndex('block_efforts', 'by-note', 'doomed')).toEqual([]);
    expect(await service.getAllFromIndex('block_efforts', 'by-note', 'survivor')).toHaveLength(1);
  });

  it('deleting an edited seed note writes a tombstone so re-import cannot resurrect it', async () => {
    const storage = new InMemoryStorage();
    const service = new StorageService(storage);
    const seedPath = 'markdown/collections/edited.md';
    const seedId = await seedNoteId(seedPath);
    const seedWrite = {
      chunkId: 'collection.edited',
      rows: [{ path: seedPath, content: '# Edited seed', blocks: {}, blockIndex: [], blockEfforts: [], blockEquipment: [] }],
      manifest: { schema: SEED_SCHEMA, version: 1, builtAt: new Date(0).toISOString(), chunks: [] },
      expectedMeta: undefined,
      meta: { ...emptySeedMeta('seed:edited-deletion'), chunks: { 'collection.edited': { sha256: 'a'.repeat(64), noteIds: [seedId] } } },
    };
    await applySeedChunk(storage, seedWrite);
    // Editing flips ownership to 'user' but retains seedChunkId/sourcePath.
    const edited = await service.getNote(seedId);
    expect(edited?.seedChunkId).toBe('collection.edited');
    expect(edited?.sourcePath).toBe(seedPath);
    await service.saveNote({ ...edited!, seedOrigin: 'user', title: 'My edited seed' });

    await service.deleteNote(seedId);
    expect(await storage.readonly('meta').get(userDeletedSeedKey(seedId))).toBeDefined();
    await applySeedChunk(storage, { ...seedWrite, expectedMeta: seedWrite.meta });
    expect(await service.getNote(seedId)).toBeUndefined();

    // Ordinary user-created deletion stays tombstone-free.
    await service.saveNote(makeNote({ id: 'mine' }));
    await service.deleteNote('mine');
    expect(await storage.readonly('meta').get(userDeletedSeedKey('mine'))).toBeUndefined();
  });
});

describe('StorageService note date candidates', () => {
  it('is complete over dated notes and createdAt fallback, honoring endExclusive', async () => {
    const service = new StorageService(new InMemoryStorage());
    await service.saveNote(makeNote({ id: 'dated', date: T0 + 1000 }));
    await service.saveNote(makeNote({ id: 'fallback', createdAt: T0 + 2000 })); // no date
    await service.saveNote(makeNote({ id: 'early', createdAt: T0 - 1000 }));

    const window = await service.getNotesByDateRange(T0, T0 + 2000);
    expect(window.map((n) => n.id).sort()).toEqual(['dated', 'fallback']);

    const exclusive = await service.getNotesByDateRange(T0, T0 + 2000, { endExclusive: true });
    expect(exclusive.map((n) => n.id).sort()).toEqual(['dated']);

    const open = await service.getNotesByDateRange(T0 + 1000, T0 + 2000);
    expect(open.map((n) => n.id).sort()).toEqual(['dated', 'fallback']);
  });

  it('batches whole Note source, tags and placement metadata', async () => {
    const service = new StorageService(new InMemoryStorage());
    await service.saveNote(makeNote({ id: 'n1', rawContent: 'Exact\r\n' }));
    await service.setNoteTags('n1', ['tag-y']);
    const batches = await service.getEntryBatches(['n1', 'missing']);
    expect(batches.get('n1')?.note.rawContent).toBe('Exact\r\n');
    expect(batches.get('n1')?.tags.map(tag => tag.label)).toEqual(['tag-y']);
    expect(batches.has('missing')).toBe(false);
  });
});

describe('withTransaction — scope, nested join, rollback', () => {
  it('joins nested service transactions and commits atomically (InMemory)', async () => {
    const service = new StorageService(new InMemoryStorage());
    await service.withTransaction(['notes', 'events'], async (scoped) => {
      await scoped.saveNote(makeNote({ id: 'scoped-note' }));
      await scoped.appendEvents([makeEvent({ id: 'scoped:0', resultId: 'scoped' })]);
    });
    expect(await service.getNote('scoped-note')).toBeDefined();
    expect((await service.getEventsByResult('scoped')).map((e) => e.id)).toEqual(['scoped:0']);
    // scoped instances hide the remote query capability (stale remote reads)
    await service.withTransaction(['notes'], async (scoped) => {
      expect(await scoped.queryDomain({ plan: 'notes' })).toBeUndefined();
    });
  });

  it('rolls back every write when fn rejects (InMemory snapshot restore)', async () => {
    const service = new StorageService(new InMemoryStorage());
    await service.saveNote(makeNote());
    const eventsBefore = await service.countEvents();
    await expect(service.withTransaction(['notes', 'events'], async (scoped) => {
      await scoped.saveNote(makeNote({ id: 'half' }));
      await scoped.appendEvents([makeEvent({ id: 'half:0', resultId: 'half' })]);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await service.getNote('half')).toBeUndefined();
    expect(await service.countEvents()).toBe(eventsBefore);
    expect(await service.getNote('note-1')).toBeDefined();
  });

  it('aborts the native IndexedDB transaction when fn rejects', async () => {
    globalThis.indexedDB = new IDBFactory();
    try {
      const storage = new IndexedDBStorage();
      const service = new StorageService(storage);
      await service.saveNote(makeNote());
      const eventsBefore = await service.countEvents();
      await expect(service.withTransaction(['notes', 'events'], async (scoped) => {
        await scoped.saveNote(makeNote({ id: 'idb-half' }));
        throw new Error('boom');
      })).rejects.toThrow('boom');
      expect(await service.getNote('idb-half')).toBeUndefined();
      expect(await service.countEvents()).toBe(eventsBefore);
      expect(await service.getNote('note-1')).toBeDefined();
      await storage.close();
    } finally {
      Reflect.deleteProperty(globalThis, 'indexedDB');
    }
  });
});

describe('countBlockIndexInDomain — local sourceFence parity', () => {
  function makeBlock(overrides: Partial<BlockIndexRow> & { id: string }): BlockIndexRow {
    const noteId = overrides.noteId ?? '01990e80-0000-7000-8000-0000000000aa';
    const blockId = overrides.id;
    return {
      blockVersion: 1, sourceRevision: 1, from: 0, to: 1, dataType: 'wod',
      rawContent: 'x', noteTitle: 'b', createdAt: T0,
      ...overrides, noteId, blockId, id: `${noteId}:${blockId}`,
    };
  }

  it('counts sourceless and supported source families while excluding journal playground IDs', async () => {
    const storage = new InMemoryStorage();
    const service = new StorageService(storage);
    const rows: BlockIndexRow[] = [
      // sourceless always passes — including pg-* note ids and empty sourceId
      makeBlock({ id: 'pg-legacy-user:sec-1:1', noteId: 'pg-legacy-user' }),
      makeBlock({ id: 'plain:s:1' }),
      makeBlock({ id: 'es:s:1', sourceId: '' }),
      // vocabulary source families pass
      makeBlock({ id: 'c:s:1', sourceId: 'collection:girls' }),
      // collection pg: pg exclusion belongs to the journal branch only
      makeBlock({ id: 'pgc:s:1', noteId: 'pg-note', sourceId: 'collection:girls' }),
      // pg-* primary key with a vocabulary sourceId stays reachable
      makeBlock({ id: 'pg-x:sec-1:1', noteId: 'pg-x', sourceId: 'collection:girls' }),
      makeBlock({ id: 'pc:s:1', sourceId: 'page:collection:girls' }),
      makeBlock({ id: 'g:s:1', sourceId: 'guides:basics' }),
      makeBlock({ id: 'pl:s:1', sourceId: 'playground', noteId: 'playground/x' }),
      // explicit journal: pg id/noteId are excluded by the journal branch
      makeBlock({ id: 'js:s:1', sourceId: 'journal' }),
      makeBlock({ id: 'jpg:s:1', sourceId: 'journal', noteId: 'pg-x' }),
      // excised / unknown families drop
      makeBlock({ id: 'f:s:1', sourceId: 'feed:dir/2024-01-01/file' }),
      makeBlock({ id: 'u:s:1', sourceId: 'unknown-source' }),
      // 'page:' alone is NOT a vocabulary kind (only page:collection: passes)
      makeBlock({ id: 'po:s:1', sourceId: 'page:other' }),
      // bare 'collection' without the colon does not match the prefix
      makeBlock({ id: 'cb:s:1', sourceId: 'collection' }),
      // unicode suffix inside a passing family
      makeBlock({ id: 'uni:s:1', sourceId: 'collection:café-ünïcode' }),
      // lexicographic edge just past the ':' prefix — not a prefix match
      makeBlock({ id: 'semi:s:1', sourceId: 'collection;' }),
    ];
    for (const row of rows) await storage.readwrite('block_index').put(row);

    const count = await service.countBlockIndexInDomain();
    expect(count).toBe(11);
  });
});

describe('incompatible IndexedDB', () => {
  it('refuses a newer schema without migrating or wiping it', async () => {
    globalThis.indexedDB = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('wodwiki-db', DB_VERSION + 1);
      request.onupgradeneeded = () => request.result.createObjectStore('notes', { keyPath: 'id' });
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const storage = new IndexedDBStorage();
    await expect(storage.readonly('notes').getAll()).rejects.toThrow(/newer than this client/i);
    await storage.close();
  });

  it('migrates an older schema instead of rejecting it', async () => {
    globalThis.indexedDB = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('wodwiki-db', 28);
      request.onupgradeneeded = () => request.result.createObjectStore('notes', { keyPath: 'id' });
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const storage = new IndexedDBStorage();
    expect(await storage.readonly('notes').getAll()).toEqual([]);
    await storage.close();
  });
});

describe('getEntryBatches — remote/local bundle chooser', () => {
  /** Remote backend stand-in: entries-plan responses only. */
  function fakeRemote(entries: DomainEntry[]): {
    storage: IStorage;
    chunks: string[][];
    localFallbacks: number;
  } {
    const chunks: string[][] = [];
    let localFallbacks = 0;
    const storage: IStorage = {
      readonly: () => { throw new Error('unexpected direct store read'); },
      readwrite: () => { throw new Error('unexpected direct store write'); },
      transaction: async (_stores, _mode, fn) => {
        localFallbacks += 1;
        return fn({ readonly: () => { throw new Error('no local stores'); }, readwrite: () => { throw new Error('no local stores'); } });
      },
      wipe: async () => {},
      close: async () => {},
      queryDomain: async (query) => {
        if (query.plan !== 'entries') throw new Error('expected entries plan');
        const ids = query.selection?.find((p) => 'values' in p && p.field === 'id');
        if (!ids || !('values' in ids)) throw new Error('expected id selection');
        chunks.push([...ids.values]);
        const wanted = new Set(ids.values);
        return {
          projectionVersion: DOMAIN_PROJECTION_VERSION,
          selectedCount: entries.length,
          matchedCount: entries.length,
          plan: 'entries',
          rows: entries.filter((e) => wanted.has(e.note.id)),
        };
      },
    };
    return { storage, chunks, localFallbacks };
  }

  const entry = (id: string): DomainEntry => ({
    note: makeNote({ id }),
    tags: [{ id: `t-${id}`, label: `${id}-tag`, createdAt: T0 }],
    links: [],
    pages: [],
  });

  it('chunks deduped ids at the 64-value parser limit and merges remote rows (>64 results valid)', async () => {
    const ids = Array.from({ length: 130 }, (_, i) => `note-${i}`);
    const remote = fakeRemote([...ids.map(entry), entry('note-0') /* duplicate id ignored */]);
    const out = await new StorageService(remote.storage).getEntryBatches(['note-0', ...ids, 'note-0']);
    // 130 distinct ids → 64 + 64 + 2, deduped before chunking.
    expect(remote.chunks.map((c) => c.length)).toEqual([64, 64, 2]);
    expect(remote.localFallbacks).toBe(0);
    expect(out.size).toBe(130);
    expect(out.get('note-0')!.tags[0]!.label).toBe('note-0-tag');
  });

  it('reads nothing for empty input and reports missing ids by absence (fail-closed)', async () => {
    const remote = fakeRemote([entry('exists')]);
    const service = new StorageService(remote.storage);
    expect((await service.getEntryBatches([])).size).toBe(0);
    expect(remote.chunks).toEqual([]);
    const out = await service.getEntryBatches(['exists', 'missing']);
    expect(out.has('exists')).toBe(true);
    expect(out.has('missing')).toBe(false);
    expect(remote.chunks).toEqual([['exists', 'missing']]);
  });

  it('falls back to the local transaction path when the domain plane is unavailable (409) and propagates storage errors', async () => {
    const failing: IStorage = {
      readonly: () => { throw new Error('no stores'); },
      readwrite: () => { throw new Error('no stores'); },
      transaction: async () => { throw new Error('local path must not open a transaction on the remote probe'); },
      wipe: async () => {},
      close: async () => {},
      queryDomain: async () => undefined, // 409 domain_projection_unavailable mapping
    };
    // 409 → undefined → falls through to the local path, which this probe
    // rejects: the fallthrough itself is what the rejection proves.
    await expect(new StorageService(failing).getEntryBatches(['x'])).rejects.toThrow('local path');
  });
});
