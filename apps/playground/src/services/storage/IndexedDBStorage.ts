import { openDB, deleteDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type {
  IReadOnlyStore,
  IReadWriteStore,
  IStorage,
  IStorageTransaction,
  StoreName,
  StoreType,
} from './IStorage';
import type { Session } from '@/types/storage';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { DB_VERSION, USER_OWNED_STORES, stampUserOwned, type NoteSegment } from '@bitcobblers/wod-wiki-storage';

const DB_NAME = 'wodwiki-db';

// V24: 1b0442ed added block_efforts without bumping the version, so existing
// V23 DBs lack the store — the guarded upgrade below recreates it.
// V25: identity — adds the memberships store and a by-user ownership index
// on every user-owned store (guards mandatory per the V24 note above).
// V26: results store dropped (rows migrated into sessions first); unique
// by-note-tag pair on note_tags (duplicates resolved deterministically);
// notes by-created + block_index by-source indexes; seed schema v6 rebuild
// maps static block rows onto imported note UUIDs.
// V27: repair bump — the first V26 cut shipped without by-source/by-created/
// by-note-tag on real databases, so version 26 became ambiguous. Every index
// addition is presence-guarded (not oldVersion-gated), so a 26→27 upgrade
// repairs exactly the missing pieces and a fresh DB is built complete.
// V28: dashboard typing repair — notes whose frontmatter segment says
// `dashboard: true` gain type 'dashboard' / sourceId 'dashboards' (legacy
// user dashboards and pre-attribution seed dashboards; fields-only, never
// rawContent).

type IDBTransactionMode = 'readonly' | 'readwrite';

// ponytail: idb handle kept schema-loose — store/key typing lives in IStorage's
// generics, so Mode is the only thing we track (put/delete/clear need 'readwrite').
type IDBTx<Mode extends IDBTransactionMode = IDBTransactionMode> = IDBPTransaction<unknown, string, Mode>;

class IDBReadOnlyStore<T> implements IReadOnlyStore<T> {
  constructor(
    private readonly dbPromise: Promise<IDBPDatabase>,
    private readonly storeName: StoreName,
    private readonly existingTx?: IDBTx
  ) {}

  async get(key: IDBValidKey): Promise<T | undefined> {
    if (this.existingTx) {
      return this.existingTx.objectStore(this.storeName).get(key);
    }
    const db = await this.dbPromise;
    return db.get(this.storeName, key);
  }

  async getAll(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    if (this.existingTx) {
      const store = this.existingTx.objectStore(this.storeName);
      return query !== undefined
        ? (count !== undefined ? store.getAll(query, count) : store.getAll(query))
        : (count !== undefined ? store.getAll(null, count) : store.getAll());
    }
    const db = await this.dbPromise;
    return query !== undefined
      ? (count !== undefined ? db.getAll(this.storeName, query, count) : db.getAll(this.storeName, query))
      : (count !== undefined ? db.getAll(this.storeName, null, count) : db.getAll(this.storeName));
  }

  async getAllFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
    if (this.existingTx) {
      const idx = this.existingTx.objectStore(this.storeName).index(indexName);
      return query !== undefined
        ? (count !== undefined ? idx.getAll(query, count) : idx.getAll(query))
        : (count !== undefined ? idx.getAll(null, count) : idx.getAll());
    }
    const db = await this.dbPromise;
    return query !== undefined
      ? (count !== undefined ? db.getAllFromIndex(this.storeName, indexName, query, count) : db.getAllFromIndex(this.storeName, indexName, query))
      : (count !== undefined ? db.getAllFromIndex(this.storeName, indexName, null, count) : db.getAllFromIndex(this.storeName, indexName));
  }

  async count(query?: IDBValidKey | IDBKeyRange): Promise<number> {
    if (this.existingTx) {
      const store = this.existingTx.objectStore(this.storeName);
      return query !== undefined ? store.count(query) : store.count();
    }
    const db = await this.dbPromise;
    return query !== undefined ? db.count(this.storeName, query) : db.count(this.storeName);
  }

  /** Index-scoped count without row hydration — the local sourceFence
   *  block-count baseline. Mirrors IReadOnlyStore.countFromIndex (contract
   *  addition landed by root). */
  async countFromIndex(indexName: string, query?: IDBValidKey | IDBKeyRange): Promise<number> {
    if (this.existingTx) {
      return this.existingTx.objectStore(this.storeName).index(indexName).count(query);
    }
    const db = await this.dbPromise;
    return query !== undefined
      ? db.countFromIndex(this.storeName, indexName, query)
      : db.countFromIndex(this.storeName, indexName);
  }
}

