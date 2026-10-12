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
import type { CalculationDefinition } from '@bitcobblers/wod-wiki-engine';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { OutputStatement, type IOutputStatement } from '@bitcobblers/wod-wiki-engine';
import { eventsToStoredLogs } from '@bitcobblers/wod-wiki-wql';
import type { IEffortResolver } from '@bitcobblers/wod-wiki-lang';
import {
  toStoredOutputStatement,
  type ScriptBlock,
  type StoredOutputStatement,
} from '@/components/Editor/types';
import type { AnalyticsDataPoint, ResultOrigin, EventRecord } from '@/types/storage';

export interface DeriveWorkoutOptions {
  /** Block the workout was run from — supplies dialect + statements for the
   *  engine profile. Parse statements first if the block may lack them. */
  block: ScriptBlock;
  effortResolver?: IEffortResolver;
  userProfile?: { vo2max?: number };
  /** User-authored composed calcs (#880), registered after the built-ins. */
  calcs?: CalculationDefinition[];
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

/**
 * Map a summary projection name to its Canonical Metric Key — the one key two
 * workouts must share for an aggregate to be compared across them. Same key
 * in fact rows and display. 'Total Volume' → 'totalVolume', 'TIS' → 'tis'.
 */
export function resolveCanonicalMetricKey(projectionName: string): string {
  const words = projectionName.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Summary fact normalization — logs → persisted AnalyticsDataPoint rows
// ---------------------------------------------------------------------------

/**
 * Identity of the block a result belongs to, stamped on every fact row.
 */
export interface SummaryFactIdentity {
  noteId: string;
  resultId: string;
  blockId: string;
  blockVersion: number;
  /** Content-stable cross-note join key. */
  blockContentId?: string;
  /** Which surface produced the result; trend queries exclude 'playground' by default. */
  origin?: ResultOrigin;
  /** FK to the `page` store (copied from the parent note). */
  pageId?: string;
  /**
   * Canonical workout time — Session.createdAt (true workout end).
   * Every fact row carries it as `timestamp` so time-range queries mean
   * "when the workout happened", never "when the metric was derived".
   */
  workoutTimestamp?: number;
}

/** Logs shape read by normalizeSummaryFacts (StoredOutputStatement-compatible). */
export interface SummaryFactSourceOutput {
  outputType: string;
  metrics: readonly {
    type: string;
    value?: unknown;
    image?: string;
    unit?: string;
    /** Summary-processor payload (effortSlug / effortDiscipline / effortIntensityTier / …). */
    metadata?: Record<string, unknown>;
  }[];
  timeSpan: { started: number; ended?: number };
}

/** Read a string metadata field off the projection value metric, when present. */
function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Group-tag pairs from grouped composed-calc emission, key-sorted. */
function readGroupTags(metadata: Record<string, unknown> | undefined): Record<string, string> | undefined {
  const tags = metadata?.groupTags;
  if (!tags || typeof tags !== 'object') return undefined;
  const entries = Object.entries(tags as Record<string, unknown>)
    .filter((pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].length > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Convert Tier-2 summary outputs (outputType 'analytics') in a statement
 * stream into persisted fact rows — one row per result × Canonical Metric Key.
 *
 * The analytics store holds SUMMARY FACTS ONLY (CONTEXT.md, 2026-07-20):
 * per-segment data (Tier 0 + Tier 1) is not denormalized here — it lives as
 * event rows, the authoritative store for a single workout (V21).
 *
 * These rows exist for cross-workout queries ("compare total volume across my
 * last 30 Fran runs"). If this write fails or is skipped, the workout result
 * remains fully functional.
 *
 * V12: effort identity (effortSlug / discipline / intensityTier) is carried
 * from the summary processor's metadata onto the row, populating the
 * by-effort / by-discipline indexes; `timestamp` is the canonical workout
 * time (identity.workoutTimestamp = Session.createdAt), not the
 * derivation-time stamp the engine puts on the output's timeSpan.
 */
export function normalizeSummaryFacts(
  logs: readonly SummaryFactSourceOutput[],
  identity: SummaryFactIdentity,
): LegacyFactRow[] {
  const now = Date.now();
  const rowsByKey = new Map<string, LegacyFactRow>();

  for (const output of logs) {
    if (output.outputType !== 'analytics') continue;
    const label = output.metrics.find(m => m.type === MetricType.Label);
    const value = output.metrics.find(m => m.type !== MetricType.Label && typeof m.value === 'number');
    if (!label || !value) continue;

    const projectionName = String(label.value ?? label.image ?? '');
    if (!projectionName) continue;
    // Composed calcs carry their Canonical Metric Key explicitly (#878);
    // legacy projections fall back to name-derived keys during cutover.
    const metricKey = metadataString(value.metadata, 'canonicalKey') ?? resolveCanonicalMetricKey(projectionName);

    const effortSlug = metadataString(value.metadata, 'effortSlug');
    const discipline = metadataString(value.metadata, 'effortDiscipline');
    const intensityTier = metadataString(value.metadata, 'effortIntensityTier');
    const grade = metadataString(value.metadata, 'grade');

    // Row key = metricKey + sorted group-tag pairs (spec §7.1:
    // `totalVolume:effort=thruster`). Grouped dims auto-tag; legacy
    // per-effort projections tag `effort` from their effortSlug metadata.
    const groupTags = readGroupTags(value.metadata) ?? (effortSlug ? { effort: effortSlug } : undefined);
    const rowKey = groupTags
      ? `${metricKey}:${Object.entries(groupTags).map(([k, v]) => `${k}=${v}`).join(':')}`
      : metricKey;

    rowsByKey.set(rowKey, {
      id: `${identity.resultId}-${rowKey}-${now}`,
      noteId: identity.noteId,
      blockContentId: identity.blockContentId,
      origin: identity.origin,
      pageId: identity.pageId,
      grain: 'summary',
      blockId: identity.blockId,
      blockVersion: identity.blockVersion,
      resultId: identity.resultId,
      type: metricKey,
      value: value.value as number,
      unit: value.unit,
      label: projectionName,
      metricKey,
      metricLabel: projectionName,
      metricUnit: value.unit,
      ...(effortSlug ? { effortSlug } : {}),
      ...(discipline ? { discipline } : {}),
      ...(intensityTier ? { intensityTier } : {}),
      ...(grade ? { grade } : {}),
      timestamp: identity.workoutTimestamp ?? output.timeSpan.started ?? now,
      createdAt: now,
    });
  }

  return Array.from(rowsByKey.values());
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
export type LegacyFactRow = Omit<AnalyticsDataPoint, 'grain'> & { grain?: 'segment' | 'summary' | 'rollup' };

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
