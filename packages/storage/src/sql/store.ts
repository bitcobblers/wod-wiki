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

export const SCHEMA_TABLE = '_wodwiki_schema';
const SCHEMA_KEY = 'schema';

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

export async function putRow(conn: SqlConnection, def: StoreDef, value: unknown): Promise<KeyDTO> {
  const key = requireKey(def, value);
  const keyParts = toParts(key).map(toSqlScalar);
  const keys = keyCols(def);

  const cols = [...keys];
  const vals = [...keyParts];
  for (const idx of def.indexes) {
    if (idx.multiEntry) continue;
    idx.keyPath.forEach((path, part) => {
      cols.push(indexCol(idx.name, part));
      vals.push(toSqlScalar(extractKeyPart(value, path) ?? null));
    });
  }
  cols.push('data');
  // Codec keeps attachment ArrayBuffer payloads byte-exact (attachment-only field).
  vals.push(encodeRowJson(value, binaryFieldOf(def)));

  const keySet = new Set(keys);
  const updates = cols.filter((c) => !keySet.has(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
  const collist = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const pk = keys.map((k) => `"${k}"`).join(', ');
  await conn.exec(
    `INSERT INTO "${def.name}" (${collist}) VALUES (${placeholders}) ON CONFLICT (${pk}) DO UPDATE SET ${updates}`,
    vals,
  );

  const multi = multiEntryIndex(def);
  if (multi) {
    const jt = junctionTable(def, multi);
    const cond = keys.map((c) => `"${c}" = ?`).join(' AND ');
    await conn.exec(`DELETE FROM "${jt}" WHERE ${cond}`, keyParts);
    const items = arrayPart(value, multi.keyPath[0]);
    if (Array.isArray(items)) {
      const jcols = [...keys, 'v'];
      const jcollist = jcols.map((c) => `"${c}"`).join(', ');
      const jph = jcols.map(() => '?').join(', ');
      for (const item of items) {
        await conn.exec(
          `INSERT INTO "${jt}" (${jcollist}) VALUES (${jph}) ON CONFLICT DO NOTHING`,
          [...keyParts, JSON.stringify(item)],
        );
      }
    }
  }
  return key;
}

export async function deleteRows(conn: SqlConnection, def: StoreDef, keyOrRange: KeyDTO | RangeDTO): Promise<void> {
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

export async function clearRows(conn: SqlConnection, def: StoreDef): Promise<void> {
  const multi = multiEntryIndex(def);
  if (multi) await conn.exec(`DELETE FROM "${junctionTable(def, multi)}"`);
  await conn.exec(`DELETE FROM "${def.name}"`);
}

/** Wipe all user stores; system stores (memberships) survive and the internal
 * schema metadata table is not a store, so the version guard is untouched. */
export async function wipeRows(conn: SqlConnection): Promise<void> {
  for (const def of STORE_DEFS) {
    if (!def.system) await clearRows(conn, def);
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
}

/** Internal schema metadata is not exposed or cleared by the store API. */
export async function initializeStore(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(
      `CREATE TABLE IF NOT EXISTS "${SCHEMA_TABLE}" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`,
    );
    const storeTables = new Set<string>(STORE_DEFS.map((d) => d.name));
    const tableNames = new Set(
      (await tx.query(tableListSql(db.dialect))).map((r) => String(Object.values(r)[0])),
    );
    const guardRows = await tx.query(`SELECT "value" FROM "${SCHEMA_TABLE}" WHERE "key" = ?`, [SCHEMA_KEY]);
    let stored: number | undefined;
    if (guardRows[0]) {
      const guard = JSON.parse(String(guardRows[0].value)) as { version?: unknown };
      if (typeof guard.version !== 'number') {
        throw new StorageError(500, `corrupt ${SCHEMA_TABLE} guard row`, 'bad_schema_guard');
      }
      stored = guard.version;
      if (stored !== DB_VERSION) {
        throw new StorageError(
          500,
          `database schema v${stored} does not match this server (v${DB_VERSION}); use a compatible server or migrate a backed-up database`,
          'schema_incompatible',
        );
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
