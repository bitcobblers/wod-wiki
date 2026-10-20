/**
 * Native-copy verification + migration finalize — the pure-SQL seam the CLI
 * `wod db backup/restore/migrate` commands run over any libsql Database.
 *
 *  - databaseFingerprint: canonical sha-256 over EVERY user table (schema
 *    SQL + sorted typed-cell rows + the sync state row), so a Turso native
 *    seed-copy can be proven row- and binary-identical (BLOB bytes are hex
 *    encoded — JSON.stringify(ArrayBuffer) would collapse to {}) before any
 *    credential is minted or paired. Rows are encoded as typed cells inside
 *    JSON arrays and SORTED, so framing is unambiguous and rowid/physical
 *    order differences after a native copy cannot produce a false mismatch.
 *  - assertDatabaseCopyMatches: interrupted-copy AND concurrent-source
 *    refusal — the source must be unchanged since the copy started and the
 *    copy must match that exact snapshot.
 *  - finalizeMigrationTarget: CAS that flips a migration target from the
 *    non-legitimate "constructing" marker (state schema 0, unpairable by
 *    engine refusal and by `wod db pair`) to the live schema in ONE
 *    transaction, only after full replay/pin/binary validation passed.
 *
 * No source is ever mutated by these helpers (reads + one guarded state-row
 * UPDATE on the target). Fingerprint reads run inside one transaction so the
 * enumeration and the rows come from one consistent snapshot.
 */

import { StorageError } from './errors';
import { SYNC_STATE_TABLE, type StoredSyncOp, type SyncMutation } from './sync';
import type { StoreName } from '../contract';
import type { Database, SqlConnection } from './connection';

export interface DatabaseFingerprint {
  tables: number;
  rows: number;
  /** sha-256 hex over the canonical whole-database rendering. */
  digest: string;
  /** The sync protocol state row when this database carries that layout. */
  sync: { schema: number; rev: number } | undefined;
}

/** Canonical typed cell — the discriminant removes every text/number/null/
 * bytes ambiguity that raw string framing (or JSON.stringify of binary)
 * would lose. Hex keeps byte-exactness for BLOBs. */
type CanonicalCell = { s: string } | { n: number } | { i: string } | { z: null } | { b: string };

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function toCanonicalCell(value: unknown): CanonicalCell {
  if (value === null) return { z: null };
  if (typeof value === 'string') return { s: value };
  if (typeof value === 'number') return { n: value };
  if (typeof value === 'bigint') return { i: value.toString() };
  if (value instanceof Uint8Array) return { b: bytesToHex(value) };
  if (value instanceof ArrayBuffer) return { b: bytesToHex(new Uint8Array(value)) };
  throw new StorageError(500, `fingerprint cannot encode cell of type ${typeof value}`, 'bad_fingerprint_cell');
}

/** Quote a table identifier for generated SQL (embedded quotes doubled). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new StorageError(500, 'Web Crypto unavailable — cannot fingerprint the database', 'no_webcrypto');
  const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SyncMarker {
  schema: number;
  rev: number;
}

/** Validated sync state row, or undefined when the table is absent. */
async function readStateMarker(conn: SqlConnection): Promise<SyncMarker | undefined> {
  const tables = await conn.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [SYNC_STATE_TABLE],
  );
  if (tables.length === 0) return undefined;
  const rows = await conn.query(`SELECT "value" FROM ${quoteIdent(SYNC_STATE_TABLE)} WHERE "key" = 'meta'`);
  const raw = rows[0]?.value;
  if (typeof raw !== 'string') {
    throw new StorageError(400, 'sync target is not initialized', 'sync_not_initialized');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StorageError(400, 'malformed sync state row', 'bad_sync_state');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StorageError(400, 'malformed sync state row', 'bad_sync_state');
  }
  if (!('schema' in parsed) || !('rev' in parsed)) {
    throw new StorageError(400, 'sync state row is missing schema/rev', 'bad_sync_state');
  }
  const { schema, rev } = parsed;
  if (typeof schema !== 'number' || !Number.isSafeInteger(schema) || schema < 0
    || typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 0) {
    throw new StorageError(400, 'sync state schema/rev must be non-negative safe integers', 'bad_sync_state');
  }
  return { schema, rev };
}

// ponytail: whole-table fingerprint — every row is scanned and hashed per
// verify run; fine for personal workout databases, chunk by key ranges when
// a database outgrows memory.
/**
 * Canonical fingerprint of every user table (sqlite_% / libsql_% internal
 * tables excluded): per table the CREATE statement text plus its rows as
 * typed-cell JSON arrays, SORTED so physical row order cannot influence the
 * digest. Reads run inside one transaction for a consistent snapshot.
 */
