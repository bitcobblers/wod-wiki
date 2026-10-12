import type {
  IReadOnlyStore,
  IReadWriteStore,
  IStorage,
  IStorageTransaction,
  StoreName,
  StoreType,
} from './IStorage';
import { IndexedDBStorage } from './IndexedDBStorage';
import { InMemoryStorage } from './InMemoryStorage';
import { StorageService } from './StorageService';
import { ApiStorage } from '@bitcobblers/wod-wiki-storage';
import { BrowserTursoStorage } from '@bitcobblers/wod-wiki-storage/sql';
import type { DomainQuery, DomainQueryResult } from '@bitcobblers/wod-wiki-storage';
import { createProfileService } from '../profile';

import { LocalStore, InMemoryBackend, browserLocalStorageBackend, type StorageBackend } from './LocalStore';
import {
  DATA_SETTINGS_KEY,
  connectTurso,
  readDataSettings,
  testTursoConnection,
  switchToIndexedDb,
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
export { DATA_SETTINGS_KEY, readDataSettings, connectTurso, testTursoConnection, switchToIndexedDb };

// Data provider selection: the VITE_STORAGE=api build override always wins;
// otherwise a saved Turso data setting picks 'turso'. A saved-but-invalid
// config picks 'invalid': NO provider is opened — the storage adapter throws
// until the config is repaired in Data settings (surfaced at boot through
// whenStorageReady()'s rejection), never a silent IndexedDB fallback.
// Read once per page load: switching providers persists the setting and
// reloads, and other tabs reload via the storage-event guard in
// dataSettings, so a live page never writes to a stale provider.
export const storageBackend: StorageProvider =
  import.meta.env.VITE_STORAGE === 'api'
    ? 'api'
    : readDataSettings().state === 'turso'
      ? 'turso'
      : readDataSettings().state === 'invalid'
        ? 'invalid'
        : 'indexed-db';

/** Thrown by every UnconfiguredStorage method. */
export const UNCONFIGURED_ERROR = 'Saved data settings are invalid — open Settings → Data to repair the connection.';

/**
 * Placeholder adapter for the 'invalid' provider: every access throws, so no
 * IndexedDB database is created or written with an unrepairable config.
 */
class UnconfiguredStorage implements IStorage {
  readonly(): never {
    throw new Error(UNCONFIGURED_ERROR);
  }
  readwrite(): never {
    throw new Error(UNCONFIGURED_ERROR);
  }
  transaction(): never {
    throw new Error(UNCONFIGURED_ERROR);
  }
  // Placeholder implements the full contract; queryDomain stays optional on IStorage.
  queryDomain(): Promise<never> {
    return Promise.reject(new Error(UNCONFIGURED_ERROR));
  }
  wipe(): Promise<never> {
    return Promise.reject(new Error(UNCONFIGURED_ERROR));
  }
  close(): Promise<never> {
    return Promise.reject(new Error(UNCONFIGURED_ERROR));
  }
}

// Identity getter is a lazy closure: resolved at put-time, after the profile
// bootstrap ran (currentSync() undefined until then → rows stored unstamped).
export const profileService = createProfileService(storageBackend === 'invalid' ? 'api' : storageBackend);

function createDefaultStorage(): IStorage {
  const options = { getUserId: () => profileService.currentSync()?.id };
  if (storageBackend === 'api') {
    return new ApiStorage(import.meta.env.VITE_API_URL ?? '/api', undefined, options);
  }
  if (storageBackend === 'turso') {
    const settings = readDataSettings();
    if (settings.state !== 'turso') {
      throw new Error('Turso provider selected but the saved data settings are missing or invalid.');
    }
    return new BrowserTursoStorage({ url: settings.url, authToken: settings.authToken }, options);
  }
  if (storageBackend === 'invalid') return new UnconfiguredStorage();
  return new IndexedDBStorage(options);
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
   *  it), the API result on ApiStorage. */
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

// Turso needs an async activation (ready()) before first use; boot awaits
// this before first render/write (api/IndexedDB resolve immediately, an
// invalid config rejects so recovery stops before any storage use). The memo
// clears on failure so a boot retry re-attempts the connection.
let readyPromise: Promise<void> | undefined;

export function whenStorageReady(): Promise<void> {
  if (storageBackend === 'invalid') return Promise.reject(new Error(UNCONFIGURED_ERROR));
  if (storageBackend !== 'turso') return Promise.resolve();
  readyPromise ??= (currentStorage as BrowserTursoStorage)
    .ready() // guarded: storageBackend === 'turso' ⇒ currentStorage is a BrowserTursoStorage
    .catch((err: unknown) => {
      readyPromise = undefined;
      throw err;
    });
  return readyPromise;
}

export function setStorageForTesting(newStorage: IStorage): void {
  currentStorage = newStorage;
  readyPromise = undefined;
}

export function resetStorageForTesting(): void {
  currentStorage = createDefaultStorage();
  readyPromise = undefined;
}
