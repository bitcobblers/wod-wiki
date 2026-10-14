/**
 * Database configuration for the `wod` CLI (and the dev server): explicit
 * per-property flags → process env → .env file (native node:util.parseEnv,
 * non-mutating).
 *
 * Precedence: flags beat env beats .env. `--db` selects local SQLite even
 * when env configures a remote backend; explicit `--db-driver` /
 * `--postgres-*` / `--turso-*` flags select that backend. Conflicting
 * explicit selectors and ambiguous env backends are rejected. Labels and
 * error messages never contain credentials.
 */

/** Optional per-property flag bag — every property unset unless given. */
export interface CliDatabaseOptions {
  /** --db: explicit SQLite file. Selects sqlite even when env has a remote backend. */
  db?: string;
  /** --db-driver: sqlite | postgres | turso. */
  dbDriver?: string;
  /** --database-url: driver-scoped URL (mirrors DATABASE_URL). */
  databaseUrl?: string;
  postgresHost?: string;
  postgresPort?: string;
  postgresUser?: string;
  postgresPassword?: string;
  postgresDatabase?: string;
  /** --postgres-ssl <mode>: true/false or disable | prefer | require | verify-ca | verify-full. */
  postgresSsl?: string | boolean;
  tursoUrl?: string;
  tursoAuthToken?: string;
  /** --env-file: explicit file is mandatory — a missing file is an error. */
  envFile?: string;
}

/** Discriminated backend selection. `label` is credential-free and safe to
 * print on every variant. sqlite is pure-local (absolute `path`); every
 * remote libsql target normalizes to turso. */
export type PostgresSslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

export type CliDatabaseConfig =
  | { kind: 'sqlite'; label: string; path: string }
  | {
      kind: 'postgres';
      label: string;
      url: string;
      host: string;
      port: number;
      database: string;
      user?: string;
      password?: string;
      ssl: PostgresSslMode;
    }
  | { kind: 'turso'; label: string; url: string; authToken?: string };

type BackendKind = 'sqlite' | 'postgres' | 'turso';

type CjsRequire = (id: string) => unknown;

/** Minimal node builtin surfaces (kept out of browser bundles, same pattern as ./db). */
export interface ConfigPathShim { resolve(...parts: string[]): string; join(...parts: string[]): string; dirname(p: string): string }
export interface ConfigFsShim { existsSync(p: string): boolean; readFileSync(p: string, encoding: string): string }
interface UtilShim { parseEnv(content: string): Record<string, string> }

/** Lazy CJS require — keeps node builtins out of browser bundles. */
function nodeRequire(): CjsRequire {
  const g = globalThis as { process?: { versions?: Record<string, string> }; Bun?: unknown; require?: CjsRequire };
  if (typeof g.process?.versions?.node === 'undefined' && typeof g.Bun === 'undefined') {
    throw new Error('database configuration is only supported in Node / Bun environments');
  }
  const req = g.require ?? (typeof require === 'function' ? require : undefined);
  if (!req) throw new Error('database configuration requires a CJS require shim (missing tsup banner?)');
  return req;
}
export const nodePath = (): ConfigPathShim => nodeRequire()('node:path') as ConfigPathShim;
const nodeFs = (): ConfigFsShim => nodeRequire()('node:fs') as ConfigFsShim;

/** native node:util.parseEnv — dotenv parsing without a dependency. */
function parseEnvFile(content: string): Record<string, string> {
  return (nodeRequire()('node:util') as UtilShim).parseEnv(content);
}

/**
 * Load a NON-MUTATING env object from the dotenv tier ONLY: an explicit
 * --env-file is mandatory when given (missing file → error); otherwise
 * `.env` in the working directory, falling back to the nearest ancestor
 * (workspace root) `.env`. Callers merge over process.env themselves
 * ({ ...loadCliEnvironment(file), ...process.env }); process.env is never
 * written.
 */
