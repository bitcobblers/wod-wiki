/**
 * Query Service — the executor of WQL against the unified event store.
 * Four-stage physical plan:
 *
 *   SELECT (window-first hybrid, ticket 003: windowed queries fetch through
 *           by-timestamp — the one proven culling index; all-time queries
 *           scan; by-metric is never used. Event rows are flattened to the
 *           legacy flat-fact currency by projectEventToFacts.)
 *   BUCKET (time dim or rollup period)
 *   AGGREGATE (per bucket)
 *   GROUP (tag-dimension fan-out)
 *
 * Inputs are uncapped — personal-journal scale; widgets and tables are dumb
 * consumers of QueryResult. The store serves UnifiedEventRecord rows
 * (grain 'event' | 'summary'); Tags are query-time dimensions read off the
 * projected fact row (effort, discipline, note, intensity, …) — 'tags'
 * resolves through the note_tags store.
 *
 * Fully inverted dependencies: zero IndexedDB/storage module-level imports.
 */

import type { AnalyticsDataPoint, Note, BlockIndexRow, EventRecord, Page, PageNote, NotePlacement, Tag, TagContribution } from '@bitcobblers/wod-wiki-core';
import { normalizeFieldComponent, resolvePlacements, validateNoteBlocks } from '@bitcobblers/wod-wiki-core';
import {
  DEFAULT_NOTEBOOK_SLUGS,
  isNoteEditable,
  notebookSlugFromId,
  toNotebookId,
  type DefaultNotebookSlug,
  type FeedId,
  type NotebookId,
  type NotebookOrigin,
} from '@bitcobblers/wod-wiki-core';

import {
  parseQuery,
  isFindQuery,
  isPipelineQuery,
  findTargetAdvisories,
  type Aggregator,
  type ComparisonOp,
  type ParsedAggregateQuery,
  type ParsedFindQuery,
  type ParsedPipelineQuery,
  type PipelineSink,
  type AnyParsedQuery,
  type QueryWindow,
  type ParsedRowsQuery,
  type FindPredicate,
  type MetricPredicate,
  type Series,
  type SeriesPoint,
  type TagFilter,
} from './wql';
import { WQL_SOURCE_VALUES, WQL_TYPED_TAG_KEYS, type WqlTypedTagKey } from './vocabulary';
import { convertViaCatalog, resolveOutputUnit } from './units';
import { projectEventToFacts } from './derivation';
import { dedupeById, selectContributions, type CoverageReport } from './selection';
import {
  captureContext,
  civilDateAdd,
  civilDateDiff,
  civilDateOf,
  civilMonday,
  inRange,
  resolveWindowRange,
  zonedNoon,
  zonedStartOfDay,
  type ExecutionContext,
  type ResolvedRange,
} from './calendar';
import type {
  EventStore,
  NoteQueryStore,
  BlockQueryStore,
  EffortQueryStore,
  IEffort,
  QueryServiceStores,
  NoteRelationBundle,
  WqlDomainOrder,
  WqlDomainPredicate,
} from './stores';

export {
  DEFAULT_NOTEBOOK_SLUGS,
  isNoteEditable,
  notebookSlugFromId,
  toNotebookId,
  type DefaultNotebookSlug,
  type FeedId,
  type NotebookId,
  type NotebookOrigin,
};
export type {
  EventStore,
  NoteQueryStore,
  BlockQueryStore,
  EffortQueryStore,
  IEffort,
  QueryServiceStores,
};


/** User note identity shape — uuidv7 minted by the journal/persistence layer
 *  (crypto.randomUUID on legacy rows). Seed corpus ids are path-shaped. */
const NOTE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The notebook slug a `notebook:<slug>[/<item>]` source id names — the
 *  first path segment; README/root landings (`notebook:<slug>` bare or
 *  `notebook:_root`) name no item. UUID and non-notebook source ids name
 *  no notebook. */
export function notebookSlugOfSourceId(sourceId: string | undefined): string | undefined {
  if (!sourceId?.startsWith('notebook:')) return undefined;
  const rest = sourceId.slice('notebook:'.length);
  if (!rest || rest === '_root') return undefined;
  return rest.split('/')[0];
}

/**
 * The feed that delivered a note — the resolver's feed answer.
 *
 * Read from the note's OWN feed stamp (`feedSourceId`), never from the seed
 * stamps (`seedOrigin`, `seedVersion`, `seedChunkId`): a note that no feed
 * delivered has no feed, whatever its seed stamps say. A feed id and the
 * source id of the same registered source agree, so the answer names the
 * registered feed the note arrived from.
 */
