/**
 * Turso backup/sync protocol — the local-first sync tables layered on top of
 * any libsql database. The browser data plane is always IndexedDB; a saved
 * Turso target is a backup/sync destination, never the read/write provider.
 *
 * Design: the remote holds ONE op log (`_wodwiki_sync_ops`) plus a state row
 * (`_wodwiki_sync_state`) carrying {schema, rev}. Every committed local
 * transaction group appends one idempotent op-group (uuid op_id,
 * INSERT-or-ignore per op); `rev` is assigned monotonically per NEWLY applied
 * group — a retried group is recognized by its first op id, consumes no rev
 * and appends nothing. Pulls replay ops with rev > cursor in deterministic
 * (rev, idx) order. Tombstones (delete/clear/wipe) are ordinary ops —
 * deletions propagate.
 *
 * Fetch atomicity: a pull window is a set of WHOLE revision groups. The rev
 * boundary is chosen with a bounded subquery, then every row of those revs is
 * returned — a group is never split, so the cursor never skips the rest of
 * a group (one pathologically large group can exceed the nominal row bound;
 * that is the unavoidable atomicity ceiling).
 *
 * ponytail: op-log replay pulls — a fresh browser replays the whole log
 * (O(history)) instead of reading per-store current-state tables. Upgrade
 * path: add per-store state tables rev-indexed by primary key and collapse
 * the log into them periodically; the wire format (op_id, rev, mutation)
 * stays unchanged.
 *
 * Never-downgrade rule: the state row's `schema` is the managing client's
 * DB_VERSION at init time. Uploads verify `schema` INSIDE the write
 * transaction (a stale probe must not append current payloads to an old or
 * newer remote); an older remote log is migrated forward by the caller
 * (transform payloads, never just rewrite the marker), a newer remote is
 * never rewritten — the client refuses and keeps working locally.
 */

import { STORE_DEFS } from '../schema';
import type { StoreName } from '../contract';
import type { KeyDTO, Scalar } from '../wire';
import { decodeRowJson, encodeRowJson } from './codec';
import { StorageError } from './errors';
import { SCHEMA_TABLE } from './store';
import type { Database, SqlConnection, SqlStatement } from './connection';

export const SYNC_OPS_TABLE = '_wodwiki_sync_ops';
export const SYNC_STATE_TABLE = '_wodwiki_sync_state';
/** Pre-migration op log copies live here — the recoverable old source,
 *  retained after a schema migration replaces the active log. */
export const SYNC_ARCHIVE_TABLE = '_wodwiki_sync_ops_archive';

/** One committed local transaction group, as journaled in IndexedDB. */
export type SyncMutation =
  | { op: 'put'; store: StoreName; key: KeyDTO; value: unknown }
  | { op: 'delete'; store: StoreName; key: KeyDTO }
  | { op: 'clear'; store: StoreName }
  | { op: 'wipe' };

export interface SyncEntry {
  /** Idempotency key — one uuid per committed local transaction group. */
  id: string;
  at: number;
  ops: SyncMutation[];
}

export interface StoredSyncOp {
  opId: string;
  rev: number;
  idx: number;
  at: number;
  mutation: SyncMutation;
}

export type SyncTargetKind =
  /** No tables at all (beyond libsql internals): fresh database. */
  | 'empty'
  /** Tables exist but neither sync state nor a legacy schema guard — not
   *  ours; initializing over unknown data is refused by the caller. */
  | { kind: 'unknown' }
  /** Legacy direct-Turso SqlStorage layout (`_wodwiki_schema` guard). */
  | { kind: 'legacy'; schemaVersion: number }
  /** This sync protocol's layout; payload = state row. */
  | { kind: 'current'; schemaVersion: number; rev: number };

interface SyncStateRow {
  schema: number;
  rev: number;
}

/** Stores whose rows carry a raw binary field the codec must preserve. */
const BINARY_FIELD: Record<string, string> = { attachments: 'data' };

const STORE_NAMES: Record<string, true> = Object.fromEntries(STORE_DEFS.map((d) => [d.name, true]));

const STATE_KEY = 'meta';

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/** Trust-boundary key check — mirrors wire.validateKey (kept local to keep
 *  the sql subpath free of runtime wire imports beyond types). */
