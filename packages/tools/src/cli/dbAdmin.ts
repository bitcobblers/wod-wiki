/**
 * `wod db <action>` — native Turso lifecycle commands for the Storage UI:
 *
 *   wod db create  [--name <db>] --group <g> -o <pairing-file>
 *       Provision a fresh empty target (canonical name `wod-wiki-v<DB_VERSION>`)
 *       and pair it for the browser's first bootstrap.
 *   wod db backup  <source> [--name <copy>] --writers-retired -o <file>
 *   wod db restore <source> [--name <copy>] --writers-retired -o <file>
 *       Native whole-database copy through the Control API seed
 *       (`seed.type = database`), proven row- and binary-identical before a
 *       client token is minted. Only a copy already at the current schema is
 *       paired; older-schema archives are reported as retained, unpairable
 *       copies. Restore refuses a target named like the source.
 *   wod db migrate <source> [--name <target>] --writers-retired -o <file>
 *       Logical conversion of a legacy/current older-schema source into a
 *       fresh target via the shared IndexedDB adapter (fake-indexeddb is
 *       loaded only in this trusted CLI runtime). The target is constructed
 *       at the non-legitimate marker schema 0 and stays unpairable until the
 *       full replay/pin/binary validation passes and the finalize CAS
 *       publishes the live schema. The source is never mutated (read-only
 *       token) and is retained on every outcome.
 *   wod db delete <name> --yes <name>
 *       Deletes the database — `--yes` must repeat the exact name.
 *   wod db pair    <name> [--allow-empty] -o <file> [--write-env]
 *       Mint a database-scoped token and write the pairing file for the
 *       browser Data settings. Refuses unknown/legacy/newer and the schema-0
 *       constructing marker; `--allow-empty` pairs a fresh bootstrap target.
 *
 * Safety contract: management credentials come from the environment only
 * (TURSO_API_TOKEN, TURSO_ORGANIZATION — never flags, never printed);
 * pairing credentials are written only to the explicitly requested file
 * (created 0600, exclusive); `--write-env` is opt-in, atomic (temp+rename)
 * and refuses to replace existing database settings. A failed verification
 * or config write never deletes the created database and never touches the
 * source — the user decides.
 */

import { DB_VERSION } from '@bitcobblers/wod-wiki-storage';
import type { Database, LibsqlClient } from '@bitcobblers/wod-wiki-storage/sql';
import type {
  DatabaseFingerprint,
  StoredSyncOp,
  SyncEntry,
  SyncMutation,
  SyncTargetKind,
} from '@bitcobblers/wod-wiki-storage/sql';
import { nodeFs, nodeCrypto } from './db';

// ---------------------------------------------------------------------------
// Lazy seams (browser-free: everything node-specific is imported on demand)
// ---------------------------------------------------------------------------

/** Structural mirror of the storage/sql members the lifecycle uses. */
export interface SqlLifecycleApi {
  libsqlDatabase(client: LibsqlClient): Database;
  probeSyncTarget(db: Database): Promise<SyncTargetKind>;
  initSyncTarget(db: Database, schemaVersion: number): Promise<void>;
  applySyncBatch(db: Database, entries: SyncEntry[], opts?: { expectSchema?: number }): Promise<number>;
  fetchSyncOps(db: Database, afterRev: number, limit: number): Promise<StoredSyncOp[]>;
  databaseFingerprint(db: Database): Promise<DatabaseFingerprint>;
  assertDatabaseCopyMatches(source: Database, copy: Database, before: DatabaseFingerprint): Promise<DatabaseFingerprint>;
  finalizeMigrationTarget(db: Database, toSchema: number, expectRev: number): Promise<void>;
  assertPolicySnapshot(ops: readonly SyncMutation[]): void;
  assertLogPinClosure(ops: readonly StoredSyncOp[]): void;
}

let lifecycleSql: Promise<SqlLifecycleApi> | undefined;

function loadSqlLifecycle(): Promise<SqlLifecycleApi> {
  lifecycleSql ??= import(/* @vite-ignore */ '@bitcobblers/wod-wiki-storage/sql') as Promise<SqlLifecycleApi>;
  return lifecycleSql;
}

/** The fs surface the secret-file writers need (the real fs module provides
 * all of it; declared standalone so no method signature conflicts). */
interface WriteFsShim {
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
  readFileSync(path: string, encoding: string): string;
  openSync(path: string, flags: string, mode?: number): number;
  writeSync(fd: number, data: string): number;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
}

function fullFs(): WriteFsShim {
  return nodeFs() as unknown as WriteFsShim;
}

interface UtilShim { parseEnv(content: string): Record<string, string> }

function parseEnvContent(content: string): Record<string, string> {
  const g = globalThis as { process?: { versions?: Record<string, string> }; Bun?: unknown; require?: (id: string) => unknown };
  const req = g.require ?? (typeof require === 'function' ? require : undefined);
  if (!req) throw new Error('[wod db] .env handling requires a CJS require shim (missing tsup banner?)');
  return (req('node:util') as UtilShim).parseEnv(content);
}

