/**
 * IndexedDB adapter — the browser data plane (moved verbatim from the
 * playground app; the shared user policy and the schema32 sync cutover live
 * here now). Local-first invariants:
 *
 *  - Every committed local transaction group is durable in `sync_outbox`,
 *    written in the SAME native transaction as the data writes.
 *  - Snapshots (`snapshotRows`, bootstrap, conversion) are policy-compliant:
 *    they carry user data only, per the shared policy in `../policy`.
 *  - `sync_state` holds pull cursors, upload watermarks and frozen
 *    bootstrap runs (durable retry identities), all per backup target.
 */

import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type {
  IReadOnlyStore, IReadWriteStore, IStorage, IStorageTransaction, StoreName, StoreType,
} from '../contract';
import { DB_VERSION, STORE_DEFS } from '../schema';
import {
  DEFAULT_LOCAL_DATABASE_NAME, isValidLocalDatabaseName, type LocalDatabaseInfo,
} from './catalog';
import { USER_OWNED_STORES, stampUserOwned } from '../membership';
import { keyFromValue, type KeyDTO } from '../wire';
import type { Note, Session, BlockRevision } from '../entities';
import {
  rowsEqual, validateStorageRow, validateNoteWrite, validateSessionWrite, validateStoredPins,
} from '../validation';
import { collectUserScopeContext, isUserOwnedRow, USER_DELETED_SEED_PREFIX, type UserScopeContext } from '../policy';
import { readRawSyncOps, readLegacyRows, type SyncEntry, type SyncMutation } from '../sql/sync';
import type { Database } from '../sql/connection';
import {
  parseDocumentSections, actionableSectionKind, matchDialectFence, KNOWN_SECTION_WIDGETS,
} from '@bitcobblers/wod-wiki-core';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';

export const IDB_DB_NAME = DEFAULT_LOCAL_DATABASE_NAME;

export {
  DEFAULT_LOCAL_DATABASE_NAME, deleteLocalDatabase,
  isValidLocalDatabaseName, listLocalDatabases, type LocalDatabaseInfo,
} from './catalog';

/** Create a named database at the current schema (DB_VERSION) by opening it
 *  through the regular adapter, then close. Refuses the default database —
 *  the catalog never touches the live app profile.
 *
 *  Lives beside the adapter (not in ./catalog) because it needs the
 *  adapter's schema upgrade path, and the adapter's module re-exports the
 *  catalog — importing the adapter back from the catalog would close a
 *  module cycle. */
export async function createLocalDatabase(name: string): Promise<LocalDatabaseInfo> {
  if (!isValidLocalDatabaseName(name)) throw new Error(`Invalid local database name "${String(name)}".`);
  if (name === DEFAULT_LOCAL_DATABASE_NAME) throw new Error('The default database cannot be created here.');
  const storage = new IndexedDBStorage({ dbName: name });
  try {
    await storage.open();
  } finally {
    await storage.close().catch(() => undefined);
  }
  return { name, version: DB_VERSION };
}

// Browser-local sync stores — NOT part of the shared STORE_DEFS spec (the
// SQL/API schema is unchanged). `sync_outbox` is the durable journal: one
// entry per committed local transaction group, written in the SAME native
// transaction as the data writes, so an aborted transaction never journals
// and a journaled group always reflects committed data. `sync_state` holds
// the pull cursor, the upload watermark and frozen bootstrap runs.
const OUTBOX_STORE = 'sync_outbox';
const SYNC_STATE_STORE = 'sync_state';
const LOCAL_SYNC_STORES = [
  { name: OUTBOX_STORE, keyPath: 'seq', autoIncrement: true },
  { name: SYNC_STATE_STORE, keyPath: 'key' },
] as const;

/** sync_state keys of frozen bootstrap runs (TursoSyncEngine naming). */
const BOOTSTRAP_RUN_PREFIX = 'bootstrap-run:';

const NON_SYSTEM_STORES: readonly StoreName[] = STORE_DEFS.filter(def => !def.system).map(def => def.name);

// Bootstrap chunks: whole ops only, bounded per group for network batches.
const BOOTSTRAP_MAX_OPS = 500;
const BOOTSTRAP_MAX_BYTES = 1_000_000;

/** Stores whose rows carry a raw binary field (base64 in the op log). */
const BINARY_SYNC_FIELDS: Record<string, string> = { attachments: 'data' };

/** Legacy direct-Turso tables that predate the current STORE_DEFS spec. */
const LEGACY_EXTRA_TABLES: { name: string; keyPath: string | string[] }[] = [
  { name: 'segments', keyPath: ['id', 'version'] },
  { name: 'results', keyPath: 'id' },
];

type Mode = 'readonly' | 'readwrite';
/** Native tx handle; write methods are guarded at runtime by `mutable`, so
 *  the handle is typed readwrite to keep put/delete/clear defined. */
type Tx = IDBPTransaction<unknown, string, 'readwrite'>;

/** Per-transaction mutation collector — becomes one outbox entry on commit.
 *  `ctx` lazily caches the tx's user-scope context (seed note ids) for
 *  journal-time ownership classification; invalidated when notes change. */
class TxJournal {
  readonly ops: SyncMutation[] = [];
  ctx?: Promise<UserScopeContext>;
}

/** Post-commit outbox notification — the sync engine debounces uploads off
 *  these instead of polling the network while the app is idle. Fired only
 *  AFTER the committing transaction durably lands (fire-and-forget). */
const outboxListeners = new Set<() => void>();

export function subscribeOutboxWrites(listener: () => void): () => void {
  outboxListeners.add(listener);
  return () => {
    outboxListeners.delete(listener);
  };
}

function notifyOutboxCommit(): void {
  for (const listener of outboxListeners) listener();
}

function isKeyRange(key: unknown): key is IDBKeyRange {
  return key !== null && typeof key === 'object' && !Array.isArray(key)
    && ('lower' in key || 'upper' in key || 'lowerOpen' in key || 'upperOpen' in key);
}

/** Approximate encoded op-log size of one mutation: JSON envelope plus
 *  base64-inflated binary cells (ArrayBuffer serializes as {} in JSON, so a
 *  plain JSON.stringify would undercount attachment-heavy batches). */
function mutationBytes(op: SyncMutation): number {
  if (op.op !== 'put') return 32; // envelope + key estimate
  let bytes = 32;
  const field = BINARY_SYNC_FIELDS[op.store];
  const value: unknown = op.value;
  const data = field && value !== null && typeof value === 'object' && !Array.isArray(value) && field in value
    ? Reflect.get(value, field)
    : undefined;
  bytes += typeof data === 'string' ? data.length
    : data instanceof ArrayBuffer ? Math.ceil(data.byteLength / 3) * 4 + 64
      : JSON.stringify(op.value)?.length ?? 0;
  return bytes;
}

/**
 * One policy-compliant snapshot as put mutations, in STORE_DEFS order.
 * Strict: a row whose key cannot be derived is corrupted data — it fails
 * the pass instead of being silently dropped.
 *
 * Immutable revision history is emitted BEFORE notes and sessions so chunk
 * boundaries (bootstrap/conversion grouping) can never split a pin from the
 * revision it references: every chunk that carries a consumer row already
 * carries its history.
 */
const SNAPSHOT_OP_ORDER: readonly StoreName[] = [
  'block_revisions',
  'notes',
  'sessions',
  ...NON_SYSTEM_STORES.filter(
    name => name !== 'block_revisions' && name !== 'notes' && name !== 'sessions',
  ),
];

/** Snapshot ops are always puts — narrowed so callers can read store/key. */
type SnapshotPut = Extract<SyncMutation, { op: 'put' }>;

async function policySnapshotOps(
  readAll: (store: StoreName) => Promise<unknown[]>,
): Promise<SnapshotPut[]> {
  const ctx = collectUserScopeContext(await readAll('notes'));
  const ops: SnapshotPut[] = [];
  for (const store of SNAPSHOT_OP_ORDER) {
    const def = STORE_DEFS.find(candidate => candidate.name === store)!;
    for (const row of await readAll(store)) {
      if (!isUserOwnedRow(store, row, ctx)) continue;
      ops.push({ op: 'put', store, key: keyFromValue(def, row), value: row });
    }
  }
  return ops;
}

