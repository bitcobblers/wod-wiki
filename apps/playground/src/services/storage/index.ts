import type {
  IReadOnlyStore,
  IReadWriteStore,
  IStorage,
  IStorageTransaction,
  StoreName,
  StoreType,
} from './IStorage';
import { IndexedDBStorage } from '@bitcobblers/wod-wiki-storage/idb';
import { InMemoryStorage } from './InMemoryStorage';
import { StorageService } from './StorageService';
import { ApiStorage, DB_VERSION } from '@bitcobblers/wod-wiki-storage';
import type { DomainQuery, DomainQueryResult } from '@bitcobblers/wod-wiki-storage';
import type { SyncMutation } from '@bitcobblers/wod-wiki-storage/sql';
import { createProfileService } from '../profile';
import { reportSyncError } from '../syncActivity';
import { TursoSyncEngine } from './syncEngine';
import { beginStorageUpgrade, markStorageChecking, markStorageIdle, failStorageUpdate, getStorageUpdate } from './storageUpdate';

import { LocalStore, InMemoryBackend, browserLocalStorageBackend, type StorageBackend } from './LocalStore';
import {
  DATA_SETTINGS_KEY,
  connectTurso,
  getActiveLocalDbName,
  readDataSettings,
  saveRestoredSettings,
  selectLocalDatabase,
  switchToIndexedDb,
  testTursoConnection,
  type DataSettings,
  type DataSettingsRead,
  type StorageProvider,
} from './dataSettings';
export type {
  IReadOnlyStore,
  IReadWriteStore,
  IStorage,
  IStorageTransaction,
  StoreName,
  StoreType,
  StorageBackend,
  StorageProvider,
  DataSettings,
  DataSettingsRead,
};
export { IndexedDBStorage, InMemoryStorage, StorageService };
export { LocalStore, InMemoryBackend, browserLocalStorageBackend };
export { DATA_SETTINGS_KEY, readDataSettings, connectTurso, testTursoConnection, switchToIndexedDb, saveRestoredSettings, getActiveLocalDbName, selectLocalDatabase };
export { listLocalDatabases, createLocalDatabase, deleteLocalDatabase, isValidLocalDatabaseName, type LocalDatabaseInfo } from '@bitcobblers/wod-wiki-storage/idb';
export { getStorageUpdate, subscribeStorageUpdate } from './storageUpdate';

// Data-plane selection: the VITE_STORAGE=api build override wins; EVERY
// other build — including one with a saved Turso backup target — reads and
// writes IndexedDB. The saved Turso setting is a sync/backup destination
// (see startBackgroundStorageSync), never the data plane, so a broken or
// unreachable backup never disables local reads.
// Read once per page load: switching targets persists the setting and
// reloads, and other tabs reload via the storage-event guard in
// dataSettings, so a live page never syncs to a stale target.
export const storageBackend: StorageProvider =
  import.meta.env.VITE_STORAGE === 'api' ? 'api' : 'indexed-db';

// Identity getter is a lazy closure: resolved at put-time, after the profile
// bootstrap ran (currentSync() undefined until then → rows stored unstamped).
// Browser builds keep identity local even with a Turso backup configured —
// only the API build stores membership remotely.
export const profileService = createProfileService(storageBackend === 'api' ? 'api' : 'indexed-db');

function createDefaultStorage(): IStorage {
  if (storageBackend === 'api') {
    return new ApiStorage(import.meta.env.VITE_API_URL ?? '/api', undefined,
      { getUserId: () => profileService.currentSync()?.id });
  }
  // dbName: an isolated restore selects a unique local database; ordinary
  // boots (and post-restore restarts) open whichever database the saved
  // settings selected — the original profile until then.
  return new IndexedDBStorage({
    dbName: getActiveLocalDbName(),
    getUserId: () => profileService.currentSync()?.id,
    onUpgradeStart: (fromVersion) => beginStorageUpgrade(fromVersion, DB_VERSION),
  });
}

let currentStorage: IStorage = createDefaultStorage();

export const storage: IStorage = {
  readonly<K extends StoreName>(store: K): IReadOnlyStore<StoreType<K>> {
    return currentStorage.readonly(store);
  },
  readwrite<K extends StoreName>(store: K): IReadWriteStore<StoreType<K>> {
    return currentStorage.readwrite(store);
  },
  transaction<K extends StoreName, R>(
    stores: K[],
    mode: 'readonly' | 'readwrite',
    fn: (tx: IStorageTransaction) => Promise<R>
  ): Promise<R> {
    return currentStorage.transaction(stores, mode, fn);
  },
  /** Remote domain-query pass-through — undefined on local backends
   *  (IStorage.queryDomain is optional and local adapters don't implement
   *  it), the API result on ApiStorage. Browser WQL/reporting stays local;
   *  the Turso backup never receives domain queries. */
  async queryDomain(query: DomainQuery): Promise<DomainQueryResult | undefined> {
    return currentStorage.queryDomain?.(query);
  },
  wipe(): Promise<void> {
    return currentStorage.wipe();
  },
  close(): Promise<void> {
    return currentStorage.close();
  },
};
export const storageService = new StorageService(storage);

// Boot gate: resolves when the local database is readable and the migration
// policy has completed. Never touches the network — the remote schema probe
// is the sync engine's job (startBackgroundStorageSync), not ordinary boot.
let readyPromise: Promise<void> | undefined;

