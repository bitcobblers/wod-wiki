/**
 * @bitcobblers/wod-wiki-storage/sql/node — server-only database opening,
 * extracted from the API server: env-driven driver selection (node libsql
 * client for local SQLite / remote Turso, native Bun.SQL for PostgreSQL).
 * Importing this subpath pulls the node @libsql/client — never from browser
 * code. All SQL is generated internally with `?` placeholders; only the
 * PostgreSQL adapter rewrites them to $1..$n.
 */
import { createClient } from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { StorageError } from './errors';
import {
  libsqlDatabase,
  type Database,
  type SqlConnection,
  type SqlRow,
} from './connection';

const SQLITE_URL_SCHEMES = /^(libsql|https?|wss?|file):\/\//;

/** Structural Bun.SQL surface (bun-types is not a dependency of this package). */
interface PgSql {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: { unsafe(query: string, params?: unknown[]): Promise<unknown[]> }) => Promise<T>): Promise<T>;
  close(options?: { timeout?: number }): Promise<void>;
}

function driverEnv(env: Record<string, string | undefined>): {
  dialect: 'sqlite' | 'postgres';
  url: string;
  authToken?: string;
} {
  const driver = env.DB_DRIVER || 'sqlite';
  const dbUrl = env.DATABASE_URL;
  if (driver === 'postgres') {
    if (!dbUrl || !/^postgres(ql)?:\/\//.test(dbUrl)) {
      throw new StorageError(500, 'DB_DRIVER=postgres requires DATABASE_URL starting with postgres:// or postgresql://', 'bad_db_env');
    }
    return { dialect: 'postgres', url: dbUrl };
  }
  if (driver !== 'sqlite' && driver !== 'turso') {
    throw new StorageError(500, `Unsupported DB_DRIVER: ${driver} (expected sqlite|turso|postgres)`, 'bad_db_env');
  }
  if (dbUrl) {
    if (/^postgres(ql)?:\/\//.test(dbUrl)) {
      throw new StorageError(500, `DB_DRIVER=${driver} cannot use a postgres:// DATABASE_URL`, 'bad_db_env');
    }
    if (!SQLITE_URL_SCHEMES.test(dbUrl)) {
      throw new StorageError(500, 'DB_DRIVER=' + driver + ' requires a libsql://, https://, http://, wss:// or file:// DATABASE_URL', 'bad_db_env');
    }
    if (driver === 'turso' && dbUrl.startsWith('file:')) {
      throw new StorageError(500, 'DB_DRIVER=turso requires a remote DATABASE_URL (libsql:// or https://)', 'bad_db_env');
    }
    return { dialect: 'sqlite', url: dbUrl, authToken: env.LIBSQL_AUTH_TOKEN || undefined };
  }
  if (driver === 'turso') {
    throw new StorageError(500, 'DB_DRIVER=turso requires DATABASE_URL (libsql:// or https://)', 'bad_db_env');
  }
  return { dialect: 'sqlite', url: 'file:' + (env.SQLITE_PATH || './data/wodwiki.db') };
}

/** '?' → '$1..$n' in order, counter reset per query. SQL is self-generated
 * (identifiers whitelist-sanitized); data values are always bound. */