class IDBStore<T> implements IReadWriteStore<T> {
  constructor(
    private readonly owner: IndexedDBStorage,
    private readonly name: StoreName,
    private readonly tx?: Tx,
    private readonly mutable = false,
    private readonly touched?: { notes: Set<string>; sessions: Set<string> },
    private readonly journal?: TxJournal,
  ) {}

  async get(key: IDBValidKey): Promise<T | undefined> {
    if (this.tx) return this.tx.objectStore(this.name).get(key);
    return (await this.owner.open()).get(this.name, key);
  }

  async getMany(keys: IDBValidKey[]): Promise<(T | undefined)[]> {
    if (this.tx) return Promise.all(keys.map(key => this.tx!.objectStore(this.name).get(key)));
    return this.owner.transaction([this.name], 'readonly', tx => tx.readonly(this.name).getMany(keys)) as Promise<(T | undefined)[]>;
  }

  async getAll(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    if (this.tx) return this.tx.objectStore(this.name).getAll(query, count);
    return (await this.owner.open()).getAll(this.name, query, count);
  }

  async getAllFromIndex(index: string, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    if (this.tx) return this.tx.objectStore(this.name).index(index).getAll(query, count);
    return (await this.owner.open()).getAllFromIndex(this.name, index, query, count);
  }

  async getAllFromIndexMany(index: string, keys: IDBValidKey[]): Promise<T[][]> {
    if (this.tx) return Promise.all(keys.map(key => this.tx!.objectStore(this.name).index(index).getAll(key)));
    return this.owner.transaction([this.name], 'readonly', tx => tx.readonly(this.name).getAllFromIndexMany(index, keys)) as Promise<T[][]>;
  }

  async count(query?: IDBValidKey | IDBKeyRange): Promise<number> {
    if (this.tx) return this.tx.objectStore(this.name).count(query);
    return (await this.owner.open()).count(this.name, query);
  }

  async countFromIndex(index: string, query?: IDBValidKey | IDBKeyRange): Promise<number> {
    if (this.tx) return this.tx.objectStore(this.name).index(index).count(query);
    return (await this.owner.open()).countFromIndex(this.name, index, query);
  }

  async put(value: T, _key?: IDBValidKey): Promise<IDBValidKey> {
    if (!this.mutable) throw new Error('read-only store');
    if (!this.tx) {
      const scope = this.name === 'notes' ? [this.name, 'block_revisions'] as const : [this.name, 'block_revisions', 'notes'] as const;
      return this.owner.transaction([...scope], 'readwrite', tx => tx.readwrite(this.name).put(value as StoreType<typeof this.name>));
    }
    const stored = this.owner.stamp(this.name, value);
    validateStorageRow(this.name, stored);
    const def = STORE_DEFS.find(def => def.name === this.name)!;
    const key = keyFromValue(def, stored);
    const store = this.tx.objectStore(this.name);
    const previous = await store.get(key);
    if (this.name === 'block_revisions' && previous !== undefined && !rowsEqual(previous, stored)) throw new Error('immutable block revision collision');
    if (this.name === 'notes') validateNoteWrite(previous, stored);
    if (this.name === 'sessions') validateSessionWrite(previous, stored);
    if (rowsEqual(previous, stored)) return key;
    const result = await store.put(stored);
    if (!def.system && this.journal) {
      // Journal-time ownership classification (§3.4), INSIDE the write
      // transaction: user→user and seed→user emit complete user puts;
      // seed→seed ships nothing (the remote re-imports seed data itself);
      // user→seed emits a tombstone for the former user record instead of
      // silently dropping it.
      const ctx = this.name === 'notes'
        ? undefined
        : await (this.journal.ctx ??= this.owner.policyContext(this.tx!));
      const wasUser = previous !== undefined && isUserOwnedRow(this.name, previous, ctx ?? collectUserScopeContext([]));
      const isUser = isUserOwnedRow(this.name, stored, ctx ?? collectUserScopeContext([]));
      if (isUser) {
        if (this.name === 'notes' && stored !== null && typeof stored === 'object' && 'id' in stored) {
          for (const revision of await this.tx.objectStore('block_revisions').index('by-note').getAll(String(stored.id))) {
            this.journal.ops.push({ op: 'put', store: 'block_revisions', key: [revision.noteId, revision.blockId, revision.version], value: revision });
          }
        } else if (this.name === 'sessions' && stored !== null && typeof stored === 'object' && 'noteId' in stored && 'blockId' in stored && 'blockVersion' in stored) {
          const revisionKey = [stored.noteId, stored.blockId, stored.blockVersion] as IDBValidKey;
          const revision = await this.tx.objectStore('block_revisions').get(revisionKey);
          if (revision) this.journal.ops.push({ op: 'put', store: 'block_revisions', key: revisionKey as KeyDTO, value: revision });
        }
        this.journal.ops.push({ op: 'put', store: this.name, key: key as KeyDTO, value: stored });
      }
      else if (wasUser) this.journal.ops.push({ op: 'delete', store: this.name, key: key as KeyDTO });
      // notes writes shift seed provenance — reclassify later stores in
      // this transaction against the post-write notes.
      if (this.name === 'notes') this.journal.ctx = undefined;
    }
    if (this.name === 'notes') this.touched?.notes.add(String(key));
    if (this.name === 'sessions') this.touched?.sessions.add(String(key));
    return result;
  }

  async putMany(values: T[], keys?: IDBValidKey[]): Promise<IDBValidKey[]> {
    if (keys && keys.length !== values.length) throw new Error('putMany key count mismatch');
    if (!this.tx) {
      const scope = this.name === 'notes' ? [this.name, 'block_revisions'] as const : [this.name, 'block_revisions', 'notes'] as const;
      return this.owner.transaction([...scope], 'readwrite', tx => tx.readwrite(this.name).putMany(values as StoreType<typeof this.name>[], keys));
    }
    const out: IDBValidKey[] = [];
    for (let i = 0; i < values.length; i++) out.push(await this.put(values[i], keys?.[i]));
    return out;
  }

