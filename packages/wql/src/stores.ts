/**
 * Injected store interfaces for WQL QueryService.
 * Zero database/storage dependencies — 100% pure abstractions.
 *
 * Ticket 003: FactQueryStore + ResultLogStore collapsed into the single
 * UnifiedEventStore — two names for one data source. The content plane
 * (notes / blocks / efforts) is unchanged by workout-data unification.
 */

import type { BlockIndexRow, Note, EventRecord, Page, PageNote } from '@bitcobblers/wod-wiki-core';

/**
 * Store surface for the unified event table — every workout-data read the
 * Query Service needs, plus the write contract owned by the write-path
 * lifecycle (ticket 005).
 */
export interface EventStore {
    /** Ticket 12/14 complete-fetch seam: candidates whose METRIC date
     *  (civil, multiEntry index) falls in the requested dates — rows whose
     *  own date differs from their fetch-hint timestamp are reachable. */
    getEventsByMetricDates?(dates: readonly string[]): Promise<EventRecord[]>;
  // ── reads (all return EventRecord) ──────────────────────────
  /** Windowed fetch — the one proven culling index (ticket 001). */
  getEventsByTimeRange(start: number, end: number): Promise<EventRecord[]>;
  /** Per-result fetch (rows:{result:…}, re-finalize, orphan inspection). */
  getEventsByResult(resultId: string): Promise<EventRecord[]>;
  /** Note-scoped fetch (rows:{note:…}). */
  getEventsForNote(noteId: string): Promise<EventRecord[]>;
  /** Content-scoped fetch — the cross-store join hot path (indexed). */
  getEventsByContent(blockContentId: string): Promise<EventRecord[]>;
  /** Full scan — all-time SELECT leg (ticket 001: scan beats non-selective indexes). */
  scanAll(): Promise<EventRecord[]>;

  // ── writes (contract: ticket 005) ──────────────────────────────────
  /** Append event rows (per-statement flush; same-tick coalescing allowed). */
  appendEvents(rows: EventRecord[]): Promise<void>;
  /** Atomic finalize: clear the result's engine-authored summaries, write finals. */
  finalizeSummaries(resultId: string, rows: EventRecord[]): Promise<void>;
  /** Reconcile deletes (wellness note-save) + GC sweeps. */
  deleteEvents(ids: string[]): Promise<void>;
}


/** Store surface for content queries (`:note`). */
export interface NoteQueryStore {
  getAllNotes(): Promise<Note[]>;
  getNoteIdsForTag(label: string): Promise<Set<string>>;
  /** Note-tags label set of one note (moved here from FactQueryStore — it
   *  reads note tags, not facts). */
  getNoteTagLabels(noteId: string): Promise<string[]>;
  /** Indexed/domain candidate read for :note — `selection` carries only
   *  exact-semantics predicates, so rows are a SUPERSET of the matches and
   *  QueryService re-applies every residual filter in JS. `undefined` =
   *  capability unavailable (no domain projection / scoped transaction) →
   *  the caller falls back to getAllNotes(). Server order/offset/limit ride
   *  only when no residual filter, window, or join precedes the slice. */
  queryDomain?(request: {
    plan: 'notes';
    selection?: WqlDomainPredicate[];
    filters?: WqlDomainPredicate[];
    order?: WqlDomainOrder[];
    offset?: number;
    limit?: number;
  }): Promise<WqlDomainReadResult | undefined>;
}

/**
 * Candidate/domain read wire — a structural mirror of packages/storage/src/
 * domain.ts (root-owned). WQL stays DB-independent: no storage-package
 * dependency; the app adapter bridges these shapes 1:1 to
 * IStorage.queryDomain. Keep field-by-field compatible with that file.
 *
 * Clause algebra (identical to the wire): clauses AND; a clause's value list
 * ORs; `negate` excludes any row matching any value.
 */
export type WqlDomainPredicate =
  | { field: 'id' | 'noteId' | 'type' | 'catalog' | 'source' | 'tags' | 'effort'; values: string[]; negate?: boolean }
  | { field: 'text'; value: string }
  | { field: 'date'; start: number; end: number; endExclusive?: boolean }
  | { field: 'page'; value: boolean }
  /** The :note default page-exclusion stage (notes plan only). `feeds`
   *  = an authored feed source clause rides along: true drops literal
   *  type 'page' rows; false drops isPage rows (page-like kinds or page:/
   *  guides: source prefixes on non-note kinds). */
  | { field: 'defaultNotes'; feeds: boolean }
  | { field: 'sourceFence' };

