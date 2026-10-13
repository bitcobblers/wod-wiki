/**
 * seedSubscriptions — community-feed subscription state (local-first
 * contract). Persisted in localStorage ('wodwiki.seedSubscriptions',
 * { [sourceId]: boolean }); absence means "no explicit choice":
 * migrateSeedSubscriptions() subscribes previously imported libraries, a
 * persisted false always stays off, and core is always on (unsubscribe is
 * a no-op for it). Kept free of seedSync imports so the runtime graph
 * stays acyclic — callers pass the source list in.
 */
import { IndexedDBSeedImportStorage, type SeedImportStorage } from './SeedImportStorage';
import { seedMetaKey } from '@/types/seed';

const STORAGE_KEY = 'wodwiki.seedSubscriptions';

let cache: Record<string, boolean> | null = null;
const listeners = new Set<() => void>();

function readAll(): Record<string, boolean> {
  if (cache) return cache;
  let parsed: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [id, subscribed] of Object.entries(value)) {
        if (typeof subscribed === 'boolean') parsed[id] = subscribed;
      }
    }
  } catch {
    parsed = {};
  }
  cache = parsed;
  return parsed;
}

function writeAll(next: Record<string, boolean>): boolean {
  cache = next;
  let persisted = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): in-memory only for this session.
    persisted = false;
  }
  for (const listener of listeners) listener();
  return persisted;
}

/** Core is always subscribed; an absent record means not (yet) subscribed. */
export function isSeedSubscribed(id: string): boolean {
  if (id === 'core') return true;
  return readAll()[id] === true;
}

/** Persist an explicit subscription choice (core ignores unsubscribe).
 *  Returns false when the choice could NOT be persisted (browser storage
 *  unavailable) — it then lasts this session only, and callers must say
 *  so instead of implying a durable subscription. */
export function setSeedSubscribed(id: string, subscribed: boolean): boolean {
  if (id === 'core') return true;
  const all = { ...readAll() };
  all[id] = subscribed;
  return writeAll(all);
}

export function subscribeSeedSubscriptions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Migration: a registered library with an imported checkpoint becomes
 * subscribed when the user never made an explicit choice. Persisted
 * on/off entries always win. Returns the migrated source ids.
 */
export async function migrateSeedSubscriptions(
  sources: ReadonlyArray<{ id: string }>,
  storage: SeedImportStorage = new IndexedDBSeedImportStorage(),
): Promise<string[]> {
  const all = { ...readAll() };
  const migrated: string[] = [];
  for (const { id } of sources) {
    if (id === 'core' || id in all) continue;
    try {
      const meta = await storage.getSeedMeta(seedMetaKey(id));
      if (meta && meta.seedVersion > 0) {
        all[id] = true;
        migrated.push(id);
      }
    } catch {
      // Unreadable provider: nothing to migrate for this source.
    }
  }
  if (migrated.length) writeAll(all);
  return migrated;
}

/** Test-only: drop the cached subscription map (tests mutate localStorage). */
export function resetSeedSubscriptionsForTest(): void {
  cache = null;
}
