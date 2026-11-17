// Simple interfaces for the path-based index
export interface ExercisePathEntry {
  name: string;
  path: string;                     // Relative path to exercise directory
  searchTerms: string[];            // Search terms for this exercise
}

export interface ExercisePathGroup {
  rootName: string;                 // Root exercise name
  variations: ExercisePathEntry[];  // All variations with their paths
  searchTerms: string[];            // Combined search terms for group
  variationCount: number;           // Number of variations
}

export interface ExercisePathIndex {
  groups: ExercisePathGroup[];                    // All exercise groups
  groupsByName: Record<string, ExercisePathGroup>; // Quick lookup by name
  allEntries: ExercisePathEntry[];                // Flat list of all exercises
  totalExercises: number;                         // Total exercise count
}

export interface PathIndexingOptions {
  minRootNameLength?: number;
  includeEquipmentInSearch?: boolean;
  includeMusclesInSearch?: boolean;
}

export class ExercisePathIndexer {
  private readonly exerciseData: Map<string, { name: string; path: string; searchTerms: string[] }> = new Map();

  constructor(private readonly options: PathIndexingOptions = {}) {}

  /**
   * Add an exercise to the indexer
   */
  addExercise(name: string, path: string, additionalSearchTerms: string[] = []): void {
    const searchTerms = this.generateSearchTerms(name, additionalSearchTerms);
    this.exerciseData.set(name, { name, path, searchTerms });
  }

  /**
   * Generate search terms for an exercise
   */
  private generateSearchTerms(name: string, additionalTerms: string[] = []): string[] {
    const terms: Set<string> = new Set();

    // Add name variations
    terms.add(name.toLowerCase());

    // Tokenize name
    const tokens = this.normalizeName(name).split(' ').filter(word => word.length > 0);
    tokens.forEach(token => terms.add(token));

    // Add additional terms (equipment, muscles, etc.)
    additionalTerms.forEach(term => {
      if (term) {
        terms.add(term.toLowerCase());
        // Also add tokenized version
        const tokenized = this.normalizeName(term).split(' ').filter(word => word.length > 0);
        tokenized.forEach(token => terms.add(token));
      }
    });

    return Array.from(terms);
  }

  /**
   * Normalize exercise name for comparison
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Split exercise name into words
   */
  private tokenizeName(name: string): string[] {
    return this.normalizeName(name).split(' ').filter(word => word.length > 0);
  }

  /**
   * Check if one name is a subset of another
   */
  private isSubset(subset: string[], superset: string[]): boolean {
    return subset.every(word => superset.includes(word));
  }