export function feedOfItem(item: { feedSourceId?: string | null }): FeedId | undefined {
  const id = item.feedSourceId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

/**
 * Resolve the canonical `notebook/{slug}` container for any Note or BlockIndexRow.
 *
 * Fallback precedence (first match wins), shared by every consumer — the WQL
 * query layer, the host entry mapper, and the storage projections:
 *   1. explicit `notebookId` (user-created notebooks),
 *   2. the `notebook:{slug}` tag convention (user notebook membership),
 *   3. the corpus path (`markdown/<family>/…` sourcePath),
 *   4. the source-id prefix (`notebook:`, `guides:`, `playground`,
 *      and the `efforts`/`equipment`/`dashboards` corpus literals),
 *   5. the journal fallback.
 * Tiers 3 and 4 agree for every corpus note: the seed writer
 * (`seedNoteSourceId`/`chunkIdFor`) derives the sourceId from the same path
 * the importer stamps as `sourcePath`.
 */
export function notebookOfItem(item: {
  id?: string;
  noteId?: string;
  sourceId?: string;
  type?: string;
  seedOrigin?: string;
  seedChunkId?: string;
  feedOrigin?: string;
  feedSourceId?: string;
  sourcePath?: string;
  notebookId?: string;
  tags?: readonly string[];
}): NotebookId | undefined {
  if (item.notebookId && item.notebookId.trim()) {
    return toNotebookId(item.notebookId);
  }
  if (item.tags) {
    for (const tag of item.tags) {
      if (tag.startsWith('notebook:') || tag.startsWith('notebook/')) {
        const slug = notebookSlugFromId(tag);
        if (slug) return toNotebookId(slug);
      }
    }
  }
  // Corpus path — `markdown/<family>/…` rows written by the seed compiler
  // (`chunkIdFor` mirrors these family rules). Notebooks carry the slug in
  // the next segment; a file directly under `markdown/notebooks/` is the
  // writer's root landing (`notebook._root`) — it claims no notebook here.
  // Canvas guides, efforts, dashboards, and equipment map to their family
  // notebook.
  const corpus = /^markdown\/(notebooks|canvas|efforts|dashboards|equipment)\/(.+)$/.exec(item.sourcePath ?? '');
  if (corpus) {
    const [, family, rest] = corpus;
    if (family === 'canvas') return 'notebook/guides';
    if (family !== 'notebooks') return toNotebookId(family);
    const segs = rest.split('/');
    if (segs.length > 1) return toNotebookId(segs[0]!);
  }
  if (sourceMatches(item, 'playground')) return 'notebook/playground';
  if (sourceMatches(item, 'guides')) return 'notebook/guides';
  // Corpus source-id literals and the typed-dashboard convention — same
  // answers the corpus-path tier produces for writer rows.
  if (item.sourceId === 'efforts') return 'notebook/efforts';
  if (item.sourceId === 'equipment') return 'notebook/equipment';
  if (item.sourceId === 'dashboards' || item.type === 'dashboard') return 'notebook/dashboards';
  const slug = notebookSlugOfSourceId(item.sourceId);
  if (slug) return toNotebookId(slug);
  if (isJournalRow(item)) return 'notebook/journal';
  return undefined;
}

/**
 * Who owns the notebook a row resolves to — the editability key (ticket 05).
 * Pure over the row's own fields, and exact for every reachable state:
 *   - explicit `notebookId` / `notebook:` tag membership → `'user'` (moves
 *     into feed-delivered notebooks are forbidden and the importer never
 *     stamps either field, so this tier is always user-managed),
 *   - corpus path or feed/corpus sourceId shapes → `'feed'`
 *     (the delivering feed wrote these rows; guides included — the core
 *     feed delivers the canvas),
 *   - the playground and journal fallbacks → `'default'`.
 * A user-owned copy (clone) keeps its provenance stamps but resolves through
 * tier 1, so it is editable while its origin stays visible.
 */
export function notebookOriginOfItem(item: Parameters<typeof notebookOfItem>[0]): NotebookOrigin | undefined {
  const notebook = notebookOfItem(item);
  if (!notebook) return undefined;
  if (item.notebookId?.trim()) return 'user';
  if (item.tags?.some((t) => t.startsWith('notebook:') || t.startsWith('notebook/'))) return 'user';
  if (notebook === 'notebook/journal' || notebook === 'notebook/playground') return 'default';
  return 'feed';
}
export function feedIdOfItem(item: { feedSourceId?: string; seedChunkId?: string; sourcePath?: string; notebookId?: string; tags?: readonly string[] }): string {
  const origin = notebookOriginOfItem(item);
  if (origin === 'user') return 'local';
  if (item.feedSourceId) return item.feedSourceId;
  if (origin === 'default') return 'local';
  return 'core';
}

export function chunkIdOfItem(item: { seedChunkId?: string; sourcePath?: string; notebookId?: string; tags?: readonly string[] }): string | undefined {
  if (item.seedChunkId) return item.seedChunkId;
  const nb = notebookOfItem(item);
  if (!nb) return undefined;
  const slug = nb.replace(/^notebook\//, '');
  return `notebook.${slug}`;
}

export function isItemSubscribed(
  item: Parameters<typeof notebookOfItem>[0] & { feedSourceId?: string; seedChunkId?: string; seedOrigin?: string; origin?: string },
  isNotebookSubscribedFn?: (feedId: string, chunkId: string) => boolean,
): boolean {
  const origin = item.origin ?? notebookOriginOfItem(item);
  if (origin === 'user' || origin === 'default') return true;
  if (!isNotebookSubscribedFn) return true;
  const feedId = feedIdOfItem(item);
  const chunkId = chunkIdOfItem(item);
  if (!chunkId) return true;
  return isNotebookSubscribedFn(feedId, chunkId);
}


/** The resolver's journal fallback tier — pure shape logic over the row's own
 *  fields (no prefix, no notebook ownership). {@link notebookOfItem} reaches
 *  `notebook/journal` only through this predicate, and
 *  `sourceMatches(…, 'journal')` is expressed through the resolver's final
 *  answer, so the JS filter and the materialized `journal` column can never
 *  claim journal for a note an earlier tier (notebookId, tag, corpus,
 *  sourceId) already placed elsewhere. */
function isJournalRow(item: {
  id?: string; noteId?: string; sourceId?: string; type?: string;
  seedOrigin?: string; seedChunkId?: string; feedOrigin?: string; feedSourceId?: string;
  sourcePath?: string;
}): boolean {
  const sourceId = item.sourceId;
  if (item.type === 'playground' || item.id?.startsWith('playground/') || item.noteId?.startsWith('playground/')) return false;
  if (sourceId && sourceId !== 'journal' && !NOTE_UUID_RE.test(sourceId) && !/^journal\/\d{4}-\d{2}-\d{2}$/.test(sourceId)) return false;
  // UUID or legacy journal/date lineage still must pass corpus exclusions.
  // A feed-delivered note is never journal content: the feed stamp says so
  // on its own, and it agrees with the seed stamp (the importer writes
  // both). The seed exclusion already covers every imported note, so the
  // storage projection — which reads columns, not the feed stamp — reaches
  // the same answer.
  return item.type !== 'dashboard'
    && item.type !== 'effort'
    && item.type !== 'equipment'
    && item.seedOrigin !== 'seed'
    && item.feedOrigin !== 'feed'
    && item.seedChunkId === undefined
    && !(!!item.sourcePath && item.sourcePath.startsWith('markdown/'));
}

/**
 * Storage-identity shape per WQL source kind — THE one table of `sourceId`
 * prefixes and exact literals. The JS residual filter (`sourceMatches`) and
 * the storage wire's SQL projection (`sourceKindSql` in
 * @bitcobblers/wod-wiki-storage) both derive from this table, so the two
 * planes cannot disagree, and the source-id tier of {@link notebookOfItem}
 * agrees with both by construction. `journal` is absent on purpose: it is
 * the resolver's fallback decision, materialized as the computed `journal`
 * column, not a sourceId shape.
 */
export const SOURCE_ID_SHAPES: Readonly<Record<string, {
  /** sourceIds exactly equal to one of these match the kind. */
  exact?: readonly string[];
  /** sourceIds starting with one of these match the kind. */
  prefixes?: readonly string[];
  /** Legacy rows that predate the sourceId convention match via note `type`. */
  legacyType?: string;
}>> = {
  notebooks: { prefixes: ['notebook:'] },
  pages: { exact: ['page'], prefixes: ['page:', 'guides:'] },
  guides: { prefixes: ['guides:'] },
  playground: { exact: ['playground'], legacyType: 'playground' },
  efforts: { exact: ['efforts'] },
  equipment: { exact: ['equipment'] },
  dashboards: { exact: ['dashboards'] },
};

/** Query-vocabulary aliases for the shape table kinds. */
const SOURCE_SHAPE_ALIASES: Record<string, string> = {
  page: 'pages',
  guide: 'guides',
};

/** The storage-identity shape for a WQL source kind (aliases resolved), or
 *  undefined for kinds that are not pure sourceId shapes (`journal`, `all`,
 *  plain sourceId literals). The storage wire's SQL
 *  projection reads the same accessor. */
export function sourceShape(kind: string): (typeof SOURCE_ID_SHAPES)[string] | undefined {
  return SOURCE_ID_SHAPES[SOURCE_SHAPE_ALIASES[kind] ?? kind];
}

/** Match a single row against one source filter value. The `journal` kind is
 *  the resolver's own answer: a row journals exactly when
 *  {@link notebookOfItem} places it in `notebook/journal` — no sourceId
 *  identity, no corpus path, no notebookId, no `notebook:` tag (see
 *  {@link isJournalRow} for the fallback's shape exclusions).
 *  The feed / guide / page / playground / corpus kinds read the shared
 *  {@link SOURCE_ID_SHAPES} table — the same sourceId prefixes/exact literals
 *  the storage wire's SQL projection is built from. A `kind:id` literal matches
 *  the exact id. `playground` matches the playground intake's sourceId convention
 *  and, on the note plane, legacy rows typed 'playground' (playground pages
 *  saved before the sourceId convention existed — their sourceId is absent).
 *  `all` spans exactly the WQL source domain plus sourceless rows — identical
 *  to the source fence. Exported so host mappers
 *  classify result rows with the exact predicate the `source:` filter
 *  applies. */
export function sourceMatches(
  item: {
    id?: string; noteId?: string; sourceId?: string; type?: string;
    seedOrigin?: string; seedChunkId?: string; feedOrigin?: string; feedSourceId?: string;
    sourcePath?: string; notebookId?: string;
    tags?: readonly string[];
  },
  kind: string,
): boolean {
  const sourceId = item.sourceId;
  if (kind === 'all') return !sourceId || WQL_SOURCE_VALUES.some((k) => sourceMatches(item, k));
  if (kind === 'journal') {
    // One decision: a row journals exactly when the resolver's fallback
    // places it in notebook/journal — explicit notebookId, notebook: tags,
    // corpus paths, and sourceId identities all outrank the fallback.
    return notebookOfItem(item) === 'notebook/journal';
  }
  const shape = sourceShape(kind);
  if (shape) {
    const idHit = !!sourceId
      && (shape.exact?.includes(sourceId) || shape.prefixes?.some((p) => sourceId.startsWith(p)) === true);
    return idHit || (!!shape.legacyType && item.type === shape.legacyType);
  }
  if (kind.startsWith('notebook:') || kind.startsWith('notebook/')) {
    // `notebook:<slug>` targets one notebook's notes; a full
    // `notebook:<slug>/<item>` id targets that single note (its sourceId
    // carries the same shape).
    const rest = notebookSlugFromId(kind);
    const idRest = sourceId?.startsWith('notebook:') ? sourceId.slice('notebook:'.length) : undefined;
    if (!idRest) return notebookOfItem(item) === toNotebookId(kind);
    return idRest === rest || idRest.startsWith(`${rest}/`);
  }
  return sourceId === kind;
}

/** Apply the `source:` filter key to a list of objects that carry `sourceId`. */
function applySourceFilter<T extends { sourceId?: string; type?: string }>(items: T[], filters: TagFilter[]): T[] {
  for (const filter of filters) {
    if (filter.key !== 'source') continue;
    const wants = filter.values.map(v => v.value);
    items = items.filter(item => {
      const match = wants.some(w => sourceMatches(item, w));
      return filter.negate ? !match : match;
    });
  }
  return items;
}

/** Apply the `notebook:` filter key to a list of Note or BlockIndexRow items. */
function applyNotebookFilter<T extends Parameters<typeof notebookOfItem>[0]>(items: T[], filters: TagFilter[]): T[] {
  for (const filter of filters) {
    if (filter.key !== 'notebook') continue;
    const wanted = new Set(filter.values.map(v => toNotebookId(v.value)));
    items = items.filter(item => {
      const nb = notebookOfItem(item);
      if (!nb) return filter.negate;
      const hit = wanted.has(nb);
      return filter.negate ? !hit : hit;
    });
  }
  return items;
}

/** Source kinds whose matching is pure sourceId-shape logic on both planes.
 *  `journal` additionally excludes legacy pg-* rows in JS and `all` spans the
 *  whole WQL domain — queries naming them stay fully residual so the JS
 *  predicate stays the sole decider. */
const DOMAIN_SOURCE_KINDS: Record<string, true> = {
  notebooks: true,
  page: true,
  pages: true,
  guide: true,
  guides: true,
  playground: true,
};

/** Compiled domain candidate read for a content plane. `selection` carries
 *  the pre-count stages the wire performs before selectedCount (source
 *  clauses + the :note defaultNotes exclusion + the explicit WQL source
 *  fence); `filters` carries the post-count clauses (positive literal type /
 *  exact id / literal text substring — the wire's case-insensitive text is
 *  exactly the JS stage's lowercase-includes).
 *  `residual` is true when ANY authored filter must still be
 *  applied in JS — a residual read is never server-limited, because limiting
 *  before a residual filter would drop rows the pipeline would have kept. */
interface CompiledContentRead {
  selection: WqlDomainPredicate[];
  filters: WqlDomainPredicate[];
  residual: boolean;
}

/** Compile a plane's content filters for the domain candidate read — only
 *  clauses whose semantics match the storage wire exactly. Wildcards,
 *  negations, tags/effort/notebook/date/page, and `journal`/`all` source
 *  kinds stay residual JS filters. The candidate read is a SUPERSET either
 *  way; the JS pipeline re-applies every stage and owns the final slice. */
function compileContentRead(filters: TagFilter[], plane: 'note' | 'block', sourceScope?: string[]): CompiledContentRead {
  const selection: WqlDomainPredicate[] = [];
  const compiled: WqlDomainPredicate[] = [];
  let residual = false;
  for (const filter of filters) {
    const literal = !filter.negate && filter.values.every((v) => !v.wildcard);
    const values = literal ? filter.values.map((v) => v.value) : [];
    if (filter.key === 'source' && literal && filter.values.every((v) => DOMAIN_SOURCE_KINDS[v.value] === true)) {
      selection.push({ field: 'source', values });
      continue;
    }
    if (filter.key === 'type' && literal) {
      compiled.push({ field: 'type', values });
      continue;
    }
    if (filter.key === 'page') {
      // A page filter (any polarity) is applied in JS.
      residual = true;
      continue;
    }
    if (plane === 'note' && (WQL_TYPED_TAG_KEYS as readonly string[]).includes(filter.key) && literal) {
      // Typed-tag narrow (ticket 08) — the wire's typedTag arm joins the
      // tags by-type index, exactly the JS stage's (type, label) resolution.
      // Note plane only: runFindBlock never applies typed tags in JS.
      compiled.push({ field: 'typedTag', tagType: filter.key, values });
      continue;
    }
    if (filter.key === 'text' && literal) {
      // Wire and JS both match title or the full authored Note body.
      compiled.push({ field: 'text', value: values.join(' ') });
      continue;
    }
    if (filter.key === 'note' && literal) {
      compiled.push({ field: plane === 'block' ? 'noteId' : 'id', values });
      continue;
    }
    residual = true;
  }
  if (plane === 'note' && sourceScope?.length) {
    selection.push({ field: 'source', values: sourceScope });
  }
  // The note plane is inclusive — no defaultNotes clause, no source fence
  // (generic :note surfaces every row). The block plane keeps its
  // historical fence: candidates come from the WQL source domain.
  if (plane === 'block') {
    selection.push({ field: 'sourceFence' });
  }
  return { selection, filters: compiled, residual };
}

/** :note pre-count selection stages — authored source clauses and the
 *  parse-authored sourceScope, shared verbatim by the merged pipeline and
 *  the static-plane selected count. The generic note plane is inclusive:
 *  no default page exclusion and no source fence — feeds, arbitrary source
 *  strings, typed pages and dashboards all surface; positive `source:`
 *  filters and source negations do the scoping. */
function applyNoteSelectionStages(notes: Note[], parsed: ParsedFindQuery): Note[] {
  let rows = applySourceFilter(notes, parsed.filters);
  if (parsed.sourceScope?.length) {
    const scope = parsed.sourceScope;
    rows = rows.filter((n) => scope.some((k) => sourceMatches(n, k)));
  }
  return rows;
}

/** Server order/page clauses for a candidate read. Natural id order rides
 *  EVERY read: the server's default row order is unspecified, and id order
 *  is exactly the historical whole-store iteration order the JS pipeline
 *  surfaces when no `| order` pipe exists. offset/limit ride only when NO
 *  residual filter, window, join, or authored order precedes the slice, so
 *  limiting cannot drop rows the pipeline would keep. Authored `| order`
 *  always sorts in JS over the complete candidate set instead. */
function domainPaging(
  parsed: ParsedFindQuery,
  options: FindOptions,
  residual: boolean,
): { order: WqlDomainOrder[]; offset?: number; limit?: number; paged: boolean } {
  const pipes = parsed.pipes;
  const wantsPage = pipes?.limit !== undefined || (pipes?.offset ?? 0) > 0;
  if (residual || parsed.join || parsed.window || options.range || pipes?.order || !wantsPage) {
    return { order: [{ field: 'id', direction: 'asc' }], paged: false };
  }
  return {
    order: [{ field: 'id', direction: 'asc' }],
    ...(pipes?.offset ? { offset: pipes.offset } : {}),
    ...(pipes?.limit !== undefined ? { limit: pipes.limit } : {}),
    paged: true,
  };
}

/** Resolve the single execution context for a run: the caller's captured
 *  context when provided (ticket 19's runner captures once per document),
 *  else a fresh capture from `anchorNow`/now in the system timezone. */
function runContext(options: { context?: ExecutionContext; anchorNow?: number }): ExecutionContext {
  if (options.context) return options.context;
  return captureContext(options.anchorNow);
}

/** Time-window predicate for a row (C1 + ticket 12): the query's own window
 *  WINS over the explicit host `range` option — the host range supplies the
 *  default only when the query has none. Resolution happens against the one
 *  captured execution context; membership is half-open [start, end). */
function effectiveTimeWindow(
  createdAt: number,
  window: QueryWindow | undefined,
  range: ResolvedRange | undefined,
  ctx: ExecutionContext,
): boolean {
  const resolved = window ? resolveWindowRange(window, ctx) : range;
  return inRange(createdAt, resolved);
}
function sessionCompletedAt(rows: EventRecord[]): number {
  const completion = rows.find((r) => r.outputType === 'completion');
  if (completion?.timestamp) return completion.timestamp;
  return rows[0]?.timestamp ?? 0;
}

/** C1 + ticket 12 range resolution for aggregate execution: the query's own
 *  window WINS over the host range options — the host range is the default
 *  when the query has none. Resolution against the one captured context;
 *  membership half-open. */
function resolveAggregateRange(
  parsed: ParsedAggregateQuery,
  options: QueryOptions,
  ctx: ExecutionContext,
): ResolvedRange | undefined {
  if (parsed.window) return resolveWindowRange(parsed.window, ctx);
  if (options.rangeStart !== undefined || options.rangeEnd !== undefined) {
    return {
      start: options.rangeStart ?? 0,
      end: options.rangeEnd ?? Number.MAX_SAFE_INTEGER,
      endExclusive: false,
    };
  }
  return undefined;
}

const defaultEventStore: EventStore = {
  getEventsByTimeRange: async () => [],
  getEventsByResult: async () => [],
  getEventsForNote: async () => [],
  getEventsByContent: async () => [],
  scanAll: async () => [],
  appendEvents: async () => {},
  finalizeSummaries: async () => {},
  deleteEvents: async () => {},
};

const defaultNoteStore: NoteQueryStore = {
  getAllNotes: async () => [],
  getNoteIdsForTag: async () => new Set<string>(),
  getNoteTagLabels: async () => [],
};

const defaultBlockStore: BlockQueryStore = {
  getAllBlocks: async () => [],
};

const defaultEffortStore: EffortQueryStore = {
  getAllEfforts: async () => [],
};

export interface FindQueryResult {
  parsed: ParsedFindQuery;
  notes: Note[];
  blocks: BlockIndexRow[];
  /** Registry rows for :effort queries. */
  efforts?: IEffort[];
  /** Session run cards for :session queries (#1041). */
  runs?: RowsRun[];
  /** Tabular output for :segment and :event queries (#1042). */
  table?: TabularResult;
  /** Raw event rows behind the result — session run statements and table
   *  observations. Pipeline stages aggregate these in memory (no re-read). */
  events?: EventRecord[];
  /** Highest container per note id: the parent Page when the canonical
   *  page_notes junction links one, else the standalone Note. Present only
   *  when a pageStore is injected and notes were matched. */
  containers?: Record<string, NoteContainer>;
  /** Every page a matched note is placed on, keyed by note id — the
   *  many-to-many membership itself. `containers` is the deterministic
   *  primary projection of this map. Present only when a pageStore or
   *  relationStore is injected and notes were matched. */
  placements?: Record<string, NotePlacement[]>;
  stages: { selected: number; matched: number };
}

/** Highest-container link for a matched note (parent Page wins). `slug` and
 *  `date` route app URLs (/page/:slug, /day/:date). Core Page has no type —
 *  the parent is never classified by the note's kind. */
export type NoteContainer =
  | { kind: 'page'; id: string; slug?: string; date?: string }
  | { kind: 'note'; id: string };

/** Options for runPipeline: query options plus host-populated datasets.
 *  `pageSources` wins over an injected `datasetStore`; both are synchronous
 *  in-memory lookups — dataset stages never roundtrip the database. */
export interface PipelineOptions extends QueryOptions {
  /** Host-populated datasets keyed by name (names include `@`). */
  pageSources?: ReadonlyMap<string, { events: EventRecord[]; notes: Note[] }>;
}

/** Result of one pipeline run: the final stage's data under its existing
 *  result type, plus the chart sink marker for the renderer. */
export interface PipelineResult {
  parsed: ParsedPipelineQuery;
  series?: Series[];
  table?: TabularResult;
  notes?: Note[];
  blocks?: BlockIndexRow[];
  efforts?: IEffort[];
  runs?: RowsRun[];
  /** Highest container per note id (see FindQueryResult.containers). */
  containers?: Record<string, NoteContainer>;
  /** Every page a matched note is placed on (see FindQueryResult.placements). */
  placements?: Record<string, NotePlacement[]>;
  unit?: string;
  chart?: PipelineSink;
  error?: string;
}

export interface QueryOptions {
  rangeStart?: number;
  rangeEnd?: number;
  /** App-level unit preference ('kg' | 'lb'). Used when query has no `in <unit>` directive. */
  preferredUnit?: string;
  /** Captured execution context (ticket 12) — one `{instant, timeZone}`
   *  capture per document run; defaults to a fresh system capture. */
  context?: ExecutionContext;
}

/** Options for `runFind` / `runFindBlock` — overrides for the parsed WQL. */
export interface FindOptions {
  /** Host-supplied timestamp range (half-open [start, end)) — the DEFAULT
   *  when the parsed WQL has no window; an explicit query window wins. */
  range?: ResolvedRange;
  /** Explicit reference time for the window (tests/replay). Superseded by
   *  `context` when both are given. */
  anchorNow?: number;
  /** Captured execution context (ticket 12). */
  context?: ExecutionContext;
  isNotebookSubscribed?: (feedId: string, chunkId: string) => boolean;
}

export interface QueryResult {
  parsed: ParsedAggregateQuery;
  series: Series[];
  stages: { selected: number; buckets: number; aggregated: number; groups: number };
  matched: AnalyticsDataPoint[];
  /** Single scalar value when the result has exactly one point. */
  scalar?: number;
  /** Result display unit, if determined by directive, preference, or fact metadata. */
  unit?: string;
  /** First diagnostic across series (ticket 13) — per-widget badges in 19. */
  error?: string;
  /** Compact coverage references (ticket 16 explainability). */
  coverage?: CoverageReport;
}

/** One run in a rows result: the canonical result identity plus the event
 *  rows that survived the optional output-type narrowing (`rows:segment{…}`). */
export interface RowsRun {
  resultId: string;
  noteId: string;
  /** Canonical workout time (result.createdAt under the unified model). */
  timestamp: number;
  events: EventRecord[];
}

export interface RowsQueryResult {
  parsed: ParsedRowsQuery;
  runs: RowsRun[];
  error?: string;
  /** Ticket 18 — cross-workout tabular result (cross-workout rows only). */
  table?: TabularResult;
}

// ── Ticket 18: cross-workout analytical tables ──────────────────────────

export interface TabularColumn {
  name: string;
  type: 'date' | 'string' | 'number';
  unit?: string;
}

/** Civil dates (YYYY-MM-DD, `timeZone`-local) whose [local midnight,
 * next local midnight) windows intersect `[start, end)` — the by-metric-date
 * candidate set for the complete fetch (ticket 12/14). Callers pass bounded
 * ranges only: an unbounded side uses the all-store scan as the complete
 * fetch instead of enumerating an open horizon. */
export function civilDatesCoveredByRange(start: number, end: number, timeZone: string): string[] {
    const dates: string[] = [];
    let cursor = start;
    while (cursor < end) {
        const iso = civilDateOf(cursor, timeZone);
        // Cursor is monotone, so civil dates are non-decreasing — the
        // last-element check dedupes the mid-day start boundary.
        if (dates[dates.length - 1] !== iso) dates.push(iso);
        // Local midnight of the day AFTER `iso` — component math via
        // zonedStartOfDay: 23h/25h DST days still start at their own 00:00,
        // and nonexistent-midnight zones start the day at the transition
        // instant. Every covered civil date is enumerated, including the
        // end boundary's own (possibly partial) day.
        const nextMidnight = zonedStartOfDay(civilDateAdd(iso, 1), timeZone);
        // Progress guard: a stalled or backwards midnight must never loop
        // forever (NaN instants fail the `cursor < end` test and exit).
        if (nextMidnight <= cursor) break;
        cursor = nextMidnight;
    }
    return dates;
}

/** The stable tabular shape consumed by table widgets (ticket 19 wires
 *  widgets): bounded page + full match count. Missing column values are
 *  ABSENT (undefined) — strictly distinct from a recorded 0. */
export interface TabularGroup {
  key: string;
  label: string;
  rows: Array<Record<string, unknown>>;
}

export interface TabularResult {
  columns: TabularColumn[];
  rows: Array<Record<string, unknown>>;
  groups?: TabularGroup[];
  totalCount: number;
  limit?: number;
  offset?: number;
}

/**
 * Tag value for a fact row. Tag keys map onto fact fields; 'tags' is the
 * note_tags label set of the parent note (loaded per query, only when used).
 */
function factTagValue(row: AnalyticsDataPoint, key: string, noteTags: ReadonlyMap<string, readonly string[]>): string | readonly string[] | undefined {
  switch (key) {
    case 'effort': return row.effortSlug;
    case 'discipline': return row.discipline;
    case 'intensity': return row.intensityTier;
    case 'grade': return row.grade;
    case 'note': return row.noteId;
    case 'page': return row.pageId;
    case 'origin': return row.origin;
    case 'grain': return row.grain;
    case 'metric': return row.metricKey;
    case 'block': return row.blockContentId;
    case 'result': return row.resultId;
    case 'tags': return noteTags.get(row.noteId) ?? [];
    default: {
      // Custom dimensions: user-authored property metrics and grouped
      // partitions live in row.dimensions under normalized (camelCase)
      // keys — `{coach:greg}` and `by {coach}` resolve here. Facts without
      // the dim group/filter as unassigned.
      const dims = row.dimensions;
      if (!dims) return undefined;
      return dims[key] ?? dims[normalizeFieldComponent(key)];
    }
  }
}

function matchesFilters(row: AnalyticsDataPoint, filters: TagFilter[], noteTags: ReadonlyMap<string, readonly string[]>): boolean {
  // OR within a key (and sign); AND across keys/signs. Negation spans the
  // whole value list for that key/sign.
  const groups = new Map<string, TagFilter[]>();
  for (const f of filters) {
    const groupKey = `${f.negate ? '!' : ''}${f.key}`;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(f);
    else groups.set(groupKey, [f]);
  }
  return [...groups.values()].every((group) => {
    const key = group[0].key;
    const negate = group[0].negate;
    const raw = factTagValue(row, key, noteTags);
    const rowValues = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
    const hit = rowValues.some((value) =>
      group.some((f) =>
        f.values.some((a) =>
          a.wildcard ? value.startsWith(a.value) : value === a.value,
        ),
      ),
    );
    return negate ? !hit : hit;
  });
}

/** Dimension value for grouping; virtual time dims bucket the canonical
 *  time by LOCAL CIVIL CALENDAR (spec v2 decision 2): `day` keys are local
 *  YYYY-MM-DD; `week` keys are the civil Monday's YYYY-MM-DD, computed by
 *  component math — never instant arithmetic, which mislabels DST-shifted
 *  weeks. Keys are locale-independent and lexically sortable.
 *
 *  NOTE: buildResult routes `day`/`week` groupBys to civil bucket keys and
 *  filters them out of tagDims, so the time-dim branches below are
 *  defensive only — kept canonical in case a caller surfaces time dims as
 *  string keys. */
function dimValue(
  row: AnalyticsDataPoint,
  dim: string,
  noteTags: ReadonlyMap<string, readonly string[]>,
  ctx: ExecutionContext,
): string {
  // Calendar grouping uses the observation's own temporal anchor (ticket 12):
  // a date-only fact groups under its recorded civil date — never a fabricated
  // midnight instant; an instant fact under its civil date in the context tz.
  if (dim === 'day') return row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone);
  if (dim === 'week') return civilMonday(row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone));
  if (dim === 'session') return row.resultId;
  const raw = factTagValue(row, dim, noteTags);
  // Ticket 16 (finding 3.5): missing group values resolve to the structural
  // UNASSIGNED sentinel — never a literal '(none)' masquerading as data.
  if (raw === undefined) return UNASSIGNED;
  if (typeof raw === 'string') return raw;
  return raw.length ? raw.join(',') : UNASSIGNED;
}

