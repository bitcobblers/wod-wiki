#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client, type ResultSet, type Transaction } from '@libsql/client';
import {
  BrowserTursoStorage, SqlStorage, decodeRowJson, encodeRowJson, libsqlDatabase,
  refreshDomain, validateTursoUrl, type Database, type LibsqlClient,
} from '../src/sql';
import type { BlockIndexRow, BlockRevision, EventRecord, Note, Session } from '../src/entities';
import type { IStorageTransaction } from '../src/contract';
import { rowsEqual } from '../src/validation';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';

interface Measurement { name: string; calls: number; execute: number; nativeBatch: number; controls: number; returnedRows: number; affectedRows: number; domainChanges: number }
interface SavedFixture { note: Note; revision: BlockRevision; index: BlockIndexRow }

function instrument(client: Client) {
  let metric: Measurement = { name: '', calls: 0, execute: 0, nativeBatch: 0, controls: 0, returnedRows: 0, affectedRows: 0, domainChanges: 0 };
  const result = (sql: string, value: ResultSet): ResultSet => {
    metric.returnedRows += value.rows.length;
    metric.affectedRows += value.rowsAffected;
    if (/^(INSERT INTO|DELETE FROM|UPDATE) "(?:domain_note|query_block)"/.test(sql)) metric.domainChanges += value.rowsAffected;
    return value;
  };
  const tracked: LibsqlClient = {
    execute: async statement => {
      metric.calls++; metric.execute++;
      return result(typeof statement === 'string' ? statement : statement.sql, await client.execute(statement));
    },
    transaction: async mode => {
      metric.calls++; metric.controls++;
      const tx = await client.transaction(mode);
      return new Proxy(tx, {
        get(target, property) {
          if (property === 'execute') return async (statement: Parameters<Transaction['execute']>[0]) => {
            metric.calls++; metric.execute++;
            return result(typeof statement === 'string' ? statement : statement.sql, await target.execute(statement));
          };
          if (property === 'batch') return async (statements: Parameters<Transaction['batch']>[0]) => {
            metric.calls++; metric.nativeBatch++;
            const values = await target.batch(statements);
            return values.map((value, i) => {
              const statement = statements[i];
              return result(typeof statement === 'string' ? statement : statement.sql, value);
            });
          };
          if (property === 'commit' || property === 'rollback') return async () => {
            metric.calls++; metric.controls++;
            await target[property]();
          };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    close: () => client.close(),
  };
  return {
    db: libsqlDatabase(tracked),
    measure: async (name: string, operation: () => Promise<unknown>): Promise<Measurement> => {
      metric = { name, calls: 0, execute: 0, nativeBatch: 0, controls: 0, returnedRows: 0, affectedRows: 0, domainChanges: 0 };
      await operation();
      return { ...metric };
    },
  };
}

function fixture(id: string, body = '10 Pushups', version = 1, sourceRevision = version, prefix = ''): SavedFixture {
  const slice = `\`\`\`time\n${body}\n\`\`\``;
  const rawContent = prefix + slice;
  const block = { id: 'b', kind: 'wod', version, sourceRevision, from: prefix.length, to: rawContent.length, dialect: 'time' } as const;
  const note: Note = { id, title: `Workout ${id}`, createdAt: 1, date: 1, rawContent, sourceRevision, blocks: { b: block } };
  const revision: BlockRevision = { noteId: id, blockId: 'b', version, kind: 'wod', dialect: 'time', rawContent: slice, savedAt: version };
  const index: BlockIndexRow = { id: `${id}:b`, noteId: id, blockId: 'b', blockVersion: version, sourceRevision,
    from: block.from, to: block.to, dataType: 'wod', rawContent: slice, noteTitle: note.title, createdAt: 1, blockContentId: 'pushup-content' };
  return { note, revision, index };
}

async function save(tx: IStorageTransaction, value: SavedFixture): Promise<void> {
  await tx.readwrite('notes').put(value.note);
  await tx.readwrite('block_revisions').put(value.revision);
  await tx.readwrite('block_index').put(value.index);
}

async function historyAndRollback(storage: SqlStorage, db: Database): Promise<void> {
  const first = fixture('history');
  const second = fixture('history', '20 Pushups', 2);
  const reverted = fixture('history', '10 Pushups', 3);
  for (const value of [first, second, reverted]) await storage.transaction(['notes', 'block_revisions', 'block_index'], 'readwrite', tx => save(tx, value));
  const history = await storage.readonly('block_revisions').getAllFromIndex('by-block', ['history', 'b']);
  assert.deepEqual(history.map(row => [row.version, row.savedAt, row.rawContent]), [first, second, reverted].map(value => [value.revision.version, value.revision.savedAt, value.revision.rawContent]));
  assert.equal(await storage.readonly('sessions').count(), 0, 'never-run saved versions remain inspectable');
  const duplicate = fixture('duplicate');
  duplicate.note.rawContent += '\n\n' + duplicate.revision.rawContent;
  duplicate.note.blocks.copy = { ...duplicate.note.blocks.b, id: 'copy', from: duplicate.revision.rawContent.length + 2, to: duplicate.note.rawContent.length };
  await storage.transaction(['notes', 'block_revisions', 'block_index'], 'readwrite', async tx => {
    await save(tx, duplicate);
    await tx.readwrite('block_revisions').put({ ...duplicate.revision, blockId: 'copy' });
    await tx.readwrite('block_index').put({ ...duplicate.index, id: 'duplicate:copy', blockId: 'copy', from: duplicate.note.blocks.copy.from, to: duplicate.note.blocks.copy.to });
  });
  assert.equal((await storage.readonly('block_revisions').getAllFromIndex('by-block', ['duplicate', 'b'])).length, 1);
  assert.equal((await storage.readonly('block_revisions').getAllFromIndex('by-block', ['duplicate', 'copy'])).length, 1);
  await storage.readwrite('notes').delete('duplicate');
  assert.equal(history[0].rawContent, history[2].rawContent, 'revert creates v3 without overwriting v1');
  const moved = fixture('history', '10 Pushups', 3, 4, 'Prose before block\n\n');
  await storage.transaction(['notes', 'block_revisions', 'block_index'], 'readwrite', tx => save(tx, moved));
  assert.equal(await storage.readonly('block_revisions').countFromIndex('by-note', 'history'), 3, 'prose/move adds no content revision');
  const session: Session = { id: 'run', noteId: 'history', blockId: 'b', blockVersion: 3, createdAt: 3, startTime: 3, endTime: 3, duration: 0, completed: false, status: 'in-progress' };
  await storage.transaction(['notes', 'block_revisions', 'block_index', 'sessions'], 'readwrite', async tx => {
    await save(tx, moved);
    await tx.readwrite('sessions').put(session);
    assert.equal((await tx.readonly('sessions').get('run'))?.blockVersion, 3);
  });
  await assert.rejects(storage.readwrite('sessions').put({ ...session, blockVersion: 2 }), /immutable/);
  await assert.rejects(storage.transaction(['notes', 'block_revisions', 'block_index', 'sessions', 'events', 'meta'], 'readwrite', async tx => {
    const next = fixture('history', '30 Pushups', 4, 5);
    await save(tx, next);
    await tx.readwrite('meta').put({ key: 'checkpoint', value: 4 });
    await tx.readwrite('events').put({ id: 'failed:event', resultId: 'run', noteId: 'history', timestamp: 4, grain: 'event', outputType: 'segment', metrics: [] });
    await tx.readwrite('block_revisions').put({ ...first.revision, savedAt: 999 });
  }), /immutable/);
  assert.deepEqual(await storage.readonly('notes').get('history'), moved.note);
  assert.equal(await storage.readonly('block_revisions').get(['history', 'b', 4]), undefined);
  assert.equal(await storage.readonly('events').get('failed:event'), undefined);
  assert.equal(await storage.readonly('meta').get('checkpoint'), undefined);
  await assert.rejects(storage.readwrite('sessions').put({ ...session, id: 'missing', blockVersion: 99 }), /pin/);
  await assert.rejects(storage.readwrite('notes').put({ ...moved.note, rawContent: 'overwritten', blocks: {} }), /stale/);
  await assert.rejects(storage.readwrite('notes').put({ ...moved.note, blocks: { b: { ...moved.note.blocks.b, from: -1 } } }), { status: 400, code: 'invalid_note_blocks' });
  const old = await storage.readonly('notes').get('history');
  await storage.readwrite('notes').put({ ...moved.note, seedOrigin: 'user' });
  await assert.rejects(db.transaction(tx => refreshDomain(tx, [
    { op: 'put', store: 'meta', value: { key: 'raced', value: true } },
    { op: 'check', store: 'notes', key: 'history', value: old },
    { op: 'put', store: 'notes', value: { ...moved.note, title: 'Unsafe owner overwrite' } },
  ])), /transaction read changed/);
  assert.equal(await storage.readonly('meta').get('raced'), undefined, 'checks run before mutations even when ordered later');
  await assert.rejects(db.transaction(tx => refreshDomain(tx, [
    { op: 'check', store: 'notes', key: 'history', value: null },
    { op: 'put', store: 'meta', value: { key: 'absence-race' } },
  ])), /transaction read changed/);
  await storage.readwrite('notes').delete('history');
  assert.equal(await storage.readonly('block_index').countFromIndex('by-note', 'history'), 0);
  assert.equal(await storage.readonly('block_revisions').countFromIndex('by-note', 'history'), 3);
  assert.equal((await storage.readonly('block_revisions').get(['history', 'b', session.blockVersion]))?.rawContent, reverted.revision.rawContent, 'replay survives deletion');
  await storage.readwrite('sessions').put({ ...session, completed: true, status: 'completed' });
  await assert.rejects(storage.readwrite('block_revisions').delete(['history', 'b', 1]), /wipe/);
  await assert.rejects(storage.readwrite('block_revisions').clear(), /wipe/);
}

async function queryAndStores(storage: SqlStorage, db: Database): Promise<void> {
  const prose: Note = { id: 'prose', title: 'Whole Note', rawContent: 'Prose-only searchable needle %_ İ', sourceRevision: 1, blocks: {}, createdAt: 10, date: 10 };
  await storage.readwrite('notes').put(prose);
  const body = await storage.queryDomain({ plan: 'notes', selection: [{ field: 'text', value: 'needle %_' }] });
  assert.ok(body?.plan === 'notes'); assert.deepEqual(body.rows.map(row => row.id), ['prose']);
  assert.equal((await storage.queryDomain({ plan: 'blocks', selection: [{ field: 'text', value: 'needle' }] }))?.matchedCount, 0);
  const rawContent = '```query\n:note\n```\n\n```widget:attention\nNotice\n```\n\n[Video](https://youtu.be/demo)\n\n```unknown\nRecoverable source\n```';
  let occurrence = 0;
  const actionable = reconcileNoteBlocks(rawContent, { sourceRevision: 1, createId: () => `action-${occurrence++}` });
  const mixed: Note = { id: 'mixed', title: 'Mixed', rawContent, sourceRevision: 1, blocks: actionable, createdAt: 1 };
  await storage.transaction(['notes', 'block_revisions', 'block_index'], 'readwrite', async tx => {
    await tx.readwrite('notes').put(mixed);
    for (const block of Object.values(actionable)) {
      const rawContent = mixed.rawContent.slice(block.from, block.to);
      await tx.readwrite('block_revisions').put({ noteId: mixed.id, blockId: block.id, version: 1, kind: block.kind, rawContent, savedAt: 1 });
      await tx.readwrite('block_index').put({ id: `${mixed.id}:${block.id}`, noteId: mixed.id, blockId: block.id, blockVersion: 1, sourceRevision: 1, from: block.from, to: block.to, dataType: block.kind, rawContent, noteTitle: mixed.title, createdAt: 1 });
    }
  });
  const sparse = await storage.queryDomain({ plan: 'blocks', selection: [{ field: 'noteId', values: ['mixed'] }] });
  assert.ok(sparse?.plan === 'blocks');
  assert.deepEqual(sparse.rows.map(row => row.dataType).sort(), ['embed', 'query', 'widget']);
  assert.equal((await storage.queryDomain({ plan: 'notes', selection: [{ field: 'text', value: 'Recoverable source' }] }))?.matchedCount, 1);
  assert.equal((await storage.queryDomain({ plan: 'blocks', selection: [{ field: 'text', value: 'Recoverable source' }] }))?.matchedCount, 0);
  assert.equal((await storage.queryDomain({ plan: 'entries', limit: 0 }))?.rows.length, 0);
  const action = fixture('action');
  await storage.transaction(['notes', 'block_revisions', 'block_index', 'block_efforts', 'tags', 'note_tags', 'page', 'page_notes'], 'readwrite', async tx => {
    await save(tx, action);
    await tx.readwrite('block_efforts').put({ id: 'action:b:pushup', noteId: 'action', blockId: 'b', blockContentId: 'pushup-content', effortSlug: 'pushup', createdAt: 1 });
    await tx.readwrite('tags').put({ id: 'tag', label: 'strength', createdAt: 1 });
    await tx.readwrite('note_tags').put({ id: 'nt', noteId: 'action', tagId: 'tag' });
    await tx.readwrite('page').put({ id: 'page', slug: 'workouts', createdAt: 1 });
    await tx.readwrite('page_notes').put({ id: 'link', pageId: 'page', noteId: 'action', createdAt: 1 });
  });
  const entries = await storage.queryDomain({ plan: 'entries', selection: [{ field: 'tags', values: ['strength'] }], filters: [{ field: 'text', value: 'pushups' }], limit: 1 });
  assert.ok(entries?.plan === 'entries'); assert.equal(entries.selectedCount, 1); assert.equal(entries.matchedCount, 1);
  assert.deepEqual(entries.rows[0].note, action.note); assert.equal(entries.rows[0].tags[0].label, 'strength');
  assert.equal(entries.rows[0].links[0].pageId, 'page'); assert.equal(entries.rows[0].pages[0].slug, 'workouts');
  assert.ok(!('segments' in entries.rows[0]));
  const effort = await storage.queryDomain({ plan: 'blocks', selection: [{ field: 'effort', values: ['pushup'] }] });
  assert.ok(effort?.plan === 'blocks'); assert.deepEqual(effort.rows.map(row => row.id), ['action:b']);
  await storage.readwrite('notes').put({ ...action.note, date: 42 });
  const healed = await storage.queryDomain({ plan: 'blocks', selection: [{ field: 'date', start: 42, end: 42 }] });
  assert.equal(healed?.matchedCount, 1, 'affected parent date heals dependent query blocks');
  await storage.readwrite('block_index').put({ ...action.index, sourceRevision: 99 });
  assert.equal(await storage.queryDomain({ plan: 'notes' }), undefined, 'invalid current map pins gate fast projections');
  await storage.readwrite('block_index').put(action.index);
  assert.ok(await storage.queryDomain({ plan: 'notes' }));
  const event: EventRecord = { id: 'event', resultId: 'run', noteId: 'action', timestamp: 1, grain: 'event', outputType: 'segment', metrics: [], metricDateKeys: ['d:2026-01-01', 'd:2026-01-01'] };
  await storage.readwrite('events').put(event);
  assert.equal(await storage.readonly('events').countFromIndex('by-metric-date', 'd:2026-01-01'), 1);
  await storage.readwrite('events').put({ ...event, metricDateKeys: ['d:2026-01-02'] });
  assert.equal(await storage.readonly('events').countFromIndex('by-metric-date', 'd:2026-01-01'), 0);
  await storage.readwrite('events').delete({ lower: 'event', upper: 'event' } as unknown as IDBKeyRange);
  assert.equal(await storage.readonly('events').countFromIndex('by-metric-date', 'd:2026-01-02'), 0);
  assert.deepEqual(await storage.readonly('notes').getMany(['action', 'missing', 'prose']), [{ ...action.note, date: 42 }, undefined, prose]);
  assert.deepEqual((await storage.readonly('note_tags').getAllFromIndexMany('by-note', ['action', 'missing'])).map(rows => rows.length), [1, 0]);
  await assert.rejects(storage.transaction(['notes'], 'readwrite', async tx => { tx.readonly('meta'); }), /outside/);
  await assert.rejects(storage.transaction(['notes'], 'readonly', async tx => { tx.readwrite('notes'); }), /readonly/);
  const bytes = new Uint8Array([0, 255, 1, 128]);
  await storage.readwrite('attachments').put({ id: 'attachment', noteId: 'prose', mimeType: 'application/octet-stream', label: 'HR', data: bytes.buffer, timeSpan: { start: 1, end: 2 }, createdAt: 1 });
  const attachment = await storage.readonly('attachments').get('attachment');
  assert.ok(attachment?.data instanceof ArrayBuffer); assert.deepEqual(new Uint8Array(attachment.data), bytes);
  const authored = { $binary: 'AQID', $bytes: 3 };
  assert.deepEqual(decodeRowJson(encodeRowJson({ keep: authored })), { keep: authored });
  assert.ok(rowsEqual({ a: 1, b: undefined }, { a: 1 }));
  await storage.verifyWritable();
  assert.equal((await db.query(`SELECT COUNT(*) AS n FROM "meta" WHERE "k0" LIKE '__wodwiki_write_check_%'`))[0].n, 0);
}

async function workload(dir: string): Promise<void> {
  const tracked = instrument(createClient({ url: `file:${join(dir, 'workload.db')}` }));
  const storage = new SqlStorage(tracked.db);
  await storage.ready();
  const values = Array.from({ length: 1250 }, (_, i) => fixture(`n${String(i).padStart(4, '0')}`, '10 Pushups', 1, 1, `${'Authored prose '.repeat(150)}\n\n`));
  const initial = await tracked.measure('Initial sparse corpus', () => storage.bulkTransaction(['notes', 'block_revisions', 'block_index'], async tx => {
    await tx.readwrite('notes').putMany(values.map(value => value.note));
    await tx.readwrite('block_revisions').putMany(values.map(value => value.revision));
    await tx.readwrite('block_index').putMany(values.map(value => value.index));
  }));
  assert.ok(initial.nativeBatch > 0, 'real libsql Transaction.batch handles independent chunk writes');
  assert.equal(await storage.readonly('notes').count(), 1250);
  assert.equal(await storage.readonly('block_revisions').count(), 1250);
  assert.equal(await storage.readonly('block_index').count(), 1250);
  const rows: Measurement[] = [];
  rows.push(await tracked.measure('Notes first 20', async () => {
    const result = await storage.queryDomain({ plan: 'notes', limit: 20 });
    assert.equal(result?.rows.length, 20); assert.equal(result?.selectedCount, 1250); assert.equal(result?.matchedCount, 1250);
  }));
  rows.push(await tracked.measure('Entries first 20', async () => {
    const result = await storage.queryDomain({ plan: 'entries', limit: 20 });
    assert.equal(result?.rows.length, 20); assert.equal(result?.matchedCount, 1250);
  }));
  rows.push(await tracked.measure('Identical note put', () => storage.readwrite('notes').put({ ...values[0].note })));
  assert.equal(rows.at(-1)?.affectedRows, 0, 'identical source and projections write no rows');
  rows.push(await tracked.measure('One changed note, normal transaction', () => storage.transaction(['notes'], 'readwrite', async tx => {
    await tx.readwrite('notes').put({ ...values[0].note, title: 'Changed normally' });
  })));
  rows.push(await tracked.measure('One changed note, bulk transaction', () => storage.bulkTransaction(['notes'], async tx => {
    await tx.readwrite('notes').put({ ...values[1].note, title: 'Changed in bulk' });
  })));
  rows.push(await tracked.measure('Metadata-only bulk transaction', () => storage.bulkTransaction(['meta'], async tx => {
    await tx.readwrite('meta').put({ key: 'checkpoint', value: 1 });
  })));
  assert.equal(rows.at(-1)?.domainChanges, 0, 'metadata-only bulk touches no domain rows');
  assert.ok(rows[0].execute < 4 && rows[1].execute < 8, 'count reuse and selected-page reuse reduce execute calls');
  const unchanged = await tracked.measure('Identical corpus putMany', () => storage.bulkTransaction(['notes', 'block_index'], async tx => {
    const saved = await tx.readonly('notes').getMany(values.map(value => value.note.id));
    await tx.readwrite('notes').putMany(saved.filter((row): row is Note => row !== undefined));
    await tx.readwrite('block_index').putMany(values.map(value => value.index));
  }));
  assert.equal(unchanged.affectedRows, 0, 'identical batched source and index rows never rewrite projections');
  assert.ok(rows[3].affectedRows < 10 && rows[4].affectedRows < 10, 'changed parent refresh stays change-scoped');
  const baselinePath = '/tmp/wodwiki-architecture-evidence-1791769203197.json';
  let baseline: unknown;
  try { baseline = JSON.parse(await readFile(baselinePath, 'utf8')); } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    baseline = { unavailable: baselinePath, recordedRows: [
      ['Notes first 20', 6, 4, 23, 0], ['Entries first 20', 10, 8, 43, 0], ['Identical note put', 9, 4, 4, 3],
      ['One changed note, normal transaction', 9, 4, 4, 3], ['One changed note, bulk transaction', 50, 3, 3750, 7502], ['Metadata-only bulk transaction', 50, 3, 3750, 7502],
    ] };
  }
  const baselineMeasurement = typeof baseline === 'object' && baseline !== null && 'measurement' in baseline ? baseline.measurement : baseline;
  console.log(JSON.stringify({ method: 'Actual local libsql execute/native Transaction.batch and controls; returned rows and rowsAffected include deletes. No HTTP, remote latency or billed-row claims.', fixture: { notes: 1250, revisions: 1250, blocks: 1250, sourceJSONBytes: Buffer.byteLength(JSON.stringify(values.map(value => value.note))) }, initial, measurements: rows, unchangedCorpus: unchanged, baseline: baselineMeasurement }, null, 2));
  await storage.close();
}

const dir = await mkdtemp(join(tmpdir(), 'wodwiki-sparse-storage-'));
try {
  const db = libsqlDatabase(createClient({ url: `file:${join(dir, 'behavior.db')}` }));
  const storage = new SqlStorage(db);
  await storage.ready();
  await historyAndRollback(storage, db);
  await queryAndStores(storage, db);
  await storage.readwrite('memberships').put({ id: 'default', displayName: 'Keep', createdAt: 1 });
  await storage.wipe();
  assert.equal(await storage.readonly('block_revisions').count(), 0);
  assert.equal((await storage.readonly('memberships').get('default'))?.displayName, 'Keep');
  await storage.close();
  const oldDb = libsqlDatabase(createClient({ url: `file:${join(dir, 'incompatible.db')}` }));
  await oldDb.exec(`CREATE TABLE "_wodwiki_schema" ("key" TEXT PRIMARY KEY, "value" TEXT)`);
  await oldDb.exec(`INSERT INTO "_wodwiki_schema" VALUES ('schema', '{"version":28}')`);
  await assert.rejects(new SqlStorage(oldDb).ready(), /recreation required/);
  assert.equal((await oldDb.query(`SELECT "value" FROM "_wodwiki_schema"`))[0].value, '{"version":28}');
  await oldDb.close();
  assert.equal(validateTursoUrl('http://127.0.0.1:18081'), 'http://127.0.0.1:18081');
  assert.throws(() => validateTursoUrl('http://example.com'));
  assert.throws(() => validateTursoUrl('https://host/?apikey=secret'));
  assert.throws(() => new BrowserTursoStorage({ url: 'file:/tmp/not-authorized' }));
  await workload(dir);
  console.log('sql-check: OK');
} finally {
  await rm(dir, { recursive: true, force: true });
}
