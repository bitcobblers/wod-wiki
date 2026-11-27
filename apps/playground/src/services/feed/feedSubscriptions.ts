/**
 * feedSubscriptions — per-feed subscription state (local-first contract).
 * Persisted canonically in IStorage `meta` (`feed:subscriptions` via
 * feedRegistryStore) with non-destructive migration from and best-effort
 * mirror to legacy localStorage (`wodwiki.seedSubscriptions`,
 * `wodwiki.seedAutoSync`), plus synchronous in-memory cache + listener
 * notifications for React selectors.
 *
 * Absence of a record means "no explicit choice":
 * migrateFeedSubscriptions() subscribes previously imported feeds, a
 * persisted false always stays off, and core is always on (unsubscribe is
 * a no-op for it). Pre-feed-unit records were written per notebook — they
 * fold onto the feed that publishes the notebook on read and on migration.
 */
import type { FeedOfflinePolicy } from '@bitcobblers/wod-wiki-engine';
import type { FeedImportStorage } from './FeedImportStorage';
import { mainThreadFeedImportStorage } from './feedStorageDefault';
import { NOTEBOOKS, feedIdForLegacyId, LEGACY_FEED_ID_MAP } from './feedSources';
import {
  flushFeedStatePersistence,
  getAutoSyncCache,
  getLegacySubMapCache,
  getOfflinePolicyCache,
  getSubsEntriesCache,
  hydrateFeedStateFromStorage,
  invalidateLegacyCachesFromStorageEvent,
  isFeedStateHydrated,
  LEGACY_AUTO_SYNC_KEY,
  LEGACY_SUBSCRIPTIONS_KEY,
  readLegacyBooleanMap,
  resetFeedRegistryStoreForTest,
  schedulePersistSubscriptionsToStorage,
  setAutoSyncCache,
  setLegacySubMapCache,
  setOfflinePolicyCache,
  subscribeFeedRegistryListeners,
  writeLocalStorageJson,
} from './feedRegistryStore';
import { seedMetaKey } from '@/types/seed';

export { hydrateFeedStateFromStorage, flushFeedStatePersistence };

const STORAGE_KEY = LEGACY_SUBSCRIPTIONS_KEY;
const AUTO_SYNC_KEY = LEGACY_AUTO_SYNC_KEY;

function readAll(): Record<string, boolean> {
  const cached = getLegacySubMapCache();
  if (cached) return cached;
  const fromStorage = readLegacyBooleanMap(STORAGE_KEY);
  setLegacySubMapCache(fromStorage, true);
  return fromStorage;
}

/**
 * The cached map merged with a fresh `localStorage` read when running without
 * an IStorage host, or the hydrated IStorage-backed cache directly once
 * hydrated (so stale localStorage never overrides IStorage verdicts).
 */
function mergedWithFreshStorage(): Record<string, boolean> {
  if (isFeedStateHydrated()) {
    return { ...(getLegacySubMapCache() ?? {}) };
  }
  return { ...readAll(), ...readLegacyBooleanMap(STORAGE_KEY) };
}

function writeAll(next: Record<string, boolean>, explicitKeys?: ReadonlyArray<string>): boolean {
  setLegacySubMapCache(next, false, explicitKeys);
  const localPersisted = writeLocalStorageJson(STORAGE_KEY, next);
  if (isFeedStateHydrated()) {
    schedulePersistSubscriptionsToStorage();
    return true;
  }
  return localPersisted;
}

/**
 * Core is always subscribed; an absent record means not (yet) subscribed.
 * A pre-feed-unit record — one entry per notebook — still counts: those
 * entries fold onto the feed that publishes the notebook, which is what a
 * subscription means now (an explicit feed record always wins).
 */
export type FeedSubscriptionMode = 'full' | 'partial' | 'unsubscribed';