function assertKey(key: unknown, what: string): asserts key is KeyDTO {
  if (isScalar(key)) return;
  if (Array.isArray(key) && key.length > 0 && key.every(isScalar)) return;
  throw new StorageError(400, `${what} must be a string, finite number, or non-empty scalar tuple`, 'bad_sync_key');
}

/** Validate one decoded mutation at the external-data trust boundary. */
function validateMutation(raw: unknown): SyncMutation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StorageError(400, 'sync mutation must be an object', 'bad_sync_mutation');
  }
  const mutation = raw as Record<string, unknown>;
  if (mutation.op === 'wipe') return { op: 'wipe' };
  if (typeof mutation.store !== 'string' || !STORE_NAMES[mutation.store]) {
    throw new StorageError(400, `sync mutation has unknown store ${String(mutation.store)}`, 'bad_sync_mutation');
  }
  const store = mutation.store as StoreName;
  if (mutation.op === 'clear') return { op: 'clear', store };
  if (mutation.op === 'delete') {
    assertKey(mutation.key, 'sync delete key');
    return { op: 'delete', store, key: mutation.key };
  }
  if (mutation.op === 'put') {
    assertKey(mutation.key, 'sync put key');
    if (mutation.value === null || typeof mutation.value !== 'object' || Array.isArray(mutation.value)) {
      throw new StorageError(400, 'sync put value must be an object row', 'bad_sync_mutation');
    }
    return { op: 'put', store, key: mutation.key, value: mutation.value };
  }
  throw new StorageError(400, `sync mutation has unknown op ${String(mutation.op)}`, 'bad_sync_mutation');
}

function validateEntry(entry: SyncEntry): void {
  if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 200) {
    throw new StorageError(400, 'sync entry id must be a non-empty string', 'bad_sync_entry');
  }
  if (!isSafeInt(entry.at) || entry.at < 0) {
    throw new StorageError(400, 'sync entry at must be a non-negative safe integer', 'bad_sync_entry');
  }
  if (!Array.isArray(entry.ops) || entry.ops.length === 0) {
    throw new StorageError(400, 'sync entry ops must be a non-empty array', 'bad_sync_entry');
  }
  for (const op of entry.ops) validateMutation(op);
}

/** Run statements inside a transaction, preferring one native batch. */
async function runStatements(tx: SqlConnection, statements: SqlStatement[]): Promise<unknown[][]> {
  if (statements.length === 0) return [];
  if (tx.batch) return tx.batch(statements);
  const results: unknown[][] = [];
  for (const statement of statements) {
    results.push(await tx.query(statement.sql, statement.params ?? []));
  }
  return results;
}

async function tableExists(conn: SqlConnection, dialect: Database['dialect'], name: string): Promise<boolean> {
  const sql = dialect === 'postgres'
    ? `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`
    : `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`;
  return (await conn.query(sql, [name])).length > 0;
}

/** Read + validate the sync state row (trusted shape afterwards). */
async function readSyncState(tx: SqlConnection): Promise<SyncStateRow> {
  const rows = await tx.query(`SELECT "value" FROM "${SYNC_STATE_TABLE}" WHERE "key" = ?`, [STATE_KEY]);
  if (!rows[0]) throw new StorageError(409, 'sync target is not initialized', 'sync_not_initialized');
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(rows[0].value));
  } catch {
    throw new StorageError(400, 'malformed sync state row', 'bad_sync_state');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StorageError(400, 'malformed sync state row', 'bad_sync_state');
  }
  const state = parsed as Record<string, unknown>;
  if (!isSafeInt(state.schema) || state.schema < 0 || !isSafeInt(state.rev) || state.rev < 0) {
    throw new StorageError(400, 'sync state schema/rev must be non-negative safe integers', 'bad_sync_state');
  }
  return { schema: state.schema, rev: state.rev };
}

