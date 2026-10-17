/**
 * Schema-driven store operations: IDB-style stores persisted into SQL tables
 * (one per store, extracted key/index columns + full JSON in `data`). The
 * schema derives entirely from STORE_DEFS / COLUMN_TYPES; JSON payloads stay
 * the source of truth. Shared by the API server and the browser
 * BrowserTursoStorage/SqlStorage backends.
 */
import {
  COLUMN_TYPES,
  DB_VERSION,
  STORE_DEFS,
  type IndexDef,
  type StorageColumnType,
  type StoreDef,
} from '../schema';
import {
  compareKeys,
  extractKeyPart,
  isRange,
  keyInRange,
  type KeyDTO,
  type RangeDTO,
  type Scalar,
} from '../wire';
import type { Database, SqlConnection, SqlRow, SqlValue } from './connection';
import { StorageError } from './errors';
import type { StoreName } from '../contract';
import { decodeRowJson, encodeRowJson } from './codec';
import { validateStorageRow } from '../validation';

export const SCHEMA_TABLE = '_wodwiki_schema';
const SCHEMA_KEY = 'schema';

/**
 * Store tables introduced AFTER an already-shipped schema version, keyed by
 * the version that added them. A stored database below DB_VERSION migrates
 * forward by creating exactly these tables (additive — no existing row is
 * read, rewritten or erased; ensureStoreTables below creates them); any
 * other table-set difference still fails closed (foreign/recreated database).
 */
const ADDED_STORES_BY_VERSION: Readonly<Record<number, readonly string[]>> = {
  31: ['equipment', 'block_equipment'],
};

/** Store tables this server may create on a database stamped `stored`. */
function additiveStoresSince(stored: number): Set<string> {
  const added = new Set<string>();
  for (const [version, names] of Object.entries(ADDED_STORES_BY_VERSION)) {
    if (Number(version) > stored) for (const name of names) added.add(name);
  }
  return added;
}

/** Stores whose rows carry a raw binary field the codec must preserve. */
const BINARY_FIELD: Partial<Record<StoreName, string>> = { attachments: 'data' };

const binaryFieldOf = (def: StoreDef): string | undefined => BINARY_FIELD[def.name];

export function storeDefinition(name: string): StoreDef {
  const def = STORE_DEFS.find((d) => d.name === name);
  if (!def) throw new StorageError(404, `unknown store: ${name}`);
  return def;
}

function indexDefinition(def: StoreDef, indexName: string): IndexDef {
  const idx = def.indexes.find((i) => i.name === indexName);
  if (!idx) throw new StorageError(404, `unknown index: ${def.name}.${indexName}`);
  return idx;
}

/** ASCII identifier chars only; everything else → '_' (safe inside quotes). */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

const indexCol = (indexName: string, part: number): string => `i_${sanitize(indexName)}_${part}`;

function keyCols(def: StoreDef): string[] {
  return def.keyPath.map((_, i) => `k${i}`);
}

const junctionTable = (def: StoreDef, idx: IndexDef): string => `${def.name}__${sanitize(idx.name)}`;

const multiEntryIndex = (def: StoreDef): IndexDef | undefined => def.indexes.find((i) => i.multiEntry);

function pathType(def: StoreDef, path: string): StorageColumnType {
  return COLUMN_TYPES[def.name][path] ?? 'text';
}

/** SQLite store columns stay untyped (BLOB affinity) so values keep their
 * storage class and IDB ordering; PostgreSQL needs concrete types. Numbers
 * and booleans bind as float8 (booleans as 0/1), so both get DOUBLE
 * PRECISION. Text uses COLLATE "C" so PG ordering matches SQLite bytes. */
function colSql(dialect: 'sqlite' | 'postgres', type: StorageColumnType): string {
  if (dialect === 'sqlite') return '';
  return type === 'text' ? ' TEXT COLLATE "C"' : ' DOUBLE PRECISION';
}

/** Runtime scalar → bound SQL value: null→NULL, bool→1/0, number/string as-is,
 * anything else → JSON text. */
function toSqlScalar(v: unknown): SqlValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return JSON.stringify(v);
}

function validateKey(key: unknown): asserts key is KeyDTO {
  const scalar = (v: unknown): v is Scalar =>
    typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  if (!scalar(key) && !(Array.isArray(key) && key.length > 0 && key.every(scalar))) {
    throw new StorageError(400, 'key must be a string, finite number, or non-empty scalar tuple');
  }
}

