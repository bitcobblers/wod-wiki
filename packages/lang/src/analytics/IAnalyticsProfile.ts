import type { MetricType, TagIndex } from '@bitcobblers/wod-wiki-core';
import type { FenceDialect } from '@bitcobblers/wod-wiki-core';
import type { IRealtimeProcessor } from './IRealtimeProcessor';
import type { ISummaryProcessor } from './ISummaryProcessor';
import type { AnalyticsContext } from './AnalyticsContext';
import type { CalculationDefinition } from './calc/types';
import type { PropertyRuleInput } from './calc/shakeOutQueue';

/**
 * Context used to select processors for a given workout.
 */
export interface AnalyticsProfileContext {
  dialect: FenceDialect;
  scriptMetricTypes: ReadonlySet<MetricType | string>;

  /**
   * Optional user physiological profile. Used by calculations that personalize
   * output (the TIS composed calc uses vo2max to compute METmax).
   */
  userProfile?: {
    /** VO2max in mL/kg/min — for personalized MET-Score normalization */
    vo2max?: number;
  };

  /**
   * Analytics context with injected services (e.g. effort resolver).
   * When provided, the profile wires two-pass effort resolution and
   * processors consume resolved effort data instead of hardcoded lookups.
   */
  analyticsContext?: AnalyticsContext;

  /**
   * User-authored composed calcs (#880), registered after the built-ins so
   * they override same-id built-ins and evaluate at high priority.
   */
  calcs?: CalculationDefinition[];

  /**
   * The tag catalogue — the tags a script can reference and the functions
   * they carry. A function a tag carries runs where that tag applies.
   */
  tags?: TagIndex;

  /**
   * Tags active for the whole run, whatever the segments say — the bundle a
   * profile applies.
   */
  activeTags?: readonly string[];
  /** Property Note metric/summary rules active for this run or block. */
  propertySources?: readonly PropertyRuleInput[];
}

/**
 * Profile that assembles the realtime and summary processor lists
 * for a given workout context.
 */
export interface IAnalyticsProfile {
  build(context: AnalyticsProfileContext): {
    realtime: IRealtimeProcessor[];
    summary: ISummaryProcessor[];
  };
}