/** Classify the sync target WITHOUT mutating it. */
export async function probeSyncTarget(db: Database): Promise<SyncTargetKind> {
  if (await tableExists(db, db.dialect, SYNC_STATE_TABLE)) {
    const state = await readSyncState(db);
    return { kind: 'current', schemaVersion: state.schema, rev: state.rev };
  }
  if (await tableExists(db, db.dialect, SCHEMA_TABLE)) {
    const rows = await db.query(`SELECT "value" FROM "${SCHEMA_TABLE}" WHERE "key" = 'schema'`);
    if (rows[0]) {
      const guard = JSON.parse(String(rows[0].value)) as { version?: unknown };
      if (typeof guard.version === 'number' && Number.isSafeInteger(guard.version) && guard.version >= 0) {
        return { kind: 'legacy', schemaVersion: guard.version };
      }
    }
    return { kind: 'legacy', schemaVersion: 0 };
  }
  // Fresh-vs-unknown: any user table we do not own means foreign data.
  const others = await db.query(
    db.dialect === 'postgres'
      ? `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      : `SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  const internal = (name: string): boolean => name.startsWith('_wodwiki_') || name.startsWith('sqlite_');
  return others.some((row) => !internal(String(Object.values(row)[0]))) ? { kind: 'unknown' } : 'empty';
}

/** Create the sync tables + state row. Only for empty targets; existing
 *  state (current, legacy or unknown) is never overwritten by init. */
export async function initSyncTarget(db: Database, schemaVersion: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`CREATE TABLE IF NOT EXISTS "${SYNC_STATE_TABLE}" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`);
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS "${SYNC_OPS_TABLE}" (` +
        `"op_id" TEXT PRIMARY KEY, "rev" INTEGER NOT NULL, "idx" INTEGER NOT NULL, "at" INTEGER NOT NULL, "data" TEXT NOT NULL)`,
    );
    await tx.exec(
      `CREATE INDEX IF NOT EXISTS "${SYNC_OPS_TABLE}_rev" ON "${SYNC_OPS_TABLE}" ("rev", "idx")`,
    );
    await tx.exec(
      `INSERT INTO "${SYNC_STATE_TABLE}" ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO NOTHING`,
      [STATE_KEY, JSON.stringify({ schema: schemaVersion, rev: 0 } satisfies SyncStateRow)],
    );
  });
}

function encodeMutation(mutation: SyncMutation): string {
  if (mutation.op !== 'put') return JSON.stringify(mutation);
  // The binary codec applies to the ROW (mutation.value), not the mutation
  // envelope — attachments.data carries the raw bytes.
  const encoded = encodeRowJson(mutation.value, BINARY_FIELD[mutation.store]);
  return `{"key":${JSON.stringify(mutation.key)},"op":"put","store":${JSON.stringify(mutation.store)},"value":${encoded}}`;
}

/** Decode + validate one stored op payload at the external-data boundary. */
function decodeMutation(data: unknown): SyncMutation {
  if (typeof data !== 'string') {
    throw new StorageError(400, 'sync op data must be a string', 'bad_sync_mutation');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new StorageError(400, 'sync op data is not valid JSON', 'bad_sync_mutation');
  }
  const mutation = validateMutation(parsed);
  if (mutation.op !== 'put') return mutation;
  return {
    op: 'put',
    store: mutation.store,
    key: mutation.key,
    value: decodeRowJson(JSON.stringify(mutation.value), BINARY_FIELD[mutation.store]),
  };
}

export interface ApplySyncBatchOptions {
  /** Schema the caller verified at probe time — rechecked INSIDE the write
   *  transaction so a schema change between probe and append aborts. */
  expectSchema?: number;
  /** Bump the state schema version in the SAME transaction (remote-schema
   *  migrations append converted payloads + move the marker atomically). */
  toSchemaVersion?: number;
}

/**
 * Append op-groups to the log in ONE SQL transaction, idempotently by
 * group: a group whose first op id already exists is skipped entirely and
 * consumes no rev (retries never duplicate, never allocate revisions).
 * Returns the number of NEW groups committed — ack semantics for the
 * uploader's watermark.
 */
export async function applySyncBatch(
  db: Database,
  entries: SyncEntry[],
  opts: ApplySyncBatchOptions = {},
): Promise<number> {
  if (entries.length === 0) return 0;
  for (const entry of entries) validateEntry(entry);
  return db.transaction(async (tx) => {
    const state = await readSyncState(tx);
    if (opts.expectSchema !== undefined && state.schema !== opts.expectSchema) {
      throw new StorageError(
        409,
        `sync target schema changed from v${opts.expectSchema} to v${state.schema} between probe and write — retry the cycle`,
        'sync_schema_conflict',
      );
    }
    // Group presence: one lookup on every group's first op id. Groups are
    // written whole by construction, so first-op presence ⇔ group present.
    const firstIds = entries.map((entry) => `${entry.id}:0`);
    const present = new Set<string>();
    for (let i = 0; i < firstIds.length; i += 100) {
      const chunk = firstIds.slice(i, i + 100);
      const rows = await tx.query(
        `SELECT "op_id" FROM "${SYNC_OPS_TABLE}" WHERE "op_id" IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      );
      for (const row of rows) present.add(String(row.op_id));
    }
    const statements: SqlStatement[] = [];
    let rev = state.rev;
    let committed = 0;
    for (const entry of entries) {
      if (present.has(`${entry.id}:0`)) continue;
      rev += 1;
      committed += 1;
      entry.ops.forEach((mutation, idx) => {
        statements.push({
          sql:
            `INSERT INTO "${SYNC_OPS_TABLE}" ("op_id", "rev", "idx", "at", "data") VALUES (?, ?, ?, ?, ?) ` +
            `ON CONFLICT ("op_id") DO NOTHING`,
          params: [`${entry.id}:${idx}`, rev, idx, entry.at, encodeMutation(mutation)],
        });
      });
    }
    const nextSchema = opts.toSchemaVersion ?? state.schema;
    statements.push({
      sql: `UPDATE "${SYNC_STATE_TABLE}" SET "value" = ? WHERE "key" = ?`,
      params: [JSON.stringify({ schema: nextSchema, rev } satisfies SyncStateRow), STATE_KEY],
    });
    await runStatements(tx, statements);
    return committed;
  });
}

