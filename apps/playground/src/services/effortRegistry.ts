import { CompositeEffortRegistry } from '@bitcobblers/wod-wiki-lang';
import { storageService } from '@/services/storage';
import { indexedDBEffortStorage } from './db/IndexedDBEffortStorage';

/**
 * The app effort registry — BOTH tiers live in IndexedDB (docs/prototypes/
 * seed-data-unification.md):
 *
 *   - bundled tier: rows the Seed Import materialized from the efforts
 *     chunk (`registrySource: 'bundled'`);
 *   - user tier: clones/edits persisted through the storage adapter
 *     (`registrySource: 'user'`, `-custom` slugs).
 *
 * The typed projection store is the SINGLE read index for hydration: every
 * writer (seed import, app commit, CLI import, delete) puts a definition's
 * note and its projection rows in ONE transaction, so the projection is the
 * note index's typed form — never an independently maintained source.
 * Hydration reads only the projection; it never parses notes, and a note
 * whose projection is gone does not resurrect here.
 *
 * Hydration is async because the store read is; construct synchronously,
 * then `hydrateAppEffortRegistry` before declaring readiness.
 */
export function createAppEffortRegistry(): CompositeEffortRegistry {
  return new CompositeEffortRegistry({
    storage: indexedDBEffortStorage,
  });
}

/** Load both tiers from IndexedDB: seed rows feed the read-only tier.
 *  loadBundled REPLACES the bundled tier, so a source removal that empties
 *  it is visible immediately (no stale cached bundled efforts). */
export async function hydrateAppEffortRegistry(registry: CompositeEffortRegistry): Promise<void> {
  const all = await storageService.getAllEfforts();
  await registry.loadBundled(all.filter((effort) => effort.registrySource === 'bundled'));
  notifyEffortRegistry();
}

type EffortRegistryListener = () => void;
const effortRegistryListeners = new Set<EffortRegistryListener>();

/**
 * Subscribe to the effort registry changing.
 *
 * The registry loads asynchronously; the editor draws its marks from it, so
 * a load has to reach the editor that is already on screen.
 */
export function subscribeAppEffortRegistry(listener: EffortRegistryListener): () => void {
  effortRegistryListeners.add(listener);
  return () => effortRegistryListeners.delete(listener);
}

function notifyEffortRegistry(): void {
  for (const listener of effortRegistryListeners) listener();
}

let appEffortRegistry: CompositeEffortRegistry | null = null;

/**
 * App-wide singleton CompositeEffortRegistry instance.
 */
export function getAppEffortRegistry(): CompositeEffortRegistry {
  if (!appEffortRegistry) {
    appEffortRegistry = createAppEffortRegistry();
  }
  return appEffortRegistry;
}
