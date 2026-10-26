#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { Window } from 'happy-dom';
import { createClient } from '@libsql/client';
import { libsqlDatabase, applySyncBatch, initSyncTarget, probeSyncTarget, type Database } from '@bitcobblers/wod-wiki-storage/sql';
import { DB_VERSION, STORE_DEFS, type Note } from '@bitcobblers/wod-wiki-storage';
import { IndexedDBStorage, convertSyncSource } from '@bitcobblers/wod-wiki-storage/idb';
import { TursoSyncEngine } from './syncEngine';
import { StorageService } from './StorageService';
import { applySeedChunk, seedNoteId } from '../../../../../packages/engine/src/seed/runtime';
import { emptySeedMeta, SEED_SCHEMA } from '../../../../../packages/engine/src/seed/contract';

const win = new Window();
globalThis.localStorage = win.localStorage;
Object.assign(globalThis, { window: win, document: win.document });
const dir = await mkdtemp(join(tmpdir(), 'wodwiki-lifecycle-'));
const connect = (name: string): Database => libsqlDatabase(createClient({ url: `file:${join(dir, name)}` }));
const note = (id: string): Note => ({ id, title: id, createdAt: 1, rawContent: '', sourceRevision: 1, blocks: {} });
const workout = '```time\n10 Squats\n```';
const opened: IndexedDBStorage[] = [];
try {
  globalThis.indexedDB = new IDBFactory();
  const local = new IndexedDBStorage();
  opened.push(local);
  await (await local.open()).put('notes', note('first-browser'));
  const db = connect('race.db');
  const other = connect('race.db');
  let transactions = 0;
  const racing: Database = {
    ...db,
    transaction: async fn => {
      const result = await db.transaction(fn);
      transactions += 1;
      if (transactions === 2) await applySyncBatch(other, [{
        id: 'other-browser', at: 2,
        ops: [{ op: 'put', store: 'notes', key: 'other-browser', value: note('other-browser') }],
      }], { expectSchema: DB_VERSION });
      return result;
    },
  };
  const engine = new TursoSyncEngine(local, { url: 'https://race.invalid', authToken: 'check' }, () => racing);
  await engine.syncNow();
  assert.equal((await local.readonly('notes').get('other-browser'))?.title, 'other-browser', 'first-contact bootstrap must replay concurrent writers');
  const target = await probeSyncTarget(other);
  assert.equal(target !== 'empty' && target.kind === 'current' && target.rev, 2);
  await assert.rejects(applySyncBatch(other, [{
    id: 'mismatched-key', at: 3,
    ops: [{ op: 'put', store: 'notes', key: 'claimed', value: note('different') }],
  }]), /key differs from row key/, 'malformed wire keys cannot write a different IndexedDB record');
  await other.close();
  await engine.stop();
  console.log('concurrent first-contact replay: OK');

  globalThis.indexedDB = new IDBFactory();
  const original = new IndexedDBStorage();
  opened.push(original);
  const native = await original.open();
  const seedTx = native.transaction(['notes', 'block_revisions'], 'readwrite');
  for (let i = 0; i < 501; i++) {
    const id = `snapshot-${i}`;
    await seedTx.objectStore('block_revisions').put({ noteId: id, blockId: 'workout', version: 1, kind: 'wod', dialect: 'time', rawContent: workout, savedAt: 1 });
    await seedTx.objectStore('notes').put({ ...note(id), rawContent: workout, blocks: { workout: { id: 'workout', kind: 'wod', dialect: 'time', version: 1, sourceRevision: 1, from: 0, to: workout.length } } });
  }
  await seedTx.done;
  const retryDb = connect('retry.db');
  let committed = 0;
  let fail = true;
  const retrying: Database = {
    ...retryDb,
    transaction: async fn => {
      if (fail && committed === 2) throw new Error('interrupted snapshot');
      const result = await retryDb.transaction(fn);
      committed++;
      return result;
    },
  };
  const firstAttempt = new TursoSyncEngine(original, { url: 'https://retry.invalid', authToken: 'check' }, () => retrying);
  await firstAttempt.syncNow();
  assert.equal((await probeSyncTarget(retryDb) as { rev: number }).rev, 1, 'one frozen chunk committed before interruption');
  await original.readwrite('notes').put({ ...note('snapshot-0'), title: 'edited after freeze', sourceRevision: 2 });
  await original.readwrite('notes').delete('snapshot-500');
  await firstAttempt.stop();
  fail = false;
  const retryEngine = new TursoSyncEngine(original, { url: 'https://retry.invalid', authToken: 'check' }, () => connect('retry.db'));
  await retryEngine.syncNow();
  assert.equal((await original.readOutbox(0, 1)).length, 0, 'retry ships edits queued after the frozen run');
  await retryEngine.stop();

  const isolated = new IndexedDBStorage({ dbName: 'isolated-restore' });
  opened.push(isolated);
  const restore = new TursoSyncEngine(isolated, { url: 'https://retry.invalid', authToken: 'check' }, () => connect('retry.db'));
  const before = connect('retry.db');
  const beforeState = await probeSyncTarget(before);
  await restore.restoreNow();
  assert.equal((await isolated.readonly('notes').get('snapshot-0'))?.title, 'edited after freeze');
  assert.equal(await isolated.readonly('notes').get('snapshot-500'), undefined, 'delete after freeze survives retry and fresh restore');
  assert.equal((await isolated.readonly('notes').get('snapshot-499'))?.title, 'snapshot-499', 'later immutable snapshot chunk is not lost');
  assert.equal((await isolated.readonly('block_revisions').get(['snapshot-499', 'workout', 1]))?.rawContent, workout, 'history precedes its consumers across snapshot pages');
  assert.deepEqual(await probeSyncTarget(before), beforeState, 'restore never uploads');
  await assert.rejects(restore.restoreNow(), /empty isolated/);
  await restore.stop();
  await before.close();
  assert.equal((await original.readonly('notes').get('snapshot-0'))?.title, 'edited after freeze', 'original local database remains recoverable');
  console.log('durable immutable bootstrap retry + isolated restore: OK');

  const oldTarget = connect('old.db');
  await initSyncTarget(oldTarget, DB_VERSION - 1);
  const empty = new IndexedDBStorage({ dbName: 'refused-restore' });
  opened.push(empty);
  const oldRestore = new TursoSyncEngine(empty, { url: 'https://old.invalid', authToken: 'check' }, () => oldTarget);
  await assert.rejects(oldRestore.restoreNow(), /provisioned/);
  assert.deepEqual(await probeSyncTarget(oldTarget), { kind: 'current', schemaVersion: DB_VERSION - 1, rev: 0 });
  await oldRestore.stop();
  console.log('incompatible restore leaves source untouched: OK');

  const changing = connect('changing.db');
  await initSyncTarget(changing, DB_VERSION);
  await applySyncBatch(changing, [{ id: 'before-restore', at: 1, ops: [{ op: 'put', store: 'notes', key: 'before', value: note('before') }] }]);
  let appended = false;
  const movingSource: Database = {
    ...changing,
    query: async (sql, params) => {
      const rows = await changing.query(sql, params);
      if (!appended && sql.includes('FROM "_wodwiki_sync_ops"')) {
        appended = true;
        await applySyncBatch(changing, [{ id: 'during-restore', at: 2, ops: [{ op: 'put', store: 'notes', key: 'during', value: note('during') }] }]);
      }
      return rows;
    },
  };
  const refusedLocal = new IndexedDBStorage({ dbName: 'moving-source-restore' });
  opened.push(refusedLocal);
  const movingRestore = new TursoSyncEngine(refusedLocal, { url: 'https://changing.invalid', authToken: 'check' }, () => movingSource);
  await assert.rejects(movingRestore.restoreNow(), /changed during restore/, 'a moving source cannot become the active restored database');
  assert.deepEqual(await probeSyncTarget(changing), { kind: 'current', schemaVersion: DB_VERSION, rev: 2 }, 'failed restore adds no bootstrap or uploaded rows');
  await movingRestore.stop();
  console.log('concurrent restore source change refusal: OK');

  const fullData = connect('full-data.db');
  await initSyncTarget(fullData, DB_VERSION - 1);
  await applySyncBatch(fullData, [
    { id: 'before-wipe', at: 1, ops: [{ op: 'put', store: 'notes', key: 'erased', value: note('erased') }] },
    { id: 'old-wipe', at: 2, ops: [{ op: 'wipe' }] },
    { id: 'after-wipe', at: 3, ops: [{ op: 'put', store: 'notes', key: 'retained', value: note('retained') }] },
  ]);
  const converted = await convertSyncSource(fullData, DB_VERSION - 1, false);
  const migratedLocal = new IndexedDBStorage({ dbName: 'converted-full-data' });
  opened.push(migratedLocal);
  await migratedLocal.applySyncMutations(converted, null);
  await migratedLocal.validateSyncState();
  assert.equal(await migratedLocal.readonly('notes').get('erased'), undefined, 'historical wipe is applied before conversion snapshots state');
  assert.equal((await migratedLocal.readonly('notes').get('retained'))?.title, 'retained');
  assert.deepEqual(await probeSyncTarget(fullData), { kind: 'current', schemaVersion: DB_VERSION - 1, rev: 3 }, 'conversion never modifies legacy source');
  await fullData.close();
  console.log('legacy wipe conversion retains terminal state: OK');

  const legacyLocal = await openDB('legacy-cutover', DB_VERSION - 1, {
    upgrade(db) {
      for (const def of STORE_DEFS) {
        const store = db.createObjectStore(def.name, { keyPath: def.keyPath.length === 1 ? def.keyPath[0] : def.keyPath });
        for (const index of def.indexes) store.createIndex(index.name, index.keyPath.length === 1 ? index.keyPath[0] : index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
      db.createObjectStore('sync_outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('sync_state', { keyPath: 'key' });
    },
  });
  await legacyLocal.put('notes', note('after-legacy-wipe'));
  await legacyLocal.put('sync_outbox', { id: 'old-wipe', at: 1, ops: [{ op: 'wipe' }] });
  await legacyLocal.put('sync_outbox', { id: 'old-put', at: 2, ops: [{ op: 'put', store: 'notes', key: 'after-legacy-wipe', value: note('after-legacy-wipe') }] });
  legacyLocal.close();
  const cutover = new IndexedDBStorage({ dbName: 'legacy-cutover' });
  const peer = new IndexedDBStorage({ dbName: 'cutover-peer' });
  opened.push(cutover, peer);
  const peerNative = await peer.open();
  await peerNative.put('notes', { ...note('peer-seed'), seedOrigin: 'seed' });
  await peerNative.put('notes', note('remote-only-user'));
  await peerNative.put('block_revisions', { noteId: 'peer-seed', blockId: 'workout', version: 1, kind: 'wod', dialect: 'time', rawContent: workout, savedAt: 1 });
  const cutoverGroups = await cutover.readOutbox(0, 100);
  for (const group of cutoverGroups) await peer.applySyncMutations(group.ops, null);
  assert.equal((await peer.readonly('notes').get('after-legacy-wipe'))?.title, 'after-legacy-wipe', 'terminal live rows survive pending legacy wipe');
  assert.equal(await peer.readonly('notes').get('remote-only-user'), undefined, 'legacy wipe still removes independently migrated remote user rows');
  assert.equal((await peer.readonly('notes').get('peer-seed'))?.seedOrigin, 'seed', 'cutover clear preserves peer seed content');
  assert.equal((await peer.readonly('block_revisions').get(['peer-seed', 'workout', 1]))?.rawContent, workout, 'cutover retains pinned immutable history');
  console.log('legacy outbox cutover preserves terminal state and peer seed: OK');

  globalThis.indexedDB = new IDBFactory();
  const policyLocal = new IndexedDBStorage({ dbName: 'policy-local' });
  opened.push(policyLocal);
  const policyNative = await policyLocal.open();
  const fixture = policyNative.transaction(['notes', 'block_revisions', 'sessions', 'efforts', 'field_catalog', 'meta'], 'readwrite');
  await fixture.objectStore('block_revisions').put({ noteId: 'seed-history', blockId: 'workout', version: 1, kind: 'wod', dialect: 'time', rawContent: workout, savedAt: 1 });
  await fixture.objectStore('notes').put({ ...note('seed-history'), seedOrigin: 'seed', rawContent: workout, blocks: { workout: { id: 'workout', kind: 'wod', dialect: 'time', version: 1, sourceRevision: 1, from: 0, to: workout.length } } });
  await fixture.objectStore('notes').put({ ...note('edited-seed'), seedOrigin: 'seed' });
  await fixture.objectStore('sessions').put({ id: 'saved-session', noteId: 'seed-history', blockId: 'workout', blockVersion: 1, startTime: 1, endTime: 2, duration: 1, completed: true, createdAt: 2 });
  await fixture.objectStore('efforts').put({ slug: 'bundled', label: 'Bundled', registrySource: 'bundled' });
  await fixture.objectStore('efforts').put({ slug: 'custom', label: 'Custom', registrySource: 'user' });
  await fixture.objectStore('field_catalog').put({ id: 'custom-field', path: 'custom.load', kind: 'number', spellings: { 'custom.load': 1 }, units: {}, sourceCount: 1, firstSeen: 1, lastSeen: 1 });
  await fixture.objectStore('meta').put({ key: 'seed:core', value: 'local checkpoint' });
  await fixture.done;
  await policyLocal.readwrite('notes').put({ ...note('edited-seed'), sourceRevision: 2, seedOrigin: 'user', title: 'My edited seed' });
  const policyEngine = new TursoSyncEngine(policyLocal, { url: 'https://policy.invalid', authToken: 'check' }, () => connect('policy.db'));
  await policyEngine.syncNow();
  const fresh = new IndexedDBStorage({ dbName: 'policy-fresh' });
  opened.push(fresh);
  const freshEngine = new TursoSyncEngine(fresh, { url: 'https://policy.invalid', authToken: 'check' }, () => connect('policy.db'));
  await freshEngine.restoreNow();
  assert.equal((await fresh.readonly('notes').get('edited-seed'))?.title, 'My edited seed');
  assert.equal(await fresh.readonly('notes').get('seed-history'), undefined, 'seed note is reconstructed separately');
  assert.equal((await fresh.readonly('sessions').get('saved-session'))?.blockVersion, 1);
  assert.equal((await fresh.readonly('block_revisions').get(['seed-history', 'workout', 1]))?.rawContent, workout, 'old seed history survives without the latest seed bundle');
  assert.equal(await fresh.readonly('efforts').get('bundled'), undefined);
  assert.equal((await fresh.readonly('efforts').get('custom'))?.label, 'Custom');
  assert.equal((await fresh.readonly('field_catalog').get('custom-field'))?.path, 'custom.load');
  assert.equal(await fresh.readonly('meta').get('seed:core'), undefined);
  await freshEngine.stop();

  const seedPath = 'markdown/notebooks/deleted.md';
  const seedId = await seedNoteId(seedPath);
  const seedWrite = {
    chunkId: 'notebook.test',
    expectedMeta: undefined,
    rows: [{ path: seedPath, content: '# Deleted seed', blocks: {}, blockIndex: [], blockEfforts: [], blockEquipment: [] }],
    manifest: { schema: SEED_SCHEMA, version: 1, builtAt: new Date(0).toISOString(), chunks: [] },
    meta: { ...emptySeedMeta('seed:deletion-check'), chunks: { 'notebook.test': { sha256: 'a'.repeat(64), noteIds: [seedId] } } },
  };
  await applySeedChunk(policyLocal, seedWrite);
  await new StorageService(policyLocal).deleteNote(seedId);
  await applySeedChunk(policyLocal, { ...seedWrite, expectedMeta: seedWrite.meta });
  assert.equal(await policyLocal.readonly('notes').get(seedId), undefined, 'deleted seed is not re-created by re-import');
  await policyEngine.syncNow();
  const suppressed = new IndexedDBStorage({ dbName: 'policy-suppressed' });
  opened.push(suppressed);
  const suppressedEngine = new TursoSyncEngine(suppressed, { url: 'https://policy.invalid', authToken: 'check' }, () => connect('policy.db'));
  await suppressedEngine.restoreNow();
  await applySeedChunk(suppressed, seedWrite);
  assert.equal(await suppressed.readonly('notes').get(seedId), undefined, 'seed deletion intent survives fresh-profile restore');
  await suppressedEngine.stop();

  await policyLocal.readwrite('block_revisions').put({ noteId: 'cascade-note', blockId: 'workout', version: 1, kind: 'wod', dialect: 'time', rawContent: workout, savedAt: 1 });
  await policyLocal.readwrite('notes').put({ ...note('cascade-note'), rawContent: workout, blocks: { workout: { id: 'workout', kind: 'wod', dialect: 'time', version: 1, sourceRevision: 1, from: 0, to: workout.length } } });
  await policyLocal.readwrite('block_index').put({ id: 'cascade-note:workout', noteId: 'cascade-note', blockId: 'workout', blockVersion: 1, sourceRevision: 1, position: 0, dataType: 'wod', rawContent: workout, from: 0, to: workout.length, noteTitle: 'cascade-note', createdAt: 1, isStatic: false });
  await policyEngine.syncNow();
  const cascadeRestored = new IndexedDBStorage({ dbName: 'cascade-restored' });
  opened.push(cascadeRestored);
  const cascadeEngine = new TursoSyncEngine(cascadeRestored, { url: 'https://policy.invalid', authToken: 'check' }, () => connect('policy.db'));
  await cascadeEngine.restoreNow();
  assert.equal((await cascadeRestored.readonly('block_index').get('cascade-note:workout'))?.rawContent, workout, 'peer receives projection before deletion');
  await new StorageService(policyLocal).deleteNote('cascade-note');
  await policyEngine.syncNow();
  await cascadeEngine.syncNow();
  assert.equal(await cascadeRestored.readonly('block_index').get('cascade-note:workout'), undefined, 'cascaded projection deletion reaches remote replay');
  await cascadeEngine.stop();

  await policyLocal.readwrite('notes').put(note('ownership-switch'));
  await policyEngine.syncNow();
  await policyLocal.readwrite('notes').put({ ...note('ownership-switch'), seedOrigin: 'seed' });
  await policyLocal.readwrite('notes').put(note('range-a'));
  await policyLocal.readwrite('notes').put(note('range-b'));
  await policyEngine.syncNow();
  await policyLocal.readwrite('notes').delete(IDBKeyRange.bound('range-a', 'range-b'));
  await policyEngine.syncNow();
  const terminal = new IndexedDBStorage({ dbName: 'policy-terminal' });
  opened.push(terminal);
  const terminalEngine = new TursoSyncEngine(terminal, { url: 'https://policy.invalid', authToken: 'check' }, () => connect('policy.db'));
  await terminalEngine.restoreNow();
  assert.equal(await terminal.readonly('notes').get('ownership-switch'), undefined, 'user to seed transition removes former user row');
  assert.equal(await terminal.readonly('notes').get('range-a'), undefined);
  assert.equal(await terminal.readonly('notes').get('range-b'), undefined);
  await terminalEngine.stop();
  await policyLocal.readwrite('notes').clear();
  const clearGroups = await policyLocal.readOutbox(0, 100);
  assert.ok(clearGroups.some(group => group.ops.some(op => op.op === 'delete' && op.store === 'notes' && op.key === 'edited-seed')));
  assert.ok(clearGroups.every(group => group.ops.every(op => op.op !== 'clear' && op.op !== 'wipe')), 'mixed-store clear journals eligible keys only');
  await policyEngine.syncNow();
  await policyLocal.wipeUserData();
  const wipeGroups = await policyLocal.readOutbox(0, 100);
  assert.ok(wipeGroups.every(group => group.ops.every(op => op.op !== 'clear' && op.op !== 'wipe')), 'user wipe never clears remote seed stores');
  await policyEngine.syncNow();
  await policyEngine.stop();
  const obsolete = connect('policy.db');
  await assert.rejects(applySyncBatch(obsolete, [{ id: 'obsolete-client', at: 1, ops: [{ op: 'wipe' }] }], { expectSchema: DB_VERSION - 1 }), /schema changed/);
  await obsolete.close();
  console.log('user scope fresh restore, seed suppression, ownership, ranges, clear/wipe and obsolete writer refusal: OK');
} finally {
  for (const local of opened) await local.close();
  await rm(dir, { recursive: true, force: true });
}
