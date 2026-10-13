#!/usr/bin/env bun
// Run: bun apps/playground/src/services/storage/sync.check.ts
//
// End-to-end storage/sync seam check against the REAL stack:
//  - fake-indexeddb as the browser database (no mocks of the storage layer),
//  - real local SQLite files through the actual libsql node client as the
//    Turso backup targets (no Hrana server exists in this repo),
//  - the real TursoSyncEngine, real sync-activity + storage-update stores.
//
// Scenarios: v24→v30 upgrade safety; v29 missing-sync-store upgrade;
// offline save + retry retention; durable outbox (aborted transaction never
// journals); newer writes surviving a failed ack; idempotent op IDs;
// two-browser propagation (binary attachments, ownership stamps,
// delete/clear/wipe tombstones); >500-op group pull completeness; dirty-row
// overlay during a failed-upload pull; immutable block-revision conflict
// copies + stale-note refusal; local-old/remote-current restore preserving
// unsent edits; both-old remote op-log migration (segments→blocks) and
// legacy direct-Turso conversion; newer-remote + unknown-target refusals
// with a usable local app; pre-v20 refusal without data destruction;
// per-target cursors and empty-outbox bootstrap on target switch; debounced
// post-commit uploads with full listener cleanup on stop.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { Window } from 'happy-dom';
import { createClient } from '@libsql/client';
import {
  libsqlDatabase,
  fetchSyncOps,
  initSyncTarget,
  applySyncBatch,
  probeSyncTarget,
  SYNC_ARCHIVE_TABLE,
  type Database,
} from '@bitcobblers/wod-wiki-storage/sql';
import {
  DB_VERSION, STORE_DEFS,
  type Note, type BlockRevision,
} from '@bitcobblers/wod-wiki-storage';
import { IndexedDBStorage } from './IndexedDBStorage';
import { TursoSyncEngine } from './syncEngine';
import { getSyncActivity, subscribeSyncActivity, type SyncActivitySnapshot } from '../syncActivity';
import { getStorageUpdate, subscribeStorageUpdate, type StorageUpdateSnapshot } from './storageUpdate';
import {
  startBackgroundStorageSync, whenStorageReady, storage, readDataSettings, DATA_SETTINGS_KEY, resetStorageForTesting,
} from './index';

globalThis.localStorage = new Window().localStorage;
const win = new Window();
(globalThis as Record<string, unknown>).window ??= win;
(globalThis as Record<string, unknown>).document ??= win.document;

const dir = await mkdtemp(join(tmpdir(), 'wodwiki-sync-'));
const urlFor = (name: string): string => `file:${join(dir, name)}`;
const connectFor = (url: string) => (): Database => libsqlDatabase(createClient({ url }));

// Direct remote read helpers for assertions against a backup file.
async function remoteOpCount(url: string, needle: string): Promise<number> {
  const db = connectFor(url)();
  try {
    const rows = await db.query(`SELECT COUNT(*) AS "c" FROM "_wodwiki_sync_ops" WHERE "data" LIKE ?`, [`%${needle}%`]);
    return Number(rows[0].c);
  } finally {
    await db.close();
  }
}

async function remoteTableCount(url: string, table: string): Promise<number> {
  const db = connectFor(url)();
  try {
    const exists = await db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table]);
    if (!exists[0]) return 0;
    const rows = await db.query(`SELECT COUNT(*) AS "c" FROM "${table}"`);
    return Number(rows[0].c);
  } finally {
    await db.close();
  }
}

async function outboxCount(storage: IndexedDBStorage): Promise<number> {
  return (await storage.readOutbox(0, Number.MAX_SAFE_INTEGER)).length;
}

async function syncStateEntries(storage: IndexedDBStorage): Promise<{ key: string; value: { rev?: number; seq?: number } }[]> {
  return (await (await storage.open()).getAll('sync_state')) as { key: string; value: { rev?: number; seq?: number } }[];
}

async function cursorRev(storage: IndexedDBStorage): Promise<number> {
  const entry = (await syncStateEntries(storage)).find(row => row.key.startsWith('cursor:'));
  return entry?.value.rev ?? 0;
}

const makeNote = (id: string, title: string, createdAt: number, extra: Partial<Note> = {}): Note => ({
  id, title, createdAt, date: createdAt, rawContent: '', sourceRevision: 1, blocks: {}, ...extra,
});

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

const updates: StorageUpdateSnapshot[] = [];
subscribeStorageUpdate(() => updates.push(getStorageUpdate()));
const activity: SyncActivitySnapshot[] = [];
subscribeSyncActivity(() => activity.push(getSyncActivity()));

// ---------------------------------------------------------------------------
// Part 1 — upgrade safety: a v24 database migrates in place, nothing is lost.
// ---------------------------------------------------------------------------
const factoryA = new IDBFactory();
globalThis.indexedDB = factoryA;

