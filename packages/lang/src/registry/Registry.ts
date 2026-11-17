/**
 * Registry — one registration story for every consumer-facing extension point.
 *
 * Used for dialects, compiler strategies, realtime analytics processors,
 * and summary analytics processors. Replaces the previous hardcoded
 * `createDialectStack(overrides)`, `PRODUCTION_STRATEGIES`, and
 * `StandardAnalyticsProfile.allRealtime`/`allSummary` flat arrays with
 * one shape: a priority-ordered map keyed by `id`, with consumer-facing
 * `register` / `unregister` / `list` so a third party can extend the
 * library without forking the repository.
 *
 * The constructor seeds the registry with the built-in defaults. Built-ins
 * can still be overridden (or removed) by registering an entry with the
 * same `id` (or calling `unregister(id)`).
 *
 * @typeParam T Items must expose an `id: string` and an optional
 *           `priority: number`; `list()` returns them sorted by descending
 *           priority, matching the contract strategies, dialects, and
 *           processors already follow.
 */
export class Registry<T extends { id: string; priority?: number }> {
  private readonly items = new Map<string, T>();

  constructor(defaults: readonly T[] = []) {
    for (const item of defaults) {
      this.items.set(item.id, item);
    }
  }

  /**
   * Register an item. If an item with the same `id` already exists it is
   * replaced (mirrors "last registration wins" already used for dialect
   * metric merges).
   *
   * Use {@link unregister} first if you need strict rejection of duplicates.
   */
  register(item: T): void {
    this.items.set(item.id, item);
  }

  /** Remove the item registered under `id`. No-op if not present. */
  unregister(id: string): void {
    this.items.delete(id);
  }

  /** Whether an item is currently registered under `id`. */
  has(id: string): boolean {
    return this.items.has(id);
  }

  /**
   * Get the item registered under `id`, or `undefined` if absent.
   */
  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /**
   * Items in descending `priority` order (highest first). Items without
   * an explicit priority are treated as priority 0.
   */
  list(): T[] {
    return [...this.items.values()].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
  }

  /** Number of currently registered items. */
  get size(): number {
    return this.items.size;
  }
}
