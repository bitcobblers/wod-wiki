import type { IEffort, IEffortRegistry, EffortRegistrySource } from './types';
import { bundledEfforts } from './data/bundled-efforts';
import { normalizeForFuzzy } from './fuzzyMatch';

/**
 * In-Memory Effort Registry
 *
 * Stores all efforts in a Map indexed by slug.
 * Used for:
 * - Unit tests (deterministic, no I/O)
 * - Storybook / static builds (no IndexedDB)
 * - Bundled seed fallback
 */
export class InMemoryEffortRegistry implements IEffortRegistry {
  private readonly efforts = new Map<string, IEffort>();
  private readonly sourceFilter: EffortRegistrySource | null = null;
  private initialized = false;
  constructor(sourceFilter?: EffortRegistrySource) {
    this.sourceFilter = sourceFilter ?? null;
  }

  /** Seed with bundled efforts */
  async loadBundled(): Promise<void> {
    for (const effort of bundledEfforts) {
      if (!this.sourceFilter || effort.registrySource === this.sourceFilter) {
        this.efforts.set(effort.slug, effort);
      }
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** Seed with arbitrary efforts (useful for tests) */
  seed(efforts: readonly IEffort[]): void {
    for (const effort of efforts) {
      this.efforts.set(effort.slug, effort);
    }
  }

  /** Clear all efforts */
  clear(): void {
    this.efforts.clear();
    this.initialized = false;
  }
  resolve(slug: string): IEffort | null {
    return this.efforts.get(slug) ?? null;
  }

  resolveByAlias(label: string): IEffort | null {
    const normalized = normalizeForFuzzy(label);
    for (const effort of this.efforts.values()) {
      if (normalizeForFuzzy(effort.label) === normalized) return effort;
      for (const alias of effort.aliases) {
        if (normalizeForFuzzy(alias) === normalized) return effort;
      }
    }
    return null;
  }

  list(): readonly IEffort[] {
    return Array.from(this.efforts.values());
  }

  listByOrigin(origin: EffortRegistrySource): readonly IEffort[] {
    return this.list().filter((e) => e.registrySource === origin);
  }

  async upsert(effort: IEffort): Promise<void> {
    if (effort.registrySource !== 'user') {
      throw new Error(
        `InMemoryEffortRegistry.upsert: only user efforts can be written. Received registrySource="${effort.registrySource}"`
      );
    }
    this.efforts.set(effort.slug, effort);
  }

  async delete(slug: string): Promise<void> {
    const existing = this.efforts.get(slug);
    if (existing && existing.registrySource !== 'user') {
      throw new Error(
        `InMemoryEffortRegistry.delete: cannot delete non-user effort "${slug}"`
      );
    }
    this.efforts.delete(slug);
  }
}
