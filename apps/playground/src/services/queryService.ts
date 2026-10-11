/**
 * Query Service Factory — app-side persistence wiring (issue #970, AC 4).
 *
 * Wires the pure `QueryService` from `@bitcobblers/wod-wiki-engine` to the app's
 * IndexedDB stores. The engine package itself is store-free: its default
 * constructor stores are empty stubs, so every app surface imports the
 * singleton (or factory) from here.
 *
 * Unified event store (0.6.36, tickets 003/005): the old FactQueryStore +
 * ResultLogStore seam collapsed into the single EventStore, served by
 * IndexedDBService's `events` store. The content plane (notes / blocks /
 * efforts) is unchanged.
 */

import {
  QueryService,
  type NoteQueryStore,
  type BlockQueryStore,
  type EffortQueryStore,
  type EventStore,
} from '@bitcobblers/wod-wiki-engine';
// wql's own IEffort — the engine umbrella re-exports lang's IEffort under the
// same name, and the two differ on baseAttributes' index signature (0.6.36).
import type { IEffort } from '@bitcobblers/wod-wiki-wql';
import {
  PageSourceRegistry,
  captureContext,
  civilDateOf,
  civilDateAdd,
  sourceMatches,
  WQL_SOURCE_VALUES,
  zonedStartOfDay,
  toEventRows,
  type PageSourceEntry,
  type ExecutionContext,
} from '@bitcobblers/wod-wiki-wql';
import { toStoredOutputStatement } from '@bitcobblers/wod-wiki-lang';
import type { BlockIndexRow, IOutputStatement } from '@bitcobblers/wod-wiki-core';
import { getActiveWorkbenchSessionStore } from '@/stores/workbenchSessionStore';
import { getAppEffortRegistry } from '@/services/effortRegistry';
import { storageService } from '@/services/storage';

/** Unified event store over IndexedDB — the `events` object store (V16). */
export const indexedDbEventStore: EventStore = {
  getEventsByTimeRange: (start: number, end: number) => storageService.getEventsByTimeRange(start, end),
  getEventsByMetricDates: (dates) => storageService.getEventsByMetricDates(dates),
  getEventsByResult: (resultId: string) => storageService.getEventsByResult(resultId),
  getEventsForNote: (noteId: string) => storageService.getEventsForNote(noteId),
  getEventsByContent: (blockContentId: string) => storageService.getEventsByContent(blockContentId),
  scanAll: () => storageService.scanAll(),
  appendEvents: (rows) => storageService.appendEvents(rows),
  finalizeSummaries: (resultId, rows) => storageService.finalizeSummaries(resultId, rows),
  deleteEvents: (ids) => storageService.deleteEvents(ids),
};

export const indexedDbNoteStore: NoteQueryStore = {
  getAllNotes: () => storageService.getAllNotes(),
  getNoteIdsForTag: async (label: string) =>
    new Set((await storageService.getNotesForTag(label)).map((n) => n.id)),
  getNoteTagLabels: async (noteId: string) =>
    (await storageService.getTagsForNote(noteId)).map((tag) => tag.label),
  // Indexed/domain candidate read — undefined capability (or scoped tx)
  // falls back to getAllNotes inside the engine; candidates are a superset,
  // WQL re-applies every residual filter in JS and never server-limits.
  queryDomain: async (req) => {
    if (!storageService.queryDomain) return undefined;
    const res = await storageService.queryDomain({ ...req, plan: 'notes' });
    return res && res.plan === 'notes' ? res : undefined;
  },
};