export function loadCliEnvironment(envFile?: string): Record<string, string | undefined> {
  const fs = nodeFs();
  const path = nodePath();
  let file: string | undefined;
  if (envFile !== undefined) {
    file = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(file)) throw new Error(`[wod] --env-file: file not found: ${envFile}`);
  } else {
    let dir = process.cwd();
    for (;;) {
      const candidate = path.join(dir, '.env');
      if (fs.existsSync(candidate)) {
        file = candidate;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return file !== undefined ? parseEnvFile(fs.readFileSync(file, 'utf-8')) : {};
}

const SQLITE_URL_SCHEMES = /^(libsql|https?|wss?|file):\/\//;
const PG_URL_SCHEMES = /^postgres(ql)?:\/\//;
const TURSO_URL_SCHEMES = /^(libsql|https?|wss?):\/\//;
const PG_FLAG_KEYS = [
  'postgresHost',
  'postgresPort',
  'postgresUser',
  'postgresPassword',
  'postgresDatabase',
  'postgresSsl',
] as const;

const PG_ENV_KEYS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_SSL',
] as const;

/** Type guard — keeps backend strings narrowable without casts. */
const isBackend = (v: string): v is BackendKind => v === 'sqlite' || v === 'postgres' || v === 'turso';

/** Present-but-empty env values (compose passthroughs) read as unset —
 * lockstep across every env read. */
function setEnv(v: string | undefined): string | undefined {
  return v !== undefined && v.trim() !== '' ? v : undefined;
}

/** CLI error contract: every configuration failure is prefixed `[wod] `. */
function fail(message: string): never {
  throw new Error(`[wod] ${message}`);
}

function parsePort(v: string, source: string): number {
  if (!/^\d+$/.test(v)) fail(`${source} must be an integer 1..65535, got ${JSON.stringify(v)}`);
  const port = Number(v);
  if (port < 1 || port > 65535) fail(`${source} must be an integer 1..65535, got ${v}`);
  return port;
}

function sslMode(v: string | boolean | undefined, source: string): PostgresSslMode {
  if (v === undefined || v === '') return 'prefer';
  if (typeof v === 'boolean') return v ? 'require' : 'disable';
  const s = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'require'].includes(s)) return 'require';
  if (['false', '0', 'no', 'disable', 'disabled'].includes(s)) return 'disable';
  if (s === 'prefer' || s === 'verify-ca' || s === 'verify-full') return s;
  fail(`${source} must be disable|prefer|require|verify-ca|verify-full, got ${JSON.stringify(v)}`);
}

/** Credential-free display form (userinfo + query stripped); an unparsable
 * input is never echoed back. */
function safeUrlLabel(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<unparsable-url>';
  }
}

/** URL form — the API's existing semantics; the label strips credentials. */
function postgresFromUrl(url: string, source: string): CliDatabaseConfig {
  if (!PG_URL_SCHEMES.test(url)) {
    fail(`${source} must start with postgres:// or postgresql://`);
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    fail(`${source} is not a parseable URL`); // never echo the input (credentials)
  }
  const database = decodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, ''));
  if (database === '') fail(`${source} has no database name`);
  return {
    kind: 'postgres',
    label: safeUrlLabel(url),
    url,
    host: u.hostname,
    port: u.port !== '' ? parsePort(u.port, `${source} port`) : 5432,
    database,
    user: u.username !== '' ? decodeURIComponent(u.username) : undefined,
    password: u.password !== '' ? decodeURIComponent(u.password) : undefined,
    ssl: sslMode(u.searchParams.get('sslmode') ?? u.searchParams.get('ssl') ?? undefined, `${source} ssl parameter`),
  };
}