/**
 * Replay window: ops with rev > afterRev, in deterministic commit order.
 * The window covers WHOLE revision groups: up to `limit` distinct revs are
 * chosen (bounded subquery), then every row of those revs is returned, so a
 * cursor advanced to the last returned rev never splits a group. A single
 * group larger than `limit` is returned whole — the atomicity ceiling.
 */
export async function fetchSyncOps(db: Database, afterRev: number, limit: number): Promise<StoredSyncOp[]> {
  if (!isSafeInt(afterRev) || afterRev < 0) {
    throw new StorageError(400, 'fetchSyncOps cursor must be a non-negative safe integer', 'bad_sync_cursor');
  }
  const bounded = Math.min(Math.max(1, Math.floor(limit)), 0xffffffff);
  const revRows = await db.query(
    `SELECT DISTINCT "rev" FROM (SELECT "rev" FROM "${SYNC_OPS_TABLE}" WHERE "rev" > ? ORDER BY "rev" ASC LIMIT ?)`,
    [afterRev, bounded],
  );
  const revs = revRows.map((row) => {
    const rev = Number(row.rev);
    if (!Number.isSafeInteger(rev) || rev < 0) {
      throw new StorageError(400, 'sync op rev must be a non-negative safe integer', 'bad_sync_row');
    }
    return rev;
  });
  if (revs.length === 0) return [];
  const rows = await db.query(
    `SELECT "op_id", "rev", "idx", "at", "data" FROM "${SYNC_OPS_TABLE}" WHERE "rev" IN (${revs.map(() => '?').join(', ')}) ORDER BY "rev", "idx"`,
    revs,
  );
  return rows.map((row, at) => {
    const opId = row.op_id;
    const rev = Number(row.rev);
    const idx = Number(row.idx);
    const atMs = Number(row.at);
    if (typeof opId !== 'string' || opId.length === 0 || !Number.isSafeInteger(rev) || rev < 0
      || !Number.isSafeInteger(idx) || idx < 0 || !Number.isSafeInteger(atMs) || atMs < 0) {
      throw new StorageError(400, `sync op row ${at} has malformed shape`, 'bad_sync_row');
    }
    return { opId, rev, idx, at: atMs, mutation: decodeMutation(row.data) };
  });
}

/**
 * Schema-migration replacement for the active op log, in ONE transaction:
 * every previous op is copied into the archive table (the recoverable old
 * source — nothing is destroyed), the active log is cleared, and the
 * converted snapshot groups become the entire replayable history at
 * rev 1..n with the schema marker moved forward atomically. Fresh browsers
 * replay converted payloads only, so pulls never touch legacy row shapes.
 */