export async function databaseFingerprint(db: Database): Promise<DatabaseFingerprint> {
  return db.transaction(async (tx) => {
    const tableRows = await tx.query(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table'` +
        ` AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'libsql\\_%' ESCAPE '\\'`,
    );
    const tables = tableRows
      .map((row) => ({ name: String(row.name), createSql: typeof row.sql === 'string' ? row.sql : '' }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const sections: string[] = ['wod-wiki-db-fingerprint-v2'];
    let totalRows = 0;
    for (const table of tables) {
      const rows = await tx.query(`SELECT * FROM ${quoteIdent(table.name)}`);
      totalRows += rows.length;
      const encoded = rows.map((row) => JSON.stringify(Object.values(row).map(toCanonicalCell)));
      encoded.sort();
      sections.push(`table ${table.name}`, `schema ${table.createSql}`, `rows ${rows.length}`, ...encoded);
    }
    const sync = await readStateMarker(tx);
    return { tables: tables.length, rows: totalRows, digest: await sha256(sections.join('\n')), sync };
  });
}

/**
 * Prove a native copy: the copy must equal the exact source snapshot the
 * caller fingerprinted BEFORE starting the copy (`before`), and the source
 * must not have advanced meanwhile (writers were supposed to be retired).
 * Returns the re-read source fingerprint.
 */
export async function assertDatabaseCopyMatches(
  source: Database,
  copy: Database,
  before: DatabaseFingerprint,
): Promise<DatabaseFingerprint> {
  const after = await databaseFingerprint(source);
  if (after.digest !== before.digest) {
    throw new StorageError(
      409,
      'source database changed during the copy — a writer is still active; retire all writers and retry',
      'source_moved',
    );
  }
  const copied = await databaseFingerprint(copy);
  if (copied.digest !== before.digest) {
    throw new StorageError(
      409,
      `copy is incomplete or divergent (copy: ${copied.tables} tables / ${copied.rows} rows, source: ${before.tables} tables / ${before.rows} rows)`,
      'copy_mismatch',
    );
  }
  return after;
}

/**
 * CAS-finalize a migration target constructed at the non-legitimate marker
 * schema 0: requires the state row to be exactly {schema: 0, rev:
 * expectRev}, then publishes the live schema in the same transaction. A
 * target that never reaches this call stays schema 0 — probes report
 * current/0, which no client accepts and `wod db pair` refuses.
 */
export async function finalizeMigrationTarget(db: Database, toSchema: number, expectRev: number): Promise<void> {
  if (!Number.isSafeInteger(toSchema) || toSchema < 1) {
    throw new StorageError(400, 'finalize requires a positive schema version', 'bad_sync_state');
  }
  await db.transaction(async (tx) => {
    const marker = await readStateMarker(tx);
    if (!marker || marker.schema !== 0 || marker.rev !== expectRev) {
      throw new StorageError(
        409,
        `migration target is not in constructing state (expected schema 0 at rev ${expectRev}, found ${marker ? `schema ${marker.schema} at rev ${marker.rev}` : 'no state row'})`,
        'migration_not_constructing',
      );
    }
    await tx.exec(
      `UPDATE ${quoteIdent(SYNC_STATE_TABLE)} SET "value" = ? WHERE "key" = 'meta'`,
      [JSON.stringify({ schema: toSchema, rev: expectRev })],
    );
  });
}

function pinKey(noteId: unknown, blockId: unknown, version: unknown): string {
  return `${String(noteId)}\u0000${String(blockId)}\u0000${String(version)}`;
}

/**
 * Policy snapshot validation shared by `wod db migrate` (pre-write) and
 * `wod db pair` (over the full replayed remote log): a user-scope snapshot
 * is policy-compliant PUTS ONLY — any delete/clear/wipe means non-user
 * policy operations leaked into the copy — and every session pin and note
 * block pin must have its immutable block_revisions row present (missing
 * pins fail the copy, they are never silently dropped).
 */
export function assertPolicySnapshot(ops: readonly SyncMutation[]): void {
  const revisions = new Set<string>();
  for (const mutation of ops) {
    if (mutation.op !== 'put') {
      throw new StorageError(
        400,
        `policy snapshot contains a non-put operation (${mutation.op}) — refusing`,
        'policy_violation',
      );
    }
    if (mutation.store !== 'block_revisions') continue;
    const row = mutation.value;
    if (typeof row !== 'object' || row === null || !('noteId' in row) || !('blockId' in row) || !('version' in row)) {
      throw new StorageError(400, 'block_revisions row is missing noteId/blockId/version', 'policy_violation');
    }
    revisions.add(pinKey(row.noteId, row.blockId, row.version));
  }
  const check = (noteId: unknown, blockId: unknown, version: unknown, what: string): void => {
    if (!revisions.has(pinKey(noteId, blockId, version))) {
      throw new StorageError(
        400,
        `${what} pins [${String(noteId)}, ${String(blockId)}, ${String(version)}] but the snapshot has no such immutable revision`,
        'policy_violation',
      );
    }
  };
  for (const mutation of ops) {
    if (mutation.op !== 'put') continue;
    if (mutation.store === 'sessions') {
      const row = mutation.value;
      if (typeof row !== 'object' || row === null || !('noteId' in row) || !('blockId' in row) || !('blockVersion' in row)) {
        throw new StorageError(400, 'session row is missing noteId/blockId/blockVersion', 'policy_violation');
      }
      check(row.noteId, row.blockId, row.blockVersion, 'a session');
    } else if (mutation.store === 'notes') {
      const row = mutation.value;
      if (typeof row !== 'object' || row === null || !('id' in row) || !('blocks' in row)) {
        throw new StorageError(400, 'note row is missing id/blocks', 'policy_violation');
      }
      if (typeof row.blocks !== 'object' || row.blocks === null) continue;
      for (const block of Object.values(row.blocks)) {
        if (typeof block !== 'object' || block === null || !('id' in block) || !('version' in block)) {
          throw new StorageError(400, 'note block entry is missing id/version', 'policy_violation');
        }
        check(row.id, block.id, block.version, 'a note block');
      }
    }
  }
}

function logKey(store: StoreName, key: unknown): string {
  return `${store}\u0000${JSON.stringify(key) ?? String(key)}`;
}

/**
 * Pin closure over a LIVE op log (pair verification): unlike a conversion
 * snapshot, an operational log legitimately contains delete/clear/wipe
 * tombstones, so the CURRENT row set is replayed first and only live
 * sessions/notes must find their immutable revisions. Anything deleted is
 * not required to have one.
 */
export function assertLogPinClosure(ops: readonly StoredSyncOp[]): void {
  const live = new Map<string, { store: StoreName; value: Record<string, unknown> }>();
  for (const { mutation } of ops) {
    if (mutation.op === 'put') {
      live.set(logKey(mutation.store, mutation.key), { store: mutation.store, value: mutation.value as Record<string, unknown> });
    } else if (mutation.op === 'delete') {
      live.delete(logKey(mutation.store, mutation.key));
    } else if (mutation.op === 'clear') {
      for (const key of live.keys()) {
        if (key.startsWith(`${mutation.store}\u0000`)) live.delete(key);
      }
    } else {
      live.clear();
    }
  }
  const revisions = new Set<string>();
  for (const row of live.values()) {
    if (row.store !== 'block_revisions') continue;
    if (!('noteId' in row.value) || !('blockId' in row.value) || !('version' in row.value)) {
      throw new StorageError(400, 'block_revisions row is missing noteId/blockId/version', 'policy_violation');
    }
    revisions.add(pinKey(row.value.noteId, row.value.blockId, row.value.version));
  }
  const check = (noteId: unknown, blockId: unknown, version: unknown, what: string): void => {
    if (!revisions.has(pinKey(noteId, blockId, version))) {
      throw new StorageError(
        400,
        `${what} pins [${String(noteId)}, ${String(blockId)}, ${String(version)}] but the target has no live immutable revision for it`,
        'policy_violation',
      );
    }
  };
  for (const row of live.values()) {
    if (row.store === 'sessions') {
      if (!('noteId' in row.value) || !('blockId' in row.value) || !('blockVersion' in row.value)) {
        throw new StorageError(400, 'session row is missing noteId/blockId/blockVersion', 'policy_violation');
      }
      check(row.value.noteId, row.value.blockId, row.value.blockVersion, 'a live session');
    } else if (row.store === 'notes') {
      if (!('id' in row.value) || !('blocks' in row.value)) {
        throw new StorageError(400, 'note row is missing id/blocks', 'policy_violation');
      }
      if (typeof row.value.blocks !== 'object' || row.value.blocks === null) continue;
      for (const block of Object.values(row.value.blocks)) {
        if (typeof block !== 'object' || block === null || !('id' in block) || !('version' in block)) {
          throw new StorageError(400, 'note block entry is missing id/version', 'policy_violation');
        }
        check(row.value.id, block.id, block.version, 'a live note block');
      }
    }
  }
}
