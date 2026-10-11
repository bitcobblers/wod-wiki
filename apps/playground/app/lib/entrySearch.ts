/**
 * StreamQueryEngine — unified query intake across content, effort, and session planes.
 * (Tickets #833/#834 deepened per Wayfinder Ticket 001).
 *
 * Provides a single, deep intake seam that:
 *   1. Accepts any valid content WQL query string or AST (:note,
 *      :block, :effort, :session, :segment, :event).
 *   2. Dispatches to the appropriate query service method (runFind,
 *      runFindEffort) transparently behind a single seam.
 *   3. Maps all returned records into an extended, uniform Entry model
 *      carrying optional execution metrics or effort metadata.
 *   4. Preserves secondary text searching (e.g. searching block bodies
 *      alongside note titles when text: is present).
 *
 * Invalid WQL (parse error or non-find query) resolves to an empty list;
 * callers surface the error separately via their own parse.
 */
import { queryService } from '@/services/queryService';
import { storageService } from '@/services/storage';
import {
  parseQuery,
  isFindQuery,
  type AnyParsedQuery,
  type ParsedFindQuery,
  type ParsedRowsQuery,
  type FindQueryResult,
  type RowsQueryResult,
} from '@bitcobblers/wod-wiki-engine';
import type { Note, Page } from '@/types/storage';
import {
  toEntry,
  blockToEntry,
  noteFromBlock,
  effortToEntry,
  rowsQueryResultToEntries,
  formatEffortName,
  blockPreview,
  type Entry,
} from './entryMapper';

/**
 * :segment / :event — the executor returns tabular scalar rows
 * (#1042), not notes/blocks. Map each row into a stream Entry from the
 * metadata the table actually emits (selected columns + `__id`/`__resultId`).
 * Unknown non-scalar fields are ignored; note identity is kept only when the
 * table emits a `note` column — ids are never invented for navigation.
 */
function tableRowToEntry(row: Record<string, unknown>, target: 'segment' | 'event', index: number): Entry {
  const rowId = typeof row.__id === 'string' && row.__id ? row.__id : undefined;
  const resultId = typeof row.__resultId === 'string' && row.__resultId ? row.__resultId : undefined;
  const effort = typeof row.effort === 'string' && row.effort ? row.effort : undefined;
  const fields: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('__') || key === 'date' || key === 'effort') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields.push(`${key}: ${value}`);
    }
  }
  return {
    id: rowId ?? resultId ?? `${target}:${index}`,
    kind: target,
    sourceCatalog: 'results',
    sourceItem: resultId ?? rowId ?? `${target}:${index}`,
    title: effort ? formatEffortName(effort) : `${target === 'segment' ? 'Segment' : 'Event'} ${index + 1}`,
    date: typeof row.date === 'string' ? row.date : null,
    subtitle: fields.length > 0 ? fields.join(' • ') : undefined,
  };
}

/** Emit one honest stage count per run: `matched` is the actual mapped
 *  entries (the note-plane count understates text-companion unions),
 *  `selected` (scope population) never drops below it. */
function emitStages(
  onStages: ((stages: { selected: number; matched: number }) => void) | undefined,
  stages: { selected: number; matched: number } | undefined,
  entries: Entry[],
): void {
  if (!onStages) return;
  onStages({
    selected: Math.max(stages?.selected ?? 0, entries.length),
    matched: entries.length,
  });
}

export interface StreamQueryService {
  runFind(parsed: ParsedFindQuery, options?: unknown): Promise<FindQueryResult>;
  runFindEffort?(parsed: ParsedFindQuery): Promise<FindQueryResult>;
  runRows?(parsed: ParsedRowsQuery, options?: unknown): Promise<RowsQueryResult>;
}

export interface StreamQueryEngineOptions {
  service?: StreamQueryService;
  noteTitleResolver?: (noteId: string) => Promise<string | undefined> | string | undefined;
  noteTagsResolver?: (noteId: string) => Promise<string[]> | string[];
  /**
   * When true, a :note run also fetches the same query's block plane
   * (identical scope — no broadening) and attaches each note's excerpt lines
   * plus its first wod block's content id. The feed's rich preview cards and
   * their Run action consume this; one extra query per executed WQL, not per item.
   */
  noteBlockInfo?: boolean;
}

function isStreamQueryService(value: unknown): value is StreamQueryService {
  return typeof value === 'object' && value !== null && 'runFind' in value;
}

export class StreamQueryEngine {
  private customService?: StreamQueryService;
  private noteTitleResolver?: (noteId: string) => Promise<string | undefined> | string | undefined;
  private noteTagsResolver?: (noteId: string) => Promise<string[]> | string[];
  private noteBlockInfo: boolean;