export function getFeedSubscriptionMode(id: string): FeedSubscriptionMode {
  const canonicalId = feedIdForLegacyId(id);
  if (canonicalId === 'core') return 'full';
  const all = readAll();
  if (all[canonicalId] === true || all[id] === true) return 'full';
  const prefix = `${canonicalId}#`;
  const legacyPrefix = `${id}#`;
  const hasPartial = Object.entries(all).some(
    ([key, val]) => val === true && (key.startsWith(prefix) || key.startsWith(legacyPrefix)),
  );
  if (hasPartial) return 'partial';
  return 'unsubscribed';
}

export function isFeedSubscribed(id: string): boolean {
  if (id === 'core') return true;
  return getFeedSubscriptionMode(id) !== 'unsubscribed';
}

/** Persist an explicit subscription choice (core ignores unsubscribe).
 *  Writes the feed record and drops the folded notebook records it
 *  supersedes, so one source never holds two verdicts. Returns false when
 *  the choice could NOT be persisted (browser storage unavailable) — it
 *  then lasts this session only, and callers must say so instead of
 *  implying a durable subscription. */
export function setFeedSubscribed(id: string, subscribed: boolean): boolean {
  if (id === 'core') return true;
  const all: Record<string, boolean> = {};
  const prefix = `${id}#`;
  for (const [key, value] of Object.entries(mergedWithFreshStorage())) {
    if (key.startsWith(prefix)) continue;
    if (NOTEBOOKS.some((notebook) => notebook.feedId === id && notebook.id === key)) continue;
    all[key] = value;
  }
  all[id] = subscribed;
  return writeAll(all, [id]);
}

/** Check whether a specific notebook is subscribed (explicitly or via owning feed). */
export function isNotebookSubscribed(feedId: string, notebookId: string): boolean {
  const canonicalId = feedIdForLegacyId(feedId);
  if (canonicalId === 'core') return true;
  const all = readAll();
  const specificKey = `${canonicalId}#${notebookId}`;
  if (specificKey in all) return all[specificKey] === true;
  const legacyKey = `${feedId}#${notebookId}`;
  if (legacyKey in all) return all[legacyKey] === true;
  return all[canonicalId] === true || all[feedId] === true;
}

/** Subscribe or unsubscribe an individual notebook from a feed. */
export function setNotebookSubscribed(
  feedId: string,
  notebookId: string,
  subscribed: boolean,
  knownChunkIds?: readonly string[],
): boolean {
  if (feedId === 'core') return true;
  const all = { ...mergedWithFreshStorage() };
  const specificKey = `${feedId}#${notebookId}`;
  const prefix = `${feedId}#`;

  const siblings = knownChunkIds ?? NOTEBOOKS.filter((n) => n.feedId === feedId).map((n) => n.chunkId);

  // If feed was full and unsubscribing this chunk: expand full feed into explicit siblings
  if (all[feedId] === true && !subscribed) {
    all[feedId] = false;
    for (const sib of siblings) {
      if (sib !== notebookId) {
        all[`${feedId}#${sib}`] = true;
      }
    }
    all[specificKey] = false;
    return writeAll(all, [feedId, specificKey, ...siblings.filter((s) => s !== notebookId).map((s) => `${feedId}#${s}`)]);
  }

  all[specificKey] = subscribed;

  // If subscribing and all known chunks are now subscribed, fold back into full feed
  if (subscribed && siblings.length > 0 && siblings.every((sib) => sib === notebookId || all[`${feedId}#${sib}`] === true)) {
    all[feedId] = true;
    for (const key of Object.keys(all)) {
      if (key.startsWith(prefix)) delete all[key];
    }
    return writeAll(all, [feedId]);
  } else if (!subscribed && siblings.length > 0 && siblings.every((sib) => all[`${feedId}#${sib}`] === false)) {
    all[feedId] = false;
    return writeAll(all, [feedId, specificKey]);
  }

  return writeAll(all, [specificKey]);
}

