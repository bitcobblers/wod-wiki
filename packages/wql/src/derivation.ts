/**
 * Workout derivation helpers for WQL QueryService and cross-store joins.
 */

import {
  MetricType,
  createMetricOwnershipLedger,
  fieldRefKey,
  normalizeFieldPath,
  valueKindOf,
  type AnalyticsDataPoint,
  type FieldRef,
  type IMetric,
  type ResultOrigin,
  type StoredOutputStatement,
  type EventRecord,
} from '@bitcobblers/wod-wiki-core';

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

/**
 * Identity of the block a result belongs to, stamped on every fact row.
 */
export interface SummaryFactIdentity {
  noteId: string;
  resultId: string;
  /** Actionable occurrence and saved revision that produced the result. */
  blockId?: string;
  blockVersion?: number;
  /** Content-stable cross-note join key. */
  blockContentId?: string;
  /** Which surface produced the result; trend queries exclude 'playground' by default. */
  origin?: ResultOrigin;
  /** FK to the `page` store (copied from the parent note). */
  pageId?: string;
  /**
   * Canonical workout time — WorkoutResult.createdAt (true workout end).
   * Every fact row carries it as `timestamp` so time-range queries mean
   * "when the workout happened", never "when the metric was derived".
   */
  workoutTimestamp?: number;
}

/** Logs shape read by normalizeSummaryFacts (StoredOutputStatement-compatible). */
export interface SummaryFactSourceOutput {
  outputType?: string;
  metrics: readonly {
    type?: string;
    value?: unknown;
    image?: string;
    unit?: string;
    /** Summary-processor payload (effortSlug / effortDiscipline / effortIntensityTier / …). */
    metadata?: Record<string, unknown>;
  }[];
  timeSpan?: { started?: number; ended?: number };
}

/** Read a string metadata field off the projection value metric, when present. */
function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Read the typed field reference off a metric's metadata (ticket 11) —
 * `{ path, kind, dimension? }` stamped by PropertyMetric at authoring.
 * Defensive shape check: legacy logs predate the stamp.
 */
