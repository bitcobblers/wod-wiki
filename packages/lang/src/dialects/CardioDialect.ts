import { IDialect, DialectAnalysis } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { hintsToContainer } from '../metrics/hints';

/**
 * Cardio dialect for recognizing endurance/aerobic workout patterns.
 *
 * Recognizes:
 * - RUN / JOG / SPRINT: Running activities
 * - ROW: Rowing (erg, water)
 * - BIKE / CYCLE: Cycling activities
 * - SWIM: Swimming
 * - WALK: Walking / recovery activity
 * - Distance-only statements (e.g. "5km", "400m") without explicit activity
 *
 * Emitted hints (dot-namespaced):
 *   domain.cardio              - any statement processed by this dialect
 *   workout.run                - running activity
 *   workout.row                - rowing activity
 *   workout.bike               - cycling activity
 *   workout.swim               - swimming activity
 *   workout.walk               - walking activity
 *   behavior.distance_based    - primary metric is distance
 *   behavior.pace_based        - pacing / splits are relevant
 *   behavior.aerobic           - sustained aerobic effort
 */
/**
 * Activity keyword → emitted hint table, shared with the completion provider
 * so the editor suggests the same vocabulary this dialect recognizes.
 */
export const CARDIO_ACTIVITY_KEYWORDS: readonly { keywords: readonly string[]; hints: readonly string[] }[] = [
  { keywords: ['RUN', 'JOG', 'SPRINT'], hints: ['workout.run', 'behavior.aerobic'] },
  { keywords: ['ROW', 'ROWING'], hints: ['workout.row', 'behavior.aerobic'] },
  { keywords: ['BIKE', 'CYCLE', 'CYCLING'], hints: ['workout.bike', 'behavior.aerobic'] },
  { keywords: ['SWIM', 'SWIMMING'], hints: ['workout.swim', 'behavior.aerobic'] },
  { keywords: ['WALK', 'WALKING'], hints: ['workout.walk'] },
];

export class CardioDialect implements IDialect {
  id = 'cardio';
  name = 'Cardio Dialect';

  private hasKeyword(metrics: MetricContainer, keyword: string): boolean {
    return metrics.some(
      m =>
        (m.type === MetricType.Action || m.type === MetricType.Effort) &&
        typeof m.value === 'string' &&
        m.value.toUpperCase().includes(keyword.toUpperCase())
    );
  }

  private hasDistance(metrics: MetricContainer): boolean {
    return metrics.some(m => m.type === MetricType.Distance);
  }

  analyze(statement: ICodeStatement): DialectAnalysis {
    const hints: string[] = [];
    const metrics = MetricContainer.from(statement.metrics);

    for (const activity of CARDIO_ACTIVITY_KEYWORDS) {
      if (activity.keywords.some(keyword => this.hasKeyword(metrics, keyword))) {
        hints.push('domain.cardio', ...activity.hints);
      }
    }

    // TODO: Detect distance-only statements (e.g. "400m", "5km" with no activity keyword)
    // These are generically cardio-flavoured even without an explicit activity name.
    if (hints.length === 0 && this.hasDistance(metrics)) {
      hints.push('domain.cardio');
      hints.push('behavior.distance_based');
    }

    // If any cardio activity was found, also tag as distance/pace relevant
    if (hints.includes('domain.cardio') && this.hasDistance(metrics)) {
      hints.push('behavior.distance_based');
      hints.push('behavior.pace_based');
    }

    return { metrics: hintsToContainer(hints) };
  }
}
