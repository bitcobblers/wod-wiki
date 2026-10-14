/** API launch. Initialize before listening; drain requests before closing. */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '@bitcobblers/wod-wiki-storage/sql/node';
import { initializeStore, initializeDomain } from '@bitcobblers/wod-wiki-storage/sql';
import { createHandler } from '@bitcobblers/wod-wiki-engine/server';

const env = (key: string): string | undefined => process.env[key]?.trim() || undefined;
const port = Number(env('PORT') ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('wod-wiki-api: PORT must be an integer 1..65535');
}
const host = env('HOST') ?? '127.0.0.1';
const projectRoot = resolve(import.meta.dir, '../../..');
const playgroundDist = resolve(projectRoot, env('PLAYGROUND_DIST') ?? 'apps/playground/dist-api');
if (!existsSync(resolve(playgroundDist, 'index.html'))) {
  throw new Error(`wod-wiki-api: playground build not found at ${playgroundDist}; run bun run build:server`);
}
const db = await openDatabase({
  ...process.env,
  ...(env('DATABASE_URL') ? {} : { SQLITE_PATH: resolve(projectRoot, env('SQLITE_PATH') ?? 'data/wodwiki.db') }),
});

let server: Bun.Server<never>;
try {
  await initializeStore(db);
  await initializeDomain(db);
  server = Bun.serve({ port, hostname: host, fetch: createHandler(db, { playgroundDist }) });
} catch (error) {
  await db.close();
  throw error;
}
console.error(`[wod-wiki-api] listening on http://${host}:${port} driver=${db.dialect} dist=${playgroundDist}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) process.exit(0);
  closing = true;
  try {
    await server.stop();
  } finally {
    await db.close();
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