function validateRange(range: RangeDTO | undefined): void {
  if (range === undefined) return;
  if (range === null || typeof range !== 'object' || Array.isArray(range)) {
    throw new StorageError(400, 'range must be an object');
  }
  for (const key of [range.only, range.lower, range.upper]) {
    if (key !== undefined) validateKey(key);
  }
  for (const open of [range.lowerOpen, range.upperOpen]) {
    if (open !== undefined && typeof open !== 'boolean') {
      throw new StorageError(400, 'range open flags must be boolean');
    }
  }
}

function toParts(key: KeyDTO): Scalar[] {
  validateKey(key);
  return Array.isArray(key) ? key : [key];
}

/** Reads a dotted path whose leaf must be an array (multiEntry values).
 * Shared extractKeyPart deliberately rejects array leaves, so the last hop
 * is traversed here over the parsed JSON row. */
function arrayPart(value: unknown, dotted: string): unknown[] | undefined {
  let cur: unknown = value;
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    // Traversal over parsed JSON: only plain rows are ever stored.
    const row = cur as Record<string, unknown>;
    cur = row[part];
  }
  return Array.isArray(cur) ? cur : undefined;
}

/** Primary-key extraction at the trust boundary: a missing keyPath part is
 * required-input validation → 400 (not an internal error). */
function requireKey(def: StoreDef, value: unknown): KeyDTO {
  const parts = def.keyPath.map((p) => extractKeyPart(value, p));
  for (const [i, part] of parts.entries()) {
    if (part === undefined) {
      throw new StorageError(400, `keyPath part '${def.keyPath[i]}' missing on ${def.name} value`);
    }
  }
  const key = parts as Scalar[];
  return key.length === 1 ? key[0] : key;
}

/** Scalar bounds compile to the first key column; tuple bounds compile
 * part-wise when their arity fits the target columns; anything else returns
 * null → caller falls back to a scan + shared keyInRange filter. Returns the WHERE
 * clause ('' when unfiltered) and pushes bound params in order. */
