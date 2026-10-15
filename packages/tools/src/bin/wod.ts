#!/usr/bin/env node
/**
 * wod CLI Entry Point
 *
 * Dispatches to cliMain(process.argv.slice(2)).
 * Runs under Node or Bun: SQLite/Postgres/Turso commands (init, parse, run,
 * query, import, export, build, seed) run on both runtimes; server/playground
 * hosting commands require Bun.
 */

import { cliMain } from '../cli/runner';

void (async () => {
  const exitCode = await cliMain(process.argv.slice(2));
  process.exitCode = exitCode;
})();
