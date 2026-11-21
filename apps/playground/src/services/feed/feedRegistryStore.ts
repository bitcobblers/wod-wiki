/**
 * feedRegistryStore — unified IStorage-backed feed registry, subscriptions,
 * offline policy, auto-sync, and check-timestamp store with synchronous
 * in-memory cache + listener notifications for React `useSyncExternalStore`,
 * plus one-time non-destructive migration from legacy localStorage keys.
 */
import {
  FEED_REGISTRY_META_KEY,
  FEED_SUBSCRIPTIONS_META_KEY,
  type FeedOfflinePolicy,
  type FeedRegistryMetaRecord,
  type FeedSubscriptionEntry,
  type FeedSubscriptionsMetaRecord,
  type RegisteredCustomFeedEntry,
} from '@bitcobblers/wod-wiki-engine';
import type { IStorage } from '@/services/storage/IStorage';

export const LEGACY_CUSTOM_FEEDS_KEY = 'wodwiki.seedSources';
export const LEGACY_HIDDEN_FEEDS_KEY = 'wodwiki.seedSources.hidden';
export const LEGACY_SUBSCRIPTIONS_KEY = 'wodwiki.seedSubscriptions';
export const LEGACY_AUTO_SYNC_KEY = 'wodwiki.seedAutoSync';
export const LEGACY_CHECKS_KEY = 'wodwiki.seedChecks';

export const LEGACY_FEED_ID_MAP_FOR_MIGRATION: Record<string, string> = {
  'seed-crossfit': 'sport-crossfit',
  'seed-hyrox': 'sport-hyrox',
  'seed-kettlebell': 'legends-of-kettlebell',
  'seed-swimming': 'sport-swimming',
  'seed-track': 'sport-track',
  'seed-zombie-fit': 'wayback-zombie-fit',
  'seed-golos-method': 'sport-golos-method',
  'example-movement': 'samples-movement',
  'example-yoga': 'sport-yoga',
};

const listeners = new Set<() => void>();

let boundStorage: IStorage | null = null;
let hydratedForStorage: IStorage | null = null;
let hydrateInFlight: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();

// In-memory state mirrors IStorage meta when hydrated, or localStorage when
// unhydrated (unit tests / synchronous pre-boot reads).
let customFeedsCache: RegisteredCustomFeedEntry[] | null = null;
let hiddenFeedIdsCache: string[] | null = null;
let subsEntriesCache: Record<string, FeedSubscriptionEntry> | null = null;
let legacySubMapCache: Record<string, boolean> | null = null;
let autoSyncCache: Record<string, boolean> | null = null;
let offlinePolicyCache: Record<string, FeedOfflinePolicy> | null = null;
let checksCache: Record<string, number> | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeFeedRegistryListeners(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isFeedStateHydrated(): boolean {
  return hydratedForStorage !== null;
}

export function getBoundFeedStorage(): IStorage | null {
  return boundStorage;
}

function readLocalStorageJson<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeLocalStorageJson(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readLegacyBooleanMap(key: string): Record<string, boolean> {
  const parsed = readLocalStorageJson<unknown>(key);
  const out: Record<string, boolean> = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

export function readLegacyNumberMap(key: string): Record<string, number> {
  const parsed = readLocalStorageJson<unknown>(key);
  const out: Record<string, number> = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

export function readLegacyCustomFeeds(): RegisteredCustomFeedEntry[] {
  const parsed = readLocalStorageJson<unknown>(LEGACY_CUSTOM_FEEDS_KEY);
  if (!Array.isArray(parsed)) return [];
  const out: RegisteredCustomFeedEntry[] = [];
  for (const item of parsed) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as RegisteredCustomFeedEntry).id !== 'string' ||
      typeof (item as RegisteredCustomFeedEntry).label !== 'string' ||
      typeof (item as RegisteredCustomFeedEntry).url !== 'string'
    ) {
      continue;
    }
    const rec = item as RegisteredCustomFeedEntry;
    out.push({
      id: rec.id,
      label: rec.label,
      url: rec.url,
      ...(typeof rec.repositoryUrl === 'string' ? { repositoryUrl: rec.repositoryUrl } : {}),
    });
  }
  return out;
}

export function readLegacyHiddenIds(): string[] {
  const parsed = readLocalStorageJson<unknown>(LEGACY_HIDDEN_FEEDS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string');
}

function entriesToLegacyBooleanMap(entries: Record<string, FeedSubscriptionEntry>): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const [feedId, entry] of Object.entries(entries)) {
    const overrides = (entry as FeedSubscriptionEntry & { notebookOverrides?: Record<string, boolean> }).notebookOverrides;
    if (entry.notebookIds && entry.notebookIds.length > 0) {
      map[feedId] = false;
      for (const nb of entry.notebookIds) {
        map[`${feedId}#${nb}`] = true;
      }
    } else if (entry.subscribed) {
      map[feedId] = true;
    } else if (!overrides) {
      map[feedId] = false;
    }
    if (overrides) {
      for (const [nb, flag] of Object.entries(overrides)) {
        map[`${feedId}#${nb}`] = flag;
      }
    }
  }
  return map;
}