export function whenStorageReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    if (storageBackend === 'api') return; // ApiStorage is ready on first request
    try {
      // Inspect the ACTUAL local schema version WITHOUT opening or mutating
      // anything: ordinary boots stay silent (no checking flash, no blank
      // app), an older schema announces the blocking update screen before
      // the upgrade runs, a newer one fails fast with an actionable error.
      const idb = globalThis.indexedDB;
      if (idb && typeof idb.databases === 'function') {
        const activeName = getActiveLocalDbName();
        const entry = (await idb.databases().catch(() => [] as IDBDatabaseInfo[]))
          .find(db => db.name === activeName);
        if (entry && typeof entry.version === 'number') {
          if (entry.version > DB_VERSION) {
            const message = `local database schema v${entry.version} is newer than this app supports (v${DB_VERSION}); refusing to downgrade`;
            failStorageUpdate(message);
            throw new Error(message);
          }
          if (entry.version < DB_VERSION) {
            markStorageChecking(`Checking local database schema v${entry.version}…`);
          }
        }
      }
      await (currentStorage as IndexedDBStorage).open();
      markStorageIdle(DB_VERSION);
    } catch (error) {
      // The memo clears on failure so a boot retry re-attempts the open.
      readyPromise = undefined;
      if (getStorageUpdate().phase !== 'error') {
        failStorageUpdate(error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  })();
  return readyPromise;
}

// Background Turso backup/sync. Idempotent start: the returned cleanup is
// memoized while a session runs — repeated calls return the same stopper —
// and calling it stops the session (a later start re-creates it).
let syncSession: { stop: () => void } | undefined;
let syncCleanup: (() => void) | undefined;
/** Live engine reference so a restore/export can await the full stop
 *  (in-flight chain drained, remote closed) before reading the outbox. */
let syncEngine: TursoSyncEngine | undefined;

export function startBackgroundStorageSync(): () => void {
  if (!syncSession) {
    if (storageBackend === 'api' || !(currentStorage instanceof IndexedDBStorage)) {
      syncSession = { stop: () => { syncSession = undefined; } };
    } else {
      const settings = readDataSettings();
      if (settings.state === 'invalid') {
        const message = `Saved backup settings are invalid: ${settings.error}`;
        reportSyncError(message);
        failStorageUpdate(message);
        syncSession = { stop: () => { syncSession = undefined; } };
      } else if (settings.state === 'turso') {
        const engine = new TursoSyncEngine(currentStorage, settings);
        syncEngine = engine;
        const stop = engine.start();
        syncSession = {
          stop: () => {
            stop();
            if (syncEngine === engine) syncEngine = undefined;
            syncSession = undefined;
          },
        };
      } else {
        syncSession = { stop: () => { syncSession = undefined; } };
      }
    }
    syncCleanup = () => { syncSession?.stop(); syncCleanup = undefined; };
  }
  return syncCleanup;
}

/** Awaitably stop a running background session (drains the engine chain and
 *  closes the remote). Resolves `true` only when a session was actually
 *  running, so a failed restore can restart exactly what it stopped. */
export async function stopBackgroundStorageSync(): Promise<boolean> {
  if (!syncSession) return false;
  const engine = syncEngine;
  syncSession.stop();
  if (engine) await engine.stop();
  return engine !== undefined;
}

/** All unsent (unacked) local edit groups in commit order — the
 *  credential-free payload behind the safe-file export. Callers that race an
 *  active uploader must `await stopBackgroundStorageSync()` first so an
 *  in-flight ack cannot remove entries mid-read. Empty on API/in-memory
 *  backends. */
export async function readUnsentEdits(): Promise<{ seq: number; id: string; at: number; ops: SyncMutation[] }[]> {
  if (!(currentStorage instanceof IndexedDBStorage)) return [];
  return currentStorage.readOutbox(0, Number.MAX_SAFE_INTEGER);
}

/** Every retained row of every store, lossless — the rollback payload of the
 *  safe-file export (credentials never live in IndexedDB). Empty on
 *  API/in-memory backends. */
export async function readAllLocalRows(): Promise<{ store: string; rows: unknown[] }[]> {
  if (!(currentStorage instanceof IndexedDBStorage)) return [];
  return currentStorage.snapshotAllRows();
}

export function setStorageForTesting(newStorage: IStorage): void {
  currentStorage = newStorage;
  readyPromise = undefined;
}

export function resetStorageForTesting(): void {
  currentStorage = createDefaultStorage();
  readyPromise = undefined;
}

// Active-local-database switch. Listeners fire AFTER the new storage is
// wired and its derived caches re-hydrated, so a subscriber reading data
// sees the new database, not the old one.
const activeLocalDbListeners = new Set<(localDbName: string) => void>();

export function subscribeActiveLocalDatabase(listener: (localDbName: string) => void): () => void {
  activeLocalDbListeners.add(listener);
  return () => {
    activeLocalDbListeners.delete(listener);
  };
}

/** Re-point the live local data plane at another IndexedDB database without
 *  a page reload: persist the selection, close the old connection, open the
 *  new name, and notify subscribers.
 *
 *  The caches derived from the OLD database's rows (seed content, WQL page
 *  sources, effort/equipment registries) are NOT dropped here: this module
 *  deliberately does not import them, because each of them imports the
 *  storage plane back and a static import would close a module cycle. The
 *  caller rehydrates those caches through `rehydrateActiveDatabaseCaches`
 *  (services/storage/activeDatabaseCaches.ts) after the switch.
 *
 *  No-op on the API backend — there is no local database to switch. */
export async function switchActiveLocalDatabase(localDbName: string): Promise<void> {
  if (storageBackend === 'api') return;
  selectLocalDatabase(localDbName);
  await currentStorage.close();
  currentStorage = createDefaultStorage();
  readyPromise = undefined;
  for (const listener of activeLocalDbListeners) listener(localDbName);
}
