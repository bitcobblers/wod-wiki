import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  DEFAULT_LOCAL_DATABASE_NAME,
  createLocalDatabase,
  deleteLocalDatabase,
  isValidLocalDatabaseName,
  listLocalDatabases,
} from '../src/idb';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { Reflect.deleteProperty(globalThis, 'indexedDB'); });

describe('isValidLocalDatabaseName', () => {
  it('accepts names matching the shared rule', () => {
    expect(isValidLocalDatabaseName('wodwiki-db')).toBe(true);
    expect(isValidLocalDatabaseName('restore-2026_10.21')).toBe(true);
    expect(isValidLocalDatabaseName('A')).toBe(true);
  });

  it('rejects malformed names', () => {
    expect(isValidLocalDatabaseName('.leading-dot')).toBe(false);
    expect(isValidLocalDatabaseName('-leading-dash')).toBe(false);
    expect(isValidLocalDatabaseName('has space')).toBe(false);
    expect(isValidLocalDatabaseName('')).toBe(false);
    expect(isValidLocalDatabaseName('a'.repeat(101))).toBe(false);
    expect(isValidLocalDatabaseName(42)).toBe(false);
    expect(isValidLocalDatabaseName(undefined)).toBe(false);
  });
});

describe('catalog', () => {
  it('create/list/delete round-trips an auxiliary database without touching the default', async () => {
    expect(await listLocalDatabases()).toEqual([]);

    const created = await createLocalDatabase('storybook-scratch');
    expect(created).toEqual({ name: 'storybook-scratch', version: created.version });
    expect(created.version).toBeGreaterThan(0);
    expect((await listLocalDatabases()).map((db) => db.name)).toEqual(['storybook-scratch']);

    await deleteLocalDatabase('storybook-scratch');
    expect(await listLocalDatabases()).toEqual([]);
    expect((await listLocalDatabases()).some((db) => db.name === DEFAULT_LOCAL_DATABASE_NAME)).toBe(false);
  });

  it('refuses invalid names and the default database', async () => {
    await expect(createLocalDatabase('bad name')).rejects.toThrow(/Invalid local database name/);
    await expect(createLocalDatabase(DEFAULT_LOCAL_DATABASE_NAME)).rejects.toThrow(/default database/);
    await expect(deleteLocalDatabase('')).rejects.toThrow(/Invalid local database name/);
    expect(await listLocalDatabases()).toEqual([]);
  });
});
