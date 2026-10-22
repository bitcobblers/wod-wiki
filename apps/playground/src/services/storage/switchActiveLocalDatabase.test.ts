import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  getActiveLocalDbName,
  resetStorageForTesting,
  setStorageForTesting,
  storage,
  subscribeActiveLocalDatabase,
  switchActiveLocalDatabase,
  whenStorageReady,
} from './index';
import { DATA_SETTINGS_KEY } from './dataSettings';
import type { IStorage } from './IStorage';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.removeItem(DATA_SETTINGS_KEY);
});

// Release the opened databases/connections so the bun process exits.
afterEach(async () => {
  await storage.close();
  resetStorageForTesting();
  Reflect.deleteProperty(globalThis, 'indexedDB');
});

describe('switchActiveLocalDatabase', () => {
  it('closes the old storage, re-points at the new database and notifies subscribers', async () => {
    const closed: string[] = [];
    const oldStorage: IStorage = {
      ...storage,
      close: () => {
        closed.push('old');
        return Promise.resolve();
      },
    };
    setStorageForTesting(oldStorage);

    const notified: string[] = [];
    const unsubscribe = subscribeActiveLocalDatabase((name) => notified.push(name));

    await switchActiveLocalDatabase('switch-target-a');

    expect(getActiveLocalDbName()).toBe('switch-target-a');
    expect(closed).toEqual(['old']);
    expect(notified).toEqual(['switch-target-a']);

    // The live proxy now serves the NEW database: boot it and confirm the
    // opened database name (fake-indexeddb reports database() names).
    await whenStorageReady();
    const names = (await globalThis.indexedDB.databases()).map((db) => db.name);
    expect(names).toContain('switch-target-a');
    unsubscribe();
  });

  it('supports repeated switches to a third database', async () => {
    setStorageForTesting({ ...storage, close: () => Promise.resolve() });
    await switchActiveLocalDatabase('switch-target-b');
    await switchActiveLocalDatabase('switch-target-c');
    expect(getActiveLocalDbName()).toBe('switch-target-c');
  });
});
