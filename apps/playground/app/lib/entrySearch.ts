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
 *   4. Preserves executor filtering, ordering, pagination and stage counts.
 *
 * Invalid WQL (parse error or non-find query) resolves to an empty list;
 * callers surface the error separately via their own parse.
 */
import { queryService } from '@/services/queryService';
import { storageService } from '@/services/storage';
import { normalizeNoteTitle, extractHeadingTitle } from '@/lib/noteTitle';
import {
  parseQuery,
  isFindQuery,
  type AnyParsedQuery,
  type ParsedFindQuery,
  type ParsedRowsQuery,
  type FindQueryResult,
  type QueryResult,
  type RowsQueryResult,
} from '@bitcobblers/wod-wiki-engine';
import { blockContentId, parseFrontmatter, projectPlacements, resolvePlacements, type Note, type NoteBlock } from '@bitcobblers/wod-wiki-core';
import {
  toEntry,
  blockToEntry,
  effortToEntry,
  rowsQueryResultToEntries,
  formatEffortName,
  type Entry,
} from './entryMapper';

const EXCERPT_LINE_CAP = 3;
const EXCERPT_CHAR_CAP = 120;
const WOD_FENCE_OPEN_RE = /^(`{3,})(time|wod|whiteboard|log)(?::([\w-]+))?\s*$/i;

/** Fast equivalent of `blockPreview` that stops after 3 non-empty lines instead
 *  of splitting the entire markdown document into an array of all lines. */
function fastExcerpt(rawContent: string): string[] {
  if (!rawContent) return [];
  const out: string[] = [];
  const len = rawContent.length;
  let pos = 0;
  while (pos < len && out.length < EXCERPT_LINE_CAP) {
    const nl = rawContent.indexOf('\n', pos);
    const end = nl === -1 ? len : nl;
    const line = rawContent.slice(pos, end).trim();
    if (line) {
      out.push(line.length > EXCERPT_CHAR_CAP ? `${line.slice(0, EXCERPT_CHAR_CAP - 1)}…` : line);
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return out;
}

function isClosingBacktickFence(trimmedLine: string, minLength: number): boolean {
  if (trimmedLine.length < minLength) return false;
  for (let i = 0; i < trimmedLine.length; i++) {
    if (trimmedLine.charCodeAt(i) !== 96) return false; // '`'
  }
  return true;
}

/** Extract the first actionable `wod` block directly from pre-stored `note.blocks`
 *  offsets, avoiding full-document `parseDocumentSections` / `validateNoteBlocks`
 *  passes across hundreds of notes on the main thread. Fails closed (returns
 *  `undefined`) if block metadata or fence boundaries are invalid. */