export const indexedDbBlockStore: BlockQueryStore = {
  getAllBlocks: () => storageService.getAllBlockIndex(),
  // API mode: exact wire read (counts, selection, server paging). Local
  // (offline IndexedDB) mode: indexed candidate reads — selective queries
  // never hydrate the whole block store. Only the exact clause shapes WQL
  // compiles are served locally; anything else returns undefined (the
  // engine's whole-store fallback), never a degraded count. Storage errors
  // propagate — a failing read is not silently turned into a scan.
  queryDomain: async (req) => {
    if (storageService.queryDomain) {
      const res = await storageService.queryDomain({ ...req, plan: 'blocks' });
      if (res && res.plan === 'blocks') return res;
    }
    const types: string[] = [];
    const noteIds: string[] = [];
    for (const predicate of req.filters ?? []) {
      // Only literal value-list clauses are served from the index. Other
      // predicate shapes ({ field: 'text', value } and friends) have no
      // values list and no block-index surface — fall back to the
      // whole-store read where WQL re-applies them in JS.
      if (!('values' in predicate)) return undefined;
      if (predicate.negate || predicate.values.length === 0) return undefined;
      if (predicate.field === 'type' && types.length === 0) types.push(...predicate.values);
      else if (predicate.field === 'noteId' && noteIds.length === 0) noteIds.push(...predicate.values);
      else return undefined;
    }
    // Authored source selection cannot be counted locally (no per-kind
    // count surface) — the wire baseline would overstate the historical
    // post-source population, so those shapes fall back to the whole-store
    // read where the JS source filter counts exactly.
    if ((req.selection ?? []).some((p) => p.field === 'source')) return undefined;
    let rows: BlockIndexRow[];
    if (types.length > 0 && noteIds.length > 0) {
      // Values OR within a clause, clauses AND across — intersect by id.
      const [byType, byNote] = await Promise.all([
        Promise.all(types.map((v) => storageService.getBlockIndexByType(v))),
        Promise.all(noteIds.map((v) => storageService.getBlockIndexByNote(v))),
      ]);
      const noteIdSet = new Set(byNote.flat().map((r) => r.id));
      rows = byType.flat().filter((r) => noteIdSet.has(r.id));
    } else if (types.length > 0) {
      rows = (await Promise.all(types.map((v) => storageService.getBlockIndexByType(v)))).flat();
    } else if (noteIds.length > 0) {
      rows = (await Promise.all(noteIds.map((v) => storageService.getBlockIndexByNote(v)))).flat();
    } else {
      rows = await storageService.getAllBlockIndex();
    }
    // Local selection before paging: the wire's sourceFence clause is
    // applied here so a paged local read can never return fence-illegal
    // rows the caller would treat as the page (authored source clauses
    // already fell back above). Mirrors the JS pipeline's fence exactly.
    rows = rows.filter((r) => !r.sourceId || WQL_SOURCE_VALUES.some((k) => sourceMatches(r, k)));
    // Natural id order — exactly the whole-store iteration order the JS
    // pipeline surfaces when no `| order` pipe exists.
    const direction = req.order?.[0]?.direction === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * direction);
    const offset = req.offset ?? 0;
    const matchedCount = rows.length; // wire: before limit
    const page = req.limit !== undefined ? rows.slice(offset, offset + req.limit) : rows.slice(offset);
    return {
      plan: 'blocks',
      // 0 = not a server domain projection; selectedCount is the local
      // fence-selected source population (no hydration).
      projectionVersion: 0,
      selectedCount: await storageService.countBlockIndexInDomain(),
      matchedCount,
      rows: page,
    };
  },
};

/**
 * Production effort store: the CompositeEffortRegistry (bundled + user,
 * IndexedDB-backed), lazily constructed on first query.
 */
export class RegistryEffortStore implements EffortQueryStore {
  async getAllEfforts(): Promise<IEffort[]> {
    const registry = getAppEffortRegistry();
    if (!registry.isInitialized()) {
      await registry.loadBundled();
    }
    return [...registry.list()] as unknown as IEffort[]; // lang's IEffort.baseAttributes lacks the index signature wql's IEffort declares (engine-internal inconsistency, 0.6.36)
  }
}

// ─── Page-source datasets (@session / @today) ─────────────────────────────
//
// The registry is populated ONCE per page context — `ensurePageSources` is
// memoized and every production query method awaits it before executing —
// so `@session | :sum{metric:tis}` and `@today | …` pipelines resolve
// in-memory through `QueryServiceStores.datasetStore` and never roundtrip
// the database. `@session` projects the ACTIVE workbench runtime at query
// time (no stale cross-provider runtime); `@today` is the DST-safe civil
// day snapshot: telemetry events plus journal-day notes (junction page
// date first, the note's own domain date as fallback).

export const pageSourceRegistry = new PageSourceRegistry();

