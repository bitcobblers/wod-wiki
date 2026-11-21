/**
 * playgroundFeedBootstrap — Pre-subscribed, auto-synced read-only default
 * sources for Playground (guides in `core` + sample data Feeds backing those
 * guides).
 *
 * Honors explicit user choices persisted in `wodwiki.seedSubscriptions` and
 * `wodwiki.seedAutoSync`: pre-subscription and auto-sync are seeded only when
 * no explicit boolean verdict has been recorded for that Feed ID yet.
 */

import {
  setFeedAutoSync,
  setFeedOfflinePolicy,
  setFeedSubscribed,
} from './feedSubscriptions';
import {
  getAutoSyncCache,
  getOfflinePolicyCache,
  getSubsEntriesCache,
} from './feedRegistryStore';

export const PLAYGROUND_DEFAULT_SAMPLE_FEED_IDS = [
  'samples-movement',
  'samples-results',
] as const;

const SUBSCRIPTIONS_STORAGE_KEY = 'wodwiki.seedSubscriptions';
const AUTO_SYNC_STORAGE_KEY = 'wodwiki.seedAutoSync';

function readPersistedKeys(storageKey: string): ReadonlySet<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
    return new Set(Object.keys(parsed as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

/**
 * Seed default Playground sample Feed subscriptions and auto-sync flags for any
 * pre-subscribed sample Feed present in `sources` that has no explicit user
 * verdict recorded yet.
 */
export function ensurePlaygroundDefaultSubscriptions(
  sources: ReadonlyArray<{ id: string }>,
): string[] {
  const available = new Set(sources.map((s) => s.id));
  const hydratedEntries = getSubsEntriesCache() ?? {};
  const persistedSubs = new Set([
    ...readPersistedKeys(SUBSCRIPTIONS_STORAGE_KEY),
    ...Object.keys(hydratedEntries),
  ]);
  const persistedAuto = new Set([
    ...readPersistedKeys(AUTO_SYNC_STORAGE_KEY),
    ...Object.keys(getAutoSyncCache() ?? {}),
    ...Object.entries(hydratedEntries)
      .filter(([, entry]) => entry.autoSync !== undefined)
      .map(([id]) => id),
  ]);
  const explicitPolicies = getOfflinePolicyCache() ?? {};
  const seeded: string[] = [];

  for (const id of PLAYGROUND_DEFAULT_SAMPLE_FEED_IDS) {
    if (!available.has(id)) continue;
    if (!persistedSubs.has(id)) {
      setFeedSubscribed(id, true);
      if (!explicitPolicies[id] && !hydratedEntries[id]?.offlinePolicy) {
        setFeedOfflinePolicy(id, 'offline-full');
      }
      seeded.push(id);
    }
    if (!persistedAuto.has(id)) {
      setFeedAutoSync(id, true);
    }
  }
  return seeded;
}
