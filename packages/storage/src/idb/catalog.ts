/**
 * Local database catalog — enumerate/delete the browser-local IndexedDB
 * databases behind the active-profile selector. The default app database is
 * never created or destroyed here: the catalog only manages the auxiliary
 * (restore/scratch) databases that the database switcher offers.
 *
 * This module deliberately does NOT import the storage adapter: the adapter
 * lives in ./index, which re-exports this catalog, so an import back would
 * close a module cycle. Creating a database (which needs the adapter's
 * schema upgrade path) therefore lives beside the adapter in ./index.
 */

export interface LocalDatabaseInfo { name: string; version: number | null }

/** Canonical app-database name ("wodwiki-db"). Defined HERE, not imported
 *  from ./index, because the re-export cycle would read it before index.ts
 *  initialized it (index.ts: export const IDB_DB_NAME = DEFAULT_LOCAL_DATABASE_NAME). */
export const DEFAULT_LOCAL_DATABASE_NAME: string = 'wodwiki-db';

/** Same rule as the app-side isValidLocalDbName — one name vocabulary
 *  everywhere (restore, catalog, settings persistence). */
export function isValidLocalDatabaseName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name);
}

/** Native enumeration when the browser exposes it; [] otherwise (old
 *  Safari/Firefox lack databases()) — never throws. */
export async function listLocalDatabases(): Promise<LocalDatabaseInfo[]> {
  const idb = globalThis.indexedDB;
  if (!idb || typeof idb.databases !== 'function') return [];
  const entries = await idb.databases().catch(() => [] as IDBDatabaseInfo[]);
  return entries.flatMap((entry) =>
    typeof entry.name === 'string'
      ? [{ name: entry.name, version: typeof entry.version === 'number' ? entry.version : null }]
      : [],
  );
}

/** Delete one named database only; a blocked delete resolves (an open
 *  connection elsewhere wins — the scratch data is disposable). */
export async function deleteLocalDatabase(name: string): Promise<void> {
  if (!isValidLocalDatabaseName(name)) throw new Error(`Invalid local database name "${String(name)}".`);
  const idb = globalThis.indexedDB;
  if (!idb) return;
  await new Promise<void>((resolve, reject) => {
    const request = idb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete local database "${name}".`));
    request.onblocked = () => resolve();
  });
}