const sessionEntry: PageSourceEntry = { events: [], notes: [] };
const todayEntry: PageSourceEntry = { events: [], notes: [] };
pageSourceRegistry.set('@session', sessionEntry);
pageSourceRegistry.set('@today', todayEntry);

/** Project the active workbench runtime's outputs into event rows — the
 *  live `@session` facts and segment outputs. Returns the REGISTRY entry
 *  (mutated in place) so every reader sees the same current projection. */
function projectLiveSession(): PageSourceEntry {
  const session = getActiveWorkbenchSessionStore().getState();
  const outputs: IOutputStatement[] = session.runtime?.getOutputStatements() ?? [];
  const entry = session.currentEntry;
  sessionEntry.notes = entry
    ? [{ id: entry.id, title: entry.title, createdAt: entry.createdAt, date: entry.targetDate }]
    : [];
  if (outputs.length === 0) {
    sessionEntry.events = [];
    return sessionEntry;
  }
  sessionEntry.events = toEventRows(outputs.map(toStoredOutputStatement), {
    noteId: entry?.id ?? '',
    resultId: `live:${entry?.id ?? 'session'}`,
    origin: 'playground',
    workoutTimestamp: entry?.targetDate,
  });
  return sessionEntry;
}

/** The note's civil day: the first junction page carrying a date wins
 *  (highest container), else the note's own domain date, else its creation
 *  date — every note resolves to exactly one civil day in the captured
 *  timezone (never a raw timestamp comparison). */
function noteCivilDay(
  note: { id: string; date?: number; createdAt: number },
  links: Array<{ pageId: string; position?: number; createdAt: number }>,
  pages: ReadonlyMap<string, { date?: string } | undefined>,
  timeZone: string,
): string {
  const ordered = [...links].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.createdAt - b.createdAt,
  );
  for (const link of ordered) {
    const date = pages.get(link.pageId)?.date;
    if (date) return date;
  }
  return civilDateOf(note.date ?? note.createdAt, timeZone);
}

async function populatePageSources(ctx: ExecutionContext, gen: number): Promise<void> {
  const today = civilDateOf(ctx.instant, ctx.timeZone);
  const start = zonedStartOfDay(today, ctx.timeZone);
  const end = zonedStartOfDay(civilDateAdd(today, 1), ctx.timeZone);

  const [rangeEvents, allNotes, allLinks, allPages] = await Promise.all([
    storageService.getEventsByTimeRange(start, end),
    storageService.getAllNotes(),
    storageService.getAllPageNotes(),
    storageService.getAllPages(),
  ]);
  // The store's window query treats the end as inclusive — the civil day
  // is the half-open [local midnight, next local midnight).
  const events = rangeEvents.filter((e) => e.timestamp >= start && e.timestamp < end);

  const pages = new Map(allPages.map(page => [page.id, page]));

  const linksByNote = new Map<string, Array<{ pageId: string; position?: number; createdAt: number }>>();
  for (const link of allLinks) {
    const links = linksByNote.get(link.noteId);
    if (links) links.push(link);
    else linksByNote.set(link.noteId, [link]);
  }

  const todays: typeof allNotes = [];
  for (const note of allNotes) {
    if (noteCivilDay(note, linksByNote.get(note.id) ?? [], pages, ctx.timeZone) === today) todays.push(note);
  }

  // A newer page context superseded this population — never let an older
  // snapshot overwrite the registry or release the gate.
  if (gen !== generation) return;
  todayEntry.events = events;
  todayEntry.notes = todays;
  projectLiveSession();
}

let sourcesPromise: Promise<void> | null = null;
let capturedDay: string | null = null;
let generation = 0;
let sourcesReady = false;
const readyListeners = new Set<() => void>();

function notifyReady(): void {
  for (const l of readyListeners) l();
}

function startPopulation(ctx: ExecutionContext, today: string): Promise<void> {
  capturedDay = today;
  const gen = ++generation;
  sourcesPromise = populatePageSources(ctx, gen);
  // Release the gate on settle either way — a failure stays on the cached
  // rejection so child queries surface the real storage error.
  void sourcesPromise.then(
    () => {
      if (gen === generation) markReady();
    },
    () => {
      if (gen === generation) markReady();
    },
  );
  return sourcesPromise;
}