function buildV24Database(): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
  const request = indexedDB.open('wodwiki-db', 24);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('notes', { keyPath: 'id' });
    const segments = db.createObjectStore('segments', { keyPath: ['id', 'version'] });
    segments.createIndex('by-note', 'noteId');
    db.createObjectStore('page', { keyPath: 'id' });
    db.createObjectStore('page_notes', { keyPath: 'id' });
    db.createObjectStore('tags', { keyPath: 'id' });
    db.createObjectStore('tag_types', { keyPath: 'id' });
    db.createObjectStore('note_tags', { keyPath: 'id' });
    db.createObjectStore('sessions', { keyPath: 'id' });
    db.createObjectStore('attachments', { keyPath: 'id' });
    db.createObjectStore('events', { keyPath: 'id' });
    db.createObjectStore('field_catalog', { keyPath: 'id' });
    db.createObjectStore('field_sources', { keyPath: 'id' });
    db.createObjectStore('field_values', { keyPath: 'key' });
    db.createObjectStore('field_catalog_meta', { keyPath: 'id' });
    db.createObjectStore('efforts', { keyPath: 'slug' });
    const blockIndex = db.createObjectStore('block_index', { keyPath: 'id' });
    blockIndex.createIndex('by-note', 'noteId');
    db.createObjectStore('block_efforts', { keyPath: 'id' });
    db.createObjectStore('meta', { keyPath: 'key' });
  };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction(['notes', 'segments', 'sessions', 'block_index', 'block_efforts', 'meta', 'tags', 'tag_types', 'note_tags'], 'readwrite');
    const fence = '```time\n21 Thrusters @ 95\n```';
    tx.objectStore('notes').put({ id: 'note-1', title: 'Fran', createdAt: 1, date: 1700000000000, segmentIds: ['seg-a', 'seg-b'] });
    tx.objectStore('segments').put({ id: 'seg-a', version: 1, noteId: 'note-1', position: 0, dataType: 'wod', rawContent: '```time\n21 Thrusters\n```', createdAt: 1, isHistory: true });
    tx.objectStore('segments').put({ id: 'seg-a', version: 2, noteId: 'note-1', position: 0, dataType: 'wod', rawContent: fence, sourceContent: `${fence}\n`, createdAt: 2 });
    tx.objectStore('segments').put({ id: 'seg-b', version: 1, noteId: 'note-1', position: 1, dataType: 'markdown', rawContent: '## Notes', sourceContent: '## Notes\n', createdAt: 1 });
    tx.objectStore('sessions').put({ id: 's1', noteId: 'note-1', segmentId: 'seg-a', segmentVersion: 2, startTime: 1, endTime: 2, duration: 1, completed: true, createdAt: 2 });
    tx.objectStore('block_index').put({ id: 'note-1:seg-a:2', noteId: 'note-1', segmentId: 'seg-a', segmentVersion: 2, position: 0, dataType: 'wod', rawContent: fence, noteTitle: 'Fran', createdAt: 2 });
    tx.objectStore('block_efforts').put({ id: 'note-1:seg-a:thruster', noteId: 'note-1', blockId: 'seg-a', blockContentId: 'bc-1', effortSlug: 'thruster', createdAt: 2 });
    tx.objectStore('meta').put({ key: 'seed:core', value: { schema: 7, version: 41 } });
    tx.objectStore('tags').put({ id: 'tag-1', label: 'couplet', createdAt: 1 });
    tx.objectStore('tag_types').put({ id: 'type-1', name: 'format', label: 'Format', createdAt: 1 });
    tx.objectStore('note_tags').put({ id: 'nt-1', noteId: 'note-1', tagId: 'tag-1' });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(toError(tx.error));
  };
  request.onerror = () => reject(toError(request.error));
  return promise;
}

await buildV24Database();
const storageA = new IndexedDBStorage({ onUpgradeStart: (v) => updates.push({ phase: 'updating', message: `migrating ${v}`, fromVersion: v, toVersion: DB_VERSION }) });

const migrated = (await storageA.readonly('notes').get('note-1'))!;
assert.equal(migrated.title, 'Fran', 'note identity preserved');
assert.equal(migrated.rawContent, '```time\n21 Thrusters @ 95\n```\n## Notes\n', 'canonical rawContent rebuilt from sourceContent fragments');
assert.equal(migrated.sourceRevision, 1);
assert.ok(!('segmentIds' in migrated), 'legacy segmentIds stripped (would fail validation)');
const block = migrated.blocks['seg-a'];
assert.ok(block, 'legacy segment id preserved as block id');
assert.equal(block.kind, 'wod');
assert.equal(block.dialect, 'time');
assert.equal(block.version, 2);
assert.equal(block.from, 0);
assert.equal(block.to, '```time\n21 Thrusters @ 95\n```'.length);
assert.deepEqual(Object.keys(migrated.blocks), ['seg-a'], 'markdown segment is not an actionable block');

const revisionV1 = await storageA.readonly('block_revisions').get(['note-1', 'seg-a', 1]);
assert.equal(revisionV1?.rawContent, '```time\n21 Thrusters\n```', 'historical segment migrated to a block revision');
assert.ok(await storageA.readonly('block_revisions').get(['note-1', 'seg-a', 2]), 'current segment migrated to a block revision');

const session = (await storageA.readonly('sessions').get('s1'))!;
assert.equal(session.blockId, 'seg-a', 'session segmentId → blockId');
assert.equal(session.blockVersion, 2, 'session segmentVersion → blockVersion');
assert.ok(!('segmentId' in session), 'legacy segmentId field removed');
const indexRow = (await storageA.readonly('block_index').get('note-1:seg-a'))!;
assert.ok(indexRow, 'block_index remapped to `${noteId}:${blockId}`');
assert.equal(indexRow.blockId, 'seg-a');
assert.ok(!('segmentId' in indexRow));
assert.equal(indexRow.from, 0);
assert.deepEqual(await storageA.readonly('block_efforts').get('note-1:seg-a:thruster'), { id: 'note-1:seg-a:thruster', noteId: 'note-1', blockId: 'seg-a', blockContentId: 'bc-1', effortSlug: 'thruster', createdAt: 2 });
assert.deepEqual((await storageA.readonly('meta').get('seed:core'))?.value, { schema: 7, version: 41 });
assert.ok(await storageA.readonly('note_tags').get('nt-1'), 'junction rows preserved');

