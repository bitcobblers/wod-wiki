import type { EquipmentStorageAdapter, IEquipment, IEquipmentRegistry } from '@bitcobblers/wod-wiki-lang';
import { normalizeForFuzzy, resolveEntityRank } from '@bitcobblers/wod-wiki-lang';
import { indexedDBEquipmentStorage } from './db/IndexedDBEquipmentStorage';
import { storageService } from '@/services/storage';

/**
 * Composite Equipment Registry — two-tier lookup mirroring
 * CompositeEffortRegistry: user rows win over bundled; lookups are O(1)
 * in-memory after initialization.
 *
 * Unlike the effort registry, `loadBundled` REPLACES the bundled tier with
 * the given rows (passing an empty array clears it) — a source removal must
 * never leave stale bundled equipment in the cache.
 */
export class CompositeEquipmentRegistry implements IEquipmentRegistry {
  private readonly userEquipment = new Map<string, IEquipment>();
  private readonly bundledEquipment = new Map<string, IEquipment>();
  private initialized = false;
  private readonly storage?: EquipmentStorageAdapter;

  constructor(options?: { storage?: EquipmentStorageAdapter }) {
    this.storage = options?.storage;
  }

  /**
   * Replace the bundled tier and reload the user tier from the storage
   * adapter. Both tiers are rebuilt only AFTER a successful adapter load —
   * a failed load propagates (readiness must never report over stale data)
   * and deleted custom rows disappear because the user map is cleared too.
   */
  async loadBundled(customBundled?: Iterable<IEquipment>): Promise<void> {
    const userRows = this.storage ? await this.storage.load() : [];
    this.bundledEquipment.clear();
    if (customBundled) {
      for (const equipment of customBundled) {
        const prior = this.bundledEquipment.get(equipment.slug);
        if (!prior || resolveEntityRank(equipment) >= resolveEntityRank(prior)) {
          this.bundledEquipment.set(equipment.slug, equipment);
        }
      }
    }
    this.userEquipment.clear();
    for (const equipment of userRows) {
      if (equipment.registrySource === 'user') {
        this.userEquipment.set(equipment.slug, equipment);
      }
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  resolve(slug: string): IEquipment | null {
    return this.userEquipment.get(slug) ?? this.bundledEquipment.get(slug) ?? null;
  }

  resolveByAlias(label: string): IEquipment | null {
    const normalized = normalizeForFuzzy(label);
    for (const equipment of this.userEquipment.values()) {
      if (normalizeForFuzzy(equipment.label) === normalized) return equipment;
      for (const alias of equipment.aliases) {
        if (normalizeForFuzzy(alias) === normalized) return equipment;
      }
    }
    const bundled = [...this.bundledEquipment.values()]
      .filter((equipment) => !this.userEquipment.has(equipment.slug))
      .sort((a, b) => resolveEntityRank(b) - resolveEntityRank(a));
    for (const equipment of bundled) {
      if (normalizeForFuzzy(equipment.label) === normalized) return equipment;
      for (const alias of equipment.aliases) {
        if (normalizeForFuzzy(alias) === normalized) return equipment;
      }
    }
    return null;
  }

  list(): readonly IEquipment[] {
    const merged = new Map<string, IEquipment>(this.bundledEquipment);
    for (const equipment of this.userEquipment.values()) merged.set(equipment.slug, equipment);
    return [...merged.values()];
  }

  listByOrigin(origin: 'bundled' | 'user'): readonly IEquipment[] {
    return origin === 'user' ? [...this.userEquipment.values()] : [...this.bundledEquipment.values()];
  }

  /** Persist one user equipment row (bundled rows are read-only seeds). */
  async upsert(equipment: IEquipment): Promise<void> {
    if (equipment.registrySource !== 'user') {
      throw new Error(`Cannot upsert equipment with registrySource '${equipment.registrySource}'; clone it as 'user' first`);
    }
    this.userEquipment.set(equipment.slug, equipment);
    if (this.storage) await this.storage.save(equipment);
  }

  /** Delete one user equipment row; bundled rows are refused. */
  async delete(slug: string): Promise<void> {
    const equipment = this.userEquipment.get(slug);
    if (!equipment) throw new Error(`Cannot delete equipment '${slug}': not a user-owned record`);
    this.userEquipment.delete(slug);
    if (this.storage) await this.storage.delete(slug);
  }
}

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
