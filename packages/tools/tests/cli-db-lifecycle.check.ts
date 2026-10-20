/**
 * Acceptance check for `wod db` lifecycle (run AFTER `bun run build:storage`):
 *
 *   bun packages/tools/tests/cli-db-lifecycle.check.ts
 *
 * Real local SQLite databases + a fake Turso Management API served through
 * the injected fetch seam — no live credentials. Exits 0 on success, prints
 * the first failed assertion otherwise.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { DB_VERSION } from '@bitcobblers/wod-wiki-storage';
import {
  applySyncBatch,
  databaseFingerprint,
  finalizeMigrationTarget,
  initSyncTarget,
  initializeStore,
  libsqlDatabase,
  probeSyncTarget,
  SCHEMA_TABLE,
} from '@bitcobblers/wod-wiki-storage/sql';
import { appendTursoEnv, runDbCommand } from '../src/cli/dbAdmin';
import { cliMain } from '../src/index';

const tmp = mkdtempSync(join(tmpdir(), 'wod-db-lifecycle-'));
const ENV = { TURSO_API_TOKEN: 'mgmt-secret-token', TURSO_ORGANIZATION: 'org' };
const fileFor = (hostname: string): string => join(tmp, hostname);
const urlFor = (hostname: string): string => `file:${fileFor(hostname)}`;

interface Entry { hostname: string; group: string; file: string }

function fakeManagement(databases: Map<string, Entry>) {
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown>; query: string }> = [];
  const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
  const copyRows = async (source: Entry, target: Entry): Promise<void> => {
    const src = createClient({ url: `file:${source.file}` });
    const dst = createClient({ url: `file:${target.file}` });
    try {
      const tables = await src.execute(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`);
      for (const table of tables.rows) {
        const name = String(table.name);
        await dst.execute(String(table.sql));
        const rows = await src.execute(`SELECT * FROM ${ident(name)}`);
        for (const row of rows.rows) {
          const cols = rows.columns;
          await dst.execute({
            sql: `INSERT INTO ${ident(name)} (${cols.map(ident).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            args: cols.map((c) => row[c] as never),
          });
        }
      }
    } finally {
      src.close();
      dst.close();
    }
  };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const respond = (status: number, payload: unknown): Response =>
      new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'POST' && url.pathname.endsWith('/databases')) {
      const name = String(body?.name);
      requests.push({ method, path: url.pathname, body, query: url.search });
      if (databases.has(name)) return respond(409, { error: `database with name [${name}] already exists` });
      const entry: Entry = { hostname: `${name}.example.turso.io`, group: String(body?.group), file: fileFor(`${name}.example.turso.io`) };
      rmSync(entry.file, { force: true });
      databases.set(name, entry);
      const seed = body?.seed as { type?: string; name?: string } | undefined;
      if (seed?.type === 'database') await copyRows(databases.get(String(seed.name)) as Entry, entry);
      else (createClient({ url: `file:${entry.file}` })).close();
      return respond(200, { database: { Name: name, DbId: `id-${name}`, Hostname: entry.hostname, group: entry.group } });
    }
    const match = url.pathname.match(/\/databases\/([^/]+)(\/.*)?$/);
    const name = match ? decodeURIComponent(match[1]) : '';
    const sub = match?.[2] ?? '';
    if (method === 'GET' && sub === '') {
      const entry = databases.get(name);
      return entry ? respond(200, { database: { Name: name, DbId: `id-${name}`, Hostname: entry.hostname, group: entry.group } }) : respond(404, { error: `Database ${name} not found` });
    }
    if (method === 'POST' && sub === '/auth/tokens') {
      requests.push({ method, path: url.pathname, query: url.search });
      const authorization = url.searchParams.get('authorization') ?? 'full-access';
      return respond(200, { jwt: `tok-${name}-${authorization}` });
    }
    if (method === 'DELETE' && sub === '') {
      requests.push({ method, path: url.pathname, query: url.search });
      databases.delete(name);
      rmSync(fileFor(databases.get(name)?.hostname ?? `${name}.example.turso.io`), { force: true });
      return respond(200, { database: name });
    }
    return respond(404, { error: `no fake route for ${method} ${url.pathname}` });
  }) as typeof fetch;
  return { requests, fetchFn };
}

async function openDb(file: string) {
  return libsqlDatabase(createClient({ url: `file:${file}` }));
}

const SESSION_ROW = {
  id: 'session-1', noteId: 'note-1', blockId: 'block-1', blockVersion: 1, status: 'completed',
  startTime: 1, endTime: 2, duration: 1, roundsCompleted: 1, totalRounds: 1, repsCompleted: 5,
  completed: true, createdAt: 2,
};

/** Current sync-protocol source at `schemaVersion` with a pinned session and
 * a binary attachment — the shapes migrate/pair must preserve exactly. */
