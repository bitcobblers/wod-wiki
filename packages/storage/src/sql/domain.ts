/**
 * Domain read models + incremental projection refresh over the shared SQL
 * store tables.
 *
 * Three derived tables, rebuilt from the per-store source tables (source of
 * truth) when incompatible and refreshed per affected key inside the same
 * transaction as every mutation:
 *   domain_note  — note metadata selector + original payload
 *   query_block  — one occurrence row per block_index row, parent resolved by
 *                  exact noteId or sourcePath (ambiguous/orphan → NULL parent,
 *                  which gates ALL domain reads with 409 until healed)
 *   segment_head — MAX(version) per segment id taken BEFORE the isHistory
 *                  filter, so a superseded revision can never resurrect
 *
 * Rebuilds are guarded: a `_wodwiki_schema` row stamps the projection
 * version, so repeated ready()/boot cycles skip the rebuild while the
 * derived shape is already compatible.
 *
 * Query plans are fixed and fully validated: every value is a bound parameter,
 * names come from this module, counts run before paging, and text matching is
 * a literal substring over JS-lowercased materialized columns (Unicode-exact;
 * instr/strpos never treat % or _ as wildcards).
 *
 * `journal` is materialized in JS (sourceMatches from the wql package — the
 * exact predicate the app applies) so no SQL regex re-implementation exists.
 */

import type { Database, SqlConnection, SqlValue } from './connection';
import { StorageError } from './errors';
import { putRows, deleteRows, clearRows, listRows, storeDefinition, SCHEMA_TABLE, batchInsert, deleteIn } from './store';
import { decodeRowJson, encodeRowJson } from './codec';
import type { StoreDef } from '../schema';
import type { StoreName } from '../contract';
import {
  DOMAIN_PROJECTION_VERSION,
  type DomainPredicate,
  type DomainQueryResult,
} from '../domain';
import { isRange, keyFromValue, type KeyDTO, type RangeDTO, type TxOp } from '../wire';
// The app's own source/catalog semantics — no duplicated matchers.
import { catalogOfItem, sourceMatches } from '@bitcobblers/wod-wiki-wql';

const TABLES = ['domain_note', 'query_block', 'segment_head'] as const;

const PROJECTION_GUARD_KEY = 'domain_projection';

type SourceItem = Parameters<typeof sourceMatches>[0];

function sourceItem(row: Record<string, unknown>): SourceItem {
  const item: SourceItem = {};
  for (const key of ['id', 'noteId', 'sourceId', 'type', 'seedOrigin', 'seedChunkId', 'sourcePath', 'catalog'] as const) {
    const value = row[key];
    if (typeof value === 'string') item[key] = value;
    else if (value != null) throw new StorageError(400, `${key} must be a string`);
  }
  return item;
}

interface NoteIdentity { note_id: string; date: number | null; created_at: number }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const T = (v: unknown): SqlValue => (text(v) as SqlValue) ?? null;
const N = (v: unknown): SqlValue => num(v) ?? 0;

// ── DDL (engine-neutral; numeric suffix only differs on postgres) ──────────

function ensureDdl(db: Database): Promise<void> {
  const n = db.dialect === 'postgres' ? ' DOUBLE PRECISION' : '';
  const t = db.dialect === 'postgres' ? ' TEXT COLLATE "C"' : ' TEXT';
  const ddl = [
    `CREATE TABLE IF NOT EXISTS "domain_note" ("note_id"${t} PRIMARY KEY NOT NULL, "note_type"${t}, "catalog"${t}, "source_id"${t}, "source_path"${t}, "title"${t} NOT NULL, "created_at"${n} NOT NULL, "date"${n}, "text_search"${t} NOT NULL, "journal"${n} NOT NULL, "payload"${t} NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "idx_domain_note_date" ON "domain_note" ("date", "note_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_domain_note_created" ON "domain_note" ("created_at", "note_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_domain_note_source_path" ON "domain_note" ("source_path")`,
    `CREATE TABLE IF NOT EXISTS "query_block" ("occurrence_id"${t} PRIMARY KEY NOT NULL, "source_note_id"${t}, "parent_note_id"${t}, "content_id"${t}, "section_key"${t}, "ordinal"${n}, "data_type"${t}, "source_id"${t}, "source_path"${t}, "catalog"${t}, "effective_date"${n} NOT NULL, "created_at"${n} NOT NULL, "note_title"${t}, "normalized_text"${t} NOT NULL, "journal"${n} NOT NULL, "payload"${t} NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "idx_query_block_type" ON "query_block" ("data_type", "effective_date", "occurrence_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_query_block_parent" ON "query_block" ("parent_note_id", "ordinal")`,
    `CREATE INDEX IF NOT EXISTS "idx_query_block_content" ON "query_block" ("content_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_query_block_source_path" ON "query_block" ("source_path")`,
    `CREATE INDEX IF NOT EXISTS "idx_query_block_source_note" ON "query_block" ("source_note_id")`,
    `CREATE TABLE IF NOT EXISTS "segment_head" ("id"${t} PRIMARY KEY NOT NULL, "note_id"${t} NOT NULL, "current_version"${n} NOT NULL, "position"${n}, "search_text"${t} NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS "idx_segment_head_note" ON "segment_head" ("note_id", "id")`,
  ];
  return db.transaction(async (tx) => {
    for (const sql of ddl) await tx.exec(sql);
  });
}

// ── Batched row upserts ──────────────────────────────────────────────────────
// Every projected write path funnels through multi-row INSERTs: over remote
// Turso each statement is one HTTP round trip, so per-row loops made imports
// and saves scale linearly with row count in *latency*, not throughput.

