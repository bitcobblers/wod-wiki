#!/usr/bin/env bun
/**
 * sql-check.ts — one assert-based behavioral check for the shared SQL storage
 * backend against a real temporary SQLite database (local libsql file, no
 * mocks): attachment binary roundtrip, collision-safe codec, keys/ranges/
 * indexes (IDB ordering incl. numbers-before-strings), compound keys,
 * transaction rollback + read-your-writes + scope/readonly enforcement,
 * deferred projections + stamping, WQL projection stale gate + heal, and
 * Turso URL validation.
 *
 * Run: bun packages/storage/tests/sql-check.ts
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import {
  BrowserTursoStorage,
  SqlStorage,
  decodeRowJson,
  encodeRowJson,
  libsqlDatabase,
  validateTursoUrl,
} from '../src/sql';
import type { Attachment, Note, NoteSegment } from '../src/entities';

const note = (id: string, title: string, date: number): Note => ({ id, title, createdAt: date, date });

const segment = (id: string, version: number, rawContent: string): NoteSegment => ({
  id, version, noteId: 'a', dataType: 'markdown', data: null, rawContent,
});

const attachment = (id: string, bytes: Uint8Array): Attachment => ({
  id, noteId: 'a', mimeType: 'application/octet-stream', label: 'HR stream',
  data: Uint8Array.from(bytes).buffer, timeSpan: { start: 1, end: 2 }, createdAt: 1,
});

async function codecAndStores(storage: SqlStorage): Promise<void> {
  // Attachment bytes round-trip exactly through the SQL row codec.
  const bytes = new Uint8Array([0, 255, 1, 254, 0, 0, 128, 7]);
  await storage.readwrite('attachments').put(attachment('att-1', bytes));
  const back = await storage.readonly('attachments').get('att-1');
  assert.ok(back?.data instanceof ArrayBuffer, 'attachment data must revive as ArrayBuffer');
  assert.deepEqual(new Uint8Array(back.data), bytes, 'attachment bytes must be byte-exact');

  // Authored tag-shaped objects in arbitrary rows (meta) round-trip untouched.
  const authored = { $binary: 'not base64 payload', $bytes: 3, $escaped: 1, more: [1, 2] };
  await storage.readwrite('meta').put({ key: 'prefs', value: authored });
  assert.deepEqual((await storage.readonly('meta').get('prefs'))?.value, authored, 'meta JSON must not be rewritten');

  // Codec helpers directly: without a declared binary field, tag-shaped
  // authored JSON stays data — the collision-safety property.
  const tagged = { $binary: 'AQID', $bytes: 3 };
  assert.deepEqual(decodeRowJson(JSON.stringify({ data: tagged })), { data: tagged });
  assert.equal(encodeRowJson({ keep: tagged }), JSON.stringify({ keep: tagged }));

  // Keys, ranges, indexes: IDB ordering (numbers sort before strings).
  const notes = storage.readwrite('notes');
  await notes.put(note('a', 'Squat Day', 10));
  await notes.put(note('b', 'Press Day', 20));
  await notes.put(note('c', 'Clean Day', 30));
  const byDate = await storage.readonly('notes').getAllFromIndex('by-date', { lower: 15, upper: 25 });
  assert.deepEqual(byDate.map((n) => n.id), ['b']);
  const bounded = await storage.readonly('notes').getAll({ lower: 'a', upper: 'b' });
  assert.deepEqual(bounded.map((n) => n.id), ['a', 'b']);
  assert.equal(await storage.readonly('notes').count({ lower: 15 }), 3, 'number bound sorts before all string keys');
  assert.equal(await storage.readonly('notes').count({ lower: 'b' }), 2);

  // Compound primary key (segments: [id, version]).
  const segments = storage.readwrite('segments');
  await segments.put(segment('s1', 1, 'v1'));
  await segments.put(segment('s1', 2, 'v2'));
  assert.equal((await storage.readonly('segments').get(['s1', 2]))?.rawContent, 'v2');
  assert.equal(await storage.readonly('segments').count({ lower: ['s1', 2] }), 1);
}

async function transactions(storage: SqlStorage): Promise<void> {
  // Throw inside fn → whole SQL tx rolls back; read-your-writes inside the tx.
  await assert.rejects(
    storage.transaction(['notes'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(note('tx-1', 'Temporary', 99));
      assert.equal((await tx.readonly('notes').get('tx-1'))?.title, 'Temporary');
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(await storage.readonly('notes').get('tx-1'), undefined);
  // Stores outside the requested scope are refused; readonly tx refuses writes.
  await assert.rejects(
    storage.transaction(['notes'], 'readwrite', (tx) => tx.readwrite('meta')),
    { code: 'store_out_of_scope' },
  );
  await assert.rejects(
    storage.transaction(['meta'], 'readonly', (tx) => tx.readwrite('meta')),
    { code: 'read_only_transaction' },
  );

  // verifyWritable: real INSERT rolled back — nothing persists.
  await storage.verifyWritable();
  const marker = await storage.readonly('meta').getAll({
    lower: '__wodwiki_write_check_',
    upper: '__wodwiki_write_check_\uffff',
  });
  assert.equal(marker.length, 0, 'verifyWritable must commit zero rows');
}

async function projectionsAndStamping(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wodwiki-sql2-'));
  try {
    const db = libsqlDatabase(createClient({ url: 'file:' + join(dir, 'c.db') }));
    const dest = new SqlStorage(db);
    await dest.ready();
    // Migration-style bulk load: one rebuild, no restamping, projections work.
    await dest.bulkTransaction(['notes'], async (tx) => {
      await tx.readwrite('notes').put(note('m1', 'Migrated One', 1));
      await tx.readwrite('notes').put(note('m2', 'Migrated Two', 2));
    });
    const q = await dest.queryDomain({ plan: 'notes', selection: [{ field: 'text', value: 'migrated' }] });
    assert.ok(q?.plan === 'notes');
    assert.equal(q.rows.length, 2);
    assert.ok(!(q.rows[0] && 'userId' in q.rows[0]), 'rows must land verbatim without getUserId');

    const stamped = new SqlStorage(db, { getUserId: () => 'user-1' });
    await stamped.ready();
    await stamped.readwrite('notes').put(note('m3', 'Stamped Note', 3));
    const row = await dest.readonly('notes').get('m3');
    assert.ok(row != null && 'userId' in row && row.userId === 'user-1');
    await dest.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function wqlProjections(storage: SqlStorage): Promise<void> {
  const q = await storage.queryDomain({ plan: 'notes', selection: [{ field: 'text', value: 'squat' }] });
  assert.ok(q?.plan === 'notes');
  assert.deepEqual(q.rows.map((r) => r.id), ['a']);
  // Orphan block gates reads (stale fallback, like ApiStorage's 409 → undefined).
  await storage.readwrite('block_index').put({
    id: 'b-ghost', noteId: 'ghost', segmentId: 's', segmentVersion: 1,
    dataType: 'markdown', rawContent: 'orphan', noteTitle: 'ghost', createdAt: 1,
  });
  assert.equal(await storage.queryDomain({ plan: 'notes', selection: [] }), undefined);
  await storage.readwrite('block_index').delete('b-ghost');
  const healed = await storage.queryDomain({ plan: 'notes', selection: [] });
  assert.ok(healed?.plan === 'notes' && healed.rows.length === 3, 'projection must heal after orphan removal');
}

function urlValidation(): void {
  assert.equal(validateTursoUrl('libsql://my-db.turso.io'), 'libsql://my-db.turso.io');
  assert.equal(validateTursoUrl('http://127.0.0.1:18081'), 'http://127.0.0.1:18081');
  assert.throws(() => validateTursoUrl('file:/tmp/x.db'));
  assert.throws(() => validateTursoUrl('libsql://u:p@host'));
  assert.throws(() => validateTursoUrl('https://host/?apikey=secret'));
  assert.throws(() => validateTursoUrl('http://example.com'));
  // Constructor rejects insecure URLs without ever surfacing the token.
  assert.throws(() => new BrowserTursoStorage({ url: 'file:/tmp/x.db', authToken: 'hunter2' }));
}

const dir = await mkdtemp(join(tmpdir(), 'wodwiki-sql-'));
try {
  const storage = new SqlStorage(libsqlDatabase(createClient({ url: 'file:' + join(dir, 'check.db') })));
  await storage.ready();
  await codecAndStores(storage);
  await transactions(storage);
  await projectionsAndStamping();
  await wqlProjections(storage);
  urlValidation();
  await storage.close();
  console.log('sql-check: OK');
} finally {
  await rm(dir, { recursive: true, force: true });
}