  async delete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.name === 'block_revisions') throw new Error('block history requires explicit wipe');
    if (!this.tx) {
      // Journal-time ownership classification reads notes in the same tx.
      const scope = this.name === 'notes' ? [this.name] as const : [this.name, 'notes'] as const;
      return this.owner.transaction([...scope], 'readwrite', tx => tx.readwrite(this.name).delete(key));
    }
    if (this.name === 'notes') {
      for (const note of await this.tx.objectStore('notes').getAll(key)) {
        for (const name of ['block_index', 'block_efforts', 'block_equipment'] as const) {
          const store = this.tx.objectStore(name);
          for (const id of await store.index('by-note').getAllKeys(note.id)) {
            const projection = new IDBStore(this.owner, name, this.tx, true, this.touched, this.journal);
            await projection.delete(id);
          }
        }
      }
    }
    await this.recordDelete(key);
    await this.tx.objectStore(this.name).delete(key);
  }

  /** Journal a delete as per-key tombstones (ranges expand to their keys).
   *  Journal-time ownership: only deletes of USER-scope rows ship — a seed
   *  row's removal is re-imported remotely, not a user mutation (deleting a
   *  seed NOTE carries intent via the user-deleted-seed meta tombstone the
   *  caller writes in the same transaction). */
  private async recordDelete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    if (!this.journal) return;
    const store = this.tx!.objectStore(this.name);
    const keys = isKeyRange(key) ? await store.getAllKeys(key) : [key as IDBValidKey];
    const ctx = this.name === 'notes'
      ? undefined
      : await (this.journal.ctx ??= this.owner.policyContext(this.tx!));
    for (const k of keys) {
      const previous = await store.get(k);
      if (previous !== undefined && !isUserOwnedRow(this.name, previous, ctx ?? collectUserScopeContext([]))) continue;
      this.journal.ops.push({ op: 'delete', store: this.name, key: k as KeyDTO });
    }
  }

  /**
   * User-scope clear: expands to per-key deletes of user-owned rows,
   * journaled the same way so replay preserves exactly what the local clear
   * preserved — seed content (re-importable), pinned revision history
   * (block_revisions requires explicit wipe) and seed-deletion tombstones
   * survive a clear. A journaled `{op:'clear'}` would wipe seed rows on
   * every replaying device.
   */
  async clear(): Promise<void> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.name === 'block_revisions') throw new Error('block history requires explicit wipe');
    if (!this.tx) {
      const scope = this.name === 'notes' ? ['notes', 'block_index', 'block_efforts'] as const : [this.name, 'notes'] as const;
      return this.owner.transaction([...scope], 'readwrite', tx => tx.readwrite(this.name).clear());
    }
    const store = this.tx.objectStore(this.name);
    const rows = await store.getAll() as unknown[];
    const notes = this.name === 'notes' ? rows : await this.tx.objectStore('notes').getAll() as unknown[];
    const ctx = collectUserScopeContext(notes);
    for (const row of rows) {
      const key = keyFromValue(STORE_DEFS.find(def => def.name === this.name)!, row);
      if (!isUserOwnedRow(this.name, row, ctx)) continue;
      if (this.name === 'meta' && typeof key === 'string' && key.startsWith(USER_DELETED_SEED_PREFIX)) continue;
      if (this.name === 'notes' && typeof key === 'string') {
        // Cascade the note's projections first — keys read BEFORE deletion,
        // each journaled as its own tombstone.
        for (const name of ['block_index', 'block_efforts', 'block_equipment'] as const) {
          const projections = this.tx.objectStore(name);
          for (const id of await projections.index('by-note').getAllKeys(key)) {
            this.journal?.ops.push({ op: 'delete', store: name, key: id as KeyDTO });
            await projections.delete(id);
          }
        }
      }
      await this.recordDelete(key);
      await store.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy row shapes (V20–V28) — read-only migration input, never written back.
// ---------------------------------------------------------------------------

interface LegacySessionData {
  logs?: unknown[];
  startTime?: number;
  endTime?: number;
  duration?: number;
  completed?: boolean;
  roundsCompleted?: number;
  totalRounds?: number;
  repsCompleted?: number;
}

type LegacySession = Session & { data?: LegacySessionData; segmentId?: string; segmentVersion?: number; version?: number };

interface LegacySegment {
  id: string;
  version: number;
  noteId: string;
  position?: number;
  dataType: string;
  rawContent: string;
  sourceContent?: string;
  createdAt: number;
  isHistory?: boolean;
}

interface LegacyBlockIndexRow {
  id: string;
  noteId: string;
  segmentId: string;
  segmentVersion?: number;
  position?: number;
  dataType: string;
  rawContent: string;
  noteTitle: string;
  createdAt: number;
  isStatic?: boolean;
  sourceId?: string;
  sourcePath?: string;
  routeId?: string;
  blockContentId?: string;
}

const SEGMENT_TO_BLOCK_KIND: Record<string, 'wod'> = { script: 'wod', wod: 'wod' };

function legacyDialect(rawContent: string): { dialect?: 'time' | 'log'; sport?: string } {
  const first = rawContent.slice(0, rawContent.indexOf('\n'));
  return matchDialectFence(first.trim()) ?? {};
}

export class IndexedDBStorage implements IStorage {
  private opening?: Promise<IDBPDatabase>;
  constructor(private readonly options: {
    getUserId?: () => string;
    /** Called just before a schema migration runs (oldVersion < DB_VERSION). */
    onUpgradeStart?: (fromVersion: number) => void;
    /** Database file name; the sync engine migrates scratch copies under
     *  their own name so a remote-schema conversion never touches the
     *  live database. Defaults to the app database. */
    dbName?: string;
  } = {}) {}

  open(): Promise<IDBPDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
    if (!this.opening) {
      let newer = false;
      let pre20 = 0;
      let migrationError: Error | undefined;
      this.opening = openDB(this.options.dbName ?? IDB_DB_NAME, DB_VERSION, {
        upgrade: async (db, oldVersion, _version, tx) => {
          void tx.done.catch(() => {});
          if (oldVersion > DB_VERSION) {
            // A newer client owns this database — never downgrade or rewrite it.
            newer = true;
            tx.abort();
            return;
          }
          if (oldVersion !== 0 && oldVersion < 20) {
            // Pre-V20 layouts predate the versioned migration chain. Their
            // rows are NEVER silently destroyed: the upgrade aborts with an
            // actionable error so the user can export from an older app or
            // explicitly clear site data. The database file stays untouched.
            pre20 = oldVersion;
            tx.abort();
            return;
          }
          try {
            createMissingStores(db, tx);
            if (oldVersion !== 0 && oldVersion < DB_VERSION) this.options.onUpgradeStart?.(oldVersion);
            await migrateSchema(db, oldVersion, tx);
          } catch (error) {
            migrationError = error instanceof Error ? error : new Error(String(error));
            try { tx.abort(); } catch { /* The failed request may already have aborted it. */ }
          }
        },
        blocking: () => { void this.close(); },
      }).catch(error => {
        this.opening = undefined;
        if (migrationError) throw migrationError;
        if (pre20 !== 0) {
          throw new Error(
            `local database schema v${pre20} predates the supported migration chain (v20+). `
            + 'Open this browser profile in an intermediate app version to export your data, '
            + 'or clear site data to start fresh — the old database was left untouched.',
          );
        }
        throw newer || (error instanceof DOMException && error.name === 'VersionError')
          ? new Error(`database schema is newer than this client supports (v${DB_VERSION}); refusing to downgrade`) : error;
      });
    }
    return this.opening;
  }

  stamp(store: StoreName, value: unknown): unknown {
    const userId = this.options.getUserId?.();
    return userId ? stampUserOwned(store, value, userId) : value;
  }

  /** User-scope context (proven seed note ids) from the notes of `tx` —
   *  journal-time ownership classification reads it INSIDE the same
   *  transaction, so a seed import's note writes are visible to the link
   *  writes that follow in the same commit. Internal seam for IDBStore. */
  async policyContext(tx?: Tx): Promise<UserScopeContext> {
    const notes = tx
      ? await tx.objectStore('notes').getAll() as unknown[]
      : await (await this.open()).getAll('notes') as unknown[];
    return collectUserScopeContext(notes);
  }

  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>> { return new IDBStore(this, store); }
  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>> { return new IDBStore(this, store, undefined, true); }

  async transaction<K extends StoreName, R>(stores: K[], mode: Mode, fn: (tx: IStorageTransaction) => Promise<R>): Promise<R> {
    const db = await this.open();
    const journal = mode === 'readwrite' ? new TxJournal() : undefined;
    const scope = new Set<string>(stores);
    if (mode === 'readwrite') {
      scope.add('block_revisions');
      scope.add(OUTBOX_STORE);
      scope.add('notes');
      if (scope.has('notes')) {
        scope.add('block_index');
        scope.add('block_efforts');
        scope.add('block_equipment');
      }
    }
    const native = db.transaction([...scope], mode) as Tx;
    const done = native.done;
    void done.catch(() => {});
    const touched = { notes: new Set<string>(), sessions: new Set<string>() };
    const adapter: IStorageTransaction = {
      readonly: name => {
        if (!scope.has(name)) throw new Error('store outside transaction scope');
        return new IDBStore(this, name, native);
      },
      readwrite: name => {
        if (mode !== 'readwrite') throw new Error('read-only transaction');
        if (!scope.has(name)) throw new Error('store outside transaction scope');
        return new IDBStore(this, name, native, true, touched, journal);
      },
    };
    try {
      const result = await fn(adapter);
      const notes = (await Promise.all([...touched.notes].map(id => native.objectStore('notes').get(id)))).filter(Boolean) as Note[];
      const sessions = (await Promise.all([...touched.sessions].map(id => native.objectStore('sessions').get(id)))).filter(Boolean) as Session[];
      await validateStoredPins(notes, sessions, keys => Promise.all(keys.map(key => native.objectStore('block_revisions').get(key))) as Promise<(BlockRevision | undefined)[]>);
      // Durable outbox: the journal entry lands in the SAME transaction as
      // the data writes — it commits with them and vanishes with them.
      if (journal && journal.ops.length > 0) {
        await native.objectStore(OUTBOX_STORE).put({ id: crypto.randomUUID(), at: Date.now(), ops: journal.ops });
      }
      await done;
      if (journal && journal.ops.length > 0) notifyOutboxCommit();
      return result;
    } catch (error) {
      try { native.abort(); } catch { /* The native request may have already aborted. */ }
      await done.catch(() => {});
      throw error;
    }
  }

  async wipeUserData(): Promise<void> {
    const names = STORE_DEFS.filter(def => !def.system && def.name !== 'block_revisions').map(def => def.name);
    await this.transaction(names, 'readwrite', async tx => {
      for (const name of names) await tx.readwrite(name).clear();
    });
  }

  async wipe(): Promise<void> {
    const db = await this.open();
    const names = STORE_DEFS.filter(def => !def.system).map(def => def.name);
    const tx = db.transaction([...names, OUTBOX_STORE], 'readwrite');
    await Promise.all(names.map(name => tx.objectStore(name).clear()));
    await tx.objectStore(OUTBOX_STORE).put({ id: crypto.randomUUID(), at: Date.now(), ops: [{ op: 'wipe' }] });
    await tx.done;
    notifyOutboxCommit();
  }

  // -----------------------------------------------------------------------
  // Sync seams (Turso backup engine only — not part of IStorage).
  // -----------------------------------------------------------------------

  /** Pending committed transaction groups, in commit order. */
  async readOutbox(afterSeq: number, limit: number): Promise<{ seq: number; id: string; at: number; ops: SyncMutation[] }[]> {
    const db = await this.open();
    const range = IDBKeyRange.lowerBound(afterSeq, true);
    // IDB counts are unsigned long — clamp callers' "unbounded" shorthand.
    return (await db.getAll(OUTBOX_STORE, range, Math.min(limit, 0xffffffff))) as { seq: number; id: string; at: number; ops: SyncMutation[] }[];
  }

  /** Drop acknowledged groups. Callers pass only the contiguous acked
   *  watermark — a failed upload never truncates pending writes. */
  async ackOutbox(upToSeq: number): Promise<void> {
    const db = await this.open();
    const keys = await db.getAllKeys(OUTBOX_STORE, IDBKeyRange.upperBound(upToSeq));
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    await Promise.all(keys.map(key => tx.store.delete(key)));
    await tx.done;
  }

  async getSyncState<T>(key: string): Promise<T | undefined> {
    const row = (await (await this.open()).get(SYNC_STATE_STORE, key)) as { value: T } | undefined;
    return row?.value;
  }

  async setSyncState(key: string, value: unknown): Promise<void> {
    await (await this.open()).put(SYNC_STATE_STORE, { key, value });
  }

  /**
   * Freeze ONE durable bootstrap run for `key` (per backup target): a
   * policy-compliant snapshot of the current rows, chunked into ≤500-op /
   * ≤~1MB entries with a unique run UUID and stable chunk ids, persisted in
   * `sync_state[key]` in the SAME readwrite transaction that reads the data
   * — so a retry returns the byte-identical frozen entries (idempotent
   * remote replays), and a crash before the commit freezes nothing. No
   * network happens here.
   *
   * Pending outbox groups are read INSIDE the same transaction: their
   * touched keys/stores are excluded from the snapshot so the journal (which
   * ships after the bootstrap, in commit order) stays the last writer and
   * nothing ships twice. A pending wipe freezes an empty run — the journal
   * wipe itself still ships and decides the remote's end state.
   *
   * The engine deletes the frozen run (`db.delete('sync_state', key)`) only
   * after the remote commit; until then every retry replays these entries.
   */
  async captureSyncBootstrap(key: string): Promise<SyncEntry[]> {
    const db = await this.open();
    const tx = db.transaction([...NON_SYSTEM_STORES, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');
    const state = tx.objectStore(SYNC_STATE_STORE);
    const frozen = await state.get(key) as { value?: SyncEntry[] } | undefined;
    if (frozen !== undefined && Array.isArray(frozen.value)) {
      await tx.done;
      return frozen.value;
    }
    const pendingKeys = new Set<string>();
    const clearedStores = new Set<string>();
    let wiped = false;
    for (const group of await tx.objectStore(OUTBOX_STORE).getAll() as { ops: SyncMutation[] }[]) {
      for (const op of group.ops) {
        if (op.op === 'put' || op.op === 'delete') pendingKeys.add(`${op.store}:${JSON.stringify(op.key)}`);
        else if (op.op === 'clear') clearedStores.add(op.store);
        else wiped = true;
      }
    }
    const run = crypto.randomUUID();
    const entries: SyncEntry[] = [];
    if (!wiped) {
      let ops: SyncMutation[] = [];
      let bytes = 0;
      const flush = (): void => {
        if (ops.length === 0) return;
        entries.push({ id: `bootstrap:${run}:${entries.length}`, at: Date.now(), ops });
        ops = [];
        bytes = 0;
      };
      for (const op of await policySnapshotOps(store => tx.objectStore(store).getAll() as Promise<unknown[]>)) {
        if (clearedStores.has(op.store)) continue;
        // Immutable history is NEVER excluded: a snapshotted note/session
        // may pin a revision still pending in the journal, and the snapshot
        // ships first — the pinned revision must already be on the remote.
        // Revision-first op ordering keeps every chunk self-contained.
        if (op.store !== 'block_revisions' && pendingKeys.has(`${op.store}:${JSON.stringify(op.key)}`)) continue;
        const size = mutationBytes(op);
        if (ops.length > 0 && (ops.length >= BOOTSTRAP_MAX_OPS || bytes + size > BOOTSTRAP_MAX_BYTES)) flush();
        ops.push(op);
        bytes += size;
      }
      flush();
    }
    // Frozen BEFORE any network I/O — same transaction as the snapshot read.
    await state.put({ key, value: entries });
    await tx.done;
    return entries;
  }

  /**
   * Validate every stored pin (note blocks + session pins against
   * block_revisions) in ONE consistent readonly read — the post-restore
   * gate: a replayed backup with missing history fails loudly here instead
   * of surfacing later as broken sessions.
   */
  async validateSyncState(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['notes', 'sessions', 'block_revisions'], 'readonly');
    const notes = await tx.objectStore('notes').getAll() as Note[];
    const sessions = await tx.objectStore('sessions').getAll() as Session[];
    const revisions = tx.objectStore('block_revisions');
    await validateStoredPins(
      notes,
      sessions,
      keys => Promise.all(keys.map(key => revisions.get(key))) as Promise<(BlockRevision | undefined)[]>,
    );
    await tx.done;
  }

  /**
   * Apply remotely committed mutations locally (pull/replay) WITHOUT
   * journaling — a pulled mutation must never re-enter the outbox. Runs in
   * one native transaction together with the cursor update.
   *
   * Unsent-edit overlay: pending outbox groups (committed local writes not
   * yet acknowledged remotely) are read INSIDE the same transaction and
   * replayed after the remote rows — a local edit/delete/clear/wipe that
   * committed while the pull was on the network stays the visible state;
   * the remote row is backed up locally, not clobbered over the user.
   *
   * Conflict policy (deterministic, history-preserving):
   *  - notes: an incoming row with a LOWER sourceRevision than the existing
   *    row is stale — skipped, never clobbers newer history.
   *  - block_revisions: same key with different contents keeps BOTH rows —
   *    the incoming version is re-keyed to the next free version for that
   *    block. Immutable history is never silently replaced.
   *  - memberships (system): remote mutations are skipped — identity truth
   *    stays local and snapshot/upload never include them.
   *
   * Returns committed-boundary counts of canonical consumer records (notes +
   *  efforts only; internal/journal rows never reach the sync toast).
   * `cursorKey` keeps cursors per backup target.
   */
  async applySyncMutations(
    mutations: SyncMutation[],
    cursorRev: number | null,
    cursorKey = 'cursor',
  ): Promise<{ added: number; updated: number }> {
    const defsByName = new Map<string, (typeof STORE_DEFS)[number]>(STORE_DEFS.map(def => [def.name, def]));
    for (const mutation of mutations) {
      if (mutation.op === 'clear' || mutation.op === 'wipe') continue;
      const def = defsByName.get(mutation.store);
      if (!def) throw new Error(`unknown store in sync mutation: ${String(mutation.store)}`);
      if (mutation.op === 'put' || mutation.op === 'delete') {
        const parts = Array.isArray(mutation.key) ? mutation.key : [mutation.key];
        if (parts.length !== def.keyPath.length || !parts.every(part => typeof part === 'string' || typeof part === 'number')) {
          throw new Error(`sync ${mutation.op} key arity/shape mismatch for ${mutation.store}`);
        }
      }
      if (mutation.op === 'put') validateStorageRow(mutation.store, mutation.value);
    }
    const db = await this.open();
    const names = NON_SYSTEM_STORES as StoreName[];
    const tx = db.transaction([...names, OUTBOX_STORE, SYNC_STATE_STORE], 'readwrite');

    // Counting baseline: every canonical key this batch touches, read before
    // any write lands.
    const canonical = (store: StoreName): store is 'notes' | 'efforts' => store === 'notes' || store === 'efforts';
    const touched = new Map<string, { store: 'notes' | 'efforts'; key: IDBValidKey; before: unknown; beforeExists: boolean }>();
    for (const mutation of mutations) {
      if (mutation.op === 'clear' || mutation.op === 'wipe') continue;
      if (!canonical(mutation.store)) continue;
      const id = `${mutation.store}:${JSON.stringify(mutation.key)}`;
      if (touched.has(id)) continue;
      const key = mutation.key as IDBValidKey;
      const before = await tx.objectStore(mutation.store).get(key);
      touched.set(id, { store: mutation.store, key, before, beforeExists: before !== undefined });
    }

    const applyOne = async (mutation: SyncMutation, preferLocal: boolean): Promise<void> => {
      if (mutation.op === 'wipe') {
        for (const name of names) await tx.objectStore(name).clear();
        return;
      }
      if (mutation.store === 'memberships') return; // system store: never applied remotely
      if (mutation.op === 'clear') {
        if (mutation.store === 'block_revisions') return;
        const store = tx.objectStore(mutation.store);
        const ctx = collectUserScopeContext(await tx.objectStore('notes').getAll());
        for (const row of await store.getAll()) {
          if (!isUserOwnedRow(mutation.store, row, ctx)) continue;
          const key = keyFromValue(defsByName.get(mutation.store)!, row);
          if (mutation.store === 'meta' && typeof key === 'string' && key.startsWith(USER_DELETED_SEED_PREFIX)) continue;
          await applyOne({ op: 'delete', store: mutation.store, key }, preferLocal);
        }
        return;
      }
      if (mutation.op === 'delete') {
        if (mutation.store === 'notes') {
          const noteId = String(Array.isArray(mutation.key) ? mutation.key[0] : mutation.key);
          for (const name of ['block_index', 'block_efforts', 'block_equipment'] as const) {
            const store = tx.objectStore(name);
            for (const id of await store.index('by-note').getAllKeys(noteId)) await store.delete(id);
          }
        }
        if (mutation.store !== 'block_revisions') await tx.objectStore(mutation.store).delete(mutation.key as IDBValidKey);
        return;
      }
      // put
      const store = tx.objectStore(mutation.store);
      if (mutation.store === 'block_revisions') {
        const existing = await store.get(mutation.key as IDBValidKey);
        if (existing !== undefined && !rowsEqual(existing, mutation.value) && !preferLocal) {
          // Immutable-history collision: preserve BOTH as versioned records —
          // the incoming row moves to the next free version for that block.
          // Both rows passed validateStorageRow when written (the incoming row
          // just above; the existing row at its original commit), so the
          // revision shape is guaranteed here.
          const incoming = mutation.value as BlockRevision;
          const existingRow = existing as BlockRevision;
          let version = existingRow.version + 1;
          while (await store.get([incoming.noteId, incoming.blockId, version] as IDBValidKey) !== undefined) version += 1;
          await store.put({ ...incoming, version });
          return;
        }
        if (existing === undefined || !rowsEqual(existing, mutation.value)) await store.put(mutation.value);
        return;
      }
      if (mutation.store === 'notes' && !preferLocal) {
        const existing = await store.get(mutation.key as IDBValidKey);
        // Same validateStorageRow guarantee as above: rows in the store carry
        // the note shape, so comparing source revisions is safe.
        if (existing !== undefined) {
          const existingNote = existing as Note;
          const incomingNote = mutation.value as Note;
          if (existingNote.sourceRevision > incomingNote.sourceRevision) return; // stale remote write
        }
      }
      await store.put(mutation.value);
    };

    for (const mutation of mutations) await applyOne(mutation, false);

    // Unsent-edit overlay: replay pending outbox groups in commit order so
    // the user's latest local writes remain the visible latest state.
    const pending = ((await tx.objectStore(OUTBOX_STORE).getAll()) as { seq: number; ops: SyncMutation[] }[])
      .sort((a, b) => a.seq - b.seq);
    for (const group of pending) {
      for (const op of group.ops) await applyOne(op, true);
    }

    // Committed-boundary counts: canonical notes/efforts whose final visible
    // value is new or changed relative to the pre-pull baseline.
    let added = 0;
    let updated = 0;
    for (const entry of touched.values()) {
      const final = await tx.objectStore(entry.store).get(entry.key);
      if (final === undefined) continue; // deleted by the batch — not an add/update
      if (!entry.beforeExists) added += 1;
      else if (!rowsEqual(entry.before, final)) updated += 1;
    }

    if (cursorRev !== null) await tx.objectStore(SYNC_STATE_STORE).put({ key: cursorKey, value: { rev: cursorRev } });
    await tx.done;
    return { added, updated };
  }

  /**
   * Consistent atomic snapshot, policy-compliant (shared user policy): only
   * user-scope rows of the non-system stores, read in ONE readonly
   * transaction — the backup never mixes the pre/post state of a concurrent
   * local commit. System stores (memberships) are excluded: they never sync.
   * Use `snapshotAllRows` for the lossless (unfiltered) form.
   */
  async snapshotRows(): Promise<{ store: StoreName; rows: unknown[] }[]> {
    const db = await this.open();
    const defs = STORE_DEFS.filter(def => !def.system);
    const tx = db.transaction(defs.map(def => def.name), 'readonly');
    // Ownership context comes from the SAME snapshot transaction — reading
    // notes before opening it could diverge from a concurrent note write.
    const ctx = collectUserScopeContext(await tx.objectStore('notes').getAll() as unknown[]);
    const out = await Promise.all(
      defs.map(async def => ({
        store: def.name,
        rows: ((await tx.objectStore(def.name).getAll() as unknown[])).filter(row => isUserOwnedRow(def.name, row, ctx)),
      })),
    );
    await tx.done;
    return out;
  }

  /** Lossless snapshot of every NON-SYSTEM store (meta included) in one
   *  readonly transaction — local export / restore emptiness checks. A
   *  freshly initialized database may hold a default membership, so the
   *  system store is excluded from both uses. */
  async snapshotAllRows(): Promise<{ store: StoreName; rows: unknown[] }[]> {
    const db = await this.open();
    const defs = STORE_DEFS.filter(def => !def.system);
    const tx = db.transaction(defs.map(def => def.name), 'readonly');
    const out = await Promise.all(
      defs.map(async def => ({ store: def.name, rows: await tx.objectStore(def.name).getAll() as unknown[] })),
    );
    await tx.done;
    return out;
  }

  async close(): Promise<void> {
    const opening = this.opening;
    this.opening = undefined;
    (await opening?.catch(() => undefined))?.close();
  }
}

// ---------------------------------------------------------------------------
// Cross-schema conversion — the exact IndexedDB upgrade chain on a scratch
// database. Reads the source WITHOUT writing it; used by the CLI to migrate
// older remotes into fresh v32 targets (trusted runtimes load
// fake-indexeddb as the browser adapter first).
// ---------------------------------------------------------------------------

type ScratchOp =
  | { kind: 'put'; table: string; row: unknown }
  | { kind: 'delete'; table: string; key: IDBValidKey }
  | { kind: 'clear'; table: string };

/** Scratch layout: current stores plus the pre-V26 legacy tables. */
const SCRATCH_TABLES: readonly { name: string; keyPath: string[] }[] = [
  ...STORE_DEFS.map(def => ({ name: def.name, keyPath: def.keyPath })),
  ...LEGACY_EXTRA_TABLES.map(table => ({ name: table.name, keyPath: Array.isArray(table.keyPath) ? table.keyPath : [table.keyPath] })),
];

const SCRATCH_TABLE_BY_NAME: Record<string, string[]> = Object.fromEntries(
  SCRATCH_TABLES.map(table => [table.name, table.keyPath]),
);

function assertKnownStore(store: string): void {
  if (!SCRATCH_TABLE_BY_NAME[store]) throw new Error(`unknown store "${store}" in source op log; copy aborted`);
}

/** Derive a row's key from its keyPath fields — malformed rows fail. */
function rowKey(table: string, row: Record<string, unknown>): IDBValidKey {
  const parts: IDBValidKey[] = [];
  for (const part of SCRATCH_TABLE_BY_NAME[table]) {
    const value = row[part];
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
      throw new Error(`row for store "${table}" is missing keyPath field "${part}"; copy aborted`);
    }
    parts.push(value);
  }
  return parts.length === 1 ? parts[0] : parts;
}