const DOMAIN_NOTE_COLS = ['note_id','note_type','catalog','source_id','source_path','title','created_at','date','text_search','journal','payload'] as const;
const SEGMENT_HEAD_COLS = ['id','note_id','current_version','position','search_text'] as const;
const QUERY_BLOCK_COLS = ['occurrence_id','source_note_id','parent_note_id','content_id','section_key','ordinal','data_type','source_id','source_path','catalog','effective_date','created_at','note_title','normalized_text','journal','payload'] as const;

const conflictUpdate = (cols: readonly string[], keys: readonly string[]): string =>
  `ON CONFLICT (${keys.map((k) => `"${k}"`).join(', ')}) DO UPDATE SET ` +
  cols.filter((c) => !keys.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(',');

/** One domain_note row; undefined when the note has no identity (store write
 *  still succeeds — nothing to project). */
function domainNoteRow(note: Record<string, unknown>): SqlValue[] | undefined {
  const id = text(note.id);
  if (!id) return undefined;
  const source = sourceItem(note);
  return [
    id,
    T(note.type),
    T(catalogOfItem(source)),
    T(note.sourceId),
    T(note.sourcePath),
    T(note.title) ?? '',
    N(note.createdAt),
    num(note.date),
    (text(note.title) ?? '').toLowerCase(),
    sourceMatches(source, 'journal') ? 1 : 0,
    encodeRowJson(note),
  ];
}

async function upsertDomainNotes(conn: SqlConnection, notes: Record<string, unknown>[]): Promise<void> {
  const rows = notes.map(domainNoteRow).filter((r): r is SqlValue[] => r !== undefined);
  await batchInsert(conn, 'domain_note', [...DOMAIN_NOTE_COLS], rows, conflictUpdate(DOMAIN_NOTE_COLS, ['note_id']));
}

function segmentHeadRow(id: SqlValue, head: Record<string, unknown>): SqlValue[] {
  return [
    id,
    T(head.noteId) ?? '',
    N(head.version),
    // Local latest-segments order is position ?? createdAt — same fallback here.
    num(head.position) ?? num(head.createdAt),
    (text(head.rawContent) ?? '').toLowerCase(),
  ];
}

async function upsertSegmentHeads(conn: SqlConnection, heads: [SqlValue, Record<string, unknown>][]): Promise<void> {
  await batchInsert(conn, 'segment_head', [...SEGMENT_HEAD_COLS], heads.map(([id, h]) => segmentHeadRow(id, h)), conflictUpdate(SEGMENT_HEAD_COLS, ['id']));
}

/** One query_block row; undefined when the block has no identity. */
function queryBlockRow(block: Record<string, unknown>, parent: NoteIdentity | undefined): SqlValue[] | undefined {
  const id = text(block.id);
  if (!id) return undefined;
  const source = sourceItem(block);
  const createdAt = N(block.createdAt);
  const effective = parent ? (parent.date ?? parent.created_at) : createdAt;
  return [
    id,
    T(block.noteId),
    parent?.note_id ?? null,
    T(block.blockContentId),
    T(block.segmentId),
    num(block.position),
    T(block.dataType),
    T(block.sourceId),
    T(block.sourcePath),
    T(catalogOfItem(source)),
    effective,
    createdAt,
    T(block.noteTitle),
    (text(block.rawContent) ?? '').toLowerCase(),
    sourceMatches(source, 'journal') ? 1 : 0,
    encodeRowJson(block),
  ];
}

async function upsertQueryBlocks(conn: SqlConnection, blocks: [Record<string, unknown>, NoteIdentity | undefined][]): Promise<void> {
  const rows = blocks.map(([b, p]) => queryBlockRow(b, p)).filter((r): r is SqlValue[] => r !== undefined);
  await batchInsert(conn, 'query_block', [...QUERY_BLOCK_COLS], rows, conflictUpdate(QUERY_BLOCK_COLS, ['occurrence_id']));
}

// ── Parent identity resolution ───────────────────────────────────────────────

/** In-memory mirror of the identityBy/resolveParent queries: exact noteId
 *  first, then deterministic source-path identity; ambiguous or missing →
 *  undefined (row stays orphaned; reads gate on it). A note_id can appear
 *  once (PK), source_path can collide — multiplicity is preserved so the
 *  fail-closed rule stays identical to the per-key query version. */
interface ParentIndex {
  byNoteId: Map<string, NoteIdentity[]>;
  bySourcePath: Map<string, NoteIdentity[]>;
}

const pushIdent = (map: Map<string, NoteIdentity[]>, k: string, v: NoteIdentity): void => {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
};

function indexNoteIdentities(notes: Iterable<Record<string, unknown>>): ParentIndex {
  const byNoteId = new Map<string, NoteIdentity[]>();
  const bySourcePath = new Map<string, NoteIdentity[]>();
  for (const note of notes) {
    const id = text(note.id);
    if (!id) continue;
    const ident: NoteIdentity = { note_id: id, date: num(note.date), created_at: num(note.createdAt) ?? 0 };
    pushIdent(byNoteId, id, ident);
    const sp = text(note.sourcePath);
    if (sp) pushIdent(bySourcePath, sp, ident);
  }
  return { byNoteId, bySourcePath };
}

function resolveParentFrom(index: ParentIndex, block: Record<string, unknown>): NoteIdentity | undefined {
  const nid = text(block.noteId);
  if (nid) {
    const rows = index.byNoteId.get(nid) ?? [];
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) return undefined;
  }
  const sp = text(block.sourcePath);
  if (!sp) return undefined;
  const rows = index.bySourcePath.get(sp) ?? [];
  return rows.length === 1 ? rows[0] : undefined;
}

/** Fetch identities for the given lookup values from domain_note, chunked —
 *  one round trip per chunk instead of one per block. */
