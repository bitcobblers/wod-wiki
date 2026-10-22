import type { StoredOutputStatement } from './results';

export type NoteBlockKind = 'wod' | 'query' | 'widget' | 'embed';

export interface NoteBlock {
  id: string;
  kind: NoteBlockKind;
  version: number;
  sourceRevision: number;
  from: number;
  to: number;
  dialect?: 'time' | 'log';
  sport?: string;
}

export interface BlockRevision {
  noteId: string;
  blockId: string;
  version: number;
  kind: NoteBlockKind;
  rawContent: string;
  savedAt: number;
  dialect?: 'time' | 'log';
  sport?: string;
}
// ---------------------------------------------------------------------------
// Note — root container
// ---------------------------------------------------------------------------
export type NoteKind = 'journal' | 'template' | 'playground' | 'feed' | 'dashboard' | 'page' | (string & {});

export interface Note {
  id: string; // UUID — canonical storage identity
  title: string; // Display name
  rawContent: string;
  sourceRevision: number;
  blocks: Record<string, NoteBlock>;
  date?: number; // Domain date of the record (e.g. workout date, publish date)
  createdAt: number; // Creation timestamp
  type?: NoteKind;
  sourceId?: string;
  catalog?: string;
  /** Canonical notebook identifier ('notebook/{slug}', e.g. 'notebook/journal', 'notebook/playground', 'notebook/guides'). */
  notebookId?: string;
  tags?: string[];
  seedOrigin?: 'seed' | 'user';
  seedVersion?: number;
  seedChunkId?: string;
  /** Authored seed path used for deterministic identity and routing. */
  sourcePath?: string;
  /** Git commit hash in which this note was published or changed. */
  seedCommit?: string;
}

// ---------------------------------------------------------------------------
// Page — named/slug-addressable grouped collection of notes
// ---------------------------------------------------------------------------
export interface Page {
  id: string;
  date?: string; // YYYY-MM-DD (publish/calendar date)
  slug?: string;
  title?: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// PageNote — N:M junction linking a Note to a Page
// ---------------------------------------------------------------------------
export interface PageNote {
  id: string; // UUID
  pageId: string;
  noteId: string;
  position?: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Tag / NoteTag — normalized note tagging
// ---------------------------------------------------------------------------
export type TagType = 'template' | 'playground' | 'qualification' | 'notebook' | 'general' | (string & {});

export interface TagTypeRecord {
  id: string;
  name: string;
  label: string;
  color?: string;
  createdAt: number;
}

export interface Tag {
  id: string;
  label: string;
  type?: TagType;
  createdAt: number;
}

export interface NoteTag {
  id: string;
  noteId: string;
  tagId: string;
}

// ---------------------------------------------------------------------------
// BlockIndexRow — derived block index for WQL content queries
// ---------------------------------------------------------------------------
export interface BlockIndexRow {
  /** Current occurrence key `${noteId}:${blockId}`. */
  id: string;
  noteId: string;
  blockId: string;
  blockVersion: number;
  sourceRevision: number;
  from: number;
  to: number;
  position?: number;
  dataType: NoteBlock['kind'];
  blockContentId?: string;
  rawContent: string;
  noteTitle: string;
  createdAt: number;
  isStatic?: boolean;
  sourceId?: string;
  sourcePath?: string;
  routeId?: string;
  notebookId?: string;
}

// ---------------------------------------------------------------------------
// Session — execution log (renamed from WorkoutResult; table results -> sessions in DB V20)
// ---------------------------------------------------------------------------
export type ResultOrigin = 'journal' | 'playground' | 'user';

export interface Session {
  id: string;
  noteId: string;
  blockId: string;
  blockVersion: number;
  blockContentId?: string;
  origin?: ResultOrigin;
  pageId?: string;
  /** Born in-progress at run start, completed when finalization commits. */
  status?: 'in-progress' | 'completed';

  /** When workout started */
  startTime: number;

  /** When workout ended */
  endTime: number;

  /** Total elapsed time (ms) */
  duration: number;

  /** Rounds completed (for rounds-based workouts) */
  roundsCompleted?: number;

  /** Total rounds (for rounds-based workouts) */
  totalRounds?: number;

  /** Reps completed (for rep-based workouts) */
  repsCompleted?: number;

  /** Whether workout was completed or stopped early */
  completed: boolean;