function foldLegacyBooleanMapIntoEntries(
  legacyMap: Record<string, boolean>,
  existingEntries: Record<string, FeedSubscriptionEntry>,
  autoSyncMap: Record<string, boolean>,
  checksMap: Record<string, number>,
  now: number,
): Record<string, FeedSubscriptionEntry> {
  const entries: Record<string, FeedSubscriptionEntry> = {};
  for (const [id, entry] of Object.entries(existingEntries)) {
    entries[id] = { ...entry };
  }

  // Group legacy keys by feedId
  const fullFlags = new Map<string, boolean>();
  const partialByFeed = new Map<string, Record<string, boolean>>();

  for (const [rawKey, val] of Object.entries(legacyMap)) {
    const hashIdx = rawKey.indexOf('#');
    if (hashIdx > 0) {
      const rawFeed = rawKey.slice(0, hashIdx);
      const feedId = LEGACY_FEED_ID_MAP_FOR_MIGRATION[rawFeed] ?? rawFeed;
      const chunkRaw = rawKey.slice(hashIdx + 1);
      const chunkId = chunkRaw
        .replace(/^collection\./, 'notebook.')
        .replace(/^feed\./, 'notebook.');
      const group = partialByFeed.get(feedId) ?? {};
      if (!(chunkId in group) || chunkRaw.startsWith('notebook.')) {
        group[chunkId] = val;
      }
      partialByFeed.set(feedId, group);
    } else {
      const feedId = LEGACY_FEED_ID_MAP_FOR_MIGRATION[rawKey] ?? rawKey;
      if (!fullFlags.has(feedId) || rawKey === feedId) {
        fullFlags.set(feedId, val);
      }
    }
  }

  const allFeedIds = new Set<string>([
    ...Object.keys(entries),
    ...fullFlags.keys(),
    ...partialByFeed.keys(),
    ...Object.keys(autoSyncMap),
  ]);

  for (const feedId of allFeedIds) {
    const prev = entries[feedId];
    if (prev) {
      // Preserve explicit IStorage verdict; only backfill missing autoSync/checkedAt
      if (prev.autoSync === undefined && feedId in autoSyncMap) {
        prev.autoSync = autoSyncMap[feedId];
      }
      if (prev.checkedAt === undefined && feedId in checksMap) {
        prev.checkedAt = checksMap[feedId];
      }
      continue;
    }

    const partial = partialByFeed.get(feedId);
    const full = fullFlags.get(feedId);
    const trueChunks = partial
      ? Object.entries(partial)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
      : [];
    const hasPartialTrue = trueChunks.length > 0;
    const subscribed = full === true || hasPartialTrue;
    const notebookIds = full === true ? null : hasPartialTrue ? trueChunks : undefined;

    if (full !== undefined || partial !== undefined) {
      const entry: FeedSubscriptionEntry & { notebookOverrides?: Record<string, boolean> } = {
        subscribed,
        ...(notebookIds !== undefined ? { notebookIds } : {}),
        ...(feedId in autoSyncMap ? { autoSync: autoSyncMap[feedId] } : {}),
        ...(feedId in checksMap ? { checkedAt: checksMap[feedId] } : {}),
        updatedAt: now,
      };
      if (partial && Object.values(partial).some((v) => v === false)) {
        entry.notebookOverrides = { ...partial };
      }
      entries[feedId] = entry;
    } else if (feedId in autoSyncMap) {
      entries[feedId] = {
        subscribed: false,
        autoSync: autoSyncMap[feedId],
        ...(feedId in checksMap ? { checkedAt: checksMap[feedId] } : {}),
        updatedAt: now,
      };
    }
  }

  return entries;
}