async function fetchParentIndex(conn: SqlConnection, noteIds: string[], sourcePaths: string[]): Promise<ParentIndex> {
  const byNoteId = new Map<string, NoteIdentity[]>();
  const bySourcePath = new Map<string, NoteIdentity[]>();
  const IN_CHUNK = 500;
  for (let i = 0; i < noteIds.length; i += IN_CHUNK) {
    const part = noteIds.slice(i, i + IN_CHUNK);
    const rows = await conn.query(`SELECT "note_id", "date", "created_at" FROM "domain_note" WHERE "note_id" IN (${part.map(() => '?').join(', ')})`, part);
    for (const r of rows) pushIdent(byNoteId, String(r.note_id), { note_id: String(r.note_id), date: num(r.date), created_at: num(r.created_at) ?? 0 });
  }
  for (let i = 0; i < sourcePaths.length; i += IN_CHUNK) {
    const part = sourcePaths.slice(i, i + IN_CHUNK);
    const rows = await conn.query(`SELECT "note_id", "source_path", "date", "created_at" FROM "domain_note" WHERE "source_path" IN (${part.map(() => '?').join(', ')})`, part);
    for (const r of rows) pushIdent(bySourcePath, String(r.source_path), { note_id: String(r.note_id), date: num(r.date), created_at: num(r.created_at) ?? 0 });
  }
  return { byNoteId, bySourcePath };
}

// ── Per-key refresh ──────────────────────────────────────────────────────────

/** Segment keys are [id, version]; head pointers key on the first part. */
const keyHead = (key: KeyDTO): SqlValue => (Array.isArray(key) ? (key[0] as SqlValue) : key);

/** Chunked `col IN (…)` SELECT returning the first column as strings. */
async function selectIn(conn: SqlConnection, selectCol: string, table: string, col: string, vals: SqlValue[]): Promise<string[]> {
  const IN_CHUNK = 500;
  const out: string[] = [];
  for (let i = 0; i < vals.length; i += IN_CHUNK) {
    const part = vals.slice(i, i + IN_CHUNK);
    const rows = await conn.query(`SELECT "${selectCol}" FROM "${table}" WHERE "${col}" IN (${part.map(() => '?').join(', ')})`, part);
    for (const r of rows) out.push(String(r[selectCol]));
  }
  return out;
}

/** Re-project every block occurrence pointing at the given note ids: blocks
 *  whose parent identity matches (exact id or shared source path) re-resolve
 *  through the fail-closed exact-parent rule — ambiguous identities stay
 *  orphaned instead of being arbitrarily re-pointed. */
async function healQueryBlocksForNotes(conn: SqlConnection, noteIds: string[], sourcePaths: string[]): Promise<void> {
  const ids = await selectIn(conn, 'occurrence_id', 'query_block', 'source_note_id', noteIds);
  const byPath = await selectIn(conn, 'occurrence_id', 'query_block', 'source_path', sourcePaths);
  await refreshBlocks(conn, [...new Set([...ids, ...byPath])]);
}

async function refreshNotes(conn: SqlConnection, ids: KeyDTO[]): Promise<void> {
  const ks = [...new Set(ids.map((id) => String(keyHead(id))))];
  if (ks.length === 0) return;
  const found = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ks.length; i += 500) {
    const part = ks.slice(i, i + 500);
    const rows = await conn.query(`SELECT "k0", "data" FROM "notes" WHERE "k0" IN (${part.map(() => '?').join(', ')})`, part);
    for (const row of rows) found.set(String(row.k0), decodeRowJson<Record<string, unknown>>(String(row.data)));
  }
  const present: Record<string, unknown>[] = [];
  const missing: string[] = [];
  for (const k of ks) {
    const note = found.get(k);
    if (note) present.push(note);
    else missing.push(k);
  }
  await upsertDomainNotes(conn, present);
  // Present notes: re-project blocks pointing here. Deleted notes: re-project
  // rather than blindly nulling — a surviving unique source-path identity
  // re-parents; ambiguous ones fail closed and gate reads.
  const presentIds = present.map((n) => text(n.id)).filter((x): x is string => !!x);
  const paths = [...new Set(present.map((n) => text(n.sourcePath)).filter((x): x is string => !!x))];
  await healQueryBlocksForNotes(conn, presentIds, paths);
  await deleteIn(conn, 'domain_note', 'note_id', missing);
  if (missing.length > 0) {
    const orphans = [
      ...new Set([
        ...(await selectIn(conn, 'occurrence_id', 'query_block', 'parent_note_id', missing)),
        ...(await selectIn(conn, 'occurrence_id', 'query_block', 'source_note_id', missing)),
      ]),
    ];
    await refreshBlocks(conn, orphans);
  }
}

async function refreshSegments(conn: SqlConnection, keys: KeyDTO[]): Promise<void> {
  const ks = [...new Set(keys.map((key) => String(keyHead(key))))];
  if (ks.length === 0) return;
  const heads = new Map<string, { id: SqlValue; row: Record<string, unknown>; version: number }>();
  for (let i = 0; i < ks.length; i += 500) {
    const part = ks.slice(i, i + 500);
    const rows = await conn.query(`SELECT "k0", "data" FROM "segments" WHERE "k0" IN (${part.map(() => '?').join(', ')})`, part);
    for (const row of rows) {
      const seg = decodeRowJson<Record<string, unknown>>(String(row.data));
      const v = num(seg.version) ?? 0;
      const prev = heads.get(String(row.k0));
      if (!prev || v > prev.version) heads.set(String(row.k0), { id: row.k0 as SqlValue, row: seg, version: v });
    }
  }
  await upsertSegmentHeads(conn, [...heads.values()].map((h) => [h.id, h.row]));
  await deleteIn(conn, 'segment_head', 'id', ks.filter((k) => !heads.has(k)));
}