class IDBReadWriteStore<T> extends IDBReadOnlyStore<T> implements IReadWriteStore<T> {
  constructor(
    private readonly dbPromiseRef: Promise<IDBPDatabase>,
    private readonly writeStoreName: StoreName,
    private readonly activeTx?: IDBTx<'readwrite'>,
    private readonly getUserId?: () => string
  ) {
    super(dbPromiseRef, writeStoreName, activeTx);
  }

  async put(value: T, key?: IDBValidKey): Promise<IDBValidKey> {
    const userId = this.getUserId?.();
    const stored = (userId ? stampUserOwned(this.writeStoreName, value, userId) : value) as T;
    if (this.activeTx) {
      const store = this.activeTx.objectStore(this.writeStoreName);
      return key !== undefined ? store.put(stored, key) : store.put(stored);
    }
    const db = await this.dbPromiseRef;
    return key !== undefined
      ? db.put(this.writeStoreName, stored, key)
      : db.put(this.writeStoreName, stored);
  }

  async delete(key: IDBValidKey | IDBKeyRange): Promise<void> {
    if (this.activeTx) {
      await this.activeTx.objectStore(this.writeStoreName).delete(key);
      return;
    }
    const db = await this.dbPromiseRef;
    await db.delete(this.writeStoreName, key);
  }

  async clear(): Promise<void> {
    if (this.activeTx) {
      await this.activeTx.objectStore(this.writeStoreName).clear();
      return;
    }
    const db = await this.dbPromiseRef;
    await db.clear(this.writeStoreName);
  }
}

export class IndexedDBStorage implements IStorage {
  private _dbPromise: Promise<IDBPDatabase> | null = null;

  constructor(private readonly options: { getUserId?: () => string } = {}) {}

  private get dbPromise(): Promise<IDBPDatabase> {
    if (!this._dbPromise) {
      const opening = this.open();
      this._dbPromise = opening;
      opening.catch(() => {
        if (this._dbPromise === opening) this._dbPromise = null;
      });
    }
    return this._dbPromise;
  }