const migratedDb = await openDB('wodwiki-db', DB_VERSION);
assert.equal(migratedDb.version, DB_VERSION);
assert.ok(!migratedDb.objectStoreNames.contains('segments'), 'segments store retired after migration');
assert.ok(migratedDb.objectStoreNames.contains('memberships'), 'V25 store created');
assert.ok(migratedDb.objectStoreNames.contains('sync_outbox'), 'V30 sync journal store created by the upgrade');
assert.ok(migratedDb.objectStoreNames.contains('sync_state'), 'V30 sync state store created by the upgrade');
assert.equal(await migratedDb.count('block_revisions'), 2);
assert.equal(await migratedDb.count('sessions'), 1);
migratedDb.close();
assert.ok(updates.some(u => u.phase === 'updating' && u.fromVersion === 24 && u.toVersion === DB_VERSION), 'storageUpdate reported the upgrade');
console.log('upgrade-safety v24→v30: OK');

// ---------------------------------------------------------------------------
// Part 2 — existing-v29 database: the sync stores appear on upgrade; an
// ordinary (current) boot emits NO checking/updating flash.
// ---------------------------------------------------------------------------
const factory29 = new IDBFactory();
globalThis.indexedDB = factory29;
await (() => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const request = indexedDB.open('wodwiki-db', 29);
  request.onupgradeneeded = () => {
    const db = request.result;
    for (const def of STORE_DEFS) {
      db.createObjectStore(def.name, { keyPath: def.keyPath.length === 1 ? def.keyPath[0] : def.keyPath });
    }
  };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction(['notes'], 'readwrite');
    tx.objectStore('notes').put(makeNote('n29', 'Existing', 1));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error ?? new Error('seed v29 failed'));
  };
  request.onerror = () => reject(request.error ?? new Error('open v29 failed'));
  return promise;
})();

const checkingBefore = updates.filter(u => u.phase === 'checking').length;
localStorage.removeItem(DATA_SETTINGS_KEY);
resetStorageForTesting();
await whenStorageReady(); // singleton: probes the actual version, then upgrades
assert.ok(updates.some(u => u.phase === 'checking' && u.message.includes('v29')), 'older local version announced checking before upgrading');
assert.ok(updates.some(u => u.phase === 'updating' && u.fromVersion === 29 && u.toVersion === DB_VERSION), 'v29→v30 upgrade ran on the singleton');
assert.equal(getStorageUpdate().phase, 'idle', 'storageUpdate settled to idle');
const db29 = await openDB('wodwiki-db', DB_VERSION);
assert.equal(db29.version, DB_VERSION);
assert.ok(db29.objectStoreNames.contains('sync_outbox'), 'existing v29 DB gains the sync outbox without data loss');
assert.ok(db29.objectStoreNames.contains('sync_state'));
assert.equal((await db29.get('notes', 'n29'))?.title, 'Existing', 'v29 rows survive the upgrade');
db29.close();

// Ordinary boot on a current database: silent (no new checking entry).
resetStorageForTesting();
await whenStorageReady();
assert.equal(updates.filter(u => u.phase === 'checking').length, checkingBefore + 1, 'ordinary current boot emits no checking flash');
assert.equal(getStorageUpdate().phase, 'idle');
console.log('existing-v29 sync-store upgrade + silent ordinary boot: OK');

// ---------------------------------------------------------------------------
// Part 3 — offline save/retry, outbox durability, ack race, idempotency.
// ---------------------------------------------------------------------------
globalThis.indexedDB = factoryA;
const urlA = urlFor('backup-a.db');
let failTransactions = 0;
const flakyConnectA = (): Database => {
  const db = connectFor(urlA)();
  return {
    ...db,
    transaction: (fn: Parameters<Database['transaction']>[0]) => {
      if (failTransactions > 0) {
        failTransactions -= 1;
        return Promise.reject(new Error('network unreachable (simulated offline)'));
      }
      return db.transaction(fn);
    },
  } as Database;
};

const engineA = new TursoSyncEngine(storageA, { url: urlA, authToken: 'check-token' }, flakyConnectA);
await engineA.syncNow();
assert.equal(await outboxCount(storageA), 0, 'snapshot upload leaves no pending writes');
assert.ok((await cursorRev(storageA)) > 0, 'per-target pull cursor advanced after initial backup');
assert.ok(await remoteOpCount(urlA, 'note-1') > 0, 'migrated data backed up');

// Ordinary saves are local-only: durable before any network runs.
const bytes = new Uint8Array([0, 1, 250, 255]);
await storageA.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put(makeNote('note-2', 'Grace', 3, { userId: 'user-A' }));
});
await storageA.transaction(['attachments'], 'readwrite', async tx => {
  await tx.readwrite('attachments').put({ id: 'att-1', noteId: 'note-1', mimeType: 'application/octet-stream', label: 'GPS', data: bytes.buffer, createdAt: 4 });
});
assert.equal(await outboxCount(storageA), 2, 'both saves journaled atomically');

// Aborted transaction: rolls back AND never reaches the outbox.
await assert.rejects(storageA.transaction(['meta'], 'readwrite', async tx => {
  await tx.readwrite('meta').put({ key: 'aborted', value: true });
  throw new Error('deliberate abort');
}), /deliberate abort/);
assert.equal(await storageA.readonly('meta').get('aborted'), undefined, 'aborted write rolled back');
assert.equal(await outboxCount(storageA), 2, 'aborted transaction never journaled');

// Offline upload: pending writes retained, watermark unmoved, error surfaced;
// the pull leg still runs (upload failure no longer cancels it).
failTransactions = 1;
await engineA.syncNow();
assert.match(getSyncActivity().error ?? '', /network unreachable/, 'offline failure surfaced as a sync error');
assert.equal(await outboxCount(storageA), 2, 'failed upload truncated nothing');
const watermarkEntry = (await syncStateEntries(storageA)).find(row => row.key.startsWith('watermark:'));
assert.equal(watermarkEntry?.value.seq ?? 0, 0, 'watermark not advanced on failure');
assert.equal(await remoteOpCount(urlA, 'note-2'), 0, 'uncommitted batch never reached the backup');