function extractFirstWodBlock(note: Note): Entry['wodBlock'] | undefined {
  const { rawContent, blocks, sourceRevision } = note;
  if (
    typeof rawContent !== 'string' ||
    !blocks ||
    typeof blocks !== 'object' ||
    Array.isArray(blocks) ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 1
  ) {
    return undefined;
  }

  let first: NoteBlock | undefined;
  for (const [id, block] of Object.entries(blocks)) {
    if (
      !block ||
      !id ||
      block.id !== id ||
      !Number.isSafeInteger(block.version) ||
      block.version < 1 ||
      block.sourceRevision !== sourceRevision ||
      !Number.isSafeInteger(block.from) ||
      !Number.isSafeInteger(block.to) ||
      block.from < 0 ||
      block.to < block.from ||
      block.to > rawContent.length
    ) {
      return undefined;
    }
    if (block.kind === 'wod' && (!first || block.from < first.from)) {
      first = block;
    }
  }
  if (!first) return undefined;

  if (first.from > 0) {
    const prev = rawContent.charCodeAt(first.from - 1);
    if (prev !== 10 && prev !== 13) return undefined; // must start at a line boundary
  }

  const slice = rawContent.slice(first.from, first.to);
  let openLineEnd = -1;
  let contentStart = -1;
  for (let i = 0; i < slice.length; i++) {
    const code = slice.charCodeAt(i);
    if (code === 13) {
      openLineEnd = i;
      contentStart = slice.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      break;
    }
    if (code === 10) {
      openLineEnd = i;
      contentStart = i + 1;
      break;
    }
  }
  if (openLineEnd === -1 || contentStart > slice.length) return undefined;

  const openMatch = WOD_FENCE_OPEN_RE.exec(slice.slice(0, openLineEnd).trim());
  if (!openMatch) return undefined;
  const markerLen = openMatch[1]!.length;
  const parsedDialect: 'time' | 'log' = openMatch[2]!.toLowerCase() === 'log' ? 'log' : 'time';
  const parsedSport = openMatch[3];
  if (first.dialect !== undefined && first.dialect !== parsedDialect) return undefined;
  if (first.sport !== undefined && first.sport !== parsedSport) return undefined;

  let lastSep = -1;
  for (let i = slice.length - 1; i >= contentStart - 1; i--) {
    const code = slice.charCodeAt(i);
    if (code === 10 || code === 13) {
      lastSep = i;
      break;
    }
  }
  if (lastSep === -1) return undefined;
  const closeLineStart = lastSep + 1;
  if (!isClosingBacktickFence(slice.slice(closeLineStart).trim(), markerLen)) return undefined;

  // Reject corrupt spans that swallow an earlier closing fence inside the slice.
  let lineStart = contentStart;
  while (lineStart < closeLineStart) {
    let lineEnd = lineStart;
    while (lineEnd < closeLineStart) {
      const code = slice.charCodeAt(lineEnd);
      if (code === 10 || code === 13) break;
      lineEnd++;
    }
    if (isClosingBacktickFence(slice.slice(lineStart, lineEnd).trim(), markerLen)) {
      return undefined;
    }
    lineStart = slice.charCodeAt(lineEnd) === 13 && slice.charCodeAt(lineEnd + 1) === 10 ? lineEnd + 2 : lineEnd + 1;
  }

  const content = slice.slice(contentStart, closeLineStart);
  const fingerprint = blockContentId(content);
  return {
    blockId: first.id,
    blockVersion: first.version,
    blockContentId: fingerprint,
    content,
  };
}

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
    sourceNotebook: 'results',
    sourceNote: resultId ?? rowId ?? `${target}:${index}`,
    title: effort ? formatEffortName(effort) : `${target === 'segment' ? 'Segment' : 'Event'} ${index + 1}`,
    date: typeof row.date === 'string' ? row.date : null,
    subtitle: fields.length > 0 ? fields.join(' • ') : undefined,
  };
}

/** Aggregate series → stream rows. Summary Metrics stay values, not Notes. */
function aggregateToEntries(result: QueryResult): Entry[] {
  const metric = result.parsed.family === 'aggregate' ? result.parsed.metric : 'metric';
  return result.series.map((series) => {
    const values = series.points
      .map((point) => `${point.value}${series.unit ? ` ${series.unit}` : ''}`)
      .join(' • ');
    return {
      id: `aggregate:${metric}:${series.key}`,
      kind: 'result',
      sourceNotebook: 'results',
      sourceNote: series.label,
      title: `${metric}: ${values}`,
      subtitle: series.label,
      date: null,
    };
  });
}

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
  runQuery?(raw: string): Promise<QueryResult>;
  runFindEffort?(parsed: ParsedFindQuery): Promise<FindQueryResult>;
  runRows?(parsed: ParsedRowsQuery, options?: unknown): Promise<RowsQueryResult>;
}

export interface StreamQueryEngineOptions {
  service?: StreamQueryService;
  noteTitleResolver?: (noteId: string) => Promise<string | undefined> | string | undefined;
  noteTagsResolver?: (noteId: string) => Promise<string[]> | string[];
  /** Attach authored note excerpts and the first actionable workout's Run target. */
  noteBlockInfo?: boolean;
}

function isStreamQueryService(value: unknown): value is StreamQueryService {
  return typeof value === 'object' && value !== null && 'runFind' in value;
}

export class StreamQueryEngine {
  private readonly customService?: StreamQueryService;
  private readonly noteTitleResolver?: (noteId: string) => Promise<string | undefined> | string | undefined;
  private readonly noteTagsResolver?: (noteId: string) => Promise<string[]> | string[];
  private readonly noteBlockInfo: boolean;