function readFieldRef(metadata: Record<string, unknown> | undefined): FieldRef | undefined {
  const ref = metadata?.fieldRef;
  if (!ref || typeof ref !== 'object') return undefined;
  const { path, kind, dimension } = ref as Record<string, unknown>;
  if (typeof path !== 'string' || path.length === 0 || typeof kind !== 'string') return undefined;
  return { path, kind: kind as FieldRef['kind'], ...(typeof dimension === 'string' ? { dimension } : {}) };
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
 * One fold definition shared by every summary emitter: Tier-2 outputs
 * (outputType 'analytics') folded keep-last per rowKey
 * (`metricKey[:k=v…]`, group tags key-sorted — spec §7.1).
 */
interface FoldedSummary {
  projectionName: string;
  metricKey: string;
  value: number;
  unit?: string;
  effortSlug?: string;
  discipline?: string;
  intensityTier?: string;
  grade?: string;
  groupTags?: Record<string, string>;
  /** Typed identity (ticket 11) — carried so re-emission keeps ONE catalog
   *  identity for the field instead of splitting path-only duplicates. */
  fieldRef?: FieldRef;
  rowKey: string;
  started?: number;
}

function foldSummaryOutputs(logs: readonly SummaryFactSourceOutput[]): Map<string, FoldedSummary> {
  const folded = new Map<string, FoldedSummary>();
  for (const output of logs) {
    if (output.outputType !== 'analytics') continue;
    const label = output.metrics.find(m => m.type === MetricType.Label);
    const value = output.metrics.find(m => m.type !== MetricType.Label && typeof m.value === 'number');
    if (!label || !value) continue;

    const projectionName = String(label.value ?? label.image ?? '');
    if (!projectionName) continue;
    // Key resolution order (ticket 11): explicitly-stamped canonicalKey
    // (calc seeds, wellness) keeps working unchanged; the typed field
    // reference (PropertyMetric fieldRef) is the normalized custom identity;
    // legacy projections fall back to name-derived keys during cutover.
    const fieldRef = readFieldRef(value.metadata);
    const metricKey = metadataString(value.metadata, 'canonicalKey')
      ?? fieldRef?.path
      ?? resolveCanonicalMetricKey(projectionName);

    const effortSlug = metadataString(value.metadata, 'effortSlug');
    const discipline = metadataString(value.metadata, 'effortDiscipline');
    const intensityTier = metadataString(value.metadata, 'effortIntensityTier');
    const grade = metadataString(value.metadata, 'grade');

    // Grouped dims auto-tag; legacy per-effort projections tag `effort`
    // from their effortSlug metadata.
    const groupTags = readGroupTags(value.metadata) ?? (effortSlug ? { effort: effortSlug } : undefined);
    // Fold identity (ticket 11): typed variants fold under the full typed
    // key — path + kind + dimension — so two variants of one path never
    // fold together. Legacy rows keep the metricKey[:k=v…] shape.
    const rowKey = fieldRef
      ? `${fieldRefKey(fieldRef)}${groupTags ? ':' + Object.entries(groupTags).map(([k, v]) => `${k}=${v}`).join(':') : ''}`
      : groupTags
        ? `${metricKey}:${Object.entries(groupTags).map(([k, v]) => `${k}=${v}`).join(':')}`
        : metricKey;

    folded.set(rowKey, {
      projectionName, metricKey, value: value.value as number, unit: value.unit,
      effortSlug, discipline, intensityTier, grade, groupTags, rowKey,
      ...(fieldRef ? { fieldRef } : {}),
      started: output.timeSpan?.started,
    });
  }
  return folded;
}

/**
 * Convert Tier-2 summary outputs (outputType 'analytics') in a result's logs
 * into persisted fact rows — one row per result × Canonical Metric Key.
 */
export function normalizeSummaryFacts(
  logs: readonly SummaryFactSourceOutput[],
  identity: SummaryFactIdentity,
): AnalyticsDataPoint[] {
  const now = Date.now();
  return Array.from(foldSummaryOutputs(logs).values(), (f) => ({
    id: `${identity.resultId}-${f.rowKey}-${now}`,
    noteId: identity.noteId,
    blockContentId: identity.blockContentId,
    origin: identity.origin,
    pageId: identity.pageId,
    grain: 'summary' as const,
    blockId: identity.blockId ?? '',
    blockVersion: identity.blockVersion ?? 0,
    resultId: identity.resultId,
    type: f.metricKey,
    value: f.value,
    unit: f.unit,
    label: f.projectionName,
    metricKey: f.metricKey,
    metricLabel: f.projectionName,
    metricUnit: f.unit,
    ...(f.effortSlug ? { effortSlug: f.effortSlug } : {}),
    ...(f.discipline ? { discipline: f.discipline } : {}),
    ...(f.intensityTier ? { intensityTier: f.intensityTier } : {}),
    ...(f.grade ? { grade: f.grade } : {}),
    // Ticket 12: anchored at the producing scope (workout timestamp); the
    // derivation clock is only the degenerate last resort.
    timestamp: identity.workoutTimestamp ?? f.started ?? now,
    createdAt: now,
  }));
}

/** Identity for unified event-row emission — same fields as the fact identity. */
export type EventRowIdentity = SummaryFactIdentity;

function firstEffortSlug(metrics: StoredOutputStatement['metrics']): string | undefined {
  const loose = metrics as readonly { type?: string; value?: unknown; metadata?: Record<string, unknown> }[];
  for (const m of loose) {
    const slug = metadataString(m.metadata, 'effortSlug');
    if (slug) return slug;
    if (m.type === 'effort' || m.type === MetricType.Effort) {
      if (typeof m.value === 'string' && m.value) return m.value;
    }
  }
  return undefined;
}

/**
 * Logs → event rows, 1:1 per statement (ticket 002). Deterministic ids
 * `${resultId}:${seq}`; query-critical scalars promoted top-level.
 *
 * Ticket 12 temporal anchoring: the row timestamp is the statement's OWN
 * timeSpan start when it has one — the workout-start timestamp never
 * relocates a metric observation whose own instant differs. Statements with
 * a timeSpan carry per-metric temporal anchors ('instant') so projection
 * groups each observation under its own date.
 */
export function toEventRows(
  logs: readonly StoredOutputStatement[],
  identity: SummaryFactIdentity,
): EventRecord[] {
  return logs.map((output, seq) => ({
    id: `${identity.resultId}:${seq}`,
    resultId: identity.resultId,
    noteId: identity.noteId,
    blockContentId: identity.blockContentId,
    pageId: identity.pageId,
    origin: identity.origin,
    timestamp: output.timeSpan?.started ?? identity.workoutTimestamp ?? Date.now(),
    grain: 'event' as const,
    outputType: output.outputType ?? 'segment',
    effortSlug: firstEffortSlug(output.metrics),
    metrics: output.metrics,
    timeSpan: output.timeSpan?.started !== undefined
      ? { started: output.timeSpan.started, ended: output.timeSpan.ended }
      : undefined,
    metricTemporal: output.timeSpan?.started !== undefined
      ? output.metrics.map(() => ({ temporalKind: 'instant' as const, instant: output.timeSpan!.started }))
      : undefined,
    sourceBlockKey: output.sourceBlockKey,
    stackLevel: output.stackLevel,
    line: output.line,
    sourceStatementId: output.sourceStatementId,
    text: output.text,
    dialect: output.dialect,
    completionReason: output.completionReason,
    blockId: identity.blockId,
    blockVersion: identity.blockVersion,
  }));
}

/**
 * Tier-2 analytics outputs → deterministic summary event rows (tickets
 * 002/004): id `${resultId}:summary:${rowKey}` — no timestamp salt, so
 * re-finalize overwrites cleanly. Fold identity lives in metrics[0].metadata
 * (canonicalKey, effort metadata, groupTags) — shape-uniform with events.
 */
export function toSummaryEventRows(
  logs: readonly StoredOutputStatement[],
  identity: SummaryFactIdentity,
): EventRecord[] {
  const now = Date.now();
  return Array.from(foldSummaryOutputs(logs).values(), (f) => ({
    id: `${identity.resultId}:summary:${f.rowKey}`,
    resultId: identity.resultId,
    noteId: identity.noteId,
    blockContentId: identity.blockContentId,
    pageId: identity.pageId,
    origin: identity.origin,
    // Ticket 12: a summary is anchored at its producing scope — the workout
    // timestamp. The derivation clock is only the degenerate last resort
    // (rebuilding must never date a summary from the replay clock — a
    // headless replay's output timeSpan is derivation time, not coverage).
    // Coverage descriptors that describe the represented observations land
    // with ticket 14's summaryCoverage.
    timestamp: identity.workoutTimestamp ?? f.started ?? now,
    grain: 'summary' as const,
    outputType: 'analytics',
    // Ticket 14 provenance: engine-authored summaries are calculated
    // representations covering their producing scope. NO fabricated
    // reducerStats: the fold retains only the value, and the contract forbids
    // inventing observedCount (undefined = insufficient evidence for
    // count/avg; sum-shaped operations answer from the value alone).
    representationKind: 'calculated' as const,
    summaryCoverage: {
        scope: (f.effortSlug ? 'effort' : f.groupTags ? 'partition' : 'workout') as 'effort' | 'partition' | 'workout',
        ...(f.effortSlug ? { effortSlug: f.effortSlug } : {}),
        ...(f.groupTags ? { groupTags: f.groupTags } : {}),
    },
    effortSlug: f.effortSlug,
    metrics: [{
      type: f.metricKey,
      value: f.value,
      ...(f.unit ? { unit: f.unit } : {}),
      metadata: {
        canonicalKey: f.metricKey,
        ...(f.fieldRef ? { fieldRef: f.fieldRef, originalKey: f.projectionName } : {}),
        ...(f.effortSlug ? { effortSlug: f.effortSlug } : {}),
        ...(f.discipline ? { effortDiscipline: f.discipline } : {}),
        ...(f.intensityTier ? { effortIntensityTier: f.intensityTier } : {}),
        ...(f.groupTags ? { groupTags: f.groupTags } : {}),
        ...(f.grade ? { grade: f.grade } : {}),
      },
    }],
    blockId: identity.blockId,
    blockVersion: identity.blockVersion,
  }));
}

/**
 * Event row → flat fact currency for the four-stage plan (ticket 003):
 * one AnalyticsDataPoint per numeric metric. Canonical key resolution
 * mirrors the summary fold — metadata.canonicalKey first, name-derived
 * from the row's label metric as fallback. Deterministic fact ids:
 * `${record.id}:${factOrdinal}`.
 */
export function projectEventToFacts(record: EventRecord): AnalyticsDataPoint[] {
  // User corrections ride the same row as the planned/runtime values they
  // override (user actuals are preserved, not swapped). Project only the
  // ownership-visible winners — the canonical 5-tier ledger (user-entry >
  // runtime > user-plan > dialect > parser) — so raw fact queries count the
  // authoritative value once instead of double-counting planned+actual.
  // Row metrics are the stored union (IMetric[] | legacy loose rows); the
  // ledger consumes the IMetric shape.
  const metrics = createMetricOwnershipLedger(record.metrics as unknown as readonly IMetric[]).visible() as readonly {
    type?: string; value?: unknown; unit?: string; image?: string;
    metadata?: Record<string, unknown>;
  }[];

  if (record.grain === 'summary') {
    const m = metrics[0];
    if (!m || typeof m.value !== 'number') return [];
    // Ticket 11: canonicalKey (calc/wellness stamps) first, then the typed
    // field reference; legacy unkeyed summaries keep their type key.
    const fieldRef = readFieldRef(m.metadata);
    const metricKey = metadataString(m.metadata, 'canonicalKey')
      ?? fieldRef?.path
      ?? (m.type ?? '');
    // Ticket 12: a civil-date temporal anchor keeps its recorded civil date
    // (never a fabricated midnight instant); instant facts group under the
    // anchor instant's civil date in the execution timezone at query time.
    const temporal = record.metricTemporal?.[0];
    // Partition identity (groupTags metadata) is a queryable dim set —
    // `{coach:greg}` / `by {coach}` resolve through factTagValue's fallback.
    const dims = readGroupTags(m.metadata);
    return [{
      id: `${record.id}:0`,
      noteId: record.noteId,
      blockContentId: record.blockContentId,
      origin: record.origin,
      pageId: record.pageId,
      grain: 'summary',
      blockId: record.blockId ?? '',
      blockVersion: record.blockVersion ?? 0,
      resultId: record.resultId,
      type: metricKey,
      value: m.value,
      unit: m.unit,
      label: metricKey,
      metricKey,
      metricLabel: metricKey,
      metricUnit: m.unit,
      ...(fieldRef ? { fieldRef } : {}),
      ...(temporal?.temporalKind === 'civil-date' && temporal.civilDate
        ? { metricDate: temporal.civilDate, temporalKind: 'civil-date' as const }
        : {}),
      // Wellness rows are reconcile-owned user recordings: DIRECT
      // observations even before ticket 14 stamps representationKind.
      representationKind: record.representationKind
        ?? (record.outputType === 'wellness' ? 'direct' as const : undefined),
      ...(record.summaryCoverage ? { summaryCoverage: record.summaryCoverage } : {}),
      ...(record.reducerStats ? { reducerStats: record.reducerStats } : {}),
      effortSlug: metadataString(m.metadata, 'effortSlug') ?? record.effortSlug,
      discipline: metadataString(m.metadata, 'effortDiscipline'),
      intensityTier: metadataString(m.metadata, 'effortIntensityTier'),
      grade: metadataString(m.metadata, 'grade'),
      ...(dims ? { dimensions: dims } : {}),
      timestamp: record.timestamp,
      createdAt: record.timestamp,
    }];
  }

  const label = metrics.find(m => m.type === MetricType.Label);
  const labelName = label ? String(label.value ?? label.image ?? '') : '';
  const effortMetric = metrics.find(m => m.type === MetricType.Effort || m.type === 'effort');
  const effortSlug = metadataString(metrics[0]?.metadata, 'effortSlug')
    ?? record.effortSlug
    ?? (effortMetric && typeof effortMetric.value === 'string' ? effortMetric.value : undefined);
  // A grade-typed metric (user-authored `grade: V8` or catalog-stamped)
  // names the observation's climb grade — the dim/filter twin of effortSlug.
  const gradeMetric = metrics.find(m => m.type === MetricType.Grade || m.type === 'grade');
  const rowGrade = metadataString(metrics[0]?.metadata, 'grade')
    ?? (gradeMetric && typeof gradeMetric.value === 'string' ? gradeMetric.value : undefined);

  const facts: AnalyticsDataPoint[] = [];
  // User-authored categorical dims: a property metric with a typed field
  // identity and a non-numeric value (e.g. `coach: greg`) projects no fact
  // of its own but names a dimension of every fact the statement emits —
  // queryable as `{coach:greg}` / `by {coach}` after factTagValue's switch.
  const dims: Record<string, string> = {};
  for (const m of metrics) {
    // Structural markers are display/compile-time plumbing, not user dims.
    if (m.type === MetricType.Label || m.type === 'label' || m.type === MetricType.Hint || m.type === 'hint') continue;
    const valueKind = valueKindOf(m.value);
    if (valueKind !== 'string' && valueKind !== 'boolean') continue;
    const ref = readFieldRef(m.metadata);
    const dimKey = ref?.path ?? normalizeFieldPath(m.type ?? '');
    if (dimKey) dims[dimKey] = String(m.value);
  }
  const rowDims = Object.keys(dims).length > 0 ? dims : undefined;
  metrics.forEach((m) => {
    if (m.type === MetricType.Label || m.type === 'label' || typeof m.value !== 'number') return;
    // Ticket 11 key resolution: explicitly-stamped canonicalKey first, then
    // the typed field reference — PropertyMetric variants survive under
    // their normalized path instead of collapsing into a pooled `custom`.
    // Legacy fallbacks for unlabeled legacy data only (pre-fieldRef logs):
    // label-derived key, `reps` for rep metrics, or the metric's own type.
    // A Custom-typed metric with no identity source no longer invents the
    // pooled `custom` key (finding 3.1) — it has no queryable identity, so
    // it projects no fact.
    const fieldRef = readFieldRef(m.metadata);
    const legacyFallback = m.type === MetricType.Rep || m.type === 'rep'
      ? 'reps'
      : (m.type ?? 'metric');
    if (!fieldRef && legacyFallback === 'custom') return;
    const metricKey = metadataString(m.metadata, 'canonicalKey')
      ?? fieldRef?.path
      ?? (labelName ? resolveCanonicalMetricKey(labelName) : legacyFallback);
    const ordinal = facts.length;
    // Ticket 12: the fact carries its own temporal anchor — the metric's
    // occurrence instant when the row has one, so a workout-start
    // timestamp never relocates an observation whose own date differs.
    const temporal = record.metricTemporal?.[ordinal];
    const factTimestamp = temporal?.temporalKind === 'instant' && temporal.instant !== undefined
      ? temporal.instant
      : record.timestamp;
    facts.push({
      id: `${record.id}:${ordinal}`,
      noteId: record.noteId,
      blockContentId: record.blockContentId,
      origin: record.origin,
      pageId: record.pageId,
      grain: 'event',
      blockId: record.blockId ?? '',
      blockVersion: record.blockVersion ?? 0,
      resultId: record.resultId,
      type: metricKey,
      value: m.value,
      unit: m.unit,
      label: labelName || metricKey,
      metricKey,
      metricLabel: labelName || metricKey,
      metricUnit: m.unit,
      ...(fieldRef ? { fieldRef } : {}),
      ...(temporal?.temporalKind === 'civil-date' && temporal.civilDate
        ? { metricDate: temporal.civilDate, temporalKind: 'civil-date' as const }
        : {}),
      effortSlug: metadataString(m.metadata, 'effortSlug') ?? effortSlug,
      discipline: metadataString(m.metadata, 'effortDiscipline'),
      intensityTier: metadataString(m.metadata, 'effortIntensityTier'),
      grade: metadataString(m.metadata, 'grade') ?? rowGrade,
      ...(rowDims ? { dimensions: rowDims } : {}),
      timestamp: factTimestamp,
      createdAt: record.timestamp,
    });
  });
  return facts;
}

/**
 * Inverse of {@link toEventRows}/{@link toSummaryEventRows}: rebuild the
 * statement stream a session's event rows represent. Event rows keep their
 * recorded order (id `${resultId}:${seq}`); summary rows follow in fold
 * order. Consumers that need the statement shape (replay, review display)
 * read events and call this — the store keeps only event rows.
 */
export function eventsToStoredLogs(events: readonly EventRecord[]): StoredOutputStatement[] {
  const ordered = [...events].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id.localeCompare(b.id);
  });
  return ordered.map((row, index) => ({
    id: index,
    outputType: row.outputType as StoredOutputStatement['outputType'],
    timeSpan: row.timeSpan ?? { started: row.timestamp },
    metrics: row.metrics,
    sourceBlockKey: row.sourceBlockKey,
    stackLevel: row.stackLevel,
    line: row.line,
    sourceStatementId: row.sourceStatementId,
    text: row.text,
    dialect: row.dialect,
    completionReason: row.completionReason,
  }));
}
