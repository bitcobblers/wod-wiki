import { ExercisePathEntry } from '../../tools/ExercisePathIndexer';
import { ExerciseIndexManager } from './ExerciseIndexManager';

export interface SearchOptions {
  equipment?: string[];
  muscles?: string[];
  difficulty?: string[];
  limit?: number;
}

/**
 * Exercise search engine with debouncing and filtering capabilities
 * 
 * Provides:
 * - Debounced search (150ms delay)
 * - Result ranking by relevance
 * - Equipment/muscle/difficulty filtering
 * - Search result caching
 */
export class ExerciseSearchEngine {
  private debounceTimeout: NodeJS.Timeout | null = null;
  private lastQuery: string = '';
  private lastResults: ExercisePathEntry[] = [];
  private readonly searchCache: Map<string, ExercisePathEntry[]> = new Map();
  
  private readonly DEBOUNCE_DELAY = 150; // ms
  private readonly DEFAULT_LIMIT = 50;

  constructor(private readonly indexManager: ExerciseIndexManager) {}

  /**
   * Search for exercises with debouncing
   * @param query Search query
   * @param options Search options (equipment, muscles, difficulty, limit)
   * @param callback Callback with results
   */
  search(
    query: string,
    options: SearchOptions = {},
    callback: (results: ExercisePathEntry[]) => void
  ): void {
    // Clear existing timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    // Set new timeout
    this.debounceTimeout = setTimeout(async () => {
      const results = await this.performSearch(query, options);
      this.lastQuery = query;
      this.lastResults = results;
      callback(results);
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Search immediately without debouncing
   * @param query Search query
   * @param options Search options
   * @returns Search results
   */
  async searchImmediate(query: string, options: SearchOptions = {}): Promise<ExercisePathEntry[]> {
    // Cancel pending debounced search
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    return this.performSearch(query, options);
  }

  /**
   * Perform the actual search with caching and filtering
   */
  private async performSearch(query: string, options: SearchOptions): Promise<ExercisePathEntry[]> {
    const normalizedQuery = query.toLowerCase().trim();
    const limit = options.limit || this.DEFAULT_LIMIT;

    // Check cache
    const cacheKey = this.getCacheKey(normalizedQuery, options);
    if (this.searchCache.has(cacheKey)) {
      const cached = this.searchCache.get(cacheKey)!;
      return cached.slice(0, limit);
    }

    // Perform search - if query is empty but filters are present, get all entries
    let results: ExercisePathEntry[];
    if (!normalizedQuery && this.hasFilters(options)) {
      // Ensure index is loaded
      if (!this.indexManager.isIndexLoaded()) {
        await this.indexManager.searchExercises('', 1);
      }
      results = this.indexManager.getAllEntries();
    } else {
      results = await this.indexManager.searchExercises(normalizedQuery, limit * 2); // Get more for filtering
    }

    // Apply filters
    let filtered = results;
    
    if (options.equipment && options.equipment.length > 0) {
      filtered = this.filterByEquipment(filtered, options.equipment);
    }

    if (options.muscles && options.muscles.length > 0) {
      filtered = this.filterByMuscles(filtered, options.muscles);
    }

    if (options.difficulty && options.difficulty.length > 0) {
      filtered = this.filterByDifficulty(filtered, options.difficulty);
    }

    // Limit results
    const limited = filtered.slice(0, limit);

    // Cache results
    this.searchCache.set(cacheKey, limited);

    // Limit cache size
    if (this.searchCache.size > 100) {
      const firstKey = this.searchCache.keys().next().value;
      if (firstKey !== undefined) {
        this.searchCache.delete(firstKey);
      }
    }

    return limited;
  }

  /**
   * Filter results by equipment
   */
  private filterByEquipment(results: ExercisePathEntry[], equipment: string[]): ExercisePathEntry[] {
    const equipmentLower = equipment.map(e => e.toLowerCase());
    return results.filter(entry => {
      return entry.searchTerms.some(term => 
        equipmentLower.some(eq => term.includes(eq))
      );
    });
  }

  /**
   * Filter results by muscle groups
   */
  private filterByMuscles(results: ExercisePathEntry[], muscles: string[]): ExercisePathEntry[] {
    const musclesLower = muscles.map(m => m.toLowerCase());
    return results.filter(entry => {
      return entry.searchTerms.some(term =>
        musclesLower.some(muscle => term.includes(muscle))
      );
    });
  }

  /**
   * Filter results by difficulty level
   */
  private filterByDifficulty(results: ExercisePathEntry[], difficulty: string[]): ExercisePathEntry[] {
    const difficultyLower = difficulty.map(d => d.toLowerCase());
    return results.filter(entry => {
      return entry.searchTerms.some(term =>
        difficultyLower.some(diff => term.includes(diff))
      );
    });
  }

  /**
   * Generate cache key from query and options
   */
  private getCacheKey(query: string, options: SearchOptions): string {
    const parts = [query];
    
    if (options.equipment) {
      parts.push(`eq:${options.equipment.join(',')}`);
    }
    if (options.muscles) {
      parts.push(`mu:${options.muscles.join(',')}`);
    }
    if (options.difficulty) {
      parts.push(`diff:${options.difficulty.join(',')}`);
    }
    if (options.limit) {
      parts.push(`lim:${options.limit}`);
    }

    return parts.join('|');
  }

  /**
   * Check if any filters are specified
   */
  private hasFilters(options: SearchOptions): boolean {
    return !!(
      (options.equipment && options.equipment.length > 0) ||
      (options.muscles && options.muscles.length > 0) ||
      (options.difficulty && options.difficulty.length > 0)
    );
  }

  /**
   * Get last search query
   */
  getLastQuery(): string {
    return this.lastQuery;
  }

  /**
   * Get last search results
   */
  getLastResults(): ExercisePathEntry[] {
    return this.lastResults;
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.searchCache.clear();
  }

  /**
   * Cancel pending debounced search
   */
  cancelPending(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cacheSize: this.searchCache.size,
      lastQuery: this.lastQuery,
      lastResultCount: this.lastResults.length
    };
  }
}