export async function replaceSyncLog(db: Database, entries: SyncEntry[], toSchemaVersion: number): Promise<void> {
  if (entries.length === 0) throw new StorageError(400, 'replacement log must contain the converted snapshot', 'bad_sync_entry');
  for (const entry of entries) validateEntry(entry);
  await db.transaction(async (tx) => {
    await readSyncState(tx); // target must be initialized (throws otherwise)
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS "${SYNC_ARCHIVE_TABLE}" (` +
        `"op_id" TEXT PRIMARY KEY, "rev" INTEGER NOT NULL, "idx" INTEGER NOT NULL, "at" INTEGER NOT NULL, "data" TEXT NOT NULL)`,
    );
    await tx.exec(`INSERT INTO "${SYNC_ARCHIVE_TABLE}" ("op_id", "rev", "idx", "at", "data") SELECT "op_id", "rev", "idx", "at", "data" FROM "${SYNC_OPS_TABLE}"`);
    await tx.exec(`DELETE FROM "${SYNC_OPS_TABLE}"`);
    const statements: SqlStatement[] = [];
    let rev = 0;
    for (const entry of entries) {
      rev += 1;
      entry.ops.forEach((mutation, idx) => {
        statements.push({
          sql:
            `INSERT INTO "${SYNC_OPS_TABLE}" ("op_id", "rev", "idx", "at", "data") VALUES (?, ?, ?, ?, ?) ` +
            `ON CONFLICT ("op_id") DO NOTHING`,
          params: [`${entry.id}:${idx}`, rev, idx, entry.at, encodeMutation(mutation)],
        });
      });
    }
    statements.push({
      sql: `UPDATE "${SYNC_STATE_TABLE}" SET "value" = ? WHERE "key" = ?`,
      params: [JSON.stringify({ schema: toSchemaVersion, rev } satisfies SyncStateRow), STATE_KEY],
    });
    await runStatements(tx, statements);
  });
}

/** Migration-only raw replay: parsed op payloads WITHOUT store/key validation
 *  (old logs reference era store names like `segments`). Only
 *  migrateRemoteToCurrent consumes this — pulls use fetchSyncOps, which
 *  validates every row against the current schema. Binary cells revive. */
export interface RawSyncOp {
  op: string;
  store: string;
  key: unknown;
  value?: unknown;
}

export async function readRawSyncOps(db: Database): Promise<RawSyncOp[]> {
  const rows = await db.query(`SELECT "rev", "idx", "data" FROM "${SYNC_OPS_TABLE}" ORDER BY "rev", "idx"`);
  return rows.map((row) => {
    const rev = Number(row.rev);
    const idx = Number(row.idx);
    if (!Number.isSafeInteger(rev) || rev < 0 || !Number.isSafeInteger(idx) || idx < 0 || typeof row.data !== 'string') {
      throw new StorageError(400, 'sync op row has malformed shape', 'bad_sync_row');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      throw new StorageError(400, 'sync op data is not valid JSON', 'bad_sync_row');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new StorageError(400, 'sync op data must be an object', 'bad_sync_row');
    }
    const mutation = parsed as Record<string, unknown>;
    if (typeof mutation.op !== 'string' || typeof mutation.store !== 'string') {
      throw new StorageError(400, 'sync op must carry string op/store', 'bad_sync_row');
    }
    return {
      op: mutation.op,
      store: mutation.store,
      key: mutation.key,
      value: mutation.value === undefined || mutation.value === null
        ? undefined
        : decodeRowJson(JSON.stringify(mutation.value), BINARY_FIELD[mutation.store]),
    };
  });
}

/**
 * Import rows from a legacy direct-Turso (SqlStorage) database into op-
 * groups. Reads the per-store JSON `data` columns directly — the legacy
 * schema guard may hold an older version SqlStorage refuses to open, so the
 * rows are lifted raw, never through SqlStorage. Missing tables contribute
 * no rows; nothing is written or deleted remotely.
 */
export async function readLegacyRows(db: Database, table: string): Promise<unknown[]> {
  if (!(await tableExists(db, db.dialect, table))) return [];
  const rows = await db.query(`SELECT "data" FROM "${table}"`);
  return rows.map((row) => decodeRowJson(String(row.data), BINARY_FIELD[table]));
}
