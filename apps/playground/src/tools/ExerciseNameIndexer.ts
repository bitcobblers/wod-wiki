import { Exercise, Muscle, Equipment, Category, Level, Force, Mechanic } from '../exercise';

export interface ExerciseNameCard {
  id: string;
  name: string;
  variations: string[];
  totalVariations: number;
  primaryMuscles: Muscle[];
  equipment?: Equipment;
  level: Level;
  category: Category;
  force?: Force;
  mechanic?: Mechanic;
  searchTerms: string[];
}

export interface ExerciseNameGroup {
  rootName: string;
  exercises: Exercise[];
  card: ExerciseNameCard;
}

export interface ExerciseNameIndex {
  groups: ExerciseNameGroup[];
  cards: ExerciseNameCard[];
  groupsByName: Record<string, ExerciseNameGroup>;
  allExerciseNames: string[];
}

export interface NameIndexingOptions {
  minRootNameLength?: number;
  includeExactMatches?: boolean;
  sortVariationsBy?: 'name' | 'level' | 'equipment';
}

export class ExerciseNameIndexer {
  private readonly exercises: Exercise[] = [];
  private readonly normalizedNames: Map<string, Exercise> = new Map();

  constructor(private readonly options: NameIndexingOptions = {}) {}

  /**
   * Add an exercise to the indexer
   */
  addExercise(exercise: Exercise): void {
    this.exercises.push(exercise);
    const normalizedName = this.normalizeName(exercise.name);
    this.normalizedNames.set(normalizedName, exercise);
  }

  /**
   * Normalize exercise name for comparison
   * - Convert to lowercase
   * - Remove extra whitespace
   * - Remove common punctuation
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
    // All words in subset must be present in superset
    return subset.every(word => superset.includes(word));
  }

  /**
   * Calculate similarity between two exercise names based on shared words
   */
  private calculateSimilarity(name1: string[], name2: string[]): number {
    const set1 = new Set(name1);
    const set2 = new Set(name2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Find the root exercise name for a group
   * This is the shortest name that encompasses all exercises in the group
   */
  private findRootName(exercises: Exercise[]): string {
    if (exercises.length === 1) {
      return exercises[0].name;
    }

    // Get all tokenized names
    const tokenizedNames = exercises.map(e => this.tokenizeName(e.name));

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
        // Return the most common ordering of these words
        return this.findBestRootName(exercises, meaningfulWords);
      }
    }

    // If no common words, find the shortest name as root
    const shortest = exercises.reduce((shortest, current) =>
      current.name.length < shortest.name.length ? current : shortest
    );

    return shortest.name;
  }

  /**
   * Find the best root name from common words by checking actual exercise names
   */
  private findBestRootName(exercises: Exercise[], commonWords: string[]): string {
    // Check if any exercise name consists mainly of these common words
    for (const exercise of exercises) {
      const tokens = this.tokenizeName(exercise.name);
      const commonWordCount = tokens.filter(word => commonWords.includes(word)).length;

      // If 70% or more of the words are common, this could be a root
      if (commonWordCount / tokens.length >= 0.7) {
        return exercise.name;
      }
    }

    // Fall back to combining common words in the most common order
    return this.findMostCommonWordOrder(exercises, commonWords);
  }

