/** SQL storage with atomic, change-scoped projections and buffered reads. */

import type {
  IReadWriteStore,
  IReadOnlyStore,
  IStorage,
  IStorageTransaction,
  StoreName,
  StoreType,
} from '../contract';
import type { DomainQuery, DomainQueryResult } from '../domain';
import { stampUserOwned } from '../membership';
import { STORE_DEFS, type StoreDef } from '../schema';
import {
  isRange,
  keyFromValue,
  rangeFromIDB,
  type KeyDTO,
  type RangeDTO,
  type TxOp,
} from '../wire';
import {
  bufferedGet,
  bufferSlot,
  bufferToOps,
  isDirty,
  overlayRows,
  type BufferEntry,
} from '../overlay';
import {
  countRows,
  getRow,
  initializeStore,
  listRows,
  putRow,
  wipeRows,
  getRows,
  listRowsFromIndexMany,
} from './store';
import {
  handleDomainQuery,
  initializeDomain,
  refreshDomain,
  wipeDomain,
} from './domain';
import { StorageError } from './errors';
import { libsqlDatabase, type Database, type SqlConnection } from './connection';
import { createClient } from '@libsql/client/web';
import { rowsEqual } from '../validation';

export interface SqlStorageOptions {
  /** Rows in user-owned stores are stamped with this userId on write. Omit
   * for stamp-free writers (data migration preserves ownership verbatim). */
  getUserId?: () => string;
}

export class SqlStorage implements IStorage {
  private readonly db: Database;
  private readonly options: SqlStorageOptions;
  private readonly defs: Record<StoreName, StoreDef>;
  private readyPromise?: Promise<void>;

  constructor(db: Database, options: SqlStorageOptions = {}) {
    this.db = db;
    this.options = options;
    this.defs = Object.fromEntries(STORE_DEFS.map((d) => [d.name, d])) as Record<StoreName, StoreDef>;
  }

  /**
   * Idempotent schema + projection initialization. Cheap when already
   * compatible (both initializers are guard-protected); a failed attempt
   * clears the memo so the next call retries instead of caching the error.
   */
  ready(): Promise<void> {
    this.readyPromise ??= (async () => {
      try {
        await initializeStore(this.db);
        await initializeDomain(this.db);
      } catch (e) {
        this.readyPromise = undefined;
        throw e;
      }
    })();
    return this.readyPromise;
  }

  /** Every store operation starts here, so views created before (or during)
   * an in-flight ready() block until initialization actually succeeded. */
  ensureReady(): Promise<void> {
    return this.ready();
  }

  def(store: StoreName): StoreDef {
    const def = this.defs[store];
    if (!def) throw new StorageError(404, `SqlStorage: unknown store '${store}'`);
    return def;
  }

  private makeView<K extends StoreName>(
    store: K,
    conn: SqlConnection,
    mutable: boolean,
    buffer?: Map<string, BufferEntry>,
    cleared?: Set<StoreName>,
  ): IReadWriteStore<StoreType<K>> {
    return new SqlStore<StoreType<K>>(this, this.def(store), store, conn, mutable, buffer, cleared);
  }

  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>> {
    return this.makeView(store, this.db, false);
  }

  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>> {
    return this.makeView(store, this.db, true);
  }

  async queryDomain(query: DomainQuery): Promise<DomainQueryResult | undefined> {
    await this.ensureReady();
    try {
      return await handleDomainQuery(this.db, query);
    } catch (e) {
      // Same stale-projection fallback as ApiStorage's 409 mapping.
      if (e instanceof StorageError && e.code === 'domain_projection_unavailable') return undefined;
      throw e;
    }
  }

  async transaction<K extends StoreName, R>(
    stores: K[],
    mode: 'readonly' | 'readwrite',
    fn: (tx: IStorageTransaction) => Promise<R>,
  ): Promise<R> {
    await this.ensureReady();
    return this.runTx(stores, mode === 'readwrite', fn);
  }