/** Narrow a raw (unvalidated) op key to what IndexedDB accepts. */
function isIdbKey(value: unknown): value is IDBValidKey {
  return typeof value === 'string' || typeof value === 'number' || value instanceof Date
    || (Array.isArray(value) && value.length > 0 && value.every(isIdbKey));
}

function arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.every((byte, i) => byte === right[i]);
}

function deleteIdbDatabase(name: string): Promise<void> {
  const idb = globalThis.indexedDB;
  if (!idb) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const request = idb.deleteDatabase(name);
    request.onsuccess = () => { resolve(); };
    request.onerror = () => { reject(request.error ?? new Error(`failed to delete ${name}`)); };
    // A still-open connection blocks deletion; the scratch rows are
    // disposable either way, so don't hang the conversion on it.
    request.onblocked = () => { resolve(); };
  });
}

/** Replay raw remote-era rows into a unique scratch IndexedDB created at the
 *  SOURCE schema version (generic keyPath-only stores + legacy tables), so
 *  opening it through IndexedDBStorage runs the same versioned chain the
 *  browser runs locally. */
async function buildScratch(name: string, version: number, ops: ScratchOp[]): Promise<void> {
  const db = await openDB(name, version, {
    upgrade(scratch) {
      for (const table of SCRATCH_TABLES) {
        if (!scratch.objectStoreNames.contains(table.name)) {
          scratch.createObjectStore(table.name, { keyPath: table.keyPath.length === 1 ? table.keyPath[0] : table.keyPath });
        }
      }
    },
  });
  try {
    for (const op of ops) {
      if (!db.objectStoreNames.contains(op.table)) {
        throw new Error(`unknown store "${op.table}" in source; copy aborted`);
      }
      if (op.kind === 'put') await db.transaction(op.table, 'readwrite').objectStore(op.table).put(op.row);
      else if (op.kind === 'delete') await db.transaction(op.table, 'readwrite').objectStore(op.table).delete(op.key);
      else await db.transaction(op.table, 'readwrite').objectStore(op.table).clear();
    }
  } finally {
    db.close();
  }
}