async function refreshBlocks(conn: SqlConnection, ids: KeyDTO[]): Promise<void> {
  const ks = [...new Set(ids.map((id) => String(keyHead(id))))];
  if (ks.length === 0) return;
  const found = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ks.length; i += 500) {
    const part = ks.slice(i, i + 500);
    const rows = await conn.query(`SELECT "k0", "data" FROM "block_index" WHERE "k0" IN (${part.map(() => '?').join(', ')})`, part);
    for (const row of rows) found.set(String(row.k0), decodeRowJson<Record<string, unknown>>(String(row.data)));
  }
  const blocks = [...found.values()];
  const noteIds = [...new Set(blocks.map((b) => text(b.noteId)).filter((x): x is string => !!x))];
  const paths = [...new Set(blocks.map((b) => text(b.sourcePath)).filter((x): x is string => !!x))];
  const index = await fetchParentIndex(conn, noteIds, paths);
  await upsertQueryBlocks(conn, blocks.map((b) => [b, resolveParentFrom(index, b)]));
  await deleteIn(conn, 'query_block', 'occurrence_id', ks.filter((k) => !found.has(k)));
}

interface Impact {
  notes: KeyDTO[];
  segments: KeyDTO[];
  blocks: KeyDTO[];
  notesClear: boolean;
  segmentsClear: boolean;
  blocksClear: boolean;
}

const TRACKED: Partial<Record<StoreName, 'notes' | 'segments' | 'blocks'>> = {
  notes: 'notes',
  segments: 'segments',
  block_index: 'blocks',
};

async function deleteTargetKeys(conn: SqlConnection, def: StoreDef, target: KeyDTO | RangeDTO): Promise<KeyDTO[]> {
  if (!isRange(target)) return [target];
  const rows = await listRows(conn, def, target);
  return rows.map((row) => keyFromValue(def, row));
}

/**
 * Applies ops in order, collecting projection impact per affected key, then
 * refreshes derived rows — all on the caller's transaction. Returns one entry
 * per op: the put key, or null for delete/clear. `opts.deferProjection`
 * skips the per-key refresh pass; the caller MUST rebuild derived state in
 * the same transaction afterwards (see rebuildProjections) or reads will
 * operate on stale projections behind a valid guard.
 */
export async function refreshDomain(
  conn: SqlConnection,
  ops: TxOp[],
  opts: { deferProjection?: boolean } = {},
): Promise<(KeyDTO | null)[]> {
  const impact: Impact = {
    notes: [], segments: [], blocks: [],
    notesClear: false, segmentsClear: false, blocksClear: false,
  };
  const results: (KeyDTO | null)[] = [];
  // Consecutive puts on one store flush as chunked multi-row INSERTs; the
  // flush also precedes any delete/clear so range deletes observe them.
  let pending: { def: StoreDef; values: unknown[]; slots: ('notes' | 'segments' | 'blocks' | null)[] } | undefined;
  const flushPuts = async (): Promise<void> => {
    if (!pending) return;
    const batch = pending;
    pending = undefined;
    if (batch.values.length === 0) return;
    const keys = await putRows(conn, batch.def, batch.values);
    keys.forEach((key, i) => {
      const slot = batch.slots[i];
      if (slot) impact[slot].push(key);
      results.push(key);
    });
  };
  for (const op of ops) {
    if (op === null || typeof op !== 'object' || Array.isArray(op)) {
      throw new StorageError(400, 'tx op must be an object');
    }
    const store = 'store' in op ? op.store : undefined;
    const def = storeDefinition(typeof store === 'string' ? store : String(store));
    const kind: unknown = typeof op.op === 'string' ? op.op : undefined; // runtime junk tolerated
    if (op.op === 'put') {
      if (pending && pending.def.name !== def.name) await flushPuts();
      (pending ??= { def, values: [], slots: [] }).values.push(op.value);
      pending.slots.push(TRACKED[def.name] ?? null);
    } else if (op.op === 'delete') {
      await flushPuts();
      const slot = TRACKED[def.name];
      if (slot) {
        // op.key types as KeyDTO on the wire, but deleteRows honours ranges too.
        for (const key of await deleteTargetKeys(conn, def, op.key as KeyDTO | RangeDTO)) impact[slot].push(key);
      }
      await deleteRows(conn, def, op.key as KeyDTO | RangeDTO);
      results.push(null);
    } else if (op.op === 'clear') {
      await flushPuts();
      await clearRows(conn, def);
      if (def.name === 'notes') impact.notesClear = true;
      else if (def.name === 'segments') impact.segmentsClear = true;
      else if (def.name === 'block_index') impact.blocksClear = true;
      results.push(null);
    } else {
      throw new StorageError(400, `tx op must be put | delete | clear, got: ${String(kind)}`);
    }
  }
  await flushPuts();
  if (!opts.deferProjection) await refresh(conn, impact);
  return results;
}

async function refresh(conn: SqlConnection, impact: Impact): Promise<void> {
  // Clears stage first: a tx of [clear, put n1] must end with exactly n1
  // projected, and [put n1, clear] with nothing — clearing the derived rows
  // before re-projecting surviving keys satisfies both orders.
  if (impact.notesClear) {
    await conn.exec(`DELETE FROM "domain_note"`);
    await conn.exec(`UPDATE "query_block" SET "parent_note_id" = NULL`);
  }
  if (impact.segmentsClear) await conn.exec(`DELETE FROM "segment_head"`);
  if (impact.blocksClear) await conn.exec(`DELETE FROM "query_block"`);
  await refreshNotes(conn, impact.notes);
  await refreshSegments(conn, impact.segments);
  await refreshBlocks(conn, impact.blocks);
}

/**
 * Rebuild the derived tables from the source-of-truth store rows and stamp
 * the projection guard. Caller owns the transaction (atomicity) — the guard
 * row commits together with the rebuilt rows.
 */