function rangeWhere(cols: string[], range: RangeDTO | undefined, params: SqlValue[]): string | null {
  if (!range) return '';
  if (range.only !== undefined) {
    const parts = toParts(range.only);
    if (parts.length > cols.length) return null;
    const clauses = parts.map((p, i) => {
      params.push(toSqlScalar(p));
      return `"${cols[i]}" = ?`;
    });
    return ` WHERE ${clauses.join(' AND ')}`;
  }
  const bounds: Array<[Scalar[], string]> = [];
  if (range.lower !== undefined && range.lower !== null) {
    bounds.push([toParts(range.lower), range.lowerOpen ? '>' : '>=']);
  }
  if (range.upper !== undefined && range.upper !== null) {
    bounds.push([toParts(range.upper), range.upperOpen ? '<' : '<=']);
  }
  const clauses: string[] = [];
  for (const [parts, op] of bounds) {
    if (parts.length > cols.length) return null;
    if (parts.length === 1) {
      params.push(toSqlScalar(parts[0]));
      clauses.push(`"${cols[0]}" ${op} ?`);
    } else {
      // Tuple compare: (c0,c1) >= (p0,p1) ⇔ c0 > p0 OR (c0 = p0 AND c1 >= p1)
      const ors = parts.map((p, i) => {
        const eqs: string[] = [];
        for (let j = 0; j < i; j++) {
          params.push(toSqlScalar(parts[j]));
          eqs.push(`"${cols[j]}" = ?`);
        }
        params.push(toSqlScalar(p));
        const cmpOp = i === parts.length - 1 ? op : op[0];
        eqs.push(`"${cols[i]}" ${cmpOp} ?`);
        return `(${eqs.join(' AND ')})`;
      });
      clauses.push(`(${ors.join(' OR ')})`);
    }
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

function clampLimit(count: number | undefined): number | undefined {
  if (count === undefined) return undefined;
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw new StorageError(400, `invalid count: ${String(count)}`);
  }
  return Math.max(0, Math.floor(count));
}

const limitClause = (count: number | undefined): string =>
  count === undefined ? '' : ` LIMIT ${clampLimit(count)}`;

function parseRows(rows: SqlRow[], binaryField?: string): unknown[] {
  return rows.map((r) => decodeRowJson(r.data as string, binaryField));
}

/** Full-table scan + in-memory IDB filtering/ordering via the shared wire
 * helpers. Only reachable for range shapes the column compile cannot express
 * (arity mismatches). Rows missing an index field are NOT in the index
 * (IDB semantics) and are skipped; a missing primary key is a 400. */
async function scanRows(
  conn: SqlConnection,
  def: StoreDef,
  idx: IndexDef | undefined,
  range: RangeDTO | undefined,
  limit: number | undefined,
): Promise<unknown[]> {
  const rows = await conn.query(`SELECT "data" FROM "${def.name}"`);
  const keyed: Array<[KeyDTO, unknown]> = [];
  for (const row of rows) {
    const value = decodeRowJson(row.data as string, binaryFieldOf(def));
    if (idx) {
      const parts = idx.keyPath.map((p) => extractKeyPart(value, p));
      if (!parts.every((p): p is Scalar => p !== undefined)) continue;
      const key = parts.length === 1 ? parts[0] : parts;
      if (range && !keyInRange(key, range)) continue;
      keyed.push([key, value]);
    } else {
      const key = requireKey(def, value);
      if (range && !keyInRange(key, range)) continue;
      keyed.push([key, value]);
    }
  }
  keyed.sort((a, b) => compareKeys(a[0], b[0]));
  const out = keyed.map(([, v]) => v);
  return limit === undefined ? out : out.slice(0, limit);
}

export async function getRow(conn: SqlConnection, def: StoreDef, key: KeyDTO): Promise<unknown | undefined> {
  const parts = toParts(key);
  if (parts.length !== def.keyPath.length) {
    throw new StorageError(400, `key arity ${parts.length} != keyPath arity ${def.keyPath.length} for ${def.name}`);
  }
  const cond = keyCols(def).map((c) => `"${c}" = ?`).join(' AND ');
  const rows = await conn.query(
    `SELECT "data" FROM "${def.name}" WHERE ${cond}`,
    parts.map(toSqlScalar),
  );
  return rows[0] ? decodeRowJson(rows[0].data as string, binaryFieldOf(def)) : undefined;
}

export async function getRows(conn: SqlConnection, def: StoreDef, keys: KeyDTO[]): Promise<(unknown | undefined)[]> {
  const found = new Map<string, unknown>();
  // Batch in chunks of 50 to respect SQLite/D1 SQLITE_LIMIT_EXPR_DEPTH (100) on chained OR expressions
  for (const part of chunks(keys, 50)) {
    const params: SqlValue[] = [];
    const conditions = part.map(key => {
      const parts = toParts(key);
      if (parts.length !== def.keyPath.length) throw new StorageError(400, 'invalid compound key arity');
      params.push(...parts.map(toSqlScalar));
      return `(${keyCols(def).map(col => `"${col}" = ?`).join(' AND ')})`;
    });
    for (const row of await conn.query(`SELECT "data" FROM "${def.name}" WHERE ${conditions.join(' OR ')}`, params)) {
      const value = decodeRowJson(String(row.data), binaryFieldOf(def));
      found.set(JSON.stringify(requireKey(def, value)), value);
    }
  }
  return keys.map(key => found.get(JSON.stringify(key)));
}

export async function listRowsFromIndexMany(conn: SqlConnection, def: StoreDef, indexName: string, keys: KeyDTO[]): Promise<unknown[][]> {
  const idx = indexDefinition(def, indexName);
  if (idx.multiEntry) {
    const out: unknown[][] = [];
    for (const key of keys) out.push(await listRows(conn, def, { only: key }, undefined, indexName));
    return out;
  }
  const found = new Map<string, unknown[]>();
  // Batch in chunks of 50 to respect SQLite/D1 SQLITE_LIMIT_EXPR_DEPTH (100) on chained OR expressions
  for (const part of chunks(keys, 50)) {
    const params: SqlValue[] = [];
    const conditions = part.map(key => {
      const parts = toParts(key);
      if (parts.length !== idx.keyPath.length) throw new StorageError(400, 'invalid index key arity');
      params.push(...parts.map(toSqlScalar));
      return `(${parts.map((_, i) => `"${indexCol(idx.name, i)}" = ?`).join(' AND ')})`;
    });
    for (const row of await conn.query(`SELECT "data" FROM "${def.name}" WHERE ${conditions.join(' OR ')} ORDER BY ${keyCols(def).map(col => `"${col}"`).join(', ')}`, params)) {
      const value = decodeRowJson(String(row.data), binaryFieldOf(def));
      const parts = idx.keyPath.map(path => extractKeyPart(value, path));
      const key = JSON.stringify(parts.length === 1 ? parts[0] : parts);
      const bucket = found.get(key);
      if (bucket) bucket.push(value); else found.set(key, [value]);
    }
  }
  return keys.map(key => found.get(JSON.stringify(key)) ?? []);
}

export async function listRows(
  conn: SqlConnection,
  def: StoreDef,
  range?: RangeDTO,
  count?: number,
  indexName?: string,
): Promise<unknown[]> {
  validateRange(range);
  const idx = indexName ? indexDefinition(def, indexName) : undefined;
  const binaryField = binaryFieldOf(def);
  if (idx?.multiEntry) {
    // JSON encoding preserves numeric/string equality in both SQL dialects.
    const only = range?.only;
    if (only === undefined || typeof only === 'object') {
      throw new StorageError(400, `multi-entry index ${def.name}.${idx.name} supports exact-match queries only`);
    }
    const joinOn = keyCols(def).map((c) => `j."${c}" = e."${c}"`).join(' AND ');
    // IDB multi-entry ordering: junction value first, then the primary key.
    const order = ['j."v"', ...keyCols(def).map((c) => `j."${c}"`)].join(', ');
    const rows = await conn.query(
      `SELECT e."data" AS "data" FROM "${def.name}" e JOIN "${junctionTable(def, idx)}" j ON ${joinOn}` +
        ` WHERE j."v" = ? ORDER BY ${order}${limitClause(count)}`,
      [JSON.stringify(only)],
    );
    return parseRows(rows, binaryField);
  }
  const cols = idx ? idx.keyPath.map((_, part) => indexCol(idx.name, part)) : keyCols(def);
  const params: SqlValue[] = [];
  const where = rangeWhere(cols, range, params);
  if (where === null) return scanRows(conn, def, idx, range, clampLimit(count));
  // IDB: rows whose index key is missing/invalid are not in the index —
  // exclude them even from unfiltered listings (SQL NULL comparison alone
  // only drops them from bounded ranges). NULLS never reach ORDER BY.
  const notNull = cols.map((c) => `"${c}" IS NOT NULL`).join(' AND ');
  const cond = where ? `${where} AND ${notNull}` : ` WHERE ${notNull}`;
  // IDB orders index results by (index key, primary key).
  const keyNames = keyCols(def).filter((k) => !cols.includes(k));
  const order = ` ORDER BY ${[...cols, ...keyNames].map((c) => `"${c}"`).join(', ')}`;
  const rows = await conn.query(
    `SELECT "data" FROM "${def.name}"${cond}${order}${limitClause(count)}`,
    params,
  );
  return parseRows(rows, binaryField);
}

export async function countRows(
  conn: SqlConnection,
  def: StoreDef,
  range?: RangeDTO,
  indexName?: string,
): Promise<number> {
  validateRange(range);
  const idx = indexName ? indexDefinition(def, indexName) : undefined;
  if (idx?.multiEntry) {
    const only = range?.only;
    if (only === undefined || typeof only === 'object') {
      throw new StorageError(400, `multi-entry index ${def.name}.${idx.name} supports exact-match queries only`);
    }
    const joinOn = keyCols(def).map((c) => `j."${c}" = e."${c}"`).join(' AND ');
    const rows = await conn.query(
      `SELECT COUNT(*) AS "n" FROM "${def.name}" e JOIN "${junctionTable(def, idx)}" j ON ${joinOn} WHERE j."v" = ?`,
      [JSON.stringify(only)],
    );
    return Number(rows[0]?.n ?? 0);
  }
  const cols = idx ? idx.keyPath.map((_, part) => indexCol(idx.name, part)) : keyCols(def);
  const params: SqlValue[] = [];
  const where = rangeWhere(cols, range, params);
  if (where === null) {
    const all = await scanRows(conn, def, idx, range, undefined);
    return all.length;
  }
  const cond = idx ? (where ? `${where} AND ${cols.map((c) => `"${c}" IS NOT NULL`).join(' AND ')}` : ` WHERE ${cols.map((c) => `"${c}" IS NOT NULL`).join(' AND ')}`) : where;
  const rows = await conn.query(`SELECT COUNT(*) AS "n" FROM "${def.name}"${cond}`, params);
  return Number(rows[0]?.n ?? 0);
}

/** Bound-parameter budget per statement. SQLite ≥3.32 allows 32766; 20k
 *  leaves headroom, and the row cap keeps single request bodies ≤ ~1 MB. */
const PARAM_BUDGET = 20000;
const ROW_CAP = 100;

const chunks = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Multi-row `INSERT … ON CONFLICT` in param-budgeted chunks. One round trip
 *  per chunk over Turso instead of one per row. `cols` are internal schema
 *  identifiers (never user input); `onConflict` is the full trailing clause. */
export async function batchInsert(
  conn: SqlConnection,
  table: string,
  cols: string[],
  rows: SqlValue[][],
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) return;
  const collist = cols.map((c) => `"${c}"`).join(', ');
  const tuple = `(${cols.map(() => '?').join(', ')})`;
  const per = Math.max(1, Math.min(ROW_CAP, Math.floor(PARAM_BUDGET / cols.length)));
  const statements = chunks(rows, per).map(part => ({
    sql: `INSERT INTO "${table}" (${collist}) VALUES ${part.map(() => tuple).join(', ')} ${onConflict}`,
    params: part.flat(),
  }));
  if (conn.batch) await conn.batch(statements);
  else for (const statement of statements) await conn.exec(statement.sql, statement.params);
}