  constructor(serviceOrOptions?: StreamQueryService | StreamQueryEngineOptions) {
    if (isStreamQueryService(serviceOrOptions)) {
      this.customService = serviceOrOptions;
    } else {
      this.customService = serviceOrOptions?.service;
      this.noteTitleResolver = serviceOrOptions?.noteTitleResolver;
      this.noteBlockInfo = serviceOrOptions?.noteBlockInfo ?? false;
      this.noteTagsResolver = serviceOrOptions?.noteTagsResolver;
    }
  }

  private get service(): StreamQueryService {
    return this.customService ?? queryService;
  }

  /** Same engine with note block info attached — the feed mode's rich
   *  previews and Run targets. Shares the underlying service and title
   *  resolver; no second query-state seam. */
  withNoteBlockInfo(): StreamQueryEngine {
    const next = new StreamQueryEngine({
      service: this.service,
      noteTitleResolver: this.noteTitleResolver,
      noteTagsResolver: this.noteTagsResolver,
      noteBlockInfo: true,
    });
    // The feed's companion wraps the same engine; an instance-level `query`
    // override (the tests' seam for stubbing results directly) must survive
    // the wrap or feed-mode callers would silently re-run the real query.
    if (Object.prototype.hasOwnProperty.call(this, 'query')) {
      next.query = this.query;
    }
    return next;
  }

