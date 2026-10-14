/**
 * Headless WQL Query Command Runner
 *
 * Evaluates WQL queries against in-memory stores sourced from --corpus,
 * --stdin-log, or --stdin-facts, and emits a versioned IR envelope.
 */

function getFs() {
  if (typeof globalThis.process?.versions?.node === 'undefined' && typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') {
    throw new Error('File system operations are only supported in Node / Bun environments');
  }
  // eslint-disable-next-line no-restricted-syntax -- lazy CJS require keeps node builtins out of browser bundles
  return require('fs');
}
import {
  QueryService,
  parseQuery,
  isFindQuery,
  isPipelineQuery,
  type QueryServiceStores,
  type QueryResult,
  type RowsQueryResult,
  type FindQueryResult,
  type PipelineResult,
  type NoteQueryStore,
  type BlockQueryStore,
  type EffortQueryStore,
  type IEffort as WqlEffort,
} from '@bitcobblers/wod-wiki-wql';
import { inMemoryEventStore } from '../store';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import type { AnalyticsDataPoint, Note, BlockIndexRow, BlockRevision, Session, EventRecord } from '@bitcobblers/wod-wiki-core';
import type { WorkoutResults } from '@bitcobblers/wod-wiki-core';
import type { IEffort } from '@bitcobblers/wod-wiki-lang';
import { bundledEfforts } from '@bitcobblers/wod-wiki-lang';
import { validateNoteBlocks, parseDocumentSections, blockContentId } from '@bitcobblers/wod-wiki-core';
import { createIRFile, isIRFile, type IrKind, type WodWikiIRFile, type ExecutionLog, type CorpusIRData } from '../ir';
export class WqlSyntaxError extends Error {
  constructor(
    public readonly query: string,
    public readonly syntaxError: string,
  ) {
    super(`WQL Syntax Error in "${query}": ${syntaxError}`);
    this.name = 'WqlSyntaxError';
  }
}

export interface QueryCliOptions {
  corpusPath?: string;
  stdinLog?: string;
  stdinFacts?: string;
  preferredUnit?: string;
  sourceLabel?: string;
  /** Pre-built store bundle (e.g. sqlite-backed). When set, the corpus/stdin
   *  dataset options are ignored. */
  stores?: QueryServiceStores;
}

interface LoadedData {
  eventRecords: EventRecord[];
  facts: AnalyticsDataPoint[];
  results: Session[];
  notes: Note[];
  blocks: BlockIndexRow[];
  revisions: BlockRevision[];
  efforts: IEffort[];
  noteTags: Record<string, string[]>;
}


