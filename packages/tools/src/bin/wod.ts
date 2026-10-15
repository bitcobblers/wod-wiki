#!/usr/bin/env node
/**
 * wod CLI Entry Point
 *
 * Dispatches to cliMain(process.argv.slice(2)).
 * Runs under Node or Bun: SQLite/Postgres/Turso commands (init, parse, run,
 * query, import, export, build, seed) run on both runtimes; server/playground
 * hosting commands require Bun.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
if (!isBun) {
  // If invoked via Node but Bun is installed, re-exec with Bun so server/playground work out of the box.
  const check = spawnSync('bun', ['--version'], { stdio: 'ignore' });
  if (check.status === 0) {
    const res = spawnSync('bun', ['--no-env-file', fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: 'inherit',
    });
    process.exit(res.status ?? 0);
  }
}

import { cliMain } from '../cli/runner';

void (async () => {
  const exitCode = await cliMain(process.argv.slice(2));
  process.exitCode = exitCode;
})();
