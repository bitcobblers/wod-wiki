import { resolveEntityRank, type IEffort, type IEffortRegistry, type EffortRegistrySource, type EffortStorageAdapter } from './types';
import { bundledEfforts as defaultBundledEfforts } from './data/bundled-efforts';
import { CompositePropertyRegistry } from './CompositePropertyRegistry';

export interface CompositeEffortRegistryOptions {
  /** Custom bundled efforts to seed the read-only tier (defaults to built-in bundled efforts). */
  bundled?: Iterable<IEffort>;
  /** Optional persistence adapter for user-defined efforts. */
  storage?: EffortStorageAdapter;
}

export class CompositeEffortRegistry
  extends CompositePropertyRegistry<IEffort>
  implements IEffortRegistry
{
  constructor(options?: CompositeEffortRegistryOptions) {
    super({
      bundled: options?.bundled,
      storage: options?.storage,
    });
  }

  async loadBundled(customBundled?: Iterable<IEffort>): Promise<void> {
    this.bundledItems.clear();
    const source = customBundled ?? this.initialBundled ?? defaultBundledEfforts;
    for (const effort of source) {
      const prior = this.bundledItems.get(effort.slug);
      if (!prior || resolveEntityRank(effort) >= resolveEntityRank(prior)) {
        this.bundledItems.set(effort.slug, effort);
      }
    }
    this.userItems.clear();
    if (this.storage) {
      try {
        const userEfforts = await this.storage.load();
        for (const effort of userEfforts) {
          if (effort.registrySource === 'user') {
            this.userItems.set(effort.slug, effort);
          }
        }
      } catch (err) {
        console.warn('[CompositeEffortRegistry] Failed to load user efforts from storage adapter:', err);
      }
    }

    this.initialized = true;
  }

  /** True after loadBundled() has resolved */
  isInitialized(): boolean {
    return this.initialized;
  }

  override listByOrigin(origin: EffortRegistrySource): readonly IEffort[] {
    if (origin === 'user') {
      return Array.from(this.userItems.values());
    }
    if (origin === 'bundled') {
      return Array.from(this.bundledItems.values());
    }
    return this.list().filter((e) => e.registrySource === origin);
  }

  async upsert(effort: IEffort): Promise<void> {
    if (effort.registrySource !== 'user') {
      throw new Error(
        `CompositeEffortRegistry.upsert: only user efforts can be written. Received registrySource="${effort.registrySource}"`
      );
    }

    this.userItems.set(effort.slug, effort);

    if (this.storage) {
      try {
        await this.storage.save(effort);
      } catch (err) {
        console.warn('[CompositeEffortRegistry] Failed to persist effort to storage adapter:', err);
      }
    }
  }

  async delete(slug: string): Promise<void> {
    const existing = this.resolve(slug);
    if (existing && existing.registrySource !== 'user') {
      throw new Error(
        `CompositeEffortRegistry.delete: cannot delete non-user effort "${slug}"`
      );
    }

    this.userItems.delete(slug);

    if (this.storage) {
      try {
        await this.storage.delete(slug);
      } catch (err) {
        console.warn('[CompositeEffortRegistry] Failed to delete effort from storage adapter:', err);
      }
    }
  }
}