export function buildEntriesFromCaches(now = Date.now()): Record<string, FeedSubscriptionEntry> {
  const prevEntries = subsEntriesCache ?? {};
  const subMap = legacySubMapCache ?? readLegacyBooleanMap(LEGACY_SUBSCRIPTIONS_KEY);
  const autoMap = autoSyncCache ?? readLegacyBooleanMap(LEGACY_AUTO_SYNC_KEY);
  const policyMap = offlinePolicyCache ?? {};
  const checksMap = checksCache ?? readLegacyNumberMap(LEGACY_CHECKS_KEY);

  const next: Record<string, FeedSubscriptionEntry> = {};
  const allIds = new Set<string>([
    ...Object.keys(prevEntries),
    ...Object.keys(autoMap),
    ...Object.keys(policyMap),
  ]);
  for (const key of Object.keys(subMap)) {
    const hashIdx = key.indexOf('#');
    allIds.add(hashIdx > 0 ? key.slice(0, hashIdx) : key);
  }

  for (const feedId of allIds) {
    const prev = prevEntries[feedId];
    const full = subMap[feedId];
    const prefix = `${feedId}#`;
    const overrides: Record<string, boolean> = {};
    const trueChunks: string[] = [];
    for (const [k, v] of Object.entries(subMap)) {
      if (k.startsWith(prefix)) {
        const chunk = k.slice(prefix.length);
        overrides[chunk] = v;
        if (v) trueChunks.push(chunk);
      }
    }
    const hasPartial = trueChunks.length > 0;
    const subscribed = full === true || hasPartial;
    const notebookIds =
      full === true ? null : hasPartial ? trueChunks : full === false ? [] : prev?.notebookIds;
    const offlinePolicy =
      policyMap[feedId] ?? prev?.offlinePolicy ?? (feedId === 'core' ? 'offline-full' : undefined);
    const autoSync = feedId in autoMap ? autoMap[feedId] : prev?.autoSync;
    const checkedAt = feedId in checksMap ? checksMap[feedId] : prev?.checkedAt;

    const entry: FeedSubscriptionEntry & { notebookOverrides?: Record<string, boolean> } = {
      ...(prev ?? {}),
      subscribed,
      ...(notebookIds !== undefined ? { notebookIds } : {}),
      ...(offlinePolicy !== undefined ? { offlinePolicy } : {}),
      ...(autoSync !== undefined ? { autoSync } : {}),
      ...(checkedAt !== undefined ? { checkedAt } : {}),
      updatedAt: prev?.updatedAt ?? now,
    };
    if (Object.keys(overrides).length > 0) {
      entry.notebookOverrides = overrides;
    } else {
      delete (entry as { notebookOverrides?: unknown }).notebookOverrides;
    }
    next[feedId] = entry;
  }

  return next;
}

function enqueuePersist(fn: () => Promise<void>): void {
  persistChain = persistChain.then(fn, fn).catch(() => {
    // Best-effort async persistence when invoked from synchronous React setters;
    // async callers await flushFeedStatePersistence() and handle errors directly.
  });
}

export async function flushFeedStatePersistence(): Promise<void> {
  await persistChain;
}

