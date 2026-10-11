/**
 * Public-storage regression tests for the domain/WQL cutover (V26):
 *  - indexed event reads: row-set parity across backends, all grains,
 *    wellness pseudo-result;
 *  - note_tags unique (noteId, tagId) pair with deterministic duplicate
 *    cleanup on upgrade;
 *  - latest-segment (MAX-before-history) resolution and complete deleteNote
 *    cascade incl. compound segment keys and block_efforts;
 *  - complete date candidates with createdAt fallback (indexed union);
 *  - legacy `results` store migration into sessions (with inline log
 *    projection) before the store is dropped;
 *  - withTransaction rollback (IDB abort + InMemory snapshot restore) and
 *    nested-transaction join.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { IndexedDBStorage, InMemoryStorage, StorageService } from './index';
import type { IStorage } from './IStorage';
import { DOMAIN_PROJECTION_VERSION, type DomainEntry } from '@bitcobblers/wod-wiki-storage';
import type { BlockIndexRow, EventRecord, Note, Session } from '@/types/storage';

const T0 = 1_700_000_000_000;

function makeNote(overrides: Partial<Note> = {}): Note {
  return { id: 'note-1', title: 'Note 1', createdAt: T0, ...overrides };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'run-1',
    noteId: 'note-1',
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
  await service.saveNote(makeNote());
  await service.saveNote(makeNote({ id: 'note-2', title: 'Note 2', createdAt: T0 + 5 }));
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

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    local = await makeService();
    remote = new StorageService(new IndexedDBStorage());
    await seedEventCorpus(remote);
  });

  afterEach(async () => {
    await remote.wipe();
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

describe('StorageService note history and cascade deletes', () => {
  it('resolves the latest segment (MAX version before the history flag) and deletes the whole note cascade', async () => {
    const storage = new InMemoryStorage();
    const service = new StorageService(storage);
    await service.saveNote(makeNote({ id: 'doomed' }));
    await service.saveNote(makeNote({ id: 'survivor', title: 'Keep' }));
    for (const version of [1, 2, 3]) {
      await service.saveSegment({
        id: 'doomed:sec-1', version, noteId: 'doomed', position: 0,
        dataType: 'wod', data: null, rawContent: 'v' + version,
        createdAt: T0 + version, isHistory: version < 3,
      });
    }
    // history-flagged newest incarnation: MAX version wins first, then the
    // flag filters — an active older version must not shadow the latest.
    await service.saveSegment({
      id: 'doomed:sec-2', version: 5, noteId: 'doomed', position: 1,
      dataType: 'wod', data: null, rawContent: 'retired', createdAt: T0, isHistory: true,
    });
    await service.saveSegment({
      id: 'doomed:sec-2', version: 2, noteId: 'doomed', position: 1,
      dataType: 'wod', data: null, rawContent: 'older-active', createdAt: T0, isHistory: false,
    });
    await service.saveSession(makeSession({ id: 'doomed-run', noteId: 'doomed' }));
    await service.appendEvents([
      makeEvent({ id: 'doomed-run:0', resultId: 'doomed-run', noteId: 'doomed' }),
      makeEvent({ id: 'wellness:doomed:hr', resultId: 'wellness:doomed', noteId: 'doomed' }),
    ]);
    await service.setNoteTags('doomed', ['tag-x']);
    // block_index rows for the doomed note (one non-history segment) plus
    // containment rows: doomed's must go, the survivor's must stay
    await service.rebuildBlockIndexForNote('doomed');
    await storage.readwrite('block_efforts').put({
      id: 'doomed:sec-1:thruster', noteId: 'doomed', blockId: 'sec-1',
      effortSlug: 'thruster', createdAt: T0,
    });
    await storage.readwrite('block_efforts').put({
      id: 'survivor:sec-1:run', noteId: 'survivor', blockId: 'sec-1',
      effortSlug: 'run', createdAt: T0,
    });

    const latest = await service.getLatestSegmentsForNote('doomed');
    expect(latest.map((s) => `${s.id}:${s.version}:${s.rawContent}`))
      .toEqual(['doomed:sec-1:3:v3']);
    expect(await service.getBlockIndexByNote('doomed')).toHaveLength(1);

    await service.deleteNote('doomed');

    expect(await service.getNote('doomed')).toBeUndefined();
    expect(await service.getAllSegments()).toEqual([]); // every (id, version) row gone
    expect(await service.getSessionsForNote('doomed')).toEqual([]);
    expect(await service.getEventsForNote('doomed')).toEqual([]);
    expect((await service.getNoteTagLabelsBatch()).has('doomed')).toBe(false);
    expect((await service.getAllBlockIndex()).filter((r) => r.noteId === 'doomed')).toEqual([]);
    expect(await service.getBlockIndexByNote('doomed')).toEqual([]);
    // block_efforts cleaned transactionally, survivor rows untouched
    expect(await service.getAllFromIndex('block_efforts', 'by-note', 'doomed')).toEqual([]);
    expect(await service.getAllFromIndex('block_efforts', 'by-note', 'survivor')).toHaveLength(1);
    expect(await service.getNote('survivor')).toBeDefined();
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

  it('batches entry metadata (segments MAX-before-history, tags, links, pages)', async () => {
    const service = new StorageService(new InMemoryStorage());
    await service.saveNote(makeNote({ id: 'n1' }));
    await service.saveSegment({
      id: 'n1:s1', version: 1, noteId: 'n1', position: 1,
      dataType: 'wod', data: null, rawContent: 'old', createdAt: T0, isHistory: true,
    });
    await service.saveSegment({
      id: 'n1:s1', version: 2, noteId: 'n1', position: 1,
      dataType: 'wod', data: null, rawContent: 'new', createdAt: T0 + 1,
    });
    await service.setNoteTags('n1', ['tag-y']);
    const tagBatches = await service.getEntryBatches(['n1', 'missing']);
    const batch = tagBatches.get('n1');
    expect(batch).toBeDefined();
    expect(batch!.segments.map((s) => s.rawContent)).toEqual(['new']);
    expect(batch!.tags.map((t) => t.label)).toEqual(['tag-y']);
    expect(tagBatches.has('missing')).toBe(false);
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
    return {
      noteId: '01990e80-0000-7000-8000-0000000000aa',
      segmentId: 'sec-1',
      segmentVersion: 1,
      dataType: 'wod',
      rawContent: 'x',
      noteTitle: 'b',
      createdAt: T0,
      ...overrides,
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

describe('IndexedDB V26 upgrade', () => {
  const DB_NAME = 'wodwiki-db';

  function openLegacyDb(version: number, setup: (db: IDBDatabase) => void): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const req = indexedDB.open(DB_NAME, version);
    req.onblocked = () => reject(new Error(`v${version} fixture open blocked by an undisposed connection`));
    req.onupgradeneeded = () => setup(req.result);
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
    return promise;
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  it('migrates residual results rows into sessions (projecting inline logs) and drops the store', async () => {
    await openLegacyDb(25, (db) => {
      // sessions/events are deliberately NOT created here — the upgrade
      // creates them with the full index set. sessions is created so the
      // "already migrated, but logs never projected" case is covered.
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      const results = db.createObjectStore('results', { keyPath: 'id' });
      // (a) plain flattened row missing from sessions
      results.put({
        id: 'legacy-a', noteId: 'note-1', createdAt: T0,
        startTime: T0, endTime: T0 + 10, duration: 10, completed: true,
      });
      // (b) pre-V21 inline logs, no session row, no events → project logs
      results.put({
        id: 'legacy-b', noteId: 'note-1', createdAt: T0,
        data: {
          logs: [{ outputType: 'segment', metrics: [{ type: 'rep', value: 21, image: '21', origin: 'runtime' }] }],
          startTime: T0,
          endTime: T0 + 5,
        },
      });
      // (c) session row exists BUT its inline logs were never projected
      sessions.put({
        id: 'legacy-c', noteId: 'note-1', createdAt: T0,
        startTime: T0, endTime: T0 + 7, duration: 7, completed: true,
      });
      results.put({
        id: 'legacy-c', noteId: 'note-1', createdAt: T0,
        data: {
          logs: [{ outputType: 'segment', metrics: [{ type: 'round', value: 3, image: '3', origin: 'runtime' }] }],
        },
      });
    });

    const storage = new IndexedDBStorage();
    try {
      const service = new StorageService(storage);

      // (a) migrated as-is, scalar fields intact
      const a = await service.getSessionById('legacy-a');
      expect(a?.startTime).toBe(T0);
      expect(a?.duration).toBe(10);
      // (b) flattened from the inline data blob
      const b = await service.getSessionById('legacy-b');
      expect(b?.startTime).toBe(T0);
      expect(b?.completed).toBe(true);
      expect(b).not.toHaveProperty('data');
      // inline logs of (b) and (c) became event rows — exactly one row per
      // deterministic id, never duplicated
      const bEvents = await service.getEventsByResult('legacy-b');
      expect(bEvents.length).toBeGreaterThan(0);
      expect(new Set(bEvents.map((e) => e.id)).size).toBe(bEvents.length);
      expect(bEvents.map((e) => e.grain)).toContain('event');
      const cEvents = await service.getEventsByResult('legacy-c');
      expect(cEvents.length).toBeGreaterThan(0);
      expect(new Set(cEvents.map((e) => e.id)).size).toBe(cEvents.length);
      // (c) canonical session row kept, not clobbered by the legacy duplicate
      expect((await service.getSessionById('legacy-c'))?.duration).toBe(7);

      // the legacy store is gone
      await expect(new Promise<boolean>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onblocked = () => reject(new Error('probe blocked by an open connection'));
        req.onsuccess = () => {
          const has = req.result.objectStoreNames.contains('results');
          req.result.close();
          resolve(!has);
        };
        req.onerror = () => reject(req.error);
      })).resolves.toBe(true);
    } finally {
      // dispose the open service handle BEFORE the next test's fixture opens
      await storage.close();
    }
  });

  it('repairs a mixed first-V26 database (no by-source/by-created/by-note-tag) on open', async () => {
    // Real databases exist at the first V26 cut — before by-created,
    // by-source and the unique by-note-tag pair shipped. Version 26 is
    // ambiguous; opening at the current version must presence-repair all
    // three without touching the data (V24 lesson: never trust oldVersion
    // alone, guard on index presence).
    await openLegacyDb(26, (db) => {
      const notes = db.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('by-date', 'date');
      const blocks = db.createObjectStore('block_index', { keyPath: 'id' });
      blocks.createIndex('by-note', 'noteId');
      blocks.put({
        id: 'n1:s:1', noteId: 'n1', segmentId: 's', segmentVersion: 1,
        dataType: 'wod', rawContent: 'x', noteTitle: 't', createdAt: T0,
        sourceId: 'collection:girls',
      });
      blocks.put({
        id: 'f:s:1', noteId: 'feed/n', segmentId: 's', segmentVersion: 1,
        dataType: 'wod', rawContent: 'x', noteTitle: 't', createdAt: T0,
        sourceId: 'feed:dir/2024-01-01/file',
      });
      const noteTags = db.createObjectStore('note_tags', { keyPath: 'id' });
      noteTags.createIndex('by-note', 'noteId');
      noteTags.createIndex('by-tag', 'tagId');
      noteTags.put({ id: 'aaa', noteId: 'n1', tagId: 't1' });
      noteTags.put({ id: 'zzz', noteId: 'n1', tagId: 't1' });
    });

    const storage = new IndexedDBStorage();
    try {
      // by-created: the date-candidate union half
      expect(await storage.readonly('notes').getAllFromIndex('by-created', IDBKeyRange.bound(0, Infinity)))
        .toEqual([]);
      // by-source: the fence-count half
      expect(await storage.readonly('block_index').getAllFromIndex('by-source', IDBKeyRange.bound('collection:', 'collection;', false, true)))
        .toHaveLength(1);
      // by-note-tag: dedupe ran and the unique pair is declared
      const pairs = await storage.readonly('note_tags').getAllFromIndex('by-note-tag');
      expect(pairs.map((r) => r.id).sort()).toEqual(['aaa']);
      expect(pairs.every((r) => r.noteId === 'n1' && r.tagId === 't1')).toBe(true);
    } finally {
      await storage.close();
    }
  });

  it('dedupes note_tags pairs deterministically and enforces the unique by-note-tag pair', async () => {
    await openLegacyDb(25, (db) => {
      const noteTags = db.createObjectStore('note_tags', { keyPath: 'id' });
      noteTags.createIndex('by-note', 'noteId');
      noteTags.createIndex('by-tag', 'tagId');
      // duplicate (n1, t1): lexicographically smallest id must win
      noteTags.put({ id: 'aaa', noteId: 'n1', tagId: 't1' });
      noteTags.put({ id: 'zzz', noteId: 'n1', tagId: 't1' });
      noteTags.put({ id: 'mmm', noteId: 'n1', tagId: 't1' });
      noteTags.put({ id: 'bbb', noteId: 'n2', tagId: 't1' });
    });

    const storage = new IndexedDBStorage();
    try {
      // whole-index read + JS filter (no compound range through the wrapper —
      // the dedupe+unique-create upgrade path is the thing under test here)
      const pairs = await storage.readonly('note_tags').getAllFromIndex('by-note-tag');
      expect(pairs.map((r) => r.id).sort()).toEqual(['aaa', 'bbb']);
      expect(await storage.readonly('note_tags').count()).toBe(2);

      // the unique pair constraint is live on the upgraded store: the index
      // exists and is declared unique (native IDB rejects violating puts on
      // it — asserting the declaration here keeps the test free of
      // environment-specific abort handling).
      await expect(new Promise<boolean>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onblocked = () => reject(new Error('probe blocked by an undisposed connection'));
        req.onsuccess = () => {
          const store = req.result.transaction('note_tags', 'readonly').objectStore('note_tags');
          const unique = store.indexNames.contains('by-note-tag')
            && store.index('by-note-tag').unique === true;
          req.result.close();
          resolve(unique);
        };
        req.onerror = () => reject(req.error);
      })).resolves.toBe(true);
    } finally {
      // dispose the open service handle BEFORE the next test's fixture opens
      await storage.close();
    }
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
    segments: [],
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