async function makeCurrentSource(databases: Map<string, Entry>, name: string, schemaVersion: number, opts: { omitRevision?: boolean } = {}): Promise<void> {
  const entry: Entry = { hostname: `${name}.example.turso.io`, group: 'g1', file: fileFor(`${name}.example.turso.io`) };
  rmSync(entry.file, { force: true });
  databases.set(name, entry);
  const db = await openDb(entry.file);
  const rawContent = '```time\n5 push-up\n```';
  await initSyncTarget(db, schemaVersion);
  const ops: Parameters<typeof applySyncBatch>[1][number]['ops'] = [
    { op: 'put', store: 'notes', key: 'note-1', value: { id: 'note-1', title: 'Hello', rawContent, sourceRevision: 1, date: 1, createdAt: 1, blocks: { 'block-1': { id: 'block-1', version: 1, kind: 'wod', from: 0, to: rawContent.length, dialect: 'time' } } } },
    { op: 'put', store: 'sessions', key: 'session-1', value: SESSION_ROW },
    { op: 'put', store: 'attachments', key: 'attachment-1', value: { id: 'attachment-1', noteId: 'note-1', createdAt: 3, data: new Uint8Array([0, 255, 1, 254, 128, 7]).buffer } },
  ];
  if (!opts.omitRevision) {
    ops.splice(1, 0, { op: 'put', store: 'block_revisions', key: ['note-1', 'block-1', 1], value: { noteId: 'note-1', blockId: 'block-1', version: 1, kind: 'wod', rawContent, dialect: 'time', savedAt: 1 } });
  }
  await applySyncBatch(db, [{ id: 'group-1', at: 1000, ops }]);
  await db.close();
}

async function makeLegacySource(databases: Map<string, Entry>, name: string): Promise<void> {
  const entry: Entry = { hostname: `${name}.example.turso.io`, group: 'g1', file: fileFor(`${name}.example.turso.io`) };
  databases.set(name, entry);
  const db = await openDb(entry.file);
  await initializeStore(db);
  await db.exec(`UPDATE ${JSON.stringify(SCHEMA_TABLE).replace(/"/g, '"')} SET "value" = ? WHERE "key" = 'schema'`, [JSON.stringify({ version: DB_VERSION - 1 })]);
  await db.close();
}

const io = (out: string[], err: string[]) => ({ stdout: (t: string): void => void out.push(t), stderr: (t: string): void => void err.push(t) });
const depsOf = (fake: { fetchFn: typeof fetch }, hooks: { midCopyHook?: (copyName: string) => Promise<void>; now?: () => Date } = {}) =>
  ({ fetchFn: fake.fetchFn, databaseUrl: urlFor, ...hooks });

