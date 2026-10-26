/**
 * workoutDerivation — the single module that owns "derive the analytics view
 * of a workout" (Candidates 4 + 5, analytics-two-layer-derivation-deep-dive).
 *
 * The AnalyticsEngine is headless: it takes IOutputStatements in and produces
 * annotations (Tier 1, per-segment via IRealtimeProcessor) and summaries
 * (Tier 2, whole-result via ISummaryProcessor) with no runtime lifecycle.
 * This module drives it directly over STORED logs, skipping OutputEmitter —
 * which is exactly what post-hoc re-derivation (replay) needs.
 *
 * Policies enforced here (one home, no drift):
 *
 * LEGACY (wayfinder datadog-analytics ticket 11): this module duplicates
 * `resolveCanonicalMetricKey` and the V12/V13 fact-row emitters of
 * `packages/wql/src/derivation.ts` for pre-V16 upgrade backfills. Do NOT
 * extend it and do NOT port new identity behavior into it (typed field
 * references live only in the wql canonical copy); retirement belongs to
 * the DB-v17 minimum-version decision (ticket 14).
 *   - Canonical input/output is StoredOutputStatement[] — a SINGLE logs
 *     stream holding all tiers. Tier 2 is discriminated by outputType
 *     ('analytics'); there is no separate analytics property (CONTEXT.md,
 *     2026-07-20 — the shapes-doc §2 split was rejected).
 *   - Tier-2 outputs in the input are DISCARDED and regenerated.
 *   - Tier-1 strip rule: only metrics with origin === 'analyzed' are removed
 *     before re-run; compile-time/runtime effort data AND predictions
 *     ('analyzed-estimated') are preserved — a recorded workout's predictions
 *     are frozen at recording time (CONTEXT.md, 2026-07-20).
 *   - Canonical Metric Key is the cross-workout join dimension, identical in
 *     fact rows and display: 'reps', 'distance', 'resistance', 'elapsed',
 *     'power', 'pace', 'totalVolume', 'tis', … (CONTEXT.md §Analytics).
 */
import { createAnalyticsEngineForBlock } from '@bitcobblers/wod-wiki-engine';
import type { CalculationDefinition, PropertyRuleInput } from '@bitcobblers/wod-wiki-engine';
import { OutputStatement, type IOutputStatement, type TagIndex } from '@bitcobblers/wod-wiki-engine';
import {
  eventsToStoredLogs,
  normalizeSummaryFacts,
  resolveCanonicalMetricKey,
  type SummaryFactIdentity,
  type SummaryFactSourceOutput,
} from '@bitcobblers/wod-wiki-wql';
import type { IEffortResolver } from '@bitcobblers/wod-wiki-lang';
import {
  toStoredOutputStatement,
  type ScriptBlock,
  type StoredOutputStatement,
} from '@/components/Editor/types';
import type { AnalyticsDataPoint, EventRecord } from '@/types/storage';

export interface DeriveWorkoutOptions {
  /** Block the workout was run from — supplies dialect + statements for the
   *  engine profile. Parse statements first if the block may lack them. */
  block: ScriptBlock;
  effortResolver?: IEffortResolver;
  userProfile?: { vo2max?: number };
  /** User-authored composed calcs (#880), registered after the built-ins. */
  calcs?: CalculationDefinition[];
  tags?: TagIndex;
  activeTags?: readonly string[];
  propertySources?: readonly PropertyRuleInput[];
}

/**
 * Rehydrate a stored output into a live IOutputStatement for the engine.
 * The runtime assigns a fresh statement id; summary processors aggregate on
 * metrics, not ids, so id lineage is not preserved across replay.
 */
function toLiveOutputStatement(stored: StoredOutputStatement): IOutputStatement {
  return new OutputStatement({
    outputType: stored.outputType,
    timeSpan: stored.timeSpan,
    sourceBlockKey: stored.sourceBlockKey,
    stackLevel: stored.stackLevel,
    sourceStatementId: stored.sourceStatementId,
    line: stored.line,
    text: stored.text,
    dialect: stored.dialect,
    metrics: stored.metrics,
    parent: stored.parent,
    completionReason: stored.completionReason,
  });
}

/** Remove Tier-1 annotations so re-running processors can't double-apply. */
function stripAnalyzedMetrics(stored: StoredOutputStatement): StoredOutputStatement {
  return { ...stored, metrics: stored.metrics.filter(m => m.origin !== 'analyzed') };
}

/**
 * Derive Tier-1 annotations + Tier-2 summaries from stored logs by driving
 * the headless AnalyticsEngine directly. Returns the complete single logs
 * stream: input logs (minus stale Tier-2, annotations re-applied) followed by
 * the freshly generated Tier-2 summary outputs.
 */
