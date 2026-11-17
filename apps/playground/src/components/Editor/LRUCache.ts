/**
 * Least Recently Used (LRU) Cache implementation
 * 
 * Maintains a bounded cache with automatic eviction of least recently used entries.
 * Uses Map to maintain insertion order and efficiently move items to end on access.
 */
export class LRUCache<K, V> {
  private readonly cache: Map<K, V>;
  private readonly maxSize: number;

  /**
   * Create a new LRU cache
   * @param maxSize Maximum number of entries (default: 100)
   */
  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get a value from the cache
   * Moves the accessed item to most recently used position
   * @param key Cache key
   * @returns Cached value or undefined if not found
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a value in the cache
   * Evicts least recently used entry if cache is at capacity
   * @param key Cache key
   * @param value Value to cache
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing entry (move to end)
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache
   * @param key Cache key
   * @returns true if key exists
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific cache entry
   * @param key Cache key to delete
   * @returns true if entry was deleted
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   * @returns Number of cached entries
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all cached keys
   * @returns Array of cache keys
   */
  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache hit rate statistics
   * Note: This requires tracking hits/misses externally
   */
  getStats(): { size: number; maxSize: number; utilization: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: this.cache.size / this.maxSize
    };
  }
}
