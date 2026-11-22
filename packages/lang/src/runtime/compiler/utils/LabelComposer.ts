import { ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';
import { metricPresentation } from '../../../metrics/presentation';
import { hasHint, CONSUMED_HINTS } from '../../../metrics/hints';

export interface LabelOptions {
  includeMetric?: boolean;
  includeLogic?: boolean;
  includeIdentity?: boolean;
  includeAttributes?: boolean;
  defaultLabel?: string;
  format?: 'metric-first' | 'logic-first' | 'identity-first';
}

/**
 * Utility for composing standardized labels for runtime blocks from parsed statements.
 *
 * Standardized Pattern: [Logic] [Metric] [Identity] [Attributes]
 */
export class LabelComposer {
  /**
   * Builds a descriptive label from a set of statements.
   */
  static build(statements: ICodeStatement[], options: LabelOptions = {}): string {
    const {
      includeMetric = true,
      includeLogic = true,
      includeIdentity = true,
      includeAttributes = true,
      defaultLabel = "Block",
      format = 'logic-first'
    } = options;

    const allFragments = MetricContainer.from(statements
      .flatMap(s => MetricContainer.from(s.metrics).toArray())
      .filter(f => f.origin !== 'runtime' && f.type !== MetricType.Hint));

    if (allFragments.length === 0) return defaultLabel;

    // 1. Check for explicit Label metrics
    const explicitLabel = allFragments.find(f => f.type === MetricType.Label);
    if (explicitLabel) return explicitLabel.image || explicitLabel.value?.toString() || defaultLabel;

    const metrics = includeMetric ? this.getPrimaryMetric(allFragments) : undefined;
    const logic = includeLogic ? this.getLogicKeyword(statements, allFragments) : undefined;
    const identity = includeIdentity ? this.getIdentityText(allFragments) : undefined;
    const attributes = includeAttributes ? this.getAttributesText(allFragments) : undefined;

    const parts: string[] = [];

    if (format === 'logic-first') {
        if (logic) parts.push(logic);
        if (metrics) parts.push(metrics);
        if (identity) parts.push(identity);
        if (attributes) parts.push(attributes);
    } else if (format === 'metric-first') {
        if (metrics) parts.push(metrics);
        if (logic) parts.push(logic);
        if (identity) parts.push(identity);
        if (attributes) parts.push(attributes);
    } else { // identity-first
        if (identity) parts.push(identity);
        if (metrics) parts.push(metrics);
        if (logic) parts.push(logic);
        if (attributes) parts.push(attributes);
    }

    // Fallback: If no structured parts, join all non-runtime metrics
    if (parts.length === 0) {
      return allFragments
        .filter(f => !!f.image && !metricPresentation.isStructural(f))
        .map(f => f.image)
        .join(" ") || defaultLabel;
    }

    return parts.join(" ").trim().replace(/\s+/g, ' ');
  }

  private static getPrimaryMetric(metrics: MetricContainer): string | undefined {
    // Priority 1: Rounds sequence (21-15-9) or Rounds count
    const rounds = metrics.find(f => f.type === MetricType.Rounds);
    if (rounds && rounds.image) return rounds.image;

    // Priority 2: Duration (5:00, :30)
    const duration = metrics.find(f => f.type === MetricType.Duration);
    if (duration && duration.image) return duration.image;

    // Note: We don't use Rep metrics here if they are part of the identity (e.g. "100 Swings")
    // Unless there is NO identity.
    return undefined;
  }

  private static getLogicKeyword(statements: ICodeStatement[], metrics: MetricContainer): string | undefined {
    // Check hints first (from Dialect analysis)
    if (statements.some(s => hasHint(s, CONSUMED_HINTS.LABEL_AMRAP))) return 'AMRAP';
    if (statements.some(s => hasHint(s, CONSUMED_HINTS.LABEL_EMOM))) return 'EMOM';
    if (statements.some(s => hasHint(s, CONSUMED_HINTS.LABEL_TABATA))) return 'TABATA';
    if (statements.some(s => hasHint(s, CONSUMED_HINTS.LABEL_FOR_TIME))) return 'FOR TIME';

    // Fallback: Check for keywords in metrics
    const keywords = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'];
    for (const frag of metrics) {
      const val = (frag.image || frag.value?.toString() || "").toUpperCase();
      if (keywords.includes(val)) return val;
    }

    return undefined;
  }

  private static getIdentityText(metrics: MetricContainer): string | undefined {
    const logicKeywords = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'];
    
    // Filter metrics that contribute to the identity
    // We include Reps here if they are interleaved (e.g. "100 KB Swings")
    const identityFragments = metrics.filter(f => {
      if (f.type === MetricType.Duration || f.type === MetricType.Rounds || 
          f.type === MetricType.Resistance || f.type === MetricType.Distance ||
          f.type === MetricType.Lap || f.type === MetricType.Group ||
          f.type === MetricType.Equipment) {
          return false;
      }
      const val = (f.image || f.value?.toString() || "").toUpperCase();
      return !logicKeywords.includes(val);
    });

    if (identityFragments.length === 0) return undefined;
    return identityFragments.map(f => f.image).join(" ").trim();
  }

  private static getAttributesText(metrics: MetricContainer): string | undefined {
    const attrFragments = metrics.filter(f => 
      f.type === MetricType.Resistance || 
      f.type === MetricType.Distance
    );

    if (attrFragments.length === 0) return undefined;
    return attrFragments.map(f => f.image).join(" ").trim();
  }
}
