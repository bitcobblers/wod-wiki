import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { IReadOnlyStore, IReadWriteStore, IStorage, IStorageTransaction, StoreName, StoreType } from './IStorage';
import {
  DB_VERSION, STORE_DEFS, stampUserOwned, keyFromValue, rowsEqual,
  validateStorageRow, validateNoteWrite, validateSessionWrite, validateStoredPins,
  type Note, type Session, type BlockRevision,
} from '@bitcobblers/wod-wiki-storage';

const DB_NAME = 'wodwiki-db';
type Mode = 'readonly' | 'readwrite';
type Tx = IDBPTransaction<unknown, string, Mode>;

class IDBStore<T> implements IReadWriteStore<T> {
  constructor(
    private readonly owner: IndexedDBStorage,
    private readonly name: StoreName,
    private readonly tx?: Tx,
    private readonly mutable = false,
    private readonly touched?: { notes: Set<string>; sessions: Set<string> },
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
    if (!this.tx) return this.owner.transaction([this.name, 'block_revisions'], 'readwrite', tx => tx.readwrite(this.name).put(value as StoreType<typeof this.name>));
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
    if (this.name === 'notes') this.touched?.notes.add(String(key));
    if (this.name === 'sessions') this.touched?.sessions.add(String(key));
    return result;
  }

  async putMany(values: T[], keys?: IDBValidKey[]): Promise<IDBValidKey[]> {
    if (keys && keys.length !== values.length) throw new Error('putMany key count mismatch');
    if (!this.tx) return this.owner.transaction([this.name, 'block_revisions'], 'readwrite', tx => tx.readwrite(this.name).putMany(values as StoreType<typeof this.name>[], keys));
    const out: IDBValidKey[] = [];
    for (let i = 0; i < values.length; i++) out.push(await this.put(values[i], keys?.[i]));
    return out;
  }

  async delete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.name === 'block_revisions') throw new Error('block history requires explicit wipe');
    if (!this.tx) return this.owner.transaction([this.name], 'readwrite', tx => tx.readwrite(this.name).delete(key));
    if (this.name === 'notes') {
      for (const note of await this.tx.objectStore('notes').getAll(key)) {
        for (const name of ['block_index', 'block_efforts'] as const) {
          const store = this.tx.objectStore(name);
          for (const id of await store.index('by-note').getAllKeys(note.id)) await store.delete(id);
        }
      }
    }
    await this.tx.objectStore(this.name).delete(key);
  }

  async clear(): Promise<void> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.name === 'block_revisions') throw new Error('block history requires explicit wipe');
    if (!this.tx) return this.owner.transaction([this.name], 'readwrite', tx => tx.readwrite(this.name).clear());
    if (this.name === 'notes') {
      await this.tx.objectStore('block_index').clear();
      await this.tx.objectStore('block_efforts').clear();
    }
    await this.tx.objectStore(this.name).clear();
  }
}

export class IndexedDBStorage implements IStorage {
  private opening?: Promise<IDBPDatabase>;
  constructor(private readonly options: { getUserId?: () => string } = {}) {}

  open(): Promise<IDBPDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
    if (!this.opening) {
      let incompatible = false;
      this.opening = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, _version, tx) {
          if (oldVersion !== 0) {
            incompatible = true;
            void tx.done.catch(() => {});
            tx.abort();
            return;
          }
          for (const def of STORE_DEFS) {
            const store = db.createObjectStore(def.name, { keyPath: def.keyPath.length === 1 ? def.keyPath[0] : def.keyPath });
            for (const index of def.indexes) store.createIndex(index.name, index.keyPath.length === 1 ? index.keyPath[0] : index.keyPath, { unique: index.unique, multiEntry: index.multiEntry });
          }
        },
        blocking: () => { void this.close(); },
      }).catch(error => {
        this.opening = undefined;
        throw incompatible || (error instanceof DOMException && error.name === 'VersionError')
          ? new Error('database schema is incompatible; recreation required for explicitly disposable storage') : error;
      });
    }
    return this.opening;
  }

  stamp(store: StoreName, value: unknown): unknown {
    const userId = this.options.getUserId?.();
    return userId ? stampUserOwned(store, value, userId) : value;
  }

  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>> { return new IDBStore(this, store); }
  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>> { return new IDBStore(this, store, undefined, true); }

  async transaction<K extends StoreName, R>(stores: K[], mode: Mode, fn: (tx: IStorageTransaction) => Promise<R>): Promise<R> {
    const db = await this.open();
    const scope = [...new Set<StoreName>([...stores, ...(mode === 'readwrite' ? ['block_revisions' as const] : []),
      ...(mode === 'readwrite' && stores.includes('notes' as K) ? ['block_index' as const, 'block_efforts' as const] : [])])];
    const native = db.transaction(scope, mode) as Tx;
    const done = native.done;
    void done.catch(() => {});
    const touched = { notes: new Set<string>(), sessions: new Set<string>() };
    const adapter: IStorageTransaction = {
      readonly: name => {
        if (!stores.includes(name as K)) throw new Error('store outside transaction scope');
        return new IDBStore(this, name, native);
      },
      readwrite: name => {
        if (mode !== 'readwrite') throw new Error('read-only transaction');
        if (!stores.includes(name as K)) throw new Error('store outside transaction scope');
        return new IDBStore(this, name, native, true, touched);
      },
    };
    try {
      const result = await fn(adapter);
      const notes = (await Promise.all([...touched.notes].map(id => native.objectStore('notes').get(id)))).filter(Boolean) as Note[];
      const sessions = (await Promise.all([...touched.sessions].map(id => native.objectStore('sessions').get(id)))).filter(Boolean) as Session[];
      await validateStoredPins(notes, sessions, keys => Promise.all(keys.map(key => native.objectStore('block_revisions').get(key))) as Promise<(BlockRevision | undefined)[]>);
      await done;
      return result;
    } catch (error) {
      try { native.abort(); } catch { /* The native request may have already aborted. */ }
      await done.catch(() => {});
      throw error;
    }
  }

  async wipe(): Promise<void> {
    const db = await this.open();
    const names = STORE_DEFS.filter(def => !def.system).map(def => def.name);
    const tx = db.transaction(names, 'readwrite');
    await Promise.all(names.map(name => tx.objectStore(name).clear()));
    await tx.done;
  }

  async close(): Promise<void> {
    const opening = this.opening;
    this.opening = undefined;
    (await opening?.catch(() => undefined))?.close();
  }
}
