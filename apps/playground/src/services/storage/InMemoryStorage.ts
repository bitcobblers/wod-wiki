import type { IReadOnlyStore, IReadWriteStore, IStorage, IStorageTransaction, StoreName, StoreType } from './IStorage';
import {
  STORE_DEFS, stampUserOwned, keyFromValue, compareKeys, rangeFromIDB, keyInRange, extractKeyPart,
  rowsEqual, validateStorageRow, validateNoteWrite, validateSessionWrite, validateStoredPins,
  type KeyDTO, type Note, type Session, type BlockRevision, type StoreDef,
} from '@bitcobblers/wod-wiki-storage';

type Rows = Map<string, unknown>;

export class InMemoryStore<T> implements IReadWriteStore<T> {
  private readonly def: StoreDef;
  constructor(
    private readonly name: StoreName,
    private readonly getUserId?: () => string,
    private readonly rows: Rows = new Map(),
    private readonly mutable = true,
    private readonly commit?: (operation: (store: IReadWriteStore<T>) => Promise<unknown>) => Promise<unknown>,
  ) {
    this.def = STORE_DEFS.find(def => def.name === name)!;
    if (!this.def) throw new Error(`unknown store ${name}`);
  }

  async get(key: IDBValidKey): Promise<T | undefined> {
    return structuredClone(this.rows.get(JSON.stringify(key))) as T | undefined;
  }

  async getMany(keys: IDBValidKey[]): Promise<(T | undefined)[]> { return Promise.all(keys.map(key => this.get(key))); }

  async getAll(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    const range = rangeFromIDB(query);
    const records = [...this.rows.values()].filter(row => !range || keyInRange(keyFromValue(this.def, row), range));
    records.sort((a, b) => compareKeys(keyFromValue(this.def, a), keyFromValue(this.def, b)));
    return structuredClone(count === undefined ? records : records.slice(0, count)) as T[];
  }

  async getAllFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    const index = this.def.indexes.find(index => index.name === indexName);
    if (!index) throw new Error(`unknown index ${this.name}.${indexName}`);
    const range = rangeFromIDB(query);
    const entries: { key: KeyDTO; value: unknown }[] = [];
    for (const value of this.rows.values()) {
      if (index.multiEntry) {
        const items = typeof value === 'object' && value !== null ? Reflect.get(value, index.keyPath[0]) : undefined;
        if (Array.isArray(items)) for (const item of new Set(items)) {
          if (typeof item !== 'string' && typeof item !== 'number') continue;
          if (!range || keyInRange(item, range)) entries.push({ key: item, value });
        }
      } else {
        const parts = index.keyPath.map(path => extractKeyPart(value, path));
        if (parts.some(part => part === undefined)) continue;
        const key = parts.length === 1 ? parts[0]! : parts as KeyDTO;
        if (!range || keyInRange(key, range)) entries.push({ key, value });
      }
    }
    entries.sort((a, b) => compareKeys(a.key, b.key) || compareKeys(keyFromValue(this.def, a.value), keyFromValue(this.def, b.value)));
    const selected = count === undefined ? entries : entries.slice(0, count);
    return structuredClone(selected.map(entry => entry.value)) as T[];
  }

  async getAllFromIndexMany(index: string, keys: IDBValidKey[]): Promise<T[][]> { return Promise.all(keys.map(key => this.getAllFromIndex(index, key))); }
  async count(query?: IDBValidKey | IDBKeyRange): Promise<number> { return (await this.getAll(query)).length; }
  async countFromIndex(index: string, query?: IDBValidKey | IDBKeyRange): Promise<number> { return (await this.getAllFromIndex(index, query)).length; }

  async put(value: T, _key?: IDBValidKey): Promise<IDBValidKey> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.commit) return this.commit(store => store.put(value)) as Promise<IDBValidKey>;
    const userId = this.getUserId?.();
    const stored = userId ? stampUserOwned(this.name, value, userId) : value;
    validateStorageRow(this.name, stored);
    const key = keyFromValue(this.def, stored), slot = JSON.stringify(key);
    const previous = this.rows.get(slot);
    if (this.name === 'block_revisions' && previous !== undefined && !rowsEqual(previous, stored)) throw new Error('immutable block revision collision');
    if (this.name === 'notes') validateNoteWrite(previous, stored);
    if (this.name === 'sessions') validateSessionWrite(previous, stored);
    if (rowsEqual(previous, stored)) return key;
    for (const index of this.def.indexes) {
      if (!index.unique) continue;
      const parts = index.keyPath.map(path => extractKeyPart(stored, path));
      if (parts.some(part => part === undefined)) continue;
      for (const [otherKey, row] of this.rows) {
        if (otherKey !== slot && rowsEqual(parts, index.keyPath.map(path => extractKeyPart(row, path)))) throw new Error(`unique index collision ${index.name}`);
      }
    }
    this.rows.set(slot, structuredClone(stored));
    return key;
  }

  async putMany(values: T[], keys?: IDBValidKey[]): Promise<IDBValidKey[]> {
    if (this.commit) return this.commit(store => store.putMany(values, keys)) as Promise<IDBValidKey[]>;
    if (keys && keys.length !== values.length) throw new Error('putMany key count mismatch');
    const out: IDBValidKey[] = [];
    for (let i = 0; i < values.length; i++) out.push(await this.put(values[i], keys?.[i]));
    return out;
  }

  async delete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.name === 'block_revisions') throw new Error('block history requires explicit wipe');
    if (this.commit) { await this.commit(store => store.delete(key)); return; }
    const range = rangeFromIDB(key)!;
    for (const [slot, value] of this.rows) if (keyInRange(keyFromValue(this.def, value), range)) this.rows.delete(slot);
  }

  async clear(): Promise<void> {
    if (!this.mutable) throw new Error('read-only store');
    if (this.name === 'block_revisions') throw new Error('block history requires explicit wipe');
    if (this.commit) { await this.commit(store => store.clear()); return; }
    this.rows.clear();
  }

  snapshotRows(): Rows { return structuredClone(this.rows); }
  restoreRows(rows?: Rows): void { this.rows.clear(); for (const [key, value] of rows ?? []) this.rows.set(key, structuredClone(value)); }
}