// A newer write lands while the previous batch is still pending.
await storageA.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put(makeNote('note-3', 'Annie', 5, { userId: 'user-A' }));
});
await engineA.syncNow();
assert.equal(await remoteOpCount(urlA, 'note-2'), 1, 'retried group committed once');
assert.equal(await remoteOpCount(urlA, 'note-3'), 1, 'newer write surviving the failed ack uploaded next');
assert.equal(await outboxCount(storageA), 0, 'outbox drained after commit');
const note2Ops = await remoteOpCount(urlA, 'note-2');
await engineA.syncNow();
assert.equal(await remoteOpCount(urlA, 'note-2'), note2Ops, 'op ids are idempotent — no duplicates on re-sync');
console.log('offline-save-retry + aborted-tx + ack-race + idempotency: OK');

// ---------------------------------------------------------------------------
// Part 4 — two-browser propagation, tombstones, committed-record counts.
// ---------------------------------------------------------------------------
const factoryB = new IDBFactory();
globalThis.indexedDB = factoryB;
const storageB = new IndexedDBStorage();
const engineB = new TursoSyncEngine(storageB, { url: urlA, authToken: 'check-token' }, connectFor(urlA));
const resultsBefore = activity.length;
await engineB.syncNow();
const restored = (await storageB.readonly('notes').get('note-1'))!;
assert.equal(restored.rawContent, migrated.rawContent, 'note content restored on second browser');
assert.equal(restored.blocks['seg-a'].kind, 'wod', 'note-owned blocks restored');
assert.equal((await storageB.readonly('block_revisions').get(['note-1', 'seg-a', 1]))?.rawContent, '```time\n21 Thrusters\n```', 'block history restored');
assert.equal((await storageB.readonly('notes').get('note-2'))?.userId, 'user-A', 'ownership stamps visible across browsers');
const restoredBytes = new Uint8Array(((await storageB.readonly('attachments').get('att-1'))!.data) as ArrayBuffer);
assert.deepEqual([...restoredBytes], [...bytes], 'binary attachment round-tripped through the backup');
assert.deepEqual((await storageB.readonly('meta').get('seed:core'))?.value, { schema: 7, version: 41 });
const resultReports = activity.slice(resultsBefore).map(s => s.result).filter(r => r !== null);
assert.ok(resultReports.some(r => (r!.added + r!.updated) >= 2), 'committed canonical note count reported (no metadata/claim rows)');
assert.ok(resultReports.every(r => r!.source === 'turso backup'), 'results attributed to the backup source');
assert.equal(await outboxCount(storageB), 0, 'pulls never re-journal — no echo loop');

// Deletion, clear and wipe propagate as tombstones.
globalThis.indexedDB = factoryA;
await storageA.transaction(['notes'], 'readwrite', async tx => { await tx.readwrite('notes').delete('note-3'); });
await storageA.readwrite('tags').clear();
await engineA.syncNow();
globalThis.indexedDB = factoryB;
await engineB.syncNow();
assert.equal(await storageB.readonly('notes').get('note-3'), undefined, 'delete tombstone pulled');
assert.equal(await storageB.readonly('tags').count(), 0, 'clear tombstone pulled');
assert.ok(await storageB.readonly('notes').get('note-2'), 'unaffected rows survive pulls');

globalThis.indexedDB = factoryA;
await storageA.wipe();
await engineA.syncNow();
globalThis.indexedDB = factoryB;
await engineB.syncNow();
assert.equal(await storageB.readonly('notes').count(), 0, 'wipe pulled — second browser emptied');
assert.equal(await storageB.readonly('meta').count(), 0, 'wipe clears non-system stores');
console.log('two-browser propagation + delete/clear/wipe: OK');

// ---------------------------------------------------------------------------
// Part 5 — a >500-op revision group pulls WHOLE (plus its successor group).
// ---------------------------------------------------------------------------
const urlBig = urlFor('backup-big.db');
{
  const db = connectFor(urlBig)();
  await initSyncTarget(db, DB_VERSION);
  const bigOps = [] as { op: 'put'; store: 'notes'; key: string; value: Note }[];
  for (let i = 0; i < 600; i += 1) bigOps.push({ op: 'put', store: 'notes', key: `bulk-${i}`, value: makeNote(`bulk-${i}`, `Bulk ${i}`, 100 + i) });
  await applySyncBatch(db, [{ id: 'big-1', at: 1, ops: bigOps }], { expectSchema: DB_VERSION });
  await applySyncBatch(db, [{ id: 'after-1', at: 2, ops: [{ op: 'put', store: 'notes', key: 'after-group', value: makeNote('after-group', 'After', 999) }] }], { expectSchema: DB_VERSION });
  await db.close();
}
const factoryC = new IDBFactory();
globalThis.indexedDB = factoryC;
const storageC = new IndexedDBStorage();
const engineC = new TursoSyncEngine(storageC, { url: urlBig, authToken: 'check-token' }, connectFor(urlBig));
await engineC.syncNow();
for (let i = 0; i < 600; i += 1) {
  assert.ok(await storageC.readonly('notes').get(`bulk-${i}`), `row ${i} of the 600-op group pulled`);
}
assert.ok(await storageC.readonly('notes').get('after-group'), 'successor group not lost behind a split window');
const opsNow = await fetchSyncOps(connectFor(urlBig)(), 0, 500);
assert.ok(opsNow.length >= 600, 'fetch window returned the whole oversized group');
console.log('>500-op group pull completeness: OK');

