#!/usr/bin/env -S bun --no-env-file
/**
 * wod CLI Entry Point
 *
 * Dispatches to cliMain(process.argv.slice(2)).
 * Runs natively under Bun (shebang; --no-env-file keeps .env loading in the
 * CLI's own loader so flag > process env > .env precedence stays in one place)
 * and as a compiled node binary after tsup bundle (explicit
 * `node dist/bin/wod.mjs …` remains supported for SQLite/Turso on Node;
 * serve/playground require Bun).
 */

import { cliMain } from '../cli/runner';

void (async () => {
  const exitCode = await cliMain(process.argv.slice(2));
  process.exitCode = exitCode;
})();
