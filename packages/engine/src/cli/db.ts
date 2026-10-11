/**
 * Local SQLite seam for the `wod` CLI.
 *
 * Opens a libsql `file:` database, initializes the shared storage schema
 * (KV store tables + domain projections), and adapts the rows into the WQL
 * store interfaces — the same shape the playground builds over IndexedDB.
 *
 * Everything heavy is loaded lazily (`@libsql/client`,
 * `@bitcobblers/wod-wiki-storage/sql`, node `fs`/`crypto`) so browser
 * bundles that import the engine index never pull native drivers; the
 * dynamic specifiers stay external in the CLI bundle.
 */

import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { Note, NoteSegment, Session } from '@bitcobblers/wod-wiki-storage';
import type { RangeDTO, StoreDef } from '@bitcobblers/wod-wiki-storage';
import type {
  Database,
  LibsqlClient,
  SqlConnection,
} from '@bitcobblers/wod-wiki-storage/sql';
import type {
  BlockQueryStore,
  EventStore,
  EffortQueryStore,
  NoteQueryStore,
  WqlDomainReadResult,
} from '@bitcobblers/wod-wiki-wql';
import { bundledEfforts } from '@bitcobblers/wod-wiki-lang';

/** Structural CJS require — avoids the deprecated NodeJS namespace type. */
type CjsRequire = (id: string) => unknown;

/** Minimal node builtin surfaces the CLI uses (kept out of browser bundles). */
export interface PathShim { resolve(...parts: string[]): string; dirname(p: string): string; basename(p: string): string }
export interface FsShim {
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  existsSync(p: string): boolean;
  unlinkSync(p: string): void;
  readFileSync(p: string, encoding: string): string;
  writeFileSync(p: string, data: string, encoding: string): void;
}
export interface HashShim { update(data: string): HashShim; digest(): Uint8Array }
export interface CryptoShim {
  createHash(algorithm: string): HashShim;
  randomUUID(): string;
}
export const nodePath = (): PathShim => nodeRequire()('node:path') as PathShim;
export const nodeFs = (): FsShim => nodeRequire()('node:fs') as FsShim;
export const nodeCrypto = (): CryptoShim => nodeRequire()('node:crypto') as CryptoShim;

/** Lazy CJS require — keeps node builtins out of browser bundles. */
function nodeRequire(): CjsRequire {
  const g = globalThis as { process?: { versions?: Record<string, string> }; Bun?: unknown; require?: CjsRequire };
  if (typeof g.process?.versions?.node === 'undefined' && typeof g.Bun === 'undefined') {
    throw new Error('SQLite operations are only supported in Node / Bun environments');
  }
  const req = g.require ?? (typeof require === 'function' ? require : undefined);
  if (!req) throw new Error('SQLite operations require a CJS require shim (missing tsup banner?)');
  return req;
}

/** The storage/sql surface the CLI uses — structural mirror so the lazy import types check. */
export interface SqlApi {
  libsqlDatabase(client: LibsqlClient): Database;
  initializeStore(db: Database): Promise<void>;
  initializeDomain(db: Database): Promise<void>;
  storeDefinition(name: string): StoreDef;
  listRows(conn: SqlConnection, def: StoreDef, range?: RangeDTO, count?: number, indexName?: string): Promise<unknown[]>;
  putRow(conn: SqlConnection, def: StoreDef, value: unknown): Promise<unknown>;
  deleteRows(conn: SqlConnection, def: StoreDef, keyOrRange: unknown): Promise<void>;
  refreshDomain(conn: SqlConnection, ops: unknown[]): Promise<unknown>;
  handleDomainQuery(db: Database, body: unknown): Promise<unknown>;
}

let sqlModulePromise: Promise<SqlApi> | undefined;

/** Lazily import the storage SQL subpath (kept external in the CLI bundle). */
export function loadSql(): Promise<SqlApi> {
  sqlModulePromise ??= import(/* @vite-ignore */ '@bitcobblers/wod-wiki-storage/sql') as Promise<SqlApi>;
  return sqlModulePromise;
}

export interface CliDb {
  db: Database;
  /** Absolute path of the underlying .sqlite file. */
  path: string;
  close(): Promise<void>;
}

/**
 * Resolve the effective database path: explicit flag wins, then
 * WOD_WIKI_DB, then ./wodwiki.db in the current working directory.
 */
export function resolveDbPath(dbPath?: string): string {
  const chosen = dbPath ?? process.env.WOD_WIKI_DB ?? './wodwiki.db';
  return nodePath().resolve(process.cwd(), chosen);
}