function extractPayload(rawJson: string): unknown {
  try {
    const parsed = JSON.parse(rawJson);
    if (isIRFile(parsed)) {
      return parsed.data;
    }
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse JSON input: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function buildStoresFromData(data: LoadedData) {
  // Direct events and fact-set summaries share one query stream.
  const events = [
    ...data.eventRecords,
    ...data.facts.map((f, i) => ({
      id: `fact:${f.resultId ?? 'stdin'}:${f.metricKey ?? f.type}:${i}`,
      resultId: f.resultId ?? 'stdin-result-1',
      noteId: f.noteId ?? 'stdin-note-1',
      blockContentId: f.blockContentId,
      pageId: f.pageId,
      origin: f.origin,
      timestamp: f.timestamp,
      grain: f.grain === 'event' ? 'event' : 'summary',
      outputType: 'analytics',
      effortSlug: f.effortSlug,
      metrics: [{
        type: f.metricKey ?? f.type,
        value: f.value,
        ...(f.unit ? { unit: f.unit } : {}),
        origin: 'engine',
      }],
      blockId: f.blockId,
      blockVersion: f.blockVersion,
    } as EventRecord)),
  ];

  const eventStore = inMemoryEventStore(events);

  const noteStore: NoteQueryStore = {
    getAllNotes: async () => [...data.notes],
    getNotesByIds: async (ids) => {
      const selected = new Set(ids);
      return data.notes.filter((note) => selected.has(note.id));
    },
    getNoteIdsForTag: async (tag: string) => {
      const matching = new Set<string>();
      for (const [noteId, tags] of Object.entries(data.noteTags)) {
        if (tags.includes(tag)) matching.add(noteId);
      }
      return matching;
    },
    getNoteTagLabels: async (noteId: string) => [...(data.noteTags[noteId] ?? [])],
  };

  const blockStore: BlockQueryStore = {
    getAllBlocks: async () => [...data.blocks],
  };

  const effortStore: EffortQueryStore = {
    getAllEfforts: async () => [...data.efforts] as unknown as WqlEffort[],
  };

  return { eventStore, noteStore, blockStore, effortStore };
}

export function loadQueryData(options: QueryCliOptions): LoadedData {
  const data: LoadedData = {
    eventRecords: [],
    facts: [],
    results: [],
    notes: [],
    blocks: [],
    revisions: [],
    efforts: [...bundledEfforts],
    noteTags: {},
  };

  if (options.corpusPath) {
    const fs = getFs();
    if (!fs.existsSync(options.corpusPath)) {
      throw new Error(`Corpus file not found at path: ${options.corpusPath}`);
    }
    const raw = fs.readFileSync(options.corpusPath, 'utf-8');
    const payload = extractPayload(raw);

    if (Array.isArray(payload)) {
      data.facts = payload as AnalyticsDataPoint[];
    } else if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;
      if ('segments' in obj) throw new Error('Incompatible corpus segments; whole Notes and block revisions are required');
      if (obj.kind === 'event-journal' || Array.isArray(obj.records)) {
        if (Array.isArray(obj.blockRevisions)) data.revisions = obj.blockRevisions as BlockRevision[];
        if (Array.isArray(obj.sessions)) data.results = obj.sessions as Session[];
        if (Array.isArray(obj.records)) {
          data.eventRecords = obj.records as EventRecord[];
        }
        if (Array.isArray(obj.notes)) {
          data.notes = obj.notes as Note[];
          for (const n of obj.notes as Array<{ id?: string; tags?: string[] }>) {
            if (n && typeof n === 'object' && n.id && Array.isArray(n.tags)) {
              data.noteTags[n.id] = n.tags;
            }
          }
        }
      } else if (obj.facts || obj.results || obj.notes || obj.blocks || obj.efforts || obj.tags || obj.logs) {
        const corpus = payload as CorpusIRData;
        if (corpus.facts) data.facts = corpus.facts;
        if (Array.isArray(corpus.results)) data.results = corpus.results;
        if (corpus.notes) data.notes = corpus.notes;
        if (corpus.blocks) data.blocks = corpus.blocks;
        if (corpus.efforts) data.efforts = corpus.efforts;
        if (corpus.revisions) data.revisions = corpus.revisions;
        if (corpus.tags) data.noteTags = corpus.tags;

        if (corpus.logs) {
          const identity = {
            noteId: 'corpus-note-1', resultId: 'corpus-result-1', origin: 'journal' as const,
            workoutTimestamp: corpus.logs[0]?.timeSpan?.started ?? Date.now(),
          };
          data.eventRecords = [...toEventRows(corpus.logs, identity), ...toSummaryEventRows(corpus.logs, identity)];
        }
      } else {
        throw new Error(`Unrecognized corpus payload shape in "${options.corpusPath}" (expected event-journal, fact-set, or CorpusIRData)`);
      }
    }
  } else if (options.stdinLog) {
    const payload = extractPayload(options.stdinLog) as ExecutionLog | WorkoutResults;
    let executionLog: ExecutionLog;
    const rawLogs = payload.logs ?? ('statements' in payload ? payload.statements : undefined) ?? [];
    if ('results' in payload) {
      executionLog = { results: payload.results, logs: rawLogs, statements: rawLogs };
    } else {
      executionLog = { results: payload, logs: rawLogs, statements: rawLogs };
    }

    const identity = {
      noteId: 'stdin-note-1', resultId: 'stdin-result-1',
      origin: 'journal' as const, workoutTimestamp: executionLog.results.startTime,
    };
    data.eventRecords = [
      ...toEventRows(executionLog.logs, identity),
      ...toSummaryEventRows(executionLog.logs, identity),
    ];
  } else if (options.stdinFacts) {
    const payload = extractPayload(options.stdinFacts);
    if (Array.isArray(payload)) {
      data.facts = payload as AnalyticsDataPoint[];
    } else if (payload && typeof payload === 'object' && 'facts' in (payload as Record<string, unknown>)) {
      data.facts = (payload as { facts: AnalyticsDataPoint[] }).facts;
    }
  } else {
    throw new Error('No input dataset provided. Specify --corpus <path>, --stdin-log, or --stdin-facts.');
  }
  for (const note of data.notes) {
    if (typeof note.rawContent !== 'string' || !Number.isSafeInteger(note.sourceRevision) || note.sourceRevision < 1) {
      throw new Error('Incompatible corpus Note; exact rawContent and sourceRevision are required');
    }
    validateNoteBlocks(note.rawContent, note.blocks, note.sourceRevision);
    if (!data.blocks.some((row) => row.noteId === note.id)) {
      for (const [position, block] of Object.values(note.blocks).sort((a, b) => a.from - b.from).entries()) {
        const rawContent = note.rawContent.slice(block.from, block.to);
        const body = parseDocumentSections(rawContent)[0]?.displayContent ?? rawContent;
        data.blocks.push({
          id: `${note.id}:${block.id}`, noteId: note.id, blockId: block.id, blockVersion: block.version,
          sourceRevision: note.sourceRevision, from: block.from, to: block.to, position,
          dataType: block.kind, rawContent, noteTitle: note.title, createdAt: note.createdAt,
          ...(block.kind === 'wod' ? { blockContentId: blockContentId(body) } : {}),
        });
      }
    }
  }
  for (const session of data.results) {
    if ('segmentId' in session || 'segmentVersion' in session || 'data' in session || 'version' in session || 'rawContent' in session || !session.blockId || !Number.isSafeInteger(session.blockVersion) || session.blockVersion < 1) {
      throw new Error('Incompatible corpus Session; exact blockId/blockVersion pin required');
    }
    if (!data.revisions.some((row) => row.noteId === session.noteId && row.blockId === session.blockId && row.version === session.blockVersion && row.kind === 'wod')) {
      throw new Error('Corpus Session immutable revision is unavailable');
    }
  }
  for (const row of [...data.eventRecords, ...data.facts, ...data.blocks]) {
    if ('segmentId' in row || 'segmentVersion' in row) throw new Error('Incompatible corpus segment pin');
  }
  const revisions = new Map(data.revisions.map((row) => [JSON.stringify([row.noteId, row.blockId, row.version]), row]));
  for (const row of data.eventRecords) {
    if (row.blockId !== undefined || row.blockVersion !== undefined) {
      if (!row.blockId || !Number.isSafeInteger(row.blockVersion) || !revisions.has(JSON.stringify([row.noteId, row.blockId, row.blockVersion]))) {
        throw new Error('Corpus Event immutable revision is unavailable');
      }
    }
  }
  for (const row of data.blocks) {
    const note = data.notes.find((candidate) => candidate.id === row.noteId);
    const block = note?.blocks[row.blockId];
    if (!note || !block || row.blockVersion !== block.version || row.sourceRevision !== note.sourceRevision || row.from !== block.from || row.to !== block.to || row.dataType !== block.kind) {
      throw new Error('Corpus block projection does not match current Note source');
    }
    row.rawContent = note.rawContent.slice(block.from, block.to);
  }

  return data;
}

/**
 * Runs a WQL query against the provided in-memory dataset and returns a versioned IR envelope.
 */
export async function runQueryCli(
  wqlString: string,
  options: QueryCliOptions = {},
): Promise<WodWikiIRFile<QueryResult | RowsQueryResult | FindQueryResult | PipelineResult>> {
  const parsed = parseQuery(wqlString);
  if (parsed.error) {
    throw new WqlSyntaxError(wqlString, parsed.error);
  }

  const stores = options.stores ?? buildStoresFromData(loadQueryData(options));
  // Bundle form — carries the optional blockEfforts/tags seams when provided.
  const service = new QueryService(stores);

  if (isPipelineQuery(parsed)) {
    const result = await service.runPipeline(wqlString, {
      preferredUnit: options.preferredUnit,
    });
    return createIRFile('pipeline-result', result, { source: options.sourceLabel ?? 'cli:wod query' });
  }

  if (isFindQuery(parsed)) {
    const result = await service.runFind(parsed);
    const kind: IrKind = parsed.target === 'session' ? 'rows-result' : 'find-result';
    return createIRFile(kind, result, { source: options.sourceLabel ?? 'cli:wod query' });
  }

  const result = await service.runQuery(wqlString, {
    preferredUnit: options.preferredUnit,
  });
  return createIRFile('query-result', result, { source: options.sourceLabel ?? 'cli:wod query' });
}