  /** Bulk writes use the same affected-key refresh as ordinary transactions. */
  async bulkTransaction<K extends StoreName, R>(
    stores: K[],
    fn: (tx: IStorageTransaction) => Promise<R>,
  ): Promise<R> {
    await this.ensureReady();
    return this.runTx(stores, true, fn);
  }

  private runTx<K extends StoreName, R>(
    stores: K[],
    mutableMode: boolean,
    fn: (tx: IStorageTransaction) => Promise<R>,
  ): Promise<R> {
    const scoped = new Set<StoreName>(stores);
    const buffer = new Map<string, BufferEntry>();
    const cleared = new Set<StoreName>();
    return this.db.transaction(async (conn) => {
      const checkScope = (store: StoreName): void => {
        if (!scoped.has(store)) {
          throw new StorageError(400, `store '${store}' is outside this transaction's scope`, 'store_out_of_scope');
        }
      };
      const tx: IStorageTransaction = {
        readonly: <S extends StoreName>(store: S) => {
          checkScope(store);
          return this.makeView(store, conn, false, buffer, cleared);
        },
        readwrite: <S extends StoreName>(store: S) => {
          checkScope(store);
          if (!mutableMode) {
            throw new StorageError(403, 'transaction was opened readonly', 'read_only_transaction');
          }
          return this.makeView(store, conn, true, buffer, cleared);
        },
      };
      const result = await fn(tx);
      const ops = bufferToOps(STORE_DEFS.map((d) => d.name), buffer, cleared);
      if (ops.length > 0) {
        await refreshDomain(conn, ops);
      }
      return result;
    });
  }

  /**
   * Proves the backend accepts writes: one real INSERT into `meta` inside a
   * transaction that is then deliberately rolled back — zero rows committed.
   * A read-only backend, bad token or transport failure rejects here.
   */
  async verifyWritable(): Promise<void> {
    await this.ensureReady();
    const sentinel = new Error('verifyWritable: deliberate rollback sentinel');
    try {
      await this.db.transaction(async (conn) => {
        await putRow(conn, this.def('meta'), {
          key: `__wodwiki_write_check_${crypto.randomUUID()}`,
          value: '',
        });
        throw sentinel;
      });
    } catch (e) {
      if (e !== sentinel) throw e;
    }
  }

