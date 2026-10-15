#!/usr/bin/env bun
/**
 * Assert-based API checks cover CRUD, whole-Note search, immutable block
 * history, pinned Sessions, optimistic conflicts, rollback, indexes/ranges,
 * memberships, invalid inputs and confined static serving.
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
import { openDatabase } from '@bitcobblers/wod-wiki-storage/sql/node';
import { initializeStore, initializeDomain } from '@bitcobblers/wod-wiki-storage/sql';
import { createHandler } from '@bitcobblers/wod-wiki-tools/server';
import { ApiStorage, type Note, type BlockRevision, type BlockIndexRow, type Session } from '@bitcobblers/wod-wiki-storage';

const driver = process.env.DB_DRIVER;
if (driver) {
  if (process.env.WOD_CHECK_ALLOW_REMOTE !== '1') {
    console.error(
      `check: DB_DRIVER=${driver} selects an external database. ` +
        'The check writes and WIPES data. Point DB_DRIVER/DATABASE_URL at a fresh disposable database, ' +
        'then re-run with WOD_CHECK_ALLOW_REMOTE=1.',
    );
    process.exit(1);
  }
}

interface Res { status: number; headers: Headers; json: unknown }
const enc = (v: unknown): string => encodeURIComponent(JSON.stringify(v));
const field = (value: unknown, name: string): unknown => {
  assert.ok(value !== null && typeof value === 'object' && name in value, `response has ${name}`);
  return Reflect.get(value, name);
};
const matched = (response: Res): unknown => field(response.json, 'matchedCount');


const wholeNote = (id: string, title: string, createdAt: number, rawContent = '') => ({
  id, title, createdAt, rawContent, sourceRevision: 1, blocks: {},
});
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
  const note = { ...wholeNote('n1', 'Fran Bench', 100), date: 20261004 };
  assert.deepEqual(await call('PUT', '/api/v1/notes', { value: note }), { status: 200, headers: health.headers, json: { key: 'n1' } });
  const got = await call('GET', `/api/v1/notes/get?key=${enc('n1')}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.json, note, 'original payload round-trips');
  assert.equal((await call('GET', `/api/v1/notes/get?key=${enc('nope')}`)).status, 404);
  const missingKey = await call('GET', '/api/v1/notes/get');
  assert.equal(missingKey.status, 400);
  assert.equal(errBody(missingKey.json), 'missing ?key');

  // ── lists, indexes, ranges ────────────────────────────────────────────────
  const n2 = { ...wholeNote('n2', 'Annie Row', 101), date: 20261005 };
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

  const revision = (version: number, rawContent: string) => ({
    noteId: 'n1', blockId: 'b1', version, kind: 'wod', dialect: 'time', rawContent, savedAt: 50 + version,
  });
  assert.equal((await call('PUT', '/api/v1/block_revisions', { value: revision(1, '```time\nv1\n```') })).status, 200);
  assert.equal((await call('PUT', '/api/v1/block_revisions', { value: revision(2, '```time\nv2\n```') })).status, 200);
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/get?key=${enc(['n1', 'b1', 2])}`)).json, revision(2, '```time\nv2\n```'));
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/index/by-block?range=${enc(['n1', 'b1'])}`)).json, [revision(1, '```time\nv1\n```'), revision(2, '```time\nv2\n```')]);
  assert.equal((await call('PUT', '/api/v1/block_revisions', { value: revision(1, '```time\nv1\n```') })).status, 200, 'identical immutable write is a no-op');
  const collision = await call('PUT', '/api/v1/block_revisions', { value: revision(1, '```time\nchanged\n```') });
  assert.equal(collision.status, 409);
  assert.equal(field(collision.json, 'code'), 'revision_conflict');
  assert.equal((await call('DELETE', `/api/v1/block_revisions?key=${enc(['n1', 'b1', 1])}`)).status, 409, 'ordinary delete cannot erase history');
  assert.equal((await call('POST', '/api/v1/block_revisions/clear')).status, 409, 'ordinary clear cannot erase history');

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
  for (const store of ['notes', 'block_revisions', 'events', 'tags']) {
    assert.deepEqual(await call('GET', `/api/v1/${store}/count`).then((r) => r.json), { count: 0 }, `${store} wiped`);
  }
  assert.deepEqual(await call('GET', `/api/v1/memberships/get?key=${enc('default')}`).then((r) => r.json), member);

  // clear-put ordering: projection follows the FINAL source state either way
  const cp = await call('POST', '/api/v1/tx', { ops: [
    { op: 'clear', store: 'notes' },
    { op: 'put', store: 'notes', value: wholeNote('cp1', 'Survivor', 1) },
  ] });
  assert.deepEqual(cp.json, { results: [null, 'cp1'] });
  assert.equal(matched(await call('POST', '/api/v1/query', { plan: 'notes' })), 1);
  await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: wholeNote('cp2', 'Doomed', 2) },
    { op: 'clear', store: 'notes' },
  ] });
  assert.equal(matched(await call('POST', '/api/v1/query', { plan: 'notes' })), 0);
  assert.equal((await call('POST', '/api/v1/tx', { ops: [{ op: 'bogus', store: 'notes' }] })).status, 400, 'unknown op must fail, never clear');

  // ── domain query boundary ─────────────────────────────────────────────────
  const u1 = '11111111-1111-4111-8111-111111111111';
  const u2 = '22222222-2222-4222-8222-222222222222';
  const u3 = '33333333-3333-4333-8333-333333333333';
  const u4 = '44444444-4444-4444-8444-444444444444';
  const u5 = '55555555-5555-4555-8555-555555555555';
  const workout = '```time\nspank clean\n```';
  const source = `Prose-only silverneedle match.\n\n${workout}\n`;
  const from = source.indexOf(workout);
  const currentNote = {
    ...wholeNote(u1, 'Fran Bench', 100, source), date: 20261004, userId: 'default',
    blocks: { b1: { id: 'b1', kind: 'wod', dialect: 'time', version: 2, sourceRevision: 1, from, to: from + workout.length } },
  } satisfies Note & { userId: string };
  const oldRevision = { noteId: u1, blockId: 'b1', version: 1, kind: 'wod', dialect: 'time', rawContent: '```time\nOLDSPANKE\n```', savedAt: 50 } satisfies BlockRevision;
  const currentRevision = { ...oldRevision, version: 2, rawContent: workout, savedAt: 60 };
  const liveIndex = { id: `${u1}:b1`, noteId: u1, blockId: 'b1', blockVersion: 2, dataType: 'wod', sourceRevision: 1, from, to: from + workout.length, rawContent: workout, noteTitle: 'Fran Bench', createdAt: 60 } satisfies BlockIndexRow;
  const seeded = await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: currentNote },
    { op: 'put', store: 'notes', value: { ...wholeNote(u2, 'Annie Row', 101), date: 20261005, userId: 'default' } },
    { op: 'put', store: 'notes', value: { ...wholeNote(u3, 'Page Home', 102), type: 'page', sourceId: 'page:home' } },
    { op: 'put', store: 'notes', value: { ...wholeNote(u4, 'Feed G', 103), type: 'feed', sourceId: 'collection:g' } },
    { op: 'put', store: 'notes', value: wholeNote(u5, 'No Date', 500) },
    { op: 'put', store: 'block_revisions', value: oldRevision },
    { op: 'put', store: 'block_revisions', value: currentRevision },
    { op: 'put', store: 'block_index', value: liveIndex },
    { op: 'put', store: 'block_efforts', value: { id: `${u1}:b1:clean`, noteId: u1, blockId: 'b1', effortSlug: 'clean', createdAt: 60 } },
    { op: 'put', store: 'tags', value: { id: 't1', label: 'hero', createdAt: 1 } },
    { op: 'put', store: 'note_tags', value: { id: 'nt1', noteId: u1, tagId: 't1' } },
    { op: 'put', store: 'page', value: { id: 'p1', title: 'P', createdAt: 1 } },
    { op: 'put', store: 'page_notes', value: { id: 'pn1', pageId: 'p1', noteId: u1, createdAt: 1 } },
  ] });
  assert.equal(seeded.status, 200);
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
  const txStatuses: number[] = [];
  const recordFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(response.url).pathname === '/api/v1/tx') txStatuses.push(response.status);
    return response;
  };
  const client = new ApiStorage(`http://127.0.0.1:${server.port}/api`, recordFetch);
  try {
    await client.transaction(['notes'], 'readwrite', async (tx) => {
      const notes = tx.readwrite('notes');
      const original = await notes.get(u1);
      assert.deepEqual(original, currentNote);
      assert.ok(original);
      const pending = { ...original, title: 'Buffered title' };
      await notes.put(pending);
      assert.deepEqual(await notes.get(u1), pending, 'callback reads its buffered writes');
      await notes.put(original);
    });
    await assert.rejects(client.transaction(['notes', 'meta'], 'readwrite', async (tx) => {
      const notes = tx.readwrite('notes');
      const originals = await notes.getMany([u1, 'http-absent']);
      assert.deepEqual(originals, [currentNote, undefined]);
      assert.equal((await call('PUT', '/api/v1/notes', { value: { ...currentNote, title: 'Concurrent metadata' } })).status, 200);
      await notes.put(currentNote);
      await tx.readwrite('meta').put({ key: 'http-race-checkpoint', completed: true });
    }), 'ApiStorage callback must forward original-row checks');
    assert.equal(txStatuses.at(-1), 409);
    assert.equal((await call('GET', `/api/v1/meta/get?key=${enc('http-race-checkpoint')}`)).status, 404);
    assert.equal(field((await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json, 'title'), 'Concurrent metadata');
    assert.equal((await call('PUT', '/api/v1/notes', { value: currentNote })).status, 200);
    await assert.rejects(client.transaction(['notes', 'meta'], 'readwrite', async (tx) => {
      assert.equal(await tx.readonly('notes').get('http-absent'), undefined);
      assert.equal((await call('PUT', '/api/v1/notes', { value: wholeNote('http-absent', 'Created concurrently', 1) })).status, 200);
      await tx.readwrite('meta').put({ key: 'http-absent-checkpoint', completed: true });
    }), 'ApiStorage forwards expected absence');
    assert.equal(txStatuses.at(-1), 409);
    assert.equal((await call('GET', `/api/v1/meta/get?key=${enc('http-absent-checkpoint')}`)).status, 404);
    assert.equal((await call('DELETE', `/api/v1/notes?key=${enc('http-absent')}`)).status, 204);
    await assert.rejects(client.transaction(['notes', 'meta'], 'readwrite', async (tx) => {
      const rows = await tx.readonly('notes').getAllFromIndex('by-date', 20261004);
      assert.deepEqual(rows, [currentNote]);
      assert.equal((await call('PUT', '/api/v1/notes', { value: { ...currentNote, seedOrigin: 'user' } })).status, 200);
      await tx.readwrite('meta').put({ key: 'http-list-checkpoint', completed: true });
    }), 'ApiStorage records returned scoped rows for ownership assertions');
    assert.equal(txStatuses.at(-1), 409);
    assert.equal((await call('GET', `/api/v1/meta/get?key=${enc('http-list-checkpoint')}`)).status, 404);
    assert.equal((await call('PUT', '/api/v1/notes', { value: currentNote })).status, 200);
  } finally {
    await client.close();
    server.stop(true);
  }
  const q = (body: unknown) => call('POST', '/api/v1/query', body);

  const entries = await q({
    plan: 'entries',
    selection: [{ field: 'defaultNotes', feeds: false }],
    filters: [{ field: 'text', value: 'spank' }],
  });
  assert.equal(entries.status, 200, String(entries.json));
  const entryRows = entries.json as { selectedCount: number; matchedCount: number; rows: {
    note: { id: string; rawContent: string }; tags: { label: string }[]; links: unknown[]; pages: unknown[];
  }[] };
  assert.equal(entryRows.selectedCount, 3, 'page + feed excluded pre-count; dateless u5 stays');
  assert.equal(entryRows.matchedCount, 1);
  assert.equal(entryRows.rows[0].note.id, u1);
  assert.equal(entryRows.rows[0].note.rawContent, source, 'whole authored Note body round-trips');
  assert.ok(!('segments' in entryRows.rows[0]), 'DomainEntry has no persisted segment payload');
  assert.equal(matched(await q({ plan: 'notes', filters: [{ field: 'text', value: 'silverneedle' }] })), 1, 'prose-only body match finds Note');
  assert.equal(matched(await q({ plan: 'blocks', filters: [{ field: 'text', value: 'silverneedle' }] })), 0, 'prose never becomes an actionable block');
  assert.equal(entryRows.rows[0].tags[0].label, 'hero');
  assert.equal(entryRows.rows[0].links.length, 1);
  assert.equal(entryRows.rows[0].pages.length, 1);
  assert.equal(matched(await q({ plan: 'entries', filters: [{ field: 'text', value: 'oldspanke' }] })), 0, 'saved history stays outside current body search');

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

  assert.equal(field((await q({ plan: 'notes', selection: [{ field: 'defaultNotes', feeds: true }] })).json, 'selectedCount'), 4, 'feeds=true excludes only page rows');
  assert.equal(matched(await q({ plan: 'notes', selection: [{ field: 'catalog', values: ['g'], negate: true }] })), 4, 'NULL-safe catalog negation');
  assert.equal(matched(await q({ plan: 'notes', selection: [{ field: 'source', values: ['feeds'], negate: true }] })), 4, 'negated source never drops NULL sourceId');
  const journals = await q({ plan: 'notes', selection: [{ field: 'source', values: ['journal'] }] });
  const journalRows = field(journals.json, 'rows');
  assert.ok(Array.isArray(journalRows));
  assert.deepEqual(journalRows.map((row) => field(row, 'id')).sort(), [u1, u2, u5].sort(), 'journal matches every sourceless UUID note');
  assert.equal(matched(await q({ plan: 'notes', selection: [{ field: 'date', start: 20261004, end: 20261004 }] })), 1);
  assert.equal(matched(await q({ plan: 'notes', selection: [{ field: 'date', start: 20261004, end: 20261004, endExclusive: true }] })), 0);
  const fallbackRows = field((await q({ plan: 'notes', selection: [{ field: 'date', start: 400, end: 600 }] })).json, 'rows');
  assert.ok(Array.isArray(fallbackRows));
  assert.equal(field(fallbackRows[0], 'id'), u5, 'date falls back to createdAt');

  const blocks = await q({ plan: 'blocks', selection: [{ field: 'sourceFence' }], filters: [{ field: 'text', value: 'SPANk' }, { field: 'type', values: ['wod'] }] });
  const blockRows = blocks.json as { matchedCount: number; rows: { id: string }[] };
  assert.equal(blockRows.matchedCount, 1, 'literal lowercased text + actionable type filter');
  assert.equal(blockRows.rows[0].id, `${u1}:b1`);
  assert.equal((await q({ plan: 'blocks', selection: [{ field: 'page', value: true }] })).status, 400, 'page predicate rejected on blocks');
  assert.equal((await q({ plan: 'notes', order: [{ field: 'noteTitle' }] })).status, 400, 'noteTitle order rejected on notes');
  assert.equal((await q({ plan: 'widgets' })).status, 400);
  assert.equal((await q({ plan: 'notes', bogus: 1 })).status, 400);
  assert.equal((await q({ plan: 'notes', filters: [{ field: 'text', value: '' }] })).status, 400);
  assert.equal((await q({ plan: 'notes', filters: [{ field: 'type', values: [], negate: false }] })).status, 400);
  const huge = await call('POST', '/api/v1/query', { plan: 'notes', padding: 'x'.repeat(70_000) });
  assert.equal(huge.status, 413);

  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc(u1)}`)).status, 204);
  assert.equal(matched(await q({ plan: 'blocks' })), 0, 'deletion removes current blocks');
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/index/by-note?range=${enc(u1)}`)).json, [oldRevision, currentRevision], 'never-run saved history survives Note deletion');
  assert.equal((await call('PUT', '/api/v1/notes', { value: currentNote })).status, 200);
  assert.equal((await call('PUT', '/api/v1/block_index', { value: liveIndex })).status, 200);
  assert.equal(matched(await q({ plan: 'blocks' })), 1);

  const pin = { id: 'pinned', noteId: u1, blockId: 'b1', blockVersion: 1, startTime: 1, endTime: 2, duration: 1, completed: true, status: 'completed', createdAt: 2 } satisfies Session;
  assert.equal((await call('PUT', '/api/v1/sessions', { value: pin })).status, 200, 'Session pins older immutable source');
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/get?key=${enc([u1, pin.blockId, pin.blockVersion])}`)).json, oldRevision, 'replay uses pinned revision rather than latest');
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc(u1)}`)).status, 204);
  assert.deepEqual((await call('GET', `/api/v1/sessions/get?key=${enc(pin.id)}`)).json, pin, 'Note deletion preserves Session pin');
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/get?key=${enc([u1, pin.blockId, pin.blockVersion])}`)).json, oldRevision, 'deleted Note remains replayable');
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: currentNote },
    { op: 'put', store: 'block_index', value: liveIndex },
  ] })).status, 200);
  const missingPin = await call('PUT', '/api/v1/sessions', { value: { ...pin, id: 'bad-pin', blockVersion: 99 } });
  assert.equal(missingPin.status, 409);
  assert.equal(field(missingPin.json, 'code'), 'invalid_session_pin');
  for (const value of [
    { ...pin, segmentId: 'b1' },
    { ...pin, segmentVersion: 1 },
    { ...pin, version: 1 },
    { ...pin, rawContent: workout },
    { ...pin, blockVersion: 0 },
  ]) assert.equal((await call('PUT', '/api/v1/sessions', { value })).status, 400, 'old or invalid Session source shapes rejected');

  const checkpoint = { key: 'seed-checkpoint', completed: false };
  assert.equal((await call('PUT', '/api/v1/meta', { value: checkpoint })).status, 200);
  const changedSource = source.replace('spank clean', 'spank press');
  const changedNote = { ...currentNote, rawContent: changedSource, sourceRevision: 2, blocks: { b1: { ...currentNote.blocks.b1, version: 3, sourceRevision: 2 } } };
  const changedIndex = { ...liveIndex, blockVersion: 3, sourceRevision: 2, rawContent: workout.replace('clean', 'press') };
  const writes = [
    { op: 'put', store: 'notes', value: changedNote },
    { op: 'put', store: 'block_revisions', value: { ...currentRevision, version: 3, rawContent: changedIndex.rawContent, savedAt: 70 } },
    { op: 'put', store: 'sessions', value: { ...pin, id: 'rolled-session', blockVersion: 3 } },
    { op: 'put', store: 'events', value: { id: 'rolled-event', noteId: u1, blockId: 'b1', blockVersion: 3, resultId: 'rolled-session', timestamp: 70, outputType: 'segment' } },
    { op: 'put', store: 'block_index', value: changedIndex },
    { op: 'put', store: 'block_efforts', value: { id: `${u1}:b1:press`, noteId: u1, blockId: 'b1', effortSlug: 'press', createdAt: 70 } },
    { op: 'put', store: 'meta', value: { ...checkpoint, completed: true } },
  ];
  const immutableRollback = await call('POST', '/api/v1/tx', { ops: [
    ...writes,
    { op: 'put', store: 'block_revisions', value: { ...oldRevision, rawContent: '```time\nconflict\n```' } },
  ] });
  assert.equal(immutableRollback.status, 409);
  assert.deepEqual((await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json, currentNote, 'revision conflict rolls back Note');
  const assertRollback = async (expectedIndex = liveIndex) => {
    assert.equal((await call('GET', `/api/v1/block_revisions/get?key=${enc([u1, 'b1', 3])}`)).status, 404);
    assert.equal((await call('GET', `/api/v1/sessions/get?key=${enc('rolled-session')}`)).status, 404);
    assert.equal((await call('GET', `/api/v1/events/get?key=${enc('rolled-event')}`)).status, 404);
    assert.deepEqual((await call('GET', `/api/v1/block_index/get?key=${enc(liveIndex.id)}`)).json, expectedIndex);
    assert.equal((await call('GET', `/api/v1/block_efforts/get?key=${enc(`${u1}:b1:press`)}`)).status, 404, 'failed save leaves no new effort joins');
    assert.deepEqual((await call('GET', `/api/v1/meta/get?key=${enc(checkpoint.key)}`)).json, checkpoint);
    assert.equal(matched(await q({ plan: 'blocks', filters: [{ field: 'text', value: 'press' }] })), 0, 'failed writes leave no searchable projection');
  };
  await assertRollback();

  const observed = (await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json;
  const concurrentNote = { ...currentNote, rawContent: source.replace('silverneedle', 'copperneedle'), sourceRevision: 2, blocks: { b1: { ...currentNote.blocks.b1, sourceRevision: 2 } } };
  const concurrentIndex = { ...liveIndex, sourceRevision: 2 };
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: concurrentNote },
    { op: 'put', store: 'block_index', value: concurrentIndex },
  ] })).status, 200);
  const staleSave = await call('POST', '/api/v1/tx', { ops: [
    ...writes,
    { op: 'check', store: 'notes', key: u1, value: observed },
  ] });
  assert.equal(staleSave.status, 409, 'remote callback observation is reasserted inside server transaction');
  assert.equal(field(staleSave.json, 'code'), 'transaction_conflict');
  assert.deepEqual((await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json, concurrentNote, 'stale save preserves concurrent source');
  await assertRollback(concurrentIndex);

  const seedOwned = { ...currentNote, seedOrigin: 'seed', sourceRevision: 3, blocks: { b1: { ...currentNote.blocks.b1, sourceRevision: 3 } } };
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: seedOwned },
    { op: 'put', store: 'block_index', value: { ...liveIndex, sourceRevision: 3 } },
  ] })).status, 200);
  const userOwned = { ...seedOwned, seedOrigin: 'user' };
  assert.equal((await call('PUT', '/api/v1/notes', { value: userOwned })).status, 200);
  const ownershipRace = await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'meta', value: { ...checkpoint, completed: true } },
    { op: 'put', store: 'notes', value: seedOwned },
    { op: 'check', store: 'notes', key: u1, value: seedOwned },
  ] });
  assert.equal(ownershipRace.status, 409, 'ownership changes reject even when sourceRevision matches');
  assert.deepEqual((await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json, userOwned);
  assert.deepEqual((await call('GET', `/api/v1/meta/get?key=${enc(checkpoint.key)}`)).json, checkpoint);
  const absentRace = await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'meta', value: { ...checkpoint, completed: true } },
    { op: 'check', store: 'notes', key: u1, value: null },
  ] });
  assert.equal(absentRace.status, 409, 'expected absence cannot replace an existing Note');
  assert.deepEqual((await call('GET', `/api/v1/meta/get?key=${enc(checkpoint.key)}`)).json, checkpoint);
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'check', store: 'notes', key: u1, value: userOwned },
    { op: 'check', store: 'notes', key: 'absent-note', value: null },
  ] })).status, 200, 'matching full row and absence pass');

  const committedSource = { ...changedNote, sourceRevision: 4, blocks: { b1: { ...changedNote.blocks.b1, sourceRevision: 4 } } };
  const committedIndex = { ...changedIndex, sourceRevision: 4 };
  const committedRevision = { ...currentRevision, version: 3, rawContent: committedIndex.rawContent, savedAt: 70 };
  const committedSession = { ...pin, id: 'committed-session', blockVersion: 3 };
  const atomicStart = await call('POST', '/api/v1/tx', { ops: [
    { op: 'check', store: 'notes', key: u1, value: userOwned },
    { op: 'put', store: 'notes', value: committedSource },
    { op: 'put', store: 'block_revisions', value: committedRevision },
    { op: 'put', store: 'block_index', value: committedIndex },
    { op: 'put', store: 'sessions', value: committedSession },
  ] });
  assert.equal(atomicStart.status, 200, String(atomicStart.json));
  assert.deepEqual((await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json, committedSource);
  assert.deepEqual((await call('GET', `/api/v1/sessions/get?key=${enc(committedSession.id)}`)).json, committedSession);
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/get?key=${enc([u1, 'b1', 3])}`)).json, committedRevision);
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'delete', store: 'notes', key: u1 },
    { op: 'put', store: 'notes', value: currentNote },
    { op: 'put', store: 'block_index', value: liveIndex },
  ] })).status, 200);

  for (const value of [
    { ...currentNote, rawContent: 42 },
    { ...currentNote, sourceRevision: 0 },
    { ...currentNote, blocks: [] },
    { ...currentNote, blocks: {} },
    { ...currentNote, blocks: { b1: currentNote.blocks.b1, b2: { ...currentNote.blocks.b1, id: 'b2' } } },
    { ...currentNote, blocks: { b1: { ...currentNote.blocks.b1, version: 0 } } },
    { ...currentNote, segmentIds: ['b1'] },
    { ...currentNote, segments: [] },
    { ...currentNote, blocks: { wrong: currentNote.blocks.b1 } },
    { ...currentNote, blocks: { b1: { ...currentNote.blocks.b1, from: -1 } } },
    { ...currentNote, blocks: { b1: { ...currentNote.blocks.b1, to: source.length + 1 } } },
    { ...currentNote, blocks: { b1: { ...currentNote.blocks.b1, sourceRevision: 2 } } },
    { ...currentNote, blocks: { b1: { ...currentNote.blocks.b1, kind: 'markdown' } } },
    { ...currentNote, blocks: { b1: { ...currentNote.blocks.b1, dialect: 'invalid' } } },
  ]) assert.equal((await call('PUT', '/api/v1/notes', { value })).status, 400, 'invalid Note source/map rejected');
  for (const value of [
    { ...currentRevision, version: 0 },
    { ...currentRevision, kind: 'markdown' },
    { ...currentRevision, rawContent: 42 },
    { ...currentRevision, savedAt: 'now' },
    { ...currentRevision, dialect: 'invalid' },
    { ...currentRevision, rawContent: 'not an actionable block' },
    { ...currentRevision, dialect: 'log' },
    { ...currentRevision, kind: 'query', dialect: undefined },
  ]) assert.equal((await call('PUT', '/api/v1/block_revisions', { value })).status, 400, 'invalid revision rejected');
  for (const op of [
    { op: 'check', store: 'notes', key: u1 },
    { op: 'check', store: 'notes', key: [], value: null },
    { op: 'check', store: 'notes', key: u1, value: 42 },
    { op: 'check', store: 'notes', key: [u1, 'extra'], value: null },
    { op: 'check', store: 'notes', key: u1, value: {} },
    { op: 'check', store: 'notes', key: u1, value: { ...currentNote, id: u2 } },
  ]) assert.equal((await call('POST', '/api/v1/tx', { ops: [op] })).status, 400, 'invalid optimistic assertion rejected');

  const actionBodies = [
    { id: 'w', kind: 'wod', rawContent: '```log:crossfit\n1 Burpee\n```', dialect: 'log', sport: 'crossfit' },
    { id: 'q', kind: 'query', rawContent: '```query:table\n:note{tag:hero}\n```' },
    { id: 'g', kind: 'widget', rawContent: '```widget:attention\nfixture tip\n```' },
    { id: 'e', kind: 'embed', rawContent: '![fixture clip](https://youtu.be/example)' },
  ] as const;
  const actionSource = actionBodies.map((block) => block.rawContent).join('\n\n');
  const actionNote = {
    ...wholeNote('action-note', 'Actionable Fixture', 1, actionSource),
    blocks: Object.fromEntries(actionBodies.map((block) => {
      const from = actionSource.indexOf(block.rawContent);
      return [block.id, { id: block.id, kind: block.kind, version: 1, sourceRevision: 1, from, to: from + block.rawContent.length,
        ...('dialect' in block ? { dialect: block.dialect, sport: block.sport } : {}),
      }];
    })),
  };
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'put', store: 'notes', value: actionNote },
    ...actionBodies.map((block) => ({ op: 'put', store: 'block_revisions', value: {
      noteId: actionNote.id, blockId: block.id, version: 1, kind: block.kind, rawContent: block.rawContent, savedAt: 1,
      ...('dialect' in block ? { dialect: block.dialect, sport: block.sport } : {}),
    } })),
    ...Object.values(actionNote.blocks).map((block) => ({ op: 'put', store: 'block_index', value: {
      id: `${actionNote.id}:${block.id}`, noteId: actionNote.id, blockId: block.id, blockVersion: 1, dataType: block.kind,
      sourceRevision: 1, from: block.from, to: block.to, rawContent: actionSource.slice(block.from, block.to), noteTitle: actionNote.title, createdAt: 1,
    } })),
  ] })).status, 200);
  for (const block of actionBodies) {
    assert.equal(matched(await q({ plan: 'blocks', filters: [
      { field: 'text', value: block.rawContent }, { field: 'type', values: [block.kind] },
    ] })), 1, `${block.kind} exact source is searchable`);
  }
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc(actionNote.id)}`)).status, 204);
  const retainedHistory = (await call('GET', `/api/v1/block_revisions/index/by-note?range=${enc(actionNote.id)}`)).json;
  assert.ok(Array.isArray(retainedHistory));
  assert.equal(retainedHistory.length, 4, 'all actionable histories survive deletion');
  const unknownFenceNote = wholeNote('unknown-fence', 'Recoverable source', 1, '```widget:not-registered\nunknown\n```\n\n```time\nunclosed');
  assert.equal((await call('PUT', '/api/v1/notes', { value: unknownFenceNote })).status, 200, 'unknown and malformed fences stay authored source');
  assert.deepEqual((await call('GET', `/api/v1/notes/get?key=${enc(unknownFenceNote.id)}`)).json, unknownFenceNote);
  assert.equal(matched(await q({ plan: 'blocks', filters: [{ field: 'text', value: 'not-registered' }] })), 0, 'unknown fences produce no block rows');
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc(unknownFenceNote.id)}`)).status, 204);

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
    { op: 'put', store: 'notes', value: { ...currentNote, title: 'Must roll back' } },
    { op: 'put', store: 'notes', value: { id: 'bad-source', noteId: 42 } },
  ] })).status, 400);
  const retainedNote = (await call('GET', `/api/v1/notes/get?key=${enc(u1)}`)).json;
  assert.ok(typeof retainedNote === 'object' && retainedNote !== null && 'title' in retainedNote);
  assert.equal(retainedNote.title, 'Fran Bench');
  // trust-boundary range/key validators: garbage fails closed, no crash
  assert.equal((await call('GET', `/api/v1/notes/all?range=${enc([])}`)).status, 400, '[] is not a range');
  assert.equal((await call('GET', `/api/v1/notes/all?range=${enc({ only: [] })}`)).status, 400, 'empty tuple key invalid');
  assert.equal((await call('GET', `/api/v1/notes/all?range=${enc({})}`)).status, 200, 'explicit unbounded range stays legal');
  const allNotes = (await call('GET', '/api/v1/notes/all?range=' + enc({}))).json;
  assert.ok(Array.isArray(allNotes));
  assert.equal(allNotes.length, 5);
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc([])}`)).status, 400);
  assert.equal((await call('DELETE', `/api/v1/notes?key=${enc({ only: [] })}`)).status, 400);
  const beforeNoMatch = field((await call('GET', '/api/v1/notes/count')).json, 'count');
  assert.equal((await call('DELETE', `/api/v1/notes?range=${enc({ lower: 'zz-none', upper: 'zz-none' })}`)).status, 204);
  assert.equal(field((await call('GET', '/api/v1/notes/count')).json, 'count'), beforeNoMatch, 'no-match delete is a no-op');
  // unknown op fails the whole tx and clears nothing
  assert.equal((await call('POST', '/api/v1/tx', { ops: [{ op: 'bogus', store: 'notes' }] })).status, 400, 'unknown op must fail, never clear');
  assert.equal((await call('POST', '/api/v1/tx', { ops: [
    { op: 'bogus', store: 'notes' },
    { op: 'put', store: 'notes', value: wholeNote('bad-op-put', 'x', 1) },
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
  assert.equal(matched(await call('POST', '/api/v1/query', { plan: 'blocks' })), 1, 'current projection survives reopen');
  assert.deepEqual(await call('GET', `/api/v1/memberships/get?key=${enc('default')}`).then((r) => r.json), member, 'membership durable');
  assert.deepEqual((await call('GET', `/api/v1/block_revisions/get?key=${enc([u1, 'b1', 3])}`)).json, committedRevision, 'saved intermediate history is durable');
  assert.deepEqual((await call('GET', `/api/v1/sessions/get?key=${enc(committedSession.id)}`)).json, committedSession, 'exact Session pin is durable');

  // dist shell symlink escape: the SPA fallback follows the same confinement
  await rm(join(dist, 'index.html'));
  await symlink(join(dir, 'secret.txt'), join(dist, 'index.html'));
  assert.equal((await call('GET', '/')).status, 404, 'symlinked shell refused');
  assert.equal((await call('GET', '/some/route')).status, 404, 'extensionless fallback refused with it');

  // Rerunnable: leave explicitly opted-in disposables empty.
  assert.equal((await call('POST', '/api/v1/wipe')).status, 204);
  assert.deepEqual(await call('GET', '/api/v1/notes/count').then((r) => r.json), { count: 0 });
  assert.deepEqual((await call('GET', '/api/v1/block_revisions/count')).json, { count: 0 }, 'explicit wipe alone removes immutable history');

  await db.close();
  process.stdout.write('check: all assertions passed\n');
}

main().catch((e) => {
  console.error('check failed:', e);
  process.exit(1);
});