export function deriveWorkoutFromLogs(
  logs: StoredOutputStatement[],
  options: DeriveWorkoutOptions,
): StoredOutputStatement[] {
  const { engine } = createAnalyticsEngineForBlock(options.block, {
    effortResolver: options.effortResolver,
    userProfile: options.userProfile,
    calcs: options.calcs,
    tags: options.tags,
    activeTags: options.activeTags,
    propertySources: options.propertySources,
  });

  const derived: StoredOutputStatement[] = [];
  for (const stored of logs) {
    if (stored.outputType === 'analytics') continue; // stale Tier 2 — regenerated below
    if (stored.outputType !== 'segment') {
      derived.push(stored);
      continue;
    }
    // Strip Tier-1 annotations so processors can't double-apply, then restore
    // any analyzed metric the engine did NOT regenerate (e.g. externally
    // captured analyzed SessionRPE) — purge-and-replay must not lose facts
    // no processor can recompute.
    const stripped = stripAnalyzedMetrics(stored);
    const enriched = engine.run(toLiveOutputStatement(stripped));
    const preserved = stored.metrics.filter(m =>
      m.origin === 'analyzed' && !enriched.metrics.some(e => e.origin === 'analyzed' && e.type === m.type));
    derived.push(toStoredOutputStatement(preserved.length
      ? new OutputStatement({ ...enriched, metrics: [...enriched.metrics, ...preserved] })
      : enriched));
  }

  return [...derived, ...engine.finalize().map(toStoredOutputStatement)];
}

/**
 * Replay seam (Candidate 5): re-derive a persisted result's analytics from
 * its canonical logs. Caller supplies the block context (recovered from the
 * result's immutable BlockRevision pinned at start).
 */
export function replayResultAnalytics(
  block: ScriptBlock,
  events: EventRecord[],
  options?: Omit<DeriveWorkoutOptions, 'block'>,
): StoredOutputStatement[] {
  return deriveWorkoutFromLogs(eventsToStoredLogs(events), { block, ...options });
}

export {
  resolveCanonicalMetricKey,
  normalizeSummaryFacts,
  type SummaryFactIdentity,
  type SummaryFactSourceOutput,
};
/** Read a string metadata field off the projection value metric, when present. */
function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}


/**
 * Normalize ALL metrics from a result's logs — summary facts (Tier 2) PLUS
 * atomic per-segment metrics (Tier 0/1) — into persisted AnalyticsDataPoint
 * rows.
 *
 * V13 expansion: the analytics store now holds every numeric metric emitted
 * by the runtime, not just summary projections. This makes atomic metrics
 * (reps, resistance, elapsed time per segment) available for indexed
 * cross-workout queries and threshold filters (via the by-value compound
 * index).
 *
 * Summary facts keep grain 'summary'; atomic segment metrics get grain
 * 'segment'. The two coexist in the same store, distinguished by grain.
 */
/** Legacy fact-row shape — the pre-V16 analytics store allowed grain
 *  'segment' | 'summary' | 'rollup'. Only the V12/V13 upgrade backfills still
 *  write these rows; V16 deletes the store in the same transaction. */
export type LegacyFactRow = Omit<AnalyticsDataPoint, 'grain'> & { grain?: 'segment' | 'summary' | 'rollup' | 'event' };

export function normalizeAllMetrics(
  logs: readonly SummaryFactSourceOutput[],
  identity: SummaryFactIdentity,
): LegacyFactRow[] {
  // Summary facts (Tier 2) — unchanged from normalizeSummaryFacts.
  const summaryFacts = normalizeSummaryFacts(logs, identity);

  // Atomic segment metrics (Tier 0/1) — one row per numeric metric per output.
  const now = Date.now();
  const segmentFacts: LegacyFactRow[] = [];
  let seq = 0;

  for (const output of logs) {
    if (output.outputType === 'analytics') continue; // handled by summary path
    for (const metric of output.metrics) {
      if (typeof metric.value !== 'number') continue;
      const metricKey = String(metric.type);
      const effortSlug = metadataString(metric.metadata, 'effortSlug');
      const discipline = metadataString(metric.metadata, 'effortDiscipline');
      const intensityTier = metadataString(metric.metadata, 'effortIntensityTier');
      const grade = metadataString(metric.metadata, 'grade');

      segmentFacts.push({
        id: `${identity.resultId}-seg${seq++}-${metricKey}-${now}`,
        noteId: identity.noteId,
        blockContentId: identity.blockContentId,
        origin: identity.origin,
        pageId: identity.pageId,
        grain: 'segment',
        blockId: identity.blockId,
        blockVersion: identity.blockVersion,
        resultId: identity.resultId,
        type: metricKey,
        value: metric.value,
        unit: metric.unit,
        label: metricKey,
        metricKey,
        metricLabel: metricKey,
        metricUnit: metric.unit,
        ...(effortSlug ? { effortSlug } : {}),
        ...(discipline ? { discipline } : {}),
        ...(intensityTier ? { intensityTier } : {}),
        ...(grade ? { grade } : {}),
        timestamp: identity.workoutTimestamp ?? output.timeSpan.started ?? now,
        createdAt: now,
      });
    }
  }

  return [...summaryFacts, ...segmentFacts];
}
