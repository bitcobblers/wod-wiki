import { AnalyticsEngine } from './AnalyticsEngine';
import { StandardAnalyticsProfile } from './StandardAnalyticsProfile';
import type { AnalyticsProfileContext } from './IAnalyticsProfile';
import type { AnalyticsContext } from './AnalyticsContext';
import type { ScriptBlock, TagIndex } from '@bitcobblers/wod-wiki-core';
import { MetricType } from '@bitcobblers/wod-wiki-core';
import { InMemoryEffortRegistry } from '../effort-registry/InMemoryEffortRegistry';
import { EffortResolver } from '../effort-registry/EffortResolver';
import { bundledEfforts } from '../effort-registry/data/bundled-efforts';
import type { IEffortResolver } from '../effort-registry/types';
import type { ReferenceIndex } from '../effort-registry/reference-resolution';
import type { CalculationDefinition } from './calc/types';

export interface CreateAnalyticsEngineResult {
  engine: AnalyticsEngine;
  analyticsContext: AnalyticsContext;
}

export interface CreateAnalyticsEngineOptions {
  effortResolver?: IEffortResolver;
  /** Shared reference index — canonical effort/equipment resolution for enrichment. */
  references?: ReferenceIndex;
  userProfile?: { vo2max?: number };
  /** User-authored composed calcs (#880), registered after the built-ins. */
  calcs?: CalculationDefinition[];
  /**
   * The tag catalogue — the tags a script can reference and the functions
   * they carry.
   */
  tags?: TagIndex;
  /** Tags active for the whole run, whatever the segments say. */
  activeTags?: readonly string[];
}

/**
 * Creates a fully-configured AnalyticsEngine for a workout block.
 *
 * Extracts the dialect and metric types from the block, builds a
 * StandardAnalyticsProfile, and assembles the engine with all
 * applicable realtime and summary processors.
 *
 * When no effortResolver is provided, creates a default one backed
 * by the bundled effort catalog (synchronously seeded).
 */
export function createAnalyticsEngineForBlock(
  block: ScriptBlock,
  options?: CreateAnalyticsEngineOptions
): CreateAnalyticsEngineResult {
  const dialect = block.dialect || 'time';

  const scriptMetricTypes = new Set<MetricType | string>();
  if (block.statements) {
    for (const stmt of block.statements) {
      for (const metric of stmt.metrics) {
        scriptMetricTypes.add(metric.type);
      }
    }
  }

  let effortResolver = options?.effortResolver;
  if (!effortResolver) {
    const registry = new InMemoryEffortRegistry();
    registry.seed(bundledEfforts);
    effortResolver = new EffortResolver(registry);
  }

  const analyticsContext: AnalyticsContext = {
    effortResolver,
    ...(options?.references ? { references: options.references } : {}),
  };

  const context: AnalyticsProfileContext = {
    dialect,
    scriptMetricTypes,
    analyticsContext,
    userProfile: options?.userProfile,
    calcs: options?.calcs,
    tags: options?.tags,
    activeTags: options?.activeTags,
  };

  const profile = new StandardAnalyticsProfile();
  const { realtime, summary } = profile.build(context);

  const engine = new AnalyticsEngine();
  for (const processor of realtime) {
    engine.addRealtimeProcessor(processor);
  }
  for (const processor of summary) {
    engine.addSummaryProcessor(processor);
  }

  return { engine, analyticsContext };
}