function resolvePostgres(
  options: CliDatabaseOptions,
  e: Record<string, string | undefined>,
  databaseUrl: string | undefined,
): CliDatabaseConfig {
  const flagProps = PG_FLAG_KEYS.some((k) => options[k] !== undefined);
  const envProps = PG_ENV_KEYS.some((k) => setEnv(e[k]) !== undefined);
  // Per-property form: explicit flags, or POSTGRES_* env when no URL competes
  // (env DATABASE_URL keeps its existing precedence over env props).
  if (flagProps || (envProps && databaseUrl === undefined)) {
    const host = options.postgresHost ?? setEnv(e.POSTGRES_HOST) ?? '127.0.0.1';
    const port = parsePort(options.postgresPort ?? setEnv(e.POSTGRES_PORT) ?? '5432', '--postgres-port/POSTGRES_PORT');
    const database = options.postgresDatabase ?? setEnv(e.POSTGRES_DATABASE);
    if (database === undefined) {
      fail('--postgres-database (or POSTGRES_DATABASE) is required for per-property PostgreSQL configuration');
    }
    const user = options.postgresUser ?? setEnv(e.POSTGRES_USER);
    const password = options.postgresPassword ?? setEnv(e.POSTGRES_PASSWORD);
    const ssl = sslMode(options.postgresSsl ?? setEnv(e.POSTGRES_SSL), '--postgres-ssl/POSTGRES_SSL');
    try {
      // URL setters percent-encode userinfo specials and keep the colon placement.
      const u = new URL(`postgresql://${host}`);
      u.port = String(port);
      u.pathname = `/${database}`;
      if (user !== undefined) u.username = user;
      if (password !== undefined) u.password = password;
      u.searchParams.set('sslmode', ssl);
      return {
        kind: 'postgres',
        label: `postgresql://${u.host}${u.pathname}`,
        url: u.toString(),
        host,
        port,
        database,
        user,
        password,
        ssl,
      };
    } catch {
      fail('invalid PostgreSQL host/database in per-property configuration');
    }
  }
  if (databaseUrl !== undefined) return postgresFromUrl(databaseUrl, 'DB_DRIVER=postgres DATABASE_URL');
  fail('DB_DRIVER=postgres requires DATABASE_URL starting with postgres:// or postgresql:// — or per-property --postgres-host/--postgres-database flags');
}

function resolveTurso(
  options: CliDatabaseOptions,
  e: Record<string, string | undefined>,
  databaseUrl: string | undefined,
): CliDatabaseConfig {
  const url = options.tursoUrl ?? setEnv(e.TURSO_DATABASE_URL) ?? databaseUrl;
  if (url === undefined) {
    fail('DB_DRIVER=turso requires --turso-url / TURSO_DATABASE_URL or DATABASE_URL (libsql:// or https://)');
  }
  if (PG_URL_SCHEMES.test(url)) fail('DB_DRIVER=turso cannot use a postgres:// URL');
  if (!TURSO_URL_SCHEMES.test(url)) fail('DB_DRIVER=turso requires a libsql://, https://, http:// or wss:// URL');
  return {
    kind: 'turso',
    label: safeUrlLabel(url),
    url,
    authToken: options.tursoAuthToken ?? setEnv(e.TURSO_AUTH_TOKEN) ?? setEnv(e.LIBSQL_AUTH_TOKEN),
  };
}

function resolveSqlite(
  options: CliDatabaseOptions,
  e: Record<string, string | undefined>,
  databaseUrl: string | undefined,
): CliDatabaseConfig {
  // Explicit --db wins even when env configures a remote backend.
  if (options.db !== undefined) {
    const path = nodePath().resolve(process.cwd(), options.db);
    return { kind: 'sqlite', label: path, path };
  }
  if (databaseUrl !== undefined) {
    if (PG_URL_SCHEMES.test(databaseUrl)) fail('DB_DRIVER=sqlite cannot use a postgres:// DATABASE_URL');
    if (databaseUrl.startsWith('file:')) {
      const path = nodePath().resolve(process.cwd(), decodeURIComponent(databaseUrl.slice('file:'.length).split('?')[0]));
      return { kind: 'sqlite', label: path, path };
    }
    if (!SQLITE_URL_SCHEMES.test(databaseUrl)) {
      fail('DB_DRIVER=sqlite requires a libsql://, https://, http://, wss:// or file:// DATABASE_URL');
    }
    // A remote libsql URL is the turso protocol — normalize the backend kind.
    return { kind: 'turso', label: safeUrlLabel(databaseUrl), url: databaseUrl, authToken: setEnv(e.LIBSQL_AUTH_TOKEN) };
  }
  // WOD_WIKI_DB keeps its historical precedence over SQLITE_PATH.
  const path = nodePath().resolve(process.cwd(), setEnv(e.WOD_WIKI_DB) ?? setEnv(e.SQLITE_PATH) ?? './wodwiki.db');
  return { kind: 'sqlite', label: path, path };
}

/** Env-tier backend inference with ambiguity rejection — reached only when
 * no explicit flag selects a backend and DB_DRIVER is unset. */
