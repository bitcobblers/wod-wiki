import { IDialect, DialectAnalysis } from '@bitcobblers/wod-wiki-core';
import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { hintsToContainer } from '../metrics/hints';
import { UnitRegistry } from '../metrics/units';
import { fuseUnits } from './units/fuseUnits';

const WOD_UNITS = UnitRegistry.of([
  { canonical: 'pood', dimension: 'mass', aliases: ['poods', 'pd'] },
]);

/**
 * WOD (Workout of the Day) dialect for recognizing general structured workout patterns.
 *
 * Recognizes:
 * - STRENGTH: Heavy barbell / loaded movement blocks
 * - METCON: Metabolic conditioning blocks
 * - SKILLS: Skill/technique practice blocks
 * - WOD: Explicit "WOD" keyword
 * - SUPERSET: Multiple exercises grouped with no rest
 *
 * Emitted hints (dot-namespaced):
 *   domain.wod            - any statement processed by this dialect
 *   workout.strength      - heavy loaded-movement block
 *   workout.metcon        - metabolic conditioning block
 *   workout.skills        - skill/technique block
 *   workout.superset      - superset / paired-set block
 *   behavior.load_bearing - statement involves significant external load
 */
export class WodDialect implements IDialect {
  id = 'wod';
  name = 'WOD Dialect';

  transform(statement: ICodeStatement): void {
    fuseUnits(statement, WOD_UNITS);
  }

  /** Case-insensitive keyword check on Action/Effort metrics */
  private hasKeyword(metrics: MetricContainer, keyword: string): boolean {
    return metrics.some(
      m =>
        (m.type === MetricType.Action || m.type === MetricType.Effort) &&
        typeof m.value === 'string' &&
        m.value.toUpperCase().includes(keyword.toUpperCase())
    );
  }

  analyze(statement: ICodeStatement): DialectAnalysis {
    const hints: string[] = [];
    const metrics = MetricContainer.from(statement.metrics);

    // TODO: Detect STRENGTH blocks
    // "Strength: 5x5 Back Squat", "5x5 225lb Squat" etc.
    if (this.hasKeyword(metrics, 'STRENGTH')) {
      hints.push('domain.wod');
      hints.push('workout.strength');
      hints.push('behavior.load_bearing');
    }

    // TODO: Detect METCON blocks
    // "Metcon", "MetCon", "Metabolic Conditioning"
    if (this.hasKeyword(metrics, 'METCON') || this.hasKeyword(metrics, 'METABOLIC')) {
      hints.push('domain.wod');
      hints.push('workout.metcon');
    }

    // TODO: Detect SKILLS blocks
    // "Skills", "Skill Work", "Technique"
    if (this.hasKeyword(metrics, 'SKILL') || this.hasKeyword(metrics, 'TECHNIQUE')) {
      hints.push('domain.wod');
      hints.push('workout.skills');
    }

    // TODO: Detect explicit WOD keyword
    if (this.hasKeyword(metrics, 'WOD')) {
      hints.push('domain.wod');
    }

    // TODO: Detect SUPERSET blocks
    // "Superset", "A1/A2 pairing", consecutive exercises without rest
    if (this.hasKeyword(metrics, 'SUPERSET')) {
      hints.push('domain.wod');
      hints.push('workout.superset');
    }

    return { metrics: hintsToContainer(hints) };
  }
}