// ---------------------------------------------------------------------------
// Control API client (spec: turso.tech/openapi.json)
// ---------------------------------------------------------------------------

export interface TursoManagementDeps {
  fetchFn?: typeof fetch;
  apiBase?: string;
}

export interface DatabaseInfo {
  name: string;
  dbId?: string;
  hostname: string;
  group?: string;
}

/** Mask every secret occurrence in a message before it reaches output. */
function maskSecrets(message: string, ...secrets: string[]): string {
  let masked = message;
  for (const secret of secrets) {
    if (secret) masked = masked.split(secret).join('••••••');
  }
  return masked;
}

export class TursoManagement {
  private constructor(
    readonly organization: string,
    private readonly token: string,
    private readonly deps: TursoManagementDeps,
  ) {}

  /** Env-only credentials — never flags, never .env-file-only names. */
  static fromEnv(env: Record<string, string | undefined>, deps: TursoManagementDeps = {}): TursoManagement {
    const read = (key: string): string | undefined => {
      const value = env[key];
      return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
    };
    const token = read('TURSO_API_TOKEN');
    const organization = read('TURSO_ORGANIZATION');
    if (!token || !organization) {
      throw new Error(
        '[wod db] management credentials required: set TURSO_API_TOKEN and TURSO_ORGANIZATION in the environment ' +
        '(or .env). Management tokens are never accepted as flags and never printed.',
      );
    }
    return new TursoManagement(organization, token, deps);
  }

  private async request(op: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const base = this.deps.apiBase ?? 'https://api.turso.tech';
    let response: Response;
    try {
      response = await (this.deps.fetchFn ?? fetch)(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new Error(`[wod db] ${op}: ${maskSecrets(error instanceof Error ? error.message : String(error), this.token)}`, { cause: error });
    }
    if (!response.ok) {
      let detail = '';
      try {
        const parsed: unknown = await response.json();
        if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
          detail = parsed.error;
        }
      } catch {
        // non-JSON error body — status text below is enough
      }
      throw new Error(
        `[wod db] ${op}: Turso API ${response.status} ${maskSecrets(detail || response.statusText, this.token)}`,
      );
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (text.trim() === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`[wod db] ${op}: Turso API returned a non-JSON body with status ${response.status}`);
    }
  }

  async getDatabase(name: string): Promise<DatabaseInfo | undefined> {
    try {
      const payload: unknown = await this.request(
        `get database ${name}`, 'GET',
        `/v1/organizations/${encodeURIComponent(this.organization)}/databases/${encodeURIComponent(name)}`,
      );
      if (typeof payload !== 'object' || payload === null || !('database' in payload)) {
        throw new Error(`[wod db] get database ${name}: Turso API payload has no database field`);
      }
      return toDatabaseInfo(payload.database);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Turso API 404')) return undefined;
      throw error;
    }
  }

  async createDatabase(input: { name: string; group: string; seed?: { type: 'database'; name: string } }): Promise<DatabaseInfo> {
    const payload: unknown = await this.request(
      `create database ${input.name}`, 'POST',
      `/v1/organizations/${encodeURIComponent(this.organization)}/databases`,
      input,
    );
    if (typeof payload !== 'object' || payload === null || !('database' in payload)) {
      throw new Error(`[wod db] create database ${input.name}: Turso API payload has no database field`);
    }
    return toDatabaseInfo(payload.database);
  }

  /** Mint a database-scoped token (spec: authorization full-access|read-only). */
  async createToken(name: string, authorization: 'full-access' | 'read-only', expiration: string): Promise<string> {
    const payload: unknown = await this.request(
      `mint token for ${name}`, 'POST',
      `/v1/organizations/${encodeURIComponent(this.organization)}/databases/${encodeURIComponent(name)}` +
        `/auth/tokens?authorization=${authorization}&expiration=${encodeURIComponent(expiration)}`,
    );
    if (typeof payload !== 'object' || payload === null || !('jwt' in payload) || typeof payload.jwt !== 'string' || payload.jwt === '') {
      throw new Error(`[wod db] mint token for ${name}: Turso API returned no token`);
    }
    return payload.jwt;
  }

  async deleteDatabase(name: string): Promise<void> {
    await this.request(
      `delete database ${name}`, 'DELETE',
      `/v1/organizations/${encodeURIComponent(this.organization)}/databases/${encodeURIComponent(name)}`,
    );
  }
}

/** Narrow the Control API Database payload (external boundary — fail closed
 * on anything unexpected instead of trusting a cast). */
function toDatabaseInfo(value: unknown): DatabaseInfo {
  if (typeof value !== 'object' || value === null || !('Name' in value) || !('Hostname' in value)) {
    throw new Error('[wod db] Turso API database payload is missing Name/Hostname');
  }
  const name = value.Name;
  const hostname = value.Hostname;
  if (typeof name !== 'string' || name === '' || typeof hostname !== 'string' || hostname === '') {
    throw new Error('[wod db] Turso API database payload is missing Name/Hostname');
  }
  return {
    name,
    hostname,
    dbId: 'DbId' in value && typeof value.DbId === 'string' ? value.DbId : undefined,
    group: 'group' in value && typeof value.group === 'string' ? value.group : undefined,
  };
}

