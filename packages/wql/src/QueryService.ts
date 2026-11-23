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

import type { AnalyticsDataPoint, Note, BlockIndexRow, EventRecord, IMetric, Page, PageNote, NotePlacement, ScheduleItem, Tag, TagContribution } from '@bitcobblers/wod-wiki-core';
import { MetricType, createMetricOwnershipLedger, isNotebookLanding, metricToMs, normalizeFieldComponent, resolvePlacements, validateNoteBlocks } from '@bitcobblers/wod-wiki-core';
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
import { supportsWqlFilterKey } from './capabilities';
import { bindQueryParams } from './paramRef';
import { unknownTokensMessage } from './dashboard/model';
import { convertViaCatalog, dimensionKeyOf, resolveOutputUnit } from './units';
import { projectEventToFacts } from './derivation';
import { dedupeById, selectContributions, type CoverageReport } from './selection';
import {
  captureContext,
  civilDateAdd,
  civilDateDiff,
  civilDateOf,
  civilMonday,
  civilMonthAdd,
  civilMonthStart,
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
  BlockEffortQueryStore,
  BlockEquipmentQueryStore,
  TagQueryStore,
  NoteTagQueryStore,
  IEffort,
  QueryServiceStores,
  FeedCatalogQueryStore,
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
  FeedCatalogQueryStore,
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
export interface NotebookResolvableItem {
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
  notebookIds?: readonly string[];
  tags?: readonly string[];
}

function resolveIntrinsicNotebook(item: NotebookResolvableItem): NotebookId | undefined {
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
  if (item.sourceId === 'efforts') return 'notebook/efforts';
  if (item.sourceId === 'equipment') return 'notebook/equipment';
  if (item.sourceId === 'dashboards' || item.type === 'dashboard') return 'notebook/dashboards';
  const slug = notebookSlugOfSourceId(item.sourceId);
  if (slug) return toNotebookId(slug);
  if (isJournalRow(item)) return 'notebook/journal';
  return undefined;
}

/**
 * Resolve ALL notebooks an item belongs to (many-to-many).
 * User-owned notes retain their base container (`notebook/journal` or `notebook/playground`)
 * alongside every promoted user notebook (`notebookIds`, `notebookId`, `notebook:` tags).
 */
export function notebooksOfItem(item: NotebookResolvableItem): NotebookId[] {
  const out: NotebookId[] = [];
  const push = (raw: string | undefined) => {
    if (!raw || !raw.trim()) return;
    const id = toNotebookId(raw);
    if (!out.includes(id)) out.push(id);
  };

  if (item.notebookIds?.length) {
    for (const raw of item.notebookIds) push(raw);
  }
  if (item.notebookId?.trim()) {
    push(item.notebookId);
  }
  if (item.tags) {
    for (const tag of item.tags) {
      if (tag.startsWith('notebook:') || tag.startsWith('notebook/')) {
        const slug = notebookSlugFromId(tag);
        if (slug) push(slug);
      }
    }
  }
  if (out.length === 0 && (!Array.isArray(item.notebookIds) || item.seedOrigin === 'seed' || item.feedOrigin === 'feed')) {
    const intrinsic = resolveIntrinsicNotebook(item);
    if (intrinsic) {
      push(intrinsic);
      const isCorePrimitive =
        (intrinsic === 'notebook/efforts' || intrinsic === 'notebook/equipment') &&
        item.seedOrigin === 'seed' &&
        (!item.feedSourceId || item.feedSourceId === 'core');
      if (isCorePrimitive) {
        push('notebook/defaults');
      }
    }
  }
  return out;
}

export function notebookOfItem(item: NotebookResolvableItem): NotebookId | undefined {
  if (item.notebookId && item.notebookId.trim()) {
    return toNotebookId(item.notebookId);
  }
  if (item.notebookIds?.length) {
    const nonDefaultUser = item.notebookIds
      .map((id) => toNotebookId(id))
      .find((id) => id !== 'notebook/journal' && id !== 'notebook/playground');
    if (nonDefaultUser) return nonDefaultUser;
    return toNotebookId(item.notebookIds[0]!);
  }
  if (item.tags) {
    for (const tag of item.tags) {
      if (tag.startsWith('notebook:') || tag.startsWith('notebook/')) {
        const slug = notebookSlugFromId(tag);
        if (slug) return toNotebookId(slug);
      }
    }
  }
  if (Array.isArray(item.notebookIds) && item.seedOrigin !== 'seed' && item.feedOrigin !== 'feed') {
    return undefined;
  }
  return resolveIntrinsicNotebook(item);
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
export function notebookOriginOfItem(item: NotebookResolvableItem): NotebookOrigin | undefined {
  const notebook = notebookOfItem(item);
  if (!notebook) {
    if (
      Array.isArray(item.notebookIds) &&
      item.notebookIds.length === 0 &&
      item.seedOrigin !== 'seed' &&
      item.feedOrigin !== 'feed' &&
      !item.feedSourceId &&
      !item.seedChunkId &&
      !(!!item.sourcePath && item.sourcePath.startsWith('markdown/'))
    ) {
      return 'user';
    }
    return undefined;
  }
  if (notebook === 'notebook/defaults') return 'default';
  if (item.notebookId?.trim()) return 'user';
  if (item.notebookIds?.some((id) => {
    const norm = toNotebookId(id);
    return norm !== 'notebook/journal' && norm !== 'notebook/playground' && norm !== 'notebook/defaults';
  })) return 'user';
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
    notebookIds?: readonly string[];
    tags?: readonly string[];
  },
  kind: string,
): boolean {
  const sourceId = item.sourceId;
  if (kind === 'all') return !sourceId || WQL_SOURCE_VALUES.some((k) => sourceMatches(item, k));
  if (kind === 'journal') {
    // Membership, not the primary projection: a note promoted into a user
    // notebook keeps its base `notebook/journal` container, so `:journal`
    // matches exactly what `:notebook{notebook:journal}` matches —
    // `notebooksOfItem`, not `notebookOfItem`.
    return notebooksOfItem(item).includes('notebook/journal');
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

function matchesNotebookFilterValue(nb: NotebookId, v: TagFilter['values'][number]): boolean {
  if (v.wildcard) {
    if (!v.value) return true;
    const prefix = notebookSlugFromId(v.value);
    return notebookSlugFromId(nb).startsWith(prefix);
  }
  return nb === toNotebookId(v.value);
}

function matchesFeedFilterValue(fid: string, v: TagFilter['values'][number]): boolean {
  if (v.wildcard) {
    return v.value ? fid.startsWith(v.value) : fid !== 'local';
  }
  return fid === v.value;
}

/** Apply the `notebook:` filter key to a list of Note or BlockIndexRow items. */
function applyNotebookFilter<T extends NotebookResolvableItem>(
  items: T[],
  filters: TagFilter[],
  excludeLandings = true,
): T[] {
  for (const filter of filters) {
    if (filter.key !== 'notebook') continue;
    items = items.filter(item => {
      if (excludeLandings && 'id' in item && 'notebookId' in item && isNotebookLanding(item as { id: string; notebookId?: string })) {
        return false;
      }
      const memberships = notebooksOfItem(item);
      if (memberships.length === 0) return filter.negate;
      const hit = memberships.some(nb => filter.values.some(v => matchesNotebookFilterValue(nb, v)));
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
  /** True when the parse-authored sourceScope stayed residual (journal/all —
   *  the wire's source predicate cannot decide them). The wire's
   *  selectedCount then baselines nothing: the caller counts the complete,
   *  unpaged candidates after the JS selection stages instead. */
  scopeResidual: boolean;
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
  let scopeResidual = false;
  for (const filter of filters) {
    const literal = !filter.negate && filter.values.every((v) => !v.wildcard);
    const values = literal ? filter.values.map((v) => v.value) : [];
    if (filter.key === 'source' && literal && filter.values.every((v) => DOMAIN_SOURCE_KINDS[v.value])) {
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
      // tags by-type index (and `block_equipment` when `tagType === 'equipment'`),
      // matching the JS stage's (type, label) resolution.
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
    if (sourceScope.every((v) => DOMAIN_SOURCE_KINDS[v])) {
      selection.push({ field: 'source', values: sourceScope });
    } else {
      // `journal`/`all` need the resolver's shape exclusions — the wire's
      // source predicate would select nothing. Stay residual so the JS
      // stage (applyNoteSelectionStages → sourceMatches) owns the scope.
      residual = true;
      scopeResidual = true;
    }
  }
  // The note plane is inclusive — no defaultNotes clause, no source fence
  // (generic :note surfaces every row). The block plane keeps its
  // historical fence: candidates come from the WQL source domain.
  if (plane === 'block') {
    selection.push({ field: 'sourceFence' });
  }
  return { selection, filters: compiled, residual, scopeResidual };
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

/** The container projection and the full placement set per note id —
 *  `runFind`'s relation payload keyed by note id. */
interface NoteRelations {
  containers: Record<string, NoteContainer>;
  placements: Record<string, NotePlacement[]>;
  typedTags: Record<string, Array<{ label: string; type?: string }>>;
}

/** The note's effective window timestamp: the authored `date` wins; an
 *  undated note takes its journal-page placement's civil date (local noon
 *  in the run's timezone — the placement IS its date of record); createdAt
 *  stays the last fallback. */
function noteEffectiveTimestamp(
  note: Note,
  placements: readonly NotePlacement[] | undefined,
  timeZone: string,
): number {
  if (note.date !== undefined) return note.date;
  const placed = placements?.find((p) => p.date !== undefined)?.date;
  return placed !== undefined ? zonedNoon(placed, timeZone) : note.createdAt;
}

/**
 * All effective timestamps for a Note across M:N `schedule_items`, legacy
 * dated `page_notes` placements, and authored `note.date` / `createdAt`.
 */
function noteEffectiveTimestamps(
  note: Note,
  placements: readonly NotePlacement[] | undefined,
  schedules: readonly ScheduleItem[] | undefined,
  timeZone: string,
): number[] {
  const out: number[] = [];
  const push = (ts: number) => {
    if (!out.includes(ts)) out.push(ts);
  };
  if (schedules && schedules.length > 0) {
    for (const s of schedules) {
      if (s.status !== 'skipped') push(zonedNoon(s.date, timeZone));
    }
  }
  if (placements && placements.length > 0) {
    for (const p of placements) {
      if (p.date !== undefined) push(zonedNoon(p.date, timeZone));
    }
  }
  if (note.date !== undefined) push(note.date);
  if (out.length === 0) push(note.createdAt);
  return out;
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
  /** Typed junction tags per note id when loaded via `relationStore`. */
  typedTags?: Record<string, Array<{ label: string; type?: string }>>;
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
  /** Active `$param` bindings applied to `ParamRef` AST nodes at execution time. */
  params?: Record<string, string>;
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
  /** When true (e.g. pipeline source feeding a numeric reducer), skip container/placement hydration. */
  skipContainers?: boolean;
  /** Active `$param` bindings applied to `ParamRef` AST nodes at execution time. */
  params?: Record<string, string>;
  /** When 'containers' (e.g. `/notebooks` library plane), `:notebook{…}` returns Notebook container rows instead of member Notes. */
  notebookPlane?: 'notes' | 'containers';
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
  /** Find-family result when runQuery executes a find query. */
  find?: FindQueryResult;
  /** Advisories surfaced from find/aggregate execution. */
  advisories?: Array<{ message: string }>;
}

export interface MovementRollupItem {
  effortSlug: string;
  label: string;
  splits: number;
  totalReps: number;
  totalVolume: number;
  volumeUnit?: string;
  totalDistance: number;
  distanceUnit?: string;
  totalElapsedMs: number;
  bestWeight?: number;
  bestE1rm?: number;
}

export interface RowsRunSummary {
  elapsedMs: number;
  totalReps: number;
  totalVolume: number;
  volumeUnit?: string;
  totalDistance: number;
  distanceUnit?: string;
  tis?: number;
  sessionLoad?: number;
  rpe?: number;
  roundsCompleted: number;
  splitCount: number;
  efforts: string[];
  blockContentId?: string;
  noteTitle?: string;
  notebooks?: string[];
  completed?: boolean;
  prCount?: number;
  movementRollup: MovementRollupItem[];
}

function humanizeEffortLabel(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function visibleRowMetrics(metrics: EventRecord['metrics'] | undefined) {
  const raw = (metrics ?? []) as unknown as readonly IMetric[];
  try {
    return createMetricOwnershipLedger(raw).visible() as ReadonlyArray<{
      type?: string;
      value?: unknown;
      unit?: string;
      image?: string;
      origin?: string;
      metadata?: Record<string, unknown>;
    }>;
  } catch {
    return raw as ReadonlyArray<{
      type?: string;
      value?: unknown;
      unit?: string;
      image?: string;
      origin?: string;
      metadata?: Record<string, unknown>;
    }>;
  }
}

function extractSessionRpeValue(events: readonly EventRecord[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    for (const m of events[i]!.metrics ?? []) {
      if (m.type === MetricType.SessionRPE || m.type === 'session-rpe' || m.type === 'session_rpe') {
        if (typeof m.value === 'number' && Number.isFinite(m.value)) return m.value;
      }
    }
  }
  return undefined;
}

export function isStructuralSegmentEvent(event: Pick<EventRecord, 'sourceBlockKey'>): boolean {
  const key = String(event.sourceBlockKey ?? '').toLowerCase();
  return key.startsWith('waiting-to-start') || key.startsWith('session-root') || key === 'root';
}

/**
 * Select the canonical non-structural split segment events for a session run.
 * Shared by `computeRowsRunSummary`, `ResultsSpreadsheetGrid`, and `entryMapper`
 * so Workout Complete banners, Splits tab headers, `/results/:sessionId`, and
 * `/sessions` cards always agree on the exact same split count (WW-051).
 */
export function selectSplitSegmentEvents(events: readonly EventRecord[]): EventRecord[] {
  const rawSegments = events.filter(
    (e) => e.grain !== 'summary' && e.outputType === 'segment' && !isStructuralSegmentEvent(e),
  );
  const maxStackLevel = rawSegments.reduce((max, e) => Math.max(max, e.stackLevel ?? 0), 0);
  const hasEffortLeaves = rawSegments.some((e) => {
    if (e.effortSlug) return true;
    const metrics = visibleRowMetrics(e.metrics);
    return metrics.some((m) => String(m.type ?? '').toLowerCase() === 'effort');
  });
  if (!hasEffortLeaves) return rawSegments;
  return rawSegments.filter((e) => {
    if ((e.stackLevel ?? 0) >= maxStackLevel) return true;
    if (e.effortSlug) return true;
    const metrics = visibleRowMetrics(e.metrics);
    return metrics.some((m) => {
      const t = String(m.type ?? '').toLowerCase();
      return t === 'effort' || t === 'rep' || t === 'reps' || t === 'distance';
    });
  });
}

/**
 * Compute the single canonical `RowsRunSummary` shared by inline note summary
 * cards, FullscreenTimer completion hero, `/sessions`, `/results/:sessionId`,
 * and dashboard summary widgets.
 */
export function computeRowsRunSummary(
  run: Pick<RowsRun, 'resultId' | 'noteId' | 'timestamp' | 'durationMs' | 'events'>,
  opts: {
    noteTitle?: string;
    notebooks?: readonly string[];
    completed?: boolean;
    prCount?: number;
  } = {},
): RowsRunSummary {
  const events = run.events ?? [];
  const allSegmentRows = events.filter((e) => e.grain !== 'summary' && e.outputType === 'segment');
  const segmentRows = selectSplitSegmentEvents(allSegmentRows);
  const splitRowSet = new Set(segmentRows);
  const summaryRows = events.filter((e) => e.grain === 'summary' || e.outputType === 'analytics');
  const hasUserOverride = events.some((e) => (e.metrics ?? []).some((m) => m.origin === 'user'));

  let segmentElapsedSum = 0;
  let minStart: number | undefined;
  let maxEnd: number | undefined;
  let totalReps = 0;
  let segVolume = 0;
  let segVolumeUnit: string | undefined;
  let segDistance = 0;
  let segDistanceUnit: string | undefined;
  let roundsCompleted = 0;
  let blockContentId = events.find((e) => e.blockContentId)?.blockContentId;

  // Preserve roundsCompleted reported on enclosing container segments (e.g. rounds blocks)
  // without inflating splitCount or double-counting leaf work metrics.
  for (const row of allSegmentRows) {
    if (splitRowSet.has(row)) continue;
    const key = String(row.sourceBlockKey ?? '').toLowerCase();
    if (key.startsWith('waiting-to-start')) continue;
    for (const m of visibleRowMetrics(row.metrics)) {
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;
      const mType = m.type ?? '';
      const canon = typeof m.metadata?.canonicalKey === 'string' ? m.metadata.canonicalKey : mType;
      if (canon === 'rounds' || mType === 'rounds' || mType === 'current-round' || canon === 'currentRound') {
        roundsCompleted = Math.max(roundsCompleted, Math.round(m.value));
      }
    }
  }

  const rollupMap = new Map<string, MovementRollupItem>();

  for (const row of segmentRows) {
    if (!blockContentId && row.blockContentId) blockContentId = row.blockContentId;
    const vis = visibleRowMetrics(row.metrics);

    let rowElapsedMs = 0;
    if (row.timeSpan?.started !== undefined) {
      minStart = minStart === undefined ? row.timeSpan.started : Math.min(minStart, row.timeSpan.started);
      if (row.timeSpan.ended !== undefined) {
        maxEnd = maxEnd === undefined ? row.timeSpan.ended : Math.max(maxEnd, row.timeSpan.ended);
        rowElapsedMs = Math.max(0, row.timeSpan.ended - row.timeSpan.started);
      }
    }

    let rowReps = 0;
    let sawReps = false;
    let rowMass: number | undefined;
    let rowMassUnit: string | undefined;
    let rowExplicitVolume: number | undefined;
    let rowExplicitVolumeUnit: string | undefined;
    let rowDist = 0;
    let rowDistUnit: string | undefined;
    let rowE1rm: number | undefined;
    let rowEffortSlug = row.effortSlug;

    for (const m of vis) {
      const mType = m.type ?? '';
      const canon = typeof m.metadata?.canonicalKey === 'string' ? m.metadata.canonicalKey : mType;
      if (!rowEffortSlug && (mType === MetricType.Effort || mType === 'effort')) {
        if (typeof m.value === 'string' && m.value) rowEffortSlug = m.value;
        else if (m.image) rowEffortSlug = m.image;
      }
      if (!rowEffortSlug && typeof m.metadata?.effortSlug === 'string') {
        rowEffortSlug = m.metadata.effortSlug;
      }
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;

      if ((mType === MetricType.Rep || mType === 'rep' || canon === 'reps' || mType === 'totalReps') && !sawReps) {
        rowReps = m.value;
        sawReps = true;
      } else if (mType === MetricType.Resistance || mType === 'resistance' || canon === 'weight') {
        rowMass = m.value;
        rowMassUnit = m.unit ?? rowMassUnit ?? 'kg';
      } else if (canon === 'totalVolume' || canon === 'volume') {
        rowExplicitVolume = m.value;
        rowExplicitVolumeUnit = m.unit ?? rowExplicitVolumeUnit;
      } else if (mType === MetricType.Distance || mType === 'distance' || canon === 'totalDistance') {
        rowDist += m.value;
        if (m.unit) rowDistUnit = m.unit;
      } else if (canon === 'elapsed' || mType === 'elapsed' || mType === MetricType.Elapsed) {
        rowElapsedMs = metricToMs(m) ?? rowElapsedMs;
      } else if (mType === 'duration' || mType === MetricType.Duration) {
        if (rowElapsedMs === 0) {
          rowElapsedMs = metricToMs(m) ?? 0;
        }
      } else if (canon === 'rounds' || mType === 'rounds' || mType === 'current-round' || canon === 'currentRound') {
        const earlyTermination =
          row.completionReason === 'user-abort' ||
          row.completionReason === 'forced-pop' ||
          row.completionReason === 'timer-expired';
        const isLeafEffortRow =
          Boolean(rowEffortSlug) ||
          vis.some((x) => x.type === MetricType.Effort || x.type === 'effort');
        const effectiveRound =
          earlyTermination && isLeafEffortRow
            ? Math.max(0, Math.round(m.value) - 1)
            : Math.round(m.value);
        roundsCompleted = Math.max(roundsCompleted, effectiveRound);
      } else if (canon === 'calc.e1rm' || canon === 'e1rm') {
        rowE1rm = rowE1rm === undefined ? m.value : Math.max(rowE1rm, m.value);
      }
    }

    const rowVolume =
      rowExplicitVolume !== undefined
        ? rowExplicitVolume
        : rowReps > 0 && rowMass !== undefined
          ? rowReps * rowMass
          : 0;
    const effectiveVolUnit = rowExplicitVolumeUnit ?? (rowVolume > 0 ? (rowMassUnit ?? 'kg') : undefined);

    segmentElapsedSum += rowElapsedMs;
    totalReps += rowReps;
    segVolume += rowVolume;
    if (effectiveVolUnit && !segVolumeUnit) segVolumeUnit = effectiveVolUnit;
    segDistance += rowDist;
    if (rowDistUnit && !segDistanceUnit) segDistanceUnit = rowDistUnit;

    if (rowEffortSlug) {
      const slug = rowEffortSlug.trim().toLowerCase();
      const existing = rollupMap.get(slug) ?? {
        effortSlug: slug,
        label: humanizeEffortLabel(slug),
        splits: 0,
        totalReps: 0,
        totalVolume: 0,
        ...(effectiveVolUnit ? { volumeUnit: effectiveVolUnit } : {}),
        totalDistance: 0,
        ...(rowDistUnit ? { distanceUnit: rowDistUnit } : {}),
        totalElapsedMs: 0,
      };
      existing.splits += 1;
      existing.totalReps += rowReps;
      existing.totalVolume += rowVolume;
      if (!existing.volumeUnit && effectiveVolUnit) existing.volumeUnit = effectiveVolUnit;
      existing.totalDistance += rowDist;
      if (!existing.distanceUnit && rowDistUnit) existing.distanceUnit = rowDistUnit;
      existing.totalElapsedMs += rowElapsedMs;
      if (rowMass !== undefined) {
        existing.bestWeight = existing.bestWeight === undefined ? rowMass : Math.max(existing.bestWeight, rowMass);
      }
      if (rowE1rm !== undefined) {
        existing.bestE1rm = existing.bestE1rm === undefined ? rowE1rm : Math.max(existing.bestE1rm, rowE1rm);
      }
      rollupMap.set(slug, existing);
    }
  }

  let storedVolume: number | undefined;
  let storedVolumeUnit: string | undefined;
  let groupedVolume: number | undefined;
  let groupedVolumeUnit: string | undefined;
  let storedDistance: number | undefined;
  let storedDistanceUnit: string | undefined;
  let groupedDistance: number | undefined;
  let groupedDistanceUnit: string | undefined;
  let storedReps: number | undefined;
  let tis: number | undefined;
  let sessionLoad: number | undefined;
  let summaryElapsedMs: number | undefined;

  // Prefer grain === 'summary' rows when present; otherwise fold legacy analytics rows once per metric key (WW-116).
  const hasGrainSummary = summaryRows.some((r) => r.grain === 'summary');
  const dedupedSummaryRows = hasGrainSummary
    ? summaryRows.filter((r) => r.grain === 'summary')
    : summaryRows;
  const seenSummaryKeys = new Set<string>();

  for (const row of dedupedSummaryRows) {
    const rowIsGrouped =
      Boolean(row.effortSlug) ||
      row.summaryCoverage?.scope === 'effort' ||
      row.summaryCoverage?.scope === 'partition';
    for (const m of visibleRowMetrics(row.metrics)) {
      if (typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;
      const canon = typeof m.metadata?.canonicalKey === 'string' ? m.metadata.canonicalKey : m.type ?? '';
      const metricIsGrouped =
        rowIsGrouped ||
        typeof m.metadata?.effortSlug === 'string' ||
        (typeof m.metadata?.groupTags === 'object' && m.metadata?.groupTags !== null);
      const groupTags = m.metadata?.groupTags
        ? JSON.stringify(m.metadata.groupTags)
        : (typeof m.metadata?.effortSlug === 'string' ? m.metadata.effortSlug : (row.effortSlug ?? ''));
      const dedupeKey = `${canon}:${groupTags}`;
      if ((canon === 'tis' || canon === 'sessionLoad' || canon === 'totalVolume' || canon === 'totalDistance') && seenSummaryKeys.has(dedupeKey)) {
        continue;
      }
      if (canon === 'tis' || canon === 'sessionLoad' || canon === 'totalVolume' || canon === 'totalDistance') {
        seenSummaryKeys.add(dedupeKey);
      }
      if (canon === 'totalVolume' || canon === 'volume') {
        if (metricIsGrouped) {
          groupedVolume = (groupedVolume ?? 0) + m.value;
          if (m.unit && !groupedVolumeUnit) groupedVolumeUnit = m.unit;
        } else {
          storedVolume = (storedVolume ?? 0) + m.value;
          if (m.unit && !storedVolumeUnit) storedVolumeUnit = m.unit;
        }
      } else if (canon === 'totalDistance' || canon === 'distance') {
        if (metricIsGrouped) {
          groupedDistance = (groupedDistance ?? 0) + m.value;
          if (m.unit && !groupedDistanceUnit) groupedDistanceUnit = m.unit;
        } else {
          storedDistance = (storedDistance ?? 0) + m.value;
          if (m.unit && !storedDistanceUnit) storedDistanceUnit = m.unit;
        }
      } else if (canon === 'totalReps' || canon === 'reps' || canon === 'rep') {
        storedReps = Math.max(storedReps ?? 0, m.value);
      } else if (canon === 'tis') {
        tis = (tis ?? 0) + m.value;
      } else if (canon === 'sessionLoad') {
        sessionLoad = (sessionLoad ?? 0) + m.value;
      } else if (canon === 'elapsed' || canon === 'duration') {
        const ms = metricToMs(m) ?? 0;
        summaryElapsedMs = Math.max(summaryElapsedMs ?? 0, ms);
      } else if (canon === 'rounds' || canon === 'currentRound') {
        roundsCompleted = Math.max(roundsCompleted, Math.round(m.value));
      }
    }
  }

  const resolvedStoredVolume = storedVolume ?? groupedVolume;
  const resolvedStoredVolumeUnit = storedVolume !== undefined ? storedVolumeUnit : groupedVolumeUnit;
  const resolvedStoredDistance = storedDistance ?? groupedDistance;
  const resolvedStoredDistanceUnit = storedDistance !== undefined ? storedDistanceUnit : groupedDistanceUnit;

  const elapsedMs =
    typeof run.durationMs === 'number' && Number.isFinite(run.durationMs) && run.durationMs > 0
      ? run.durationMs
      : summaryElapsedMs && summaryElapsedMs > 0
        ? summaryElapsedMs
        : segmentElapsedSum > 0
          ? segmentElapsedSum
          : minStart !== undefined && maxEnd !== undefined && maxEnd > minStart
            ? maxEnd - minStart
            : 0;

  const finalReps = hasUserOverride && segmentRows.length > 0 ? totalReps : totalReps > 0 ? totalReps : storedReps ?? 0;
  const finalVolume =
    hasUserOverride && segVolume > 0
      ? segVolume
      : resolvedStoredVolume !== undefined
        ? resolvedStoredVolume
        : segVolume;
  const finalVolumeUnit = resolvedStoredVolumeUnit ?? segVolumeUnit;
  const finalDistance =
    hasUserOverride && segDistance > 0
      ? segDistance
      : resolvedStoredDistance !== undefined
        ? resolvedStoredDistance
        : segDistance;
  const finalDistanceUnit = resolvedStoredDistanceUnit ?? segDistanceUnit;
  const rpe = extractSessionRpeValue(events);

  return {
    elapsedMs,
    totalReps: finalReps,
    totalVolume: finalVolume,
    ...(finalVolumeUnit ? { volumeUnit: finalVolumeUnit } : {}),
    totalDistance: finalDistance,
    ...(finalDistanceUnit ? { distanceUnit: finalDistanceUnit } : {}),
    ...(tis !== undefined ? { tis } : {}),
    ...(sessionLoad !== undefined ? { sessionLoad } : {}),
    ...(rpe !== undefined ? { rpe } : {}),
    roundsCompleted,
    splitCount: segmentRows.length,
    efforts: [...rollupMap.keys()],
    ...(blockContentId ? { blockContentId } : {}),
    ...(opts.noteTitle ? { noteTitle: opts.noteTitle } : {}),
    ...(opts.notebooks?.length ? { notebooks: [...opts.notebooks] } : {}),
    ...(opts.completed !== undefined ? { completed: opts.completed } : {}),
    ...(opts.prCount !== undefined ? { prCount: opts.prCount } : {}),
    movementRollup: [...rollupMap.values()],
  };
}

/** One run in a rows result: the canonical result identity plus the event
 *  rows that survived the optional output-type narrowing (`rows:segment{…}`). */
export interface RowsRun {
  resultId: string;
  noteId: string;
  /** Canonical workout time (result.createdAt under the unified model). */
  timestamp: number;
  /** Authoritative persisted session duration in milliseconds when known. */
  durationMs?: number;
  events: EventRecord[];
  /** Authoritative session rollup shared across inline notes, completion hero, spreadsheet, and dashboards. */
  summary?: RowsRunSummary;
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

interface FactDimensionContext {
  noteTags: ReadonlyMap<string, readonly string[]>;
  typedNoteTags: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  effortsBySlug: ReadonlyMap<string, IEffort>;
  noteNotebooks?: ReadonlyMap<string, readonly NotebookId[]>;
  sessionNotebooks?: ReadonlyMap<string, readonly NotebookId[]>;
  noteTitles?: ReadonlyMap<string, string>;
}

const EMPTY_FACT_DIMS: FactDimensionContext = {
  noteTags: new Map(),
  typedNoteTags: new Map(),
  effortsBySlug: new Map(),
  noteNotebooks: new Map(),
  sessionNotebooks: new Map(),
  noteTitles: new Map(),
};

function resolveDimensionContext(
  dimsOrNoteTags: FactDimensionContext | ReadonlyMap<string, readonly string[]>,
): FactDimensionContext {
  if ('noteTags' in dimsOrNoteTags) return dimsOrNoteTags;
  return { ...EMPTY_FACT_DIMS, noteTags: dimsOrNoteTags };
}

const TYPED_TAG_KEY_SET: ReadonlySet<string> = new Set(WQL_TYPED_TAG_KEYS);

/**
 * Tag value for a fact row with 3-tier precedence:
 *   Tier 1: Statement-level `row.dimensions` / explicit `row.discipline` / `row.intensityTier`
 *   Tier 2: Effort-level metadata (`effort.equipment`, `effort.baseAttributes.discipline`, `effort.baseAttributes.intensityTier`)
 *   Tier 3: Parent Note typed tags (`NoteRelationBundle.tags` where `tag.type === key`)
 */
function factTagValue(
  row: AnalyticsDataPoint,
  key: string,
  dimsOrNoteTags: FactDimensionContext | ReadonlyMap<string, readonly string[]> = EMPTY_FACT_DIMS,
): string | readonly string[] | undefined {
  const ctx = resolveDimensionContext(dimsOrNoteTags);
  const effort = row.effortSlug ? ctx.effortsBySlug.get(row.effortSlug) : undefined;
  switch (key) {
    case 'effort': return row.effortSlug;
    case 'discipline': {
      const explicit = row.discipline ?? row.dimensions?.['discipline'];
      if (explicit) return explicit;
      const fromEffort = effort?.baseAttributes?.discipline;
      if (fromEffort) return fromEffort;
      const fromNote = ctx.typedNoteTags.get(row.noteId)?.get('discipline');
      return fromNote && fromNote.length > 0 ? fromNote : undefined;
    }
    case 'intensity': {
      const explicit = row.intensityTier ?? row.dimensions?.['intensity'];
      if (explicit) return explicit;
      const fromEffort = effort?.baseAttributes?.intensityTier;
      if (fromEffort) return fromEffort;
      const fromNote = ctx.typedNoteTags.get(row.noteId)?.get('intensity');
      return fromNote && fromNote.length > 0 ? fromNote : undefined;
    }
    case 'grade': return row.grade;
    case 'note': return row.noteId;
    case 'noteTitle': return ctx.noteTitles?.get(row.noteId) ?? row.dimensions?.['noteTitle'];
    case 'notebook': {
      const fromSession = ctx.sessionNotebooks?.get(row.resultId) ?? [];
      const fromNote = ctx.noteNotebooks?.get(row.noteId) ?? [];
      if (fromSession.length > 0 || fromNote.length > 0) {
        const merged = new Set<string>([...fromSession, ...fromNote]);
        return [...merged];
      }
      return row.dimensions?.['notebook'];
    }
    case 'page': return row.pageId;
    case 'origin': return row.origin;
    case 'grain': return row.grain;
    case 'metric': return row.metricKey;
    case 'block': return row.blockContentId;
    case 'result': return row.resultId;
    case 'tags': return ctx.noteTags.get(row.noteId) ?? [];
    case 'equipment': {
      const explicit = row.dimensions?.['equipment'];
      if (explicit) return explicit;
      if (effort?.equipment && effort.equipment.length > 0) return effort.equipment;
      const fromNote = ctx.typedNoteTags.get(row.noteId)?.get('equipment');
      return fromNote && fromNote.length > 0 ? fromNote : undefined;
    }
    default: {
      const rowDims = row.dimensions;
      const explicit = rowDims ? (rowDims[key] ?? rowDims[normalizeFieldComponent(key)]) : undefined;
      if (explicit !== undefined) return explicit;
      if (TYPED_TAG_KEY_SET.has(key)) {
        const fromNote = ctx.typedNoteTags.get(row.noteId)?.get(key);
        if (fromNote && fromNote.length > 0) return fromNote;
      }
      return undefined;
    }
  }
}

function matchesFilters(
  row: AnalyticsDataPoint,
  filters: TagFilter[],
  dimsOrNoteTags: FactDimensionContext | ReadonlyMap<string, readonly string[]>,
): boolean {
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
    const raw = factTagValue(row, key, dimsOrNoteTags);
    const rowValues = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
    const hit = rowValues.some((value) =>
      group.some((f) =>
        f.values.some((a) =>
          key === 'notebook'
            ? matchesNotebookFilterValue(toNotebookId(value), a)
            : a.wildcard
              ? value.startsWith(a.value)
              : value === a.value,
        ),
      ),
    );
    return negate ? !hit : hit;
  });
}

function dimValue(
  row: AnalyticsDataPoint,
  dim: string,
  dimsOrNoteTags: FactDimensionContext | ReadonlyMap<string, readonly string[]>,
  ctx: ExecutionContext,
): string {
  if (dim === 'day') return row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone);
  if (dim === 'week') return civilMonday(row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone));
  if (dim === 'month') return civilMonthStart(row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone));
  if (dim === 'session') return row.resultId;
  const raw = factTagValue(row, dim, dimsOrNoteTags);
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
  private readonly feedCatalogStore?: FeedCatalogQueryStore;
  private readonly scheduleStore?: QueryServiceStores['scheduleStore'];
  private readonly sessionStore?: QueryServiceStores['sessionStore'];

  // Optional storage seam properties for block_efforts, block_equipment, and typed tag resolution.
  // Injected by the app adapter (`services/queryService.ts`); tests can supply fakes.
  private readonly blockEffortsStore: BlockEffortQueryStore = {
    getAllFromIndex: async () => [],
  };
  private readonly blockEquipmentStore: BlockEquipmentQueryStore = {
    getAllFromIndex: async () => [],
  };
  private readonly tagsStore: TagQueryStore = {
    getAllFromIndex: async () => [],
  };
  private readonly noteTagsStore: NoteTagQueryStore = {
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
        'blockEffortsStore' in storesOrEventStore ||
        'blockEquipmentStore' in storesOrEventStore ||
        'tagsStore' in storesOrEventStore ||
        'noteTagsStore' in storesOrEventStore ||
        'pageStore' in storesOrEventStore ||
        'relationStore' in storesOrEventStore ||
        'datasetStore' in storesOrEventStore ||
        'feedCatalogStore' in storesOrEventStore ||
        'scheduleStore' in storesOrEventStore ||
        'sessionStore' in storesOrEventStore ||
        'isNotebookSubscribed' in storesOrEventStore)
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
      if (stores.blockEquipmentStore) this.blockEquipmentStore = stores.blockEquipmentStore;
      if (stores.tagsStore) this.tagsStore = stores.tagsStore;
      if (stores.noteTagsStore) this.noteTagsStore = stores.noteTagsStore;
      if (stores.isNotebookSubscribed) this.isNotebookSubscribed = stores.isNotebookSubscribed;
      if (stores.feedCatalogStore) this.feedCatalogStore = stores.feedCatalogStore;
      if (stores.scheduleStore) this.scheduleStore = stores.scheduleStore;
      if (stores.sessionStore) this.sessionStore = stores.sessionStore;
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
    return rows.flatMap((row) => projectEventToFacts(row));
  }

  async runQuery(raw: string, options: QueryOptions = {}): Promise<QueryResult> {
    const parsed = parseQuery(raw);
    if (isPipelineQuery(parsed)) return this.pipelineResultToQueryResult(await this.runPipelineParsed(parsed, options));
    if (isFindQuery(parsed)) {
      const findRes = await this.runFind(parsed, options);
      const advisories = (findRes.parsed.advisories ?? []).map((message) => ({ message }));
      return {
        parsed: { family: 'aggregate', raw: parsed.raw, agg: 'count', metric: parsed.target, filters: [], groupBy: [] },
        series: [],
        stages: {
          selected: findRes.stages.selected,
          buckets: 0,
          aggregated: findRes.stages.matched,
          groups: 0,
        },
        matched: [],
        find: findRes,
        ...(advisories.length ? { advisories } : {}),
        ...(findRes.parsed.error ? { error: findRes.parsed.error } : {}),
      };
    }
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
    const posScopeValues = (key: string) =>
      parsed.filters.filter((f) => f.key === key && !f.negate).flatMap((f) => f.values.map((v) => v.value));
    const scopeFilters = parsed.filters.filter((f) => ['result', 'block', 'note'].includes(f.key));
    const resultIds = posScopeValues('result');
    const blockIds = posScopeValues('block');
    const noteIds = posScopeValues('note');

    const sessionMetaById = new Map<
      string,
      {
        duration?: number;
        notebookIds?: readonly string[];
        blockContentId?: string;
        completed?: boolean;
        sessionDate?: string;
        scheduleItemId?: string;
      }
    >();
    const allSessions = this.sessionStore ? await this.sessionStore.getAll() : [];
    for (const s of allSessions) {
      sessionMetaById.set(s.id, {
        duration: s.duration,
        notebookIds: s.notebookIds,
        blockContentId: s.blockContentId,
        completed: s.completed,
        sessionDate: s.sessionDate,
        scheduleItemId: s.scheduleItemId,
      });
    }

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
      if (range && allSessions.length > 0) {
        for (const s of allSessions) {
          if (byResult.has(s.id) || !s.sessionDate) continue;
          if (inRange(zonedNoon(s.sessionDate, ctx.timeZone), range)) {
            collect(await this.store.getEventsByResult(s.id));
          }
        }
      }
    } else {
      for (const id of resultIds) collect(await this.store.getEventsByResult(id));
      for (const blockContentId of blockIds) collect(await this.store.getEventsByContent(blockContentId));
      for (const noteId of noteIds) collect(await this.store.getEventsForNote(noteId));
    }

    const matchesSessionScope = (meta: { resultId: string; noteId: string; blockContentId?: string }): boolean => {
      // Positive scope filters union across keys (`:session{result:rA, note:n2}`
      // fetches both rA and n2); only negated scope filters (`!result:`, `!block:`,
      // `!note:`) exclude matched sessions.
      const negScopeFilters = scopeFilters.filter((f) => f.negate);
      for (const f of negScopeFilters) {
        const actual = f.key === 'result' ? meta.resultId : f.key === 'block' ? meta.blockContentId : meta.noteId;
        if (actual !== undefined && f.values.some((v) => v.wildcard ? actual.startsWith(v.value) : actual === v.value)) {
          return false;
        }
      }
      return true;
    };

    let groups = [...byResult.entries()].filter(([resultId, rows]) => {
      if (rows.length === 0) return false;
      const bcid = rows.find((r) => r.blockContentId)?.blockContentId;
      return matchesSessionScope({ resultId, noteId: rows[0]!.noteId, blockContentId: bcid });
    });

    if (parsed.window || options.range) {
      groups = groups.filter(([resultId, rows]) => {
        const meta = sessionMetaById.get(resultId);
        const effectiveTs = meta?.sessionDate
          ? zonedNoon(meta.sessionDate, ctx.timeZone)
          : sessionCompletedAt(rows);
        return effectiveTimeWindow(effectiveTs, parsed.window, options.range, ctx);
      });
    }
    groups.sort((a, b) => sessionCompletedAt(b[1]) - sessionCompletedAt(a[1]));

    const planeFilters = parsed.filters.filter((f) => f.key === 'plane');
    const factFilters = parsed.filters.filter(
      (f) => !['result', 'block', 'note', 'plane'].includes(f.key) && supportsWqlFilterKey('session', 'find', f.key),
    );
    const normalizedFactFilters = factFilters.map((f) => (f.key === 'tag' ? { ...f, key: 'tags' } : f));
    const dimSeedRows: AnalyticsDataPoint[] = groups.length > 0
      ? groups.map(([resultId, rows]) => ({
          resultId,
          noteId: rows[0]?.noteId ?? '',
          effortSlug: rows.find((r) => r.effortSlug)?.effortSlug,
        } as AnalyticsDataPoint))
      : allSessions.map((s) => ({ resultId: s.id, noteId: s.noteId } as AnalyticsDataPoint));
    const sessionDims = dimSeedRows.length > 0
      ? await this.loadFactDimensions(
          dimSeedRows,
          normalizedFactFilters,
          ['notebook', 'noteTitle'],
        )
      : EMPTY_FACT_DIMS;

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
        if (normalizedFactFilters.length > 0) {
          const matchingSession = events.some((row) => {
            const facts = projectEventToFacts(row);
            return facts.some((fact) => matchesFilters(fact, normalizedFactFilters, sessionDims));
          });
          if (!matchingSession) events = [];
        }
        const meta = sessionMetaById.get(resultId);
        const noteId = rows[0].noteId;
        const nbs = new Set<string>([
          ...(sessionDims.sessionNotebooks?.get(resultId) ?? []),
          ...(sessionDims.noteNotebooks?.get(noteId) ?? []),
        ]);
        const summary = computeRowsRunSummary(
          {
            resultId,
            noteId,
            timestamp: sessionCompletedAt(rows),
            ...(typeof meta?.duration === 'number' && Number.isFinite(meta.duration) ? { durationMs: meta.duration } : {}),
            events: rows,
          },
          {
            noteTitle: sessionDims.noteTitles?.get(noteId),
            notebooks: [...nbs],
            completed: meta?.completed,
          },
        );
        return {
          resultId,
          noteId,
          timestamp: sessionCompletedAt(rows),
          ...(typeof meta?.duration === 'number' && Number.isFinite(meta.duration) ? { durationMs: meta.duration } : {}),
          events,
          summary,
        };
      })
      .filter((run) => run.events.length > 0);
    const hasPosScope = resultIds.length + blockIds.length + noteIds.length > 0;
    const matchesPosSessionUnion = (s: { id: string; noteId: string; blockContentId?: string }): boolean => {
      if (!hasPosScope) return true;
      return (
        resultIds.includes(s.id) ||
        noteIds.includes(s.noteId) ||
        (s.blockContentId !== undefined && blockIds.includes(s.blockContentId))
      );
    };
    const nonNotebookFactFilters = normalizedFactFilters.filter((f) => f.key !== 'notebook');
    const notebookFactFilters = normalizedFactFilters.filter((f) => f.key === 'notebook');
    if (this.sessionStore && planeFilters.length === 0 && nonNotebookFactFilters.length === 0 && blockIds.length === 0) {
      const seen = new Set(runs.map((r) => r.resultId));
      for (const s of allSessions) {
        if (seen.has(s.id)) continue;
        if (!matchesPosSessionUnion(s)) continue;
        if (!matchesSessionScope({ resultId: s.id, noteId: s.noteId, blockContentId: s.blockContentId })) continue;
        if (notebookFactFilters.length > 0) {
          const dummyFact = { resultId: s.id, noteId: s.noteId } as AnalyticsDataPoint;
          if (!matchesFilters(dummyFact, notebookFactFilters, sessionDims)) continue;
        }
        const ts = s.completedAt ?? s.startedAt ?? s.createdAt ?? 0;
        const effectiveTs = s.sessionDate ? zonedNoon(s.sessionDate, ctx.timeZone) : ts;
        if ((parsed.window || options.range) && !effectiveTimeWindow(effectiveTs, parsed.window, options.range, ctx)) continue;
        const nbs = new Set<string>([
          ...(sessionDims.sessionNotebooks?.get(s.id) ?? []),
          ...(sessionDims.noteNotebooks?.get(s.noteId) ?? []),
        ]);
        runs.push({
          resultId: s.id,
          noteId: s.noteId,
          timestamp: ts,
          ...(typeof s.duration === 'number' && Number.isFinite(s.duration) ? { durationMs: s.duration } : {}),
          events: [],
          summary: computeRowsRunSummary(
            {
              resultId: s.id,
              noteId: s.noteId,
              timestamp: ts,
              ...(typeof s.duration === 'number' && Number.isFinite(s.duration) ? { durationMs: s.duration } : {}),
              events: [],
            },
            {
              noteTitle: sessionDims.noteTitles?.get(s.noteId),
              notebooks: [...nbs],
              completed: s.completed,
            },
          ),
        });
      }
      runs.sort((a, b) => b.timestamp - a.timestamp);
    }
    const selectedSessionCount = Math.max(groups.length, runs.length);
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
      stages: { selected: selectedSessionCount, matched: runs.length },
    };
  }

  /**
   * Execute a :segment or :event query (#1042/#1048) — flat cross-workout table.
   */
  async runFindTable(parsed: ParsedFindQuery, options: FindOptions = {}): Promise<FindQueryResult> {
    const ctx = runContext(options);
    const posScopeValues = (key: string) =>
      parsed.filters.filter((f) => f.key === key && !f.negate).flatMap((f) => f.values.map((v) => v.value));
    const scopeFilters = parsed.filters.filter((f) => ['result', 'block', 'note'].includes(f.key));
    const resultIds = posScopeValues('result');
    const blockIds = posScopeValues('block');
    const noteIds = posScopeValues('note');

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

    const matchesRowScope = (row: EventRecord): boolean => {
      const negScopeFilters = scopeFilters.filter((f) => f.negate);
      for (const f of negScopeFilters) {
        const actual = f.key === 'result' ? row.resultId : f.key === 'block' ? row.blockContentId : row.noteId;
        if (actual !== undefined && f.values.some((v) => v.wildcard ? actual.startsWith(v.value) : actual === v.value)) {
          return false;
        }
      }
      return true;
    };

    const seen = new Set<string>();
    const eligibleRecords: EventRecord[] = [];
    for (const row of eventRows) {
      if (row.grain !== 'event') continue;
      if (parsed.target === 'segment' && row.outputType !== 'segment') continue;
      if (!matchesRowScope(row)) continue;
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

    const pipes = parsed.pipes;
    const selectColsExplicit = pipes?.select?.map((s) => s.col);
    const wantsNoteMetaCols =
      (selectColsExplicit?.some((c) => c === 'noteTitle' || c === 'notebook' || c === 'note') ?? false);
    const rawTagFilters = parsed.filters.filter((f) => !['result', 'block', 'note', 'plane'].includes(f.key));
    const tagFilters = rawTagFilters.map((f) => (f.key === 'tag' ? { ...f, key: 'tags' } : f));
    const tableDims = eligibleRecords.length > 0 && (tagFilters.length > 0 || wantsNoteMetaCols || parsed.groupBy?.some((g) => g === 'notebook' || g === 'noteTitle'))
      ? await this.loadFactDimensions(
          eligibleRecords.map((r) => ({ resultId: r.resultId, noteId: r.noteId, effortSlug: r.effortSlug } as AnalyticsDataPoint)),
          tagFilters,
          [...(parsed.groupBy ?? []), ...(wantsNoteMetaCols ? ['notebook', 'noteTitle'] : [])],
        )
      : EMPTY_FACT_DIMS;
    // C1 + ticket 12: the fetch bound is only a cutoff — scoped and windowed
    // queries alike filter membership by the row's own temporal anchor.
    const timeScoped = !!(parsed.window || options.range);
    const eligible = eligibleRecords
      .filter((row) => !timeScoped || effectiveTimeWindow(anchorTs(row), parsed.window, options.range, ctx))
      .filter((row) => {
        if (tagFilters.length === 0) return true;
        const facts = projectEventToFacts(row);
        if (facts.length === 0) {
          // Allow matching notebook / effort directly on zero-metric event rows
          const dummy = { resultId: row.resultId, noteId: row.noteId, effortSlug: row.effortSlug } as AnalyticsDataPoint;
          return matchesFilters(dummy, tagFilters, tableDims);
        }
        return facts.some((fact) => matchesFilters(fact, tagFilters, tableDims));
      });

    const totalCount = eligible.length;

    const unitByMetric = new Map<string, string>();
    const numericMetrics = new Set<string>();
    const sessionT0 = new Map<string, number>();
    const sessionSplitCount = new Map<string, number>();
    const splitIndexByRowId = new Map<string, number>();
    const sessionRpeByResult = new Map<string, number>();

    for (const row of eventRows) {
      for (const m of row.metrics ?? []) {
        if ((m.type === MetricType.SessionRPE || m.type === 'session-rpe' || m.type === 'session_rpe') && typeof m.value === 'number') {
          sessionRpeByResult.set(row.resultId, m.value);
        }
      }
      if (row.timeSpan?.started !== undefined) {
        const cur = sessionT0.get(row.resultId);
        if (cur === undefined || row.timeSpan.started < cur) {
          sessionT0.set(row.resultId, row.timeSpan.started);
        }
      }
    }

    for (const row of eligible) {
      const nextSplit = (sessionSplitCount.get(row.resultId) ?? 0) + 1;
      sessionSplitCount.set(row.resultId, nextSplit);
      splitIndexByRowId.set(row.id, nextSplit);
      for (const m of visibleRowMetrics(row.metrics)) {
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

    const selectCols = selectColsExplicit ?? [
      'date', 'effort', 'discipline', ...numericMetrics,
    ];
    const stringColSet = new Set(['effort', 'discipline', 'note', 'noteTitle', 'notebook', 'origin', 'grade', 'intensity']);
    const virtualNumUnits: Record<string, string | undefined> = {
      elapsed: 'ms',
      offset: 'ms',
      round: undefined,
      split: undefined,
      rpe: undefined,
    };
    const unitFor = (col: string): string | undefined => {
      const selectDirective = pipes?.select?.find((s) => s.col === col)?.unit;
      if (selectDirective) return selectDirective;
      const baseUnit = col in virtualNumUnits ? virtualNumUnits[col] : unitByMetric.get(col);
      if (parsed.displayUnit && baseUnit) {
        const dispDim = dimensionKeyOf(parsed.displayUnit);
        const baseDim = dimensionKeyOf(baseUnit);
        if (dispDim && baseDim && dispDim === baseDim) return parsed.displayUnit;
      }
      return baseUnit;
    };

    const columns: TabularColumn[] = selectCols.map((col) => {
      if (col === 'date') return { name: 'date', type: 'date' as const };
      if (stringColSet.has(col)) return { name: col, type: 'string' as const };
      const colUnit = unitFor(col);
      return { name: col, type: 'number' as const, ...(colUnit ? { unit: colUnit } : {}) };
    });

    const typeOf = new Map(columns.map((c) => [c.name, c.type]));
    const targetUnitOf = new Map(columns.map((c) => [c.name, c.unit]));

    const offset = pipes?.offset ?? 0;
    const limit = pipes?.limit;
    const hasOrder = Boolean(pipes?.order && pipes.order.length > 0);
    const hasGroupBy = Boolean(parsed.groupBy && parsed.groupBy.length > 0);
    const canSliceBeforeProject = !hasOrder && !hasGroupBy && (limit !== undefined || offset > 0);
    const rowsToProject = canSliceBeforeProject
      ? (limit !== undefined ? eligible.slice(offset, offset + limit) : eligible.slice(offset))
      : eligible;

    let records = rowsToProject.map((row) => {
      const record: Record<string, unknown> = {};
      const visMetrics = visibleRowMetrics(row.metrics);
      const cellOrigins: Record<string, string> = {};
      const cellUnits: Record<string, string> = {};

      for (const m of visMetrics) {
        if (!m.type) continue;
        const canon = typeof m.metadata?.canonicalKey === 'string' ? m.metadata.canonicalKey : m.type;
        if (m.origin) {
          cellOrigins[m.type] = m.origin;
          cellOrigins[canon] = m.origin;
        }
        if (m.unit) {
          cellUnits[m.type] = m.unit;
          cellUnits[canon] = m.unit;
        }
      }

      const convertCell = (col: string, val: number, fromUnit: string | undefined): number => {
        const desired = targetUnitOf.get(col);
        if (desired && fromUnit && fromUnit !== desired) {
          const fromDim = dimensionKeyOf(fromUnit);
          const toDim = dimensionKeyOf(desired);
          if (fromDim && toDim && fromDim === toDim) {
            try {
              return convertViaCatalog(val, fromUnit, desired);
            } catch {
              return val;
            }
          }
        }
        return val;
      };

      for (const col of selectCols) {
        const type = typeOf.get(col);
        if (type === 'date') {
          record.date = dateOf(row);
        } else if (col === 'effort') {
          record.effort = row.effortSlug;
        } else if (col === 'discipline') {
          const m = visMetrics.find((m) => m.metadata?.effortDiscipline);
          record.discipline = m?.metadata?.effortDiscipline;
        } else if (col === 'note') {
          record.note = row.noteId;
        } else if (col === 'noteTitle') {
          record.noteTitle = tableDims.noteTitles?.get(row.noteId);
        } else if (col === 'notebook') {
          const nbs = tableDims.noteNotebooks?.get(row.noteId) ?? [];
          record.notebook = nbs[0];
        } else if (col === 'origin') {
          record.origin = visMetrics.some((m) => m.origin === 'user') ? 'user' : row.origin;
        } else if (col === 'rpe') {
          record.rpe = sessionRpeByResult.get(row.resultId);
        } else if (col === 'split') {
          record.split = splitIndexByRowId.get(row.id);
        } else if (col === 'round') {
          const rMetric = visMetrics.find(
            (m) => m.type === 'current-round' || m.type === 'rounds' || m.metadata?.canonicalKey === 'currentRound' || m.metadata?.canonicalKey === 'rounds',
          );
          record.round = typeof rMetric?.value === 'number' ? Math.round(rMetric.value) : undefined;
        } else if (col === 'elapsed') {
          const rawMs = row.timeSpan?.ended !== undefined && row.timeSpan?.started !== undefined
            ? Math.max(0, row.timeSpan.ended - row.timeSpan.started)
            : undefined;
          if (rawMs !== undefined) {
            record.elapsed = convertCell('elapsed', rawMs, 'ms');
          } else {
            const m = visMetrics.find((m) => m.type === 'elapsed' || m.metadata?.canonicalKey === 'elapsed' || m.type === 'duration');
            record.elapsed = typeof m?.value === 'number' ? convertCell('elapsed', m.value, m.unit ?? 's') : undefined;
          }
        } else if (col === 'offset') {
          const t0 = sessionT0.get(row.resultId);
          if (t0 !== undefined && row.timeSpan?.started !== undefined) {
            record.offset = convertCell('offset', Math.max(0, row.timeSpan.started - t0), 'ms');
          } else {
            record.offset = undefined;
          }
        } else if (col === 'grade') {
          const g = visMetrics.find((m) => m.type === 'grade' || m.metadata?.grade);
          record.grade = g ? (typeof g.value === 'string' ? g.value : g.metadata?.grade) : undefined;
        } else if (col === 'intensity') {
          const m = visMetrics.find((m) => m.metadata?.effortIntensityTier);
          record.intensity = m?.metadata?.effortIntensityTier;
        } else {
          const m = visMetrics.find(
            (m) => m.type === col || m.metadata?.canonicalKey === col || (col === 'reps' && m.type === 'rep') || (col === 'rep' && m.type === 'reps'),
          );
          if (m && typeof m.value === 'number') {
            record[col] = convertCell(col, m.value, m.unit);
          } else {
            record[col] = m ? m.value : undefined;
          }
        }
      }
      record.__id = row.id;
      record.__resultId = row.resultId;
      record.__noteId = row.noteId;
      if (row.blockId) record.__blockId = row.blockId;
      if (row.blockContentId) record.__blockContentId = row.blockContentId;
      if (row.sourceBlockKey) record.__sourceBlockKey = row.sourceBlockKey;
      if (row.sourceStatementId !== undefined) record.__sourceStatementId = row.sourceStatementId;
      if (row.stackLevel !== undefined) record.__stackLevel = row.stackLevel;
      if (row.line !== undefined) record.__line = row.line;
      if (row.timeSpan) record.__timeSpan = row.timeSpan;
      record.__cellOrigins = cellOrigins;
      record.__cellUnits = cellUnits;
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

    const page = canSliceBeforeProject
      ? records
      : (limit !== undefined ? records.slice(offset, offset + limit) : records.slice(offset));
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
    const bound = bindQueryParams(parsed, options.params ?? {});
    if (bound.missing.length > 0) {
      const errored: ParsedFindQuery = { ...parsed, error: unknownTokensMessage(bound.missing) };
      return { parsed: errored, notes: [], blocks: [], stages: { selected: 0, matched: 0 } };
    }
    if (bound.parsed.family === 'find') {
      parsed = bound.parsed;
      if (parsed.error) {
        return { parsed, notes: [], blocks: [], stages: { selected: 0, matched: 0 } };
      }
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
    if (parsed.target === 'feed') {
      return this.runFindFeed(parsed, options);
    }
    // Domain candidate read: selection (source clauses + the explicit source
    // fence) narrows before the wire's selectedCount; compiled positive
    // literal type/id clauses ride as post-count FILTERS — never selection —
    // so the wire count baselines the historical pre-filter stages.selected.
    const read = compileContentRead(parsed.filters, 'note', parsed.sourceScope);
    const paging = domainPaging(parsed, options, read.residual);
    const fetchedNotes = this.noteStore.queryDomain
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
    // When the source scope stayed residual (journal/all), the wire's
    // selectedCount baselines the pre-scope population — the JS selection
    // stages over the complete, unpaged candidates are the truthful count.
    const selectedCount = selectedFromDomain !== undefined && !read.scopeResidual
      ? selectedFromDomain
      : notes.length;
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

    notes = applyNotebookFilter(notes, parsed.filters, !parsed.raw.startsWith(':notebook'));
    // Zero-import remote preview fallback: after `applyNotebookFilter` narrows local notes,
    // if the requested `notebook:<slug>` has zero local rows, fetch its lightweight index records.
    if (notes.length === 0 && this.feedCatalogStore?.getRemoteNotebookNotes) {
      const posNbFilter = parsed.filters.find((f) => f.key === 'notebook' && !f.negate && f.values.length === 1 && !f.values[0]!.wildcard);
      const subFilter = parsed.filters.find((f) => f.key === 'subscribed' && !f.negate);
      const explicitlySubscribedOnly =
        subFilter !== undefined &&
        subFilter.values.some((v) => v.value === 'true') &&
        !subFilter.values.some((v) => v.value === 'false');
      if (posNbFilter && !explicitlySubscribedOnly) {
        const wantedSlug = notebookSlugFromId(posNbFilter.values[0]!.value);
        const posFeedFilter = parsed.filters.find((f) => f.key === 'feed' && !f.negate && f.values.length === 1 && !f.values[0]!.wildcard);
        let remoteNotes = await this.feedCatalogStore.getRemoteNotebookNotes(
          wantedSlug,
          posFeedFilter?.values[0]?.value,
        );
        for (const filter of parsed.filters) {
          if (filter.key === 'text') {
            const search = filter.values.map((v) => v.value).join(' ').toLowerCase();
            remoteNotes = remoteNotes.filter((n) => {
              const hit = n.title.toLowerCase().includes(search);
              return filter.negate ? !hit : hit;
            });
          }
        }
        if (remoteNotes.length > 0) {
          notes = remoteNotes;
        }
      }
    }
    const isSubscribedFn = options.isNotebookSubscribed ?? this.isNotebookSubscribed ?? (() => true);

    // feed: filter
    for (const filter of parsed.filters) {
      if (filter.key === 'feed') {
        notes = notes.filter(n => {
          const fid = feedIdOfItem(n);
          const hit = filter.values.some(v => matchesFeedFilterValue(fid, v));
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
    // Relations resolve BEFORE the cut when a window is active: an undated
    // note's journal-page placement supplies its effective timestamp, so the
    // cut needs placements for candidates that would otherwise fall outside
    // on createdAt alone. The maps are pruned to survivors below.
    const wantsRelations = !options.skipContainers && notes.length > 0 && Boolean(this.pageStore || this.relationStore);
    let relations: NoteRelations | undefined;
    if ((parsed.window || options.range) && wantsRelations) {
      relations = await this.containersAndPlacements(notes);
    }
    if (parsed.window || options.range) {
      const schedulesByNote = new Map<string, ScheduleItem[]>();
      if (this.scheduleStore) {
        const allSchedules = await this.scheduleStore.getAll();
        for (const item of allSchedules) {
          const bucket = schedulesByNote.get(item.noteId);
          if (bucket) bucket.push(item);
          else schedulesByNote.set(item.noteId, [item]);
        }
      }
      notes = notes.filter(n =>
        noteEffectiveTimestamps(n, relations?.placements[n.id], schedulesByNote.get(n.id), ctx.timeZone)
          .some(ts => effectiveTimeWindow(ts, parsed.window, options.range, ctx)));
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

    if (!relations && !options.skipContainers && notes.length && (this.pageStore || this.relationStore)) {
      relations = await this.containersAndPlacements(notes);
    }
    if (relations) {
      // Relations were computed over the pre-window candidates when a window
      // ran — prune maps to the surviving notes.
      const surviving = new Set(notes.map((n) => n.id));
      relations = {
        containers: Object.fromEntries(Object.entries(relations.containers).filter(([id]) => surviving.has(id))),
        placements: Object.fromEntries(Object.entries(relations.placements).filter(([id]) => surviving.has(id))),
        typedTags: Object.fromEntries(Object.entries(relations.typedTags).filter(([id]) => surviving.has(id))),
      };
    }
    return {
      parsed,
      notes,
      blocks: [],
      ...(relations
        ? {
            containers: relations.containers,
            placements: relations.placements,
            ...(Object.keys(relations.typedTags).length > 0 ? { typedTags: relations.typedTags } : {}),
          }
        : {}),
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
  private async containersAndPlacements(notes: Note[]): Promise<NoteRelations> {
    const containers: Record<string, NoteContainer> = {};
    const placements: Record<string, NotePlacement[]> = {};
    const typedTags: Record<string, Array<{ label: string; type?: string }>> = {};
    const bundles = this.relationStore
      ? await this.relationStore.getBatches([...new Set(notes.map((n) => n.id))])
      : undefined;
    // When relationStore is absent but pageStore exposes bulk reads, fetch all
    // links and pages in 2 reads instead of N+1 sequential per-note lookups.
    let bulkLinksByNote: Map<string, PageNote[]> | undefined;
    let bulkPagesById: Map<string, Page> | undefined;
    if (!bundles && notes.length > 1 && this.pageStore?.getAllLinks && this.pageStore?.getAllPages) {
      const [allLinks, allPages] = await Promise.all([
        this.pageStore.getAllLinks(),
        this.pageStore.getAllPages(),
      ]);
      bulkLinksByNote = new Map<string, PageNote[]>();
      for (const link of allLinks) {
        const list = bulkLinksByNote.get(link.noteId);
        if (list) list.push(link);
        else bulkLinksByNote.set(link.noteId, [link]);
      }
      bulkPagesById = new Map<string, Page>(allPages.map((p) => [p.id, p]));
    }
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
        if (bundle && bundle.tags.length > 0) {
          typedTags[note.id] = bundle.tags.map((t) => ({ label: t.label, ...(t.type ? { type: t.type } : {}) }));
          if (!note.tags || note.tags.length === 0) {
            note.tags = bundle.tags.map((t) => t.label);
          }
        }
      } else if (bulkLinksByNote && bulkPagesById) {
        const links = bulkLinksByNote.get(note.id) ?? [];
        const pages: Page[] = [];
        for (const link of links) {
          const page = bulkPagesById.get(link.pageId);
          if (page) pages.push(page);
        }
        resolved = resolvePlacements(links, pages);
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
    return { containers, placements, typedTags };
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
        blocks = blocks.filter(b => {
          const fid = feedIdOfItem(b);
          const hit = filter.values.some(v => matchesFeedFilterValue(fid, v));
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
    const bound = bindQueryParams(parsed, options.params ?? {});
    if (bound.missing.length > 0) {
      const err = unknownTokensMessage(bound.missing);
      return { ...empty, parsed: { ...parsed, error: err }, error: err };
    }
    if (bound.parsed.family === 'aggregate') {
      parsed = bound.parsed;
    }
    if (parsed.error) return { ...empty, parsed, error: parsed.error };

    // Cross-store join: reads stored summary rows over the content index —
    // the store is authoritative (finalize-owns, ticket 005).
    if (parsed.join) return this.runJoined(parsed, options);

    if (parsed.agg === 'count' && parsed.metric === 'note') {
      return this.runNoteCountAggregate(parsed, options);
    }

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

  private async runNoteCountAggregate(
    parsed: ParsedAggregateQuery,
    options: QueryOptions,
  ): Promise<QueryResult> {
    const ctx = runContext(options);
    const range = resolveAggregateRange(parsed, options, ctx);
    const findQuery: ParsedFindQuery = {
      family: 'find',
      raw: parsed.raw,
      target: 'note',
      filters: parsed.filters,
      ...(parsed.window ? { window: parsed.window } : {}),
    };
    const findRes = await this.runFind(findQuery, {
      context: ctx,
      ...(range ? { range } : {}),
    });

    const points: AnalyticsDataPoint[] = findRes.notes.map((note) => {
      const ts = noteEffectiveTimestamp(note, findRes.placements?.[note.id], ctx.timeZone);
      const itemOrigin = notebookOriginOfItem(note);
      const dimensions: Record<string, string> = {};
      if (note.type) dimensions.type = note.type;
      if (itemOrigin) dimensions.origin = itemOrigin;
      if (note.sourceId) dimensions.notebook = note.sourceId;
      return {
        id: note.id,
        noteId: note.id,
        blockId: '',
        blockVersion: 0,
        resultId: note.id,
        type: 'note',
        label: note.title || note.id,
        metricKey: 'note',
        value: 1,
        grain: 'event',
        timestamp: ts,
        createdAt: note.createdAt,
        metricDate: civilDateOf(ts, ctx.timeZone),
        ...(itemOrigin === 'user' ? { origin: 'user' as const } : {}),
        ...(Object.keys(dimensions).length > 0 ? { dimensions } : {}),
      };
    });

    const factDims = await this.loadFactDimensions(points, [], parsed.groupBy);
    return this.buildResult(points, parsed, options, factDims, range);
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
    const bound = bindQueryParams(query, options.params ?? {});
    if (bound.missing.length > 0) {
      const err = unknownTokensMessage(bound.missing);
      return { ...empty, parsed: { ...query, error: err }, error: err };
    }
    if (bound.parsed.family === 'aggregate') {
      query = bound.parsed;
    }
    if (query.error) return { ...empty, parsed: query, error: query.error };
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
    let pipeline: ParsedPipelineQuery = parsed;
    const fail = (error: string): PipelineResult => ({ parsed: pipeline, error });
    if (pipeline.error) return fail(pipeline.error);
    const bound = bindQueryParams(pipeline, options.params ?? {});
    if (bound.missing.length > 0) return fail(unknownTokensMessage(bound.missing));
    if (bound.parsed.family === 'pipeline') {
      pipeline = bound.parsed;
      if (pipeline.error) return fail(pipeline.error);
    }

    let content: FindQueryResult | undefined;
    let carried: QueryResult | undefined;
    let sourceEvents: EventRecord[] | undefined;
    let datasetNotes: Note[] = [];

    if (pipeline.source.kind === 'dataset') {
      const name = pipeline.source.name;
      const dataset = options.pageSources?.get(name) ?? this.datasetStore?.getDataset(name);
      if (!dataset) return fail(`Unknown dataset "${name}" — the host must register it before the query runs.`);
      sourceEvents = dataset.events;
      datasetNotes = dataset.notes;
    } else if (isFindQuery(pipeline.source.query)) {
      const q = pipeline.source.query;
      content = await this.runFind(q, {
        context: options.context,
        skipContainers: pipeline.transforms.length > 0,
        ...((options.rangeStart !== undefined || options.rangeEnd !== undefined)
          ? { range: { start: options.rangeStart ?? 0, end: options.rangeEnd ?? Number.MAX_SAFE_INTEGER, endExclusive: false } }
          : {}),
      });
      if (q.error) return fail(q.error);
    } else {
      carried = await this.run(pipeline.source.query, options);
      if (pipeline.source.query.error) return fail(pipeline.source.query.error);
    }

    if (pipeline.transforms.length === 0) {
      // Source-only pipeline (optionally with a chart sink) — the stage
      // result surfaces as-is, no event resolution.
      if (content) {
        return {
          parsed: pipeline,
          ...(content.notes.length ? { notes: content.notes } : {}),
          ...(content.blocks.length ? { blocks: content.blocks } : {}),
          ...(content.efforts?.length ? { efforts: content.efforts } : {}),
          ...(content.runs?.length ? { runs: content.runs } : {}),
          ...(content.table ? { table: content.table } : {}),
          ...(content.containers ? { containers: content.containers } : {}),
          ...(content.placements ? { placements: content.placements } : {}),
          ...(pipeline.sink ? { chart: pipeline.sink } : {}),
        };
      }
      if (pipeline.source.kind === 'dataset') {
        // Dataset alone — its notes are the surface; telemetry flows only
        // through transforms.
        return { parsed: pipeline, notes: datasetNotes, ...(pipeline.sink ? { chart: pipeline.sink } : {}) };
      }
      return {
        parsed: pipeline,
        ...(carried
          ? { series: carried.series, ...(carried.unit ? { unit: carried.unit } : {}), ...(carried.error ? { error: carried.error } : {}) }
          : {}),
        ...(pipeline.sink ? { chart: pipeline.sink } : {}),
      };
    }

    if (!carried) {
      if (!sourceEvents && content) sourceEvents = await this.sourceEventsFromFind(content);
      carried = await this.runAggregateEvents(pipeline.transforms[0]!, sourceEvents ?? [], options);
      for (const transform of pipeline.transforms.slice(1)) {
        if (carried.error) break; // an errored stage stops the pipeline
        carried = reduceCarriedResult(carried, transform, options, runContext(options));
      }
    } else {
      for (const transform of pipeline.transforms) {
        if (carried.error) break; // an errored stage stops the pipeline
        carried = reduceCarriedResult(carried, transform, options, runContext(options));
      }
    }
    return {
      parsed: pipeline,
      series: carried.series,
      ...(carried.unit ? { unit: carried.unit } : {}),
      ...(carried.error ? { error: carried.error } : {}),
      ...(pipeline.sink ? { chart: pipeline.sink } : {}),
    };
  }
  /**
   * Evaluate pipeline tail stages (`:sum{…} | :bar{…}`) over an already-fetched
   * `FindQueryResult` (or `FamilyRunPayload`). Resolves and caches `content.events`
   * on the first call so multiple downstream named branches (`kb = bench | :sum{…}`,
   * `bb = bench | :sum{…}`) share the exact `EventRecord[]` slice in memory.
   */
  async runPipelineFromFind(
    content: { notes?: Note[]; blocks?: BlockIndexRow[]; events?: EventRecord[]; runs?: RowsRun[]; table?: TabularResult },
    pipeTail: string,
    options: PipelineOptions = {},
  ): Promise<PipelineResult> {
    const synthetic = parseQuery(`:segment{} | ${pipeTail}`);
    if (!isPipelineQuery(synthetic) || synthetic.error) {
      const error = synthetic.error ?? `Invalid pipeline tail: "${pipeTail}"`;
      return { parsed: { family: 'pipeline', raw: pipeTail, source: { kind: 'dataset', name: '' }, transforms: [], error }, error };
    }
    if (!content.events) {
      content.events = await this.sourceEventsFromFind({
        parsed: { family: 'find', raw: '', target: 'note', filters: [] },
        notes: content.notes ?? [],
        blocks: content.blocks ?? [],
        stages: { selected: 0, matched: 0 },
      });
    }
    const sourceEvents = content.events;
    if (synthetic.transforms.length === 0) {
      return {
        parsed: synthetic,
        ...(content.notes?.length ? { notes: content.notes } : {}),
        ...(content.blocks?.length ? { blocks: content.blocks } : {}),
        ...(content.runs?.length ? { runs: content.runs } : {}),
        ...(content.table ? { table: content.table } : {}),
        ...(synthetic.sink ? { chart: synthetic.sink } : {}),
      };
    }
    let carried = await this.runAggregateEvents(synthetic.transforms[0]!, sourceEvents, options);
    for (const transform of synthetic.transforms.slice(1)) {
      if (carried.error) break;
      carried = reduceCarriedResult(carried, transform, options, runContext(options));
    }
    return {
      parsed: synthetic,
      series: carried.series,
      ...(carried.unit ? { unit: carried.unit } : {}),
      ...(carried.error ? { error: carried.error } : {}),
      ...(synthetic.sink ? { chart: synthetic.sink } : {}),
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
    const factTime = (row: AnalyticsDataPoint): number => {
      if (row.metricDate) return zonedNoon(row.metricDate, ctx.timeZone);
      return row.timestamp;
    };

    const metricFilter = parsed.metric ? { metricKey: parsed.metric } : undefined;
    const candidates = eventRows
      .flatMap((row) => projectEventToFacts(row, metricFilter))
      .filter((row) => !range || inRange(factTime(row), range));
    const factDims = await this.loadFactDimensions(candidates, parsed.filters, parsed.groupBy);
    // Ticket 16: no global effort suppression — coverage selection below
    // keeps every population represented exactly once.
    const matched = candidates.filter((row) => matchesFilters(row, parsed.filters, factDims));

    const { selected, report } = selectContributions(matched, parsed.agg);
    return this.buildResult(selected, parsed, options, factDims, range, report);
  }

  /**
   * Stages 2–4 — BUCKET → GROUP → AGGREGATE over an already-selected +
   * filtered `matched` set.
   */
  private buildResult(
    matched: AnalyticsDataPoint[],
    parsed: ParsedAggregateQuery,
    options: QueryOptions,
    noteTags: FactDimensionContext | ReadonlyMap<string, readonly string[]>,
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
    const timeDim = parsed.groupBy.find((d) => d === 'day' || d === 'week' || d === 'month');
    const tagDims = parsed.groupBy.filter((d) => d !== 'day' && d !== 'week' && d !== 'month');
    const rollup = parsed.rollup;

    /** The observation's own temporal anchor: its recorded metric date when
     *  it carries one (date-only facts keep their civil date), else the
     *  fact timestamp's civil date in the context timezone. */
    const anchorDate = (row: AnalyticsDataPoint): string =>
      row.metricDate ?? civilDateOf(row.timestamp, ctx.timeZone);
    const bucketKey = (row: AnalyticsDataPoint): string => {
      if (timeDim === 'day') return `d:${anchorDate(row)}`;
      if (timeDim === 'week') return `w:${civilMonday(anchorDate(row))}`;
      if (timeDim === 'month') return `m:${civilMonthStart(anchorDate(row))}`;
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
      if (key.startsWith('d:') || key.startsWith('w:') || key.startsWith('m:')) return zonedNoon(key.slice(2), ctx.timeZone);
      return Number.MAX_SAFE_INTEGER;
    };

    // Chronological bucket domain (ticket 12): bounded calendar queries
    // generate every period in the requested bounds — including empty ones;
    // unbounded sides use the observed extent; relative windows never
    // generate future buckets because their exclusive end is the captured
    // instant. No domain generation for rollup (duration buckets are
    // observed-only) or ungrouped queries.
    const MAX_DOMAIN = 10_000;
    const bareDate = (key: string): string => (key.startsWith('d:') || key.startsWith('w:') || key.startsWith('m:') ? key.slice(2) : key);
    const calendarDomain = (observed: string[]): string[] => {
      const activeDim = timeDim ?? (rollup?.unit === 'w' ? 'week' : rollup?.unit === 'd' ? 'day' : undefined);
      if (!activeDim || observed.length === 0) return observed;
      const bounds = range && range.end !== Number.MAX_SAFE_INTEGER
        ? {
            startIso: civilDateOf(range.start, ctx.timeZone),
            endIso: range.endExclusive ? civilDateOf(range.end - 1, ctx.timeZone) : civilDateOf(range.end, ctx.timeZone),
          }
        : { startIso: bareDate(observed[0]!), endIso: bareDate(observed[observed.length - 1]!) };
      const first =
        activeDim === 'month'
          ? civilMonthStart(bounds.startIso)
          : activeDim === 'week'
            ? civilMonday(bounds.startIso)
            : bounds.startIso;
      const last =
        activeDim === 'month'
          ? civilMonthStart(bounds.endIso)
          : activeDim === 'week'
            ? civilMonday(bounds.endIso)
            : bounds.endIso;
      const step = activeDim === 'week' ? 7 * (rollup?.size ?? 1) : (rollup?.size ?? 1);
      const span = civilDateDiff(first, last);
      if (span < 0 || (activeDim !== 'month' && span / step > MAX_DOMAIN)) return observed;
      const domain: string[] = [];
      for (
        let cursor = first;
        domain.length <= MAX_DOMAIN;
        cursor = activeDim === 'month' ? civilMonthAdd(cursor, 1) : civilDateAdd(cursor, step)
      ) {
        domain.push(
          activeDim === 'month'
            ? `m:${cursor}`
            : activeDim === 'week'
              ? `w:${cursor}`
              : `d:${cursor}`,
        );
        if (cursor >= last) break;
      }
      return domain;
    };

    // Output unit (ticket 13): explicit `in <unit>` directive wins when
    // dimensionally compatible; otherwise preserves consistent ratio/count scale
    // (`pts`, `AU`, `%`, `reps`), applies preferred when same dimension, or system default.
    const unitResolution = resolveOutputUnit(matched, {
      directive: parsed.displayUnit,
      preferred: options.preferredUnit,
      metric: parsed.metric,
    });
    const targetUnit = unitResolution.unit;
    const shouldConvert = unitResolution.convert;
    const seriesError = unitResolution.error;

    const dimCtx = resolveDimensionContext(noteTags);
    // Enrich ordinal split / attempt dimensions lazily when grouped by them.
    if (tagDims.includes('split')) {
      const counts = new Map<string, number>();
      const ordered = [...matched].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
      for (const row of ordered) {
        if (!row.dimensions?.split) {
          const n = (counts.get(row.resultId) ?? 0) + 1;
          counts.set(row.resultId, n);
          row.dimensions = { ...(row.dimensions ?? {}), split: String(n) };
        }
      }
    }
    if (tagDims.includes('attempt')) {
      const byBlock = new Map<string, Array<{ resultId: string; ts: number }>>();
      for (const row of matched) {
        const key = row.blockContentId || row.noteId;
        const arr = byBlock.get(key) ?? [];
        if (!arr.some((x) => x.resultId === row.resultId)) {
          arr.push({ resultId: row.resultId, ts: row.timestamp });
          byBlock.set(key, arr);
        }
      }
      const attemptByResult = new Map<string, number>();
      for (const arr of byBlock.values()) {
        arr.sort((a, b) => a.ts - b.ts);
        arr.forEach((item, idx) => attemptByResult.set(item.resultId, idx + 1));
      }
      for (const row of matched) {
        if (!row.dimensions?.attempt) {
          const att = attemptByResult.get(row.resultId);
          if (att !== undefined) row.dimensions = { ...(row.dimensions ?? {}), attempt: String(att) };
        }
      }
    }

    const formatDimLabel = (dim: string, val: string, rows: readonly AnalyticsDataPoint[]): string => {
      if (val === UNASSIGNED) return 'unassigned';
      if (dim === 'session') {
        const first = rows[0];
        const title = first ? dimCtx.noteTitles?.get(first.noteId) : undefined;
        let shortDate = '';
        if (first) {
          try {
            shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: ctx.timeZone }).format(new Date(first.timestamp));
          } catch {
            shortDate = civilDateOf(first.timestamp, ctx.timeZone);
          }
        }
        const tail = title?.trim() ? title.trim() : val.slice(0, 8);
        return shortDate ? `${shortDate} · ${tail}` : tail;
      }
      if (dim === 'notebook') {
        return notebookSlugFromId(val);
      }
      return val;
    };

    const ORDINAL_AXIS_DIMS = new Set(['round', 'split', 'attempt']);
    const candidateOrdinalDim = !timeDim && !rollup
      ? tagDims.find((d) => ORDINAL_AXIS_DIMS.has(d))
      : undefined;
    const hasResolvedOrdinal = candidateOrdinalDim
      ? matched.some((r) => dimValue(r, candidateOrdinalDim, noteTags, ctx) !== UNASSIGNED) || tagDims.length > 1
      : false;
    const ordinalDim = hasResolvedOrdinal ? candidateOrdinalDim : undefined;
    const seriesTagDims = ordinalDim ? tagDims.filter((d) => d !== ordinalDim) : tagDims;

    // Stage 3+4: GROUP + AGGREGATE per bucket. Group identity (ticket 16)
    // is the canonical ordered tuple of resolved dimension values, JSON
    // encoded — delimiter-containing labels cannot collide; a missing
    // dimension resolves to the structural UNASSIGNED sentinel (distinct
    // from any literal text). The display label is derived, never identity.
    const groups = new Map<string, { label: string; rows: AnalyticsDataPoint[] }>();
    for (const row of matched) {
      const tuple = seriesTagDims.map((d) => dimValue(row, d, noteTags, ctx));
      const key = seriesTagDims.length ? JSON.stringify(tuple) : parsed.metric;
      const bucket = groups.get(key);
      if (bucket) bucket.rows.push(row);
      else {
        const label = seriesTagDims.length
          ? tuple.map((v, i) => formatDimLabel(seriesTagDims[i]!, v, [row])).join(' · ')
          : parsed.metric;
        groups.set(key, { label, rows: [row] });
      }
    }

    const globalOrdinalDomain = ordinalDim
      ? [...new Set(matched.map((r) => `ord:${dimValue(r, ordinalDim, noteTags, ctx)}`))].sort((a, b) => {
          const av = a.slice(4);
          const bv = b.slice(4);
          if (av === UNASSIGNED) return 1;
          if (bv === UNASSIGNED) return -1;
          const an = Number(av);
          const bn = Number(bv);
          if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
          return av.localeCompare(bv, undefined, { numeric: true });
        })
      : undefined;

    const series: Series[] = [...groups.entries()].map(([key, group]) => {
      const rows = group.rows;
      if (seriesError) {
        return { key, label: group.label, points: [], unit: undefined, error: seriesError };
      }
      const byBucket = new Map<string, AnalyticsDataPoint[]>();
      for (const row of rows) {
        const b = ordinalDim
          ? `ord:${dimValue(row, ordinalDim, noteTags, ctx)}`
          : bucketKey(row);
        const members = byBucket.get(b);
        if (members) members.push(row);
        else byBucket.set(b, [row]);
      }
      const observedKeys = [...byBucket.keys()].sort();
      const domain = timeDim
        ? calendarDomain(observedKeys)
        : globalOrdinalDomain
          ? globalOrdinalDomain
          : observedKeys;
      let error: string | undefined;
      const points: SeriesPoint[] = domain.map((b, ordIdx) => {
        const members = byBucket.get(b);
        const ordRaw = b.startsWith('ord:') ? b.slice(4) : undefined;
        const ordDisplay = ordRaw === UNASSIGNED ? 'unassigned' : ordRaw;
        const ordMeta = ordinalDim && ordDisplay !== undefined
          ? {
              x: /^\d+$/.test(ordDisplay) ? Number(ordDisplay) : ordDisplay,
              label: /^\d+$/.test(ordDisplay)
                ? `${ordinalDim === 'split' ? 'Split' : ordinalDim === 'attempt' ? 'Run' : 'Rnd'} ${ordDisplay}`
                : ordDisplay,
            }
          : {};
        if (!members) {
          // Missing query position (ticket 12 domain + ticket 13 matrix):
          // zero-filled with absence provenance — never an observation.
          return {
            ts: ordinalDim ? ordIdx : bucketDisplayTs(b),
            ...ordMeta,
            value: 0,
            missing: true,
          };
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
          return { ts: ordinalDim ? ordIdx : bucketDisplayTs(b), ...ordMeta, value: 0, missing: true };
        }
        const reduced = aggregate(values, parsed.agg, members);
        if (reduced.state === 'error') {
          error = reduced.message;
          return { ts: ordinalDim ? ordIdx : bucketDisplayTs(b), ...ordMeta, value: 0, missing: true };
        }
        return {
          ts: ordinalDim
            ? ordIdx
            : timeDim || rollup
              ? bucketDisplayTs(b)
              : Math.min(...members.map((m) => m.timestamp)),
          ...ordMeta,
          // Unrounded — renderers format (ticket 13 precision policy).
          value: reduced.value,
          ...(reduced.state === 'absent' ? { missing: true } : {}),
        };
      });
      // `count` reduces to the count dimension regardless of input.
      // Output unit is the resolved one — count reduces to count; no
      // first-record fallback (ticket 13 cutover).
      const seriesUnit = parsed.agg === 'count' ? 'count' : targetUnit;
      return {
        key,
        label: group.label,
        points,
        unit: seriesUnit,
        ...(ordinalDim ? { axisKind: 'ordinal' as const, axisDimension: ordinalDim } : {}),
        ...(error ? { error } : {}),
      };
    });

    const aggregated = series.reduce((n, s) => n + s.points.length, 0);
    const scalar = series.length === 1 && series[0].points.length === 1 ? series[0].points[0].value : undefined;
    const resultUnit = series.length > 0 ? series[0].unit : undefined;
    const bucketCount = ordinalDim
      ? (series[0]?.points.length ?? 0)
      : timeDim || rollup
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
   *  blockContentIds or session resultIds owned by the find predicate's matches. */
  private async runJoined(parsed: ParsedAggregateQuery, options: QueryOptions): Promise<QueryResult> {
    const empty: QueryResult = {
      parsed, series: [], stages: { selected: 0, buckets: 0, aggregated: 0, groups: 0 }, matched: [],
    };
    const join = parsed.join as FindPredicate;
    const ctx = runContext(options);
    const findResult = await this.runFind({
      family: 'find',
      raw: '', target: join.target, filters: join.filters,
      window: join.last ? { kind: 'relative', size: join.last.size, unit: join.last.unit } : undefined,
    }, { context: ctx });

    let facts: AnalyticsDataPoint[];
    if (join.target === 'session' || join.target === 'segment' || join.target === 'event') {
      const matchedResultIds = new Set<string>();
      for (const r of findResult.runs ?? []) matchedResultIds.add(r.resultId);
      for (const e of findResult.events ?? []) matchedResultIds.add(e.resultId);
      if (findResult.table?.rows) {
        for (const row of findResult.table.rows) {
          if (typeof row.__resultId === 'string') matchedResultIds.add(row.__resultId);
        }
      }
      if (matchedResultIds.size === 0) return empty;
      const metricFilter = parsed.metric ? { metricKey: parsed.metric } : undefined;
      const bySession = await Promise.all(
        [...matchedResultIds].map((id) => this.store.getEventsByResult(id)),
      );
      const rawEvents = dedupeById(
        [...bySession.flat(), ...(findResult.events ?? [])],
      );
      facts = dedupeById(
        rawEvents.flatMap((row) => projectEventToFacts(row, metricFilter)),
      );
    } else {
      const contentIds = await this.contentIdsFromFindResult(findResult);
      if (contentIds.size === 0) return empty;
      facts = dedupeById(await this.deriveMetricFacts(contentIds, parsed.metric));
    }

    const joinRange = resolveAggregateRange(parsed, options, ctx);
    if (joinRange) {
      facts = facts.filter(f => inRange(f.timestamp, joinRange));
    }

    const factDims = await this.loadFactDimensions(facts, parsed.filters, parsed.groupBy);
    const matched = facts.filter((f) => matchesFilters(f, parsed.filters, factDims));
    const { selected, report } = selectContributions(matched, parsed.agg);
    return this.buildResult(selected, parsed, options, factDims, joinRange, report);
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
    const factDims = await this.loadFactDimensions(facts, join.filters, []);
    const filtered = selectContributions(
      facts.filter((f) => matchesFilters(f, join.filters, factDims)),
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
    const metricFilter = metricKey ? { metricKey } : undefined;
    return rows
      .flat()
      .flatMap((row) => projectEventToFacts(row, metricFilter));
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

  /**
   * Load 3-tier fact dimensions (`noteTags`, `typedNoteTags`, `effortsBySlug`,
   * `noteNotebooks`, `sessionNotebooks`, `noteTitles`) in batched calls per query run.
   */
  private async loadFactDimensions(
    rows: readonly AnalyticsDataPoint[],
    filters: readonly TagFilter[],
    groupBy: readonly string[],
  ): Promise<FactDimensionContext> {
    if (rows.length === 0) return EMPTY_FACT_DIMS;
    const keys = new Set<string>([...filters.map((f) => f.key), ...groupBy]);
    const needsUntypedTags = keys.has('tags') || keys.has('tag');
    const neededTypedKeys = [...keys].filter((k) => TYPED_TAG_KEY_SET.has(k) || k === 'discipline' || k === 'intensity');
    const needsTypedTags = neededTypedKeys.length > 0;
    const needsEfforts = keys.has('equipment') || keys.has('discipline') || keys.has('intensity');
    const needsNotebooks = keys.has('notebook');
    const needsNoteTitles = keys.has('session') || keys.has('noteTitle');

    const noteTags = new Map<string, readonly string[]>();
    const typedNoteTags = new Map<string, Map<string, string[]>>();
    const effortsBySlug = new Map<string, IEffort>();
    const noteNotebooks = new Map<string, readonly NotebookId[]>();
    const sessionNotebooks = new Map<string, readonly NotebookId[]>();
    const noteTitles = new Map<string, string>();

    if (needsEfforts && typeof this.effortStore?.getAllEfforts === 'function') {
      const efforts = await this.effortStore.getAllEfforts();
      for (const effort of efforts) {
        effortsBySlug.set(effort.slug, effort);
      }
    }

    const noteIds = [...new Set(rows.map((r) => r.noteId).filter(Boolean))];
    if ((needsNotebooks || needsNoteTitles) && noteIds.length > 0) {
      if (this.noteStore && typeof this.noteStore.getNotesByIds === 'function') {
        const notes = await this.noteStore.getNotesByIds(noteIds);
        for (const n of notes) {
          if (n.title) noteTitles.set(n.id, n.title);
          if (needsNotebooks) noteNotebooks.set(n.id, notebooksOfItem(n));
        }
      } else if (this.noteStore && typeof this.noteStore.getAllNotes === 'function') {
        const noteIdSet = new Set(noteIds);
        const notes = await this.noteStore.getAllNotes();
        for (const n of notes) {
          if (!noteIdSet.has(n.id)) continue;
          if (n.title) noteTitles.set(n.id, n.title);
          if (needsNotebooks) noteNotebooks.set(n.id, notebooksOfItem(n));
        }
      }
      if (needsNotebooks && this.sessionStore) {
        const sessions = await this.sessionStore.getAll();
        for (const s of sessions) {
          if (s.notebookIds?.length) {
            sessionNotebooks.set(s.id, s.notebookIds.map((id) => toNotebookId(id)));
          }
        }
      }
    }

    if ((needsUntypedTags || needsTypedTags) && noteIds.length > 0) {
      if (this.relationStore) {
        const bundles = await this.relationStore.getBatches(noteIds);
        for (const id of noteIds) {
          const tags = bundles.get(id)?.tags ?? [];
          if (needsUntypedTags) {
            noteTags.set(id, tags.map((t) => t.label));
          }
          if (needsTypedTags) {
            const byType = new Map<string, string[]>();
            for (const tag of tags) {
              if (!tag.type) continue;
              const list = byType.get(tag.type);
              if (list) {
                if (!list.includes(tag.label)) list.push(tag.label);
              } else {
                byType.set(tag.type, [tag.label]);
              }
            }
            typedNoteTags.set(id, byType);
          }
        }
      } else if (this.noteStore && typeof this.noteStore.getNoteTagLabels === 'function') {
        if (needsUntypedTags) {
          await Promise.all(noteIds.map(async (id) => noteTags.set(id, await this.noteStore.getNoteTagLabels(id))));
        }
        if (needsTypedTags && this.tagsStore?.getAll) {
          const allTags = await this.tagsStore.getAll();
          const tagById = new Map(allTags.map((t) => [t.id, t]));
          await Promise.all(
            noteIds.map(async (id) => {
              const links = await this.noteTagsStore.getAllFromIndex('by-note', id);
              const byType = new Map<string, string[]>();
              for (const link of links) {
                if (!link.tagId) continue;
                const tag = tagById.get(link.tagId);
                if (!tag?.type) continue;
                const list = byType.get(tag.type);
                if (list) {
                  if (!list.includes(tag.label)) list.push(tag.label);
                } else {
                  byType.set(tag.type, [tag.label]);
                }
              }
              typedNoteTags.set(id, byType);
            }),
          );
        }
      }
    }

    return { noteTags, typedNoteTags, effortsBySlug, noteNotebooks, sessionNotebooks, noteTitles };
  }

  /** Resolve matching note IDs for an exercise slug via the block_efforts containment index. */
  private async getNoteIdsForEffort(effortSlug: string): Promise<Set<string>> {
    const rows = await this.blockEffortsStore.getAllFromIndex('by-effort', effortSlug);
    return new Set(rows.map(r => r.noteId));
  }

  /** Resolve matching note IDs for a canonical typed tag (e.g. equipment:kettlebell). */
  private async getNoteIdsForTypedTag(type: string, label: string): Promise<Set<string>> {
    const out = new Set<string>();
    const tags = await this.tagsStore.getAllFromIndex('by-label', label);
    const typedTag = tags.find(t => t.type === type);
    if (typedTag) {
      const links = await this.noteTagsStore.getAllFromIndex('by-tag', typedTag.id);
      for (const link of links) {
        if (link.noteId) out.add(link.noteId);
      }
    }
    if (type === 'equipment') {
      const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const candidates = slug && slug !== label ? [label, slug] : [label];
      for (const key of candidates) {
        const rows = await this.blockEquipmentStore.getAllFromIndex('by-equipment', key);
        for (const row of rows) {
          if (row?.noteId) out.add(row.noteId);
        }
      }
    }
    return out;
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
    const wantsContainers =
      options.notebookPlane === 'containers' ||
      parsed.filters.some(
        (f) => f.key === 'type' && !f.negate && f.values.some((v) => v.value === 'notebook'),
      );
    if (wantsContainers && this.feedCatalogStore) {
      return this.runFindNotebookContainers(parsed);
    }
    return this.runFind({ ...parsed, target: 'note' }, options);
  }

  /**
   * Execute `:feed{}` — the distributed Feed sources plane.
   * Returns one synthetic Note-shaped row per registered Feed source
   * (including "My Published Feed" when local public content or server snapshot exists).
   */
  async runFindFeed(parsed: ParsedFindQuery, _options: FindOptions = {}): Promise<FindQueryResult> {
    const allFeeds = this.feedCatalogStore ? await this.feedCatalogStore.getAllFeeds() : [];
    const selected = allFeeds.length;
    let matched = allFeeds;

    for (const filter of parsed.filters) {
      if (filter.key === 'feed') {
        matched = matched.filter((f) => {
          const hit = filter.values.some((v) => matchesFeedFilterValue(f.id, v));
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'subscribed') {
        const vals = new Set(filter.values.map((v) => v.value));
        const wantsTrue = vals.has('true');
        const wantsFalse = vals.has('false');
        matched = matched.filter((f) => {
          const hit = wantsTrue && wantsFalse ? true : wantsTrue ? f.subscribed : wantsFalse ? !f.subscribed : true;
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'text') {
        const search = filter.values.map((v) => v.value).join(' ').toLowerCase();
        matched = matched.filter((f) => {
          const hit =
            f.label.toLowerCase().includes(search) ||
            (f.description ?? '').toLowerCase().includes(search) ||
            f.url.toLowerCase().includes(search);
          return filter.negate ? !hit : hit;
        });
      } else if (isTagLabelKey(filter.key)) {
        const wanted = new Set(filter.values.map((v) => v.value.toLowerCase()));
        matched = matched.filter((f) => {
          const rowTags = [
            `tier:${f.tier}`,
            f.tier,
            f.subscribed ? 'subscribed:true' : 'subscribed:false',
            ...(f.unpublishedChanges ? ['status:unpublished', 'unpublished'] : []),
            ...(f.updateAvailable ? ['status:update-available', 'update-available'] : []),
          ].map((t) => t.toLowerCase());
          const hit = rowTags.some((t) => wanted.has(t));
          return filter.negate ? !hit : hit;
        });
      }
    }

    let rows: Note[] = matched.map((f) => {
      const summaryParts = [
        `${f.notebookCount} notebook${f.notebookCount === 1 ? '' : 's'}`,
        f.itemCount > 0 ? `${f.itemCount} notes` : '',
        f.unpublishedChanges ? 'Unpublished changes' : '',
        f.updateAvailable ? `Update v${f.localVersion ?? 0} → v${f.remoteVersion}` : '',
      ].filter(Boolean);
      const body = [f.description ?? '', summaryParts.join(' · '), f.url].filter(Boolean).join('\n');
      return {
        id: `feed/${f.id}`,
        title: f.label,
        type: 'feed',
        rawContent: body,
        sourceRevision: 1,
        blocks: {},
        createdAt: f.builtAt ? (Date.parse(f.builtAt) || 0) : 0,
        sourceId: `feed:${f.id}`,
        sourcePath: f.url,
        ...(f.id !== 'local' ? { feedOrigin: 'feed' as const, feedSourceId: f.id, seedOrigin: 'seed' as const } : { seedOrigin: 'user' as const }),
        tags: [
          `tier:${f.tier}`,
          f.subscribed ? 'subscribed:true' : 'subscribed:false',
          ...(f.unpublishedChanges ? ['status:unpublished'] : []),
          ...(f.updateAvailable ? ['status:update-available'] : []),
        ],
      };
    });

    rows = applyOrderAndPage(rows, parsed);
    return { parsed, notes: rows, blocks: [], stages: { selected, matched: rows.length } };
  }

  /**
   * Execute `:notebook{type:notebook, ...}` — the Notebook container listing
   * across user-owned local notebooks and manifest-discovered remote Feed notebooks.
   */
  private async runFindNotebookContainers(parsed: ParsedFindQuery): Promise<FindQueryResult> {
    const allNotebooks = this.feedCatalogStore ? await this.feedCatalogStore.getAllNotebooks() : [];
    const selected = allNotebooks.length;
    let matched = allNotebooks;

    for (const filter of parsed.filters) {
      if (filter.key === 'feed') {
        matched = matched.filter((nb) => {
          const hit = filter.values.some((v) => matchesFeedFilterValue(nb.feedId, v));
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'notebook') {
        matched = matched.filter((nb) => {
          const candidates = [nb.slug, notebookSlugFromId(nb.id), notebookSlugFromId(nb.chunkId)];
          const hit = filter.values.some((v) => {
            const wantedSlug = notebookSlugFromId(v.value);
            if (v.wildcard) {
              return !wantedSlug ? true : candidates.some((c) => c.startsWith(wantedSlug));
            }
            return candidates.includes(wantedSlug) || nb.id === v.value;
          });
          return filter.negate ? !hit : hit;
        });
      } else if (filter.key === 'text') {
        const search = filter.values.map((v) => v.value).join(' ').toLowerCase();
        matched = matched.filter((nb) => {
          const hit =
            nb.label.toLowerCase().includes(search) ||
            (nb.description ?? '').toLowerCase().includes(search) ||
            nb.feedLabel.toLowerCase().includes(search);
          return filter.negate ? !hit : hit;
        });
      }
    }

    const subFilter = parsed.filters.find((f) => f.key === 'subscribed');
    if (subFilter) {
      const vals = new Set(subFilter.values.map((v) => v.value));
      const wantsTrue = vals.has('true');
      const wantsFalse = vals.has('false');
      matched = matched.filter((nb) => {
        const isSub = nb.origin === 'user' || nb.origin === 'default' || nb.subscribed;
        const hit = wantsTrue && wantsFalse ? true : wantsTrue ? isSub : wantsFalse ? !isSub : false;
        return subFilter.negate ? !hit : hit;
      });
    } else {
      matched = matched.filter((nb) => nb.origin === 'user' || nb.origin === 'default' || nb.subscribed);
    }

    let rows: Note[] = matched.map((nb) => {
      const isLocal = nb.origin === 'user' || nb.origin === 'default';
      return {
        id: isLocal ? `notebook/${nb.slug}` : `feed-notebook/${nb.feedId}/${nb.slug}`,
        title: nb.label,
        type: 'notebook',
        rawContent: nb.description ?? '',
        sourceRevision: 1,
        blocks: {},
        createdAt: nb.updatedAt ? (Date.parse(nb.updatedAt) || 0) : 0,
        notebookId: `notebook/${nb.slug}`,
        sourceId: `notebook:${nb.slug}`,
        ...(nb.feedUrl ? { sourcePath: nb.feedUrl } : {}),
        ...(isLocal
          ? { seedOrigin: 'user' as const, ...(nb.public !== undefined ? { public: nb.public } : {}) }
          : {
              feedOrigin: 'feed' as const,
              feedSourceId: nb.feedId,
              seedOrigin: 'seed' as const,
              seedChunkId: nb.chunkId,
              ...(nb.version !== undefined ? { seedVersion: nb.version } : {}),
            }),
        tags: [
          ...(nb.category ? [`category:${nb.category}`] : []),
          `origin:${nb.origin}`,
          `count:${nb.count}`,
          nb.subscribed ? 'subscribed:true' : 'subscribed:false',
          ...(nb.public ? ['visibility:public'] : []),
        ],
      };
    });

    rows = applyOrderAndPage(rows, parsed);
    return { parsed, notes: rows, blocks: [], stages: { selected, matched: rows.length } };
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