function envBackend(e: Record<string, string | undefined>): BackendKind {
  const kinds = new Set<BackendKind>();
  if (setEnv(e.WOD_WIKI_DB) !== undefined || setEnv(e.SQLITE_PATH) !== undefined) kinds.add('sqlite');
  const dbUrl = setEnv(e.DATABASE_URL);
  if (PG_ENV_KEYS.some((k) => setEnv(e[k]) !== undefined) || (dbUrl !== undefined && PG_URL_SCHEMES.test(dbUrl))) {
    kinds.add('postgres');
  } else if (dbUrl !== undefined && SQLITE_URL_SCHEMES.test(dbUrl)) {
    kinds.add('sqlite');
  }
  if (setEnv(e.TURSO_DATABASE_URL) !== undefined) kinds.add('turso');
  if (kinds.size > 1) {
    fail(`ambiguous database configuration: ${[...kinds].join(' + ')} env vars are both set — set DB_DRIVER (or pass explicit flags) to choose`);
  }
  return kinds.values().next().value ?? 'sqlite';
}

/**
 * Resolve the effective database configuration: flags > env > .env. Pass
 * `env` to supply an already-merged tier (nothing is re-read); without it
 * the .env tier (loadCliEnvironment) sits under the true process tier.
 * Kind-pinning flags (--db, --db-driver, --turso-url/--turso-auth-token,
 * --postgres-*) override even a malformed env driver; conflicting pins and
 * ambiguous env backends are rejected. Never echoes credentials.
 */
export function resolveDatabaseConfig(
  options: CliDatabaseOptions = {},
  env?: Record<string, string | undefined>,
): CliDatabaseConfig {
  const e = env ?? { ...loadCliEnvironment(options.envFile), ...process.env };

  const driverFlag = options.dbDriver;
  if (driverFlag !== undefined && !isBackend(driverFlag)) {
    fail(`--db-driver must be sqlite|postgres|turso, got ${JSON.stringify(driverFlag)}`);
  }

  // Kind-pinning explicit flags; conflicting pins are rejected outright.
  const pinned: Array<[string, BackendKind]> = [];
  if (options.db !== undefined) pinned.push(['--db', 'sqlite']);
  if (driverFlag !== undefined) pinned.push([`--db-driver ${driverFlag}`, driverFlag]);
  if (options.tursoUrl !== undefined) pinned.push(['--turso-url', 'turso']);
  if (options.tursoAuthToken !== undefined) pinned.push(['--turso-auth-token', 'turso']);
  if (PG_FLAG_KEYS.some((k) => options[k] !== undefined)) pinned.push(['--postgres-*', 'postgres']);
  const kinds = new Set(pinned.map(([, kind]) => kind));
  if (kinds.size > 1) {
    fail(`conflicting database selectors: ${pinned.map(([flag, kind]) => `${flag} (${kind})`).join(', ')}`);
  }
  // --database-url is the URL for whichever backend is selected — it never
  // pins a kind, but never combines with a competing URL/local selector.
  if (options.databaseUrl !== undefined) {
    if (options.db !== undefined) fail('conflicting database selectors: --db and --database-url are both set');
    if (options.tursoUrl !== undefined) fail('conflicting database selectors: --turso-url and --database-url are both set');
    if (PG_FLAG_KEYS.some((k) => options[k] !== undefined)) {
      fail('conflicting database selectors: --database-url and --postgres-* flags are both set');
    }
  }

  let backend: BackendKind;
  if (pinned.length > 0) {
    backend = pinned[0][1]; // flags override even a malformed env driver
  } else {
    const envDriver = setEnv(e.DB_DRIVER);
    if (envDriver !== undefined) {
      if (!isBackend(envDriver)) {
        fail(`Unsupported DB_DRIVER: ${envDriver} (expected sqlite|turso|postgres)`);
      }
      backend = envDriver;
    } else {
      backend = envBackend(e);
    }
  }
  const databaseUrl = options.databaseUrl ?? setEnv(e.DATABASE_URL);
  switch (backend) {
    case 'postgres':
      return resolvePostgres(options, e, databaseUrl);
    case 'turso':
      return resolveTurso(options, e, databaseUrl);
    case 'sqlite':
      return resolveSqlite(options, e, databaseUrl);
  }
}