async function main(): Promise<void> {
  // 1. create: fresh empty target + secure pairing file
  {
    const dbs = new Map<string, Entry>();
    const fake = fakeManagement(dbs);
    const out: string[] = [];
    const pair = join(tmp, 'pair-create.json');
    await runDbCommand({ action: 'create', group: 'g1', output: pair, env: ENV }, io(out, []), depsOf(fake));
    const createReq = fake.requests.find((r) => r.method === 'POST' && r.body?.name === `wod-wiki-v${DB_VERSION}`);
    assert.ok(createReq, 'create POST recorded');
    assert.equal(createReq.body?.group, 'g1');
    assert.equal(createReq.body?.seed, undefined, 'create must NOT seed');
    assert.ok(fake.requests.some((r) => r.path.endsWith('/auth/tokens') && r.query.includes('authorization=full-access')), 'client token minted');
    const pairing = JSON.parse(readFileSync(pair, 'utf8')) as Record<string, unknown>;
    assert.equal(pairing.wodWikiPairing, 1);
    assert.equal(pairing.kind, 'turso');
    assert.equal(pairing.url, `libsql://wod-wiki-v${DB_VERSION}.example.turso.io`);
    assert.equal(pairing.database, `wod-wiki-v${DB_VERSION}`);
    assert.equal(pairing.schemaVersion, DB_VERSION);
    assert.equal(statSync(pair).mode & 0o777, 0o600, 'pairing file is owner-only');
    assert.ok(!out.join('\n').includes('tok-'), 'token never printed');
    // existing pairing file refused; --force replaces atomically at 0600
    await assert.rejects(
      runDbCommand({ action: 'create', dbName: 'other-target', group: 'g1', output: pair, env: ENV }, io(out, []), depsOf(fake)),
      /refusing to overwrite/,
    );
    await runDbCommand({ action: 'create', dbName: 'third-target', group: 'g1', output: pair, force: true, env: ENV }, io(out, []), depsOf(fake));
    assert.equal(statSync(pair).mode & 0o777, 0o600, 'force keeps 0600');
  }

  // 2. pair classification: legacy / constructing marker / newer / empty / current+pins
  {
    const dbs = new Map<string, Entry>();
    const fake = fakeManagement(dbs);
    const deps = depsOf(fake);
    await makeLegacySource(dbs, 'legacy-db');
    await assert.rejects(
      runDbCommand({ action: 'pair', name: 'legacy-db', output: join(tmp, 'p1.json'), env: ENV }, io([], []), deps),
      /legacy/,
    );
    await makeCurrentSource(dbs, 'constructing', 0);
    await assert.rejects(
      runDbCommand({ action: 'pair', name: 'constructing', output: join(tmp, 'p2.json'), env: ENV }, io([], []), deps),
      /incomplete/,
    );
    await makeCurrentSource(dbs, 'newer-db', DB_VERSION + 1);
    await assert.rejects(
      runDbCommand({ action: 'pair', name: 'newer-db', output: join(tmp, 'p3.json'), env: ENV }, io([], []), deps),
      /newer/,
    );
    const emptyEntry: Entry = { hostname: 'empty-db.example.turso.io', group: 'g1', file: fileFor('empty-db.example.turso.io') };
    dbs.set('empty-db', emptyEntry);
    (createClient({ url: `file:${emptyEntry.file}` })).close();
    await assert.rejects(
      runDbCommand({ action: 'pair', name: 'empty-db', output: join(tmp, 'p4.json'), env: ENV }, io([], []), deps),
      /empty/,
    );
    await runDbCommand({ action: 'pair', name: 'empty-db', allowEmpty: true, output: join(tmp, 'p4.json'), env: ENV }, io([], []), deps);
    await makeCurrentSource(dbs, 'unpinned', DB_VERSION, { omitRevision: true });
    await assert.rejects(
      runDbCommand({ action: 'pair', name: 'unpinned', output: join(tmp, 'p5.json'), env: ENV }, io([], []), deps),
      /pins/,
    );
    await makeCurrentSource(dbs, 'good', DB_VERSION);
    await runDbCommand({ action: 'pair', name: 'good', output: join(tmp, 'p6.json'), env: ENV }, io([], []), deps);
    assert.equal(JSON.parse(readFileSync(join(tmp, 'p6.json'), 'utf8')).schemaVersion, DB_VERSION);
  }

  // 3. backup: native copy verified (incl. binary), tamper + source-move refusal
  {
    const dbs = new Map<string, Entry>();
    const fake = fakeManagement(dbs);
    const now = (): Date => new Date('2026-10-19T00:00:00Z');
    await makeCurrentSource(dbs, 'src-db', DB_VERSION);
    const out: string[] = [];
    await runDbCommand({ action: 'backup', name: 'src-db', writersRetired: true, output: join(tmp, 'b.json'), env: ENV }, io(out, []), depsOf(fake, { now }));
    const seedReq = fake.requests.find((r) => r.method === 'POST' && r.body?.seed);
    const copyName = String(seedReq?.body?.name);
    assert.match(copyName, /^[a-z0-9][a-z0-9-]{0,63}$/, 'generated backup name is accepted by Turso');
    assert.deepEqual(seedReq?.body?.seed, { type: 'database', name: 'src-db' });
    const [srcFp, copyFp] = await Promise.all([
      databaseFingerprint(await openDb(dbs.get('src-db')!.file)),
      databaseFingerprint(await openDb(dbs.get(copyName)!.file)),
    ]);
    assert.equal(srcFp.digest, copyFp.digest, 'copy is byte-identical (digest)');
    assert.ok(out.join('\n').includes('verified'));
    const backupPairing = JSON.parse(readFileSync(join(tmp, 'b.json'), 'utf8'));
    assert.match(backupPairing.authToken, /-read-only$/, 'current-schema backup credentials cannot mutate the archive');
    assert.ok(!fake.requests.some((r) => r.path.endsWith('/auth/tokens') && r.path.includes(copyName) && r.query.includes('authorization=full-access')), 'backup never mints full-access credentials');
    const copyDb = await openDb(dbs.get(copyName)!.file);
    const replayed = await (await import('@bitcobblers/wod-wiki-storage/sql')).fetchSyncOps(copyDb, 0, 1000);
    const attachment = replayed.map((op) => op.mutation).find((m) => m.op === 'put' && m.store === 'attachments');
    assert.ok(attachment && attachment.op === 'put');
    const copiedAttachment = attachment.value;
    assert.ok(copiedAttachment !== null && typeof copiedAttachment === 'object' && 'data' in copiedAttachment && copiedAttachment.data instanceof ArrayBuffer);
    assert.deepEqual(new Uint8Array(copiedAttachment.data), new Uint8Array([0, 255, 1, 254, 128, 7]), 'binary fidelity');
    await copyDb.close();
    // tampered copy refused
    const dbs2 = new Map<string, Entry>();
    const fake2 = fakeManagement(dbs2);
    await makeCurrentSource(dbs2, 'src-db', DB_VERSION);
    await assert.rejects(
      runDbCommand({ action: 'backup', name: 'src-db', writersRetired: true, output: join(tmp, 'b2.json'), env: ENV }, io([], []), {
        ...depsOf(fake2, { now }),
        midCopyHook: async (name) => {
          const c = createClient({ url: urlFor(dbs2.get(name)!.hostname) });
          await c.execute(`DELETE FROM "_wodwiki_sync_ops" WHERE rowid IN (SELECT rowid FROM "_wodwiki_sync_ops" LIMIT 1)`);
          c.close();
        },
      }),
      /incomplete or divergent/,
    );
    // concurrent source writer refused
    const dbs3 = new Map<string, Entry>();
    const fake3 = fakeManagement(dbs3);
    await makeCurrentSource(dbs3, 'src-db', DB_VERSION);
    await assert.rejects(
      runDbCommand({ action: 'backup', name: 'src-db', writersRetired: true, output: join(tmp, 'b3.json'), env: ENV }, io([], []), {
        ...depsOf(fake3, { now }),
        midCopyHook: async () => {
          const s = await openDb(dbs3.get('src-db')!.file);
          await applySyncBatch(s, [{ id: 'late-group', at: 2, ops: [{ op: 'put', store: 'meta', key: 'late', value: { key: 'late', value: 'x' } }] }]);
          await s.close();
        },
      }),
      /source database changed/,
    );
    // acknowledgment required + same-name restore refused + legacy archive not paired
    await assert.rejects(
      runDbCommand({ action: 'backup', name: 'src-db', output: join(tmp, 'b4.json'), env: ENV }, io([], []), depsOf(fake3, { now })),
      /--writers-retired/,
    );
    await assert.rejects(
      runDbCommand({ action: 'restore', name: 'src-db', dbName: 'src-db', writersRetired: true, output: join(tmp, 'b5.json'), env: ENV }, io([], []), depsOf(fake3, { now })),
      /NEW database/,
    );
    const dbs4 = new Map<string, Entry>();
    const fake4 = fakeManagement(dbs4);
    await makeLegacySource(dbs4, 'old-db');
    const out4: string[] = [];
    await runDbCommand({ action: 'backup', name: 'old-db', writersRetired: true, output: join(tmp, 'b6.json'), env: ENV }, io(out4, []), depsOf(fake4, { now }));
    assert.ok(out4.join('\n').includes('NOT pairable'));
    const archivePairing = JSON.parse(readFileSync(join(tmp, 'b6.json'), 'utf8')) as Record<string, unknown>;
    assert.match(String(archivePairing.authToken), /^tok-.*-read-only$/, 'archive pairing is read-only');
    assert.equal(archivePairing.schemaVersion, 0, 'legacy archive reports no sync schema');
    assert.ok(!out4.join('\n').includes('wrote .env') && !fake4.requests.some((r) => r.path.endsWith('/auth/tokens') && r.query.includes('authorization=full-access')), 'archive never mints full-access');
  }

  // 4. migrate: legacy/current source → fresh target at DB_VERSION, source retained
  {
      const dbs = new Map<string, Entry>();
      const fake = fakeManagement(dbs);
      await makeCurrentSource(dbs, 'old-live', DB_VERSION - 1);
      const sourceBefore = await databaseFingerprint(await openDb(dbs.get('old-live')!.file));
      const out: string[] = [];
      await runDbCommand({ action: 'migrate', name: 'old-live', writersRetired: true, output: join(tmp, 'm.json'), env: ENV }, io(out, []), depsOf(fake));
      const targetName = `old-live-v${DB_VERSION}`;
      assert.ok(dbs.has(targetName), 'fresh migration target provisioned');
      const targetDb = await openDb(dbs.get(targetName)!.file);
      assert.deepEqual(await probeSyncTarget(targetDb), { kind: 'current', schemaVersion: DB_VERSION, rev: 1 }, 'target finalized at current schema');
      const replayed = await (await import('@bitcobblers/wod-wiki-storage/sql')).fetchSyncOps(targetDb, 0, 1000);
      assert.ok(replayed.length >= 4, 'snapshot replayed');
      const attachment = replayed.map((op) => op.mutation).find((m) => m.op === 'put' && m.store === 'attachments');
      assert.ok(attachment && attachment.op === 'put');
      const migratedAttachment = attachment.value;
      assert.ok(migratedAttachment !== null && typeof migratedAttachment === 'object' && 'data' in migratedAttachment && migratedAttachment.data instanceof ArrayBuffer);
      assert.deepEqual(new Uint8Array(migratedAttachment.data), new Uint8Array([0, 255, 1, 254, 128, 7]));
      await targetDb.close();
      const sourceAfter = await databaseFingerprint(await openDb(dbs.get('old-live')!.file));
      assert.equal(sourceBefore.digest, sourceAfter.digest, 'source never mutated');
      assert.ok(out.join('\n').includes('source retained'));
      assert.equal(JSON.parse(readFileSync(join(tmp, 'm.json'), 'utf8')).schemaVersion, DB_VERSION);
      await assert.rejects(
        runDbCommand({ action: 'migrate', name: 'old-live', writersRetired: true, output: join(tmp, 'm2.json'), env: ENV }, io([], []), depsOf(fake)),
        /already exists/,
      );
  }

  // 5. finalize CAS: schema-0 marker → live schema exactly once
  {
    const file = join(tmp, 'finalize.example.turso.io');
    (createClient({ url: `file:${file}` })).close();
    const db = await openDb(file);
    await initSyncTarget(db, 0);
    await applySyncBatch(db, [{ id: 'g', at: 1, ops: [{ op: 'put', store: 'meta', key: 'k', value: { key: 'k', value: 'v' } }] }]);
    await assert.rejects(finalizeMigrationTarget(db, DB_VERSION, 2), /not in constructing/);
    await finalizeMigrationTarget(db, DB_VERSION, 1);
    assert.deepEqual(await probeSyncTarget(db), { kind: 'current', schemaVersion: DB_VERSION, rev: 1 });
    await assert.rejects(finalizeMigrationTarget(db, DB_VERSION, 1), /not in constructing/);
    await db.close();
  }

  // 6. delete via the real CLI path: exact confirmation, then deletion
  {
    const dbs = new Map<string, Entry>();
    const fake = fakeManagement(dbs);
    dbs.set('doomed', { hostname: 'doomed.example.turso.io', group: 'g1', file: fileFor('doomed.example.turso.io') });
    (createClient({ url: `file:${fileFor('doomed.example.turso.io')}` })).close();
    const managementEnv = join(tmp, 'management.env');
    writeFileSync(managementEnv, `TURSO_API_TOKEN=${ENV.TURSO_API_TOKEN}\nTURSO_ORGANIZATION=${ENV.TURSO_ORGANIZATION}\n`, { mode: 0o600 });
    const errs: string[] = [];
    const code1 = await cliMain(['db', 'delete', 'doomed', '--yes', 'other', '--env-file', managementEnv], { stdout: (): void => undefined, stderr: (t) => void errs.push(t), dbDeps: depsOf(fake) });
    assert.equal(code1, 1);
    assert.ok(dbs.has('doomed'), 'mismatched confirmation deletes nothing');
    const code2 = await cliMain(['db', 'delete', 'doomed', '--yes', 'doomed', '--env-file', managementEnv], { stdout: (): void => undefined, stderr: (t) => void errs.push(t), dbDeps: depsOf(fake) });
    assert.equal(code2, 0, errs.join('\n'));
    assert.ok(!dbs.has('doomed'), 'exact confirmation deletes');
    const code3 = await cliMain(['db', 'nonsense'], { stdout: (): void => undefined, stderr: (t) => void errs.push(t) });
    assert.equal(code3, 1);
    assert.ok(errs.join('\n').includes('wod db'), 'usage error mentions the action namespace');
  }

  // 7. opt-in .env merge: preserves unrelated lines, refuses conflicting selectors
  {
    const envFile = join(tmp, 'merge.env');
    writeFileSync(envFile, 'OTHER=1\n# keep\n', 'utf8');
    appendTursoEnv(envFile, { url: 'libsql://x.example.turso.io', authToken: 't0k' }, new Date(0));
    const content = readFileSync(envFile, 'utf8');
    assert.ok(content.startsWith('OTHER=1\n# keep\n'), 'unrelated settings preserved');
    assert.ok(content.includes('DB_DRIVER=turso') && content.includes('TURSO_DATABASE_URL=libsql://x.example.turso.io'));
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
    assert.throws(() => appendTursoEnv(envFile, { url: 'libsql://y', authToken: 't' }, new Date(0)), /conflicting database selectors/);
    const conflicting = join(tmp, 'conflict.env');
    writeFileSync(conflicting, 'DATABASE_URL=postgres://h/db\n', 'utf8');
    assert.throws(() => appendTursoEnv(conflicting, { url: 'libsql://y', authToken: 't' }, new Date(0)), /conflicting database selectors/);
  }

  console.log('wod db lifecycle checks passed');
}

main()
  .then(() => rmSync(tmp, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  });
