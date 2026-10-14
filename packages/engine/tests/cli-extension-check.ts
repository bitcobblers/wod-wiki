#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = resolve(root, 'packages/engine/dist/bin/wod.mjs');
const directory = mkdtempSync(join(tmpdir(), 'wod-cli-check-'));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(DB_DRIVER|DATABASE_URL|SQLITE_PATH|WOD_WIKI_DB|LIBSQL_AUTH_TOKEN|POSTGRES_|TURSO_|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSSLMODE)/.test(key)) delete env[key];
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
  const missing = command(['serve', '--db', 'missing.db', '--dist', join(root, 'apps/playground/dist-api')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /wod init/);
  assert.equal(existsSync(join(directory, 'missing.db')), false, 'serve must not silently create a database');
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
  console.log('PASS: dotenv, process/flag precedence, saved notes/metrics, exported-file queries, init preservation, serve readiness and safe reset.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