// ---------------------------------------------------------------------------
// Part 6 — dirty-row overlay: a pending local edit survives a pull that
// arrives while the upload is failing; then ships when online.
// ---------------------------------------------------------------------------
const urlD = urlFor('backup-d.db');
const factoryD = new IDBFactory();
globalThis.indexedDB = factoryD;
const storageD = new IndexedDBStorage();
let failD = 0;
const flakyConnectD = (): Database => {
  const db = connectFor(urlD)();
  return {
    ...db,
    transaction: (fn: Parameters<Database['transaction']>[0]) => {
      if (failD > 0) { failD -= 1; return Promise.reject(new Error('offline during pull (simulated)')); }
      return db.transaction(fn);
    },
  } as Database;
};
const engineD = new TursoSyncEngine(storageD, { url: urlD, authToken: 'check-token' }, flakyConnectD);
await engineD.syncNow(); // reconcile (empty target)

// Local edit commits (outbox pending), then a REMOTE write to the same key
// lands while the upload cannot ship.
await storageD.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put(makeNote('race', 'local edit', 10, { userId: 'user-D' }));
});
{
  const db = connectFor(urlD)();
  await applySyncBatch(db, [{ id: 'remote-r1', at: 3, ops: [{ op: 'put', store: 'notes', key: 'race', value: makeNote('race', 'remote write', 11) }] }], { expectSchema: DB_VERSION });
  await db.close();
}
failD = 1;
await engineD.syncNow();
assert.match(getSyncActivity().error ?? '', /offline during pull/, 'offline upload failure surfaced');
assert.equal((await storageD.readonly('notes').get('race'))?.title, 'local edit', 'unsent local edit preserved in the DB over the pulled remote row');
await engineD.syncNow();
assert.equal(await remoteOpCount(urlD, 'local edit'), 1, 'local edit shipped once online');

// Fresh browser restores the local edit (the remote row lost deterministically).
const factoryE = new IDBFactory();
globalThis.indexedDB = factoryE;
const storageE = new IndexedDBStorage();
const engineE = new TursoSyncEngine(storageE, { url: urlD, authToken: 'check-token' }, connectFor(urlD));
await engineE.syncNow();
assert.equal((await storageE.readonly('notes').get('race'))?.title, 'local edit', 'last committed writer wins for concurrent same-key edits');
console.log('dirty-row overlay race: OK');

// ---------------------------------------------------------------------------
// Part 7 — immutable block-revision conflict keeps BOTH rows; a stale
// (lower sourceRevision) remote note never clobbers newer history.
// ---------------------------------------------------------------------------
globalThis.indexedDB = factoryD;
const histFence = '```time\n21 Thrusters @ 95\n```';
const histBlock = { id: 'b', kind: 'wod' as const, version: 1, sourceRevision: 1, from: 0, to: histFence.length, dialect: 'time' as const };
await storageD.transaction(['block_revisions', 'notes'], 'readwrite', async tx => {
  await tx.readwrite('block_revisions').put({
    noteId: 'hist', blockId: 'b', version: 1, kind: 'wod', rawContent: histFence, savedAt: 5, dialect: 'time',
  } satisfies BlockRevision);
  await tx.readwrite('notes').put({
    ...makeNote('hist', 'History', 12), rawContent: histFence, blocks: { b: histBlock },
  } satisfies Note);
});
await storageD.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put({
    ...makeNote('hist', 'History v2', 13), rawContent: histFence, sourceRevision: 2,
    blocks: { b: { ...histBlock, sourceRevision: 2 } },
  } satisfies Note);
});
{
  const db = connectFor(urlD)();
  await applySyncBatch(db, [{
    id: 'remote-r2', at: 4,
    ops: [
      { op: 'put', store: 'block_revisions', key: ['hist', 'b', 1], value: { noteId: 'hist', blockId: 'b', version: 1, kind: 'wod', rawContent: '```time\n21 Thrusters @ 65\n```', savedAt: 6, dialect: 'time' } satisfies BlockRevision },
      { op: 'put', store: 'notes', key: 'hist', value: { ...makeNote('hist', 'Stale Remote', 14), rawContent: 'stale remote content', sourceRevision: 1 } satisfies Note },
    ],
  }], { expectSchema: DB_VERSION });
  await db.close();
}
await engineD.syncNow();
const keptV1 = (await storageD.readonly('block_revisions').get(['hist', 'b', 1]))!;
const copiedV2 = (await storageD.readonly('block_revisions').get(['hist', 'b', 2]))!;
assert.equal(keptV1.rawContent, histFence, 'existing immutable revision untouched');
assert.equal(copiedV2?.rawContent, '```time\n21 Thrusters @ 65\n```', 'conflicting remote revision preserved as the next free version — history not replaced');
assert.equal((await storageD.readonly('notes').get('hist'))?.rawContent, histFence, 'stale lower-sourceRevision remote note refused');
assert.equal((await storageD.readonly('notes').get('hist'))?.sourceRevision, 2, 'newer local sourceRevision preserved');
console.log('immutable-revision conflict copy + stale-note refusal: OK');

// ---------------------------------------------------------------------------
// Part 8 — local v24 + remote CURRENT: local migrates, current backup
// restores, the unsent local edit survives in the visible DB.
// ---------------------------------------------------------------------------
const urlF = urlFor('backup-f.db');
const factoryX = new IDBFactory();
globalThis.indexedDB = factoryX;
const storageX = new IndexedDBStorage();
const engineX = new TursoSyncEngine(storageX, { url: urlF, authToken: 'check-token' }, connectFor(urlF));
await storageX.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put(makeNote('rx', 'Remote Current', 20));
});
await engineX.syncNow();

