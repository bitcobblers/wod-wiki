import {
  resolveEntityRank,
  type EquipmentStorageAdapter,
  type IEquipment,
  type IEquipmentRegistry,
} from './types';
import { normalizeForFuzzy } from './fuzzyMatch';

export interface PropertyEntity {
  id: string;
  slug: string;
  label: string;
  aliases: string[];
  registrySource: 'bundled' | 'user' | 'synthetic-unresolved';
  sourceId?: string;
}

export interface PropertyStorageAdapter<T extends PropertyEntity> {
  load(): Promise<T[]>;
  save(entity: T): Promise<void>;
  delete(slug: string): Promise<void>;
}

/**
 * Generic two-tier Property Note registry (bundled seed tier + user custom tier).
 * User definitions layer over bundled definitions of the same slug; lookups
 * run in O(1) by slug and normalized alias.
 */
export class CompositePropertyRegistry<T extends PropertyEntity> {
  protected readonly userItems = new Map<string, T>();
  protected readonly bundledItems = new Map<string, T>();
  protected initialized = false;
  protected readonly initialBundled?: Iterable<T>;
  protected readonly storage?: PropertyStorageAdapter<T>;

  constructor(options?: { bundled?: Iterable<T>; storage?: PropertyStorageAdapter<T> }) {
    this.initialBundled = options?.bundled;
    this.storage = options?.storage;
  }

  async loadBundled(customBundled?: Iterable<T>): Promise<void> {
    const userRows = this.storage ? await this.storage.load() : [];
    this.bundledItems.clear();
    const source = customBundled ?? this.initialBundled;
    if (source) {
      for (const item of source) {
        const prior = this.bundledItems.get(item.slug);
        if (!prior || resolveEntityRank(item) >= resolveEntityRank(prior)) {
          this.bundledItems.set(item.slug, item);
        }
      }
    }
    this.userItems.clear();
    for (const item of userRows) {
      if (item.registrySource === 'user') {
        this.userItems.set(item.slug, item);
      }
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  resolve(slug: string): T | null {
    return this.userItems.get(slug) ?? this.bundledItems.get(slug) ?? null;
  }

  resolveByAlias(label: string): T | null {
    const normalized = normalizeForFuzzy(label);
    for (const item of this.userItems.values()) {
      if (normalizeForFuzzy(item.label) === normalized) return item;
      for (const alias of item.aliases) {
        if (normalizeForFuzzy(alias) === normalized) return item;
      }
    }
    const bundled = [...this.bundledItems.values()]
      .filter((item) => !this.userItems.has(item.slug))
      .sort((a, b) => resolveEntityRank(b) - resolveEntityRank(a));
    for (const item of bundled) {
      if (normalizeForFuzzy(item.label) === normalized) return item;
      for (const alias of item.aliases) {
        if (normalizeForFuzzy(alias) === normalized) return item;
      }
    }
    return null;
  }

  list(): readonly T[] {
    const merged = new Map<string, T>(this.bundledItems);
    for (const item of this.userItems.values()) merged.set(item.slug, item);
    return [...merged.values()];
  }

  listByOrigin(origin: 'bundled' | 'user'): readonly T[] {
    return origin === 'user' ? [...this.userItems.values()] : [...this.bundledItems.values()];
  }

  async upsert(item: T): Promise<void> {
    if (item.registrySource !== 'user') {
      throw new Error(`Cannot upsert property with registrySource '${item.registrySource}'; clone it as 'user' first`);
    }
    this.userItems.set(item.slug, item);
    if (this.storage) await this.storage.save(item);
  }

  async delete(slug: string): Promise<void> {
    const item = this.userItems.get(slug);
    if (!item) throw new Error(`Cannot delete '${slug}': not a user-owned record`);
    this.userItems.delete(slug);
    if (this.storage) await this.storage.delete(slug);
  }
}

export class CompositeEquipmentRegistry
  extends CompositePropertyRegistry<IEquipment>
  implements IEquipmentRegistry
{
  constructor(options?: { storage?: EquipmentStorageAdapter }) {
    super({ storage: options?.storage });
  }
}