/** Attachment rows are the binary payload. The terminal source map replays
 *  the lifted ops in order (puts, deletes, clears — wipes already expanded
 *  to clears), so deleted/wiped attachments are NOT required to survive;
 *  surviving ones must match the converted rows byte-for-byte (zero-byte
 *  buffers are valid). */
async function assertBinaryPreserved(sourceOps: ScratchOp[], converted: IndexedDBStorage): Promise<void> {
  const source = new Map<string, Record<string, unknown>>();
  for (const op of sourceOps) {
    if (op.kind === 'clear') {
      if (op.table === 'attachments') source.clear();
    } else if (op.kind === 'put' && op.table === 'attachments') {
      if (op.row === null || typeof op.row !== 'object' || Array.isArray(op.row) || !('id' in op.row)) {
        throw new Error('malformed attachment row in source; copy aborted');
      }
      source.set(String((op.row as Record<string, unknown>).id), op.row as Record<string, unknown>);
    } else if (op.kind === 'delete' && op.table === 'attachments') {
      source.delete(String(op.key));
    }
  }
  if (source.size === 0) return;
  const rows = await converted.readonly('attachments').getAll();
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const [id, row] of source) {
    const restored = byId.get(id);
    if (!restored) throw new Error(`attachment ${id} missing after conversion; copy aborted, source untouched`);
    const before = row.data;
    const after = restored.data;
    if (typeof before === 'string' || typeof after === 'string') {
      if (before !== after) throw new Error(`attachment ${id} payload changed during conversion; copy aborted, source untouched`);
    } else if (!(before instanceof ArrayBuffer) || !(after instanceof ArrayBuffer) || !arrayBuffersEqual(before, after)) {
      throw new Error(`attachment ${id} payload changed during conversion; copy aborted, source untouched`);
    }
  }
}