export async function rebuildProjections(conn: SqlConnection): Promise<void> {
  await conn.exec(
    `CREATE TABLE IF NOT EXISTS "${SCHEMA_TABLE}" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
  );
  for (const t of TABLES) await conn.exec(`DELETE FROM "${t}"`);
  const notes = await conn.query(`SELECT "data" FROM "notes"`);
  const noteObjs = notes.map((row) => decodeRowJson<Record<string, unknown>>(String(row.data)));
  await upsertDomainNotes(conn, noteObjs);
  const segments = await conn.query(`SELECT "k0", "data" FROM "segments"`);
  const heads = new Map<string, { id: SqlValue; row: Record<string, unknown>; version: number }>();
  for (const row of segments) {
    const seg = decodeRowJson<Record<string, unknown>>(String(row.data));
    const v = num(seg.version) ?? 0;
    const prev = heads.get(String(row.k0));
    if (!prev || v > prev.version) heads.set(String(row.k0), { id: row.k0 as SqlValue, row: seg, version: v });
  }
  await upsertSegmentHeads(conn, [...heads.values()].map((h) => [h.id, h.row]));
  const blocks = await conn.query(`SELECT "data" FROM "block_index"`);
  const blockObjs = blocks.map((row) => decodeRowJson<Record<string, unknown>>(String(row.data)));
  // domain_note was just rebuilt from exactly these notes — parent identity
  // resolves in memory instead of one query per block.
  const index = indexNoteIdentities(noteObjs);
  await upsertQueryBlocks(conn, blockObjs.map((b) => [b, resolveParentFrom(index, b)]));
  await conn.exec(
    `INSERT INTO "${SCHEMA_TABLE}" ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`,
    [PROJECTION_GUARD_KEY, JSON.stringify({ version: DOMAIN_PROJECTION_VERSION })],
  );
}

/** Boot-time derived state: DDL + rebuild only when the guard is incompatible
 * (first run, projection version bump, or an interrupted prior rebuild). */
export async function initializeDomain(db: Database): Promise<void> {
  await ensureDdl(db);
  await db.transaction(async (tx) => {
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS "${SCHEMA_TABLE}" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
    );
    const guardRows = await tx.query(`SELECT "value" FROM "${SCHEMA_TABLE}" WHERE "key" = ?`, [PROJECTION_GUARD_KEY]);
    let guard: { version?: unknown } | undefined;
    if (guardRows[0]) {
      try {
        guard = JSON.parse(String(guardRows[0].value)) as { version?: unknown };
      } catch {
        guard = undefined; // corrupt guard → rebuild and restamp
      }
    }
    if (guard?.version === DOMAIN_PROJECTION_VERSION) return;
    await rebuildProjections(tx);
  });
}

/** Clears derived tables after a data wipe (empty is a consistent state). */
export async function wipeDomain(conn: SqlConnection): Promise<void> {
  for (const t of TABLES) await conn.exec(`DELETE FROM "${t}"`);
}

// ── Domain query execution ───────────────────────────────────────────────────

export const MAX_BODY = 64 * 1024;
const MAX_CLAUSES = 32;
const MAX_VALUES = 64;
const MAX_VALUE_LEN = 256;
const MAX_ORDER = 4;

type Plan = 'notes' | 'blocks' | 'entries';

const listFields = ['id', 'noteId', 'type', 'catalog', 'source', 'tags', 'effort'] as const;

const onlyKeys = (obj: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(obj).every((k) => allowed.includes(k));

function bad(msg: string): StorageError {
  return new StorageError(400, msg);
}

function strArray(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_VALUES) {
    throw bad(`${what} needs 1..=${MAX_VALUES} values`);
  }
  return v.map((x) => {
    if (typeof x !== 'string' || x.length < 1 || x.length > MAX_VALUE_LEN) {
      throw bad(`${what} values must be 1..=${MAX_VALUE_LEN} chars`);
    }
    return x;
  });
}

/** Strict predicate parse — unknown/missing/duplicate payload keys are 400. */
function parsePredicate(v: unknown, plan: Plan): DomainPredicate {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw bad('predicate must be an object');
  const obj = v as Record<string, unknown>;
  const field = obj.field;
  if (typeof field !== 'string') throw bad('predicate.field required');
  let negate = false;
  if ('negate' in obj) {
    if (typeof obj.negate !== 'boolean') throw bad('predicate.negate must be boolean');
    negate = obj.negate;
  }
  if ((listFields as readonly string[]).includes(field)) {
    if (!onlyKeys(obj, ['field', 'values', 'negate'])) {
      throw bad(`predicate ${field} accepts only field/values/negate`);
    }
    return { field, values: strArray(obj.values, `predicate ${field}.values`), ...(negate ? { negate } : {}) } as DomainPredicate;
  }
  if (field === 'text') {
    if (!onlyKeys(obj, ['field', 'value']) || negate) throw bad('predicate text accepts only {field, value}');
    if (typeof obj.value !== 'string' || obj.value.length < 1 || obj.value.length > MAX_VALUE_LEN) {
      throw bad('predicate text.value must be 1..=256 chars');
    }
    return { field: 'text', value: obj.value };
  }
  if (field === 'date') {
    if (!onlyKeys(obj, ['field', 'start', 'end', 'endExclusive'])) {
      throw bad('predicate date accepts only field/start/end/endExclusive');
    }
    const n = (k: string): number => {
      if (typeof obj[k] !== 'number' || !Number.isFinite(obj[k])) throw bad(`predicate date.${k} must be a finite number`);
      return obj[k];
    };
    if ('endExclusive' in obj && typeof obj.endExclusive !== 'boolean') {
      throw bad('predicate date.endExclusive must be boolean');
    }
    return { field: 'date', start: n('start'), end: n('end'), ...(obj.endExclusive === true ? { endExclusive: true } : {}) };
  }
  if (field === 'page') {
    if (plan === 'blocks') throw bad('predicate page does not apply to the blocks plan');
    if (!onlyKeys(obj, ['field', 'value'])) throw bad('predicate page accepts only {field, value}');
    if (typeof obj.value !== 'boolean') throw bad('predicate page.value must be boolean');
    return { field: 'page', value: obj.value };
  }
  if (field === 'sourceFence') {
    if (!onlyKeys(obj, ['field'])) throw bad('predicate sourceFence accepts only {field}');
    return { field: 'sourceFence' };
  }
  if (field === 'defaultNotes') {
    if (plan === 'blocks') throw bad('predicate defaultNotes does not apply to the blocks plan');
    if (!onlyKeys(obj, ['field', 'feeds'])) throw bad('predicate defaultNotes accepts only {field, feeds}');
    if (typeof obj.feeds !== 'boolean') throw bad('predicate defaultNotes.feeds must be boolean');
    return { field: 'defaultNotes', feeds: obj.feeds };
  }
  throw bad(`unknown predicate field: ${field}`);
}

function parseClauses(v: unknown, plan: Plan, what: string): DomainPredicate[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw bad(`${what} must be an array`);
  if (v.length > MAX_CLAUSES) throw bad(`${what} supports at most ${MAX_CLAUSES} clauses`);
  return v.map((p) => parsePredicate(p, plan));
}

function orderCols(field: string, plan: Plan): string {
  if (field === 'id' || field === 'createdAt') return field;
  if (plan === 'blocks') {
    if (field === 'noteTitle' || field === 'dataType' || field === 'position') return field;
    throw bad(field === 'date' || field === 'title' ? `order ${field} does not apply to the blocks plan` : `unknown order field: ${field}`);
  }
  if (field === 'date' || field === 'title') return field;
  throw bad(
    field === 'noteTitle' || field === 'dataType' || field === 'position'
      ? `order ${field} only applies to the blocks plan`
      : `unknown order field: ${field}`,
  );
}

interface ParsedQuery {
  plan: Plan;
  selection: DomainPredicate[];
  filters: DomainPredicate[];
  order: { field: string; desc: boolean }[];
  offset: number;
  limit?: number;
}

function parseQuery(body: unknown): ParsedQuery {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a DomainQuery object');
  const obj = body as Record<string, unknown>;
  const plan = obj.plan;
  if (plan !== 'notes' && plan !== 'blocks' && plan !== 'entries') {
    throw bad('body.plan must be notes | blocks | entries');
  }
  for (const k of Object.keys(obj)) {
    if (!['plan', 'selection', 'filters', 'order', 'offset', 'limit'].includes(k)) {
      throw bad(`unknown DomainQuery field: ${k}`);
    }
  }
  const order: { field: string; desc: boolean }[] = [];
  if (obj.order !== undefined) {
    if (!Array.isArray(obj.order)) throw bad('order must be an array');
    if (obj.order.length > MAX_ORDER) throw bad(`order supports at most ${MAX_ORDER} keys`);
    for (const entry of obj.order) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw bad('order entries must be objects');
      const e = entry as Record<string, unknown>;
      if (typeof e.field !== 'string') throw bad('order.field required');
      if (!onlyKeys(e, ['field', 'direction'])) throw bad('order entries accept only field/direction');
      if (e.direction !== undefined && e.direction !== 'asc' && e.direction !== 'desc') {
        throw bad('order.direction must be asc | desc');
      }
      order.push({ field: orderCols(e.field, plan), desc: e.direction === 'desc' });
    }
  }
  const intIn = (k: string): number | undefined => {
    const v = obj[k];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !Number.isInteger(v)) throw bad(`${k} must be an integer`);
    if (v < 0) throw bad(`${k} must be >= 0`);
    return v;
  };
  // Omitted limit = complete matched set; an explicit limit is the caller's
  // paging choice, never silently truncated.
  return {
    plan,
    selection: parseClauses(obj.selection, plan, 'selection'),
    filters: parseClauses(obj.filters, plan, 'filters'),
    order,
    offset: intIn('offset') ?? 0,
    limit: intIn('limit'),
  };
}

// ── Predicate → SQL (bound values only) ──────────────────────────────────────

class Sql {
  readonly params: SqlValue[] = [];
  constructor(readonly pg: boolean) {}
  bind(v: SqlValue): string {
    this.params.push(v);
    return '?';
  }
  /** Literal substring over a lowercased materialized column — no wildcards. */
  contains(col: string, needle: string): string {
    const p = this.bind(needle.toLowerCase());
    return this.pg ? `strpos(${col}, ${p}) > 0` : `instr(${col}, ${p}) > 0`;
  }
  inList(col: string, values: string[]): string {
    return `${col} IN (${values.map((v) => this.bind(v)).join(', ')})`;
  }
}

/** WQL source domain — mirrors WQL_SOURCE_VALUES; the non-shape kinds
 * (dashboards/efforts) are exact sourceId literals, journal is materialized. */
const SOURCE_ALL_KINDS = ['journal', 'feeds', 'guides', 'playground', 'dashboards', 'efforts'];

function sourceKindSql(ctx: Sql, kind: string, sid: string, typeExpr: string | null, journalCol: string): string {
  switch (kind) {
    case 'journal':
      return `(${journalCol} = 1)`;
    case 'feed':
    case 'feeds':
      // Storage identities keep the collection:/page:collection: prefixes.
      return `(substr(${sid}, 1, 11) = 'collection:' OR substr(${sid}, 1, 16) = 'page:collection:')`;
    case 'page':
    case 'pages':
      return `(${sid} = 'page' OR substr(${sid}, 1, 5) = 'page:' OR substr(${sid}, 1, 7) = 'guides:')`;
    case 'guide':
    case 'guides':
      return `(substr(${sid}, 1, 7) = 'guides:')`;
    case 'playground':
      return typeExpr
        ? `(${sid} = 'playground' OR (${typeExpr} IS NOT NULL AND ${typeExpr} = 'playground'))`
        : `(${sid} = 'playground')`;
    default:
      // Exact sourceId literal; NULL sourceId never equals a value.
      return `(${sid} = ${ctx.bind(kind)})`;
  }
}

function sourcePredicateSql(ctx: Sql, values: string[], negate: boolean, sid: string, typeExpr: string | null, journalCol: string): string {
  const matched = values.map((v) => sourceKindSql(ctx, v, sid, typeExpr, journalCol)).join(' OR ');
  return negate ? `NOT COALESCE((${matched}), FALSE)` : matched;
}

const wrap = (negate: boolean, matchSql: string): string =>
  negate ? `NOT COALESCE ((${matchSql}), FALSE)` : matchSql;

function predicateSql(ctx: Sql, p: DomainPredicate, plan: Plan): string {
  const blocks = plan === 'blocks';
  const id = blocks ? 'q."occurrence_id"' : 'n."note_id"';
  const sid = blocks ? 'q."source_id"' : 'n."source_id"';
  const typeExpr = blocks ? null : 'n."note_type"';
  const typeCol = blocks ? 'q."data_type"' : 'n."note_type"';
  const catalogCol = blocks ? 'q."catalog"' : 'n."catalog"';
  const journalCol = blocks ? 'q."journal"' : 'n."journal"';
  const noteId = blocks ? 'q."source_note_id"' : 'n."note_id"';
  switch (p.field) {
    case 'id':
      return wrap(p.negate === true, ctx.inList(id, p.values));
    case 'noteId':
      return wrap(p.negate === true, ctx.inList(noteId, p.values));
    case 'type':
      return wrap(p.negate === true, ctx.inList(typeCol, p.values));
    case 'catalog':
      return wrap(p.negate === true, ctx.inList(catalogCol, p.values));
    case 'source':
      return sourcePredicateSql(ctx, p.values, p.negate === true, sid, typeExpr, journalCol);
    case 'tags':
      // Tags hang off the parent note on both planes.
      return wrap(
        p.negate === true,
        `EXISTS (SELECT 1 FROM "note_tags" nt JOIN "tags" t ON t."k0" = nt."i_by_tag_0" ` +
          `WHERE nt."i_by_note_0" = ${noteId} AND t."i_by_label_0" IN (${p.values.map((v) => ctx.bind(v)).join(', ')}))`,
      );
    case 'effort':
      return wrap(
        p.negate === true,
        blocks
          ? `(q."content_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "block_efforts" be ` +
              `WHERE be."i_by_block_0" = q."content_id" AND be."i_by_effort_0" IN (${p.values.map((v) => ctx.bind(v)).join(', ')})))`
          : `EXISTS (SELECT 1 FROM "block_efforts" be WHERE be."i_by_note_0" = ${noteId} ` +
              `AND be."i_by_effort_0" IN (${p.values.map((v) => ctx.bind(v)).join(', ')}))`,
      );
    case 'text': {
      const textCol = blocks ? 'q."normalized_text"' : 'n."text_search"';
      const title = ctx.contains(textCol, p.value);
      if (plan !== 'entries') return title;
      // Entries plan: also match the note's latest ACTIVE segment text.
      const body = ctx.contains('h."search_text"', p.value);
      return (
        `(${title} OR EXISTS (SELECT 1 FROM "segment_head" h ` +
        `JOIN "segments" s ON s."k0" = h."id" AND s."k1" = h."current_version" ` +
        `WHERE h."note_id" = ${noteId} AND COALESCE(s."i_by_history_0", 0) = 0 AND ${body}))`
      );
    }
    case 'date': {
      const expr = blocks ? 'q."effective_date"' : 'COALESCE(n."date", n."created_at")';
      const lo = ctx.bind(p.start);
      const hi = ctx.bind(p.end);
      const cmp = p.endExclusive ? '<' : '<=';
      return `(${expr} >= ${lo} AND ${expr} ${cmp} ${hi})`;
    }
    case 'page':
      return p.value ? `n."note_type" = 'page'` : `(n."note_type" IS NULL OR n."note_type" <> 'page')`;
    case 'sourceFence': {
      const all = SOURCE_ALL_KINDS.map((k) => sourceKindSql(ctx, k, sid, typeExpr, journalCol)).join(' OR ');
      return `(${sid} IS NULL OR ${sid} = '' OR ${all})`;
    }
    case 'defaultNotes':
      return p.feeds
        ? `(n."note_type" IS NULL OR n."note_type" <> 'page')`
        : `(n."note_type" = 'note' OR (substr(COALESCE(n."source_id", ''), 1, 5) <> 'page:' ` +
            `AND substr(COALESCE(n."source_id", ''), 1, 7) <> 'guides:' ` +
            `AND COALESCE(n."note_type", '') NOT IN ('feed','syntax','behavior','analytics','dashboard','home','page')))`;
  }
}