const factoryF = new IDBFactory();
globalThis.indexedDB = factoryF;
await buildV24Database();
const storageF = new IndexedDBStorage();
await storageF.open(); // local v24 → v30 migration at boot
await storageF.transaction(['notes'], 'readwrite', async tx => {
  const note = (await tx.readonly('notes').get('note-1'))!;
  const blocks = Object.fromEntries(Object.entries(note.blocks).map(([id, b]) => [id, { ...b, sourceRevision: 2 }]));
  await tx.readwrite('notes').put({ ...note, blocks, sourceRevision: 2, title: 'Fran (unsent local edit)' });
});
const engineF = new TursoSyncEngine(storageF, { url: urlF, authToken: 'check-token' }, connectFor(urlF));
await engineF.syncNow();
assert.equal((await storageF.readonly('notes').get('rx'))?.title, 'Remote Current', 'current remote rows restored locally');
const localNote = (await storageF.readonly('notes').get('note-1'))!;
assert.equal(localNote.title, 'Fran (unsent local edit)', 'unsent local edit still the visible state after the restore pull');
assert.equal(localNote.sourceRevision, 2);
assert.equal(await remoteOpCount(urlF, 'unsent local edit'), 1, 'unsent local edit reached the current backup via bootstrap upload');
console.log('local-old + remote-current restore: OK');

// ---------------------------------------------------------------------------
// Part 9 — BOTH old: remote op-log at schema v24 migrates (segments-era
// payloads actually converted, old ops archived not destroyed); a legacy
// direct-Turso database converts the same way.
// ---------------------------------------------------------------------------
const urlG = urlFor('backup-g.db');
{
  const db = connectFor(urlG)();
  await initSyncTarget(db, 24);
  // Simulate an era client log: raw inserts (current validation would reject
  // the segments store name — era clients wrote it).
  const eraOps: [string, number, unknown][] = [
    ['op-n1', 0, { op: 'put', store: 'notes', key: 'note-1', value: { id: 'note-1', title: 'Fran', createdAt: 1, date: 1, segmentIds: ['seg-a'] } }],
    ['op-s1', 1, { op: 'put', store: 'segments', key: ['seg-a', 1], value: { id: 'seg-a', version: 1, noteId: 'note-1', position: 0, dataType: 'wod', rawContent: '```time\n21 Thrusters\n```', createdAt: 1, isHistory: true } }],
    ['op-s2', 2, { op: 'put', store: 'segments', key: ['seg-a', 2], value: { id: 'seg-a', version: 2, noteId: 'note-1', position: 0, dataType: 'wod', rawContent: '```time\n21 Thrusters @ 95\n```', sourceContent: '```time\n21 Thrusters @ 95\n```\n', createdAt: 2 } }],
  ];
  for (const [opId, idx, mutation] of eraOps) {
    await db.exec(
      `INSERT INTO "_wodwiki_sync_ops" ("op_id", "rev", "idx", "at", "data") VALUES (?, 1, ?, 1, ?)`,
      [opId, idx, JSON.stringify(mutation)],
    );
  }
  await db.exec(`UPDATE "_wodwiki_sync_state" SET "value" = ? WHERE "key" = 'meta'`, [JSON.stringify({ schema: 24, rev: 1 })]);
  await db.close();
}
const factoryG = new IDBFactory();
globalThis.indexedDB = factoryG;
await buildV24Database();
const storageG = new IndexedDBStorage();
await storageG.open(); // local side migrates first
assert.ok(updates.some(u => u.phase === 'updating' && u.fromVersion === 24 && u.toVersion === DB_VERSION));
const engineG = new TursoSyncEngine(storageG, { url: urlG, authToken: 'check-token' }, connectFor(urlG));
await engineG.syncNow();
const probed = await probeSyncTarget(connectFor(urlG)());
assert.equal(probed.kind === 'current' && probed.schemaVersion, DB_VERSION, 'remote op-log schema migrated forward');
assert.ok((await remoteTableCount(urlG, SYNC_ARCHIVE_TABLE)) >= 3, 'old ops archived, not destroyed');
const converted = (await storageG.readonly('notes').get('note-1'))!;
assert.equal(converted.rawContent, '```time\n21 Thrusters @ 95\n```\n', 'remote segments-era payload converted to current note-owned blocks');
assert.equal(converted.blocks['seg-a']?.kind, 'wod');
assert.ok(await storageG.readonly('block_revisions').get(['note-1', 'seg-a', 1]), 'remote history converted to block revisions');

// Fresh browser against the migrated backup restores the converted payload.
const factoryH = new IDBFactory();
globalThis.indexedDB = factoryH;
const storageH = new IndexedDBStorage();
const engineH = new TursoSyncEngine(storageH, { url: urlG, authToken: 'check-token' }, connectFor(urlG));
await engineH.syncNow();
assert.equal((await storageH.readonly('notes').get('note-1'))?.rawContent, '```time\n21 Thrusters @ 95\n```\n', 'fresh browser replays converted log only');

