/**
 * activeDatabaseCaches — the caches derived from the local database's rows.
 *
 * After a database switch every one of them holds rows from the OLD
 * database: the seeded corpus, the WQL page sources, and the effort and
 * equipment registries. This module rehydrates them.
 *
 * It exists as its own module because each cache owner imports the storage
 * plane back: importing them from `services/storage/index.ts` would close a
 * module cycle (storage/index -> cache owner -> storage/index). Here the
 * dependency runs one way — caches to storage — so the graph stays acyclic.
 */
import { invalidateSeedContent } from '@/services/content/seedContent';
import { getAppEquipmentRegistry, hydrateAppEquipmentRegistry } from '@/services/equipmentRegistry';
import { getAppEffortRegistry, hydrateAppEffortRegistry } from '@/services/effortRegistry';
import { refreshPageSources } from '@/services/queryService';

/** Drop every cache derived from the previous database's rows and rebuild
 *  them from the database that is active now. */
export async function rehydrateActiveDatabaseCaches(): Promise<void> {
  invalidateSeedContent();
  await refreshPageSources();
  await hydrateAppEffortRegistry(getAppEffortRegistry());
  await hydrateAppEquipmentRegistry(getAppEquipmentRegistry());
}