  async wipe(): Promise<void> {
    await this.ensureReady();
    await this.db.transaction(async (tx) => {
      await wipeRows(tx);
      await wipeDomain(tx);
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  // Internal seam for SqlStore views (same module): immediate op application
  // and write stamping.
  async applyOps(ops: TxOp[]): Promise<void> {
    await this.db.transaction((tx) => refreshDomain(tx, ops));
  }

  stamp(store: StoreName, value: unknown): unknown {
    const userId = this.options.getUserId?.();
    return userId ? stampUserOwned(store, value, userId) : value;
  }
}

/**
 * Store view over a SqlConnection. Outside a transaction writes apply
 * immediately (each in its own SQL tx with projection refresh); inside one,
 * writes buffer and reads overlay the buffer on committed rows. All
 * operations await backend readiness first.
 */
class SqlStore<T> implements IReadWriteStore<T> {
  constructor(
    private readonly owner: SqlStorage,
    private readonly def: StoreDef,
    private readonly store: StoreName,
    private readonly conn: SqlConnection,
    private readonly mutable: boolean,
    private readonly buffer?: Map<string, BufferEntry>,
    private readonly cleared?: Set<StoreName>,
  ) {}

  private assertMutable(): void {
    if (!this.mutable) {
      throw new StorageError(403, `${this.store} is opened read-only`, 'read_only_view');
    }
  }

  async get(key: IDBValidKey | RangeDTO): Promise<T | undefined> {
    await this.owner.ensureReady();
    const k = this.pointKey(key);
    const state = bufferedGet<T>(this.store, k, this.buffer);
    if (state) return state.hit ? state.value : undefined;
    if (this.cleared?.has(this.store)) return undefined;
    return getRow(this.conn, this.def, k) as Promise<T | undefined>;
  }

  async getMany(keys: IDBValidKey[]): Promise<(T | undefined)[]> {
    await this.owner.ensureReady();
    const normalized = keys.map(key => this.pointKey(key));
    const committed = this.cleared?.has(this.store) ? keys.map(() => undefined)
      : await getRows(this.conn, this.def, normalized) as (T | undefined)[];
    return normalized.map((key, i) => {
      const state = bufferedGet<T>(this.store, key, this.buffer);
      return state ? (state.hit ? state.value : undefined) : committed[i];
    });
  }

  async getAllFromIndexMany(indexName: string, keys: IDBValidKey[]): Promise<T[][]> {
    await this.owner.ensureReady();
    const rows = await listRowsFromIndexMany(this.conn, this.def, indexName, keys.map(key => this.pointKey(key)));
    return rows.map((values, i) => overlayRows<T>(this.def, this.store, this.buffer, this.cleared, values as T[], undefined, { only: this.pointKey(keys[i]) }, indexName));
  }

  async getAll(query?: IDBValidKey | IDBKeyRange | RangeDTO, count?: number): Promise<T[]> {
    await this.owner.ensureReady();
    const range = rangeFromIDB(query);
    const rows = await listRows(this.conn, this.def, range, isDirty(this.store, this.buffer, this.cleared) ? undefined : count);
    return overlayRows<T>(this.def, this.store, this.buffer, this.cleared, rows as T[], count, range);
  }

  async getAllFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange | RangeDTO, count?: number): Promise<T[]> {
    await this.owner.ensureReady();
    const range = rangeFromIDB(query);
    const rows = await listRows(this.conn, this.def, range, isDirty(this.store, this.buffer, this.cleared) ? undefined : count, indexName);
    return overlayRows<T>(this.def, this.store, this.buffer, this.cleared, rows as T[], count, range, indexName);
  }

  async count(query?: IDBValidKey | IDBKeyRange | RangeDTO): Promise<number> {
    await this.owner.ensureReady();
    const range = rangeFromIDB(query);
    if (!isDirty(this.store, this.buffer, this.cleared)) return countRows(this.conn, this.def, range);
    const rows = await listRows(this.conn, this.def, range);
    return overlayRows<T>(this.def, this.store, this.buffer, this.cleared, rows as T[], undefined, range).length;
  }

  async countFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange | RangeDTO): Promise<number> {
    await this.owner.ensureReady();
    const range = rangeFromIDB(query);
    if (!isDirty(this.store, this.buffer, this.cleared)) return countRows(this.conn, this.def, range, indexName);
    const rows = await listRows(this.conn, this.def, range, undefined, indexName);
    return overlayRows<T>(this.def, this.store, this.buffer, this.cleared, rows as T[], undefined, range, indexName).length;
  }

  async put(value: T, _key?: IDBValidKey): Promise<IDBValidKey> {
    await this.owner.ensureReady();
    this.assertMutable();
    const stored = this.owner.stamp(this.store, value) as T;
    const key = keyFromValue(this.def, stored);
    if (this.store === 'block_revisions') {
      const previous = this.buffer?.get(bufferSlot(this.store, key));
      if (previous?.kind === 'put' && !rowsEqual(previous.value, stored)) throw new StorageError(409, 'immutable block revision collision', 'revision_conflict');
    }
    if (this.buffer) {
      this.buffer.set(bufferSlot(this.store, key), { kind: 'put', value: stored });
      return key;
    }
    await this.owner.applyOps([{ op: 'put', store: this.store, value: stored }]);
    return key;
  }

  async putMany(values: T[], _keys?: IDBValidKey[]): Promise<IDBValidKey[]> {
    await this.owner.ensureReady();
    this.assertMutable();
    const stored = values.map(value => this.owner.stamp(this.store, value) as T);
    const keys = stored.map(value => keyFromValue(this.def, value));
    if (this.store === 'block_revisions') {
      const seen = new Map<string, unknown>();
      keys.forEach((key, i) => {
        const slot = bufferSlot(this.store, key), previous = this.buffer?.get(slot);
        const value = seen.has(slot) ? seen.get(slot) : previous?.kind === 'put' ? previous.value : undefined;
        if (value !== undefined && !rowsEqual(value, stored[i])) throw new StorageError(409, 'immutable block revision collision', 'revision_conflict');
        seen.set(slot, stored[i]);
      });
    }
    if (this.buffer) keys.forEach((key, i) => this.buffer!.set(bufferSlot(this.store, key), { kind: 'put', value: stored[i] }));
    else await this.owner.applyOps(stored.map(value => ({ op: 'put', store: this.store, value })));
    return keys;
  }

  async delete(key: IDBValidKey | IDBKeyRange | RangeDTO): Promise<void> {
    await this.owner.ensureReady();
    this.assertMutable();
    if (this.store === 'block_revisions') throw new StorageError(409, 'block history requires explicit wipe', 'revision_conflict');
    const range = isRange(key) ? key : undefined;
    const target = range ?? (key as KeyDTO);
    if (this.buffer) {
      if (range) {
        for (const row of await this.getAll(range)) {
          const rowKey = keyFromValue(this.def, row);
          this.buffer.set(bufferSlot(this.store, rowKey), { kind: 'delete', key: rowKey });
        }
        return;
      }
      const point = target as KeyDTO;
      this.buffer.set(bufferSlot(this.store, point), { kind: 'delete', key: point });
      return;
    }
    await this.owner.applyOps([{ op: 'delete', store: this.store, key: target as KeyDTO }]);
  }

  async clear(): Promise<void> {
    await this.owner.ensureReady();
    this.assertMutable();
    if (this.store === 'block_revisions') throw new StorageError(409, 'block history requires explicit wipe', 'revision_conflict');
    if (this.buffer) {
      this.cleared?.add(this.store);
      const prefix = `${this.store}\u0000`;
      for (const slot of [...this.buffer.keys()]) {
        if (slot.startsWith(prefix)) this.buffer.delete(slot);
      }
      return;
    }
    await this.owner.applyOps([{ op: 'clear', store: this.store }]);
  }

  /** Normalizes get() arguments to a wire key (bounded ranges match no row). */
  private pointKey(key: IDBValidKey | RangeDTO): KeyDTO {
    if (isRange(key)) {
      if (key.only === undefined) {
        throw new StorageError(400, 'get() needs a plain key or {only}; bounded ranges match no single row');
      }
      return key.only;
    }
    return key as KeyDTO;
  }
}

export interface TursoSettings {
  url: string;
  authToken?: string;
}

/** libsql/https/wss only; plain http only for loopback development; tokens
 * travel via authToken, never the URL. Rejects credentials, query strings
 * and fragments (no secret or option injection through the URL). */
export function validateTursoUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new StorageError(400, 'invalid Turso URL', 'bad_turso_url');
  }
  if (url.includes('?') || url.includes('#')) {
    throw new StorageError(400, 'Turso URL must not carry a query or fragment; pass options/secrets via authToken', 'bad_turso_url');
  }
  if (parsed.username || parsed.password) {
    throw new StorageError(400, 'Turso URL must not embed credentials; pass them via authToken', 'bad_turso_url');
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if (parsed.protocol === 'http:') {
    if (!loopback) {
      throw new StorageError(400, 'refusing plain http Turso URL (token would traverse the network unencrypted); use libsql:/https:', 'bad_turso_url');
    }
    return url;
  }
  if (parsed.protocol !== 'libsql:' && parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
    throw new StorageError(400, `unsupported Turso URL scheme ${parsed.protocol} (expected libsql:, https:, wss:)`, 'bad_turso_url');
  }
  return url;
}

/**
 * Direct-from-browser Turso backend. Construction only validates and builds
 * the client; `await storage.ready()` initializes schema + projections.
 * Errors never embed the auth token.
 */
export class BrowserTursoStorage extends SqlStorage {
  constructor(settings: TursoSettings, options: SqlStorageOptions = {}) {
    super(
      libsqlDatabase(createClient({ url: validateTursoUrl(settings.url), authToken: settings.authToken })),
      options,
    );
  }
}
