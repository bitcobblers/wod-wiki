import { LRUCache } from './LRUCache';
import type { ExercisePathIndex, ExercisePathEntry, ExercisePathGroup } from '../../tools/ExercisePathIndexer';
import type { Exercise } from '../../exercise';
import type { ExerciseDataProvider } from '@/types/exercise-provider';

/**
 * Singleton manager for exercise index and data loading
 * 
 * Now uses a provider pattern for data access, allowing consumers
 * to inject their own data sources instead of bundling data.
 * 
 * Provides:
 * - Asynchronous index loading with localStorage caching
 * - Search operations across exercises
 * - LRU cache for exercise data (max 100 entries)
 * - Lazy loading of exercise JSON files
 */
export class ExerciseIndexManager {
  private static instance: ExerciseIndexManager | null = null;

  private index: ExercisePathIndex | null = null;
  private readonly exerciseCache: LRUCache<string, Exercise>;
  private readonly loadingPromises: Map<string, Promise<Exercise>>;
  private provider: ExerciseDataProvider | null = null;

  private readonly CACHE_KEY = 'wod-wiki-exercise-index';
  private readonly CACHE_VERSION = '3.0.0'; // Bumped version for provider pattern
  private readonly CACHE_VERSION_KEY = 'wod-wiki-exercise-index-version';

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor() {
    this.exerciseCache = new LRUCache<string, Exercise>(100);
    this.loadingPromises = new Map();
  }

  /**
   * Get the singleton instance
   * Creates instance without initialization (provider must be set)
   * @returns ExerciseIndexManager instance
   */
  static getInstance(): ExerciseIndexManager {
    if (!this.instance) {
      this.instance = new ExerciseIndexManager();
    }
    return this.instance;
  }

  /**
   * Set the exercise data provider
   * Must be called before using search or load operations
   * @param provider ExerciseDataProvider implementation
   */
  setProvider(provider: ExerciseDataProvider): void {
    this.provider = provider;
    // Clear cache when provider changes
    this.index = null;
    this.exerciseCache.clear();
    this.loadingPromises.clear();
  }

  /**
   * Check if provider is configured
   * @returns true if provider is set
   */
  hasProvider(): boolean {
    return this.provider !== null;
  }

  /**
   * Load exercise index with caching strategy
   * 1. Check localStorage cache
   * 2. Load from provider if cache miss or invalid
   * 3. Save to localStorage on successful load
   */
  private async loadIndex(): Promise<void> {
    // Check if provider is configured
    if (!this.provider) {
      this.index = {
        groups: [],
        groupsByName: {},
        allEntries: [],
        totalExercises: 0
      };
      return;
    }

    try {
      // Try loading from localStorage cache
      const cachedIndex = this.loadFromCache();
      if (cachedIndex) {
        this.index = cachedIndex;
        return;
      }

      // Load from provider
      const loadedIndex = await this.provider.loadIndex();
      // TODO(reconcile-types): core/types/providers.ExercisePathIndex and
      // tools/ExercisePathIndexer.ExercisePathIndex describe the same data at
      // different stages (raw vs indexed). Reconcile into one canonical shape.
      this.index = loadedIndex as unknown as ExercisePathIndex;

      // Save to cache
      this.saveToCache(loadedIndex as unknown as ExercisePathIndex);

    } catch (error) {
      console.error('[ExerciseIndexManager] Failed to load exercise index:', error);
      // Use fallback empty index
      this.index = {
        groups: [],
        groupsByName: {},
        allEntries: [],
        totalExercises: 0
      };
    }
  }

  /**
   * Load index from localStorage cache
   * @returns Cached index or null if not found/invalid
   */
  private loadFromCache(): ExercisePathIndex | null {
    try {
      const cachedVersion = localStorage.getItem(this.CACHE_VERSION_KEY);
      if (cachedVersion !== this.CACHE_VERSION) {
        return null;
      }

      const cached = localStorage.getItem(this.CACHE_KEY);
      if (!cached) {
        return null;
      }

      const index = JSON.parse(cached) as ExercisePathIndex;
      
      // Validate structure
      if (!index.groups || !index.allEntries || !index.groupsByName) {
        return null;
      }

      return index;
    } catch (error) {
      console.error('[ExerciseIndexManager] Error loading from cache:', error);
      return null;
    }
  }