// Legacy direct-Turso layout (schema guard + per-store tables, no sync log).
const urlL = urlFor('backup-legacy.db');
{
  const db = connectFor(urlL)();
  await db.exec(`CREATE TABLE "_wodwiki_schema" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`);
  await db.exec(`INSERT INTO "_wodwiki_schema" ("key", "value") VALUES ('schema', '{"version":24}')`);
  await db.exec(`CREATE TABLE "notes" ("k0" TEXT PRIMARY KEY, "data" TEXT NOT NULL)`);
  await db.exec(`INSERT INTO "notes" ("k0", "data") VALUES ('note-1', ?)`, [JSON.stringify({ id: 'note-1', title: 'Fran', createdAt: 1, date: 1, segmentIds: ['seg-a'] })]);
  await db.exec(`CREATE TABLE "segments" ("k0" TEXT NOT NULL, "k1" INTEGER NOT NULL, "data" TEXT NOT NULL, PRIMARY KEY ("k0", "k1"))`);
  await db.exec(`INSERT INTO "segments" ("k0", "k1", "data") VALUES ('seg-a', 2, ?)`, [JSON.stringify({ id: 'seg-a', version: 2, noteId: 'note-1', position: 0, dataType: 'wod', rawContent: '```time\n21 Thrusters @ 95\n```', sourceContent: '```time\n21 Thrusters @ 95\n```\n', createdAt: 2 })]);
  await db.close();
}
const factoryL = new IDBFactory();
globalThis.indexedDB = factoryL;
const storageL = new IndexedDBStorage();
const engineL = new TursoSyncEngine(storageL, { url: urlL, authToken: 'check-token' }, connectFor(urlL));
await engineL.syncNow();
const legacyConverted = (await storageL.readonly('notes').get('note-1'))!;
assert.equal(legacyConverted.rawContent, '```time\n21 Thrusters @ 95\n```\n', 'legacy direct-Turso rows actually converted (segments → blocks)');
assert.equal(legacyConverted.blocks['seg-a']?.dialect, 'time');
assert.ok(await storageL.readonly('block_revisions').get(['note-1', 'seg-a', 2]), 'legacy history lifted into block revisions');
const legacyProbed = await probeSyncTarget(connectFor(urlL)());
assert.equal(legacyProbed.kind === 'current' && legacyProbed.schemaVersion, DB_VERSION, 'legacy target now current');
assert.ok((await remoteOpCount(urlL, 'note-1')) > 0, 'legacy notes table retained on the remote as the recoverable source');
console.log('both-old remote migration (op-log + legacy direct-Turso): OK');

// ---------------------------------------------------------------------------
// Part 10 — newer remote: refusal, local app stays usable, no retry spam.
// ---------------------------------------------------------------------------
const urlN = urlFor('backup-newer.db');
{
  const db = connectFor(urlN)();
  await initSyncTarget(db, DB_VERSION + 1);
  await db.close();
}
const factoryN = new IDBFactory();
globalThis.indexedDB = factoryN;
const storageN = new IndexedDBStorage();
const engineN = new TursoSyncEngine(storageN, { url: urlN, authToken: 'check-token' }, connectFor(urlN));
await engineN.syncNow();
assert.match(getSyncActivity().error ?? '', /newer than this app supports/, 'newer remote refusal surfaced');
assert.equal(getStorageUpdate().phase, 'error', 'storageUpdate shows the refusal');
const errorsBefore = activity.filter(s => s.error).length;
await engineN.syncNow();
assert.equal(activity.filter(s => s.error).length, errorsBefore, 'halted engine does not retry-spam');
await storageN.transaction(['meta'], 'readwrite', async tx => { await tx.readwrite('meta').put({ key: 'still-local', value: 7 }); });
assert.deepEqual((await storageN.readonly('meta').get('still-local'))?.value, 7, 'local reads/writes unaffected by a newer remote');
console.log('newer-remote refusal + usable local app: OK');

// ---------------------------------------------------------------------------
// Part 11 — unknown target (foreign tables): refused, not adopted.
// ---------------------------------------------------------------------------
const urlU = urlFor('backup-unknown.db');
{
  const db = connectFor(urlU)();
  await db.exec(`CREATE TABLE "someone_else" ("id" TEXT PRIMARY KEY)`);
  await db.close();
}
const factoryU = new IDBFactory();
globalThis.indexedDB = factoryU;
const storageU = new IndexedDBStorage();
const engineU = new TursoSyncEngine(storageU, { url: urlU, authToken: 'check-token' }, connectFor(urlU));
await engineU.syncNow();
assert.match(getSyncActivity().error ?? '', /unrelated tables/, 'unknown target refusal surfaced');
assert.equal((await remoteTableCount(urlU, '_wodwiki_sync_ops')), 0, 'foreign database not initialized over');
console.log('unknown-target refusal: OK');

// ---------------------------------------------------------------------------
// Part 12 — pre-v20 local database: actionable refusal, data NOT destroyed.
// ---------------------------------------------------------------------------
const factoryP = new IDBFactory();
globalThis.indexedDB = factoryP;
await (() => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const request = indexedDB.open('wodwiki-db', 19);
  request.onupgradeneeded = () => { request.result.createObjectStore('ancient', { keyPath: 'id' }); };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction(['ancient'], 'readwrite');
    tx.objectStore('ancient').put({ id: 'keep-me' });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error ?? new Error('seed v19 failed'));
  };
  request.onerror = () => reject(request.error ?? new Error('open v19 failed'));
  return promise;
})();
const storageP = new IndexedDBStorage();
await assert.rejects(storageP.open(), /predates the supported migration chain/, 'pre-v20 upgrade refuses with an actionable error');
const ancient = await (() => {
  const { promise, resolve, reject } = Promise.withResolvers<{ store: boolean; row: unknown }>();
  const request = indexedDB.open('wodwiki-db', 19);
  request.onsuccess = () => {
    const db = request.result;
    const hasStore = db.objectStoreNames.contains('ancient');
    if (!hasStore) { db.close(); resolve({ store: false, row: undefined }); return; }
    const tx = db.transaction(['ancient'], 'readonly');
    const get = tx.objectStore('ancient').get('keep-me');
    tx.oncomplete = () => { db.close(); resolve({ store: true, row: get.result }); };
    tx.onerror = () => reject(tx.error ?? new Error('read v19 failed'));
  };
  request.onerror = () => reject(request.error ?? new Error('reopen v19 failed'));
  return promise;
})();
assert.ok(ancient.store, 'pre-v20 stores NOT deleted');
assert.deepEqual(ancient.row, { id: 'keep-me' }, 'pre-v20 rows intact');
console.log('pre-v20 refusal without destruction: OK');

