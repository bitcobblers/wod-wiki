/**
 * index.ts — actual server launch: validate env/dist, open the database and
 * finish BOTH initializations (store schema + domain projections) before the
 * socket accepts a single request, then serve. SIGINT/SIGTERM drain and close.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database';
import { initializeStore, initializeDomain } from '@bitcobblers/wod-wiki-storage/sql';
import { createHandler } from './app';

const raw = (k: string): string | undefined => process.env[k];
/** Present-but-empty env values (compose passthroughs) read as unset. */
const env = (k: string): string | undefined => {
  const v = raw(k)?.trim();
  return v ? v : undefined;
};

const port = Number(env('PORT') ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`wod-wiki-api: invalid PORT ${JSON.stringify(raw('PORT'))} (need integer 1..65535)`);
}
const host = env('HOST') ?? '127.0.0.1';
// Server-build playground output lives beside the API workspace, independent
// of process cwd (root's start:server delegates --cwd apps/api).
const projectRoot = resolve(import.meta.dir, '../../..');
const playgroundDist = resolve(projectRoot, env('PLAYGROUND_DIST') ?? 'apps/playground/dist-api');
if (!existsSync(playgroundDist)) {
  throw new Error(
    `wod-wiki-api: playground dist not found at ${playgroundDist} — build the server bundle or set PLAYGROUND_DIST`,
  );
}

const db = await openDatabase({
  ...process.env,
  ...(env('DATABASE_URL') ? {} : { SQLITE_PATH: resolve(projectRoot, env('SQLITE_PATH') ?? 'data/wodwiki.db') }),
});
await initializeStore(db);
await initializeDomain(db);

const server = Bun.serve({
  port,
  hostname: host,
  fetch: createHandler(db, { playgroundDist }),
});
console.error(`[wod-wiki-api] listening on http://${host}:${port} driver=${db.dialect} dist=${playgroundDist}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) process.exit(0); // second signal forces the exit
  closing = true;
  // Drain in-flight requests BEFORE closing the client, or queued writes drop.
  await server.stop();
  try {
    await db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
