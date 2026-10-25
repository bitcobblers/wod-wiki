import { IDialect, DialectAnalysis } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { hintsToContainer } from '../metrics/hints';

/**
 * Habits dialect for tracking daily/recurring habit completions.
 *
 * Recognizes:
 * - Daily habits: single-completion items logged once per day
 * - Recurring habits: timed or rep-counted recurring actions
 * - Streaks: consecutive day tracking
 * - Check-off items: boolean "did I do this?" entries
 *
 * Emitted hints (dot-namespaced):
 *   domain.habits           - any statement processed by this dialect
 *   behavior.daily          - once-a-day completion
 *   behavior.completable    - boolean done/not-done state
 *   behavior.streak         - streak-relevant (consecutive occurrences matter)
 *   behavior.recurring      - repeats on a schedule
 *   workout.habit_check     - single check-off habit
 *   workout.habit_timed     - habit with a target duration (e.g. "Meditate :10:00")
 *   workout.habit_rep       - habit with a target count (e.g. "10 Pushups daily")
 */
export class HabitsDialect implements IDialect {
  id = 'habits';
  name = 'Habits Dialect';

  /**
   * Keywords that indicate a habit/daily-tracking context.
   * TODO: Expand as habit vocabulary is refined.
   */
  static readonly HABIT_KEYWORDS = [
    'DAILY', 'HABIT', 'STREAK', 'CHECK', 'LOG',
    'MORNING', 'EVENING', 'ROUTINE',
  ];

  static readonly STREAK_KEYWORDS = [
    'STREAK', 'CONSECUTIVE', 'IN A ROW',
  ];

  private hasAnyKeyword(metrics: MetricContainer, keywords: string[]): boolean {
    return metrics.some(
      m =>
        (m.type === MetricType.Action ||
          m.type === MetricType.Effort ||
          m.type === MetricType.Text ||
          m.type === MetricType.Label) &&
        typeof m.value === 'string' &&
        keywords.some(k => m.value!.toString().toUpperCase().includes(k))
    );
  }

  analyze(statement: ICodeStatement): DialectAnalysis {
    const hints: string[] = [];
    const metrics = MetricContainer.from(statement.metrics);

    const hasDuration = metrics.some(m => m.type === MetricType.Duration);
    const hasReps = metrics.some(m => m.type === MetricType.Rep);
    const isHabit = this.hasAnyKeyword(metrics, HabitsDialect.HABIT_KEYWORDS);

    // TODO: Detect habit-flavoured statements
    if (isHabit) {
      hints.push('domain.habits');
      hints.push('behavior.completable');

      if (hasDuration) {
        // e.g. "Meditate :10:00 daily"
        hints.push('workout.habit_timed');
      } else if (hasReps) {
        // e.g. "10 Pushups daily"
        hints.push('workout.habit_rep');
      } else {
        // e.g. "Morning journaling"
        hints.push('workout.habit_check');
        hints.push('behavior.daily');
      }
    }

    // TODO: Detect streak tracking
    if (this.hasAnyKeyword(metrics, HabitsDialect.STREAK_KEYWORDS)) {
      if (!hints.includes('domain.habits')) hints.push('domain.habits');
      hints.push('behavior.streak');
      hints.push('behavior.recurring');
    }

    return { metrics: hintsToContainer(hints) };
  }
}