function markReady(): void {
  sourcesReady = true;
  notifyReady();
}

/** Populate the standard page-source datasets once per page context /
 *  civil day — awaited by every production query method BEFORE execution.
 *  Concurrent children coalesce on the in-flight promise; a stored failure
 *  stays on the cached promise so queries surface the real error instead of
 *  silently re-querying a broken store. One captured context drives both
 *  the day key and the snapshot, so a midnight crossing can never split
 *  them. */
export function ensurePageSources(): Promise<void> {
  const ctx = captureContext();
  const today = civilDateOf(ctx.instant, ctx.timeZone);
  if (!sourcesPromise || capturedDay !== today) return startPopulation(ctx, today);
  return sourcesPromise;
}

/** Page-load population: a new page context re-populates (@today may have
 *  changed since the previous page loaded). Resets the first-paint gate so
 *  children wait for the fresh snapshot. */
export function refreshPageSources(): Promise<void> {
  sourcesReady = false;
  const ctx = captureContext();
  const today = civilDateOf(ctx.instant, ctx.timeZone);
  return startPopulation(ctx, today);
}

/** Snapshot/subscribe gate for the first-paint hook — the pure service
 *  module stays React-free so direct runtime imports (page.evaluate smoke
 *  seams) never hit the React preamble. */
export function sourcesReadySnapshot(): boolean {
  return sourcesReady;
}
export function subscribePageSourcesReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

/**
 * Production executor: the IndexedDB-wired QueryService with page-source
 * population guaranteed before any query executes — Explorer, dashboards,
 * canvas and note surfaces all go through this one seam.
 */
class PlaygroundQueryService extends QueryService {
  override async runQuery(raw: string, options?: Parameters<QueryService['runQuery']>[1]) {
    await ensurePageSources();
    return super.runQuery(raw, options);
  }
  override async runPipeline(queryText: string, options?: Parameters<QueryService['runPipeline']>[1]) {
    await ensurePageSources();
    return super.runPipeline(queryText, options);
  }
  override async runFind(parsed: Parameters<QueryService['runFind']>[0], options?: Parameters<QueryService['runFind']>[1]) {
    await ensurePageSources();
    return super.runFind(parsed, options);
  }
  override async runRows(parsed: Parameters<QueryService['runRows']>[0], options?: Parameters<QueryService['runRows']>[1]) {
    await ensurePageSources();
    return super.runRows(parsed, options);
  }
  override async run(parsed: Parameters<QueryService['run']>[0], options?: Parameters<QueryService['run']>[1]) {
    await ensurePageSources();
    return super.run(parsed, options);
  }
}

export function createQueryService(): QueryService {
  return new PlaygroundQueryService({
    eventStore: indexedDbEventStore,
    noteStore: indexedDbNoteStore,
    blockStore: indexedDbBlockStore,
    effortStore: new RegistryEffortStore(),
    blockEffortsStore: {
      getAllFromIndex: (index, key) => storageService.getAllFromIndex('block_efforts', index, key),
    },
    tagsStore: {
      getAllFromIndex: (index, key) => storageService.getAllFromIndex('tags', index, key),
    },
    noteTagsStore: {
      getAllFromIndex: (index, key) => storageService.getAllFromIndex('note_tags', index, key),
    },
    // Canonical page_notes junction reads for container resolution.
    pageStore: {
      getNotePages: (noteId) => storageService.getNotePages(noteId),
      getPage: (pageId) => storageService.getPage(pageId),
    },
    relationStore: {
      getBatches: (noteIds) => storageService.getEntryBatches(noteIds),
    },
    // Named page-source datasets — @session projects live at query time;
    // everything else reads the populated registry. No database roundtrip.
    datasetStore: {
      getDataset: (name) => (name === '@session' ? projectLiveSession() : pageSourceRegistry.getDataset(name)),
    },
  });
}

/**
 * App-wide singleton — the replacement for the engine package's old
 * `queryService` default export, now wired to IndexedDB.
 */
export const queryService = createQueryService();

/** Playground-facing alias. */
export const createPlaygroundQueryService = createQueryService;