export function schedulePersistSubscriptionsToStorage(): void {
  const target = boundStorage;
  if (!target) return;
  const entries = buildEntriesFromCaches();
  subsEntriesCache = entries;
  const checks = { ...(checksCache ?? {}) };
  enqueuePersist(async () => {
    await target.transaction(['meta'], 'readwrite', async (tx) => {
      const store = tx.readwrite('meta');
      const existing = (await store.get(FEED_SUBSCRIPTIONS_META_KEY)) as
        | (FeedSubscriptionsMetaRecord & { checks?: Record<string, number> })
        | undefined;
      const mergedChecks = { ...(existing?.checks ?? {}), ...checks };
      await store.put({
        key: FEED_SUBSCRIPTIONS_META_KEY,
        entries,
        checks: mergedChecks,
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
    });
  });
}

export function schedulePersistRegistryToStorage(): void {
  const target = boundStorage;
  if (!target) return;
  const customFeeds = [...(customFeedsCache ?? [])];
  const hiddenFeedIds = [...(hiddenFeedIdsCache ?? [])];
  const now = Date.now();
  enqueuePersist(async () => {
    await target.transaction(['meta'], 'readwrite', async (tx) => {
      await tx.readwrite('meta').put({
        key: FEED_REGISTRY_META_KEY,
        customFeeds,
        hiddenFeedIds,
        updatedAt: now,
        migratedFromLocalStorage: true,
      } as unknown as Record<string, unknown>);
    });
  });
}

/**
 * Hydrate in-memory registry & subscription caches from `IStorage` `meta`
 * (`feed:registry` and `feed:subscriptions`), performing a one-time
 * non-destructive migration from legacy `localStorage` keys if present.
 */
export async function hydrateFeedStateFromStorage(storage: IStorage): Promise<void> {
  if (hydrateInFlight && boundStorage === storage) {
    await hydrateInFlight;
    return;
  }
  await persistChain;

  const run = (async () => {
    const now = Date.now();
    const [rawRegistry, rawSubs] = await Promise.all([
      storage.readonly('meta').get(FEED_REGISTRY_META_KEY) as Promise<FeedRegistryMetaRecord | undefined>,
      storage.readonly('meta').get(FEED_SUBSCRIPTIONS_META_KEY) as Promise<
        (FeedSubscriptionsMetaRecord & { checks?: Record<string, number> }) | undefined
      >,
    ]);

    let customFeeds: RegisteredCustomFeedEntry[] = Array.isArray(rawRegistry?.customFeeds)
      ? [...rawRegistry.customFeeds]
      : [];
    let hiddenFeedIds: string[] = Array.isArray(rawRegistry?.hiddenFeedIds)
      ? [...rawRegistry.hiddenFeedIds]
      : [];
    const registryMigrated = Boolean(rawRegistry?.migratedFromLocalStorage);

    let entries: Record<string, FeedSubscriptionEntry> = { ...(rawSubs?.entries ?? {}) };
    const checks: Record<string, number> = { ...(rawSubs?.checks ?? {}) };
    const subsMigrated = Boolean(rawSubs?.migratedFromLocalStorage);

    let needsWriteRegistry = false;
    let needsWriteSubs = false;

    if (!registryMigrated) {
      const legacyCustom = readLegacyCustomFeeds();
      const legacyHidden = readLegacyHiddenIds();
      for (const c of legacyCustom) {
        if (!customFeeds.some((x) => x.id === c.id || x.url === c.url)) {
          customFeeds.push(c);
        }
      }
      for (const h of legacyHidden) {
        const mapped = LEGACY_FEED_ID_MAP_FOR_MIGRATION[h] ?? h;
        if (!hiddenFeedIds.includes(mapped)) hiddenFeedIds.push(mapped);
      }
      needsWriteRegistry = true;
    }

    if (!subsMigrated) {
      const legacySubs = readLegacyBooleanMap(LEGACY_SUBSCRIPTIONS_KEY);
      const legacyAuto = readLegacyBooleanMap(LEGACY_AUTO_SYNC_KEY);
      const legacyChecks = readLegacyNumberMap(LEGACY_CHECKS_KEY);
      for (const [id, at] of Object.entries(legacyChecks)) {
        if (!(id in checks)) checks[id] = at;
      }
      entries = foldLegacyBooleanMapIntoEntries(legacySubs, entries, legacyAuto, checks, now);
      needsWriteSubs = true;
    }

    if (needsWriteRegistry || needsWriteSubs) {
      await storage.transaction(['meta'], 'readwrite', async (tx) => {
        const metaStore = tx.readwrite('meta');
        if (needsWriteRegistry) {
          await metaStore.put({
            key: FEED_REGISTRY_META_KEY,
            customFeeds,
            hiddenFeedIds,
            updatedAt: now,
            migratedFromLocalStorage: true,
          } as unknown as Record<string, unknown>);
        }
        if (needsWriteSubs) {
          await metaStore.put({
            key: FEED_SUBSCRIPTIONS_META_KEY,
            entries,
            checks,
            migratedFromLocalStorage: true,
          } as unknown as Record<string, unknown>);
        }
      });
    }

    customFeedsCache = customFeeds;
    hiddenFeedIdsCache = hiddenFeedIds;
    subsEntriesCache = entries;
    legacySubMapCache = entriesToLegacyBooleanMap(entries);

    const nextAuto: Record<string, boolean> = {};
    const nextPolicies: Record<string, FeedOfflinePolicy> = {};
    const nextChecks: Record<string, number> = { ...checks };
    for (const [feedId, entry] of Object.entries(entries)) {
      if (typeof entry.autoSync === 'boolean') nextAuto[feedId] = entry.autoSync;
      if (entry.offlinePolicy) nextPolicies[feedId] = entry.offlinePolicy;
      if (typeof entry.checkedAt === 'number') nextChecks[feedId] = entry.checkedAt;
      if (entry.hidden && !hiddenFeedIds.includes(feedId) && !customFeeds.some((c) => c.id === feedId)) {
        // Respect headless delete hidden marker
        hiddenFeedIds.push(feedId);
      }
    }
    autoSyncCache = nextAuto;
    offlinePolicyCache = nextPolicies;
    checksCache = nextChecks;

    boundStorage = storage;
    hydratedForStorage = storage;
    notify();
  })();

  hydrateInFlight = run;
  try {
    await run;
  } finally {
    if (hydrateInFlight === run) hydrateInFlight = null;
  }
}

export function getCustomFeedsCache(): RegisteredCustomFeedEntry[] | null {
  return customFeedsCache;
}

export function setCustomFeedsCache(next: RegisteredCustomFeedEntry[] | null): void {
  customFeedsCache = next;
  notify();
}

export function getHiddenFeedIdsCache(): string[] | null {
  return hiddenFeedIdsCache;
}

export function setHiddenFeedIdsCache(next: string[] | null): void {
  hiddenFeedIdsCache = next;
  notify();
}

export function getSubsEntriesCache(): Record<string, FeedSubscriptionEntry> | null {
  return subsEntriesCache;
}

export function setSubsEntriesCache(next: Record<string, FeedSubscriptionEntry> | null): void {
  subsEntriesCache = next;
}

export function getLegacySubMapCache(): Record<string, boolean> | null {
  return legacySubMapCache;
}

export function setLegacySubMapCache(next: Record<string, boolean> | null, silent = false): void {
  legacySubMapCache = next;
  if (!silent) notify();
}

export function getAutoSyncCache(): Record<string, boolean> | null {
  return autoSyncCache;
}

export function setAutoSyncCache(next: Record<string, boolean> | null, silent = false): void {
  autoSyncCache = next;
  if (!silent) notify();
}

export function getOfflinePolicyCache(): Record<string, FeedOfflinePolicy> | null {
  return offlinePolicyCache;
}

export function setOfflinePolicyCache(next: Record<string, FeedOfflinePolicy> | null): void {
  offlinePolicyCache = next;
  notify();
}

export function getChecksCache(): Record<string, number> | null {
  return checksCache;
}

export function setChecksCache(next: Record<string, number> | null): void {
  checksCache = next;
}

export function markFeedCheckedInStore(id: string, at: number): void {
  const prev = checksCache ?? readLegacyNumberMap(LEGACY_CHECKS_KEY);
  const next = { ...prev, [id]: at };
  checksCache = next;
  if (subsEntriesCache?.[id]) {
    subsEntriesCache[id] = { ...subsEntriesCache[id]!, checkedAt: at };
  }
  writeLocalStorageJson(LEGACY_CHECKS_KEY, next);
  schedulePersistSubscriptionsToStorage();
}

export function getFeedCheckedAtFromStore(id: string): number | null {
  if (checksCache && id in checksCache) return checksCache[id] ?? null;
  if (subsEntriesCache?.[id]?.checkedAt !== undefined) {
    return subsEntriesCache[id]!.checkedAt ?? null;
  }
  const map = readLegacyNumberMap(LEGACY_CHECKS_KEY);
  return map[id] ?? null;
}

export function invalidateLegacyCachesFromStorageEvent(): void {
  legacySubMapCache = null;
  autoSyncCache = null;
  notify();
}

export function resetFeedRegistryStoreForTest(): void {
  boundStorage = null;
  hydratedForStorage = null;
  hydrateInFlight = null;
  persistChain = Promise.resolve();
  customFeedsCache = null;
  hiddenFeedIdsCache = null;
  subsEntriesCache = null;
  legacySubMapCache = null;
  autoSyncCache = null;
  offlinePolicyCache = null;
  checksCache = null;
}
