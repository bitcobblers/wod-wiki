/**
 * metaStore — auxiliary persistence for the VITE_STORAGE=api build.
 *
 * Namespaced `{ key, value }` rows in the shared `meta` store through the
 * existing `storage` singleton: user calcs (`user-calc:*`), telemetry
 * (`telemetry:*`), notebooks (`wodwiki:notebooks`, `wodwiki:active-notebook`),
 * route WQL defaults + shortcuts (`wodwiki.routeWql.v1*`,
 * `wodwiki.routeWqlShortcuts.v1*`). Device-local in browser builds — even
 * with a Turso backup configured, browser identity/preferences stay local
 * (remotePrefsMode is API-only under the local-first cutover): theme, audio,
 * onboarding, cast pairing, consent, view settings, profile, calcs.
 */
import type { StorageBackend } from './LocalStore';
import { storage, storageBackend } from './index';

/** True when prefs/notebooks/telemetry/calcs persist through the remote meta store. */
export const remotePrefsMode: boolean = storageBackend === 'api';

/** Prefix namespaces hydrated into the pref cache (the vocabulary of remote
 *  pref rows in API builds). */
export const PREF_NAMESPACES = ['wodwiki.routeWql.v1', 'wodwiki.routeWqlShortcuts.v1', 'wodwiki.soundProfiles.v1'];
/** Exact notebook rows (kept narrow — no blanket `wodwiki:` capture). */
export const PREF_KEYS = ['wodwiki:notebooks', 'wodwiki:active-notebook'];

// Hydrated raw-JSON view of the remote pref rows: read backend for
// LocalStore consumers in remote mode. Filled by hydrateMetaPrefs (before
// first render), kept in step by metaSetPref — reads never hit the network.
const prefCache = new Map<string, string>();

export const metaPrefBackend: StorageBackend = {
  getItem: (key) => prefCache.get(key) ?? null,
  // Cache update only — persistence failures surface through metaSetPref;
  // LocalStore.set swallows backend errors, so writes must not go through it.
  setItem: (key, value) => prefCache.set(key, value),
  removeItem: (key) => prefCache.delete(key),
};

/**
 * Load the remote pref rows into the cache. Rejects on failure; the caller
 * must not render the app into default-state (later writes would clobber
 * the unreachable remote rows) — it shows an error with a retry instead.
 */
export async function hydrateMetaPrefs(): Promise<void> {
  const listed = await Promise.all(
    PREF_NAMESPACES.map((ns) =>
      storage.readonly('meta').getAll(IDBKeyRange.bound(ns, `${ns}\uffff`)) as Promise<
        { key: string; value: string }[]
      >,
    ),
  );
  const single = await Promise.all(
    PREF_KEYS.map((key) => storage.readonly('meta').get(key) as Promise<{ key: string; value: string } | undefined>),
  );
  for (const rows of listed) {
    for (const row of rows) prefCache.set(row.key, row.value);
  }
  for (const row of single) {
    if (row) prefCache.set(row.key, row.value);
  }
}

/**
 * Persist one pref row ({ key, value }) and update the hydrated cache.
 * raw === null deletes the row. Throws on failure — callers report.
 */
export async function metaSetPref(qualifiedKey: string, raw: string | null): Promise<void> {
  if (raw === null) {
    await storage.readwrite('meta').delete(qualifiedKey);
    prefCache.delete(qualifiedKey);
  } else {
    await storage.readwrite('meta').put({ key: qualifiedKey, value: raw });
    prefCache.set(qualifiedKey, raw);
  }
}

/**
 * Delete several pref rows as one storage transaction (one server /tx post
 * — all-or-nothing), then update the cache. Throws on failure.
 */
export async function metaDeletePrefs(qualifiedKeys: string[]): Promise<void> {
  if (qualifiedKeys.length === 1) return metaSetPref(qualifiedKeys[0], null);
  await storage.transaction(['meta'], 'readwrite', async (tx) => {
    for (const key of qualifiedKeys) await tx.readwrite('meta').delete(key);
  });
  for (const key of qualifiedKeys) prefCache.delete(key);
}

/**
 * List `{ key, value }` rows under a namespace prefix (remote mode). Real
 * IDBKeyRange works on both backends (ApiStorage converts it to a wire
 * range; IndexedDB takes it natively).
 */
export async function metaListRows<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  return (await storage.readonly('meta').getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`))) as {
    key: string;
    value: T;
  }[];
}

/** One auxiliary meta row put — used by non-LocalStore aux data (calcs, telemetry). */
export async function metaPutRow<T>(key: string, value: T): Promise<void> {
  await storage.readwrite('meta').put({ key, value });
}

/** One auxiliary meta row get. */
export async function metaGetRow<T>(key: string): Promise<T | undefined> {
  const row = (await storage.readonly('meta').get(key)) as { value: T } | undefined;
  return row?.value;
}

/** One auxiliary meta row delete. */
export async function metaDeleteRow(key: string): Promise<void> {
  await storage.readwrite('meta').delete(key);
}
