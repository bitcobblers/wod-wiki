import {
  CompositeEquipmentRegistry,
  type EquipmentStorageAdapter,
  type IEquipment,
  type IEquipmentRegistry,
} from '@bitcobblers/wod-wiki-lang';
import { indexedDBEquipmentStorage } from './db/IndexedDBEquipmentStorage';
import { storageService } from '@/services/storage';

export { CompositeEquipmentRegistry, type EquipmentStorageAdapter, type IEquipment, type IEquipmentRegistry };

/**
 * The app equipment registry — BOTH tiers live in IndexedDB:
 *
 *   - bundled tier: rows the Seed Import materialized from the equipment
 *     chunk (`registrySource: 'bundled'`);
 *   - user tier: custom equipment persisted through the storage adapter
 *     (`registrySource: 'user'`).
 *
 * Hydration replaces the bundled tier on every call, so a source removal
 * that empties the bundled tier is visible immediately.
 */
export async function hydrateAppEquipmentRegistry(registry: CompositeEquipmentRegistry): Promise<void> {
  const all = await storageService.getAllEquipment();
  await registry.loadBundled(all.filter((equipment) => equipment.registrySource === 'bundled'));
  notifyEquipmentRegistry();
}

type EquipmentRegistryListener = () => void;
const equipmentRegistryListeners = new Set<EquipmentRegistryListener>();

/**
 * Subscribe to the equipment registry changing.
 *
 * The registry loads asynchronously; the editor draws its marks from it, so
 * a load has to reach the editor that is already on screen.
 */
export function subscribeAppEquipmentRegistry(listener: EquipmentRegistryListener): () => void {
  equipmentRegistryListeners.add(listener);
  return () => equipmentRegistryListeners.delete(listener);
}

function notifyEquipmentRegistry(): void {
  for (const listener of equipmentRegistryListeners) listener();
}

let appEquipmentRegistry: CompositeEquipmentRegistry | null = null;

/** App-wide singleton CompositeEquipmentRegistry instance. */
export function getAppEquipmentRegistry(): CompositeEquipmentRegistry {
  if (!appEquipmentRegistry) {
    appEquipmentRegistry = new CompositeEquipmentRegistry({
      storage: indexedDBEquipmentStorage,
    });
  }
  return appEquipmentRegistry;
}
