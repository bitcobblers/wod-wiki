#!/usr/bin/env bun
/**
 * Standalone Bun HTTP server launcher for the `playwright.api.config.ts` suite.
 *
 * Boots a fresh disposable SQLite database in `os.tmpdir()`, initializes the
 * SQL store + domain read-model projections, mounts `createHandler` serving
 * `apps/playground/dist-api` (`VITE_STORAGE=api`), and self-checks both
 * `/api/health` and `/seed/core/manifest.json` before accepting E2E traffic.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase } from '@bitcobblers/wod-wiki-storage/sql/node';
import { initializeDomain, initializeStore } from '@bitcobblers/wod-wiki-storage/sql';
import { createHandler } from '@bitcobblers/wod-wiki-tools/server';

const host = process.env.API_E2E_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.API_E2E_PORT?.trim() || '4190');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`[apiServerLauncher] API_E2E_PORT must be an integer 1..65535 (got "${process.env.API_E2E_PORT ?? ''}")`);
}

const projectRoot = resolve(import.meta.dirname, '../..');
const playgroundDist = resolve(projectRoot, process.env.PLAYGROUND_DIST?.trim() || 'apps/playground/dist-api');
if (!existsSync(resolve(playgroundDist, 'index.html'))) {
  throw new Error(
    `[apiServerLauncher] Playground API build not found at ${playgroundDist}; run: bun run --filter '@bitcobblers/wod-wiki-playground' build:api`,
  );
}

const tempDir = mkdtempSync(join(tmpdir(), 'wodwiki-api-e2e-'));
const sqlitePath = join(tempDir, 'api-e2e.db');

function cleanupTempDir(): void {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup on shutdown.
  }
}

const db = await openDatabase({
  DB_DRIVER: 'sqlite',
  SQLITE_PATH: sqlitePath,
});

let server: Bun.Server<never> | undefined;
let shuttingDown = false;

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (server) {
      await server.stop(true);
    }
  } catch {
    // Ignore server stop errors during teardown.
  }
  try {
    await db.close();
  } catch {
    // Ignore DB close errors during teardown.
  }
  cleanupTempDir();
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  void shutdown(0);
});
process.on('SIGTERM', () => {
  void shutdown(0);
});
process.on('exit', cleanupTempDir);

try {
  await initializeStore(db);
  await initializeDomain(db);

  const handler = createHandler(db, { playgroundDist });

  // Verify `/api/health` and `/seed/core/manifest.json` answer 200 directly
  // through the mounted handler before binding the TCP listener.
  for (const probePath of ['/api/health', '/seed/core/manifest.json'] as const) {
    const probeRes = await handler(new Request(`http://${host}:${port}${probePath}`));
    if (probeRes.status !== 200) {
      throw new Error(
        `[apiServerLauncher] Startup probe ${probePath} returned HTTP ${probeRes.status} (expected 200 from ${playgroundDist})`,
      );
    }
    await probeRes.arrayBuffer();
  }

  server = Bun.serve({
    hostname: host,
    port,
    fetch: handler,
  });

  const origin = `http://${host}:${server.port}`;
  for (const probePath of ['/api/health', '/seed/core/manifest.json'] as const) {
    const liveRes = await fetch(`${origin}${probePath}`);
    if (liveRes.status !== 200) {
      throw new Error(`[apiServerLauncher] Live HTTP probe ${origin}${probePath} returned HTTP ${liveRes.status}`);
    }
    await liveRes.arrayBuffer();
  }

  console.error(`[apiServerLauncher] listening on ${origin} sqlite=${sqlitePath} dist=${playgroundDist}`);
} catch (error) {
  console.error('[apiServerLauncher] failed to start:', error);
  await shutdown(1);
}
