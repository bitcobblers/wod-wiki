import type { IMetric, MetricOrigin, MetricOwnershipLayer } from '../models/Metric';

export type { MetricOwnershipLayer };

/**
 * Canonical low->high ownership chain used by characterization tests and
 * ownership resolution work.
 */
export const METRIC_OWNERSHIP_LAYER_CHAIN: readonly MetricOwnershipLayer[] = [
  'parser',
  'dialect',
  'user-plan',
  'runtime',
  'user-entry',
] as const;

/**
 * Compatibility map from the current mixed-purpose `origin` field into the
 * canonical ownership-layer vocabulary.
 */
export const LEGACY_ORIGIN_TO_OWNERSHIP_LAYER: Record<MetricOrigin, MetricOwnershipLayer> = {
  parser: 'parser',
  compiler: 'dialect',
  dialect: 'dialect',
  hinted: 'dialect',
  'user-plan': 'user-plan',
  runtime: 'runtime',
  tracked: 'runtime',
  analyzed: 'runtime',
  'analyzed-estimated': 'runtime',
  execution: 'runtime',
  user: 'user-entry',
  collected: 'user-entry',
  diagnostic: 'runtime',
};

export interface MetricWithOptionalOwnershipLayer extends IMetric {
  readonly ownershipLayer?: MetricOwnershipLayer;
}

export interface MetricOwnershipQuery {
  readonly types?: readonly (IMetric['type'])[];
  readonly layers?: readonly MetricOwnershipLayer[];
}

export type MetricOwnershipOutcome =
  | 'visible'
  | 'hidden-by-layer'
  | 'hidden-by-suppressor'
  | 'suppressor';

export interface MetricOwnershipResolvedContribution {
  readonly metric: IMetric;
  readonly type: IMetric['type'];
  readonly layer: MetricOwnershipLayer;
  readonly outcome: MetricOwnershipOutcome;
}

export interface MetricOwnershipPromotionCandidate {
  readonly metric: IMetric;
  readonly type: IMetric['type'];
  readonly layer: MetricOwnershipLayer;
  readonly reason: 'shadowed-by-higher-layer' | 'suppressed';
  readonly blockedByLayer?: MetricOwnershipLayer;
}

export interface MetricOwnershipTypeExplanation {
  readonly type: IMetric['type'];
  readonly winnerLayer?: MetricOwnershipLayer;
  readonly suppressed: boolean;
  readonly entries: readonly MetricOwnershipResolvedContribution[];
}

export interface MetricOwnershipLedger {
  raw(query?: MetricOwnershipQuery): IMetric[];
  visible(query?: MetricOwnershipQuery): IMetric[];
  byLayer(query?: MetricOwnershipQuery): Partial<Record<MetricOwnershipLayer, IMetric[]>>;
  promotionCandidates(query?: MetricOwnershipQuery): MetricOwnershipPromotionCandidate[];
  explain(query?: MetricOwnershipQuery): MetricOwnershipTypeExplanation[];
}

export function getMetricOwnershipLayer(origin: MetricOrigin | undefined): MetricOwnershipLayer {
  return LEGACY_ORIGIN_TO_OWNERSHIP_LAYER[origin ?? 'parser'] ?? 'parser';
}