/**
 * Convert an older backup into policy-compliant current-schema mutations
 * WITHOUT touching the source:
 *
 *  1. Lift the source data as ordered scratch ops (op-log replay in log
 *     order, or legacy direct-Turso per-store rows incl. segments/results).
 *  2. Replay them into a unique scratch IndexedDB created AT `fromVersion`,
 *     then open it through IndexedDBStorage — the same versioned migration
 *     chain the browser runs locally rebuilds segments-era rows into
 *     note-owned blocks, revisions, sessions and events.
 *  3. Validate strictly (all note/session pins, binary payloads, derivable
 *     keys — any miss fails the copy) and return policy-compliant PUTS ONLY
 *     (the caller applies them to a fresh, reserved target).
 */
export async function convertSyncSource(db: Database, fromVersion: number, legacy: boolean): Promise<SyncMutation[]> {
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 20) {
    throw new Error(
      `Backup database schema v${fromVersion} predates the supported migration chain (v20+); the source was left untouched. `
      + 'Restore it with an intermediate app version, or point this app at a fresh backup database.',
    );
  }
  if (fromVersion > DB_VERSION) {
    throw new Error(`Backup database schema is newer than this converter supports (v${fromVersion} > v${DB_VERSION}); refusing to downgrade.`);
  }
  const raw: ScratchOp[] = [];
  if (legacy) {
    for (const table of [...NON_SYSTEM_STORES, ...LEGACY_EXTRA_TABLES.map(table => table.name)]) {
      for (const row of await readLegacyRows(db, table)) raw.push({ kind: 'put', table, row });
    }
  } else {
    // Raw replay with STRICT lift-time validation (§3.5): unknown stores,
    // unknown ops, malformed payloads and put keys that disagree with the
    // row's own keyPath fields fail the copy before anything is replayed.
    for (const op of await readRawSyncOps(db)) {
      if (op.op === 'wipe') {
        for (const name of [...NON_SYSTEM_STORES, ...LEGACY_EXTRA_TABLES.map(table => table.name)]) {
          raw.push({ kind: 'clear', table: name });
        }
      } else if (op.op === 'clear') {
        assertKnownStore(op.store);
        raw.push({ kind: 'clear', table: op.store });
      } else if (op.op === 'put') {
        assertKnownStore(op.store);
        if (op.value === undefined || op.value === null || typeof op.value !== 'object' || Array.isArray(op.value)) {
          throw new Error(`malformed put payload for store "${op.store}" in source op log; copy aborted`);
        }
        if (JSON.stringify(rowKey(op.store, op.value as Record<string, unknown>)) !== JSON.stringify(op.key)) {
          throw new Error(`put key ${JSON.stringify(op.key)} does not match store "${op.store}" keyPath fields; copy aborted`);
        }
        raw.push({ kind: 'put', table: op.store, row: op.value });
      } else if (op.op === 'delete') {
        assertKnownStore(op.store);
        if (!isIdbKey(op.key)) {
          throw new Error(`malformed delete key for store "${op.store}" in source op log; copy aborted`);
        }
        raw.push({ kind: 'delete', table: op.store, key: op.key });
      } else {
        throw new Error(`unknown op "${String((op as { op?: unknown }).op)}" in source op log; copy aborted`);
      }
    }
  }
  const scratch = `wodwiki-convert-${crypto.randomUUID()}`;
  const converted = new IndexedDBStorage({ dbName: scratch });
  try {
    await buildScratch(scratch, fromVersion, raw);
    await converted.open();
    await converted.validateSyncState(); // strict: missing pinned revisions fail the copy
    await assertBinaryPreserved(raw, converted);
    return await policySnapshotOps(store => converted.readonly(store).getAll() as Promise<unknown[]>);
  } finally {
    await converted.close();
    await deleteIdbDatabase(scratch).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Schema creation + versioned data migration (V20 → V32).
// ---------------------------------------------------------------------------

function createMissingStores(db: IDBPDatabase, tx: IDBPTransaction<unknown, string, 'versionchange'>): void {
  for (const def of STORE_DEFS) {
    if (db.objectStoreNames.contains(def.name)) {
      // Existing stores (pre-DB_VERSION layouts) keep whatever index set
      // they were born with — backfill indexes the current schema needs.
      const existing = tx.objectStore(def.name);
      for (const index of def.indexes) {
        if (!existing.indexNames.contains(index.name)) existing.createIndex(index.name, index.keyPath.length === 1 ? index.keyPath[0] : index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
      }
      continue;
    }
    const store = db.createObjectStore(def.name, { keyPath: def.keyPath.length === 1 ? def.keyPath[0] : def.keyPath });
    for (const index of def.indexes) store.createIndex(index.name, index.keyPath.length === 1 ? index.keyPath[0] : index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
  }
  for (const local of LOCAL_SYNC_STORES) {
    if (db.objectStoreNames.contains(local.name)) continue;
    db.createObjectStore(local.name, { keyPath: local.keyPath, autoIncrement: 'autoIncrement' in local ? local.autoIncrement : false });
  }
}

async function migrateSchema(db: IDBPDatabase, oldVersion: number, tx: IDBPTransaction<unknown, string, 'versionchange'>): Promise<void> {
  const store = (name: string) => tx.objectStore(name);

  // V20 → V21: flatten sessions, drop data.logs, project legacy logs
  // idempotently into event rows.
  if (oldVersion === 20 && db.objectStoreNames.contains('sessions')) {
    const sessionsStore = store('sessions');
    const eventsStore = store('events');
    for await (const cursor of sessionsStore) {
      const legacy = cursor.value as LegacySession;
      const logs = legacy.data?.logs ?? [];
      let alreadyProjected = false;
      for await (const _ev of eventsStore.index('by-result-grain').iterate(IDBKeyRange.bound([legacy.id, ''], [legacy.id, []]))) {
        alreadyProjected = true;
        break;
      }
      if (!alreadyProjected && logs.length > 0) {
        const identity = {
          noteId: legacy.noteId, resultId: legacy.id, segmentId: legacy.segmentId,
          segmentVersion: legacy.segmentVersion, blockContentId: legacy.blockContentId,
          origin: legacy.origin, pageId: legacy.pageId,
          workoutTimestamp: legacy.data?.endTime ?? legacy.createdAt,
        };
        for (const row of toEventRows(logs as never, identity)) await eventsStore.put(row);
        for (const row of toSummaryEventRows(logs as never, identity)) await eventsStore.put(row);
      }
      const flat: Session = {
        ...legacy,
        startTime: legacy.data?.startTime ?? legacy.createdAt,
        endTime: legacy.data?.endTime ?? legacy.createdAt,
        duration: legacy.data?.duration ?? 0,
        completed: legacy.data?.completed ?? true,
        roundsCompleted: legacy.data?.roundsCompleted,
        totalRounds: legacy.data?.totalRounds,
        repsCompleted: legacy.data?.repsCompleted,
      };
      delete (flat as unknown as Record<string, unknown>).data;
      await cursor.update(flat);
    }
  }

  // V21 → V22: invalidate the pre-V22 seed checkpoint so the V22 seed
  // data re-applies cleanly.
  if (oldVersion === 21 && db.objectStoreNames.contains('meta')) {
    await store('meta').delete('seed');
  }

  // V25: memberships store + by-user ownership index on every user-owned
  // store. Presence-guarded: mixed-state databases exist in the wild.
  if (oldVersion < 25) {
    for (const name of USER_OWNED_STORES) {
      if (!db.objectStoreNames.contains(name)) continue;
      const s = store(name);
      if (!s.indexNames.contains('by-user')) s.createIndex('by-user', 'userId');
    }
  }

  // V26: results → sessions. Residual legacy rows are read BEFORE the store
  // disappears; inline logs are projected per deterministic id (existing
  // rows never overwritten, absent detail/summary rows added). The legacy
  // duplicate is discarded only after the canonical row is safe.
  if (db.objectStoreNames.contains('results')) {
    const sessionsStore = store('sessions');
    const resultsStore = store('results');
    const eventsStore = store('events');
    for await (const cursor of resultsStore) {
      const { data: legacyData, ...legacyRow } = cursor.value as LegacySession;
      const logs = legacyData?.logs ?? [];
      if (logs.length > 0) {
        const identity = {
          noteId: legacyRow.noteId, resultId: legacyRow.id, segmentId: legacyRow.segmentId,
          segmentVersion: legacyRow.segmentVersion, blockContentId: legacyRow.blockContentId,
          origin: legacyRow.origin, pageId: legacyRow.pageId,
          workoutTimestamp: legacyData?.endTime ?? legacyRow.createdAt,
        };
        for (const row of toEventRows(logs as never, identity)) {
          if ((await eventsStore.get(row.id)) === undefined) await eventsStore.put(row);
        }
        for (const row of toSummaryEventRows(logs as never, identity)) {
          if ((await eventsStore.get(row.id)) === undefined) await eventsStore.put(row);
        }
      }
      if ((await sessionsStore.getKey(legacyRow.id)) !== undefined) continue;
      await sessionsStore.put({
        ...legacyRow,
        startTime: legacyData?.startTime ?? legacyRow.startTime ?? legacyRow.createdAt,
        endTime: legacyData?.endTime ?? legacyRow.endTime ?? legacyRow.createdAt,
        duration: legacyData?.duration ?? legacyRow.duration ?? 0,
        completed: legacyData?.completed ?? legacyRow.completed ?? true,
        roundsCompleted: legacyData?.roundsCompleted ?? legacyRow.roundsCompleted,
        totalRounds: legacyData?.totalRounds ?? legacyRow.totalRounds,
        repsCompleted: legacyData?.repsCompleted ?? legacyRow.repsCompleted,
      });
    }
    db.deleteObjectStore('results');
  }

  // V26/V27 repairs (presence-guarded — the first V26 cut shipped without
  // these on real databases, so version 26 is ambiguous).
  if (db.objectStoreNames.contains('block_index') && !store('block_index').indexNames.contains('by-source')) {
    store('block_index').createIndex('by-source', 'sourceId');
  }
  if (db.objectStoreNames.contains('notes') && !store('notes').indexNames.contains('by-created')) {
    store('notes').createIndex('by-created', 'createdAt');
  }
  if (db.objectStoreNames.contains('efforts') && !store('efforts').indexNames.contains('by-source')) {
    store('efforts').createIndex('by-source', 'registrySource');
  }
  if (db.objectStoreNames.contains('note_tags') && !store('note_tags').indexNames.contains('by-note-tag')) {
    const noteTags = store('note_tags');
    // Unique pair index requires deterministic duplicate cleanup first —
    // duplicate links keep the lexicographically smallest row id.
    const winnerByPair = new Map<string, string>();
    const dupes: string[] = [];
    for await (const cursor of noteTags) {
      const row = cursor.value as { id: string; noteId: string; tagId: string };
      const pair = `${row.noteId}${row.tagId}`;
      const winner = winnerByPair.get(pair);
      if (winner === undefined || row.id < winner) {
        winnerByPair.set(pair, row.id);
        if (winner !== undefined) dupes.push(winner);
      } else {
        dupes.push(row.id);
      }
    }
    for (const id of dupes) await noteTags.delete(id);
    noteTags.createIndex('by-note-tag', ['noteId', 'tagId'], { unique: true });
  }

  // V28: dashboard typing repair — a note whose frontmatter segment says
  // `dashboard: true` gains type 'dashboard' / sourceId 'dashboards'.
  // Runs BEFORE the V29 pass consumes the segments store. Idempotent.
  if (db.objectStoreNames.contains('notes') && db.objectStoreNames.contains('segments')) {
    const segments = store('segments');
    const notes = store('notes');
    const repaired = new Set<string>();
    for await (const cursor of segments) {
      const segment = cursor.value as LegacySegment;
      if (segment.dataType !== 'frontmatter' || repaired.has(segment.noteId)) continue;
      if (!/(^|\n)dashboard:\s*["']?true["']?\s*(\n|$)/.test(segment.rawContent)) continue;
      repaired.add(segment.noteId);
      const note = await notes.get(segment.noteId);
      if (!note || (note.type === 'dashboard' && note.sourceId === 'dashboards')) continue;
      await notes.put({ ...note, type: 'dashboard', sourceId: note.sourceId ?? 'dashboards' });
    }
  }

  // V29: segments → note-owned blocks + block_revisions; sessions/events
  // segment fields → block fields; block_index rows remapped. The segments
  // store is dropped only after every note is rebuilt — the source of truth
  // survives until the migration transaction commits.
  if (db.objectStoreNames.contains('segments')) {
    await migrateSegmentsToBlocks(db, tx);
  }

  // V32: pending puts already exist in the terminal snapshot. Keep deletion
  // intent before that snapshot, with legacy wipes narrowed to user clears.
  // One group keeps history and its consumers together during replay.
  if (oldVersion >= 30 && oldVersion < 32 && db.objectStoreNames.contains(OUTBOX_STORE)) {
    const outbox = store(OUTBOX_STORE);
    const ops: SyncMutation[] = [];
    for (const group of await outbox.getAll() as { ops: SyncMutation[] }[]) {
      for (const mutation of group.ops) {
        if (mutation.op === 'wipe') {
          for (const name of NON_SYSTEM_STORES) {
            if (name !== 'block_revisions') ops.push({ op: 'clear', store: name });
          }
        } else if (mutation.op !== 'put' && mutation.store !== 'memberships' && mutation.store !== 'block_revisions') {
          ops.push(mutation);
        }
      }
    }
    ops.push(...await policySnapshotOps(name => store(name).getAll() as Promise<unknown[]>));
    await outbox.clear();
    if (ops.length > 0) await outbox.put({ id: crypto.randomUUID(), at: Date.now(), ops });
    if (db.objectStoreNames.contains(SYNC_STATE_STORE)) {
      const state = store(SYNC_STATE_STORE);
      for (const key of await state.getAllKeys()) {
        if (typeof key === 'string' && key.startsWith(BOOTSTRAP_RUN_PREFIX)) await state.delete(key);
      }
    }
  }
}

async function migrateSegmentsToBlocks(db: IDBPDatabase, tx: IDBPTransaction<unknown, string, 'versionchange'>): Promise<void> {
  const store = (name: string) => tx.objectStore(name);
  const segments = (await store('segments').getAll()) as LegacySegment[];
  const notesStore = store('notes');
  const revisionsStore = store('block_revisions');

  // Group every versioned segment by note, then by positional segment id.
  const byNote = new Map<string, LegacySegment[]>();
  for (const segment of segments) {
    const list = byNote.get(segment.noteId);
    if (list) list.push(segment);
    else byNote.set(segment.noteId, [segment]);
  }

  // blockId per (noteId, segmentId) — sessions and block_index join through it.
  const blockIdBySegment = new Map<string, string>();
  const blockById = new Map<string, { noteId: string; from?: number; to?: number; version: number }>();

  for (const [noteId, noteSegments] of byNote) {
    const latestById = new Map<string, LegacySegment>();
    for (const segment of noteSegments) {
      const current = latestById.get(segment.id);
      if (!current || segment.version > current.version) latestById.set(segment.id, segment);
    }
    const latest = [...latestById.values()].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
    const rawContent = latest.map(segment => segment.sourceContent ?? `${segment.rawContent}\n`).join('');

    const note = await notesStore.get(noteId);
    if (!note) continue; // orphan segments without their note keep no state

    // Reconcile actionable blocks against the rebuilt source, preserving the
    // legacy positional segment id as the block id so session/block_index
    // references stay valid. Blocks with no legacy counterpart get a stable
    // positional id.
    const sections = parseDocumentSections(rawContent, { registeredWidgets: KNOWN_SECTION_WIDGETS });
    const actionableSections = sections.filter(section => actionableSectionKind(section) !== null);
    const legacyActionable = latest.filter(segment => segment.dataType in SEGMENT_TO_BLOCK_KIND);
    const blocks: Note['blocks'] = {};
    actionableSections.forEach((section, index) => {
      const kind = actionableSectionKind(section)!;
      const legacy = legacyActionable[index];
      let id = legacy?.id ?? `migrated-${index}`;
      while (Object.hasOwn(blocks, id)) id = `${id}-${index}`;
      const dialect = kind === 'wod' && (section.type === 'time' || section.type === 'log')
        ? { dialect: section.type, ...(section.sport ? { sport: section.sport } : {}) }
        : {};
      blocks[id] = { id, kind, version: legacy?.version ?? 1, sourceRevision: 1, from: section.from, to: section.to, ...dialect };
      if (legacy) blockIdBySegment.set(`${noteId}${legacy.id}`, id);
      blockById.set(`${noteId}${id}`, { noteId, from: section.from, to: section.to, version: blocks[id].version });
    });

    const legacy = note as Record<string, unknown>;
    delete legacy.segments;
    delete legacy.segmentIds;
    await notesStore.put({ ...legacy, rawContent, sourceRevision: 1, blocks });

    // Every versioned segment of an actionable id becomes a block revision
    // (historical segments included — the revision store is the history).
    const revisioned = new Set(legacyActionable.map(segment => segment.id));
    for (const segment of noteSegments) {
      if (!revisioned.has(segment.id)) continue;
      const dialect = legacyDialect(segment.rawContent);
      await revisionsStore.put({
        noteId, blockId: segment.id, version: segment.version, kind: 'wod',
        rawContent: segment.rawContent, savedAt: segment.createdAt, ...dialect,
      } satisfies BlockRevision);
    }
  }

  // Sessions: segmentId/segmentVersion (and the retired compute `version`)
  // become blockId/blockVersion. Values carry over unchanged — the V29 pass
  // above preserved legacy segment ids as block ids.
  const sessionsStore = store('sessions');
  for (const row of (await sessionsStore.getAll()) as LegacySession[]) {
    if (row.segmentId === undefined && row.segmentVersion === undefined && row.version === undefined) continue;
    const { segmentId, segmentVersion, version, ...rest } = row;
    await sessionsStore.put({
      ...rest,
      blockId: rest.blockId ?? segmentId ?? '',
      blockVersion: rest.blockVersion ?? segmentVersion ?? version ?? 1,
    } as Session);
  }

  // Events: same rename on the version field.
  const eventsStore = store('events');
  for (const row of await eventsStore.getAll() as Record<string, unknown>[]) {
    if (row.segmentVersion === undefined && row.segmentId === undefined) continue;
    const { segmentVersion, segmentId, ...rest } = row;
    await eventsStore.put({
      ...rest,
      ...(rest.blockId === undefined && segmentId !== undefined ? { blockId: segmentId } : {}),
      ...(rest.blockVersion === undefined && segmentVersion !== undefined ? { blockVersion: segmentVersion } : {}),
    });
  }

  // block_index: `${noteId}:${segmentId}:${segmentVersion}` →
  // `${noteId}:${blockId}` with the note block's offsets. Rows whose segment
  // vanished from the segments store keep their legacy id as the block id —
  // the index is a derived projection, never silently dropped.
  const blockIndex = store('block_index');
  for (const row of (await blockIndex.getAll()) as LegacyBlockIndexRow[]) {
    const mapped = blockIdBySegment.get(`${row.noteId}${row.segmentId}`) ?? row.segmentId;
    const block = blockById.get(`${row.noteId}${mapped}`);
    const next = {
      ...row,
      id: `${row.noteId}:${mapped}`,
      blockId: mapped,
      blockVersion: block?.version ?? row.segmentVersion ?? 1,
      sourceRevision: 1,
      ...(block ? { from: block.from, to: block.to } : {}),
      dataType: row.dataType === 'script' ? 'wod' : row.dataType,
    };
    delete (next as Record<string, unknown>).segmentId;
    delete (next as Record<string, unknown>).segmentVersion;
    if (next.id !== row.id) await blockIndex.delete(row.id);
    await blockIndex.put(next);
  }
  // block_efforts already carries blockId = the legacy positional segment id,
  // which the V29 pass preserved — no remap needed.

  db.deleteObjectStore('segments');
}