/** Open (creating if necessary) a local sqlite database with the wodwiki schema. */
export async function openCliDb(dbPath?: string): Promise<CliDb> {
  const [{ createClient }, sql] = await Promise.all([
    import(/* @vite-ignore */ '@libsql/client') as Promise<{ createClient: (config: { url: string }) => LibsqlClient }>,
    loadSql(),
  ]);
  const resolved = resolveDbPath(dbPath);
  nodeFs().mkdirSync(nodePath().dirname(resolved), { recursive: true });
  const db = sql.libsqlDatabase(createClient({ url: `file:${resolved}` }));
  await sql.initializeStore(db);
  await sql.initializeDomain(db);
  return { db, path: resolved, close: () => db.close() };
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

/** RFC-4122 byte munging + formatting over a 16-byte digest slice. */
export function formatV5Digest(digest: Uint8Array): string {
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** RFC-4122 v5 (SHA-1) name-based UUID — deterministic seed/note identity. */
export function uuid5(namespace: string, name: string): string {
  return formatV5Digest(nodeCrypto().createHash('sha1').update(namespace).update(name).digest());
}

/** Local namespace for wod-CLI derived identities (not shared with seed ids). */
export const CLI_UUID_NAMESPACE = 'c0ffee00-8b1a-4e2c-9d3f-5a6b7c8d9e0f';

/**
 * Stable note identity for a parsed/run source: the same file always maps
 * to the same note, so re-parsing updates instead of duplicating. Stdin
 * sources content-address (no stable path exists).
 */
export function stableNoteId(sourceLabel: string, content: string): string {
  if (sourceLabel && sourceLabel !== '-') {
    return uuid5(CLI_UUID_NAMESPACE, `wod-cli:${nodePath().resolve(process.cwd(), sourceLabel)}`);
  }
  return uuid5(CLI_UUID_NAMESPACE, `wod-cli:stdin:${content.length}:${content.slice(0, 256)}`);
}

export function randomId(): string {
  return nodeCrypto().randomUUID();
}

// ---------------------------------------------------------------------------
// WQL store adapters over the sqlite rows
// ---------------------------------------------------------------------------

async function allRows(sql: SqlApi, db: Database, store: string): Promise<unknown[]> {
  return sql.listRows(db, sql.storeDefinition(store));
}

async function rowsByIndex(sql: SqlApi, db: Database, store: string, index: string, only: string): Promise<unknown[]> {
  return sql.listRows(db, sql.storeDefinition(store), { only }, undefined, index);
}

/** EventStore over the `events` table — whole-table reads, keyed writes. */
export function sqliteEventStore(db: Database): EventStore {
  const all = async (): Promise<EventRecord[]> => (await allRows(await loadSql(), db, 'events')) as EventRecord[];
  return {
    getEventsByTimeRange: async (start, end) => (await all()).filter((r) => r.timestamp >= start && r.timestamp <= end),
    getEventsByResult: async (resultId) => (await all()).filter((r) => r.resultId === resultId),
    getEventsForNote: async (noteId) => (await all()).filter((r) => r.noteId === noteId),
    getEventsByContent: async (blockContentId) => (await all()).filter((r) => r.blockContentId === blockContentId),
    scanAll: all,
    appendEvents: async (appended) => {
      const sql = await loadSql();
      await db.transaction(async (tx) => {
        const eventsDef = sql.storeDefinition('events');
        for (const row of appended) await sql.putRow(tx, eventsDef, row);
      });
    },
    finalizeSummaries: async (resultId, finals) => {
      const sql = await loadSql();
      await db.transaction(async (tx) => {
        const eventsDef = sql.storeDefinition('events');
        const existing = ((await sql.listRows(tx, eventsDef)) as EventRecord[]).filter(
          (r) => r.resultId === resultId && r.grain === 'summary' && r.origin !== 'user',
        );
        for (const row of existing) await sql.deleteRows(tx, eventsDef, row.id);
        for (const row of finals) await sql.putRow(tx, eventsDef, row);
      });
    },
    deleteEvents: async (ids) => {
      const sql = await loadSql();
      await db.transaction(async (tx) => {
        const eventsDef = sql.storeDefinition('events');
        for (const id of ids) await sql.deleteRows(tx, eventsDef, id);
      });
    },
  };
}

interface StoredTag { id: string; label: string; type?: string }
interface StoredNoteTag { id: string; noteId: string; tagId: string }

/** NoteQueryStore over the notes/tags/note_tags rows + domain projection reads. */
export function sqliteNoteStore(db: Database): NoteQueryStore {
  return {
    getAllNotes: async () => (await allRows(await loadSql(), db, 'notes')) as never,
    getNoteIdsForTag: async (label) => {
      const sql = await loadSql();
      const tags = ((await allRows(sql, db, 'tags')) as StoredTag[]).filter((t) => t.label === label);
      const ids: Record<string, true> = {};
      for (const tag of tags) {
        for (const row of await rowsByIndex(sql, db, 'note_tags', 'by-tag', tag.id)) {
          ids[(row as StoredNoteTag).noteId] = true;
        }
      }
      return new Set(Object.keys(ids));
    },
    getNoteTagLabels: async (noteId) => {
      const sql = await loadSql();
      const tagRows = (await allRows(sql, db, 'tags')) as StoredTag[];
      const labelById: Record<string, string> = {};
      for (const t of tagRows) labelById[t.id] = t.label;
      const links = (await rowsByIndex(sql, db, 'note_tags', 'by-note', noteId)) as StoredNoteTag[];
      return links.map((l) => labelById[l.tagId]).filter((l): l is string => typeof l === 'string');
    },
    queryDomain: async (request) => {
      // WQL's domain wire is a structural mirror of the storage DomainQuery.
      const result = await (await loadSql()).handleDomainQuery(db, request as never);
      return result as WqlDomainReadResult;
    },
  };
}

/** BlockQueryStore over the block_index rows + domain projection reads. */
export function sqliteBlockStore(db: Database): BlockQueryStore {
  return {
    getAllBlocks: async () => (await allRows(await loadSql(), db, 'block_index')) as never,
    queryDomain: async (request) => {
      const result = await (await loadSql()).handleDomainQuery(db, { ...request, plan: 'blocks' } as never);
      return result as WqlDomainReadResult;
    },
  };
}

interface Slugged { slug: string }

/**
 * EffortQueryStore: rows the seed wrote into the `efforts` registry win by
 * slug; the lang-bundled registry fills the rest (same fallback the
 * playground's RegistryEffortStore performs).
 */
export function sqliteEffortStore(db: Database): EffortQueryStore {
  return {
    getAllEfforts: async () => {
      const stored = (await allRows(await loadSql(), db, 'efforts')) as Slugged[];
      const bySlug: Record<string, unknown> = {};
      for (const effort of stored) bySlug[effort.slug] = effort;
      for (const effort of bundledEfforts as unknown as Slugged[]) {
        bySlug[effort.slug] ??= effort;
      }
      return Object.values(bySlug) as never;
    },
  };
}

/** Generic by-index reader over a store table — the QueryService seam shape. */
export interface IndexStore { getAllFromIndex(index: string, key: string): Promise<unknown[]> }

/** Indexed reads over `block_efforts` / `tags` / `note_tags` rows. */
export function sqliteIndexStore(db: Database, store: 'block_efforts' | 'tags' | 'note_tags'): IndexStore {
  return {
    getAllFromIndex: async (index, key) => rowsByIndex(await loadSql(), db, store, index, key),
  };
}

// ---------------------------------------------------------------------------
// Download bundles (exchange feedstock)
// ---------------------------------------------------------------------------

export interface NoteBundle {
  note: Note | undefined;
  segments: NoteSegment[];
}

export interface SessionBundle {
  session: Session;
  events: EventRecord[];
}

/** Fetch a note + all its segment rows (every version). */
export async function getNoteBundle(db: Database, noteId: string): Promise<NoteBundle> {
  const sql = await loadSql();
  const notes = (await allRows(sql, db, 'notes')) as Array<{ id: string } & Record<string, unknown>>;
  const note = notes.find((n) => n.id === noteId) as Note | undefined;
  const segments = (await rowsByIndex(sql, db, 'segments', 'by-note', noteId)) as NoteSegment[];
  return { note, segments };
}

/** Fetch a session + its event/summary rows. */
export async function getSessionBundle(db: Database, resultId: string): Promise<SessionBundle | undefined> {
  const sql = await loadSql();
  const sessions = (await allRows(sql, db, 'sessions')) as Array<{ id: string } & Record<string, unknown>>;
  const session = sessions.find((s) => s.id === resultId) as Session | undefined;
  if (!session) return undefined;
  const events = ((await allRows(sql, db, 'events')) as EventRecord[]).filter((e) => e.resultId === resultId);
  return { session, events };
}