/** Structural missing-group sentinel — distinct from any literal text
 *  (group identity is the JSON tuple, so it cannot collide). */
export const UNASSIGNED = '\u0000unassigned';

/** Result state of a bucket reduction (arithmetic contract §2): observed
 *  values are genuine reductions of recorded observations; absent results
 *  have no observation (render zero only at display); errors are
 *  diagnostics, not numbers. */
type ReducedValue =
  | { state: 'observed'; value: number }
  | { state: 'absent'; value: 0 }
  | { state: 'error'; message: string };

/** Reduce one bucket's already-converted observation values per the
 *  operation matrix. Missing domain positions are handled by the caller
 *  (zero-filled synthetic points); this reduces actual observations. */
function aggregate(values: number[], agg: Aggregator, points: AnalyticsDataPoint[]): ReducedValue {
  if (agg === 'count') return { state: 'observed', value: points.length };
  if (values.length === 0) return { state: 'absent', value: 0 };
  switch (agg) {
    case 'sum':
      return { state: 'observed', value: values.reduce((a, b) => a + b, 0) };
    case 'avg':
      return { state: 'observed', value: values.reduce((a, b) => a + b, 0) / values.length };
    case 'min':
      return { state: 'observed', value: Math.min(...values) };
    case 'max':
      return { state: 'observed', value: Math.max(...values) };
    case 'last': {
      // Metric-date order — fetch order never decides the endpoint. The
      // value comes from the already-converted array (values[i] ↔ points[i]).
      let latest = 0;
      for (let i = 0; i < points.length; i++) {
        if (points[i]!.timestamp > points[latest]!.timestamp) latest = i;
      }
      return { state: 'observed', value: values[latest]! };
    }
    case 'delta': {
      if (points.length < 2) return { state: 'absent', value: 0 };
      // Sort (point, converted value) PAIRS — the values[i] ↔ points[i]
      // alignment must survive the reorder (ticket 13: conversion before
      // arithmetic; metric-date chronological endpoints).
      const ordered = points
        .map((point, i) => ({ point, value: values[i]! }))
        .sort((a, b) => a.point.timestamp - b.point.timestamp);
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      // Equal-timestamp endpoints with different values and no recorded
      // order evidence are an ambiguous-order error.
      const atFirst = ordered.filter((p) => p.point.timestamp === first.point.timestamp);
      const atLast = ordered.filter((p) => p.point.timestamp === last.point.timestamp);
      const firstVals = new Set(atFirst.map((p) => p.point.value));
      const lastVals = new Set(atLast.map((p) => p.point.value));
      if (firstVals.size > 1 || lastVals.size > 1) {
        return { state: 'error', message: 'Ambiguous delta order: tied endpoint observations differ in value without recorded order' };
      }
      return { state: 'observed', value: last.value - first.value };
    }
  }
}

/** Apply a cross-store metric predicate's comparison op. */
function compareOp(value: number, op: ComparisonOp, threshold: number): boolean {
  switch (op) {
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
  }
}

/** Reduce an already-aggregated pipeline stage with the next transform —
 *  functions act on the PRECEDING numeric result, never re-query facts.
 *  Supported authored modifiers on a carried stage: `last <n>d|w` /
 *  `from…to…` windows (filter the carried points by ts) and `in <unit>`
 *  (convert BEFORE arithmetic, ticket 13 — values and observation points
 *  stay aligned for last/delta). Filters, group-bys, rollups, and content
 *  joins have no fact dimensions to resolve on carried values — they error
 *  explicitly instead of being silently ignored. `metric:` must match the
 *  preceding stage's metric (rep≡reps) — a mismatch mislabels the result. */
