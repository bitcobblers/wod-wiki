/**
 * server.ts — `wod serve` / `wod playground` (Bun-only front door).
 *
 * Reuses the REAL server stack from the repository checkout: the apps/api
 * fetch handler (same code the Docker image serves) plus a real frontend
 * build. Outside a checkout the command reports honestly that a checkout is
 * required — no placeholder UI.
 *
 * serve       probes the configured database first (never creates schema —
 *             that's `wod init`), then serves API + SPA.
 * playground  serves the browser-storage SPA build and never opens a database
 *             (every /api request answers 404).
 *
 * Retains the event loop until SIGINT/SIGTERM; shutdown drains in-flight
 * requests before closing the database.
 */

import { openCliDb, nodeFs, nodePath } from './db';
import type { CliDatabaseConfig } from './config';
import type { CliDb } from './db';
import type { Database } from '@bitcobblers/wod-wiki-storage/sql';

type WriteOut = (text: string) => void;

export interface CliServerOptions {
  /** Resolved database configuration. REQUIRED for 'serve'; ignored — never
   * opened or validated — for 'playground'. */
  database?: CliDatabaseConfig;
  host?: string;
  port?: string;
  /** Explicit dist directory (flag or PLAYGROUND_DIST); must already exist. */
  dist?: string;
  /** Merged CLI environment (process env + .env). */
  env: Record<string, string | undefined>;
}

interface BunServerLike { stop(): Promise<void> }
interface BunGlobalLike { serve(options: { port: number; hostname: string; fetch: (request: Request) => Promise<Response> }): BunServerLike }
interface CreateHandler {
  (db: Database | null, options: { playgroundDist: string }): (request: Request) => Promise<Response>;
}
/** Narrow spawnSync surface — CJS require results are untyped. */
interface SpawnSyncLike {
  (cmd: string, args: string[], opts: { cwd: string; stdio: 'inherit' }): { status: number | null };
}

/** Lazy CJS require — keeps node builtins out of browser bundles. */
function serverRequire(): (id: string) => unknown {
  const g = globalThis as { require?: (id: string) => unknown };
  const req = g.require ?? (typeof require === 'function' ? require : undefined);
  if (!req) throw new Error('wod serve/playground requires a CJS require shim (missing tsup banner?)');
  return req;
}

function bun(): BunGlobalLike {
  // Bun-specific global, absent from the ambient TS lib shapes on purpose
  // (engine stays Node-compilable); the access chain is proven at runtime.
  const b = (globalThis as { Bun?: BunGlobalLike }).Bun;
  if (!b) {
    throw new Error('wod serve/playground requires the Bun runtime — start with: bun wod serve');
  }
  return b;
}

/** The checkout marker: real API handler sources plus the SPA workspace. */
function isRepoRoot(dir: string): boolean {
  const fs = nodeFs();
  const p = nodePath();
  return fs.existsSync(p.resolve(dir, 'apps/api/src/app.ts'))
    && fs.existsSync(p.resolve(dir, 'apps/playground/package.json'));
}

/**
 * Locate the repository checkout by walking up from this module's directory
 * (works for src and built dist layouts) and then the process cwd.
 */
function findRepoRoot(): string {
  const p = nodePath();
  const starts: string[] = [p.resolve()];
  const meta = import.meta; // Bun adds `dir`; the TS lib only knows `url`.
  if ('dir' in meta && typeof meta.dir === 'string') {
    starts.push(p.resolve(meta.dir));
  } else if (typeof meta.url === 'string') {
    starts.push(p.resolve(p.dirname(decodeURIComponent(new URL('.', meta.url).pathname))));
  }
  for (const start of starts) {
    for (let dir = p.resolve(start); ; dir = p.dirname(dir)) {
      if (isRepoRoot(dir)) return dir;
      const parent = p.dirname(dir);
      if (parent === dir) break;
    }
  }
  throw new Error(
    'wod serve/playground need a wod-wiki repository checkout (apps/api + apps/playground with frontend sources). '
    + 'The published package ships neither the server sources nor the website assets — run from a checkout: '
    + 'git clone https://github.com/bitcobblers/wod-wiki && cd wod-wiki && bun install && bun wod serve',
  );
}

/** Build the matching SPA via the playground workspace's own script. */
function buildSpa(repoRoot: string, mode: 'serve' | 'playground', writeOut: WriteOut): void {
  const script = mode === 'serve' ? 'build:api' : 'build';
  const { spawnSync } = serverRequire()('node:child_process') as { spawnSync: SpawnSyncLike };
  writeOut(`wod ${mode}: frontend build missing — running bun run --filter @bitcobblers/wod-wiki-playground ${script} …`);
  const res = spawnSync(process.execPath, ['run', '--filter', '@bitcobblers/wod-wiki-playground', script], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(
      `wod ${mode}: frontend build failed (exit ${res.status}). Build it manually: `
      + `bun run --filter @bitcobblers/wod-wiki-playground ${script}`,
    );
  }
}