function clausesSql(ctx: Sql, clauses: DomainPredicate[], plan: Plan): string {
  if (clauses.length === 0) return '';
  return ` WHERE ${clauses.map((p) => predicateSql(ctx, p, plan)).join(' AND ')}`;
}

function orderSql(order: { field: string; desc: boolean }[], plan: Plan): string {
  const idCol = plan === 'blocks' ? 'q."occurrence_id"' : 'n."note_id"';
  const cols: Record<string, string> =
    plan === 'blocks'
      ? { id: 'q."occurrence_id"', createdAt: 'q."created_at"', noteTitle: 'q."note_title"', dataType: 'q."data_type"', position: 'q."ordinal"' }
      : { id: 'n."note_id"', createdAt: 'n."created_at"', date: 'n."date"', title: 'n."title"' };
  // Deterministic paging: pinned NULL placement (sqlite and pg disagree on
  // defaults) plus the primary key as final tiebreaker.
  const parts = order.map(({ field, desc }) =>
    desc ? `${cols[field]} DESC NULLS FIRST` : `${cols[field]} ASC NULLS LAST`,
  );
  if (!order.some((o) => o.field === 'id')) parts.push(`${idCol} ASC`);
  return parts.join(', ');
}

function pagingSql(q: ParsedQuery, pg: boolean): string {
  let s = '';
  if (q.limit !== undefined) s += ` LIMIT ${q.limit}`;
  else if (q.offset > 0 && !pg) s += ' LIMIT -1'; // sqlite needs LIMIT before OFFSET
  if (q.offset > 0) s += ` OFFSET ${q.offset}`;
  return s;
}