export class InMemoryStorage implements IStorage {
  private stores = new Map<StoreName, Rows>();
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: { getUserId?: () => string } = {}) {}

  readonly<K extends StoreName>(name: K): IReadOnlyStore<StoreType<K>> {
    let rows = this.stores.get(name);
    if (!rows) { rows = new Map(); this.stores.set(name, rows); }
    return new InMemoryStore(name, this.options.getUserId, rows, false);
  }

  readwrite<K extends StoreName>(name: K): IReadWriteStore<StoreType<K>> {
    let rows = this.stores.get(name);
    if (!rows) { rows = new Map(); this.stores.set(name, rows); }
    return new InMemoryStore(name, this.options.getUserId, rows, true,
      operation => this.transaction([name, 'block_revisions'], 'readwrite', tx => operation(tx.readwrite(name))));
  }

  transaction<K extends StoreName, R>(stores: K[], mode: 'readonly' | 'readwrite', fn: (tx: IStorageTransaction) => Promise<R>): Promise<R> {
    const run = async (): Promise<R> => {
      const staged = new Map<StoreName, Rows>();
      const scope: StoreName[] = [...stores, ...(mode === 'readwrite' && stores.includes('notes' as K) ? ['block_index' as const, 'block_efforts' as const] : [])];
      for (const name of scope) staged.set(name, structuredClone(this.stores.get(name) ?? new Map()));
      const view = <S extends StoreName>(name: S, mutable: boolean): InMemoryStore<StoreType<S>> => {
        if (!stores.includes(name as K)) throw new Error('store outside transaction scope');
        const rows = staged.get(name);
        if (!rows) throw new Error('store outside transaction scope');
        if (mutable && mode !== 'readwrite') throw new Error('read-only transaction');
        return new InMemoryStore(name, this.options.getUserId, rows, mutable);
      };
      const result = await fn({ readonly: name => view(name, false), readwrite: name => view(name, true) });
      if (mode === 'readwrite') {
        if (staged.has('notes')) {
          const notes = staged.get('notes')!;
          const removed = new Set([...(this.stores.get('notes')?.keys() ?? [])].filter(key => !notes.has(key)));
          for (const name of ['block_index', 'block_efforts'] as const) {
            for (const [key, row] of staged.get(name)!) {
              if (row && typeof row === 'object' && 'noteId' in row && removed.has(JSON.stringify(row.noteId))) staged.get(name)!.delete(key);
            }
          }
        }
        const notes = [...(staged.get('notes')?.values() ?? [])] as Note[];
        const sessions = [...(staged.get('sessions')?.values() ?? [])] as Session[];
        const revisions = staged.get('block_revisions') ?? this.stores.get('block_revisions');
        await validateStoredPins(notes, sessions, async keys => keys.map(key => revisions?.get(JSON.stringify(key)) as BlockRevision | undefined));
        for (const [name, rows] of staged) {
          const live = this.stores.get(name);
          if (!live) this.stores.set(name, rows);
          else { live.clear(); for (const [key, value] of rows) live.set(key, value); }
        }
      }
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  async wipe(): Promise<void> {
    await this.chain;
    for (const def of STORE_DEFS) if (!def.system) this.stores.get(def.name)?.clear();
  }
  async close(): Promise<void> { await this.chain; }
}
