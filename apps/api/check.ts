#!/usr/bin/env bun
/**
 * check.ts — one assert-based API check: CRUD, indexes/ranges, compound keys,
 * multi-entry, tx rollback, wipe (memberships survive), the /v1/query domain
 * boundary (counts before paging, MAX-before-history segments, orphan gate +
 * heal), invalid-input statuses, and static serving (traversal/symlink/SPA).
 *
 * Default: local SQLite in a temp file — close/reopen proves persistence.
 * Explicit DB_DRIVER (postgres/turso/...) requires WOD_CHECK_ALLOW_REMOTE=1:
 * the run writes and WIPES, so point it at a fresh disposable database only.
 *
 * Run: bun apps/api/check.ts
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './src/database';
import { initializeStore, initializeDomain } from '@bitcobblers/wod-wiki-storage/sql';
import { createHandler } from './src/app';

const driver = process.env.DB_DRIVER;
if (driver) {
  if (process.env.WOD_CHECK_ALLOW_REMOTE !== '1') {
    console.error(
      `check: DB_DRIVER=${driver} targets a real database (${process.env.DATABASE_URL ?? 'no DATABASE_URL'}). ` +
        'The check writes and WIPES data. Point DB_DRIVER/DATABASE_URL at a fresh disposable database, ' +
        'then re-run with WOD_CHECK_ALLOW_REMOTE=1.',
    );
    process.exit(1);
  }
}

interface Res { status: number; headers: Headers; json: unknown }
const enc = (v: unknown): string => encodeURIComponent(JSON.stringify(v));

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'wodwiki-check-'));
  try {
    await suite(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function suite(dir: string): Promise<void> {
  const env = driver
    ? {
        DB_DRIVER: driver,
        DATABASE_URL: process.env.DATABASE_URL,
        LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN,
      }
    : { DB_DRIVER: 'sqlite', SQLITE_PATH: join(dir, 'check.db') };

  const dist = join(dir, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await mkdir(join(dist, 'seed/chunks'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<html>shell</html>');
  await writeFile(join(dist, 'assets/app.js'), 'console.log(1)');
  await writeFile(join(dist, 'seed/chunks/abc.js'), 'hashed()');
  await writeFile(join(dir, 'secret.txt'), 'outside');
  await symlink(join(dir, 'secret.txt'), join(dist, 'escape.js'));

  const open = async () => {
    const db = await openDatabase(env);
    await initializeStore(db);
    await initializeDomain(db);
    return db;
  };

  let db = await open();
  let handler = createHandler(db, { playgroundDist: dist });
  const call = async (method: string, path: string, body?: unknown): Promise<Res> => {
    const res = await handler(new Request(`http://check.local${path}`, {
      method,
      ...(body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    }));
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text) as unknown;
    } catch { /* plain text body */ }
    return { status: res.status, headers: res.headers, json };
  };
  const errBody = (json: unknown): string => (typeof json === 'object' && json !== null && 'error' in json ? String(json.error) : String(json));

  // ── health ────────────────────────────────────────────────────────────────
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { ok: true, driver: db.dialect });
  // Rerunnable: an explicitly opted-in disposable may hold a previous run.
  assert.equal((await call('POST', '/api/v1/wipe')).status, 204);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const note = { id: 'n1', title: 'Fran Bench', date: 20261004, createdAt: 100 };
  assert.deepEqual(await call('PUT', '/api/v1/notes', { value: note }), { status: 200, headers: health.headers, json: { key: 'n1' } });
  const got = await call('GET', `/api/v1/notes/get?key=${enc('n1')}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.json, note, 'original payload round-trips');
  assert.equal((await call('GET', `/api/v1/notes/get?key=${enc('nope')}`)).status, 404);
  const missingKey = await call('GET', '/api/v1/notes/get');
  assert.equal(missingKey.status, 400);
  assert.equal(errBody(missingKey.json), 'missing ?key');

  // ── lists, indexes, ranges ────────────────────────────────────────────────
  const n2 = { id: 'n2', title: 'Annie Row', date: 20261005, createdAt: 101 };
  assert.equal((await call('PUT', '/api/v1/notes', { value: n2 })).status, 200);
  assert.equal(((await call('GET', '/api/v1/notes/all')).json as unknown[]).length, 2);
  const byDate = await call('GET', `/api/v1/notes/index/by-date?range=${enc(20261004)}`);
  assert.deepEqual(byDate.json, [note], 'bare scalar range wraps to {only}');
  assert.deepEqual((await call('GET', `/api/v1/notes/index/by-date?range=${enc({ lower: 20261004, lowerOpen: true })}`)).json, [n2]);
  assert.deepEqual((await call('GET', `/api/v1/notes/index/by-date?range=${enc({ upper: 20261005, upperOpen: true })}`)).json, [note]);
  assert.deepEqual(await call('GET', '/api/v1/notes/count'), { status: 200, headers: health.headers, json: { count: 2 } });
  assert.deepEqual(await call('GET', `/api/v1/notes/count?index=by-date&range=${enc({ only: 20261004 })}`), { status: 200, headers: health.headers, json: { count: 1 } });
  assert.deepEqual(await call('GET', `/api/v1/notes/count?index=by-date&range=${enc(20261004)}`), { status: 200, headers: health.headers, json: { count: 1 } });
  assert.equal((await call('GET', '/api/v1/notes/count?index=bogus')).status, 404);
  assert.match(errBody((await call('GET', '/api/v1/notes/count?index=bogus')).json), /bogus/);

  // compound keys
  const seg = (version: number, raw: string) =>
    ({ id: 's1', version, noteId: 'n1', dataType: 'markdown', data: null, rawContent: raw, createdAt: 50 + version });
  assert.equal((await call('PUT', '/api/v1/segments', { value: seg(1, 'v1') })).status, 200);
  assert.equal((await call('PUT', '/api/v1/segments', { value: seg(2, 'v2') })).status, 200);
  const seg2 = await call('GET', `/api/v1/segments/get?key=${enc(['s1', 2])}`);
  assert.deepEqual(seg2.json, seg(2, 'v2'));
  assert.deepEqual(((await call('GET', '/api/v1/segments/all')).json as { version: number }[]).map((s) => s.version), [1, 2]);
  assert.equal((await call('DELETE', `/api/v1/segments?key=${enc(['s1', 1])}`)).status, 204);
  assert.deepEqual(((await call('GET', '/api/v1/segments/all')).json as { version: number }[]).map((s) => s.version), [2]);
  assert.equal((await call('DELETE', `/api/v1/segments?key=${enc(['s1', 2])}`)).status, 204, 'tuple-key delete binds scalars only');
  assert.deepEqual(await call('GET', '/api/v1/segments/all').then((r) => r.json), []);

  // multi-entry index: scalar exact-match membership, replacement, removal
  const ev = { id: 'e1', metricDateKeys: [20261004, 20261006], timestamp: 1 };
  assert.equal((await call('PUT', '/api/v1/events', { value: ev })).status, 200);
  assert.deepEqual(await call('GET', `/api/v1/events/index/by-metric-date?range=${enc(20261004)}`).then((r) => r.json), [ev]);
  assert.deepEqual(await call('GET', '/api/v1/events/count?index=by-metric-date&range=' + enc(20261004)).then((r) => r.json), { count: 1 });
  const arrayOnly = await call('GET', `/api/v1/events/index/by-metric-date?range=${enc([20261004])}`);
  assert.equal(arrayOnly.status, 400, 'multi-entry arrays are not exact-match keys');
  assert.equal((await call('GET', `/api/v1/events/index/by-metric-date?range=${enc({ lower: 1, upper: 9 })}`)).status, 400, 'multi-entry bounded ranges rejected');
  const ev2 = { id: 'e1', metricDateKeys: [20261006], timestamp: 1 };
  assert.equal((await call('PUT', '/api/v1/events', { value: ev2 })).status, 200, 're-put replaces junction entries');
  assert.deepEqual(await call('GET', `/api/v1/events/index/by-metric-date?range=${enc(20261004)}`).then((r) => r.json), []);
  assert.deepEqual(await call('GET', `/api/v1/events/index/by-metric-date?range=${enc(20261006)}`).then((r) => r.json), [ev2]);

  // string prefix range on a text index
  for (const [id, path] of [['f1', 'effort.run'], ['f2', 'effort.row'], ['f3', 'session.reps']]) {
    await call('PUT', '/api/v1/field_catalog', { value: { id, path } });
  }
  const prefix = await call('GET', `/api/v1/field_catalog/index/by-path?range=${enc({ lower: 'effort.', upper: 'effort.~' })}`);
  assert.deepEqual((prefix.json as { id: string }[]).map((r) => r.id), ['f2', 'f1'], 'byte order: effort.row < effort.run');

  // ── transactions: atomicity + rollback ────────────────────────────────────
  const tx = await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'tags', value: { id: 't1', label: 'hero', createdAt: 1 } },
    { op: 'put', store: 'tags', value: { id: 't2', label: 'goat', createdAt: 1 } },
    { op: 'delete', store: 'tags', key: 't2' },
  ] });
  assert.deepEqual(tx.json, { results: ['t1', 't2', null] }, 'one result per op: put key or null');
  assert.deepEqual((await call('GET', '/api/v1/tags/all')).json, [{ id: 't1', label: 'hero', createdAt: 1 }]);
  const rolled = await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'tags', value: { id: 'tX', label: 'ok' } },
    { op: 'put', store: 'tags', value: { label: 'nope' } },
  ] });
  assert.equal(rolled.status, 400, 'missing key part is a client input error');
  assert.equal((await call('GET', `/api/v1/tags/get?key=${enc('tX')}`)).status, 404, 'rollback left nothing behind');
  assert.equal((await call('POST', '/api/v1/tx', { ops: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/v1/field_catalog/clear')).status, 204);
  assert.deepEqual(await call('GET', '/api/v1/field_catalog/count').then((r) => r.json), { count: 0 });

  // ── wipe keeps system memberships ─────────────────────────────────────────
  const member = { id: 'default', displayName: 'Serge', createdAt: 1 };
  assert.equal((await call('PUT', '/api/v1/memberships', { value: member })).status, 200);
  assert.equal((await call('POST', '/api/v1/wipe')).status, 204);
  for (const store of ['notes', 'segments', 'events', 'tags']) {
    assert.deepEqual(await call('GET', `/api/v1/${store}/count`).then((r) => r.json), { count: 0 }, `${store} wiped`);
  }
  assert.deepEqual(await call('GET', `/api/v1/memberships/get?key=${enc('default')}`).then((r) => r.json), member);

  // clear-put ordering: projection follows the FINAL source state either way
  const cp = await call('POST', '/api/v1/tx', { ops: [
    { op: 'clear', store: 'notes' },
    { op: 'put', store: 'notes', value: { id: 'cp1', title: 'Survivor', createdAt: 1 } },
  ] });
  assert.deepEqual(cp.json, { results: [null, 'cp1'] });
  assert.deepEqual(await call('POST', '/api/v1/query', { plan: 'notes' }).then((r) => (r.json as { matchedCount: number }).matchedCount), 1);
  await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: { id: 'cp2', title: 'Doomed', createdAt: 2 } },
    { op: 'clear', store: 'notes' },
  ] });
  assert.deepEqual(await call('POST', '/api/v1/query', { plan: 'notes' }).then((r) => (r.json as { matchedCount: number }).matchedCount), 0);
  assert.equal((await call('POST', '/api/v1/tx', { ops: [{ op: 'bogus', store: 'notes' }] })).status, 400, 'unknown op must fail, never clear');

  // ── domain query boundary ─────────────────────────────────────────────────
  const u1 = '11111111-1111-4111-8111-111111111111';
  const u2 = '22222222-2222-4222-8222-222222222222';
  const u3 = '33333333-3333-4333-8333-333333333333';
  const u4 = '44444444-4444-4444-8444-444444444444';
  const u5 = '55555555-5555-4555-8555-555555555555';
  const seeded = await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: { id: u1, title: 'Fran Bench', date: 20261004, createdAt: 100, userId: 'default' } },
    { op: 'put', store: 'notes', value: { id: u2, title: 'Annie Row', date: 20261005, createdAt: 101, userId: 'default' } },
    { op: 'put', store: 'notes', value: { id: u3, title: 'Page Home', type: 'page', sourceId: 'page:home', createdAt: 102 } },
    { op: 'put', store: 'notes', value: { id: u4, title: 'Feed G', type: 'feed', sourceId: 'collection:g', createdAt: 103 } },
    { op: 'put', store: 'notes', value: { id: u5, title: 'No Date', createdAt: 500 } },
    { op: 'put', store: 'segments', value: { id: 's1', version: 1, noteId: u1, position: 0, dataType: 'markdown', data: null, rawContent: 'OLDSPANKE', createdAt: 50, isHistory: true } },
    { op: 'put', store: 'segments', value: { id: 's1', version: 2, noteId: u1, position: 0, dataType: 'markdown', data: null, rawContent: 'spank clean', createdAt: 60, isHistory: false } },
    { op: 'put', store: 'block_index', value: { id: `${u1}:s1:2`, noteId: u1, segmentId: 's1', segmentVersion: 2, dataType: 'markdown', rawContent: 'spank clean', noteTitle: 'Fran Bench', createdAt: 60 } },
    { op: 'put', store: 'tags', value: { id: 't1', label: 'hero', createdAt: 1 } },
    { op: 'put', store: 'note_tags', value: { id: 'nt1', noteId: u1, tagId: 't1' } },
    { op: 'put', store: 'page', value: { id: 'p1', title: 'P', createdAt: 1 } },
    { op: 'put', store: 'page_notes', value: { id: 'pn1', pageId: 'p1', noteId: u1, createdAt: 1 } },
  ] });
  assert.equal(seeded.status, 200);
  const q = (body: unknown) => call('POST', '/api/v1/query', body);

  const entries = await q({
    plan: 'entries',
    selection: [{ field: 'defaultNotes', feeds: false }],
    filters: [{ field: 'text', value: 'spank' }],
  });
  assert.equal(entries.status, 200, String(entries.json));
  const entryRows = entries.json as { selectedCount: number; matchedCount: number; rows: {
    note: { id: string }; segments: { version: number; rawContent: string }[]; tags: { label: string }[]; links: unknown[]; pages: unknown[];
  }[] };
  assert.equal(entryRows.selectedCount, 3, 'page + feed excluded pre-count; dateless u5 stays');
  assert.equal(entryRows.matchedCount, 1);
  assert.equal(entryRows.rows[0].note.id, u1);
  assert.equal(entryRows.rows[0].segments.length, 1, 'history filtered');
  assert.equal(entryRows.rows[0].segments[0].version, 2, 'MAX before history — no resurrection');
  assert.equal(entryRows.rows[0].segments[0].rawContent, 'spank clean');
  assert.equal(entryRows.rows[0].tags[0].label, 'hero');
  assert.equal(entryRows.rows[0].links.length, 1);
  assert.equal(entryRows.rows[0].pages.length, 1);
  assert.deepEqual(await q({ plan: 'entries', filters: [{ field: 'text', value: 'oldspanke' }] }).then((r) => (r.json as { matchedCount: number }).matchedCount), 0, 'superseded revision invisible to active-only search');

  // paging counts run before limit/offset
  const paged = await q({
    plan: 'notes',
    selection: [{ field: 'defaultNotes', feeds: false }],
    order: [{ field: 'date', direction: 'asc' }],
    limit: 1,
    offset: 1,
  });
  const pagedRows = paged.json as { selectedCount: number; matchedCount: number; rows: { id: string }[] };
  assert.equal(pagedRows.selectedCount, 3, 'u1,u2 + dateless u5');
  assert.equal(pagedRows.matchedCount, 3, 'matched ignores paging');
  assert.equal(pagedRows.rows.length, 1);
  assert.equal(pagedRows.rows[0].id, u2, 'raw date asc NULLS LAST: u1,u2 then dateless u5; offset 1 lands on u2');

  assert.deepEqual(await q({ plan: 'notes', selection: [{ field: 'defaultNotes', feeds: true }] }).then((r) => (r.json as { selectedCount: number }).selectedCount), 4, 'feeds=true excludes only page rows');
  assert.deepEqual(await q({ plan: 'notes', selection: [{ field: 'catalog', values: ['g'], negate: true }] }).then((r) => (r.json as { matchedCount: number }).matchedCount), 4, 'NULL-safe catalog negation');
  assert.deepEqual(await q({ plan: 'notes', selection: [{ field: 'source', values: ['feeds'], negate: true }] }).then((r) => (r.json as { matchedCount: number }).matchedCount), 4, 'negated source never drops NULL sourceId');
  const journals = await q({ plan: 'notes', selection: [{ field: 'source', values: ['journal'] }] });
  assert.deepEqual((journals.json as { rows: { id: string }[] }).rows.map((r) => r.id).sort(), [u1, u2, u5].sort(), 'journal matches every sourceless UUID note');
  assert.deepEqual(await q({ plan: 'notes', selection: [{ field: 'date', start: 20261004, end: 20261004 }] }).then((r) => (r.json as { matchedCount: number }).matchedCount), 1);
  assert.deepEqual(await q({ plan: 'notes', selection: [{ field: 'date', start: 20261004, end: 20261004, endExclusive: true }] }).then((r) => (r.json as { matchedCount: number }).matchedCount), 0);
  assert.deepEqual(await q({ plan: 'notes', selection: [{ field: 'date', start: 400, end: 600 }] }).then((r) => (r.json as { rows: { id: string }[] }).rows[0]?.id), u5, 'date falls back to createdAt');

  const blocks = await q({ plan: 'blocks', selection: [{ field: 'sourceFence' }], filters: [{ field: 'text', value: 'SPANk' }, { field: 'type', values: ['markdown'] }] });
  const blockRows = blocks.json as { matchedCount: number; rows: { id: string }[] };
  assert.equal(blockRows.matchedCount, 1, 'literal lowercased text + type filter');
  assert.equal(blockRows.rows[0].id, `${u1}:s1:2`);
  assert.equal((await q({ plan: 'blocks', selection: [{ field: 'page', value: true }] })).status, 400, 'page predicate rejected on blocks');
  assert.equal((await q({ plan: 'notes', order: [{ field: 'noteTitle' }] })).status, 400, 'noteTitle order rejected on notes');
  assert.equal((await q({ plan: 'widgets' })).status, 400);
  assert.equal((await q({ plan: 'notes', bogus: 1 })).status, 400);
  assert.equal((await q({ plan: 'notes', filters: [{ field: 'text', value: '' }] })).status, 400);
  assert.equal((await q({ plan: 'notes', filters: [{ field: 'type', values: [], negate: false }] })).status, 400);
  const huge = await call('POST', '/api/v1/query', { plan: 'notes', padding: 'x'.repeat(70_000) });
  assert.equal(huge.status, 413);

  // orphan gate: deleting the parent note fails domain reads closed; re-put heals
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc(u1)}`)).status, 204);
  const gated = await q({ plan: 'blocks' });
  assert.equal(gated.status, 409);
  assert.equal((gated.json as { code?: string }).code, 'domain_projection_unavailable');
  assert.equal((await call('PUT', '/api/v1/notes', { value: { id: u1, title: 'Fran Bench', date: 20261004, createdAt: 100, userId: 'default' } })).status, 200);
  assert.deepEqual(await q({ plan: 'blocks' }).then((r) => (r.json as { matchedCount: number }).matchedCount), 1, 'healed after identity restored');

  // ── invalid input ─────────────────────────────────────────────────────────
  assert.equal((await call('GET', '/api/v1/bogus/all')).status, 404);
  assert.equal((await call('GET', '/api/v1/notes/bogus')).status, 405);
  assert.equal((await call('GET', '/api/v1/notes/get/x')).status, 404);
  assert.equal((await call('DELETE', '/api/v1/tx')).status, 404, 'non-POST /tx falls through to store routing');
  assert.equal((await call('GET', '/api/v1/notes/all?range=notjson')).status, 400);
  assert.equal((await call('GET', '/api/v1/notes/all?count=abc')).status, 400);
  assert.equal((await call('GET', '/api/v1/notes/all?count=-1')).status, 400);
  assert.equal((await call('DELETE', '/api/v1/notes')).status, 400);
  assert.equal((await call('PUT', '/api/v1/notes', 'nope')).status, 400);
  assert.equal((await call('PUT', '/api/v1/notes', [1])).status, 400);
  assert.equal((await call('PUT', '/api/v1/notes', { value: { id: 'bad-source', sourcePath: 42 } })).status, 400);
  assert.equal((await call('GET', `/api/v1/notes/get?key=${enc('bad-source')}`)).status, 404);
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: { id: u1, title: 'Must roll back', createdAt: 100 } },
    { op: 'put', store: 'notes', value: { id: 'bad-source', noteId: 42 } },
  ] })).status, 400);
  const retainedNote = (await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json;
  assert.ok(typeof retainedNote === 'object' && retainedNote !== null && 'title' in retainedNote);
  assert.equal(retainedNote.title, 'Fran Bench');
  // trust-boundary range/key validators: garbage fails closed, no crash
  assert.equal((await call('GET', `/api/v1/notes/all?range=${enc([])}`)).status, 400, '[] is not a range');
  assert.equal((await call('GET', `/api/v1/notes/all?range=${enc({ only: [] })}`)).status, 400, 'empty tuple key invalid');
  assert.equal((await call('GET', `/api/v1/notes/all?range=${enc({})}`)).status, 200, 'explicit unbounded range stays legal');
  assert.equal(((await call('GET', '/api/v1/notes/all?range=' + enc({}))).json as unknown[]).length, 5);
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc([])}`)).status, 400);
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc({ only: [] })}`)).status, 400);
  const beforeNoMatch = await call('GET', '/api/v1/notes/count').then((r) => (r.json as { count: number }).count);
  assert.equal((await call('DELETE', `/api/v1/notes?range=${enc({ lower: 'zz-none', upper: 'zz-none' })}`)).status, 204);
  assert.equal(await call('GET', '/api/v1/notes/count').then((r) => (r.json as { count: number }).count), beforeNoMatch, 'no-match delete is a no-op');
  // unknown op fails the whole tx and clears nothing
  assert.equal((await call('POST', '/api/v1/tx', { ops: [{ op: 'bogus', store: 'notes' }] })).status, 400, 'unknown op must fail, never clear');
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'bogus', store: 'notes' },
    { op: 'put', store: 'notes', value: { id: 'bad-op-put', title: 'x', createdAt: 1 } },
  ] })).status, 400);
  assert.equal((await call('GET', `/api/v1/notes/get?key=${enc('bad-op-put')}`)).status, 404, 'failed tx left nothing behind');

  // ── static serving ────────────────────────────────────────────────────────
  const shell = await call('GET', '/');
  assert.equal(shell.status, 200);
  assert.equal(shell.json, '<html>shell</html>');
  const asset = await call('GET', '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(asset.headers.get('cache-control'), 'no-cache');
  assert.equal((await call('GET', '/seed/chunks/abc.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await call('GET', '/some/route')).json, '<html>shell</html>', 'extensionless SPA fallback');
  assert.equal((await call('GET', '/missing.js')).status, 404, 'asset miss with extension');
  assert.equal((await call('GET', '/%2e%2e%2fsecret.txt')).status, 403, 'encoded traversal (URL normalizes bare %2e%2e segments)');
  assert.equal((await call('GET', '/escape.js')).status, 404, 'symlink escape never served');
  assert.equal((await call('POST', '/', { x: 1 })).status, 405);
  assert.equal((await call('GET', '/api/v1/bogus/all')).status, 404, 'no SPA fallback for API paths');

  // ── persistence across close/reopen ───────────────────────────────────────
  await db.close();
  db = await open();
  handler = createHandler(db, { playgroundDist: dist });
  assert.equal((await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).status, 200, 'data survives reopen');
  assert.deepEqual(await call('POST', '/api/v1/query', { plan: 'blocks' }).then((r) => (r.json as { matchedCount: number }).matchedCount), 1, 'projection rebuilt on boot');
  assert.deepEqual(await call('GET', `/api/v1/memberships/get?key=${enc('default')}`).then((r) => r.json), member, 'membership durable');

  // dist shell symlink escape: the SPA fallback follows the same confinement
  await rm(join(dist, 'index.html'));
  await symlink(join(dir, 'secret.txt'), join(dist, 'index.html'));
  assert.equal((await call('GET', '/')).status, 404, 'symlinked shell refused');
  assert.equal((await call('GET', '/some/route')).status, 404, 'extensionless fallback refused with it');

  // Rerunnable: leave explicitly opted-in disposables empty.
  assert.equal((await call('POST', '/api/v1/wipe')).status, 204);
  assert.deepEqual(await call('GET', '/api/v1/notes/count').then((r) => r.json), { count: 0 });

  await db.close();
  process.stdout.write('check: all assertions passed\n');
}

main().catch((e) => {
  console.error('check failed:', e);
  process.exit(1);
});