  private open(): Promise<IDBPDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
    }

    return openDB(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        // Fresh-start: if oldVersion < 20, drop all obsolete stores and recreate baseline V21
        if (oldVersion < 20) {
          const names = Array.from(db.objectStoreNames);
          for (const name of names) {
            db.deleteObjectStore(name);
          }
        }

        // 1. notes
        if (!db.objectStoreNames.contains('notes')) {
          const store = db.createObjectStore('notes', { keyPath: 'id' });
          store.createIndex('by-date', 'date');
          store.createIndex('by-created', 'createdAt');
        }

        // 2. page
        if (!db.objectStoreNames.contains('page')) {
          const store = db.createObjectStore('page', { keyPath: 'id' });
          store.createIndex('by-date', 'date', { unique: true });
          store.createIndex('by-slug', 'slug', { unique: true });
        }

        // 2b. page_notes (V22)
        if (!db.objectStoreNames.contains('page_notes')) {
          const store = db.createObjectStore('page_notes', { keyPath: 'id' });
          store.createIndex('by-page', 'pageId');
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-page-note', ['pageId', 'noteId'], { unique: true });
        }

        // 3. tags
        if (!db.objectStoreNames.contains('tags')) {
          const store = db.createObjectStore('tags', { keyPath: 'id' });
          store.createIndex('by-label', 'label', { unique: true });
          store.createIndex('by-type', 'type');
        }
        // 3a. tag_types (V23)
        if (!db.objectStoreNames.contains('tag_types')) {
          const store = db.createObjectStore('tag_types', { keyPath: 'id' });
          store.createIndex('by-name', 'name', { unique: true });
          const now = Date.now();
          store.put({ id: 'type-domain', name: 'domain', label: 'Domain', color: '#10b981', createdAt: now });
          store.put({ id: 'type-format', name: 'format', label: 'Format', color: '#8b5cf6', createdAt: now });
          store.put({ id: 'type-equipment', name: 'equipment', label: 'Equipment', color: '#3b82f6', createdAt: now });
          store.put({ id: 'type-quality', name: 'quality', label: 'Quality', color: '#f59e0b', createdAt: now });
          store.put({ id: 'type-intent', name: 'intent', label: 'Intent', color: '#ec4899', createdAt: now });
          store.put({ id: 'type-category', name: 'category', label: 'Category', color: '#6366f1', createdAt: now });
          store.put({ id: 'type-type', name: 'type', label: 'Type', color: '#a855f7', createdAt: now });
          store.put({ id: 'type-discipline', name: 'discipline', label: 'Discipline', color: '#14b8a6', createdAt: now });
        }

        // 4. note_tags
        if (!db.objectStoreNames.contains('note_tags')) {
          const store = db.createObjectStore('note_tags', { keyPath: 'id' });
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-tag', 'tagId');
          store.createIndex('by-note-tag', ['noteId', 'tagId'], { unique: true });
        }

        // 5. segments
        if (!db.objectStoreNames.contains('segments')) {
          const store = db.createObjectStore('segments', { keyPath: ['id', 'version'] });
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-type', 'dataType');
          store.createIndex('by-page', 'pageId');
          store.createIndex('by-history', 'isHistory');
        }

        // 6. sessions
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('by-segment', 'segmentId');
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-completed', 'createdAt');
          store.createIndex('by-content', 'blockContentId');
          store.createIndex('by-block', 'blockId');
          store.createIndex('by-page', 'pageId');
          store.createIndex('by-origin', 'origin');
        }

        // 7. results — removed in V26; the upgrade below migrates residual
        // rows into `sessions` before dropping the store.

        // 8. attachments
        if (!db.objectStoreNames.contains('attachments')) {
          const store = db.createObjectStore('attachments', { keyPath: 'id' });
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-time', 'createdAt');
          store.createIndex('by-page', 'pageId');
          store.createIndex('by-result', 'resultId');
        }

        // 9. events
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('by-timestamp', 'timestamp');
          store.createIndex('by-result-grain', ['resultId', 'grain']);
          store.createIndex('by-content-grain', ['blockContentId', 'grain']);
          store.createIndex('by-effort', 'effortSlug');
          store.createIndex('by-outputType', 'outputType');
          store.createIndex('by-grain', 'grain');
          store.createIndex('by-metric-date', 'metricDateKeys', { multiEntry: true });
        }

        // 10. field_catalog
        if (!db.objectStoreNames.contains('field_catalog')) {
          const store = db.createObjectStore('field_catalog', { keyPath: 'id' });
          store.createIndex('by-path', 'path');
        }
        if (!db.objectStoreNames.contains('field_sources')) {
          db.createObjectStore('field_sources', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('field_values')) {
          const store = db.createObjectStore('field_values', { keyPath: 'key' });
          store.createIndex('by-field', 'fieldId');
        }
        if (!db.objectStoreNames.contains('field_catalog_meta')) {
          db.createObjectStore('field_catalog_meta', { keyPath: 'id' });
        }

        // 11. efforts
        if (!db.objectStoreNames.contains('efforts')) {
          const store = db.createObjectStore('efforts', { keyPath: 'slug' });
          store.createIndex('by-discipline', 'baseAttributes.discipline');
          store.createIndex('by-source', 'registrySource');
        }

        // 12. block_index
        if (!db.objectStoreNames.contains('block_index')) {
          const store = db.createObjectStore('block_index', { keyPath: 'id' });
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-content', 'blockContentId');
          store.createIndex('by-type', 'dataType');
          store.createIndex('by-source', 'sourceId');
        }

        // 13. block_efforts
        if (!db.objectStoreNames.contains('block_efforts')) {
          const store = db.createObjectStore('block_efforts', { keyPath: 'id' });
          store.createIndex('by-note', 'noteId');
          store.createIndex('by-effort', 'effortSlug');
          store.createIndex('by-block', 'blockContentId');
        }

        // 14. meta
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        // V20 -> V21 upgrade: flatten sessions, drop data.logs, project legacy logs idempotently
        if (oldVersion === 20 && db.objectStoreNames.contains('sessions')) {
          const sessionsStore = tx.objectStore('sessions');
          const eventsStore = tx.objectStore('events');
          for await (const cursor of sessionsStore) {
            const legacy = cursor.value as Session & {
              data?: {
                logs?: unknown[];
                startTime?: number;
                endTime?: number;
                duration?: number;
                completed?: boolean;
                roundsCompleted?: number;
                totalRounds?: number;
                repsCompleted?: number;
              };
            };
            const logs = legacy.data?.logs ?? [];
            let alreadyProjected = false;
            for await (const _ev of eventsStore.index('by-result-grain').iterate(IDBKeyRange.bound([legacy.id, ''], [legacy.id, '\uffff']))) {
              alreadyProjected = true;
              break;
            }
            if (!alreadyProjected && logs.length > 0) {
              const identity = {
                noteId: legacy.noteId,
                resultId: legacy.id,
                segmentId: legacy.segmentId,
                segmentVersion: legacy.segmentVersion,
                blockContentId: legacy.blockContentId,
                origin: legacy.origin,
                pageId: legacy.pageId,
                workoutTimestamp: legacy.data?.endTime ?? legacy.createdAt,
              };
              const eventRows = toEventRows(logs as never, identity);
              const summaryRows = toSummaryEventRows(logs as never, identity);
              for (const row of eventRows) await eventsStore.put(row);
              for (const row of summaryRows) await eventsStore.put(row);
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
        // V21 -> V22 upgrade: invalidate seed checkpoint so V22 seed data re-applies cleanly
        if (oldVersion === 21 && db.objectStoreNames.contains('meta')) {
          const metaStore = tx.objectStore('meta');
          await metaStore.delete('seed');
        }

        // V25: identity — memberships store + by-user ownership index on every
        // user-owned store. Guards mandatory (V24 note): mixed-state DBs exist.
        if (oldVersion < 25) {
          if (!db.objectStoreNames.contains('memberships')) {
            db.createObjectStore('memberships', { keyPath: 'id' });
          }
          for (const name of USER_OWNED_STORES) {
            if (!db.objectStoreNames.contains(name)) continue;
            const store = tx.objectStore(name);
            if (!store.indexNames.contains('by-user')) {
              store.createIndex('by-user', 'userId');
            }
          }
        }

        // V26: results → sessions. Read every residual legacy row BEFORE the
        // store disappears. A session row already existing under the same id
        // does NOT prove its inline logs were ever projected, and "some
        // events exist" does not prove all were: every projected row is
        // merged per deterministic id — existing rows are never overwritten,
        // absent detail/summary rows are added, so no log blob is dropped
        // without projection. The row is flattened to scalar fields (no
        // `data` blob) and the legacy store is dropped last.
        if (db.objectStoreNames.contains('results')) {
          const sessionsStore = tx.objectStore('sessions');
          const resultsStore = tx.objectStore('results');
          const eventsStore = tx.objectStore('events');
          for await (const cursor of resultsStore) {
            const { data: legacyData, ...legacyRow } = cursor.value as Session & {
              data?: {
                logs?: unknown[];
                startTime?: number;
                endTime?: number;
                duration?: number;
                completed?: boolean;
                roundsCompleted?: number;
                totalRounds?: number;
                repsCompleted?: number;
              };
            };
            const logs = legacyData?.logs ?? [];
            if (logs.length > 0) {
              const identity = {
                noteId: legacyRow.noteId,
                resultId: legacyRow.id,
                segmentId: legacyRow.segmentId,
                segmentVersion: legacyRow.segmentVersion,
                blockContentId: legacyRow.blockContentId,
                origin: legacyRow.origin,
                pageId: legacyRow.pageId,
                workoutTimestamp: legacyData?.endTime ?? legacyRow.createdAt,
              };
              for (const row of toEventRows(logs as never, identity)) {
                if ((await eventsStore.get(row.id)) === undefined) await eventsStore.put(row);
              }
              for (const row of toSummaryEventRows(logs as never, identity)) {
                if ((await eventsStore.get(row.id)) === undefined) await eventsStore.put(row);
              }
            }
            // The canonical flattened session row already exists — keep it,
            // the legacy duplicate is discarded with the store.
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

        // V26: block_index gains the by-source index — the sourceFence count
        // reads source vocabulary families without row hydration.
        // Presence-guarded like by-created for partially-mixed databases.
        if (db.objectStoreNames.contains('block_index')
            && !tx.objectStore('block_index').indexNames.contains('by-source')) {
          tx.objectStore('block_index').createIndex('by-source', 'sourceId');
        }

        // V26: notes gain the by-created index — the createdAt-fallback
        // half of complete date-window candidate reads (union with by-date).
        // Presence-guarded: a partially-mixed database without the index is
        // repaired on the next upgrade run.
        if (db.objectStoreNames.contains('notes')
            && !tx.objectStore('notes').indexNames.contains('by-created')) {
          tx.objectStore('notes').createIndex('by-created', 'createdAt');
        }

        // V26: unique (noteId, tagId) pair on note_tags. Deterministic cleanup
        // first — duplicate links keep the lexicographically smallest row id —
        // because a unique index cannot be created over existing duplicates.
        if (db.objectStoreNames.contains('note_tags')
            && !tx.objectStore('note_tags').indexNames.contains('by-note-tag')) {
          const store = tx.objectStore('note_tags');
          // Persisted rows come back untyped through the loose tx handle —
          // every note_tags row carries the pair fields by schema contract.
          type NoteTagPairRow = { id: string; noteId: string; tagId: string };
          const winnerByPair = new Map<string, string>();
          const dupes: string[] = [];
          for await (const cursor of store) {
            const row = cursor.value as NoteTagPairRow;
            const pair = `${row.noteId}\u0000${row.tagId}`;
            const winner = winnerByPair.get(pair);
            if (winner === undefined || row.id < winner) {
              winnerByPair.set(pair, row.id);
              if (winner !== undefined) dupes.push(winner);
            } else {
              dupes.push(row.id);
            }
          }
          for (const id of dupes) await store.delete(id);
          store.createIndex('by-note-tag', ['noteId', 'tagId'], { unique: true });
        }

        // V26: static block_index / block_efforts rows are NOT purged here —
        // they are rebuildable seed output, but deleting them before a seed
        // sync has actually succeeded would break the offline path. The seed
        // schema bump (v6) forces a full re-apply: the importer rewrites each
        // static row in place (legacy row ids are stable) mapped onto the
        // imported note UUID via full sourcePath, deletes vanished ids via
        // its per-chunk checkpoints, and throws before mutating when a row's
        // sourcePath has no (ambiguous/missing) imported note — prior rows
        // stay untouched on failure. Journal history is never touched.

        // V28: dashboard typing repair — every note whose frontmatter
        // segment says `dashboard: true` becomes type 'dashboard' /
        // sourceId 'dashboards' (legacy user dashboards saved as type
        // 'note', and seed dashboards imported before attribution).
        // Non-destructive: only those two storage fields flip, rawContent /
        // tags / seed provenance untouched, and the pass is idempotent.
        if (db.objectStoreNames.contains('notes') && db.objectStoreNames.contains('segments')) {
          const segments = tx.objectStore('segments');
          const notes = tx.objectStore('notes');
          const repaired = new Set<string>();
          for await (const cursor of segments) {
            const segment = cursor.value as NoteSegment;
            if (segment.dataType !== 'frontmatter' || repaired.has(segment.noteId)) continue;
            if (typeof segment.rawContent !== 'string'
                || !/(^|\n)dashboard:\s*["']?true["']?\s*(\n|$)/.test(segment.rawContent)) continue;
            repaired.add(segment.noteId);
            const note = await notes.get(segment.noteId);
            if (!note || (note.type === 'dashboard' && note.sourceId === 'dashboards')) continue;
            await notes.put({ ...note, type: 'dashboard', sourceId: note.sourceId ?? 'dashboards' });
          }
        }
      },
      blocked: (currentVersion, blockedVersion) => {
        console.warn(
          `[IndexedDBStorage] open of ${DB_NAME} v${blockedVersion ?? DB_VERSION} blocked by v${currentVersion} in another tab`
        );
      },
      blocking: (currentVersion, blockedVersion) => {
        console.warn(
          `[IndexedDBStorage] yielding ${DB_NAME} v${currentVersion} to v${blockedVersion} upgrade from another tab`
        );
        if (this._dbPromise) {
          this._dbPromise.then((db) => db.close()).catch(() => {});
          this._dbPromise = null;
        }
      },
    });
  }

  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>> {
    return new IDBReadOnlyStore<StoreType<K>>(this.dbPromise, store);
  }

  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>> {
    return new IDBReadWriteStore<StoreType<K>>(this.dbPromise, store, undefined, this.options.getUserId);
  }

  async transaction<K extends StoreName, R>(
    stores: K[],
    mode: IDBTransactionMode,
    fn: (tx: IStorageTransaction) => Promise<R>
  ): Promise<R> {
    const db = await this.dbPromise;
    const idbTx = db.transaction(stores, mode) as IDBTx;
    const txAdapter: IStorageTransaction = {
      readonly: (name) => new IDBReadOnlyStore(this.dbPromise, name, idbTx),
      readwrite: (name) => new IDBReadWriteStore(this.dbPromise, name, idbTx as IDBTx<'readwrite'>, this.options.getUserId),
    };
    let result: R;
    try {
      result = await fn(txAdapter);
    } catch (err) {
      // Without an explicit abort, the IDB transaction auto-commits every
      // already-queued write once fn rejects — "rollback" would silently
      // become commit. Abort flips the outcome to a real rollback; its
      // rejection of `done` is consumed here so it cannot surface as an
      // unhandled rejection on top of the original error.
      idbTx.abort();
      await idbTx.done.catch(() => {});
      throw err;
    }
    await idbTx.done;
    return result;
  }

  async wipe(): Promise<void> {
    await this.close();
    if (typeof indexedDB !== 'undefined') {
      await deleteDB(DB_NAME);
    }
  }

  async close(): Promise<void> {
    if (this._dbPromise) {
      const db = await this._dbPromise.catch(() => null);
      db?.close();
      this._dbPromise = null;
    }
  }
}