  constructor(serviceOrOptions?: StreamQueryService | StreamQueryEngineOptions) {
    if (isStreamQueryService(serviceOrOptions)) {
      this.customService = serviceOrOptions;
    } else {
      this.customService = serviceOrOptions?.service;
      this.noteTitleResolver = serviceOrOptions?.noteTitleResolver;
      this.noteBlockInfo = serviceOrOptions?.noteBlockInfo ?? false;
      this.noteTagsResolver = serviceOrOptions?.noteTagsResolver;
    }
    if (!this.noteTitleResolver) {
      this.noteTitleResolver = async (noteId: string) => {
        try {
          const note = await storageService.getNote(noteId);
          if (!note) return undefined;
          return normalizeNoteTitle(note.title) || extractHeadingTitle(note.rawContent ?? '');
        } catch {
          return undefined;
        }
      };
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

  /** One batched relation read per run (storageService.getDetailBatches —
   *  local one-transaction bundles, remote ids chunked at the detail
   *  plan's 64-value limit; empty id set → no read). Journal page links
   *  and pages always hydrate; `withNoteFields` also fills blank titles
   *  (block-derived notes) and junction tags from the SAME bundle. A bundle
   *  hit with an empty tag set is final — no-tag is a valid state, never
   *  re-fetched per note; ids absent from the notes store stay untagged
   *  and untitled (fail-closed).
   *  `preResolvedPlacements` carries the run's own runFind placements
   *  (QueryService.containersAndPlacements already read the same junction);
   *  entries covered there skip the second getDetailBatches round-trip
   *  unless `withNoteFields` still needs the bundle for tags/titles. */
  private async hydrateEntries(
    entries: Entry[],
    withNoteFields: boolean,
    preResolvedPlacements?: FindQueryResult['placements'],
    preResolvedTypedTags?: FindQueryResult['typedTags'],
  ): Promise<void> {
    if (withNoteFields && preResolvedTypedTags) {
      for (const entry of entries) {
        const resolvedTags = preResolvedTypedTags[entry.id];
        if (resolvedTags && resolvedTags.length > 0) {
          if (!entry.tags || entry.tags.length === 0) {
            entry.tags = resolvedTags.map((t) => t.label);
          }
          entry.typedTags = resolvedTags.map((t) => ({ label: t.label, type: t.type }));
        }
      }
    }
    const bundleIds = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === 'feed' || entry.kind === 'notebook' || entry.isRemotePreview) continue;
      const alreadyHydrated = Boolean(preResolvedPlacements && Object.prototype.hasOwnProperty.call(preResolvedPlacements, entry.id));
      if (alreadyHydrated) {
        const placements = preResolvedPlacements![entry.id]!;
        entry.placements = placements;
        const projection = projectPlacements(placements);
        entry.pageId ??= projection.pageId;
        if (projection.pageSlug) entry.pageSlug = projection.pageSlug;
        continue;
      }
      if (entry.kind === 'note' || entry.sourceNotebook === 'journal') {
        bundleIds.add(entry.id);
      }
      if (withNoteFields && (!entry.title || !entry.tags || entry.tags.length === 0)) {
        bundleIds.add(entry.id);
      }
    }
    if (bundleIds.size === 0) return;
    const bundles = await storageService.getDetailBatches([...bundleIds]);
    for (const entry of entries) {
      if (entry.kind === 'feed' || entry.kind === 'notebook' || entry.isRemotePreview) continue;
      if (!bundleIds.has(entry.id)) continue;
      const bundle = bundles.get(entry.id);
      if (!bundle) continue;
      // Every page the note sits on; the single-page fields below are the
      // deterministic primary projections of that list.
      const placements = resolvePlacements(bundle.links ?? [], bundle.pages ?? []);
      entry.placements = placements;
      const projection = projectPlacements(placements);
      entry.pageId ??= projection.pageId;
      if (projection.pageSlug) entry.pageSlug = projection.pageSlug;
    }
    if (!withNoteFields) return;
    for (const entry of entries) {
      const bundle = bundles.get(entry.id);
      if (!entry.title && bundle?.note.title) entry.title = bundle.note.title;
      if (bundle && bundle.tags.length > 0) {
        if (!entry.tags || entry.tags.length === 0) {
          entry.tags = bundle.tags.map((t) => t.label);
        }
        // Property grouping needs the type plane even when flat labels were
        // already present on the note record.
        entry.typedTags = bundle.tags.map((t) => ({ label: t.label, type: t.type }));
      }
    }
  }
  async query(input: string | AnyParsedQuery, onStages?: (stages: { selected: number; matched: number }) => void, options?: { notebookPlane?: 'notes' | 'containers' }): Promise<Entry[]> {
    const parsed: AnyParsedQuery = typeof input === 'string' ? parseQuery(input) : input;
    if (!parsed || parsed.error) return [];

    // 1. Content and Effort Discovery Planes
    if (isFindQuery(parsed)) {
      // :effort — the note plane is the result plane: matched projections
      // resolve to their owning definition notes (entryMapper classifies
      // them as effort entries). Projections the note plane did not resolve
      // (legacy rows without an owner note) fall back to the registry row.
      if (parsed.target === 'effort') {
        const result = this.service.runFindEffort
          ? await this.service.runFindEffort(parsed)
          : await this.service.runFind(parsed);
        const noteById = new Map(result.notes.map(note => [note.id, note]));
        const entries = (result.efforts ?? []).map(effort =>
          effort.ownerNoteId && noteById.has(effort.ownerNoteId)
            ? toEntry(noteById.get(effort.ownerNoteId)!)
            : effortToEntry(effort),
        );
        emitStages(onStages, result.stages, entries);
        return entries;
      }

      // :block — one Entry per block in executor order: pipes
      // (order/limit) are applied upstream, so no local re-sort (#855).
      if (parsed.target === 'block') {
        const result = await this.service.runFind(parsed);
        const entries = result.blocks.map(blockToEntry);
        await this.hydrateEntries(entries, true);
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

      const primaryResult = await this.service.runFind(parsed, options?.notebookPlane ? { notebookPlane: options.notebookPlane } : undefined);
      // Vault dashboard clones shadow prebuilt seed dashboards with the same slug
      // so `/dashboards` (`:dashboard{}`) never displays duplicate cards (WW-155).
      const vaultDashboardSlugs = new Set<string>();
      for (const note of primaryResult.notes) {
        if (note.type === 'dashboard' && note.seedOrigin !== 'seed') {
          const { meta } = parseFrontmatter(note.rawContent ?? '');
          if (typeof meta.slug === 'string' && meta.slug.trim()) {
            vaultDashboardSlugs.add(meta.slug.trim());
          }
        }
      }
      const dedupedNotes =
        vaultDashboardSlugs.size === 0
          ? primaryResult.notes
          : primaryResult.notes.filter((note) => {
              if (note.type !== 'dashboard' || note.seedOrigin !== 'seed') return true;
              const { meta } = parseFrontmatter(note.rawContent ?? '');
              const seedSlug =
                (typeof meta.slug === 'string' && meta.slug.trim()) ||
                (note.sourcePath?.startsWith('markdown/dashboards/')
                  ? note.sourcePath.replace(/^markdown\/dashboards\//, '').replace(/\.md$/i, '')
                  : '');
              return !seedSlug || !vaultDashboardSlugs.has(seedSlug);
            });
      const entries = dedupedNotes.map(toEntry);
      if (this.noteTagsResolver) {
        // Session tag resolver keeps precedence; only page links batch here.
        await this.hydrateEntries(entries, false, primaryResult.placements, primaryResult.typedTags);
        await Promise.all(
          entries.map(async (entry) => {
            if (!entry.tags || entry.tags.length === 0) {
              const tags = await this.noteTagsResolver!(entry.id);
              if (tags && tags.length > 0) entry.tags = tags;
            }
          }),
        );
      } else {
        await this.hydrateEntries(entries, true, primaryResult.placements, primaryResult.typedTags);
      }
      emitStages(onStages, primaryResult.stages, entries);

      if (this.noteBlockInfo) {
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]!;
          const note = dedupedNotes[index]!;
          entry.excerpt = fastExcerpt(note.rawContent);
          const wodBlock = extractFirstWodBlock(note);
          if (wodBlock) {
            entry.wodBlock = wodBlock;
            entry.blockContentId = wodBlock.blockContentId;
          }
        }
      }

      return entries;
    }

    if (parsed.family === 'aggregate') {
      if (!this.service.runQuery) return [];
      const result = await this.service.runQuery(parsed.raw);
      const entries = aggregateToEntries(result);
      onStages?.({ selected: result.stages?.selected ?? entries.length, matched: entries.length });
      return entries;
    }

    // Other query families are not stream content planes.
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