/** Server order clause — structural mirror of the storage wire's
 *  DomainOrder. Only exact-parity orderings are ever sent (natural id order
 *  matches the historical whole-store iteration order). */
export type WqlDomainOrder = {
  field: 'id' | 'createdAt' | 'date' | 'title' | 'noteTitle' | 'dataType' | 'position';
  direction: 'asc' | 'desc';
};

/** Candidate read result for the plans WQL consumes. `rows` are original
 *  entity payloads; the counts follow the wire contract (selected before
 *  filters, matched before limit) — selectedCount baselines the historical
 *  pre-filter `stages.selected`, matchedCount is informational (WQL
 *  recounts after its own residual pipeline and slice). */
export type WqlDomainReadResult =
  | { plan: 'notes'; projectionVersion: number; selectedCount: number; matchedCount: number; rows: Note[] }
  | { plan: 'blocks'; projectionVersion: number; selectedCount: number; matchedCount: number; rows: BlockIndexRow[] };

/** Store surface for block-index queries (`:block`). */
export interface BlockQueryStore {
  getAllBlocks(): Promise<BlockIndexRow[]>;
  /** Indexed/domain candidate read for :block — same superset contract as
   *  the note seam; `undefined` falls back to getAllBlocks(). */
  queryDomain?(request: {
    plan: 'blocks';
    selection?: WqlDomainPredicate[];
    filters?: WqlDomainPredicate[];
    order?: WqlDomainOrder[];
    offset?: number;
    limit?: number;
  }): Promise<WqlDomainReadResult | undefined>;
}

/** Pure effort model interface for `:effort` queries. */
export interface IEffort {
  id: string;
  slug: string;
  label: string;
  aliases: string[];
  baseAttributes: {
    met?: number;
    discipline?: string;
    intensityTier?: string;
    [key: string]: unknown;
  };
  registrySource?: 'bundled' | 'user' | string;
  [key: string]: unknown;
}
export interface EffortQueryStore {
  getAllEfforts(): Promise<IEffort[]>;
}

/** Optional bundle of stores for QueryService initialization. */
/** One note's hydration relations — structurally the storage entries
 *  bundle's relation slice, so a host can bridge its entry batch reads
 *  (local: one transaction; remote: entries plan with ids chunked at the
 *  domain parser's 64-value limit) straight through without mapping. WQL
 *  reads only `label` off each tag record and never imports storage. */
export interface NoteRelationBundle {
  /** The note's junction tag records (label plane). */
  tags: ReadonlyArray<{ label: string }>;
  /** page_notes junction rows for the note; first by position is the
   *  parent page. */
  links: PageNote[];
  /** Resolved junction pages by page id. */
  pages: Page[];
}

export interface QueryServiceStores {
  eventStore?: EventStore;
  noteStore?: NoteQueryStore;
  /** Serves every block row — user journal and seeded corpus alike (the
   *  seed importer materializes corpus rows into the same store). */
  blockStore?: BlockQueryStore;
  effortStore?: EffortQueryStore;
  /** Derived corpus-note projections (catalog/tag planes). */
  staticNoteStore?: NoteQueryStore;
  /** Serves exercise containment rows (`block_efforts` store). */
  blockEffortsStore?: { getAllFromIndex(index: string, key: string): Promise<any[]> };
  /** Serves tag records (`tags` store). */
  tagsStore?: { getAllFromIndex(index: string, key: string): Promise<any[]> };
  /** Serves note-tag junction rows (`note_tags` store). */
  noteTagsStore?: { getAllFromIndex(index: string, key: string): Promise<any[]> };
  /** Canonical page_notes junction reads for container resolution — a
   *  note's parent Page wins over a standalone Note container. */
  pageStore?: {
    getNotePages(noteId: string): Promise<PageNote[]>;
    getPage(pageId: string): Promise<Page | undefined>;
  };
  /** Batched relation reads for the hydration paths (containers, run
   *  tags) — one bundle per distinct note id instead of a page/tag read
   *  per matched result. Optional: absent → the per-note pageStore /
   *  noteStore seams above serve each request. */
  relationStore?: {
    getBatches(noteIds: readonly string[]): Promise<Map<string, NoteRelationBundle>>;
  };
  /** Synchronous named datasets (`@session`, `@today`, user-stored sources)
   *  populated by the host before queries run — pipeline dataset stages
   *  never touch the database. */
  datasetStore?: {
    getDataset(name: string): { events: EventRecord[]; notes: Note[] } | undefined;
  };
}
