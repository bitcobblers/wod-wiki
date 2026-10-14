#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const distribution = resolve(root, 'packages/engine/dist');
const directory = mkdtempSync(join(tmpdir(), 'wod-cli-check-'));
cpSync(distribution, join(directory, 'dist'), { recursive: true });
cpSync(resolve(root, 'packages/engine/package.json'), join(directory, 'package.json'));
symlinkSync(resolve(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
const cli = join(directory, 'dist/bin/wod.mjs');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(DB_DRIVER|DATABASE_URL|SQLITE_PATH|WOD_WIKI_DB|LIBSQL_AUTH_TOKEN|POSTGRES_|TURSO_|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSSLMODE|HOST$|PORT$|PLAYGROUND_DIST$)/.test(key)) delete env[key];
}
function command(args: string[], extraEnv: Record<string, string> = {}, runtime = 'bun') {
  const result = spawnSync(runtime, [...(runtime === 'bun' ? ['--no-env-file'] : []), cli, ...args], { cwd: directory, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { code: result.status, out: result.stdout, err: result.stderr };
}
function succeeds(args: string[], extraEnv: Record<string, string> = {}, runtime = 'bun') {
  const result = command(args, extraEnv, runtime);
  assert.equal(result.code, 0, `${args.join(' ')}\n${result.err}`);
  return result.out;
}
function query(args: string[], extraEnv: Record<string, string> = {}) {
  return JSON.parse(succeeds(['query', ':note{}', ...args], extraEnv)).data;
}
const metricValues = (series: { key: string; unit: string; points: { value: number }[] }[]) =>
  series.map(({ key, unit, points }) => ({ key, unit, values: points.map(({ value }) => value) }));
async function hosted(mode: 'server' | 'serve' | 'playground', check: (url: string) => Promise<void>) {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  const child = spawn('bun', ['--no-env-file', cli, mode, '--host', '127.0.0.1', '--port', String(port)], {
    cwd: directory,
    env: { ...env, ...(mode === 'playground' ? { DB_DRIVER: 'invalid' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${mode} startup timed out: ${output}`)), 15_000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes(`http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${mode} exited ${code}: ${output}`)); });
    });
    const url = `http://127.0.0.1:${port}`;
    const shell = await fetch(url).then((response) => response.text());
    const assetPath = /<script[^>]+src="([^"]+)"/.exec(shell)?.[1];
    assert.ok(assetPath, 'packaged HTML must load its application script');
    const asset = await fetch(new URL(assetPath, url));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
    assert.equal(await fetch(`${url}/journal`).then((response) => response.text()), shell, 'SPA routes load the same app');
    await check(url);
  } finally {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
    }
  }
}
const workout = '# CLI saved workout\n\n```time\n5 push-up\n```\n';
try {
  writeFileSync(join(directory, 'workout.md'), workout);
  writeFileSync(join(directory, '.env'), 'WOD_WIKI_DB=dotenv.db\n');
  succeeds(['init'], {}, 'node');
  assert.equal(existsSync(join(directory, 'dotenv.db')), true);
  succeeds(['parse', 'workout.md']);
  const saved = query([]).notes;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].rawContent, workout);
  succeeds(['init']);
  assert.deepEqual(query([]).notes, saved, 'init must preserve authored notes');
  succeeds(['init'], { WOD_WIKI_DB: 'process.db' });
  assert.equal(existsSync(join(directory, 'process.db')), true, 'process environment overrides .env');
  succeeds(['init', '--db', 'flag.db'], { DB_DRIVER: 'turso', DATABASE_URL: 'libsql://unreachable.invalid', LIBSQL_AUTH_TOKEN: 'secret-token' });
  assert.equal(existsSync(join(directory, 'flag.db')), true, '--db selects SQLite over remote env');
  writeFileSync(join(directory, 'custom.env'), 'SQLITE_PATH=custom.db\n');
  succeeds(['init', '--env-file', 'custom.env']);
  assert.equal(existsSync(join(directory, 'custom.db')), true);
  const metrics = join(directory, 'metrics.json');
  const run = succeeds(['run', 'workout.md', '--output', metrics]);
  const sessionId = /session ([0-9a-f-]+)/.exec(run)?.[1];
  assert.ok(sessionId, run);
  const csv = succeeds(['download', 'session', sessionId, '--output', '-']);
  assert.match(csv, /push-up/);
  const databaseMetrics = JSON.parse(succeeds(['query', 'sum:rep{} by {effort}'])).data;
  assert.deepEqual(JSON.parse(succeeds(['query', 'sum:rep{} by {effort}', '--corpus', metrics], { DB_DRIVER: 'invalid' })).data.series, databaseMetrics.series);
  assert.equal(JSON.parse(readFileSync(metrics, 'utf8')).kind, 'execution-log');
  const missing = command(['server', '--db', 'missing.db']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /wod init/);
  assert.equal(existsSync(join(directory, 'missing.db')), false, 'server must not silently create a database');
  const malformed = command(['init', '--postgres-port', 'not-a-port']);
  assert.equal(malformed.code, 1);
  assert.match(malformed.err, /port/i);
  const conflict = command(['init', '--db', 'conflict.db', '--turso-url', 'libsql://unreachable.invalid']);
  assert.equal(conflict.code, 1);
  assert.equal(existsSync(join(directory, 'conflict.db')), false);
  const reset = command(['reset', '--turso-url', 'libsql://unreachable.invalid', '--turso-auth-token', 'secret-token']);
  assert.equal(reset.code, 1);
  assert.doesNotMatch(reset.out + reset.err, /secret-token/);
  const playground = command(['playground', '--port', 'invalid'], { DB_DRIVER: 'invalid' });
  assert.equal(playground.code, 1);
  assert.match(playground.err, /port/i, 'playground must not resolve an unused database');
  await hosted('server', async (url) => {
    assert.deepEqual(await fetch(`${url}/api/health`).then((response) => response.json()), { ok: true, driver: 'sqlite' });
    const note = await fetch(`${url}/api/v1/notes/get?key=${encodeURIComponent(JSON.stringify(saved[0].id))}`).then((response) => response.json());
    assert.deepEqual(note, saved[0], 'packaged API reads the CLI database');
    assert.deepEqual(await fetch(`${url}/api/v1/sessions/count`).then((response) => response.json()), { count: 1 });
  });
  await hosted('serve', async (url) => {
    assert.deepEqual(await fetch(`${url}/api/v1/notes/all`).then((response) => response.json()), saved, 'same database survives server restart');
  });
  await hosted('playground', async (url) => {
    assert.equal((await fetch(`${url}/api/health`)).status, 404);
    assert.equal((await fetch(`${url}/api/v1/notes/all`)).status, 404);
  });
  const missingDist = command(['server', '--dist', 'missing-app']);
  assert.equal(missingDist.code, 1);
  assert.match(missingDist.err, /index\.html/);
  for (const [name, url, flags] of [
    ['postgres', process.env.WOD_CLI_CHECK_POSTGRES_URL, ['--db-driver', 'postgres', '--database-url']],
    ['turso', process.env.WOD_CLI_CHECK_TURSO_URL, ['--turso-url']],
  ] as const) {
    if (!url) continue;
    const endpoint = new URL(url);
    const database = name === 'postgres'
      ? ['--postgres-host', endpoint.hostname, '--postgres-port', endpoint.port || '5432', '--postgres-user', decodeURIComponent(endpoint.username), '--postgres-password', decodeURIComponent(endpoint.password), '--postgres-database', `wod_cli_${process.pid}`, '--postgres-ssl', 'disable']
      : [...flags, url];
    if (name === 'turso' && process.env.WOD_CLI_CHECK_TURSO_TOKEN) database.push('--turso-auth-token', process.env.WOD_CLI_CHECK_TURSO_TOKEN);
    succeeds(['init', ...database]);
    succeeds(['parse', 'workout.md', ...database]);
    assert.equal(query(database).notes.some((note: { rawContent: string }) => note.rawContent === workout), true);
    const remoteRun = succeeds(['run', 'workout.md', ...database]);
    const remoteSession = /session ([0-9a-f-]+)/.exec(remoteRun)?.[1];
    assert.ok(remoteSession, remoteRun);
    assert.match(succeeds(['download', 'session', remoteSession, '--output', '-', ...database]), /push-up/);
    assert.deepEqual(metricValues(JSON.parse(succeeds(['query', `sum:rep{result:${remoteSession}} by {effort}`, ...database])).data.series), metricValues(databaseMetrics.series));
    succeeds(['init', ...database]);
    assert.equal(query(database).notes.some((note: { rawContent: string }) => note.rawContent === workout), true);
    console.log(`PASS: ${name} CLI persistence, metrics, query and non-destructive init.`);
  }
  console.log('PASS: relocated packaged hosting, server restart persistence, playground without a database, dotenv precedence, saved notes/metrics, exported-file queries, init preservation and safe reset.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