/**
 * Resolve the dist directory. An explicit --dist/PLAYGROUND_DIST must already
 * contain a built SPA (index.html); the per-mode default is built on demand.
 */
function resolveDist(repoRoot: string, mode: 'serve' | 'playground', options: CliServerOptions, writeOut: WriteOut): string {
  const p = nodePath();
  const script = mode === 'serve' ? 'build:api' : 'build';
  const isBuilt = (dir: string): boolean => nodeFs().existsSync(p.resolve(dir, 'index.html'));
  const explicit = options.dist?.trim() || options.env.PLAYGROUND_DIST?.trim() || undefined;
  const dist = explicit
    ? p.resolve(explicit)
    : p.resolve(repoRoot, mode === 'serve' ? 'apps/playground/dist-api' : 'apps/playground/dist');
  if (isBuilt(dist)) return dist;
  if (explicit) {
    throw new Error(
      `wod ${mode}: no built SPA (index.html) at ${dist} — build it `
      + `(bun run --filter @bitcobblers/wod-wiki-playground ${script}) or drop --dist/PLAYGROUND_DIST`,
    );
  }
  buildSpa(repoRoot, mode, writeOut);
  if (!isBuilt(dist)) {
    throw new Error(`wod ${mode}: dist still missing after build: ${dist}`);
  }
  return dist;
}

/** Validate bind address first: flag > HOST/PORT env > loopback:3000. */
function resolveBind(mode: 'serve' | 'playground', options: CliServerOptions): { host: string; port: number } {
  const host = options.host?.trim() || options.env.HOST?.trim() || '127.0.0.1';
  const rawPort = options.port?.trim() || options.env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`wod ${mode}: invalid port ${JSON.stringify(rawPort)} (need integer 1..65535)`);
  }
  return { host, port };
}

// A static import is impossible: the handler lives in apps/api inside the
// checkout, a path discovered only at runtime (the engine never depends on
// apps/api at build time). Bun resolves plain absolute paths in import();
// non-Bun runtimes already failed the bun() guard before this runs.
async function importCreateHandler(repoRoot: string): Promise<CreateHandler> {
  const appPath = nodePath().resolve(repoRoot, 'apps/api/src/app.ts');
  const mod = (await import(appPath)) as { createHandler?: CreateHandler };
  if (typeof mod.createHandler !== 'function') {
    throw new Error(`wod serve: apps/api handler not found at ${appPath}`);
  }
  return mod.createHandler;
}

/**
 * Start the shared server for `wod serve` / `wod playground`. Throws on any
 * startup failure; on success it never returns until SIGINT/SIGTERM (drain,
 * close database, exit 0).
 */
export async function runCliServer(
  mode: 'serve' | 'playground',
  options: CliServerOptions,
  writeOut: WriteOut,
): Promise<void> {
  const runtime = bun(); // Fail before any side effect when not under Bun.
  const repoRoot = findRepoRoot();
  const { host, port } = resolveBind(mode, options); // Validate bind before opening anything.

  // Serve probes the database BEFORE building the SPA or binding a socket:
  // a missing/uninitialized database refuses with `wod init` guidance.
  let db: CliDb | undefined;
  let dbLabel = 'no database';
  if (mode === 'serve') {
    const database = options.database; // hoisted so the guard's narrowing sticks
    if (!database) {
      throw new Error('wod serve: no database configuration resolved — this is a runner bug (expected resolveDatabaseConfig output)');
    }
    try {
      db = await openCliDb(database, { initialize: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`wod serve: database not ready — run \`wod init\` first. ${message}`, { cause: e });
    }
    dbLabel = db.path;
  }

  let server: BunServerLike;
  try {
    const dist = resolveDist(repoRoot, mode, options, writeOut);
    const createHandler = await importCreateHandler(repoRoot);
    // Playground: no database exists to close — createHandler(null) answers
    // every /api request with 404 and serves the browser-storage build.
    const handler = createHandler(db?.db ?? null, { playgroundDist: dist });
    server = runtime.serve({ port, hostname: host, fetch: handler });
    if (mode === 'serve') {
      writeOut(`wod serve: http://${host}:${port} — ${dbLabel} · dist ${dist}`);
    } else {
      writeOut(`wod playground: http://${host}:${port} — in-browser storage (no database) · dist ${dist}`);
    }
  } catch (e) {
    if (db) await db.close(); // never leak the probe connection when startup fails
    throw e;
  }

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) process.exit(0); // second signal forces the exit
    closing = true;
    try {
      await server.stop();
    } finally {
      if (db) await db.close();
      process.exit(0);
    }
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  // Park until a signal handler exits the process.
  await new Promise<never>(() => {});
}