// ---------------------------------------------------------------------------
// Pairing file + opt-in .env output
// ---------------------------------------------------------------------------

export interface PairingFile {
  wodWikiPairing: 1;
  kind: 'turso';
  url: string;
  authToken: string;
  /** Org-unique database name — the UI's display label. */
  database: string;
  /** Informational snapshot of the target's sync schema at pairing time. */
  schemaVersion: number;
  createdAt: string;
}

/** Atomic 0600 secret write: unique exclusive-create temp (never follows a
 * pre-planted symlink, never inherits a planted broad mode) + rename, with
 * temp cleanup on error. */
function writeSecretFile(fs: WriteFsShim, path: string, content: string): void {
  const tmp = `${path}.${nodeCrypto().randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, content);
    fs.closeSync(fd);
    fs.renameSync(tmp, path);
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {
      // already closed by the failing step
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw error;
  }
}
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u0080-\u009f]/;

/** External-data gate: API-supplied URL/token/name must be free of control
 * characters before they reach a file, a message or the environment. */
function assertSafePairingFields(pairing: Pick<PairingFile, 'url' | 'authToken' | 'database'>): void {
  for (const [what, value] of [['target URL', pairing.url], ['auth token', pairing.authToken], ['database name', pairing.database]] as const) {
    if (CONTROL_CHARS.test(value)) {
      throw new Error(`[wod db] refusing: ${what} contains control characters (hostile API response)`);
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(pairing.url);
  } catch {
    throw new Error('[wod db] refusing: target URL is not parseable');
  }
  if (parsed.protocol !== 'libsql:' || parsed.hostname === '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('[wod db] refusing: target URL must be a plain libsql://<hostname>');
  }
}

/** Exclusive pairing file (0600) — an existing file is never silently
 * replaced; --force replaces through a unique 0600 temp + rename so the new
 * credential never sits in a file with the old (possibly wider) permissions. */
export function writePairingFile(path: string, pairing: PairingFile, opts: { force?: boolean } = {}): void {
  const fs = fullFs();
  if (fs.existsSync(path) && !opts.force) {
    throw new Error(`[wod db] refusing to overwrite existing pairing file ${path} (it contains a credential) — pass --force to replace it`);
  }
  assertSafePairingFields(pairing);
  writeSecretFile(fs, path, JSON.stringify(pairing, null, 2) + '\n');
}

const ENV_GUARD_KEYS = [
  'DB_DRIVER',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'LIBSQL_AUTH_TOKEN',
  'WOD_WIKI_DB',
  'SQLITE_PATH',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_SSL',
] as const;

/** Opt-in atomic .env merge: appends the turso target block, preserves every
 * unrelated line, and REFUSES when any database setting already exists. The
 * URL/token are validated as external data before touching the file. */
export function appendTursoEnv(envPath: string, target: { url: string; authToken: string }, now: Date): void {
  assertSafePairingFields({ url: target.url, authToken: target.authToken, database: 'wod-wiki' });
  const fs = fullFs();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const parsed = existing ? parseEnvContent(existing) : {};
  const present = ENV_GUARD_KEYS.filter((key) => typeof parsed[key] === 'string' && parsed[key].trim() !== '');
  if (present.length > 0) {
    throw new Error(
      `[wod db] refusing to modify ${envPath}: conflicting database selectors already set (${present.join(', ')}) — resolve them manually first; an appended Turso target would be ambiguous`,
    );
  }
  const block =
    `\n# wod db pair — added ${now.toISOString()}\n` +
    `DB_DRIVER=turso\nTURSO_DATABASE_URL=${target.url}\nTURSO_AUTH_TOKEN=${target.authToken}\n`;
  writeSecretFile(fs, envPath, existing + block);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface DbAdminDeps {
  fetchFn?: typeof fetch;
  now?: () => Date;
  /** Test seam: map a provisioned hostname to a client URL. */
  databaseUrl?: (hostname: string) => string;
  /** Test seam: runs after the Control API created a copy, before verification. */
  midCopyHook?: (copyName: string) => Promise<void>;
}

export interface DbAdminIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface DbCommandArgs {
  action?: string;
  /** First positional: source database name (backup/restore/migrate/delete/pair). */
  name?: string;
  /** --name: explicit target database name. */
  dbName?: string;
  group?: string;
  /** --yes <name>: exact deletion confirmation. */
  yes?: string;
  output?: string;
  writeEnv?: boolean;
  writersRetired?: boolean;
  allowEmpty?: boolean;
  force?: boolean;
  /** --env-file the CLI loaded (the .env --write-env appends to). */
  envFile?: string;
  env: Record<string, string | undefined>;
}

const DB_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertDbName(name: string, what: string): void {
  if (!DB_NAME_PATTERN.test(name)) {
    throw new Error(`[wod db] ${what} must match [a-z0-9][a-z0-9-]{0,63}, got "${name}"`);
  }
}

function requireOutput(action: string, output?: string): string {
  if (!output || output === '-') {
    throw new Error(`[wod db ${action}] a pairing file path is required (-o <file>) — credentials are never printed`);
  }
  return output;
}

function requireSource(name: string | undefined, action: string): string {
  if (!name) {
    throw new Error(`[wod db ${action}] missing source database name — usage: wod db ${action} <source> [options]`);
  }
  return name;
}

function requireGroup(action: string, group?: string): string {
  if (!group || group.trim() === '') {
    throw new Error(`[wod db ${action}] missing --group <name> — the Turso group must already exist`);
  }
  return group.trim();
}

/** Copy/migrate targets land in the source's group; when the API response
 * omits it, an explicit --group is required — never assumed. */
function requireSourceGroup(action: string, info: DatabaseInfo, args: DbCommandArgs): string {
  if (info.group) return info.group;
  if (args.group && args.group.trim() !== '') return args.group.trim();
  throw new Error(`[wod db ${action}] the Turso API did not report a group for "${info.name}" — pass --group <name> explicitly`);
}

function requireWritersRetired(action: string, source: string, ack: boolean | undefined): void {
  if (!ack) {
    throw new Error(
      `[wod db ${action}] refusing to read a live source: retire its writers first (stop sync on every device), ` +
      `then pass --writers-retired to acknowledge "${source}" is frozen for the duration of the copy`,
    );
  }
}

// Lazy on purpose: '@libsql/client' (node driver) and 'fake-indexeddb' /
// '@bitcobblers/wod-wiki-storage/idb' must stay external in the CLI bundle
// and out of browser graphs — the same seam as ./db's loadSql().
async function openLibsql(url: string, authToken: string | undefined, deps: DbAdminDeps): Promise<Database> {
  const [{ createClient }, sql] = await Promise.all([
    import(/* @vite-ignore */ '@libsql/client') as Promise<{ createClient: (config: { url: string; authToken?: string }) => LibsqlClient }>,
    loadSqlLifecycle(),
  ]);
  const connectionUrl = deps.databaseUrl?.(new URL(url).hostname) ?? url;
  return sql.libsqlDatabase(createClient({ url: connectionUrl, authToken }));
}

async function closeQuietly(db: Database): Promise<void> {
  await db.close().catch(() => undefined);
}

/** libsql URL for a provisioned hostname (provisioning answer is authoritative). */
function targetUrl(hostname: string): string {
  return `libsql://${hostname}`;
}

// ---------------------------------------------------------------------------
// Verification: replay equality
// ---------------------------------------------------------------------------

/** Structural equality incl. per-byte binary rows — the codec decodes BLOBs
 * to ArrayBuffer, so raw object comparison would see "no keys" on both sides
 * and wrongly pass. */
function snapshotValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aBytes = a instanceof ArrayBuffer ? new Uint8Array(a)
    : ArrayBuffer.isView(a) ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : undefined;
  const bBytes = b instanceof ArrayBuffer ? new Uint8Array(b)
    : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : undefined;
  if (aBytes !== undefined || bBytes !== undefined) {
    return aBytes !== undefined && bBytes !== undefined
      && aBytes.length === bBytes.length && aBytes.every((byte, i) => byte === bBytes[i]);
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  return aKeys.every((key) => key in bRecord && snapshotValueEqual(aRecord[key], bRecord[key]));
}

/** Full-restoration proof: the freshly written target must replay EXACTLY
 * the written snapshot — same groups, revisions, timestamps and payloads. */
async function assertReplayMatches(sql: SqlLifecycleApi, target: Database, entries: SyncEntry[]): Promise<void> {
  const ops: StoredSyncOp[] = [];
  for (;;) {
    const window = await sql.fetchSyncOps(target, ops.length === 0 ? 0 : ops[ops.length - 1].rev, 10_000);
    if (window.length === 0) break;
    ops.push(...window);
  }
  const expected = entries.flatMap((entry, entryIndex) =>
    entry.ops.map((mutation, idx) => ({ opId: `${entry.id}:${idx}`, rev: entryIndex + 1, idx, at: entry.at, mutation })));
  if (ops.length !== expected.length) {
    throw new Error(`[wod db migrate] replay verification failed: target has ${ops.length} ops, snapshot has ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    const got = ops[i];
    const want = expected[i];
    if (got.opId !== want.opId || got.rev !== want.rev || got.idx !== want.idx || got.at !== want.at
      || !snapshotValueEqual(got.mutation, want.mutation)) {
      throw new Error(`[wod db migrate] replay verification failed at op ${i} (${want.opId}) — target diverges from the validated snapshot`);
    }
  }
}

// ---------------------------------------------------------------------------
// Logical migration (fresh target, source retained)
// ---------------------------------------------------------------------------

const OPS_PER_GROUP = 200;

function classifySource(probe: SyncTargetKind, source: string): { fromVersion: number; legacy: boolean } {
  if (probe === 'empty') throw new Error(`[wod db migrate] ${source} is empty — nothing to migrate`);
  if (probe.kind === 'unknown') throw new Error(`[wod db migrate] ${source} holds foreign data — refusing to touch it`);
  if (probe.kind === 'current') {
    if (probe.schemaVersion === 0) throw new Error(`[wod db migrate] ${source} is an incomplete migration target (constructing marker) — it was never validated`);
    if (probe.schemaVersion > DB_VERSION) throw new Error(`[wod db migrate] ${source} is schema v${probe.schemaVersion}, newer than this CLI (v${DB_VERSION}) — refusing`);
    if (probe.schemaVersion === DB_VERSION) throw new Error(`[wod db migrate] ${source} is already at schema v${DB_VERSION} — nothing to migrate`);
    return { fromVersion: probe.schemaVersion, legacy: false };
  }
  if (probe.schemaVersion > DB_VERSION) {
    throw new Error(`[wod db migrate] ${source} legacy schema v${probe.schemaVersion} is newer than this CLI (v${DB_VERSION}) — refusing`);
  }
  return { fromVersion: probe.schemaVersion, legacy: true };
}

/** Shared adapter conversion — fake-indexeddb is loaded ONLY here, in the
 * trusted CLI runtime, before convertSyncSource touches globalThis.indexedDB.
 * The root module is typed ('auto' is not); its exports are mirrored onto
 * globalThis exactly as fake-indexeddb/auto would. */
async function convertSource(source: Database, fromVersion: number, legacy: boolean): Promise<SyncMutation[]> {
  const fake = await import(/* @vite-ignore */ 'fake-indexeddb');
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(fake)) {
    if (key !== 'default') globals[key] = value;
  }
  globals.indexedDB = new fake.IDBFactory();
  const idb = await import(/* @vite-ignore */ '@bitcobblers/wod-wiki-storage/idb') as {
    convertSyncSource(db: Database, fromVersion: number, legacy: boolean): Promise<SyncMutation[]>;
  };
  return idb.convertSyncSource(source, fromVersion, legacy);
}

function snapshotEntries(mutations: SyncMutation[], snapshotId: string, at: number): SyncEntry[] {
  const entries: SyncEntry[] = [];
  for (let start = 0; start < mutations.length; start += OPS_PER_GROUP) {
    entries.push({ id: `${snapshotId}-${entries.length}`, at, ops: mutations.slice(start, start + OPS_PER_GROUP) });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async function runCreate(mgmt: TursoManagement, args: DbCommandArgs, deps: DbAdminDeps, io: DbAdminIo, now: Date): Promise<void> {
  const output = requireOutput('create', args.output);
  const group = requireGroup('create', args.group);
  const dbName = args.dbName ?? `wod-wiki-v${DB_VERSION}`;
  assertDbName(dbName, 'database name');
  if (await mgmt.getDatabase(dbName)) {
    throw new Error(`[wod db create] database "${dbName}" already exists — pair it with \`wod db pair ${dbName}\` or choose --name`);
  }
  const created = await mgmt.createDatabase({ name: dbName, group });
  const url = targetUrl(created.hostname);
  const token = await mgmt.createToken(dbName, 'full-access', 'never');
  const db = await openLibsql(url, token, deps);
  let probe: SyncTargetKind;
  try {
    probe = await (await loadSqlLifecycle()).probeSyncTarget(db);
  } finally {
    await closeQuietly(db);
  }
  if (probe !== 'empty') {
    throw new Error(`[wod db create] freshly provisioned "${dbName}" probed as ${JSON.stringify(probe)}, expected empty — refusing to pair`);
  }
  const pairing = {
    wodWikiPairing: 1 as const, kind: 'turso' as const, url, authToken: token,
    database: dbName, schemaVersion: DB_VERSION, createdAt: now.toISOString(),
  };
  try {
    writePairingFile(output, pairing, { force: args.force });
    if (args.writeEnv) appendTursoEnv(envPath(args), { url, authToken: token }, now);
  } catch (error) {
    io.stderr(
      `[wod db create] pairing/config write failed (${error instanceof Error ? error.message : String(error)}) — ` +
      `the database "${dbName}" was created and was NOT deleted; recover with \`wod db pair ${dbName} --allow-empty -o <file>\`. No settings were changed.`,
    );
    throw error;
  }
  io.stdout(`[wod db create] provisioned ${dbName} (${created.hostname}, group ${group}) — empty target ready for the browser's first bootstrap`);
  io.stdout(`[wod db create] pairing file: ${output}${args.writeEnv ? `; wrote ${envPath(args)}` : ''}`);
}

function envPath(args: DbCommandArgs): string {
  return args.envFile ?? '.env';
}

interface CopyOutcome {
  info: DatabaseInfo;
  fingerprint: DatabaseFingerprint;
}

async function copyNative(
  kind: 'backup' | 'restore',
  mgmt: TursoManagement,
  args: DbCommandArgs,
  deps: DbAdminDeps,
  io: DbAdminIo,
  now: Date,
): Promise<CopyOutcome> {
  const source = requireSource(args.name, kind);
  requireWritersRetired(kind, source, args.writersRetired);
  requireOutput(kind, args.output);
  const info = await mgmt.getDatabase(source);
  if (!info) throw new Error(`[wod db ${kind}] database not found: ${source}`);
  const copyName = args.dbName ?? `${sanitizeDbName(source)}-${kind}-${stamp(now)}`;
  assertDbName(copyName, 'copy name');
  if (copyName === source) {
    throw new Error(`[wod db ${kind}] the copy must be a NEW database — "${copyName}" is the source itself`);
  }
  if (await mgmt.getDatabase(copyName)) {
    throw new Error(`[wod db ${kind}] target "${copyName}" already exists — choose --name`);
  }

  const sql = await loadSqlLifecycle();
  const group = requireSourceGroup(kind, info, args);
  // Read-only, short-lived source credential: the copy path cannot mutate
  // the source even if the rest of the flow went wrong. The connection stays
  // open until after verification — the CAS re-reads it.
  const sourceToken = await mgmt.createToken(source, 'read-only', '1h');
  const sourceDb = await openLibsql(targetUrl(info.hostname), sourceToken, deps);
  try {
    const before = await sql.databaseFingerprint(sourceDb);

    const copy = await mgmt.createDatabase({
      name: copyName, group, seed: { type: 'database', name: source },
    });
    if (deps.midCopyHook) await deps.midCopyHook(copyName);

    const copyToken = await mgmt.createToken(copyName, 'read-only', '1h');
    const copyDb = await openLibsql(targetUrl(copy.hostname), copyToken, deps);
    let after: DatabaseFingerprint;
    try {
      after = await sql.assertDatabaseCopyMatches(sourceDb, copyDb, before);
    } finally {
      await closeQuietly(copyDb);
    }
    return finishCopy(kind, mgmt, args, io, now, copy, after);
  } finally {
    await closeQuietly(sourceDb);
  }
}

/** Backups stay read-only; only current-schema restore copies are writable. */
async function finishCopy(
  kind: 'backup' | 'restore',
  mgmt: TursoManagement,
  args: DbCommandArgs,
  io: DbAdminIo,
  now: Date,
  copy: DatabaseInfo,
  after: DatabaseFingerprint,
): Promise<CopyOutcome> {
  io.stdout(
    `[wod db ${kind}] native copy "${copy.name}" verified: ${after.tables} tables, ${after.rows} rows, ` +
    `digest ${after.digest.slice(0, 8)} — source retained unchanged`,
  );
  if (kind === 'backup' || after.sync === undefined || after.sync.schema !== DB_VERSION) {
    const schemaLabel = after.sync === undefined ? '(legacy, no sync state)' : `v${after.sync.schema}`;
    io.stdout(
      `[wod db ${kind}] copy is schema ${schemaLabel} — retained as a read-only archive, NOT pairable for sync. ` +
      `Use \`wod db restore ${copy.name}\` for a writable current-schema copy or \`wod db migrate ${copy.name}\` to convert an older schema.`,
    );
    if (args.output && args.output !== '-') {
      const roToken = await mgmt.createToken(copy.name, 'read-only', 'never');
      writePairingFile(args.output, {
        wodWikiPairing: 1, kind: 'turso', url: targetUrl(copy.hostname), authToken: roToken,
        database: copy.name, schemaVersion: after.sync === undefined ? 0 : after.sync.schema,
        createdAt: now.toISOString(),
      }, { force: args.force });
      io.stdout(`[wod db ${kind}] read-only archive pairing file: ${args.output}`);
    }
    return { info: copy, fingerprint: after };
  }
  try {
    await pairTarget(mgmt, args, io, now, copy.name, copy.hostname, after.sync.schema);
  } catch (error) {
    io.stderr(
      `[wod db ${kind}] pairing/config write failed (${error instanceof Error ? error.message : String(error)}) — ` +
      `the verified copy "${copy.name}" was NOT deleted; recover with \`wod db pair ${copy.name} -o <file>\`. No settings were changed.`,
    );
    throw error;
  }
  return { info: copy, fingerprint: after };
}

async function runMigrate(
  mgmt: TursoManagement,
  args: DbCommandArgs,
  deps: DbAdminDeps,
  io: DbAdminIo,
  now: Date,
): Promise<void> {
  const source = requireSource(args.name, 'migrate');
  requireWritersRetired('migrate', source, args.writersRetired);
  const output = requireOutput('migrate', args.output);
  const info = await mgmt.getDatabase(source);
  if (!info) throw new Error(`[wod db migrate] database not found: ${source}`);

  const sql = await loadSqlLifecycle();
  const sourceToken = await mgmt.createToken(source, 'read-only', '1h');
  const sourceDb = await openLibsql(targetUrl(info.hostname), sourceToken, deps);
  let before: DatabaseFingerprint;
  let entries: SyncEntry[];
  try {
    before = await sql.databaseFingerprint(sourceDb);
    const classified = classifySource(await sql.probeSyncTarget(sourceDb), source);
    const mutations = await convertSource(sourceDb, classified.fromVersion, classified.legacy);
    if (mutations.length === 0) {
      throw new Error('[wod db migrate] conversion produced no rows — refusing to create an empty target');
    }
    entries = snapshotEntries(mutations, `m${classified.fromVersion}-${before.digest.slice(0, 8)}`, now.getTime());
    // Shared policy gate: puts-only + pin closure (packages/storage sql/backup).
    sql.assertPolicySnapshot(entries.flatMap((entry) => entry.ops));
  } finally {
    await closeQuietly(sourceDb);
  }

  const targetName = args.dbName ?? `${sanitizeDbName(source)}-v${DB_VERSION}`;
  assertDbName(targetName, 'target name');
  if (targetName === source) {
    throw new Error('[wod db migrate] the target must be a NEW database — retention keeps the source at its own name');
  }
  if (await mgmt.getDatabase(targetName)) {
    throw new Error(`[wod db migrate] target "${targetName}" already exists — choose --name (a fresh, exclusively reserved target is required)`);
  }

  const created = await mgmt.createDatabase({ name: targetName, group: requireSourceGroup('migrate', info, args) });
  let token: string;
  let committed: number;
  try {
    token = await mgmt.createToken(targetName, 'full-access', 'never');
    const target = await openLibsql(targetUrl(created.hostname), token, deps);
    try {
      // Empty-target reservation: only 'empty' may be claimed, and the
      // constructing marker (schema 0) keeps it unpairable until finalize.
      const probe = await sql.probeSyncTarget(target);
      if (probe !== 'empty') throw new Error(`[wod db migrate] target "${targetName}" is not empty (${JSON.stringify(probe)}) — refusing`);
      await sql.initSyncTarget(target, 0);
      committed = await sql.applySyncBatch(target, entries, { expectSchema: 0 });
      await assertReplayMatches(sql, target, entries);
      // Source CAS: everything above read one frozen snapshot.
      const sourceDbRecheck = await openLibsql(targetUrl(info.hostname), sourceToken, deps);
      try {
        await sql.assertDatabaseCopyMatches(sourceDbRecheck, sourceDbRecheck, before);
      } finally {
        await closeQuietly(sourceDbRecheck);
      }
      await sql.finalizeMigrationTarget(target, DB_VERSION, committed);
    } finally {
      await closeQuietly(target);
    }
  } catch (error) {
    // Only failures BEFORE finalize leave the target at the schema-0 marker.
    io.stderr(
      `[wod db migrate] target "${targetName}" was left INCOMPLETE and is not pairable (constructing marker). ` +
      `Inspect or remove it: \`wod db delete ${targetName} --yes ${targetName}\`. The source "${source}" was not modified.`,
    );
    throw error;
  }
  // Finalized: the target is complete at the current schema. A config write
  // failure must NOT delete it or switch any settings — recovery is explicit.
  try {
    writePairingFile(output, {
      wodWikiPairing: 1, kind: 'turso', url: targetUrl(created.hostname), authToken: token,
      database: targetName, schemaVersion: DB_VERSION, createdAt: now.toISOString(),
    }, { force: args.force });
    if (args.writeEnv) appendTursoEnv(envPath(args), { url: targetUrl(created.hostname), authToken: token }, now);
  } catch (error) {
    io.stderr(
      `[wod db migrate] pairing/config write failed (${error instanceof Error ? error.message : String(error)}) — ` +
      `the target "${targetName}" is complete at v${DB_VERSION} and was NOT deleted; recover with \`wod db pair ${targetName} -o <file>\`. No settings were changed.`,
    );
    throw error;
  }
  io.stdout(
    `[wod db migrate] ${source} (schema ${before.sync ? `v${before.sync.schema}` : 'legacy'}) → ${targetName} at v${DB_VERSION}: ` +
    `${entries.length} groups / ${committed} committed, replay + pins + source CAS verified — source retained`,
  );
  io.stdout(`[wod db migrate] pairing file: ${output}${args.writeEnv ? `; wrote ${envPath(args)}` : ''}`);
}

async function runDelete(args: DbCommandArgs, io: DbAdminIo, deps: DbAdminDeps): Promise<void> {
  const name = requireSource(args.name, 'delete');
  if (!args.yes) {
    throw new Error(`[wod db delete] deletion requires exact confirmation: wod db delete ${name} --yes ${name}`);
  }
  if (args.yes !== name) {
    throw new Error(`[wod db delete] confirmation mismatch: --yes "${args.yes}" does not exactly match "${name}" — nothing was deleted`);
  }
  await TursoManagement.fromEnv(args.env, { fetchFn: deps.fetchFn }).deleteDatabase(name);
  io.stdout(`[wod db delete] deleted ${name}`);
}

async function pairTarget(
  mgmt: TursoManagement,
  args: DbCommandArgs,
  io: DbAdminIo,
  now: Date,
  dbName: string,
  hostname: string,
  schemaVersion: number,
): Promise<void> {
  const output = requireOutput('pair', args.output);
  const token = await mgmt.createToken(dbName, 'full-access', 'never');
  const url = targetUrl(hostname);
  writePairingFile(output, {
    wodWikiPairing: 1, kind: 'turso', url, authToken: token,
    database: dbName, schemaVersion, createdAt: now.toISOString(),
  }, { force: args.force });
  if (args.writeEnv) appendTursoEnv(envPath(args), { url, authToken: token }, now);
  io.stdout(`[wod db pair] ${dbName} (${hostname}) at schema v${schemaVersion} — pairing file: ${output}${args.writeEnv ? `; wrote ${envPath(args)}` : ''}`);
}

async function runPair(mgmt: TursoManagement, args: DbCommandArgs, deps: DbAdminDeps, io: DbAdminIo, now: Date): Promise<void> {
  const name = requireSource(args.name, 'pair');
  const info = await mgmt.getDatabase(name);
  if (!info) throw new Error(`[wod db pair] database not found: ${name}`);
  const sql = await loadSqlLifecycle();
  // Probe with a short-lived read-only token BEFORE minting the client token.
  const probeToken = await mgmt.createToken(name, 'read-only', '1h');
  const db = await openLibsql(targetUrl(info.hostname), probeToken, deps);
  let probe: SyncTargetKind;
  try {
    await db.query('SELECT 1');
    probe = await sql.probeSyncTarget(db);
    // Full-replay policy validation for current targets: every op row is
    // re-validated at the boundary and the pin closure must hold before a
    // browser credential is issued.
    if (probe !== 'empty' && probe.kind === 'current') {
      const ops: StoredSyncOp[] = [];
      let cursor = 0;
      for (;;) {
        const window = await sql.fetchSyncOps(db, cursor, 10_000);
        if (window.length === 0) break;
        ops.push(...window);
        cursor = window[window.length - 1].rev;
      }
      // Live-state pin closure — the log may legitimately hold delete/clear
      // tombstones; only live sessions/notes need live immutable revisions.
      sql.assertLogPinClosure(ops);
    }
  } finally {
    await closeQuietly(db);
  }
  if (probe === 'empty') {
    if (!args.allowEmpty) {
      throw new Error(`[wod db pair] ${name} is empty — it is only pairable for a deliberate first bootstrap (--allow-empty), after \`wod db create\`, or once a browser initialized it`);
    }
    await pairTarget(mgmt, args, io, now, name, info.hostname, DB_VERSION);
    return;
  }
  if (probe.kind === 'unknown') {
    throw new Error(`[wod db pair] ${name} holds foreign data — refusing to pair`);
  }
  if (probe.kind === 'legacy') {
    throw new Error(`[wod db pair] ${name} is a legacy direct-Turso database (v${probe.schemaVersion}) — run \`wod db migrate ${name}\` first`);
  }
  if (probe.schemaVersion === 0) {
    throw new Error(`[wod db pair] ${name} is an incomplete migration target (constructing marker) — it was never validated and stays unpairable`);
  }
  if (probe.schemaVersion !== DB_VERSION) {
    throw new Error(`[wod db pair] ${name} is schema v${probe.schemaVersion}, this CLI manages v${DB_VERSION} — run \`wod db migrate ${name}\` first`);
  }
  await pairTarget(mgmt, args, io, now, name, info.hostname, probe.schemaVersion);
}

function sanitizeDbName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return cleaned === '' ? 'wod-wiki' : cleaned.slice(0, 64).replace(/-+$/, '');
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').toLowerCase();
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** `wod db <action>` entry — called from the runner with resolved args.
 * Usage errors surface before credentials are required; `delete` validates
 * its exact-name confirmation before reading the management env. */
export async function runDbCommand(args: DbCommandArgs, io: DbAdminIo, deps: DbAdminDeps = {}): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const mgmt = (): TursoManagement => TursoManagement.fromEnv(args.env, { fetchFn: deps.fetchFn });
  switch (args.action) {
    case 'create':
      return runCreate(mgmt(), args, deps, io, now);
    case 'backup':
    case 'restore':
      await copyNative(args.action, mgmt(), args, deps, io, now);
      return;
    case 'migrate':
      return runMigrate(mgmt(), args, deps, io, now);
    case 'delete':
      return runDelete(args, io, deps);
    case 'pair':
      return runPair(mgmt(), args, deps, io, now);
    default:
      throw new Error(
        `[wod db] unknown action "${args.action ?? ''}" — usage: wod db <create|backup|restore|migrate|delete|pair> [name] [options]`,
      );
  }
}