  createdAt: number;
}

// ---------------------------------------------------------------------------
// Attachment — external temporal data blobs (GPS / HR)
// ---------------------------------------------------------------------------
export interface Attachment {
  id: string;
  noteId: string;
  pageId?: string;
  resultId?: string;
  mimeType: string;
  label: string;
  data: ArrayBuffer | string;
  timeSpan: {
    start: number;
    end: number;
  };
  createdAt: number;
}

// ---------------------------------------------------------------------------
// AnalyticsDataPoint — de-normalized metric for cross-workout queries
// ---------------------------------------------------------------------------
export interface AnalyticsDataPoint {
  id: string;
  noteId: string;
  blockContentId?: string;
  origin?: ResultOrigin;
  pageId?: string;
  grain?: 'event' | 'summary';
  effortSlug?: string;
  discipline?: string;
  intensityTier?: string;
  grade?: string;
  /** User-authored categorical dims (custom property metrics and grouped
   *  partitions) — normalized key → value, resolved by factTagValue after
   *  the structural switch so `by {coach}` / `{coach:greg}` work. */
  dimensions?: Record<string, string>;
  blockId: string;
  blockVersion: number;
  resultId: string;
  type: string;
  value: unknown;
  unit?: string;
  label: string;
  metricKey?: string;
  metricLabel?: string;
  metricUnit?: string;
  /** Typed field reference provenance (ticket 11) — normalized path + kind
   *  of the variant this observation belongs to. */
  fieldRef?: { path: string; kind: string; dimension?: string };
  /** The observation's own civil date (YYYY-MM-DD) when it is date-only
   *  (ticket 12) — grouping uses this instead of a fabricated instant. */
  metricDate?: string;
  /** Temporal kind of the observation's anchor (ticket 12). */
  temporalKind?: 'instant' | 'civil-date';
  /** Ticket 14 provenance carried onto the fact (ticket 16 selection). */
  representationKind?: 'direct' | 'calculated' | 'substitute_summary';
  summaryCoverage?: SummaryCoverage;
  reducerStats?: ReducerStats;
  timestamp: number;
  createdAt: number;
}


// ---------------------------------------------------------------------------
// EventRecord — THE single stored record for all workout data (V21).
// Statement rows are the archival source: sessions hold execution metadata
// only, and display/replay shapes are reconstructed from these rows.
// ---------------------------------------------------------------------------

/** Store-row kind: 'event' = raw statement row, 'summary' = folded row.
 *  Authorship lives on `origin` (engine-authored summaries are finalize-owned;
 *  user-authored summaries — wellness — are reconcile-owned). Ticket 005. */
export type EventGrain = 'event' | 'summary';

/** Known producer values for the open `outputType` vocabulary (ticket 002:
 *  open string + known-values module; unknowns are stored and returned,
 *  matched only by kind-agnostic logic). */
export const KNOWN_OUTPUT_TYPES = [
  'segment',
  'system',
  'load',
  'event',
  'compiler',
  'completion',
  'analytics',
  'wellness',
] as const;
// EventRecord — THE single stored record for all workout data (renamed from UnifiedEventRecord)
// ---------------------------------------------------------------------------
export interface EventRecord {
  /**
   * Event rows:    `${resultId}:${seq}` — immutable, append-only.
   * Summary rows:  `${resultId}:summary:${metricKey}[:k=v…]` — deterministic
   *                content key; re-finalize overwrites cleanly (ticket 002).
   * Wellness rows: `wellness:${noteId}:${key}` — reconcile-owned upserts.
   */
  id: string;
  resultId: string;
  noteId: string;
  /** Content-stable cross-workout join key (promoted, ticket 003 amendment). */
  blockContentId?: string;
  pageId?: string;
  origin?: ResultOrigin;
  /** Canonical time — when the workout happened, never when derived. */
  timestamp: number;
  grain: EventGrain;
  effortSlug?: string;
  /** Open vocabulary — see KNOWN_OUTPUT_TYPES. */
  outputType: string;
  /** Typed metric array; EXACTLY ONE entry when grain:'summary'. Summary
   *  fold identity (canonicalKey, groupTags, effort metadata) lives in
   *  metrics[0].metadata — shape-uniform with events. */
  metrics: StoredOutputStatement['metrics'];
  timeSpan?: { started: number; ended?: number };
  sourceBlockKey?: string;
  sourceStatementId?: number;
  line?: number;
  text?: string;
  dialect?: string;
  stackLevel?: number;
  completionReason?: string;
  blockId?: string;
  blockVersion?: number;
  /** Per-metric temporal anchors (ticket 12) — parallel to `metrics` when
   *  the producing statement carries its own instants/dates:
   *  'instant' = recorded occurrence instant; 'civil-date' = recorded civil
   *  date (date-only wellness), never a fabricated midnight. The row
   *  timestamp remains the V16 fetch anchor until the by-metricDate index
   *  (ticket 14); it must not relocate a metric whose own date differs. */
  metricTemporal?: MetricTemporal[];
  /** Ticket 14: civil-date keys (d:YYYY-MM-DD) of every metricTemporal with
   *  temporalKind 'civil-date' — the multiEntry `by-metric-date` index
   *  source. Kept distinct from the instant index on purpose: a date-only
   *  observation is never a midnight instant. */
  metricDateKeys?: string[];
  /** Ticket 14 provenance: how this row represents the underlying
   *  observations — directly recorded, calculated, or a substitute summary. */
  representationKind?: 'direct' | 'calculated' | 'substitute_summary';
  /** Ticket 14: the temporal/production scope a substitute summary covers. */
  summaryCoverage?: SummaryCoverage;
  /** Ticket 14: retained reducer statistics for substitution proofs. */
  reducerStats?: ReducerStats;
}

/** Scope descriptor of a substitute summary's coverage (ticket 14). */
export interface SummaryCoverage {
  scope: 'workout' | 'effort' | 'partition';
  effortSlug?: string;
  /** Partition identity (group-tag pairs, key-sorted). */
  groupTags?: Record<string, string>;
}

/** Retained statistics for substitution proofs (ticket 16 consumes).
 *  `observedCount` is the true represented observation count — never
 *  invented for legacy rows that lack it (undefined = insufficient
 *  evidence, not 1). */
export interface ReducerStats {
  observedCount?: number;
  sum?: number;
  min?: number;
  max?: number;
}

export interface MetricTemporal {
  temporalKind: 'instant' | 'civil-date';
  /** Occurrence instant (ms epoch) when temporalKind === 'instant'. */
  instant?: number;
  /** Civil YYYY-MM-DD when temporalKind === 'civil-date'. */
  civilDate?: string;
}

// ---------------------------------------------------------------------------
// Field Catalog — V17 derived stores (wayfinder datadog-analytics tickets
// 14/15). The catalog is a derived index of saved data: reference counts
// track supporting source records, rows prune at zero, and deltas commit
// atomically with the source mutation.
// ---------------------------------------------------------------------------

/** One typed field identity in the catalog. `id` is the collision-free
 *  typed key (see fieldRefKey in fields/fieldIdentity). */
export interface FieldCatalogEntry {
  id: string;
  /** Normalized full path — the ordered prefix-lookup key for typeahead. */
  path: string;
  kind: string;
  /** Physical/named dimension of a numeric variant, when known. */
  dimension?: string;
  /** Observed original spellings → supporting-source counts (provenance,
   *  not identity); a spelling disappears when its final support does. */
  spellings: Record<string, number>;
  /** Observed effective units → supporting-source counts. */
  units: Record<string, number>;
  /** Number of source records currently supporting this identity. */
  sourceCount: number;
  firstSeen: number;
  lastSeen: number;
}

/** One field identity a source record supports, with everything needed to
 *  reverse the contribution (per-source unit/spelling/value evidence). */
export interface FieldContribution {
  fieldId: string;
  path: string;
  kind: string;
  unit?: string;
  /** Original spelling this source used. */
  spelling?: string;
  /** Categorical value (string/boolean fields only) — original spelling. */
  value?: string;
}

/** The contribution set of one stable source record — the reversal record
 *  that makes re-saves idempotent and deletions reversible. Contributions
 *  are attributed to their owning row id, so streaming appends, finalize
 *  replacement, and cascade deletes reverse exactly the affected rows. */
export interface FieldSourceRecord {
  /** `${entityKind}:${recordId}` — e.g. `result:r1`, `note:n1`. */
  id: string;
  contributions: Array<FieldContribution & { rowId: string }>;
}

/** One observed categorical value of a field (string/boolean only). */
export interface FieldValueRecord {
  key: [string, string]; // [fieldId, value] — value keeps original spelling
  fieldId: string;
  value: string;
  sourceCount: number;
}

/** Backfill progress/completion marker (field_catalog_meta store). */
export interface CatalogBackfillState {
  id: 'backfill';
  status: 'initializing' | 'complete';
  /** Last processed source key per source store (resume cursor). */
  cursor?: { results?: string; notes?: string; events?: string };
  revision: number;
  updatedAt: number;
}

export interface BlockEffort {
  id: string;
  noteId: string;
  blockId: string;
  blockContentId?: string;
  effortSlug: string;
  isStatic?: boolean;
  sourcePath?: string;
  createdAt: number;
}

/** Containment link block → canonical equipment, mirroring BlockEffort. */
export interface BlockEquipment {
  id: string;
  noteId: string;
  blockId: string;
  blockContentId?: string;
  equipmentSlug: string;
  isStatic?: boolean;
  sourcePath?: string;
  createdAt: number;
}

export interface Membership {
  id: string;
  displayName: string;
  picture?: string;
  weight?: number;
  weightUnit?: 'kg' | 'lb';
  height?: number;
  heightUnit?: 'cm' | 'in';
  birthDate?: string;
  createdAt: number;
  updatedAt?: number;
}