/** Fail closed while any projected block lacks a resolved parent identity. */
async function gate(conn: SqlConnection): Promise<void> {
  const rows = await conn.query(`SELECT COUNT(*) AS "n" FROM "query_block" WHERE "parent_note_id" IS NULL`);
  const stale = Number(rows[0]?.n ?? 0);
  if (stale > 0) {
    throw new StorageError(
      409,
      `domain projections stale: ${stale} block rows have unresolved static parents`,
      'domain_projection_unavailable',
    );
  }
}

function planTable(plan: Plan): string {
  return plan === 'blocks' ? '"query_block" q' : '"domain_note" n';
}

async function execute(conn: SqlConnection, q: ParsedQuery, pg: boolean): Promise<DomainQueryResult> {
  const plan = q.plan;
  const table = planTable(plan);

  const selCtx = new Sql(pg);
  const selWhere = clausesSql(selCtx, q.selection, plan);
  const filterCtx = new Sql(pg);
  const filterWhere = clausesSql(filterCtx, q.filters, plan);
  const allParams: SqlValue[] = [...selCtx.params, ...filterCtx.params];
  const fullWhere =
    selWhere && filterWhere
      ? `${selWhere} AND ${filterWhere.replace(/^ WHERE /, '')}`
      : selWhere || filterWhere;

  const count = async (where: string, params: SqlValue[]): Promise<number> =>
    Number((await conn.query(`SELECT COUNT(*) AS "n" FROM ${table}${where}`, params))[0]?.n ?? 0);
  const selectedCount = await count(selWhere, selCtx.params);
  const matchedCount = await count(fullWhere, allParams);

  const ordering = orderSql(q.order, plan);
  const paging = pagingSql(q, pg);

  if (plan !== 'entries') {
    const pageSql = `SELECT "payload" FROM ${table}${fullWhere} ORDER BY ${ordering}${paging}`;
    const rows: unknown[] = (await conn.query(pageSql, allParams)).map((r) => decodeRowJson(String(r.payload)));
    const result = { projectionVersion: DOMAIN_PROJECTION_VERSION, selectedCount, matchedCount, plan, rows };
    // Parsed payloads re-typed by the shared plan schema (JSON columns are unknown).
    return result as DomainQueryResult;
  }

  // Entries: page note payloads, then batch-join segments/tags/links/pages.
  const pageSql = `SELECT "note_id", "payload" FROM ${table}${fullWhere} ORDER BY ${ordering}${paging}`;
  const noteRows = await conn.query(pageSql, allParams);
  const relations = [
    `SELECT h."note_id" AS "note_id", s."data" AS "payload" FROM selected n
     JOIN "segment_head" h ON h."note_id" = n."note_id"
     JOIN "segments" s ON s."k0" = h."id" AND s."k1" = h."current_version"
     WHERE COALESCE(s."i_by_history_0", 0) = 0
     ORDER BY h."position" ASC NULLS LAST, s."k0"`,
    `SELECT nt."i_by_note_0" AS "note_id", t."data" AS "payload" FROM selected n
     JOIN "note_tags" nt ON nt."i_by_note_0" = n."note_id"
     JOIN "tags" t ON t."k0" = nt."i_by_tag_0" ORDER BY t."k0"`,
    `SELECT p."i_by_note_0" AS "note_id", p."data" AS "payload" FROM selected n
     JOIN "page_notes" p ON p."i_by_note_0" = n."note_id" ORDER BY p."k0"`,
    `SELECT DISTINCT p."i_by_note_0" AS "note_id", pg."data" AS "payload" FROM selected n
     JOIN "page_notes" p ON p."i_by_note_0" = n."note_id"
     JOIN "page" pg ON pg."k0" = p."i_by_page_0" ORDER BY pg."data"`,
  ];
  const buckets: Array<[unknown[], unknown[], unknown[], unknown[]]> =
    noteRows.map(() => ([[], [], [], []]));
  const index = new Map<string, number>();
  noteRows.forEach((r, i) => index.set(String(r.note_id), i));
  for (const [rel, relation] of relations.entries()) {
    for (const row of await conn.query(`WITH selected AS (${pageSql}) ${relation}`, allParams)) {
      const i = index.get(String(row.note_id));
      if (i !== undefined) buckets[i][rel].push(decodeRowJson(String(row.payload)));
    }
  }
  const rows = noteRows.map((r, i) => {
    const [segments, tags, links, pages] = buckets[i];
    return { note: decodeRowJson(String(r.payload)), segments, tags, links, pages };
  });
  const result = { projectionVersion: DOMAIN_PROJECTION_VERSION, selectedCount, matchedCount, plan, rows };
  // Parsed payloads re-typed by the shared plan schema (JSON columns are unknown).
  return result as DomainQueryResult;
}

/** Validate, gate, execute on one consistent snapshot (server route and
 * SqlStorage.queryDomain share this entry). */
export async function handleDomainQuery(db: Database, body: unknown): Promise<DomainQueryResult> {
  const query = parseQuery(body);
  return db.transaction(async (tx) => {
    // Counts and page must share one snapshot; writes keep the default level.
    if (db.dialect === 'postgres') await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await gate(tx);
    return execute(tx, query, db.dialect === 'postgres');
  });
}