// ---------------------------------------------------------------------------
// Part 13 — target switch: per-target cursors; existing local rows
// (no outbox) bootstrap onto a fresh target.
// ---------------------------------------------------------------------------
const urlS1 = urlFor('backup-s1.db');
const urlS2 = urlFor('backup-s2.db');
const factoryS = new IDBFactory();
globalThis.indexedDB = factoryS;
const storageS = new IndexedDBStorage();
// Preexisting local row written OUTSIDE the journal (no outbox entry).
await (await storageS.open()).put('notes', makeNote('mine', 'Local Only', 30, { userId: 'user-S' }));
const engineS1 = new TursoSyncEngine(storageS, { url: urlS1, authToken: 'check-token' }, connectFor(urlS1));
await engineS1.syncNow();
assert.ok(await remoteOpCount(urlS1, 'mine') > 0, 'preexisting local row backed up to the first target');
// Second target: a fresh empty backup receives the same rows on first contact.
await (await storageS.open()).put('notes', makeNote('only-b', 'Second Row', 31));
const engineS2 = new TursoSyncEngine(storageS, { url: urlS2, authToken: 'check-token' }, connectFor(urlS2));
await engineS2.syncNow();
assert.ok(await remoteOpCount(urlS2, 'mine') > 0, 'target switch re-bootstraps existing local rows (empty outbox)');
assert.ok(await remoteOpCount(urlS2, 'only-b') > 0, 'second local row bootstrapped to the new target');
const targetKeys = (await syncStateEntries(storageS)).map(row => row.key);
assert.ok(targetKeys.some(k => k.startsWith('cursor:')), 'per-target cursor keys persisted');
const cursorKeys = new Set(targetKeys.filter(k => k.startsWith('cursor:')));
assert.ok(cursorKeys.size >= 2, 'both targets tracked independently');
// Back to the first target: pulls its log; local-only row survives.
const engineS3 = new TursoSyncEngine(storageS, { url: urlS1, authToken: 'check-token' }, connectFor(urlS1));
await engineS3.syncNow();
assert.ok(await storageS.readonly('notes').get('only-b'), 'local row survives returning to the first target');
assert.equal((await remoteOpCount(urlS1, 'only-b')), 0, 'first target unchanged by the second target’s bootstrap');
console.log('target swap + per-target cursors + empty-outbox bootstrap: OK');

// ---------------------------------------------------------------------------
// Part 14 — start()/stop(): debounced post-commit upload; stop removes
// listeners (no upload fires afterwards).
// ---------------------------------------------------------------------------
const urlT = urlFor('backup-t.db');
const factoryT = new IDBFactory();
globalThis.indexedDB = factoryT;
const storageT = new IndexedDBStorage();
const engineT = new TursoSyncEngine(storageT, { url: urlT, authToken: 'check-token' }, connectFor(urlT));
const stopT = engineT.start();
await engineT.syncNow(); // reconcile the empty target
await storageT.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put(makeNote('live', 'Debounced Upload', 40));
});
await sleep(1300); // outbox-commit debounce (750ms) + margin
assert.ok(await remoteOpCount(urlT, 'live') > 0, 'post-commit outbox event triggered the upload without a poll');
stopT();
await sleep(100); // let stop() wait out the chain and remove listeners
await storageT.transaction(['notes'], 'readwrite', async tx => {
  await tx.readwrite('notes').put(makeNote('after-stop', 'Must Not Ship', 41));
});
await sleep(1300);
assert.equal(await remoteOpCount(urlT, 'after-stop'), 0, 'stopped engine uploaded nothing — listeners removed');
console.log('debounced upload + listener cleanup on stop: OK');

// ---------------------------------------------------------------------------
// Part 15 — public singleton seam: invalid config never disables local reads.
// ---------------------------------------------------------------------------
globalThis.indexedDB = factoryA;
localStorage.setItem(DATA_SETTINGS_KEY, '{broken json');
assert.equal(readDataSettings().state, 'invalid');
resetStorageForTesting();
await whenStorageReady();
assert.equal(getStorageUpdate().phase, 'idle', 'local database open completed despite invalid backup config');
const cleanup1 = startBackgroundStorageSync();
const cleanup2 = startBackgroundStorageSync();
assert.equal(cleanup1, cleanup2, 'startBackgroundStorageSync is idempotent while running');
assert.equal(getStorageUpdate().phase, 'error', 'invalid backup config surfaces as a storage-update error');
assert.match(getStorageUpdate().message, /invalid/i);
assert.match(getSyncActivity().error ?? '', /invalid/i, 'sync error surfaced');
await storage.readwrite('meta').put({ key: 'local-still-works', value: 1 });
assert.deepEqual((await storage.readonly('meta').get('local-still-works'))?.value, 1, 'local reads/writes unaffected by invalid backup config');
cleanup1();
console.log('invalid-config resilience + idempotent start: OK');

console.log('sync-check: OK');
await storageA.close();
await storageB.close();
await storageC.close();
await storageD.close();
await storageE.close();
await storageF.close();
await storageG.close();
await storageH.close();
await storageL.close();
await storageN.close();
await storageP.close();
await storageS.close();
await storageT.close();
await storageX.close();
await rm(dir, { recursive: true, force: true });