/** Chunked `DELETE … WHERE col IN (…)` — one round trip per chunk. */
export async function deleteIn(conn: SqlConnection, table: string, col: string, vals: SqlValue[]): Promise<void> {
  for (const part of chunks(vals, 500)) {
    if (part.length === 0) continue;
    await conn.exec(`DELETE FROM "${table}" WHERE "${col}" IN (${part.map(() => '?').join(', ')})`, part);
  }
}

export async function putRows(conn: SqlConnection, def: StoreDef, values: unknown[], changedKeys?: KeyDTO[]): Promise<KeyDTO[]> {
  if (values.length === 0) return [];
  for (const value of values) validateStorageRow(def.name, value);
  const keys = keyCols(def);
  const cols = [...keys];
  for (const idx of def.indexes) {
    if (idx.multiEntry) continue;
    idx.keyPath.forEach((_, part) => cols.push(indexCol(idx.name, part)));
  }
  cols.push('data');
  const keySet = new Set(keys);
  const updates = cols.filter((c) => !keySet.has(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
  const pk = keys.map((k) => `"${k}"`).join(', ');

  const rows: SqlValue[][] = [];
  const out: KeyDTO[] = [];
  const junction: SqlValue[][] = [];
  const multi = multiEntryIndex(def);
  for (const value of values) {
    const k = requireKey(def, value);
    const keyParts = toParts(k).map(toSqlScalar);
    const vals = [...keyParts];
    for (const idx of def.indexes) {
      if (idx.multiEntry) continue;
      idx.keyPath.forEach((path) => vals.push(toSqlScalar(extractKeyPart(value, path) ?? null)));
    }
    vals.push(encodeRowJson(value, binaryFieldOf(def)));
    rows.push(vals);
    out.push(k);
    if (multi) {
      const items = arrayPart(value, multi.keyPath[0]);
      if (Array.isArray(items)) {
        for (const item of items) junction.push([...keyParts, JSON.stringify(item)]);
      }
    }
  }
  const tuple = `(${cols.map(() => '?').join(', ')})`;
  const per = Math.max(1, Math.min(ROW_CAP, Math.floor(PARAM_BUDGET / cols.length)));
  const statements = chunks(rows, per).map(part => ({
    sql: `INSERT INTO "${def.name}" (${cols.map(col => `"${col}"`).join(', ')}) VALUES ${part.map(() => tuple).join(', ')} `
      + (def.name === 'block_revisions' ? `ON CONFLICT (${pk}) DO NOTHING` : `ON CONFLICT (${pk}) DO UPDATE SET ${updates} WHERE "${def.name}"."data" <> excluded."data"`)
      + ` RETURNING ${keys.map(col => `"${col}"`).join(', ')}`,
    params: part.flat(),
  }));
  let returned: SqlRow[][];
  try {
    if (conn.batch) returned = await conn.batch(statements);
    else {
      returned = [];
      for (const statement of statements) returned.push(await conn.query(statement.sql, statement.params));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const code of ['revision_conflict', 'transaction_conflict', 'invalid_session_pin']) {
      if (message.includes(code)) throw new StorageError(409, message, code);
    }
    throw error;
  }
  const changed = returned.flat().map(row => {
    const parts = keys.map(col => row[col]) as Scalar[];
    return parts.length === 1 ? parts[0] : parts;
  });
  changedKeys?.push(...changed);
  if (multi) {
    const jt = junctionTable(def, multi);
    const changedSet = new Set(changed.map(key => JSON.stringify(key)));
    const deletes = values.flatMap(value => {
      const key = requireKey(def, value);
      if (!changedSet.has(JSON.stringify(key))) return [];
      const items = arrayPart(value, multi.keyPath[0]) ?? [];
      return [{ sql: `DELETE FROM "${jt}" WHERE ${keys.map(col => `"${col}" = ?`).join(' AND ')}`
        + (items.length ? ` AND "v" NOT IN (${items.map(() => '?').join(', ')})` : ''),
        params: [...toParts(key).map(toSqlScalar), ...items.map(item => JSON.stringify(item))] }];
    });
    if (conn.batch && deletes.length) await conn.batch(deletes);
    else for (const statement of deletes) await conn.exec(statement.sql, statement.params);
    await batchInsert(conn, jt, [...keys, 'v'], junction.filter(row => changedSet.has(JSON.stringify(keys.length === 1 ? row[0] : row.slice(0, keys.length)))), 'ON CONFLICT DO NOTHING');
  }
  return out;
}

export async function putRow(conn: SqlConnection, def: StoreDef, value: unknown): Promise<KeyDTO> {
  return (await putRows(conn, def, [value]))[0];
}

export async function deleteRows(conn: SqlConnection, def: StoreDef, keyOrRange: KeyDTO | RangeDTO): Promise<void> {
  if (def.name === 'block_revisions') throw new StorageError(409, 'block history may only be removed by explicit wipe', 'revision_conflict');
  const multi = multiEntryIndex(def);
  if (!isRange(keyOrRange)) {
    const parts = toParts(keyOrRange);
    if (parts.length > def.keyPath.length) {
      throw new StorageError(400, `key arity ${parts.length} > keyPath arity ${def.keyPath.length} for ${def.name}`);
    }
    const n = Math.min(parts.length, def.keyPath.length);
    const cond = keyCols(def).slice(0, n).map((c) => `"${c}" = ?`).join(' AND ');
    const params = parts.slice(0, n).map(toSqlScalar);
    if (multi) await conn.exec(`DELETE FROM "${junctionTable(def, multi)}" WHERE ${cond}`, params);
    await conn.exec(`DELETE FROM "${def.name}" WHERE ${cond}`, params);
    return;
  }
  validateRange(keyOrRange);
  const cols = keyCols(def);
  const params: SqlValue[] = [];
  const where = rangeWhere(cols, keyOrRange, params);
  if (where === null) {
    // Uncompilable shape: enumerate matching rows, delete per key.
    for (const row of await listRows(conn, def, keyOrRange)) {
      await deleteRows(conn, def, requireKey(def, row));
    }
    return;
  }
  const collist = cols.map((c) => `"${c}"`).join(', ');
  if (multi) {
    await conn.exec(
      `DELETE FROM "${junctionTable(def, multi)}" WHERE (${collist}) IN (SELECT ${collist} FROM "${def.name}"${where})`,
      params,
    );
  }
  await conn.exec(`DELETE FROM "${def.name}"${where}`, params);
}

export async function clearRows(conn: SqlConnection, def: StoreDef, wipe = false): Promise<void> {
  if (def.name === 'block_revisions' && !wipe) throw new StorageError(409, 'block history may only be removed by explicit wipe', 'revision_conflict');
  const multi = multiEntryIndex(def);
  if (multi) await conn.exec(`DELETE FROM "${junctionTable(def, multi)}"`);
  await conn.exec(`DELETE FROM "${def.name}"`);
}

/** Wipe all user stores; system stores (memberships) survive and the internal
 * schema metadata table is not a store, so the version guard is untouched. */
export async function wipeRows(conn: SqlConnection): Promise<void> {
  for (const def of STORE_DEFS) {
    if (!def.system) await clearRows(conn, def, true);
  }
}

function tableListSql(dialect: 'sqlite' | 'postgres'): string {
  return dialect === 'sqlite'
    ? `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table'`
    : `SELECT "table_name" FROM "information_schema"."tables" WHERE "table_schema" = current_schema()`;
}

/** Create the current schema only. Existing incompatible versions fail closed. */
async function ensureStoreTables(
  conn: SqlConnection,
  dialect: 'sqlite' | 'postgres',
  def: StoreDef,
): Promise<void> {
  const keys = keyCols(def);
  const cols: Array<[string, string]> = keys.map((k, i) => [k, colSql(dialect, pathType(def, def.keyPath[i]))]);
  for (const idx of def.indexes) {
    if (idx.multiEntry) continue;
    idx.keyPath.forEach((path, part) => {
      cols.push([indexCol(idx.name, part), colSql(dialect, pathType(def, path))]);
    });
  }
  cols.push(['data', ' TEXT NOT NULL']);
  const colDefs = cols.map(([c, t]) => `"${c}"${t}`);
  await conn.exec(
    `CREATE TABLE IF NOT EXISTS "${def.name}" (${colDefs.join(', ')}, PRIMARY KEY (${keys.map((k) => `"${k}"`).join(', ')}))`,
  );
  for (const idx of def.indexes) {
    if (idx.multiEntry) continue;
    const parts = idx.keyPath.map((_, part) => `"${indexCol(idx.name, part)}"`).join(', ');
    await conn.exec(
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${def.name}__${sanitize(idx.name)}" ON "${def.name}" (${parts})`,
    );
  }
  const multi = multiEntryIndex(def);
  if (multi) {
    const jt = junctionTable(def, multi);
    const jkeys = keys.map((k, i) => `"${k}"${colSql(dialect, pathType(def, def.keyPath[i]))}`);
    // v: BLOB affinity on sqlite (storage class preserved), byte-order C on PG.
    await conn.exec(
      `CREATE TABLE IF NOT EXISTS "${jt}" (${jkeys.join(', ')}, "v"${colSql(dialect, 'text')}, PRIMARY KEY (${[...keys, '"v"'].join(', ')}))`,
    );
    await conn.exec(`CREATE INDEX IF NOT EXISTS "${jt}__v" ON "${jt}" ("v")`);
  }
  if (def.name === 'notes' && dialect === 'sqlite') {
    await conn.exec(`CREATE TRIGGER IF NOT EXISTS "notes_revision_guard" BEFORE UPDATE ON "notes"
      WHEN json_extract(NEW."data", '$.sourceRevision') < json_extract(OLD."data", '$.sourceRevision')
      OR ((json_extract(NEW."data", '$.rawContent') IS NOT json_extract(OLD."data", '$.rawContent')
        OR json_extract(NEW."data", '$.blocks') IS NOT json_extract(OLD."data", '$.blocks'))
        AND json_extract(NEW."data", '$.sourceRevision') <= json_extract(OLD."data", '$.sourceRevision'))
      BEGIN SELECT RAISE(ABORT, 'transaction_conflict: stale Note source revision'); END`);
  }
  if (def.name === 'block_revisions' && dialect === 'sqlite') {
    await conn.exec(`CREATE TRIGGER IF NOT EXISTS "block_revision_guard" BEFORE INSERT ON "block_revisions"
      WHEN EXISTS (SELECT 1 FROM "block_revisions" old WHERE old."k0" = NEW."k0" AND old."k1" = NEW."k1" AND old."k2" = NEW."k2" AND old."data" <> NEW."data")
      BEGIN SELECT RAISE(ABORT, 'revision_conflict: immutable block revision collision'); END`);
  }
  if (def.name === 'sessions' && dialect === 'sqlite') {
    await conn.exec(`CREATE TRIGGER IF NOT EXISTS "session_pin_guard" BEFORE UPDATE ON "sessions"
      WHEN json_extract(NEW."data", '$.noteId') IS NOT json_extract(OLD."data", '$.noteId')
        OR json_extract(NEW."data", '$.blockId') IS NOT json_extract(OLD."data", '$.blockId')
        OR json_extract(NEW."data", '$.blockVersion') IS NOT json_extract(OLD."data", '$.blockVersion')
      BEGIN SELECT RAISE(ABORT, 'invalid_session_pin: Session pin is immutable'); END`);
  }
  if (dialect === 'postgres' && ['notes', 'block_revisions', 'sessions'].includes(def.name)) {
    const condition = def.name === 'block_revisions'
      ? `EXISTS (SELECT 1 FROM "block_revisions" saved WHERE saved."k0" = NEW."k0" AND saved."k1" = NEW."k1" AND saved."k2" = NEW."k2" AND saved."data" <> NEW."data")`
      : def.name === 'notes'
        ? `(NEW."data"::jsonb->>'sourceRevision')::bigint < (OLD."data"::jsonb->>'sourceRevision')::bigint OR ((NEW."data"::jsonb->'rawContent' IS DISTINCT FROM OLD."data"::jsonb->'rawContent' OR NEW."data"::jsonb->'blocks' IS DISTINCT FROM OLD."data"::jsonb->'blocks') AND (NEW."data"::jsonb->>'sourceRevision')::bigint <= (OLD."data"::jsonb->>'sourceRevision')::bigint)`
        : `NEW."data"::jsonb->'noteId' IS DISTINCT FROM OLD."data"::jsonb->'noteId' OR NEW."data"::jsonb->'blockId' IS DISTINCT FROM OLD."data"::jsonb->'blockId' OR NEW."data"::jsonb->'blockVersion' IS DISTINCT FROM OLD."data"::jsonb->'blockVersion'`;
    const code = def.name === 'block_revisions' ? 'revision_conflict' : def.name === 'notes' ? 'transaction_conflict' : 'invalid_session_pin';
    const guard = `${def.name}_guard`;
    await conn.exec(`CREATE OR REPLACE FUNCTION "${guard}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION '${code}'; END IF; RETURN NEW; END; $$`);
    await conn.exec(`DROP TRIGGER IF EXISTS "${guard}" ON "${def.name}"`);
    await conn.exec(`CREATE TRIGGER "${guard}" BEFORE ${def.name === 'block_revisions' ? 'INSERT' : 'UPDATE'} ON "${def.name}" FOR EACH ROW EXECUTE FUNCTION "${guard}"()`);
  }
}

/** Internal schema metadata is not exposed or cleared by the store API.
 *
 * Version policy: the SQL DDL derives entirely from STORE_DEFS, so two
 * schema versions are compatible iff their derived table sets are equal.
 *  - stored > DB_VERSION → refuse (never downgrade).
 *  - stored < DB_VERSION with EQUAL table sets (v29 → v30: defs unchanged,
 *    only browser-local sync stores were added) → bump the guard in place;
 *    no row is read, rewritten or erased.
 *  - stored < DB_VERSION with different tables → fail closed with the same
 *    actionable schema_incompatible error as before.
 *  - no guard + store tables → foreign database, refuse. */
export async function initializeStore(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS "${SCHEMA_TABLE}" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
    );
    // Layered sync protocol tables + libsql internals are not part of the
    // STORE_DEFS-derived schema and never participate in the comparison.
    const ignored = (name: string): boolean =>
      name.startsWith('_wodwiki_') || name.startsWith('sqlite_') || name === 'domain_note' || name === 'query_block';
    const storeTables = new Set<string>(STORE_DEFS.map((d) => d.name));
    for (const def of STORE_DEFS) {
      const multi = def.indexes.find((i) => i.multiEntry);
      if (multi) storeTables.add(junctionTable(def, multi));
    }
    const tableNames = new Set(
      (await tx.query(tableListSql(db.dialect))).map((r) => String(Object.values(r)[0])).filter((n) => !ignored(n)),
    );
    const guardRows = await tx.query(`SELECT "value" FROM "${SCHEMA_TABLE}" WHERE "key" = ?`, [SCHEMA_KEY]);
    let stored: number | undefined;
    if (guardRows[0]) {
      const guard = JSON.parse(String(guardRows[0].value)) as { version?: unknown };
      if (typeof guard.version !== 'number' || !Number.isSafeInteger(guard.version) || guard.version < 0) {
        throw new StorageError(500, `corrupt ${SCHEMA_TABLE} guard row`, 'bad_schema_guard');
      }
      stored = guard.version;
      if (stored > DB_VERSION) {
        throw new StorageError(
          500,
          `database schema v${stored} is newer than this server supports (v${DB_VERSION}); refusing to downgrade`,
          'schema_incompatible',
        );
      }
      if (stored < DB_VERSION) {
        const missing = [...storeTables].filter((name) => !tableNames.has(name));
        const unexpected = [...tableNames].filter((name) => name !== SCHEMA_TABLE && !storeTables.has(name));
        const additive = additiveStoresSince(stored);
        if (unexpected.length > 0 || missing.some((name) => !additive.has(name))) {
          throw new StorageError(
            500,
            `database schema v${stored} is incompatible with v${DB_VERSION} (missing tables: ${missing.join(', ') || 'none'}; unrecognized tables: ${unexpected.join(', ') || 'none'}); recreation required using an explicitly disposable database`,
            'schema_incompatible',
          );
        }
        // Only recognized additive stores are missing — ensureStoreTables
        // below creates them; the stored rows are never touched. Everything
        // else equalities hold and only the guard version moves forward.
      }
    } else if ([...tableNames].some((name) => storeTables.has(name))) {
      throw new StorageError(
        500,
        'database contains store tables but no wod-wiki schema guard; refusing to adopt a foreign database — point SQLITE_PATH/DATABASE_URL at a fresh database',
        'foreign_database',
      );
    }
    for (const def of STORE_DEFS) await ensureStoreTables(tx, db.dialect, def);
    if (stored !== DB_VERSION) {
      await tx.exec(
        `INSERT INTO "${SCHEMA_TABLE}" ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`,
        [SCHEMA_KEY, JSON.stringify({ version: DB_VERSION })],
      );
    }
  });
}