  /**
   * Save index to localStorage cache
   * @param index Index to cache
   */
  private saveToCache(index: ExercisePathIndex): void {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(index));
      localStorage.setItem(this.CACHE_VERSION_KEY, this.CACHE_VERSION);
    } catch (error) {
      console.error('[ExerciseIndexManager] Error saving to cache:', error);
    }
  }

  /**
   * Search for exercises by query string
   * @param query Search query
   * @param limit Maximum results (default: 50)
   * @returns Array of matching exercise entries
   */
  async searchExercises(query: string, limit: number = 50): Promise<ExercisePathEntry[]> {
    // Ensure index is loaded
    if (!this.index) {
      await this.loadIndex();
    }

    if (!this.index || !query) {
      return [];
    }

    // If provider supports search directly, use it
    if (this.provider && typeof (this.provider as unknown as { searchExercises?: unknown }).searchExercises === 'function') {
      try {
        return await this.provider.searchExercises(query, limit);
      } catch (error) {
        console.error('[ExerciseIndexManager] Provider search failed, falling back to local search:', error);
        // Fall through to local search
      }
    }

    // Local search through index
    const normalizedQuery = query.toLowerCase().trim();
    const results: Array<{ entry: ExercisePathEntry; score: number }> = [];

    // Search through all entries
    for (const entry of this.index.allEntries) {
      const score = this.calculateRelevanceScore(entry, normalizedQuery);
      if (score > 0) {
        results.push({ entry, score });
      }
    }

    // Sort by score (highest first) and limit results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.entry);
  }

  /**
   * Calculate relevance score for an exercise against a query
   * @param entry Exercise entry
   * @param query Normalized query string
   * @returns Relevance score (higher is better, 0 = no match)
   */
  private calculateRelevanceScore(entry: ExercisePathEntry, query: string): number {
    const nameLower = entry.name.toLowerCase();
    
    // Exact match
    if (nameLower === query) {
      return 100;
    }

    // Starts with query
    if (nameLower.startsWith(query)) {
      return 80;
    }

    // Contains query
    if (nameLower.includes(query)) {
      return 60;
    }

    // Check search terms
    for (const term of entry.searchTerms) {
      const termLower = term.toLowerCase();
      
      if (termLower === query) {
        return 50;
      }
      
      if (termLower.startsWith(query)) {
        return 40;
      }
      
      if (termLower.includes(query)) {
        return 20;
      }
    }

    return 0;
  }

  /**
   * Get exercise group by root name
   * @param rootName Root exercise name
   * @returns Exercise group or undefined
   */
  getExerciseGroup(rootName: string): ExercisePathGroup | undefined {
    if (!this.index) {
      return undefined;
    }
    return this.index.groupsByName[rootName];
  }

  /**
   * Load full exercise data from JSON file
   * @param path Relative path to exercise directory
   * @returns Promise resolving to Exercise data
   */
  async loadExerciseData(path: string): Promise<Exercise> {
    // Check cache first
    if (this.exerciseCache.has(path)) {
      return this.exerciseCache.get(path)!;
    }

    // Check if already loading
    if (this.loadingPromises.has(path)) {
      return this.loadingPromises.get(path)!;
    }

    // Start loading
    const loadPromise = this.fetchExerciseData(path);
    this.loadingPromises.set(path, loadPromise);

    try {
      const exercise = await loadPromise;
      this.exerciseCache.set(path, exercise);
      return exercise;
    } finally {
      this.loadingPromises.delete(path);
    }
  }

  /**
   * Fetch exercise data using provider
   * @param path Relative path to exercise directory
   * @returns Promise resolving to Exercise data
   */
  private async fetchExerciseData(path: string): Promise<Exercise> {
    // Validate path to prevent directory traversal
    if (path.includes('..') || path.startsWith('/')) {
      throw new Error(`Invalid exercise path: ${path}`);
    }

    if (!this.provider) {
      throw new Error('[ExerciseIndexManager] No provider configured');
    }
    
    try {
      // Use retry with exponential backoff for transient errors
      const exercise = await this.retryWithBackoff(
        () => this.provider!.loadExercise(path),
        3, // max retries
        1000 // initial delay
      );
      return exercise;
    } catch (error) {
      console.error(`[ExerciseIndexManager] Error loading exercise data from ${path}:`, error);
      throw error;
    }
  }

  /**
   * Retry operation with exponential backoff
   * @param operation Function to retry
   * @param maxRetries Maximum number of retries
   * @param initialDelayMs Initial delay in milliseconds
   * @returns Promise resolving to operation result
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number,
    initialDelayMs: number
  ): Promise<T> {
    let lastError: unknown;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        
        // Don't retry permanent errors (404s)
        if (error.permanent) {
          throw error;
        }
        
        // Don't retry if this was the last attempt
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Exponential backoff: 1s, 2s, 4s...
        const delayMs = initialDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    throw lastError;
  }

  /**
   * Load multiple exercises concurrently
   * @param paths Array of exercise paths
   * @returns Promise resolving to array of Exercise data in same order
   */
  async loadExercises(paths: string[]): Promise<Exercise[]> {
    const loadPromises = paths.map(path => this.loadExerciseData(path));
    return Promise.all(loadPromises);
  }

  /**
   * Check if exercise data is cached
   * @param path Exercise path
   * @returns true if cached
   */
  isCached(path: string): boolean {
    return this.exerciseCache.has(path);
  }

  /**
   * Invalidate specific exercise cache entry
   * @param path Exercise path to invalidate
   */
  invalidateExercise(path: string): void {
    this.exerciseCache.delete(path);
  }

  /**
   * Clear all exercise data cache
   */
  clearCache(): void {
    this.exerciseCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      ...this.exerciseCache.getStats(),
      indexLoaded: this.index !== null,
      totalExercises: this.index?.totalExercises || 0,
      totalGroups: this.index?.groups.length || 0
    };
  }

  /**
   * Get all exercise entries (for testing/debugging)
   */
  getAllEntries(): ExercisePathEntry[] {
    return this.index?.allEntries || [];
  }

  /**
   * Check if index is loaded
   */
  isIndexLoaded(): boolean {
    return this.index !== null;
  }
}
