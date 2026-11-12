import { IDialect, DialectAnalysis } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { hintsToContainer } from '../metrics/hints';
import { UnitRegistry } from '../metrics/units';
import { fuseUnits } from './units/fuseUnits';

const CROSSFIT_UNITS = UnitRegistry.of([
  { canonical: 'pood', dimension: 'mass', aliases: ['poods', 'pd'] },
]);

/**
 * CrossFit dialect for recognizing CrossFit-specific workout patterns.
 * 
 * Recognizes:
 * - AMRAP: "As Many Rounds As Possible" - time-bound workout
 * - EMOM: "Every Minute On the Minute" - repeating interval workout
 * - FOR TIME: Time-capped workout with completion goal
 * - TABATA: High-intensity interval protocol (20s work / 10s rest)
 */
export class CrossFitDialect implements IDialect {
  id = 'crossfit';
  name = 'CrossFit Dialect';

  transform(statement: ICodeStatement): void {
    fuseUnits(statement, CROSSFIT_UNITS);
  }

  /**
   * Check if any Action or Effort metrics contains a keyword (case-insensitive)
   */
  private hasKeyword(metrics: MetricContainer, keyword: string): boolean {
    return metrics.some(f =>
      (f.type === MetricType.Action || f.type === MetricType.Effort) &&
      typeof f.value === 'string' &&
      f.value.toUpperCase().includes(keyword)
    );
  }

  /**
   * Check if statement has children (is a parent block)
   */
  private hasChildren(statement: ICodeStatement): boolean {
    return statement.children && statement.children.length > 0;
  }

  analyze(statement: ICodeStatement): DialectAnalysis {
    const hints: string[] = [];
    const metrics = MetricContainer.from(statement.metrics);

    // Check for AMRAP - time-bound workout
    const isAmrap = this.hasKeyword(metrics, 'AMRAP');
    if (isAmrap) {
      hints.push('behavior.time_bound');
      hints.push('workout.amrap');
    }

    // Check for EMOM - repeating interval workout
    // Explicit EMOM keyword
    const isEmom = this.hasKeyword(metrics, 'EMOM');
    if (isEmom) {
      hints.push('behavior.repeating_interval');
      hints.push('workout.emom');
    }

    // Implicit EMOM: Rounds + Timer + Children pattern
    // e.g., "(20) :60" with child statements implies EMOM
    // - Rounds specify how many intervals
    // - Timer specifies interval duration (defaults to 60s if not specified)
    // - Children are executed within each interval
    if (!isEmom && !isAmrap) {
      const hasRounds = metrics.some(f => f.type === MetricType.Rounds);
      const hasTimer = metrics.some(f => f.type === MetricType.Duration);
      const hasChildStatements = this.hasChildren(statement);

      if (hasRounds && hasTimer && hasChildStatements) {
        hints.push('behavior.repeating_interval');
        hints.push('workout.emom');
        hints.push('workout.implicit_emom');
      }
    }

    // Check for FOR TIME - time-bound workout with completion goal
    if (this.hasKeyword(metrics, 'FOR TIME')) {
      hints.push('behavior.time_bound');
      hints.push('workout.for_time');
    }

    // Check for TABATA - high-intensity interval protocol
    if (this.hasKeyword(metrics, 'TABATA')) {
      hints.push('behavior.repeating_interval');
      hints.push('workout.tabata');
    }

    return { metrics: hintsToContainer(hints) };
  }
}