/** Returns the explicit notebook ids subscribed for a feed, or null if the whole feed is subscribed, or [] if unsubscribed. */
export function getSubscribedNotebooks(feedId: string): string[] | null {
  const canonicalId = feedIdForLegacyId(feedId);
  const mode = getFeedSubscriptionMode(canonicalId);
  if (mode === 'full') return null;
  if (mode === 'unsubscribed') return [];
  const all = readAll();
  const prefix = `${canonicalId}#`;
  const legacyPrefix = `${feedId}#`;
  return Object.entries(all)
    .filter(([key, val]) => val === true && (key.startsWith(prefix) || key.startsWith(legacyPrefix)))
    .map(([key]) => (key.startsWith(prefix) ? key.slice(prefix.length) : key.slice(legacyPrefix.length)));
}

export function subscribeFeedSubscriptions(listener: () => void): () => void {
  return subscribeFeedRegistryListeners(listener);
}

function readAutoSyncAll(): Record<string, boolean> {
  const cached = getAutoSyncCache();
  if (cached) return cached;
  const fromStorage = readLegacyBooleanMap(AUTO_SYNC_KEY);
  setAutoSyncCache(fromStorage, true);
  return fromStorage;
}

/**
 * Per-source auto-sync preference, persisted separately from subscription.
 * Default: core on (it is the app's own first-paint feed), every other
 * source off — subscribing never implies auto-updating.
 */
export function isFeedAutoSync(id: string): boolean {
  const all = readAutoSyncAll();
  return id in all ? all[id] === true : id === 'core';
}

/** Persist the auto-sync choice. Returns false when it could NOT be
 *  persisted (browser storage unavailable) — session-only then. */
export function setFeedAutoSync(id: string, enabled: boolean): boolean {
  const all = { ...readAutoSyncAll(), [id]: enabled };
  setAutoSyncCache(all);
  const localPersisted = writeLocalStorageJson(AUTO_SYNC_KEY, all);
  if (isFeedStateHydrated()) {
    schedulePersistSubscriptionsToStorage();
    return true;
  }
  return localPersisted;
}

/**
 * Effective offline caching policy for a feed:
 * - `core` is always `'offline-full'`
 * - All other feeds default to `'index-only'` unless set to `'offline-full'`
 */
export function getFeedOfflinePolicy(id: string): FeedOfflinePolicy {
  const canonicalId = feedIdForLegacyId(id);
  if (canonicalId === 'core') return 'offline-full';
  const map = getOfflinePolicyCache();
  if (map) {
    if (map[canonicalId]) return map[canonicalId]!;
    if (map[id]) return map[id]!;
  }
  const entries = getSubsEntriesCache();
  if (entries) {
    const entry = entries[canonicalId] ?? entries[id];
    if (entry?.offlinePolicy) return entry.offlinePolicy;
  }
  return 'index-only';
}

/** Persist the per-feed offline caching policy (`core` stays `'offline-full'`). */
export function setFeedOfflinePolicy(id: string, policy: FeedOfflinePolicy): boolean {
  const canonicalId = feedIdForLegacyId(id);
  const effective: FeedOfflinePolicy = canonicalId === 'core' ? 'offline-full' : policy;
  const prev = getOfflinePolicyCache() ?? {};
  setOfflinePolicyCache({ ...prev, [id]: effective });
  if (isFeedStateHydrated()) {
    schedulePersistSubscriptionsToStorage();
  }
  return true;
}

/**
 * Migration: hydrate IStorage feed state (migrating legacy localStorage once),
 * then subscribe any registered library with an imported checkpoint when the
 * user never made an explicit choice. Persisted on/off entries always win.
 */
