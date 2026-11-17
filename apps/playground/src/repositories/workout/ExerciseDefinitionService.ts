import type { Exercise } from '../../exercise';

/**
 * Centralized repository for exercise context and definitions.
 * 
 * This service provides lookup capabilities for exercise metadata
 * that can be used to contextualize runtime metrics.
 * 
 * The service is designed as a singleton to ensure a single
 * source of truth for exercise data across the application.
 */
export class ExerciseDefinitionService {
  private static instance: ExerciseDefinitionService;
  private readonly definitions: Map<string, Exercise> = new Map();

  private constructor(exercises?: Exercise[]) {
    if (exercises) {
      // Use exercise name as the ID (can be customized if needed)
      exercises.forEach(ex => this.definitions.set(ex.name, ex));
    }
  }

  /**
   * Get or create the singleton instance of the service.
   * 
   * @param exercises Optional array of exercises for initial instantiation
   * @returns The singleton instance
   * @throws Error if path is not provided on first instantiation
   */
  public static getInstance(exercises?: Exercise[]): ExerciseDefinitionService {
    if (!ExerciseDefinitionService.instance) {
      if (!exercises) {
        throw new Error("Exercises must be provided on first instantiation.");
      }
      ExerciseDefinitionService.instance = new ExerciseDefinitionService(exercises);
    }
    return ExerciseDefinitionService.instance;
  }

  /**
   * Reset the singleton instance (useful for testing).
   */
  public static reset(): void {
    ExerciseDefinitionService.instance = undefined as unknown as ExerciseDefinitionService;
  }

  /**
   * Find an exercise definition by its ID (name).
   * 
   * @param exerciseId The ID (name) of the exercise to find
   * @returns The exercise definition or undefined if not found
   */
  public findById(exerciseId: string): Exercise | undefined {
    return this.definitions.get(exerciseId);
  }

  /**
   * Get all exercise definitions.
   * 
   * @returns Array of all exercise definitions
   */
  public getAllExercises(): Exercise[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Add or update an exercise definition.
   * 
   * @param exercise The exercise to add or update
   */
  public addExercise(exercise: Exercise): void {
    this.definitions.set(exercise.name, exercise);
  }
}