  /** One batched relation read per run (storageService.getEntryBatches —
   *  local one-transaction bundles, remote ids chunked at the entries
   *  plan's 64-value limit; empty id set → no read). Journal page links
   *  and pages always hydrate; `withNoteFields` also fills blank titles
   *  (block-derived notes) and junction tags from the SAME bundle. A bundle
   *  hit with an empty tag set is final — no-tag is a valid state, never
   *  re-fetched per note; ids absent from the notes store stay untagged
   *  and untitled (fail-closed). */
  private async hydrateEntries(entries: Entry[], withNoteFields: boolean): Promise<void> {
    const parentNoteId = (entry: Entry) => entry.noteId ?? entry.id;
    const bundleIds = new Set<string>();
    for (const entry of entries) {
      if (entry.sourceCatalog === 'journal') bundleIds.add(parentNoteId(entry));
      if (withNoteFields && (!entry.title || !entry.tags || entry.tags.length === 0)) {
        bundleIds.add(parentNoteId(entry));
      }
    }
    if (bundleIds.size === 0) return;
    const bundles = await storageService.getEntryBatches([...bundleIds]);
    for (const entry of entries) {
      if (entry.sourceCatalog !== 'journal') continue;
      const bundle = bundles.get(parentNoteId(entry));
      const links = [...(bundle?.links ?? [])].sort(
        (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.createdAt - b.createdAt,
      );
      for (const link of links) {
        const page = bundle?.pages.find((p) => p.id === link.pageId);
        if (!page) continue;
        entry.pageId ??= page.id;
        if (!page.date && page.slug) {
          entry.pageSlug = page.slug;
          break;
        }
      }
    }
    if (!withNoteFields) return;
    for (const entry of entries) {
      const bundle = bundles.get(parentNoteId(entry));
      if (!entry.title && bundle?.note.title) entry.title = bundle.note.title;
      if ((!entry.tags || entry.tags.length === 0) && bundle) {
        const labels = bundle.tags.map((t) => t.label);
        if (labels.length > 0) entry.tags = labels;
      }
    }
  }
  async query(input: string | AnyParsedQuery, onStages?: (stages: { selected: number; matched: number }) => void): Promise<Entry[]> {
    const parsed: AnyParsedQuery = typeof input === 'string' ? parseQuery(input) : input;
    if (!parsed || parsed.error) return [];

    // 1. Content and Effort Discovery Planes
    if (isFindQuery(parsed)) {
      // :effort — queries the effort registry via runFindEffort
      if (parsed.target === 'effort') {
        const result = this.service.runFindEffort
          ? await this.service.runFindEffort(parsed)
          : await this.service.runFind(parsed);
        const entries = (result.efforts ?? []).map(effortToEntry);
        emitStages(onStages, result.stages, entries);
        return entries;
      }

      // :block — one Entry per block in executor order: pipes
      // (order/limit) are applied upstream, so no local re-sort (#855).
      if (parsed.target === 'block') {
        const result = await this.service.runFind(parsed);
        const entries = result.blocks.map(blockToEntry);
        await this.hydrateEntries(entries, false);
        emitStages(onStages, result.stages, entries);
        return entries;
      }
      // :session — session runs grouped into cards (#1041/#1042)
      if (parsed.target === 'session') {
        const result = await this.service.runFind(parsed);
        onStages?.(result.stages);
        let noteTitles: Map<string, string> | undefined;
        if (this.noteTitleResolver && result.runs) {
          noteTitles = new Map();
          for (const run of result.runs) {
            if (!noteTitles.has(run.noteId)) {
              const title = await this.noteTitleResolver(run.noteId);
              if (title) noteTitles.set(run.noteId, title);
            }
          }
        }
        const entries = rowsQueryResultToEntries(result as unknown as RowsQueryResult, { noteTitles });
        emitStages(onStages, result.stages, entries);
        return entries;
      }

      // :segment / :event — the tabular rows plane (#1042). Mapped
      // from result.table rows; noteMap would silently drop them.
      if (parsed.target === 'segment' || parsed.target === 'event') {
        const target = parsed.target;
        const result = await this.service.runFind(parsed);
        const entries = (result.table?.rows ?? []).map((row, i) => tableRowToEntry(row, target, i));
        emitStages(onStages, result.stages, entries);
        return entries;
      }

      // :note (or other content target)
      const hasText = parsed.filters.some(f => f.key === 'text' && !f.negate);
      const primaryPromise = this.service.runFind(parsed);

      // When free-text is present — or the caller asked for note block info —
      // also run :block to search body text / collect per-note previews.
      const isCatalogSearch = parsed.target === 'note'
        && parsed.filters.some(f => f.key === 'type' && !f.negate && f.values.some(v => v.value === 'collection'));
      const blockParsed: ParsedFindQuery | null = (hasText || this.noteBlockInfo) && parsed.target === 'note' && !isCatalogSearch
        ? (typeof input === 'string'
            ? (parseQuery(input.replace(/^:note/, ':block')) as ParsedFindQuery)
            : {
                ...parsed,
                target: 'block',
                raw: parsed.raw ? parsed.raw.replace(/^:note/, ':block') : ':block',
              })
        : null;

      const blockPromise = (blockParsed && isFindQuery(blockParsed) && !blockParsed.error)
        ? this.service.runFind(blockParsed)
        : Promise.resolve(null);

      const [primaryResult, blockResult] = await Promise.all([primaryPromise, blockPromise]);
      const noteMap = new Map<string, Note>();

      for (const note of primaryResult.notes) {
        noteMap.set(note.id, note);
      }
      for (const block of primaryResult.blocks) {
        if (!noteMap.has(block.noteId)) noteMap.set(block.noteId, noteFromBlock(block));
      }
      if (blockResult?.blocks) {
        for (const block of blockResult.blocks) {
          if (!noteMap.has(block.noteId)) noteMap.set(block.noteId, noteFromBlock(block));
        }
      }

      const entries = Array.from(noteMap.values()).map(toEntry);
      if (this.noteTagsResolver) {
        // Session tag resolver keeps precedence; only page links batch here.
        await this.hydrateEntries(entries, false);
        await Promise.all(
          entries.map(async (entry) => {
            if (!entry.tags || entry.tags.length === 0) {
              const tags = await this.noteTagsResolver!(entry.id);
              if (tags && tags.length > 0) entry.tags = tags;
            }
          }),
        );
      } else {
        await this.hydrateEntries(entries, true);
      }
      emitStages(onStages, primaryResult.stages, entries);

      if (this.noteBlockInfo && blockResult?.blocks) {
        // Per note: prose preview lines (feed reading depth — bounded, the
        // card collapses/ expands) and the first wod block's content id and
        // script — the feed's excerpt and Run target.
        const EXCERPT_LINE_CAP = 6;
        const previewByNote = new Map<string, string[]>();
        const wodByNote = new Map<string, { blockContentId: string; content: string }>();
        for (const block of [...blockResult.blocks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
          const preview = previewByNote.get(block.noteId);
          if (preview) {
            const room = EXCERPT_LINE_CAP - preview.length;
            if (room > 0) preview.push(...blockPreview(block.rawContent).slice(0, room));
          } else {
            previewByNote.set(block.noteId, blockPreview(block.rawContent));
          }
          if (!wodByNote.has(block.noteId) && block.dataType === 'wod' && block.blockContentId) {
            wodByNote.set(block.noteId, { blockContentId: block.blockContentId, content: block.rawContent });
          }
        }
        for (const entry of entries) {
          const preview = previewByNote.get(entry.id);
          if (preview && preview.length > 0) entry.excerpt = preview.slice(0, EXCERPT_LINE_CAP);
          const wod = wodByNote.get(entry.id);
          if (wod && !entry.wodBlock) entry.wodBlock = wod;
          if (wod && !entry.blockContentId) entry.blockContentId = wod.blockContentId;
        }
      }

      return entries;
    }

    // Unsupported query family (e.g. aggregate queries)
    return [];
  }
}

export const defaultStreamQueryEngine = new StreamQueryEngine();

/**
 * Shared entry point for resolving WQL query strings or ASTs into Entry[] across
 * all planes (content, efforts, and telemetry rows). `onStages` receives the
 * run's reconciled counts ({selected, matched}) — no extra scans.
 */
export async function searchEntries(
  input: string | AnyParsedQuery,
  engine: StreamQueryEngine = defaultStreamQueryEngine,
  onStages?: (stages: { selected: number; matched: number }) => void,
): Promise<Entry[]> {
  return engine.query(input, onStages);
}