function pgSql(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function pgConnection(sql: PgSql): Database {
  const conn: SqlConnection = {
    query: async (statement, params = []) =>
      (await sql.unsafe(pgSql(statement), params)) as unknown as SqlRow[],
    exec: async (statement, params = []) => {
      await sql.unsafe(pgSql(statement), params);
    },
  };
  return {
    ...conn,
    dialect: 'postgres',
    async transaction<T>(fn: (tx: SqlConnection) => Promise<T>): Promise<T> {
      // begin() leases a dedicated connection; throw → rollback, resolve → commit.
      return sql.begin(async (tx) => {
        const txConn: SqlConnection = {
          query: (statement, params = []) => tx.unsafe(pgSql(statement), params) as unknown as Promise<SqlRow[]>,
          exec: async (statement, params = []) => {
            await tx.unsafe(pgSql(statement), params);
          },
        };
        return fn(txConn);
      });
    },
    close: async () => {
      await sql.close({ timeout: 0 });
    },
  };
}

/** Lazy Bun.SQL import — under Node.js this fails with a clear
 * Bun-required error instead of a module-resolution crash (no Node
 * PostgreSQL driver dependency is bundled). */
async function openPgSql(url: string): Promise<PgSql> {
  let SQL: new (options: { url: string }) => PgSql;
  try {
    // Dynamic on purpose: 'bun' exists only under the Bun runtime, and Node
    // must reach the catch path (there is no bun-types dependency here to
    // type a static import — a static one would crash Node at module load).
    const bun = (await import('bun' as string)) as { SQL: new (options: { url: string }) => PgSql };
    SQL = bun.SQL;
  } catch {
    throw new StorageError(500, 'PostgreSQL requires the Bun runtime (built-in Bun.SQL driver); run the server or CLI with bun — no Node.js PostgreSQL driver is bundled', 'bad_db_env');
  }
  return new SQL({ url });
}

/** Same credentials, admin "postgres" database — only used to CREATE the
 * configured target when it is missing (postgres://host/db → host/postgres).
 * A query "database" parameter would override the admin pathname, so it is
 * dropped (ssl/sslmode and friends are kept). */
function adminUrl(url: string): string {
  const u = new URL(url);
  u.pathname = '/postgres';
  for (const key of [...u.searchParams.keys()]) {
    if (/^(database|dbname|db)$/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

function targetDatabase(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\/+|\/+$/g, ''));
  // Postgres identifiers: ≤63 UTF-8 bytes, no NUL — CREATE DATABASE would
  // silently truncate longer names, so init would recreate a different one.
  const bytes = Buffer.byteLength(name, 'utf8');
  if (name === '' || name.includes('\0') || bytes > 63) {
    throw new StorageError(500, 'PostgreSQL database name must be 1..63 UTF-8 bytes without NUL', 'bad_db_env');
  }
  return name;
}

function isMissingDatabase(error: unknown): boolean {
  // Ground truth from Bun.SQL: server errors surface as code
  // ERR_POSTGRES_SERVER_ERROR with the SQLSTATE in errno.
  if (typeof error !== 'object' || error === null) return false;
  return ('errno' in error && error.errno === '3D000') || ('code' in error && error.code === '3D000');
}

/** Open the database selected by env. Validates DB_DRIVER/URL pairing and
 * never falls back after failure — the first query surfaces connection
 * errors to startup.
 *
 * opts.create (explicit init requests only): when the configured PostgreSQL
 * database is missing (SQLSTATE 3D000), CREATE it through the admin
 * "postgres" database with the same credentials (identifier safely quoted)
 * and reconnect. Any other backend/error is untouched; Turso has no
 * management API — the hosted target must already exist. */
export async function openDatabase(
  env: Record<string, string | undefined> = process.env,
  opts: { create?: boolean } = {},
): Promise<Database> {
  const cfg = driverEnv(env);
  if (cfg.dialect === 'postgres') {
    let sql = await openPgSql(cfg.url);
    if (opts.create) {
      try {
        await sql.unsafe('SELECT 1');
      } catch (error) {
        await sql.close({ timeout: 0 }).catch(() => {});
        if (!isMissingDatabase(error)) throw error;
        const database = targetDatabase(cfg.url);
        const admin = await openPgSql(adminUrl(cfg.url));
        try {
          // Identifier quote-escaping; data values are always bound parameters.
          await admin.unsafe(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
        } finally {
          await admin.close({ timeout: 0 });
        }
        sql = await openPgSql(cfg.url);
      }
    }
    return pgConnection(sql);
  }
  if (cfg.url.startsWith('file:')) {
    const fsPath = decodeURIComponent(cfg.url.slice('file:'.length).split('?')[0]);
    await mkdir(dirname(fsPath), { recursive: true });
  }
  return libsqlDatabase(createClient({ url: cfg.url, authToken: cfg.authToken }));
}