  /**
   * Find the most common ordering of words from exercise names
   */
  private findMostCommonWordOrder(exercises: Exercise[], words: string[]): string {
    const wordOrders: string[][] = [];

    for (const exercise of exercises) {
      const tokens = this.tokenizeName(exercise.name);
      const order = words.filter(word => tokens.includes(word));
      if (order.length === words.length) {
        wordOrders.push(order);
      }
    }

    if (wordOrders.length > 0) {
      // Find the most common word order
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
  groupExercisesByName(): ExerciseNameGroup[] {
    const groups: ExerciseNameGroup[] = [];
    const processed = new Set<Exercise>();

    // Sort exercises by name length (shorter names first)
    const sortedExercises = [...this.exercises].sort((a, b) => a.name.length - b.name.length);

    for (const exercise of sortedExercises) {
      if (processed.has(exercise)) continue;

      const exerciseTokens = this.tokenizeName(exercise.name);
      const similarExercises: Exercise[] = [exercise];

      // Find exercises that contain this exercise's name as a subset
      for (const otherExercise of this.exercises) {
        if (processed.has(otherExercise) || otherExercise === exercise) continue;

        const otherTokens = this.tokenizeName(otherExercise.name);

        // Check if one is a subset of the other
        if (this.isSubset(exerciseTokens, otherTokens) || this.isSubset(otherTokens, exerciseTokens)) {
          // Also check similarity threshold to avoid false positives
          const similarity = this.calculateSimilarity(exerciseTokens, otherTokens);
          if (similarity >= 0.5) { // 50% similarity threshold
            similarExercises.push(otherExercise);
            processed.add(otherExercise);
          }
        }
      }

      // Only create a group if we have more than one exercise
      if (similarExercises.length > 1) {
        const rootName = this.findRootName(similarExercises);
        const group: ExerciseNameGroup = {
          rootName,
          exercises: similarExercises,
          card: this.createNameCard(rootName, similarExercises)
        };
        groups.push(group);
        similarExercises.forEach(e => processed.add(e));
      }
    }

    // Add exercises that weren't grouped as individual groups
    for (const exercise of this.exercises) {
      if (!processed.has(exercise)) {
        const group: ExerciseNameGroup = {
          rootName: exercise.name,
          exercises: [exercise],
          card: this.createNameCard(exercise.name, [exercise])
        };
        groups.push(group);
      }
    }

    // Sort groups alphabetically by root name
    groups.sort((a, b) => a.rootName.localeCompare(b.rootName));

    return groups;
  }

  /**
   * Create a name card for a group
   */
  private createNameCard(rootName: string, exercises: Exercise[]): ExerciseNameCard {
    const baseExercise = exercises[0];
    const variationNames = exercises.map(e => e.name).sort();

    // Generate search terms
    const searchTerms = this.generateSearchTerms(exercises);

    return {
      id: rootName.toLowerCase().replace(/\s+/g, '-'),
      name: rootName,
      variations: variationNames,
      totalVariations: exercises.length,
      primaryMuscles: baseExercise.primaryMuscles,
      equipment: baseExercise.equipment,
      level: baseExercise.level,
      category: baseExercise.category,
      force: baseExercise.force,
      mechanic: baseExercise.mechanic,
      searchTerms
    };
  }

  /**
   * Generate search terms for exercises
   */
  private generateSearchTerms(exercises: Exercise[]): string[] {
    const terms: Set<string> = new Set();

    for (const exercise of exercises) {
      // Add name variations
      terms.add(exercise.name.toLowerCase());
      const tokens = this.tokenizeName(exercise.name);
      tokens.forEach(token => terms.add(token));

      // Add equipment
      if (exercise.equipment) {
        terms.add(exercise.equipment.toLowerCase());
      }

      // Add muscles
      exercise.primaryMuscles.forEach(muscle => {
        terms.add(muscle.toLowerCase().replace(/\s+/g, ' '));
      });

      // Add category
      terms.add(exercise.category.toLowerCase());
    }

    return Array.from(terms);
  }

  /**
   * Build the complete name-based index
   */
  buildNameIndex(): ExerciseNameIndex {
    const groups = this.groupExercisesByName();
    const cards = groups.map(g => g.card);
    const groupsByName: Record<string, ExerciseNameGroup> = {};
    const allExerciseNames: string[] = [];

    for (const group of groups) {
      groupsByName[group.rootName.toLowerCase()] = group;
      group.exercises.forEach(exercise => {
        allExerciseNames.push(exercise.name);
      });
    }

    return {
      groups,
      cards,
      groupsByName,
      allExerciseNames: allExerciseNames.sort()
    };
  }

  /**
   * Search for exercises by name
   */
  searchByName(query: string, cards: ExerciseNameCard[]): ExerciseNameCard[] {
    if (!query.trim()) return cards;

    const searchTerms = query.toLowerCase().split(/\s+/);

    return cards.filter(card => {
      const searchText = `${card.name} ${card.searchTerms.join(' ')} ${card.variations.join(' ')}`.toLowerCase();
      return searchTerms.every(term => searchText.includes(term));
    });
  }

  /**
   * Find exercises that have variations
   */
  getExercisesWithVariations(groups: ExerciseNameGroup[]): ExerciseNameGroup[] {
    return groups.filter(group => group.exercises.length > 1);
  }

  /**
   * Get statistics about the index
   */
  getIndexStats(index: ExerciseNameIndex): {
    totalExercises: number;
    totalGroups: number;
    groupsWithVariations: number;
    largestGroupSize: number;
    averageGroupSize: number;
  } {
    const totalExercises = index.allExerciseNames.length;
    const totalGroups = index.groups.length;
    const groupsWithVariations = index.groups.filter(g => g.exercises.length > 1).length;
    const groupSizes = index.groups.map(g => g.exercises.length);
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
