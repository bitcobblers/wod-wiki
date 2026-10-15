/**
 * server.ts — `wod server` (alias `serve`) / `wod playground` (Bun-only front
 * door).
 *
 * Serves the packaged engine stack: the shared fetch handler shipped in this
 * package (the same code the Docker image serves) plus the frontend build
 * packaged under the engine's dist/web/ — no repository checkout, no runtime
 * build.
 *
 * server      probes the configured database first (never creates schema —
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
import { createHandler } from '../server/app';
type WriteOut = (text: string) => void;

export type CliServerMode = 'server' | 'playground';

export interface CliServerOptions {
  /** Resolved database configuration. REQUIRED for 'server'; ignored — never
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

function bun(): BunGlobalLike {
  // Bun-specific global, absent from the ambient TS lib shapes on purpose
  // (engine stays Node-compilable); the access chain is proven at runtime.
  const b = (globalThis as { Bun?: BunGlobalLike }).Bun;
  if (!b) {
    throw new Error('wod server/playground requires the Bun runtime (https://bun.sh)');
  }
  return b;
}

/**
 * This module's directory, robust across shipped layouts: ESM via
 * import.meta.url (works under node and Bun; esbuild shims it in CJS too) and
 * Bun's import.meta.dir. ESM code splitting may relocate this module to a
 * chunk at dist/ root, so never assume dist/cli.
 */
function moduleDir(): string {
  const p = nodePath();
  const meta: { dir?: unknown; url?: unknown } = import.meta; // Bun adds `dir`; the TS lib knows neither.
  if (typeof meta.dir === 'string') return p.resolve(meta.dir);
  if (typeof meta.url === 'string' && meta.url.startsWith('file:')) {
    return p.resolve(p.dirname(decodeURIComponent(new URL('.', meta.url).pathname)));
  }
  throw new Error('wod server/playground: cannot determine the installed engine module directory');
}

/**
 * The installed engine package root: nearest enclosing package.json belonging
 * to this package, walking up from the executing module (dist/cli, a split
 * chunk at dist/ root, dist/bin, or src/cli in a checkout).
 */
function engineRoot(): string {
  const p = nodePath();
  const fs = nodeFs();
  for (let dir = moduleDir(); ; dir = p.dirname(dir)) {
    try {
      if (JSON.parse(fs.readFileSync(p.resolve(dir, 'package.json'), 'utf8')).name === '@bitcobblers/wod-wiki-tools') return dir;
    } catch { /* no manifest here — keep walking */ }
    const parent = p.dirname(dir);
    if (parent === dir) break;
  }
  throw new Error('wod server/playground: cannot locate the installed @bitcobblers/wod-wiki-tools package');
}

/**
 * Resolve the frontend dist directory. The packaged default lives inside the
 * installed engine module (dist/web/server or dist/web/playground); an
 * explicit --dist/PLAYGROUND_DIST is cwd-relative and must already contain a
 * built SPA (index.html). Nothing is built at runtime.
 */
function resolveDist(mode: CliServerMode, options: CliServerOptions): string {
  const p = nodePath();
  const explicit = options.dist?.trim() || options.env.PLAYGROUND_DIST?.trim() || undefined;
  if (explicit) {
    const dist = p.resolve(explicit); // cwd-relative override
    if (!nodeFs().existsSync(p.resolve(dist, 'index.html'))) {
      throw new Error(
        `wod ${mode}: no built frontend (index.html) at ${dist} — --dist/PLAYGROUND_DIST must `
        + 'point at an already-built directory (the CLI never builds frontends at runtime)',
      );
    }
    return dist;
  }
  const dist = p.resolve(engineRoot(), 'dist', 'web', mode === 'playground' ? 'playground' : 'server');
  if (!nodeFs().existsSync(p.resolve(dist, 'index.html'))) {
    throw new Error(
      `wod ${mode}: packaged frontend missing — expected ${dist}/index.html. `
      + 'Reinstall @bitcobblers/wod-wiki-tools (bun add @bitcobblers/wod-wiki-tools), '
      + 'or rebuild the release assets from a checkout (bun run build:cli) and reinstall the package.',
    );
  }
  return dist;
}

/** Validate bind address first: flag > HOST/PORT env > loopback:3000. */
function resolveBind(mode: CliServerMode, options: CliServerOptions): { host: string; port: number } {
  const host = options.host?.trim() || options.env.HOST?.trim() || '127.0.0.1';
  const rawPort = options.port?.trim() || options.env.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`wod ${mode}: invalid port ${JSON.stringify(rawPort)} (need integer 1..65535)`);
  }
  return { host, port };
}

/**
 * Start the shared server for `wod server` / `wod playground`. Throws on any
 * startup failure; on success it never returns until SIGINT/SIGTERM (drain,
 * close database, exit 0).
 */
export async function runCliServer(
  mode: CliServerMode,
  options: CliServerOptions,
  writeOut: WriteOut,
): Promise<void> {
  const runtime = bun(); // Fail before any side effect when not under Bun.
  const { host, port } = resolveBind(mode, options); // Validate bind before opening anything.

  // Server probes the database BEFORE binding a socket: a missing/uninitialized
  // database refuses with `wod init` guidance.
  let db: CliDb | undefined;
  let dbLabel = 'no database';
  if (mode === 'server') {
    const database = options.database; // hoisted so the guard's narrowing sticks
    if (!database) {
      throw new Error('wod server: no database configuration resolved — this is a runner bug (expected resolveDatabaseConfig output)');
    }
    try {
      db = await openCliDb(database, { initialize: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`wod server: database not ready — run \`wod init\` first. ${message}`, { cause: e });
    }
    dbLabel = db.path;
  }

  let server: BunServerLike;
  try {
    const dist = resolveDist(mode, options);
    // Bundled server handler
    const handler = createHandler(db?.db ?? null, { playgroundDist: dist });
    // Playground: no database exists to close — createHandler(null) answers
    server = runtime.serve({ port, hostname: host, fetch: handler });
    if (mode === 'server') {
      writeOut(`wod server: http://${host}:${port} — ${dbLabel} · dist ${dist}`);
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