export async function migrateFeedSubscriptions(
  sources: ReadonlyArray<{ id: string }>,
  storage: FeedImportStorage = mainThreadFeedImportStorage(),
): Promise<string[]> {
  if (storage.storageInstance && !isFeedStateHydrated()) {
    await hydrateFeedStateFromStorage(storage.storageInstance);
  }
  const initialAll = { ...mergedWithFreshStorage() };
  const migrated: string[] = [];
  let renamedLegacyKeys = false;
  // Pre-rename builds keyed per-notebook verdicts by the old chunk-id
  // spelling (`<feedId>#collection.<slug>` / `<feedId>#feed.<slug>`).
  // Rewrite them to the current `notebook.<slug>` key, preserving the
  // value; an explicit current-key verdict always wins, and the rewrite
  // is idempotent (the legacy key is deleted once read).
  for (const [oldId, newId] of Object.entries(LEGACY_FEED_ID_MAP)) {
    if (oldId in initialAll) {
      if (!(newId in initialAll)) {
        initialAll[newId] = initialAll[oldId]!;
        if (initialAll[oldId]) migrated.push(newId);
      }
      delete initialAll[oldId];
      renamedLegacyKeys = true;
    }
  }
  for (const notebook of NOTEBOOKS) {
    const slug = notebook.chunkId.replace(/^notebook\./, '');
    const currentKey = `${notebook.feedId}#${notebook.chunkId}`;
    const feedIds = [notebook.feedId];
    for (const [oldId, newId] of Object.entries(LEGACY_FEED_ID_MAP)) {
      if (newId === notebook.feedId) feedIds.push(oldId);
    }
    for (const fid of feedIds) {
      for (const legacyId of [`collection.${slug}`, `feed.${slug}`, notebook.chunkId]) {
        const legacyKey = `${fid}#${legacyId}`;
        if (legacyKey === currentKey || !(legacyKey in initialAll)) continue;
        if (!(currentKey in initialAll)) initialAll[currentKey] = initialAll[legacyKey]!;
        delete initialAll[legacyKey];
        renamedLegacyKeys = true;
      }
    }
  }
  // Pre-feed-unit builds subscribed per notebook and never wrote a feed
  // record; the notebook verdicts they left behind become the feed's.
  for (const notebook of NOTEBOOKS) {
    if (!(notebook.id in initialAll)) continue;
    if (!(notebook.feedId in initialAll)) {
      initialAll[notebook.feedId] = initialAll[notebook.id];
      if (initialAll[notebook.id]) migrated.push(notebook.feedId);
    }
    delete initialAll[notebook.id];
    renamedLegacyKeys = true;
  }
  if (renamedLegacyKeys) {
    writeAll(initialAll);
  }
  const checkpointIds: string[] = [];
  let metaByKey: Map<string, { seedVersion?: number }> | null = null;
  if (storage.getAllMeta) {
    try {
      const allMeta = await storage.getAllMeta();
      metaByKey = new Map();
      for (const row of allMeta) {
        if (row && typeof row === 'object' && 'key' in row && typeof (row as { key?: unknown }).key === 'string') {
          metaByKey.set((row as { key: string }).key, row as { seedVersion?: number });
        }
      }
    } catch {
      metaByKey = null;
    }
  }
  for (const { id } of sources) {
    if (id === 'core' || id in initialAll) continue;
    try {
      const meta = metaByKey ? metaByKey.get(seedMetaKey(id)) : await storage.getSeedMeta(seedMetaKey(id));
      if (meta && (meta.seedVersion ?? 0) > 0) {
        checkpointIds.push(id);
      }
    } catch {
      // Unreadable provider: nothing to migrate for this source.
    }
  }
  // Re-read the latest hydrated subscription state after async checkpoint
  // probes so concurrent subscribe toggles made during awaits are never clobbered.
  let addedFromCheckpoints = false;
  if (checkpointIds.length > 0) {
    const latest = { ...mergedWithFreshStorage() };
    for (const id of checkpointIds) {
      if (id in latest) continue;
      latest[id] = true;
      migrated.push(id);
      addedFromCheckpoints = true;
    }
    if (addedFromCheckpoints) {
      writeAll(latest);
    }
  }
  if (addedFromCheckpoints || renamedLegacyKeys) {
    await flushFeedStatePersistence();
  }
  return migrated;
}

/** Test-only: drop the cached maps and storage binding. */
export function resetFeedSubscriptionsForTest(): void {
  resetFeedRegistryStoreForTest();
}

// Cross-tab / external writers go through the `storage` event: when running
// unhydrated or notified by another tab, refresh caches from localStorage when
// appropriate and let subscribers re-render.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY && event.key !== AUTO_SYNC_KEY) return;
    if (!isFeedStateHydrated()) {
      invalidateLegacyCachesFromStorageEvent();
    }
  });
}
