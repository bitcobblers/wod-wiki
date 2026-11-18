import { IMetric, MetricOrigin, MetricType } from '@bitcobblers/wod-wiki-core';
import { MetricContainer } from '@bitcobblers/wod-wiki-core';

/**
 * Hint helpers + canonical hint vocabulary contract.
 *
 * A "hint" is a dot-namespaced string (e.g. `workout.amrap`,
 * `behavior.required_timer`) that dialects, effort markdown files, and the
 * parser attach to a statement so that compiler strategies and the label
 * composer can make decisions. Hints used to live in a parallel `Set<string>`
 * channel on the statement; they now flow through the single metric channel
 * as `MetricType.Hint` metrics.
 *
 * Hint metrics are deliberately excluded from display resolution
 * (see ownership `legacyAdapters`) and from runtime block fragments
 * (see `BlockBuilder.setFragments`), so they never surface as visible metrics.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL HINT VOCABULARY (Tier 3 §3.2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A new dialect or effort author can self-serve the answer to "which
 * hints are actually consumed by the runtime?" by reading
 * {@link CONSUMED_HINTS}. Any other hint key is **analytics-only** today:
 * it reaches the output stream and processors, but does not affect
 * compilation, label generation, or exit ordering. There is no hidden
 * "the strategy that consumes this hint" to discover.
 *
 * Categories:
 *
 * - **compiler-consumed** — `BEHAVIOR_REPEATING_INTERVAL`,
 *   `BEHAVIOR_REQUIRED_TIMER`, `BEHAVIOR_INJECT_REST`. Setting one of these
 *   from a dialect (or an effort — see Tier 3 §3.3) flips a strategy-level
 *   decision at compile time (e.g. IntervalLogicStrategy matches on
 *   `BEHAVIOR_REPEATING_INTERVAL`).
 * - **label-consumed** — `LABEL_AMRAP`, `LABEL_EMOM`, `LABEL_TABATA`,
 *   `LABEL_FOR_TIME`. These override the generated label in
 *   `LabelComposer.getLogicKeyword` (the only consumer).
 * - **analytics-only / sport-domain** — every other hint a sport dialect
 *   emits (e.g. `workout.run`, `ClimbMetricType.Grade`, `domain.climb.*`)
 *   is intentionally analytics-only: it surfaces on the output stream
 *   for processors and review-grid consumers, and never affects
 *   compilation. If you write a custom analytics processor, gate it via
 *   `requiredMetrics` (see `IAnalyticsProcessorDescriptor`) — not by
 *   inventing a new hint.
 *
 * If you need a new compiler-consumed or label-consumed hint, add it
 * here and update the consumer(s) in the same PR. If you only need
 * analytics-only data, emit a regular `MetricType.Metric` (or a
 * domain-specific MetricType) — no new hint key required.
 */

/** Hint keys currently consumed by compiler strategies or the label composer. */
export const CONSUMED_HINTS = {
  /** IntervalLogicStrategy: treats the block as an EMOM-style repeating interval. */
  REPEATING_INTERVAL: 'behavior.repeating_interval',
  /** GenericTimerStrategy: block cannot be skipped past until timer:complete fires. */
  REQUIRED_TIMER: 'behavior.required_timer',
  /** GenericTimerStrategy: injects a rest block between repeating intervals. */
  INJECT_REST: 'behavior.inject_rest',
  /** LabelComposer: overrides the generated label with a workout-type name. */
  LABEL_AMRAP: 'workout.amrap',
  LABEL_EMOM: 'workout.emom',
  LABEL_TABATA: 'workout.tabata',
  LABEL_FOR_TIME: 'workout.for_time',
} as const;

/** Derived from CONSUMED_HINTS — useful for runtime validation ("is this hint consumed?"). */
export const CONSUMED_HINT_KEYS: readonly string[] = Object.values(CONSUMED_HINTS);

/** A read surface that exposes metrics, via `rawMetrics` or a `metrics` field. */
interface MetricBearing {
  rawMetrics?: IMetric[];
  metrics?: MetricContainer | IMetric[];
}

/** Resolve a flat metric list from any metric-bearing source. */
function metricsOf(source: MetricBearing | undefined): IMetric[] {
  if (!source) return [];
  if (Array.isArray(source.rawMetrics)) return source.rawMetrics;
  const m = source.metrics;
  if (!m) return [];
  if (Array.isArray(m)) return m;
  // MetricContainer exposes a rawMetrics getter.
  return m.rawMetrics ?? [];
}

/** Create a single hint metric. `icon` opts the hint into display: icon-only chip, hint text on hover. */
export function hintMetric(hint: string, origin: MetricOrigin = 'dialect', icon?: string): IMetric {
  return { type: MetricType.Hint, value: hint, image: hint, origin, ...(icon ? { icon } : {}) };
}

/**
 * Build (or extend) a {@link MetricContainer} of hint metrics from a list of
 * hint strings. Duplicate hint strings are collapsed.
 */
export function hintsToContainer(
  hints: readonly string[],
  existing?: MetricContainer,
  origin: MetricOrigin = 'dialect',
): MetricContainer {
  const container = existing ?? MetricContainer.empty('dialect');
  const seen = new Set(getHints(container));
  for (const hint of hints) {
    if (seen.has(hint)) continue;
    seen.add(hint);
    container.add(hintMetric(hint, origin));
  }
  return container;
}

/** All hint strings carried by a metric-bearing source. */
export function getHints(source: MetricBearing | undefined): string[] {
  return metricsOf(source)
    .filter(m => m.type === MetricType.Hint && typeof m.value === 'string')
    .map(m => m.value as string);
}

/** Whether a metric-bearing source carries a given hint. */
export function hasHint(source: MetricBearing | undefined, hint: string): boolean {
  return metricsOf(source).some(m => m.type === MetricType.Hint && m.value === hint);
}