  /**
   * Calculate similarity between two exercise names
   */
  private calculateSimilarity(name1: string[], name2: string[]): number {
    const set1 = new Set(name1);
    const set2 = new Set(name2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Find the root exercise name for a group
   */
  private findRootName(exercises: string[]): string {
    if (exercises.length === 1) {
      return exercises[0];
    }

    // Get all tokenized names
    const tokenizedNames = exercises.map(name => this.tokenizeName(name));

    // Find common words that appear in ALL exercises
    const commonWords = tokenizedNames.reduce((common, tokens) => {
      if (common.length === 0) return tokens;
      return common.filter(word => tokens.includes(word));
    }, tokenizedNames[0] || []);

    // If we have common words, use them as root
    if (commonWords.length >= 1) {
      const minLength = this.options.minRootNameLength || 2;
      const meaningfulWords = commonWords.filter(word => word.length >= minLength);

      if (meaningfulWords.length > 0) {
        return this.findBestRootName(exercises, meaningfulWords);
      }
    }

    // If no common words, find the shortest name as root
    const shortest = exercises.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest
    );

    return shortest;
  }

  /**
   * Find the best root name from common words
   */
  private findBestRootName(exercises: string[], commonWords: string[]): string {
    // Check if any exercise name consists mainly of these common words
    for (const exercise of exercises) {
      const tokens = this.tokenizeName(exercise);
      const commonWordCount = tokens.filter(word => commonWords.includes(word)).length;

      // If 70% or more of the words are common, this could be a root
      if (commonWordCount / tokens.length >= 0.7) {
        return exercise;
      }
    }

    // Find the most common ordering of these words
    return this.findMostCommonWordOrder(exercises, commonWords);
  }

  /**
   * Find the most common ordering of words
   */
  private findMostCommonWordOrder(exercises: string[], words: string[]): string {
    const wordOrders: string[][] = [];

    for (const exercise of exercises) {
      const tokens = this.tokenizeName(exercise);
      const order = words.filter(word => tokens.includes(word));
      if (order.length === words.length) {
        wordOrders.push(order);
      }
    }

    if (wordOrders.length > 0) {
      const orderCounts = new Map<string, number>();
      for (const order of wordOrders) {
        const key = order.join(' ');
        orderCounts.set(key, (orderCounts.get(key) || 0) + 1);
      }

      const mostCommon = Array.from(orderCounts.entries())
        .sort(([,a], [,b]) => b - a)[0][0];

      // Convert back to title case
      return mostCommon.split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
    }

    // Fallback: just join common words
    return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  /**
   * Group exercises by name similarity
   */
  groupExercisesByName(): ExercisePathGroup[] {
    const groups: ExercisePathGroup[] = [];
    const processed = new Set<string>();

    // Sort exercises by name length (shorter names first)
    const sortedEntries = Array.from(this.exerciseData.entries())
      .sort(([,a], [,b]) => a.name.length - b.name.length);

    for (const [name, exerciseData] of sortedEntries) {
      if (processed.has(name)) continue;

      const exerciseTokens = this.tokenizeName(name);
      const similarExercises: ExercisePathEntry[] = [{
        name: exerciseData.name,
        path: exerciseData.path,
        searchTerms: exerciseData.searchTerms
      }];

      // Find exercises that contain this exercise's name as a subset
      for (const [otherName, otherExerciseData] of this.exerciseData.entries()) {
        if (processed.has(otherName) || otherName === name) continue;

        const otherTokens = this.tokenizeName(otherName);

        // Check if one is a subset of the other
        if (this.isSubset(exerciseTokens, otherTokens) || this.isSubset(otherTokens, exerciseTokens)) {
          // Also check similarity threshold
          const similarity = this.calculateSimilarity(exerciseTokens, otherTokens);
          if (similarity >= 0.5) {
            similarExercises.push({
              name: otherExerciseData.name,
              path: otherExerciseData.path,
              searchTerms: otherExerciseData.searchTerms
            });
            processed.add(otherName);
          }
        }
      }

      // Create group
      const rootName = this.findRootName(similarExercises.map(e => e.name));
      const allSearchTerms = new Set<string>();
      similarExercises.forEach(exercise => {
        exercise.searchTerms.forEach(term => allSearchTerms.add(term));
      });

      const group: ExercisePathGroup = {
        rootName,
        variations: similarExercises.sort((a, b) => a.name.localeCompare(b.name)),
        searchTerms: Array.from(allSearchTerms),
        variationCount: similarExercises.length
      };
      groups.push(group);
      similarExercises.forEach(exercise => processed.add(exercise.name));
    }

    // Sort groups alphabetically by root name
    groups.sort((a, b) => a.rootName.localeCompare(b.rootName));

    return groups;
  }

  /**
   * Build the complete path-based index
   */
  buildPathIndex(): ExercisePathIndex {
    const groups = this.groupExercisesByName();
    const groupsByName: Record<string, ExercisePathGroup> = {};
    const allEntries: ExercisePathEntry[] = [];

    for (const group of groups) {
      groupsByName[group.rootName.toLowerCase()] = group;
      group.variations.forEach(variation => {
        allEntries.push(variation);
      });
    }

    return {
      groups,
      groupsByName,
      allEntries,
      totalExercises: allEntries.length
    };
  }

  /**
   * Search for exercises by name
   */
  search(query: string, entries: ExercisePathEntry[]): ExercisePathEntry[] {
    if (!query.trim()) return entries;

    const searchTerms = query.toLowerCase().split(/\s+/);

    return entries.filter(entry => {
      const searchText = `${entry.name} ${entry.searchTerms.join(' ')}`.toLowerCase();
      return searchTerms.every(term => searchText.includes(term));
    });
  }

  /**
   * Search groups by name
   */
  searchGroups(query: string, groups: ExercisePathGroup[]): ExercisePathGroup[] {
    if (!query.trim()) return groups;

    const searchTerms = query.toLowerCase().split(/\s+/);

    return groups.filter(group => {
      const searchText = `${group.rootName} ${group.searchTerms.join(' ')} ${group.variations.map(v => v.name).join(' ')}`.toLowerCase();
      return searchTerms.every(term => searchText.includes(term));
    });
  }

  /**
   * Get statistics about the index
   */
  getIndexStats(index: ExercisePathIndex): {
    totalExercises: number;
    totalGroups: number;
    groupsWithVariations: number;
    largestGroupSize: number;
    averageGroupSize: number;
  } {
    const totalExercises = index.totalExercises;
    const totalGroups = index.groups.length;
    const groupsWithVariations = index.groups.filter(g => g.variations.length > 1).length;
    const groupSizes = index.groups.map(g => g.variations.length);
    const largestGroupSize = Math.max(...groupSizes);
    const averageGroupSize = totalExercises / totalGroups;

    return {
      totalExercises,
      totalGroups,
      groupsWithVariations,
      largestGroupSize,
      averageGroupSize
    };
  }
}
