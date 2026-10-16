#!/usr/bin/env node
/**
 * wod CLI Entry Point
 *
 * Dispatches to cliMain(process.argv.slice(2)).
 * Runs under Node (v18+) or Bun across all subcommands, including server and playground.
 */
import { cliMain } from '../cli/runner';

void (async () => {
  const exitCode = await cliMain(process.argv.slice(2));
  process.exitCode = exitCode;
})();