function reduceCarriedResult(qr: QueryResult, transform: ParsedAggregateQuery, options: QueryOptions, ctx: ExecutionContext): QueryResult {
  const zero = { selected: 0, buckets: 0, aggregated: 0, groups: 0 } as const;
  const unsupported = [
    transform.join && 'where <content> join',
    transform.filters.length > 0 && 'tag filters',
    transform.groupBy.length > 0 && 'by {…} grouping',
    transform.rollup && '.rollup(…)',
  ].filter(Boolean) as string[];
  if (unsupported.length > 0) {
    return {
      parsed: transform, series: [], stages: { ...zero }, matched: [],
      error: `:${transform.agg}{…} on a carried stage cannot apply ${unsupported.join(', ')} — carried values carry no fact dimensions; author them in the source stage.`,
    };
  }
  // An errored stage poisons everything downstream — stop before reducing.
  if (qr.error) return qr;

  const range = resolveAggregateRange(transform, options, ctx);
  const values: number[] = [];
  const points: AnalyticsDataPoint[] = [];
  let lastTs = 0;
  for (const s of qr.series) {
    for (const p of s.points) {
      if (p.missing) continue;
      if (range && !inRange(p.ts, range)) continue;
      values.push(p.value);
      points.push({ timestamp: p.ts, value: p.value, noteId: '', resultId: '' } as AnalyticsDataPoint);
      if (p.ts > lastTs) lastTs = p.ts;
    }
  }

  // Carried values are the previous stage's metric — a different metric:
  // mislabels the reduction. Empty metric inherits the carried provenance
  // (rep/reps aliases compare equal).
  const sameMetric = (a: string, b: string) =>
    a === b || (a === 'rep' && b === 'reps') || (a === 'reps' && b === 'rep');
  if (transform.metric && !(qr.parsed.metric && sameMetric(transform.metric, qr.parsed.metric))) {
    return {
      parsed: transform, series: [], stages: { ...zero }, matched: [],
      error: `:${transform.agg}{metric:${transform.metric}} on a carried stage reduces the preceding "${qr.parsed.metric || 'metricless'}" values — metric:${transform.metric} does not exist on them.`,
    };
  }

  // `in <unit>` on a carried stage converts the carried values (all one
  // unit) before the reduction; unitless or count stages cannot convert.
  let unit = transform.agg === 'count' ? 'count' : qr.unit;
  if (transform.displayUnit) {
    if (!unit || unit === 'count') {
      return {
        parsed: transform, series: [], stages: { ...zero }, matched: [],
        error: `Cannot apply in ${transform.displayUnit} — the preceding stage carries no convertible unit.`,
      };
    }
    try {
      for (let i = 0; i < values.length; i++) {
        const converted = convertViaCatalog(values[i]!, unit, transform.displayUnit);
        values[i] = converted;
        // Keep the observation pair aligned — last/delta read point.value.
        points[i] = { ...points[i]!, value: converted };
      }
      unit = transform.displayUnit;
    } catch (e) {
      return {
        parsed: transform, series: [], stages: { ...zero }, matched: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const reduced = aggregate(values, transform.agg, points);
  if (reduced.state === 'error') {
    return {
      parsed: transform, series: [], stages: { ...zero }, matched: [],
      error: reduced.message,
    };
  }
  return {
    parsed: transform,
    series: [{
      key: transform.agg,
      label: transform.agg,
      points: [{ ts: lastTs || ctx.instant, value: reduced.value, ...(reduced.state === 'absent' ? { missing: true } : {}) }],
      unit,
    }],
    stages: { selected: values.length, buckets: 1, aggregated: 1, groups: 1 },
    matched: [],
    ...(unit ? { unit } : {}),
  };
}
export class QueryService {
  private readonly store: EventStore;
  private readonly noteStore: NoteQueryStore;
  private readonly blockStore: BlockQueryStore;
  private readonly effortStore: EffortQueryStore;
  private readonly pageStore?: {
    getNotePages(noteId: string): Promise<PageNote[]>;
    getPage(pageId: string): Promise<Page | undefined>;
    /** Whole-plane reads backing `:page{}` (the placement plane). */
    getAllPages?(): Promise<Page[]>;
    getAllLinks?(): Promise<PageNote[]>;
  };
  private readonly relationStore?: {
    getBatches(noteIds: readonly string[]): Promise<Map<string, NoteRelationBundle>>;
  };
  private readonly datasetStore?: {
    getDataset(name: string): { events: EventRecord[]; notes: Note[] } | undefined;
  };
  private readonly isNotebookSubscribed?: (feedId: string, chunkId: string) => boolean;

  // Optional storage seam properties for block_efforts and typed tag resolution.
  // Injected by the app adapter (`services/queryService.ts`); tests can supply fakes.
  private blockEffortsStore: { getAllFromIndex(index: string, key: string): Promise<any[]> } = {
    getAllFromIndex: async () => [],
  };
  private tagsStore: { getAllFromIndex(index: string, key: string): Promise<any[]>; getAll?(): Promise<any[]> } = {
    getAllFromIndex: async () => [],
  };
  private noteTagsStore: { getAllFromIndex(index: string, key: string): Promise<any[]> } = {
    getAllFromIndex: async () => [],
  };

  constructor(
    storesOrEventStore?: QueryServiceStores | EventStore,
    noteStore?: NoteQueryStore,
    blockStore?: BlockQueryStore,
    effortStore?: EffortQueryStore,
  ) {
    if (
      storesOrEventStore &&
      typeof storesOrEventStore === 'object' &&
      ('eventStore' in storesOrEventStore ||
        'noteStore' in storesOrEventStore ||
        'blockStore' in storesOrEventStore ||
        'effortStore' in storesOrEventStore ||
        'pageStore' in storesOrEventStore ||
        'relationStore' in storesOrEventStore ||
        'datasetStore' in storesOrEventStore)
    ) {
      const stores = storesOrEventStore as QueryServiceStores;
      this.store = stores.eventStore ?? defaultEventStore;
      this.noteStore = stores.noteStore ?? defaultNoteStore;
      this.blockStore = stores.blockStore ?? defaultBlockStore;
      this.effortStore = stores.effortStore ?? defaultEffortStore;
      this.pageStore = stores.pageStore;
      this.relationStore = stores.relationStore;
      this.datasetStore = stores.datasetStore;
      if (stores.blockEffortsStore) this.blockEffortsStore = stores.blockEffortsStore;
      if (stores.tagsStore) this.tagsStore = stores.tagsStore;
      if (stores.noteTagsStore) this.noteTagsStore = stores.noteTagsStore;
      if (stores.isNotebookSubscribed) this.isNotebookSubscribed = stores.isNotebookSubscribed;
    } else {
      this.store = (storesOrEventStore as EventStore | undefined) ?? defaultEventStore;
      this.noteStore = noteStore ?? defaultNoteStore;
      this.blockStore = blockStore ?? defaultBlockStore;
      this.effortStore = effortStore ?? defaultEffortStore;
    }
  }

  /** Windowed flat-fact fetch — the projected view over the event store. */
  async getFactsByTimeRange(start: number, end: number): Promise<AnalyticsDataPoint[]> {
    const rows = await this.store.getEventsByTimeRange(start, end);
    return rows.flatMap(projectEventToFacts);
  }

  async runQuery(raw: string, options: QueryOptions = {}): Promise<QueryResult> {
    const parsed = parseQuery(raw);
    if (isPipelineQuery(parsed)) return this.pipelineResultToQueryResult(await this.runPipelineParsed(parsed, options));
    return this.run(parsed, options);
  }

  /**
   * Legacy rows-family executor kept for hand-built ASTs (RowsTable, CLI).
   * Text `rows:…` no longer parses (#1044); this delegates to the find paths
   * so a programmatic ParsedRowsQuery still resolves.
   */
  async runRows(parsed: ParsedRowsQuery, options: { anchorNow?: number; context?: ExecutionContext } = {}): Promise<RowsQueryResult> {
    // Hand-built rows AST → find noun: `all`/missing → :session; a result
    // plane (segment/load/…) narrows via plane: on :session; rows:segment
    // without a scope is the cross-workout table (:segment).
    const scope = parsed.filters.some((f) => ['result', 'block', 'note'].includes(f.key));
    const plane = parsed.outputType ?? (parsed.target !== 'all' ? parsed.target : undefined);
    let target: string;
    let filters = parsed.filters;
    if (!plane) {
      target = 'session';
    } else if (plane === 'segment' && !scope) {
      target = 'segment';
    } else {
      target = 'session';
      filters = [...parsed.filters, { key: 'plane', negate: false, values: [{ value: plane, wildcard: false }] }];
    }
    const asFind: ParsedFindQuery = {
      family: 'find',
      raw: parsed.raw,
      target,
      filters,
      ...(parsed.window ? { window: parsed.window } : {}),
      ...(parsed.pipes ? { pipes: parsed.pipes } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
    };
    const res = await this.runFind(asFind, options);
    return { parsed, runs: res.runs ?? [], ...(res.table ? { table: res.table } : {}) };
  }

  /**
   * Execute a :session query (#1041/#1042) — grouped run cards per completed session.
   */
  async runFindSession(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    const ctx = runContext(options);
    const scopeValues = (key: string) =>
      parsed.filters.filter((f) => f.key === key).flatMap((f) => f.values.map((v) => v.value));
    const resultIds = scopeValues('result');
    const blockIds = scopeValues('block');
    const noteIds = scopeValues('note');

    const byResult = new Map<string, EventRecord[]>();
    const collected = new Set<string>();
    const collect = (rows: EventRecord[]) => {
      for (const row of rows) {
        if (collected.has(row.id)) continue;
        collected.add(row.id);
        const bucket = byResult.get(row.resultId);
        if (bucket) bucket.push(row);
        else byResult.set(row.resultId, [row]);
      }
    };

    if (resultIds.length + blockIds.length + noteIds.length === 0) {
      const range = parsed.window ? resolveWindowRange(parsed.window, ctx) : (options.range ? options.range : undefined);
      const eventRows = range
        ? await this.store.getEventsByTimeRange(range.start, range.end)
        : await this.store.scanAll();
      collect(eventRows);
    } else {
      for (const id of resultIds) collect(await this.store.getEventsByResult(id));
      for (const blockContentId of blockIds) collect(await this.store.getEventsByContent(blockContentId));
      for (const noteId of noteIds) collect(await this.store.getEventsForNote(noteId));
    }

    let groups = [...byResult.entries()].filter(([, rows]) => rows.length > 0);

    if (parsed.window || options.range) {
      groups = groups.filter(([, rows]) =>
        effectiveTimeWindow(sessionCompletedAt(rows), parsed.window, options.range, ctx),
      );
    }
    groups.sort((a, b) => sessionCompletedAt(b[1]) - sessionCompletedAt(a[1]));

    const planeFilters = parsed.filters.filter((f) => f.key === 'plane');
    let runs: RowsRun[] = groups
      .map(([resultId, rows]) => {
        let events = rows;
        if (planeFilters.length > 0) {
          events = events.filter((row) =>
            planeFilters.every((f) => {
              const matchesAny = f.values.some((v) => v.value === row.outputType);
              return f.negate ? !matchesAny : matchesAny;
            }),
          );
        }
        return {
          resultId,
          noteId: rows[0].noteId,
          timestamp: sessionCompletedAt(rows),
          events,
        };
      })
      .filter((run) => run.events.length > 0);
    // Pagination is presentation: the pipeline's event set stays the FULL
    // plane-narrowed selection, only the run cards are clipped.
    const runsFull = runs;
    const pipes = parsed.pipes;
    if (pipes && (pipes.limit !== undefined || (pipes.offset ?? 0) > 0)) {
      const offset = pipes.offset ?? 0;
      runs = pipes.limit !== undefined ? runs.slice(offset, offset + pipes.limit) : runs.slice(offset);
    }

    return {
      parsed,
      notes: [],
      blocks: [],
      runs,
      events: runsFull.flatMap((run) => run.events),
      stages: { selected: groups.length, matched: runs.length },
    };
  }

  /**
   * Execute a :segment or :event query (#1042/#1048) — flat cross-workout table.
   */
  async runFindTable(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    const ctx = runContext(options);
    const scopeValues = (key: string) =>
      parsed.filters.filter((f) => f.key === key).flatMap((f) => f.values.map((v) => v.value));
    const resultIds = scopeValues('result');
    const blockIds = scopeValues('block');
    const noteIds = scopeValues('note');

    let eventRows: EventRecord[] = [];
    if (resultIds.length + blockIds.length + noteIds.length === 0) {
      const range = parsed.window ? resolveWindowRange(parsed.window, ctx) : (options.range ? options.range : undefined);
      // Complete fetch mirrors run(): bounded windows fetch through
      // by-timestamp and union by-metric-date candidates over EVERY covered
      // civil date; an unbounded side (sentinel bounds) scans — the all-store
      // scan IS the complete fetch. The anchorTs membership filter below
      // keeps either fetch exact.
      const boundedRange =
        range && range.start > 0 && range.end < Number.MAX_SAFE_INTEGER ? range : undefined;
      if (boundedRange) {
        eventRows = await this.store.getEventsByTimeRange(boundedRange.start, boundedRange.end);
        if (this.store.getEventsByMetricDates) {
          const civilDates = civilDatesCoveredByRange(boundedRange.start, boundedRange.end, ctx.timeZone);
          if (civilDates.length > 0) {
            const byDate = await this.store.getEventsByMetricDates(civilDates);
            if (byDate.length > 0) {
              const seen = new Set(eventRows.map((r) => r.id));
              eventRows = [...eventRows, ...byDate.filter((r) => !seen.has(r.id))];
            }
          }
        }
      } else {
        eventRows = await this.store.scanAll();
      }
    } else {
      const seen = new Set<string>();
      const collect = (rows: EventRecord[]) => {
        for (const row of rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            eventRows.push(row);
          }
        }
      };
      for (const id of resultIds) collect(await this.store.getEventsByResult(id));
      for (const blockContentId of blockIds) collect(await this.store.getEventsByContent(blockContentId));
      for (const noteId of noteIds) collect(await this.store.getEventsForNote(noteId));
    }

    const seen = new Set<string>();
    const eligibleRecords: EventRecord[] = [];
    for (const row of eventRows) {
      if (row.grain !== 'event') continue;
      if (parsed.target === 'segment' && row.outputType !== 'segment') continue;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      eligibleRecords.push(row);
    }

    // Selection anchors: a recorded civil date anchors at local noon (the
    // same convention as day bucketing), an instant row at its timestamp.
    const civilDateCache = new Map<number, string>();
    const dateOf = (row: EventRecord): string => {
      const temporal = row.metricTemporal?.[0];
      if (temporal?.temporalKind === 'civil-date' && temporal.civilDate) return temporal.civilDate;
      const cached = civilDateCache.get(row.timestamp);
      if (cached) return cached;
      const computed = civilDateOf(row.timestamp, ctx.timeZone);
      civilDateCache.set(row.timestamp, computed);
      return computed;
    };
    const anchorTs = (row: EventRecord): number => {
      const temporal = row.metricTemporal?.[0];
      if (temporal?.temporalKind === 'civil-date' && temporal.civilDate) return zonedNoon(temporal.civilDate, ctx.timeZone);
      return row.timestamp;
    };

    const noteTags: ReadonlyMap<string, readonly string[]> = new Map();
    const tagFilters = parsed.filters.filter((f) => !['result', 'block', 'note', 'plane'].includes(f.key));
    // C1 + ticket 12: the fetch bound is only a cutoff — scoped and windowed
    // queries alike filter membership by the row's own temporal anchor.
    const timeScoped = !!(parsed.window || options.range);
    const eligible = eligibleRecords
      .filter((row) => !timeScoped || effectiveTimeWindow(anchorTs(row), parsed.window, options.range, ctx))
      .filter((row) => {
        if (tagFilters.length === 0) return true;
        const facts = projectEventToFacts(row);
        if (facts.length === 0) return false;
        return facts.some((fact) => matchesFilters(fact, tagFilters, noteTags));
      });

    const totalCount = eligible.length;

    const unitByMetric = new Map<string, string>();
    const numericMetrics = new Set<string>();
    for (const row of eligible) {
      for (const m of row.metrics as Array<{ type?: string; value?: unknown; unit?: string; metadata?: Record<string, unknown> }>) {
        if (m.type && m.type !== 'label' && typeof m.value === 'number') {
          numericMetrics.add(m.type);
          const key = typeof m.metadata?.canonicalKey === 'string' ? m.metadata.canonicalKey : undefined;
          if (m.unit) {
            unitByMetric.set(m.type, m.unit);
            if (key) unitByMetric.set(key, m.unit);
          }
        }
      }
    }

    const pipes = parsed.pipes;
    const selectCols = pipes?.select?.map((s) => s.col) ?? [
      'date', 'effort', 'discipline', ...numericMetrics,
    ];
    const unitFor = (col: string): string | undefined =>
      pipes?.select?.find((s) => s.col === col)?.unit ?? (parsed.displayUnit ? parsed.displayUnit : unitByMetric.get(col));

    const columns: TabularColumn[] = selectCols.map((col) => {
      if (col === 'date') return { name: 'date', type: 'date' as const };
      if (col === 'effort' || col === 'discipline' || col === 'note' || col === 'grade' || col === 'intensity') {
        return { name: col, type: 'string' as const };
      }
      return { name: col, type: 'number' as const, ...(unitFor(col) ? { unit: unitFor(col) } : {}) };
    });

    const typeOf = new Map(columns.map((c) => [c.name, c.type]));

    let records = eligible.map((row) => {
      const record: Record<string, unknown> = {};
      for (const col of selectCols) {
        const type = typeOf.get(col);
        if (type === 'date') {
          record.date = dateOf(row);
        } else if (col === 'effort') {
          record.effort = row.effortSlug;
        } else if (col === 'discipline') {
          const m = (row.metrics as Array<{ metadata?: Record<string, unknown> }>).find((m) => m.metadata?.effortDiscipline);
          record.discipline = m?.metadata?.effortDiscipline;
        } else {
          const m = (row.metrics as Array<{ type?: string; value?: unknown; unit?: string; metadata?: Record<string, unknown> }>).find(
            (m) => m.type === col || m.metadata?.canonicalKey === col,
          );
          if (m && typeof m.value === 'number') {
            let val = m.value;
            if (parsed.displayUnit && m.unit && m.unit !== parsed.displayUnit) {
              try {
                val = convertViaCatalog(val, m.unit, parsed.displayUnit);
              } catch {
                // ponytail: pass-through if conversion fails; full unit graph handled by units.ts
              }
            }
            record[col] = val;
          } else {
            record[col] = m ? m.value : undefined;
          }
        }
      }
      record.__id = row.id;
      record.__resultId = row.resultId;
      return record;
    });

    for (const order of [...(pipes?.order ?? [])].reverse()) {
      const dir = order.dir === 'desc' ? -1 : 1;
      records = [...records].sort((a, b) => {
        const av = a[order.col] ?? a.__id;
        const bv = b[order.col] ?? b.__id;
        if (av === bv) return 0;
        return ((av as number | string) > (bv as number | string) ? 1 : -1) * dir;
      });
    }

    let groups: Array<{ key: string; label: string; rows: Array<Record<string, unknown>> }> | undefined;
    if (parsed.groupBy && parsed.groupBy.length > 0) {
      const groupMap = new Map<string, Array<Record<string, unknown>>>();
      for (const rec of records) {
        const groupVals = parsed.groupBy.map((dim) => String(rec[dim] ?? 'unassigned'));
        const key = groupVals.join(' · ');
        const existing = groupMap.get(key);
        if (existing) existing.push(rec);
        else groupMap.set(key, [rec]);
      }
      groups = [...groupMap.entries()].map(([key, rows]) => ({ key, label: key, rows }));
    }

    const offset = pipes?.offset ?? 0;
    const limit = pipes?.limit;
    const page = limit !== undefined ? records.slice(offset, offset + limit) : records.slice(offset);

    return {
      parsed,
      notes: [],
      blocks: [],
      runs: [],
      events: eligible,
      table: {
        columns,
        rows: page,
        ...(groups ? { groups } : {}),
        totalCount,
        ...(limit !== undefined ? { limit } : {}),
        ...(offset > 0 ? { offset } : {}),
      },
      stages: { selected: eligible.length, matched: totalCount },
    };
  }

  /**
   * Execute a content-discovery query (:note). Naive in-memory filtering
   * per the tracer-bullet scope (#797): load all notes, then apply tag/text/
   * time filters.
   */
  async runFind(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    if (parsed.error) {
      return { parsed, notes: [], blocks: [], stages: { selected: 0, matched: 0 } };
    }
    // Hand-built ASTs get the same loud target-capability disclosure as
    // parsed text — re-derived from the parsed shape, never from raw text.
    const computed = findTargetAdvisories(parsed);
    if (computed.length) {
      const merged = [...new Set([...(parsed.advisories ?? []), ...computed])];
      if (merged.length !== (parsed.advisories?.length ?? 0)) parsed = { ...parsed, advisories: merged };
    }

    if (parsed.target === 'block') {
      return this.runFindBlock(parsed, options);
    }
    if (parsed.target === 'effort') {
      return this.runFindEffort(parsed);
    }
    if (parsed.target === 'session') {
      return this.runFindSession(parsed, options);
    }
    if (parsed.target === 'segment' || parsed.target === 'event') {
      return this.runFindTable(parsed, options);
    }
    if (parsed.target === 'notebook') {
      return this.runFindNotebook(parsed, options);
    }
    if (parsed.target === 'page') {
      return this.runFindPage(parsed, options);
    }
    if (parsed.target === 'tag') {
      return this.runFindTag(parsed, options);
    }
    if (parsed.target === 'equipment') {
      return this.runFindEquipment(parsed, options);
    }
    // Domain candidate read: selection (source clauses + the explicit source
    // fence) narrows before the wire's selectedCount; compiled positive
    // literal type/id clauses ride as post-count FILTERS — never selection —
    // so the wire count baselines the historical pre-filter stages.selected.
    const read = compileContentRead(parsed.filters, 'note', parsed.sourceScope);
    const paging = domainPaging(parsed, options, read.residual);
    const fetchedNotes = (read.filters.length > 0 || read.selection.length > 0 || paging.paged) && this.noteStore.queryDomain
      ? await this.noteStore.queryDomain({
          plan: 'notes',
          selection: read.selection,
          ...(read.filters.length ? { filters: read.filters } : {}),
          ...(paging.order ? { order: paging.order } : {}),
          ...(paging.offset !== undefined ? { offset: paging.offset } : {}),
          ...(paging.limit !== undefined ? { limit: paging.limit } : {}),
        })
      : undefined;
    const domainNotes = fetchedNotes && fetchedNotes.plan === 'notes' ? fetchedNotes : undefined;
    let notes = domainNotes ? domainNotes.rows : await this.noteStore.getAllNotes();
    const selectedFromDomain = domainNotes ? domainNotes.selectedCount : undefined;
    const notesPaged = !!domainNotes && paging.paged;
    notes = applyNoteSelectionStages(notes, parsed);
    const selectedCount = selectedFromDomain ?? notes.length;
    const ctx = runContext(options);
    // Tag filters — intersect note IDs across OR'd values within a key.
    // Handles general 'tags' plus dynamic typed tags (domain, format, equipment, quality, intent)
    // and exercise containment ('effort').
    for (const filter of parsed.filters) {
      if (isTagLabelKey(filter.key) && !filter.negate) {
        const matchingIds = new Set<string>();
        for (const v of filter.values) {
          const ids = await this.noteStore.getNoteIdsForTag(v.value);
          ids.forEach(id => matchingIds.add(id));
        }
        notes = notes.filter(n => matchingIds.has(n.id));
      } else if (isTagLabelKey(filter.key) && filter.negate) {
        for (const v of filter.values) {
          const ids = await this.noteStore.getNoteIdsForTag(v.value);
          notes = notes.filter(n => !ids.has(n.id));
        }
      } else if (filter.key === 'effort' && !filter.negate) {
        const matchingIds = new Set<string>();
        for (const v of filter.values) {
          const ids = await this.getNoteIdsForEffort(v.value);
          ids.forEach(id => matchingIds.add(id));
        }
        notes = notes.filter(n => matchingIds.has(n.id));
      } else if (WQL_TYPED_TAG_KEYS.includes(filter.key as WqlTypedTagKey) && !filter.negate) {
        const matchingIds = new Set<string>();
        for (const v of filter.values) {
          const ids = await this.getNoteIdsForTypedTag(filter.key, v.value);
          ids.forEach(id => matchingIds.add(id));
        }
        notes = notes.filter(n => matchingIds.has(n.id));
      }
    }

    for (const filter of parsed.filters) {
      if (filter.key === 'text') {
        const search = filter.values.map(v => v.value).join(' ').toLowerCase();
        notes = notes.filter(n => {
          const hit = n.title.toLowerCase().includes(search) || n.rawContent.toLowerCase().includes(search);
          return filter.negate ? !hit : hit;
        });
      }
    }

    // Type filter — note kind (wod, note, etc.)
    for (const filter of parsed.filters) {
      if (filter.key === 'type' && !filter.negate) {
        const wanted = new Set(filter.values.map(v => v.value));
        notes = notes.filter(n => n.type && wanted.has(n.type));
      }
    }

    // Page filter
    for (const filter of parsed.filters) {
      if (filter.key === 'page') {
        const isTrue = filter.values.some(v => v.value === 'true' || v.value === '1');
        const wantsPage = filter.negate ? !isTrue : isTrue;
        notes = notes.filter(n => (wantsPage ? n.type === 'page' : n.type !== 'page'));
      }
    }

    notes = applyNotebookFilter(notes, parsed.filters);
    const isSubscribedFn = options.isNotebookSubscribed ?? this.isNotebookSubscribed ?? (() => true);

    // feed: filter
    for (const filter of parsed.filters) {
      if (filter.key === 'feed') {
        const wanted = new Set(filter.values.map(v => v.value));
        const hasWildcard = filter.values.some(v => v.wildcard);
        notes = notes.filter(n => {
          const fid = feedIdOfItem(n);
          const hit = hasWildcard ? fid !== 'local' : wanted.has(fid);
          return filter.negate ? !hit : hit;
        });
      }
    }

    // subscribed: filter
    const subscribedFilter = parsed.filters.find(f => f.key === 'subscribed');
    if (subscribedFilter) {
      const wantedValues = new Set(subscribedFilter.values.map(v => v.value));
      const wantsTrue = wantedValues.has('true');
      const wantsFalse = wantedValues.has('false');
      notes = notes.filter(n => {
        const isSub = isItemSubscribed(n, isSubscribedFn);
        let match = false;
        if (wantsTrue && wantsFalse) {
          match = true;
        } else if (wantsTrue) {
          match = isSub;
        } else if (wantsFalse) {
          match = !isSub;
        }
        return subscribedFilter.negate ? !match : match;
      });
    } else if (parsed.target === 'notebook' || parsed.raw.startsWith(':notebook')) {
      // Default visibility predicate on :notebook{}: origin === 'user' || origin === 'default' || subscribed === true
      notes = notes.filter(n => isItemSubscribed(n, isSubscribedFn));
    }


    // Note filter — exact note id
    for (const filter of parsed.filters) {
      if (filter.key === 'note') {
        const wanted = new Set(filter.values.map(v => v.value));
        notes = notes.filter(n => (filter.negate ? !wanted.has(n.id) : wanted.has(n.id)));
      }
    }
    // Time window (ticket 12 precedence): an explicit query window wins; the
    // host `range` option supplies the default when the query has none.
    if (parsed.window || options.range) {
      notes = notes.filter(n => effectiveTimeWindow(n.date ?? n.createdAt, parsed.window, options.range, ctx));
    }

    // Cross-store join (direction 1): keep notes owning a wod block whose
    // raw-log metric aggregate satisfies the predicate.
    if (parsed.join) {
      const joined = await this.applyMetricJoin(parsed, notes, []);
      notes = joined.notes;
    }

    if (parsed.pipes?.order) {
      for (const order of [...parsed.pipes.order].reverse()) {
        const dir = order.dir === 'desc' ? -1 : 1;
        notes = [...notes].sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[order.col] ?? '';
          const bv = (b as unknown as Record<string, unknown>)[order.col] ?? '';
          if (av === bv) return 0;
          return ((av as string | number) > (bv as string | number) ? 1 : -1) * dir;
        });
      }
    }
    const pipes = parsed.pipes;
    // Server-paged reads already applied offset/limit in natural id order —
    // re-slicing a pre-sliced page would skip rows (slice(offset) again).
    if (!notesPaged && pipes && (pipes.limit !== undefined || (pipes.offset ?? 0) > 0)) {
      const offset = pipes.offset ?? 0;
      notes = pipes.limit !== undefined ? notes.slice(offset, offset + pipes.limit) : notes.slice(offset);
    }

    const relations = notes.length && (this.pageStore || this.relationStore)
      ? await this.containersAndPlacements(notes)
      : undefined;
    return {
      parsed,
      notes,
      blocks: [],
      ...(relations ? { containers: relations.containers, placements: relations.placements } : {}),
      stages: { selected: selectedCount, matched: notes.length },
    };
  }

  /** The container projection and the full placement set per note id.
   *
   *  The container is the parent Page from the canonical page_notes junction
   *  (the primary placement wins); a note with no page link stays a
   *  standalone Note container. Batched when a relationStore is injected —
   *  one bundle read per run instead of a link/page read per matched note.
   *
   *  The same read resolves EVERY page the note is placed on: the junction
   *  is many-to-many, so the container is a projection of that set, not the
   *  set itself. */
  private async containersAndPlacements(notes: Note[]): Promise<{
    containers: Record<string, NoteContainer>;
    placements: Record<string, NotePlacement[]>;
  }> {
    const containers: Record<string, NoteContainer> = {};
    const placements: Record<string, NotePlacement[]> = {};
    const bundles = this.relationStore
      ? await this.relationStore.getBatches([...new Set(notes.map((n) => n.id))])
      : undefined;
    const pageCache = new Map<string, Page | undefined>();
    for (const note of notes) {
      let bundle: NoteRelationBundle | undefined;
      let resolved: NotePlacement[];
      if (bundles) {
        bundle = bundles.get(note.id);
        resolved = resolvePlacements(bundle?.links ?? [], bundle?.pages ?? []);
        // Inline the bundle's junction tags on notes without authored tags —
        // downstream Entry mapping hydrates from this same read (no-tag
        // stays a valid final state; inline tags are never overwritten).
        if (bundle && bundle.tags.length > 0 && (!note.tags || note.tags.length === 0)) {
          note.tags = bundle.tags.map((t) => t.label);
        }
      } else {
        const links = await this.pageStore!.getNotePages(note.id);
        const pages: Page[] = [];
        for (const link of links) {
          if (!pageCache.has(link.pageId)) {
            pageCache.set(link.pageId, await this.pageStore!.getPage(link.pageId));
          }
          const page = pageCache.get(link.pageId);
          if (page) pages.push(page);
        }
        resolved = resolvePlacements(links, pages);
      }
      placements[note.id] = resolved;
      // The primary placement is the container; a note with no placement
      // (or only dangling ones) stays fail-closed as a standalone Note.
      // The container names ONE page — the primary one — so its slug and
      // date are that page's own.
      const primary = resolved[0];
      containers[note.id] = primary
        ? { kind: 'page', id: primary.pageId, ...(primary.slug ? { slug: primary.slug } : {}), ...(primary.date ? { date: primary.date } : {}) }
        : { kind: 'note', id: note.id };
    }
    return { containers, placements };
  }

  private async hydrateBlocks(rows: BlockIndexRow[]): Promise<BlockIndexRow[]> {
    const ids = [...new Set(rows.map(row => row.noteId))];
    if (ids.length === 0) return [];
    const notes = this.noteStore.getNotesByIds
      ? await this.noteStore.getNotesByIds(ids)
      : await this.noteStore.getAllNotes();
    const parents = new Map<string, Note>();
    for (const note of notes) {
      if (!Number.isSafeInteger(note.sourceRevision) || note.sourceRevision < 1) continue;
      try {
        validateNoteBlocks(note.rawContent, note.blocks, note.sourceRevision);
        parents.set(note.id, note);
      } catch {
        // Corrupt source maps cannot supply actionable query results.
      }
    }
    return rows.flatMap(row => {
      const note = parents.get(row.noteId);
      const block = note?.blocks[row.blockId];
      if (!note || !block || row.id !== `${note.id}:${block.id}` || block.id !== row.blockId || block.kind !== row.dataType
        || block.version !== row.blockVersion || block.sourceRevision !== row.sourceRevision
        || note.sourceRevision !== row.sourceRevision || block.from !== row.from || block.to !== row.to) return [];
      return [{ ...row, rawContent: note.rawContent.slice(block.from, block.to) }];
    });
  }
  /**
   * Execute a :block query against the derived block_index store.
   */
  async runFindBlock(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    // One store: the seed importer materializes corpus rows next to user rows.
    // Domain candidate read — selection (source clauses + fence) narrows
    // before the wire's selectedCount; compiled positive literal type/noteId
    // clauses ride as post-count FILTERS so the count baselines the
    // historical pre-filter stages.selected. All remaining stages re-run in
    // JS and own the result.
    const read = compileContentRead(parsed.filters, 'block');
    const paging = domainPaging(parsed, options, read.residual);
    const fetchedBlocks = (read.filters.length > 0 || read.selection.length > 1 || paging.paged) && this.blockStore.queryDomain
      ? await this.blockStore.queryDomain({
          plan: 'blocks',
          selection: read.selection,
          ...(read.filters.length ? { filters: read.filters } : {}),
          ...(paging.order ? { order: paging.order } : {}),
          ...(paging.offset !== undefined ? { offset: paging.offset } : {}),
          ...(paging.limit !== undefined ? { limit: paging.limit } : {}),
        })
      : undefined;
    const domainBlocks = fetchedBlocks && fetchedBlocks.plan === 'blocks' ? fetchedBlocks : undefined;
    const candidates = domainBlocks ? domainBlocks.rows : await this.blockStore.getAllBlocks();
    let blocks = await this.hydrateBlocks(candidates);
    const invalidCandidates = blocks.length !== candidates.length;
    const selectedFromDomain = domainBlocks && !invalidCandidates ? domainBlocks.selectedCount : undefined;
    const blocksPaged = !!domainBlocks && paging.paged && !invalidCandidates;
    if (domainBlocks && invalidCandidates) blocks = await this.hydrateBlocks(await this.blockStore.getAllBlocks());
    blocks = applySourceFilter(blocks, parsed.filters);
    // WQL boundary (same as notes): the four allowed kinds plus sourceless
    // legacy rows — feeds excised at the vocabulary never enter results.
    blocks = blocks.filter((b) => !b.sourceId || WQL_SOURCE_VALUES.some((k) => sourceMatches(b, k)));
    const selectedCount = selectedFromDomain ?? blocks.length;
    const ctx = runContext(options);
    // Text filter — substring on rawContent
    for (const filter of parsed.filters) {
      if (filter.key === 'text') {
        const search = filter.values.map(v => v.value).join(' ').toLowerCase();
        blocks = blocks.filter(b => filter.negate !== b.rawContent.toLowerCase().includes(search));
      }
    }

    // Type filter selects actionable kinds only.
    for (const filter of parsed.filters) {
      if (filter.key === 'type' && !filter.negate) {
        const wanted = new Set(filter.values.map(v => v.value));
        blocks = blocks.filter(b => wanted.has(b.dataType));
      }
    }

    blocks = applyNotebookFilter(blocks, parsed.filters);
    const isSubscribedFn = options.isNotebookSubscribed ?? this.isNotebookSubscribed ?? (() => true);

    // feed: filter
    for (const filter of parsed.filters) {
      if (filter.key === 'feed') {
        const wanted = new Set(filter.values.map(v => v.value));
        const hasWildcard = filter.values.some(v => v.wildcard);
        blocks = blocks.filter(b => {
          const fid = feedIdOfItem(b);
          const hit = hasWildcard ? fid !== 'local' : wanted.has(fid);
          return filter.negate ? !hit : hit;
        });
      }
    }

    // subscribed: filter
    const subscribedFilter = parsed.filters.find(f => f.key === 'subscribed');
    if (subscribedFilter) {
      const wantedValues = new Set(subscribedFilter.values.map(v => v.value));
      const wantsTrue = wantedValues.has('true');
      const wantsFalse = wantedValues.has('false');
      blocks = blocks.filter(b => {
        const isSub = isItemSubscribed(b, isSubscribedFn);
        let match = false;
        if (wantsTrue && wantsFalse) {
          match = true;
        } else if (wantsTrue) {
          match = isSub;
        } else if (wantsFalse) {
          match = !isSub;
        }
        return subscribedFilter.negate ? !match : match;
      });
    }


    // Tags filter — matches if the parent note has the tag
    for (const filter of parsed.filters) {
      if (isTagLabelKey(filter.key) && !filter.negate) {
        const matchingNoteIds = new Set<string>();
        for (const v of filter.values) {
          const ids = await this.noteStore.getNoteIdsForTag(v.value);
          ids.forEach(id => matchingNoteIds.add(id));
        }
        blocks = blocks.filter(b => matchingNoteIds.has(b.noteId));
      } else if (filter.key === 'effort' && !filter.negate) {
        const matchingBlockIds = new Set<string>();
        for (const v of filter.values) {
          const rows = await this.blockEffortsStore.getAllFromIndex('by-effort', v.value);
          for (const row of rows) matchingBlockIds.add(`${row.noteId}:${row.blockId}`);
        }
        blocks = blocks.filter(block => matchingBlockIds.has(`${block.noteId}:${block.blockId}`));
      }
    }

    // Note filter — exact parent note id
    for (const filter of parsed.filters) {
      if (filter.key === 'note') {
        const wanted = new Set(filter.values.map(v => v.value));
        blocks = blocks.filter(b => (filter.negate ? !wanted.has(b.noteId) : wanted.has(b.noteId)));
      }
    }

    // Time window: parent note's date, falling back to note createdAt, falling back to block createdAt
    if (parsed.window || options.range) {
      const allNotes = await this.noteStore.getAllNotes();
      const noteTimeMap = new Map<string, number>(allNotes.map((n) => [n.id, n.date ?? n.createdAt]));
      blocks = blocks.filter(b => effectiveTimeWindow(noteTimeMap.get(b.noteId) ?? b.createdAt, parsed.window, options.range, ctx));
    }

    // Cross-store join (direction 1): keep blocks whose raw-log metric
    // aggregate satisfies the predicate.
    if (parsed.join) {
      const joined = await this.applyMetricJoin(parsed, [], blocks);
      blocks = joined.blocks;
    }

    if (parsed.pipes?.order) {
      for (const order of [...parsed.pipes.order].reverse()) {
        const dir = order.dir === 'desc' ? -1 : 1;
        blocks = [...blocks].sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[order.col] ?? '';
          const bv = (b as unknown as Record<string, unknown>)[order.col] ?? '';
          if (av === bv) return 0;
          return ((av as string | number) > (bv as string | number) ? 1 : -1) * dir;
        });
      }
    }
    const pipes = parsed.pipes;
    // Server-paged reads already applied offset/limit in natural id order —
    // re-slicing a pre-sliced page would skip rows.
    if (!blocksPaged && pipes && (pipes.limit !== undefined || (pipes.offset ?? 0) > 0)) {
      const offset = pipes.offset ?? 0;
      blocks = pipes.limit !== undefined ? blocks.slice(offset, offset + pipes.limit) : blocks.slice(offset);
    }

    return { parsed, notes: [], blocks, stages: { selected: selectedCount, matched: blocks.length } };
  }

  /**
   * Execute a :effort query: the registry is the filter plane (discipline,
   * intensity, origin, text), the note plane is the result plane — matched
   * projections resolve to their owning definition notes.
   */
  async runFindEffort(parsed: ParsedFindQuery): Promise<FindQueryResult> {
    const all = await this.effortStore.getAllEfforts();
    const selectedCount = all.length;

    const matches = (effort: IEffort, key: string, value: string, wildcard: boolean): boolean => {
      const needle = value.toLowerCase();
      switch (key) {
        case 'effort':
          if (wildcard) {
            return effort.slug.includes(needle)
              || effort.label.toLowerCase().includes(needle)
              || effort.aliases.some(a => a.toLowerCase().includes(needle));
          }
          return effort.slug === value
            || effort.label.toLowerCase() === needle
            || effort.aliases.some(a => a.toLowerCase() === needle);
        case 'discipline': return effort.baseAttributes.discipline === value;
        case 'intensity': return effort.baseAttributes.intensityTier === value;
        case 'origin': return effort.registrySource === value;
        case 'text':
          return effort.label.toLowerCase().includes(needle)
            || effort.slug.includes(needle)
            || effort.aliases.some(a => a.toLowerCase().includes(needle));
        default: return true;
      }
    };

    let efforts = all;
    for (const filter of parsed.filters) {
      if (!['effort', 'discipline', 'intensity', 'origin', 'text'].includes(filter.key)) continue;
      efforts = efforts.filter(effort => {
        const hit = filter.values.some(v => matches(effort, filter.key, v.value, v.wildcard));
        return filter.negate ? !hit : hit;
      });
    }

    if (parsed.pipes?.order) {
      for (const order of [...parsed.pipes.order].reverse()) {
        const dir = order.dir === 'desc' ? -1 : 1;
        efforts = [...efforts].sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[order.col] ?? '';
          const bv = (b as unknown as Record<string, unknown>)[order.col] ?? '';
          if (av === bv) return 0;
          return ((av as string | number) > (bv as string | number) ? 1 : -1) * dir;
        });
      }
    }
    const pipes = parsed.pipes;
    if (pipes && (pipes.limit !== undefined || (pipes.offset ?? 0) > 0)) {
      const offset = pipes.offset ?? 0;
      efforts = pipes.limit !== undefined ? efforts.slice(offset, offset + pipes.limit) : efforts.slice(offset);
    }

    // Definitions are notes: resolve each matched projection to its owning
    // definition note (projection.ownerNoteId). The registry is the filter
    // plane (it carries baseAttributes/origin); the note store is the result
    // plane. Projections without an owner note stay in the `efforts` result
    // but resolve to no note — ownerless legacy rows. Consumers that list
    // definitions (library search) fall back to the registry row for those.
    const ownerIds = [...new Set(efforts.map(e => e.ownerNoteId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
    let notes: Note[] = [];
    if (ownerIds.length > 0) {
      const fetched = this.noteStore.getNotesByIds
        ? await this.noteStore.getNotesByIds(ownerIds)
        : (await this.noteStore.getAllNotes()).filter(n => ownerIds.includes(n.id));
      const byId = new Map(fetched.map(n => [n.id, n]));
      notes = ownerIds.flatMap(id => {
        const note = byId.get(id);
        return note ? [note] : [];
      });
    }

    return { parsed, notes, blocks: [], efforts, stages: { selected: selectedCount, matched: efforts.length } };
  }

  async run(parsed: AnyParsedQuery, options: QueryOptions = {}): Promise<QueryResult> {
    // Explicit family handling — no unchecked cast past the guards.
    if (isPipelineQuery(parsed)) {
      throw new Error('Pipeline queries do not aggregate directly — execute them with runPipeline().');
    }
    if (isFindQuery(parsed)) {
      // Content queries never aggregate; retired rows: text surfaces here as
      // a parse-errored find AST and returns the telemetry-zero result.
      return {
        parsed: { family: 'aggregate', raw: parsed.raw, agg: 'count', metric: parsed.target, filters: [], groupBy: [] },
        series: [], stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 }, matched: [],
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    }
    const empty: QueryResult = {
      parsed,
      series: [],
      stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
      matched: [],
    };
    if (parsed.error) return empty;

    // Cross-store join: reads stored summary rows over the content index —
    // the store is authoritative (finalize-owns, ticket 005).
    if (parsed.join) return this.runJoined(parsed, options);

    // Stage 1: SELECT — window-first hybrid (ticket 003): a time window
    // fetches through by-timestamp, the one proven culling index; all-time
    // queries scan. by-metric is never used — ticket 001 measured it
    // non-selective and slower than scanning.
    // C1 + ticket 12 precedence: the query's own window WINS over the host
    // range options — the host range is the default when the query has none.
    // Resolution uses the one captured execution context (half-open bounds).
    const ctx = runContext(options);
    const range = resolveAggregateRange(parsed, options, ctx);
    // The store fetch bound is an upper cutoff, not the membership test —
    // pass the resolved end through unchanged (MAX_SAFE_INTEGER for the
    // unbounded side).
    const fetchRange = range ? { start: range.start, end: range.end } : undefined;
    // Complete fetch (ticket 12/14): a bounded window fetches through
    // by-timestamp and unions by-metric-date candidates over EVERY covered
    // civil date — no cap, DST-safe enumeration. An unbounded side (the 0 /
    // MAX_SAFE_INTEGER sentinels, or a negative open bound) has no finite
    // date horizon to enumerate — the all-store scan IS the complete fetch;
    // membership filtering below stays exact either way.
    const boundedRange =
      fetchRange && fetchRange.start > 0 && fetchRange.end < Number.MAX_SAFE_INTEGER ? fetchRange : undefined;
    let eventRows = boundedRange
      ? await this.store.getEventsByTimeRange(boundedRange.start, boundedRange.end)
      : await this.store.scanAll();
    if (boundedRange && this.store.getEventsByMetricDates) {
      const civilDates = civilDatesCoveredByRange(boundedRange.start, boundedRange.end, ctx.timeZone);
      if (civilDates.length > 0) {
        const byDate = await this.store.getEventsByMetricDates(civilDates);
        if (byDate.length > 0) {
          const seen = new Set(eventRows.map((r) => r.id));
          eventRows = [...eventRows, ...byDate.filter((r) => !seen.has(r.id))];
        }
      }
    }
    return this.aggregateEventRows(parsed, eventRows, options, range);
  }

  /**
   * In-memory aggregation over ALREADY-FETCHED event rows — the pipeline
   * dataset/transform path. Identical metric projection, selection,
   * bucketing, unit, and aggregation stages as `run`; no store reads (a
   * content join on carried data is REJECTED by runAggregateEvents — it
   * would abandon the carried population).
   */
  async runAggregateEvents(query: ParsedAggregateQuery, events: readonly EventRecord[], options: QueryOptions = {}): Promise<QueryResult> {
    const empty: QueryResult = {
      parsed: query,
      series: [],
      stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
      matched: [],
    };
    if (query.error) return empty;
    // A content join resolves its scope from the STORE — that would abandon
    // the carried population. Author the join on the pipeline's source stage
    // instead.
    if (query.join) {
      return {
        ...empty,
        error: 'where <content> joins re-read the store and cannot run on carried pipeline data — author the join in the source stage.',
      };
    }
    const ctx = runContext(options);
    const range = resolveAggregateRange(query, options, ctx);
    return this.aggregateEventRows(query, events, options, range);
  }

  /** Public pipeline executor — parse the text, then run. */
  async runPipeline(queryText: string, options: PipelineOptions = {}): Promise<PipelineResult> {
    return this.runPipelineParsed(parseQuery(queryText), options);
  }

  /** Execute an already-parsed pipeline: resolve the source once, then flow
   *  the carried value left to right through the transforms — each function
   *  reduces the PRECEDING stage, never an independent re-query. Dataset
   *  stages look up `pageSources` (then an injected datasetStore)
   *  synchronously; no database roundtrip. */
  async runPipelineParsed(parsed: AnyParsedQuery, options: PipelineOptions = {}): Promise<PipelineResult> {
    if (!isPipelineQuery(parsed)) {
      const error = parsed.error ?? `Not a pipeline: "${parsed.raw}". Pipelines look like :source{filters} | :sum{metric:x} | :table.`;
      return { parsed: { family: 'pipeline', raw: parsed.raw, source: { kind: 'dataset', name: '' }, transforms: [], error }, error };
    }
    const fail = (error: string): PipelineResult => ({ parsed, error });
    if (parsed.error) return fail(parsed.error);

    let content: FindQueryResult | undefined;
    let carried: QueryResult | undefined;
    let sourceEvents: EventRecord[] | undefined;
    let datasetNotes: Note[] = [];

    if (parsed.source.kind === 'dataset') {
      const name = parsed.source.name;
      const dataset = options.pageSources?.get(name) ?? this.datasetStore?.getDataset(name);
      if (!dataset) return fail(`Unknown dataset "${name}" — the host must register it before the query runs.`);
      sourceEvents = dataset.events;
      datasetNotes = dataset.notes;
    } else if (isFindQuery(parsed.source.query)) {
      const q = parsed.source.query;
      content = await this.runFind(q, {
        context: options.context,
        ...((options.rangeStart !== undefined || options.rangeEnd !== undefined)
          ? { range: { start: options.rangeStart ?? 0, end: options.rangeEnd ?? Number.MAX_SAFE_INTEGER, endExclusive: false } }
          : {}),
      });
      if (q.error) return fail(q.error);
    } else {
      carried = await this.run(parsed.source.query, options);
      if (parsed.source.query.error) return fail(parsed.source.query.error);
    }

    if (parsed.transforms.length === 0) {
      // Source-only pipeline (optionally with a chart sink) — the stage
      // result surfaces as-is, no event resolution.
      if (content) {
        return {
          parsed,
          ...(content.notes.length ? { notes: content.notes } : {}),
          ...(content.blocks.length ? { blocks: content.blocks } : {}),
          ...(content.efforts?.length ? { efforts: content.efforts } : {}),
          ...(content.runs?.length ? { runs: content.runs } : {}),
          ...(content.table ? { table: content.table } : {}),
          ...(content.containers ? { containers: content.containers } : {}),
          ...(content.placements ? { placements: content.placements } : {}),
          ...(parsed.sink ? { chart: parsed.sink } : {}),
        };
      }
      if (parsed.source.kind === 'dataset') {
        // Dataset alone — its notes are the surface; telemetry flows only
        // through transforms.
        return { parsed, notes: datasetNotes, ...(parsed.sink ? { chart: parsed.sink } : {}) };
      }
      return {
        parsed,
        ...(carried
          ? { series: carried.series, ...(carried.unit ? { unit: carried.unit } : {}), ...(carried.error ? { error: carried.error } : {}) }
          : {}),
        ...(parsed.sink ? { chart: parsed.sink } : {}),
      };
    }

    if (!carried) {
      if (!sourceEvents && content) sourceEvents = await this.sourceEventsFromFind(content);
      carried = await this.runAggregateEvents(parsed.transforms[0]!, sourceEvents ?? [], options);
      for (const transform of parsed.transforms.slice(1)) {
        if (carried.error) break; // an errored stage stops the pipeline
        carried = reduceCarriedResult(carried, transform, options, runContext(options));
      }
    } else {
      for (const transform of parsed.transforms) {
        if (carried.error) break; // an errored stage stops the pipeline
        carried = reduceCarriedResult(carried, transform, options, runContext(options));
      }
    }
    return {
      parsed,
      series: carried.series,
      ...(carried.unit ? { unit: carried.unit } : {}),
      ...(carried.error ? { error: carried.error } : {}),
      ...(parsed.sink ? { chart: parsed.sink } : {}),
    };
  }

  /** Events behind a content source — resolved ONLY when a transform needs
   *  them: session/table sources already carry their rows; note sources read
   *  the per-note index; block sources read the content index. */
  private async sourceEventsFromFind(content: FindQueryResult): Promise<EventRecord[]> {
    if (content.events) return content.events;
    const rows: EventRecord[] = [];
    for (const note of content.notes) rows.push(...await this.store.getEventsForNote(note.id));
    for (const block of content.blocks) {
      if (block.dataType === 'wod' && block.blockContentId) rows.push(...await this.store.getEventsByContent(block.blockContentId));
    }
    return rows;
  }

  /** QueryExecutor adapter: a pipeline run's final stage rendered as the
   *  aggregate QueryResult shape chart consumers already read. */
  private pipelineResultToQueryResult(pr: PipelineResult): QueryResult {
    const parsed: ParsedAggregateQuery = { family: 'aggregate', raw: pr.parsed.raw, agg: 'count', metric: '', filters: [], groupBy: [] };
    if (pr.series) {
      const aggregated = pr.series.reduce((n, s) => n + s.points.length, 0);
      return {
        parsed,
        series: pr.series,
        stages: { selected: 0, buckets: pr.series[0]?.points.length ?? 0, aggregated, groups: pr.series.length },
        matched: [],
        ...(pr.unit ? { unit: pr.unit } : {}),
        ...(pr.error ? { error: pr.error } : {}),
      };
    }
    return {
      parsed, series: [], stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 }, matched: [],
      ...(pr.error ? { error: pr.error } : {}),
    };
  }

  /** Stages 2–4 over raw event rows: project → metric filter → range filter
   *  → tag filters → coverage selection → BUCKET/GROUP/AGGREGATE. */
  private async aggregateEventRows(
    parsed: ParsedAggregateQuery,
    eventRows: readonly EventRecord[],
    options: QueryOptions,
    range: ResolvedRange | undefined,
  ): Promise<QueryResult> {
    const ctx = runContext(options);
    if (!parsed.metric && parsed.agg !== 'count') {
      return {
        parsed,
        series: [],
        stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 },
        matched: [],
        error: `Aggregate "${parsed.agg}" requires a metric — use ${parsed.agg}{metric:<key>}`,
      };
    }
    const matchesMetric = (metricKey: string | undefined, queryMetric: string) =>
      !queryMetric ||
      metricKey === queryMetric ||
      (queryMetric === 'rep' && metricKey === 'reps') ||
      (queryMetric === 'reps' && metricKey === 'rep');

    const factTime = (row: AnalyticsDataPoint): number => {
      if (row.metricDate) return zonedNoon(row.metricDate, ctx.timeZone);
      return row.timestamp;
    };

    const candidates = eventRows
      .flatMap(projectEventToFacts)
      .filter(row => matchesMetric(row.metricKey, parsed.metric))
      .filter(row => !range || inRange(factTime(row), range));
    const touchesTags =
      parsed.filters.some(f => f.key === 'tags') || parsed.groupBy.includes('tags');
    const noteTags = await this.loadNoteTags(candidates, touchesTags);
    // Ticket 16: no global effort suppression — coverage selection below
    // keeps every population represented exactly once.
    const matched = candidates.filter(row => matchesFilters(row, parsed.filters, noteTags));

    const { selected, report } = selectContributions(matched, parsed.agg);
    return this.buildResult(selected, parsed, options, noteTags, range, report);
  }

  /**
   * Stages 2–4 — BUCKET → GROUP → AGGREGATE over an already-selected +
   * filtered `matched` set.
   */
  private buildResult(
    matched: AnalyticsDataPoint[],
    parsed: ParsedAggregateQuery,
    options: QueryOptions,
    noteTags: ReadonlyMap<string, readonly string[]>,
    range: ResolvedRange | undefined,
    coverage?: CoverageReport,
  ): QueryResult {
    const ctx = runContext(options);
    // Stage 2: BUCKET — structural bucket identity (ticket 12): calendar
    // day buckets anchor on the observation's civil date in the context
    // timezone, week buckets on the Monday date; fixed-duration `.rollup`
    // keeps its epoch-aligned width (a deliberately distinct kind, not a
    // calendar week). Display timestamps (local noon / epoch midpoint) are
    // presentation-only — never join keys.
    const timeDim = parsed.groupBy.find((d) => d === 'day' || d === 'week');
    const tagDims = parsed.groupBy.filter((d) => d !== 'day' && d !== 'week');
    const rollup = parsed.rollup;

    /** The observation's own temporal anchor: its recorded metric date when
     *  it carries one (date-only facts keep their civil date), else the
     *  fact timestamp's civil date in the context timezone. */
    const anchorDate = (row: AnalyticsDataPoint): string =>
      row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone);
    const bucketKey = (row: AnalyticsDataPoint): string => {
      if (timeDim === 'day') return `d:${anchorDate(row)}`;
      if (timeDim === 'week') return `w:${civilMonday(anchorDate(row))}`;
      if (rollup) {
        const ad = anchorDate(row);
        if (rollup.unit === 'w') {
          const m = civilMonday(ad);
          const weeksSince = Math.floor(civilDateDiff('1970-01-05', m) / 7);
          const bucketIndex = Math.floor(weeksSince / rollup.size);
          const bucketStart = civilDateAdd('1970-01-05', bucketIndex * rollup.size * 7);
          return `w:${bucketStart}`;
        }
        if (rollup.unit === 'd') {
          const daysSince = civilDateDiff('1970-01-01', ad);
          const bucketIndex = Math.floor(daysSince / rollup.size);
          const bucketStart = civilDateAdd('1970-01-01', bucketIndex * rollup.size);
          return `d:${bucketStart}`;
        }
      }
      return '';
    };
    /** Presentation-only representative instant for a structural key. */
    const bucketDisplayTs = (key: string): number => {
      if (key.startsWith('d:') || key.startsWith('w:')) return zonedNoon(key.slice(2), ctx.timeZone);
      return Number.MAX_SAFE_INTEGER;
    };

    // Chronological bucket domain (ticket 12): bounded calendar queries
    // generate every period in the requested bounds — including empty ones;
    // unbounded sides use the observed extent; relative windows never
    // generate future buckets because their exclusive end is the captured
    // instant. No domain generation for rollup (duration buckets are
    // observed-only) or ungrouped queries.
    const MAX_DOMAIN = 10_000;
    const bareDate = (key: string): string => (key.startsWith('d:') || key.startsWith('w:') ? key.slice(2) : key);
    const calendarDomain = (observed: string[]): string[] => {
      const activeDim = timeDim ?? (rollup?.unit === 'w' ? 'week' : rollup?.unit === 'd' ? 'day' : undefined);
      if (!activeDim || observed.length === 0) return observed;
      const bounds = range && range.end !== Number.MAX_SAFE_INTEGER
        ? {
            startIso: civilDateOf(range.start, ctx.timeZone),
            endIso: range.endExclusive ? civilDateOf(range.end - 1, ctx.timeZone) : civilDateOf(range.end, ctx.timeZone),
          }
        : { startIso: bareDate(observed[0]!), endIso: bareDate(observed[observed.length - 1]!) };
      const first = activeDim === 'week' ? civilMonday(bounds.startIso) : bounds.startIso;
      const last = activeDim === 'week' ? civilMonday(bounds.endIso) : bounds.endIso;
      const step = activeDim === 'week' ? 7 * (rollup?.size ?? 1) : (rollup?.size ?? 1);
      const span = civilDateDiff(first, last);
      if (span < 0 || span / step > MAX_DOMAIN) return observed;
      const domain: string[] = [];
      for (let cursor = first; ; cursor = civilDateAdd(cursor, step)) {
        domain.push(activeDim === 'week' ? `w:${cursor}` : `d:${cursor}`);
        if (cursor >= last) break;
      }
      return domain;
    };

    // Output unit (ticket 13): explicit `in <unit>` directive wins when
    // dimensionally compatible; otherwise the system default for the
    // observations' dimension; unitless observations stay unitless. No
    // first-record fallback, no widget-preference tier.
    const unitResolution = resolveOutputUnit(matched, {
      directive: parsed.displayUnit,
      preferred: options.preferredUnit,
    });
    const targetUnit = unitResolution.unit;
    const shouldConvert = unitResolution.convert === true;
    const seriesError = unitResolution.error;

    // Stage 3+4: GROUP + AGGREGATE per bucket. Group identity (ticket 16)
    // is the canonical ordered tuple of resolved dimension values, JSON
    // encoded — delimiter-containing labels cannot collide; a missing
    // dimension resolves to the structural UNASSIGNED sentinel (distinct
    // from any literal text). The display label is derived, never identity.
    const UNASSIGNED = '\u0000unassigned';
    const unassignedLabel = 'unassigned';
    const groups = new Map<string, { label: string; rows: AnalyticsDataPoint[] }>();
    for (const row of matched) {
      const tuple = tagDims.map((d) => dimValue(row, d, noteTags, ctx));
      const key = tagDims.length ? JSON.stringify(tuple) : parsed.metric;
      const label = tagDims.length
        ? tuple.map((v) => (v === UNASSIGNED ? unassignedLabel : v)).join(' · ')
        : parsed.metric;
      const bucket = groups.get(key);
      if (bucket) bucket.rows.push(row);
      else groups.set(key, { label, rows: [row] });
    }

    const series: Series[] = [...groups.entries()].map(([key, group]) => {
      const rows = group.rows;
      if (seriesError) {
        return { key, label: group.label, points: [], unit: undefined, error: seriesError };
      }
      const byBucket = new Map<string, AnalyticsDataPoint[]>();
      for (const row of rows) {
        const b = bucketKey(row);
        const members = byBucket.get(b);
        if (members) members.push(row);
        else byBucket.set(b, [row]);
      }
      const observedKeys = [...byBucket.keys()].sort();
      const domain = timeDim ? calendarDomain(observedKeys) : observedKeys;
      let error: string | undefined;
      const points: SeriesPoint[] = domain.map((b) => {
        const members = byBucket.get(b);
        if (!members) {
          // Missing query position (ticket 12 domain + ticket 13 matrix):
          // zero-filled with absence provenance — never an observation.
          return { ts: bucketDisplayTs(b), value: 0, missing: true };
        }
        // Compatible-unit normalization BEFORE arithmetic (finding 3.3).
        let values: number[];
        try {
          values = members.map((m) =>
            shouldConvert && targetUnit && (m.unit ?? m.metricUnit) !== undefined
              ? convertViaCatalog(m.value as number, (m.unit ?? m.metricUnit) as string, targetUnit)
              : m.value as number,
          );
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          return { ts: bucketDisplayTs(b), value: 0, missing: true };
        }
        const reduced = aggregate(values, parsed.agg, members);
        if (reduced.state === 'error') {
          error = reduced.message;
          return { ts: bucketDisplayTs(b), value: 0, missing: true };
        }
        return {
          ts: timeDim || rollup
            ? bucketDisplayTs(b)
            : Math.min(...members.map((m) => m.timestamp)),
          // Unrounded — renderers format (ticket 13 precision policy).
          value: reduced.value,
          ...(reduced.state === 'absent' ? { missing: true } : {}),
        };
      });
      // `count` reduces to the count dimension regardless of input.
      // Output unit is the resolved one — count reduces to count; no
      // first-record fallback (ticket 13 cutover).
      const seriesUnit = parsed.agg === 'count' ? 'count' : targetUnit;
      return { key, label: group.label, points, unit: seriesUnit, ...(error ? { error } : {}) };
    });

    const aggregated = series.reduce((n, s) => n + s.points.length, 0);
    const scalar = series.length === 1 && series[0].points.length === 1 ? series[0].points[0].value : undefined;
    const resultUnit = series.length > 0 ? series[0].unit : undefined;
    const bucketCount = timeDim || rollup
      ? (series[0]?.points.length ?? 0)
      : (matched.length ? 1 : 0);

    const insufficient = coverage?.insufficientScopes ?? [];
    const resultError = series.find((s) => s.error)?.error
      ?? (insufficient.length > 0
        ? `Insufficient evidence: ${insufficient.map((s) => `${s.resultId}/${s.metricKey} (${s.reason})`).join('; ')}`
        : undefined);
    return {
      parsed,
      series,
      stages: { selected: matched.length, buckets: bucketCount, aggregated, groups: series.length },
      matched,
      scalar,
      unit: resultUnit,
      ...(resultError ? { error: resultError } : {}),
      ...(coverage ? { coverage } : {}),
    };
  }

  /** Direction 2 — re-derive the metric from raw logs, restricted to the
   *  blockContentIds owned by the find predicate's content matches. */
  private async runJoined(parsed: ParsedAggregateQuery, options: QueryOptions): Promise<QueryResult> {
    const empty: QueryResult = {
      parsed, series: [], stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 }, matched: [],
    };
    const join = parsed.join as FindPredicate;
    const findResult = await this.runFind({
      family: 'find',
      raw: '', target: join.target, filters: join.filters,
      window: join.last ? { kind: 'relative', size: join.last.size, unit: join.last.unit } : undefined,
    });
    const contentIds = await this.contentIdsFromFindResult(findResult);
    if (contentIds.size === 0) return empty;

    // Ticket 16: content-joined queries keep eligible event-grain
    // observations (the summary-only join filter is gone); overlapping
    // scope fetches dedupe by stable observation identity.
    let facts = dedupeById(await this.deriveMetricFacts(contentIds, parsed.metric));
    // Ticket 12 precedence + context: query window wins; host range is the
    // default; membership half-open against the captured context.
    const ctx = runContext(options);
    const joinRange = resolveAggregateRange(parsed, options, ctx);
    if (joinRange) {
      facts = facts.filter(f => inRange(f.timestamp, joinRange));
    }

    const touchesTags =
      parsed.filters.some(f => f.key === 'tags') || parsed.groupBy.includes('tags');
    const noteTags = await this.loadNoteTags(facts, touchesTags);
    const matched = facts.filter(f => matchesFilters(f, parsed.filters, noteTags));
    const { selected, report } = selectContributions(matched, parsed.agg);
    return this.buildResult(selected, parsed, options, noteTags, joinRange, report);
  }

  /** Direction 1 — keep only content owning a wod block whose raw-log metric
   *  aggregate satisfies the predicate. `notes` for :note, `blocks` for
   *  :block. */
  private async applyMetricJoin(
    parsed: ParsedFindQuery,
    notes: Note[],
    blocks: BlockIndexRow[],
  ): Promise<{ notes: Note[]; blocks: BlockIndexRow[] }> {
    const join = parsed.join as MetricPredicate;
    // Resolve the wod blockContentIds owned by each candidate note.
    const noteToContent = await this.noteContentMap(new Set(notes.map(n => n.id)));
    // Candidate content ids: wod blocks owned by matched notes or blocks.
    const candidateIds = new Set<string>();
    for (const set of noteToContent.values()) for (const id of set) candidateIds.add(id);
    for (const b of blocks) if (b.dataType === 'wod' && b.blockContentId) candidateIds.add(b.blockContentId);

    const passing = await this.contentIdsSatisfying(candidateIds, join);

    // :block — only wod blocks whose content id passes (prose has no metric).
    blocks = blocks.filter(b => b.dataType === 'wod' && !!b.blockContentId && passing.has(b.blockContentId!));
    // :note — keep notes owning ≥1 passing wod block.
    notes = notes.filter(n => {
      const cids = noteToContent.get(n.id);
      return !!cids && [...cids].some(id => passing.has(id));
    });
    return { notes, blocks };
  }

  /** Re-derive the metric from raw logs for each content id, aggregate per id,
   *  and return the ids whose aggregate satisfies the join predicate. */
  private async contentIdsSatisfying(
    contentIds: Set<string>,
    join: MetricPredicate,
  ): Promise<Set<string>> {
    const facts = dedupeById(await this.deriveMetricFacts(contentIds, join.metric));
    const noteTags = await this.loadNoteTags(facts, join.filters.some(f => f.key === 'tags'));
    const filtered = selectContributions(
      facts.filter(f => matchesFilters(f, join.filters, noteTags)),
      join.agg,
    ).selected;
    const byContent = new Map<string, AnalyticsDataPoint[]>();
    for (const f of filtered) {
      const cid = f.blockContentId ?? '';
      const arr = byContent.get(cid);
      if (arr) arr.push(f);
      else byContent.set(cid, [f]);
    }
    const passing = new Set<string>();
    for (const [cid, rows] of byContent) {
      const values = rows.map(r => r.value as number);
      const reduced = aggregate(values, join.agg, rows);
      if (reduced.state !== 'observed') continue; // absent/insufficient never satisfies
      if (compareOp(reduced.value, join.operator, join.threshold)) passing.add(cid);
    }
    return passing;
  }


  /** Summary facts for one Canonical Metric Key across the given content ids —
   *  the cross-store join source. Reads finalize-written summary rows straight
   *  off the content index (ticket 003: the store is authoritative; the old
   *  freshness re-derivation is moot). One fact row per result × rowKey. */
  private async deriveMetricFacts(
    contentIds: Iterable<string>,
    metricKey: string,
  ): Promise<AnalyticsDataPoint[]> {
    const ids = [...new Set(contentIds)];
    const rows = await Promise.all(ids.map((blockContentId) => this.store.getEventsByContent(blockContentId)));
    // Ticket 16 (finding 3.7): content-joined queries read every eligible
    // representation — the coverage selection shares the direct path's
    // contract, so detail rows are no longer filtered out here.
    return rows
      .flat()
      .flatMap(projectEventToFacts)
      .filter((f) => f.metricKey === metricKey);
  }

  /** All content blocks — journal and seeded corpus in one store. */
  private async allContentBlocks(): Promise<BlockIndexRow[]> {
    return this.hydrateBlocks(await this.blockStore.getAllBlocks());
  }

  /** Map each note id to the wod blockContentIds it owns. */
  private async noteContentMap(noteIds: Set<string>): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (!noteIds.size) return map;
    const allBlocks = await this.allContentBlocks();
    for (const b of allBlocks) {
      if (b.dataType !== 'wod' || !b.blockContentId || !noteIds.has(b.noteId)) continue;
      let set = map.get(b.noteId);
      if (!set) { set = new Set(); map.set(b.noteId, set); }
      set.add(b.blockContentId);
    }
    return map;
  }

  /** Collect wod blockContentIds owned by a find query's content matches. */
  private async contentIdsFromFindResult(findResult: FindQueryResult): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const b of findResult.blocks) if (b.dataType === 'wod' && b.blockContentId) ids.add(b.blockContentId);
    if (findResult.notes.length) {
      const noteIds = new Set(findResult.notes.map(n => n.id));
      const noteMap = await this.noteContentMap(noteIds);
      for (const set of noteMap.values()) for (const id of set) ids.add(id);
    }
    return ids;
  }

  /** Load note tag labels only when the query touches 'tags'. Batched when
   *  a relationStore is injected — one bundle read per run instead of a
   *  junction read per row's note. */
  private async loadNoteTags(rows: AnalyticsDataPoint[], touchesTags: boolean): Promise<Map<string, readonly string[]>> {
    const noteTags = new Map<string, readonly string[]>();
    if (!touchesTags) return noteTags;
    const noteIds = [...new Set(rows.map(r => r.noteId))];
    if (this.relationStore) {
      const bundles = await this.relationStore.getBatches(noteIds);
      for (const id of noteIds) {
        noteTags.set(id, (bundles.get(id)?.tags ?? []).map((t) => t.label));
      }
      return noteTags;
    }
    await Promise.all(noteIds.map(async (id) => noteTags.set(id, await this.noteStore.getNoteTagLabels(id))));
    return noteTags;
  }

  /** Resolve matching note IDs for an exercise slug via the block_efforts containment index. */
  private async getNoteIdsForEffort(effortSlug: string): Promise<Set<string>> {
    const rows = await this.blockEffortsStore.getAllFromIndex('by-effort', effortSlug);
    return new Set(rows.map(r => r.noteId));
  }

  /** Resolve matching note IDs for a canonical typed tag (e.g. equipment:kettlebell). */
  private async getNoteIdsForTypedTag(type: string, label: string): Promise<Set<string>> {
    const tags = await this.tagsStore.getAllFromIndex('by-label', label);
    const typedTag = tags.find(t => t.type === type);
    if (!typedTag) return new Set();
    const links = await this.noteTagsStore.getAllFromIndex('by-tag', typedTag.id);
    return new Set(links.map(l => l.noteId));
  }

  /**
   * Execute a :notebook query (ticket 08) — the notebook plane is a NOTE
   * plane (ticket 05 semantics preserved): bare `:notebook{}` returns the
   * notes of every notebook — journal, playground, defaults, user-created,
   * feed-delivered. `notebook:{slug}` narrows to members of those
   * notebooks and `!notebook:` excludes them; the result shape never
   * changes with polarity, and container criteria (tags:, effort:, typed
   * tags, text:) narrow the members exactly like the note plane — this
   * delegates to it. The notebook CONTAINER listing (the /notebooks
   * management surface) is the app's NotebookService model, not WQL rows.
   */
  async runFindNotebook(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    return this.runFind({ ...parsed, target: 'note' }, options);
  }

  /**
   * Execute a :page query (ticket 08) — the placement plane. Results are
   * the placed notes; `placements` carries every page each note sits on
   * (many-to-many) and `containers` the primary projection. `page:{slug}`
   * (or a `YYYY-MM-DD` date, or a page id) narrows the placements.
   */
  async runFindPage(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    const empty: FindQueryResult = { parsed, notes: [], blocks: [], stages: { selected: 0, matched: 0 } };
    if (!this.pageStore?.getAllPages || !this.pageStore?.getAllLinks) return empty;
    const ctx = runContext(options);
    const [pages, links] = await Promise.all([this.pageStore.getAllPages(), this.pageStore.getAllLinks()]);
    let placements = resolvePlacements(links, pages);
    const selected = new Set(placements.map((p) => p.noteId)).size;

    for (const filter of parsed.filters) {
      if (filter.key !== 'page') continue;
      const wanted = new Set(filter.values.map((v) => v.value));
      placements = placements.filter((p) => {
        const hit = wanted.has(p.pageId) || (p.slug !== undefined && wanted.has(p.slug)) || (p.date !== undefined && wanted.has(p.date));
        return filter.negate ? !hit : hit;
      });
    }

    const placedIds = [...new Set(placements.map((p) => p.noteId))];
    let notes = this.noteStore.getNotesByIds
      ? await this.noteStore.getNotesByIds(placedIds)
      : (await this.noteStore.getAllNotes()).filter((n) => placedIds.includes(n.id));
    for (const filter of parsed.filters) {
      if (filter.key === 'note') {
        const wanted = new Set(filter.values.map((v) => v.value));
        notes = notes.filter((n) => (filter.negate ? !wanted.has(n.id) : wanted.has(n.id)));
      }
    }
    for (const filter of parsed.filters) {
      if (filter.key === 'text') {
        const search = filter.values.map((v) => v.value).join(' ').toLowerCase();
        notes = notes.filter((n) => {
          const hit = n.title.toLowerCase().includes(search) || n.rawContent.toLowerCase().includes(search);
          return filter.negate ? !hit : hit;
        });
      }
    }
    notes = applyNotebookFilter(notes, parsed.filters);
    if (parsed.window || options.range) {
      notes = notes.filter((n) => effectiveTimeWindow(n.date ?? n.createdAt, parsed.window, options.range, ctx));
    }
    notes = applyOrderAndPage(notes, parsed);

    const survived = new Set(notes.map((n) => n.id));
    const byNote = new Map<string, NotePlacement[]>();
    for (const p of placements) {
      if (!survived.has(p.noteId)) continue;
      const list = byNote.get(p.noteId);
      if (list) list.push(p);
      else byNote.set(p.noteId, [p]);
    }
    const containers: Record<string, NoteContainer> = {};
    for (const note of notes) {
      const primary = byNote.get(note.id)?.[0];
      containers[note.id] = primary
        ? { kind: 'page', id: primary.pageId, ...(primary.slug ? { slug: primary.slug } : {}), ...(primary.date ? { date: primary.date } : {}) }
        : { kind: 'note', id: note.id };
    }
    return {
      parsed,
      notes,
      blocks: [],
      containers,
      placements: Object.fromEntries(byNote),
      stages: { selected, matched: notes.length },
    };
  }

  /**
   * Execute a :tag query (ticket 08) — the tag plane. Every tag record
   * surfaces as one synthetic note row, so results are notes end to end.
   * `tag:{label}` narrows; `type:` narrows by the tag's configured type;
   * `contributes:` narrows by what a tag contributes (`metric`,
   * `metric:<type>`, `tag:<slug>`, `function:<name>`) — a contribution is
   * exposed here, never as a `tags:` label filter. The synthetic row's body
   * summarizes the contributions so `text:` reaches them too.
   */
  async runFindTag(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    const ctx = runContext(options);
    const tags = (this.tagsStore.getAll ? await this.tagsStore.getAll() : []) as Tag[];
    const selected = tags.length;
    let matched = tags;
    for (const filter of parsed.filters) {
      if (isTagLabelKey(filter.key)) {
        const wanted = new Set(filter.values.map((v) => v.value.toLowerCase()));
        matched = matched.filter((t) => {
          const hit = typeof t.label === 'string' && wanted.has(t.label.toLowerCase());
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'type') {
        const wanted = new Set(filter.values.map((v) => v.value));
        matched = matched.filter((t) => {
          const hit = t.type !== undefined && wanted.has(t.type);
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'contributes') {
        matched = matched.filter((t) => {
          const hit = (t.contributions ?? []).some((c) =>
            filter.values.some((v) => tagContributionMatches(c, v.value)));
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'text') {
        const search = filter.values.map((v) => v.value).join(' ').toLowerCase();
        matched = matched.filter((t) => (filter.negate !== `${t.label ?? ''} ${tagContributionSummary(t)}`.toLowerCase().includes(search)));
      }
    }
    let rows: Note[] = matched.map((t) => ({
      id: `tag/${typeof t.type === 'string' && t.type ? t.type : 'general'}/${t.label}`,
      title: t.label,
      type: 'tag',
      tagType: typeof t.type === 'string' ? t.type : undefined,
      contributions: t.contributions ?? [],
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
      content: tagContributionSummary(t),
      rawContent: tagContributionSummary(t),
      sourceRevision: 1,
      blocks: {},
    } as Note));
    if (parsed.window || options.range) {
      rows = rows.filter((r) => effectiveTimeWindow(r.createdAt, parsed.window, options.range, ctx));
    }
    rows = applyOrderAndPage(rows, parsed);
    return { parsed, notes: rows, blocks: [], stages: { selected, matched: rows.length } };
  }

  /**
   * Execute an :equipment query (ticket 08) — the equipment plane. Results
   * are the equipment notes (the equipment notebook's members, typed
   * 'equipment' rows included). `equipment:{label}` narrows by the
   * equipment typed tag ("every equipment note tagged kettlebell" is
   * `:equipment{equipment:kettlebell}`); `tags:` and `text:` narrow like
   * the note plane.
   */
  async runFindEquipment(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    const allNotes = await this.noteStore.getAllNotes();
    const ctx = runContext(options);
    let notes = allNotes.filter((n) => notebookOfItem(n) === 'notebook/equipment' || n.type === 'equipment' || sourceMatches(n, 'equipment'));
    const selected = notes.length;
    for (const filter of parsed.filters) {
      if (filter.key === 'equipment') {
        const matchingIds = new Set<string>();
        for (const v of filter.values) {
          (await this.getNoteIdsForTypedTag('equipment', v.value)).forEach((id) => matchingIds.add(id));
        }
        notes = notes.filter((n) => (filter.negate ? !matchingIds.has(n.id) : matchingIds.has(n.id)));
      } else if (isTagLabelKey(filter.key) && !filter.negate) {
        const matchingIds = new Set<string>();
        for (const v of filter.values) {
          (await this.noteStore.getNoteIdsForTag(v.value)).forEach((id) => matchingIds.add(id));
        }
        notes = notes.filter((n) => matchingIds.has(n.id));
      } else if (isTagLabelKey(filter.key) && filter.negate) {
        for (const v of filter.values) {
          const ids = await this.noteStore.getNoteIdsForTag(v.value);
          notes = notes.filter((n) => !ids.has(n.id));
        }
      }
    }
    for (const filter of parsed.filters) {
      if (filter.key === 'text') {
        const search = filter.values.map((v) => v.value).join(' ').toLowerCase();
        notes = notes.filter((n) => {
          const hit = n.title.toLowerCase().includes(search) || n.rawContent.toLowerCase().includes(search);
          return filter.negate ? !hit : hit;
        });
      }
    }
    notes = applyNotebookFilter(notes, parsed.filters);
    if (parsed.window || options.range) {
      notes = notes.filter((n) => effectiveTimeWindow(n.date ?? n.createdAt, parsed.window, options.range, ctx));
    }
    notes = applyOrderAndPage(notes, parsed);
    return { parsed, notes, blocks: [], stages: { selected, matched: notes.length } };
  }
}

/**
 * Shared `| order by` + `| limit/offset` tail for the container-plane
 * executors (page/tag/equipment — :notebook delegates to the note plane).
 * Server-paged reads do not exist on these planes — every slice happens
 * here, over the complete match.
 */
function applyOrderAndPage<T>(rows: T[], parsed: ParsedFindQuery): T[] {
  let out = rows;
  if (parsed.pipes?.order) {
    for (const order of [...parsed.pipes.order].reverse()) {
      const dir = order.dir === 'desc' ? -1 : 1;
      out = [...out].sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[order.col] ?? '';
        const bv = (b as unknown as Record<string, unknown>)[order.col] ?? '';
        if (av === bv) return 0;
        return ((av as string | number) > (bv as string | number) ? 1 : -1) * dir;
      });
    }
  }
  const pipes = parsed.pipes;
  if (pipes && (pipes.limit !== undefined || (pipes.offset ?? 0) > 0)) {
    const offset = pipes.offset ?? 0;
    out = pipes.limit !== undefined ? out.slice(offset, offset + pipes.limit) : out.slice(offset);
  }
  return out;
}

/** Both spellings name the tag-label filter — the canonical AST key `tags:`
 *  and the singular `tag:` the vocabulary also accepts. Capabilities admit
 *  either (supportsWqlFilterKey maps one onto the other), so every executor
 *  must apply both; a registered filter is never silently dropped. */
function isTagLabelKey(key: string): boolean {
  return key === 'tags' || key === 'tag';
}

/** One `contributes:` value against one tag contribution — `metric`,
 *  `metric:<type>`, `tag:<slug>`, `function:<name>`. */
function tagContributionMatches(contribution: TagContribution, value: string): boolean {
  const sep = value.indexOf(':');
  const kind = sep === -1 ? value : value.slice(0, sep);
  const qualifier = sep === -1 ? '' : value.slice(sep + 1);
  if (contribution.kind !== kind) return false;
  if (!qualifier) return true;
  if (contribution.kind === 'metric') return contribution.type === qualifier;
  if (contribution.kind === 'tag') return contribution.slug === qualifier;
  return contribution.name === qualifier;
}

/** Human-readable contribution summary — the synthetic tag row's body. */
function tagContributionSummary(tag: Pick<Tag, 'contributions'>): string {
  const parts = (tag.contributions ?? []).map((c) =>
    c.kind === 'metric' ? `metric ${c.type}`
      : c.kind === 'tag' ? `tag ${c.slug}`
        : `function ${c.name}`);
  return parts.length ? `contributes ${parts.join(', ')}` : '';
}
