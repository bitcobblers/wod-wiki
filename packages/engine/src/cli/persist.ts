/**
 * Playground-parity persistence for `wod parse` / `wod run`.
 *
 * Replicates what the playground writes when a note is saved and when a
 * workout is recorded (IndexedDBContentProvider.saveEntry +
 * IndexedDBNotePersistence.mutateNote), against the shared sqlite storage:
 *
 *  - parse → one `notes` row + one `segments` row per document section +
 *    rebuilt `block_index` / `block_efforts` rows (+ domain projections)
 *  - run   → one `sessions` row + `grain:'event'` rows (1:1 per output
 *    statement) + `grain:'summary'` rows (toEventRows/toSummaryEventRows)
 *
 * Re-parsing a source versions its segments (old rows become isHistory)
 * instead of duplicating the note — segment ids are positional, so sessions
 * keep pointing at the latest version.
 */

import type {
  BlockEffort,
  BlockIndexRow,
  Note,
  NoteSegment,
  Session,
  StoreName,
  TxOp,
} from '@bitcobblers/wod-wiki-storage';
import type { ExecutionLog } from '../ir';
import type { EventRecord, StoredOutputStatement, WorkoutResults } from '@bitcobblers/wod-wiki-core';
import type { Section, ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import { parseScript } from '@bitcobblers/wod-wiki-lang';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { loadSql, randomId, stableNoteId, type CliDb, type SqlApi } from './db';

type SegmentDataType = NoteSegment['dataType'];

/** Mirror of the playground's toSegmentDataType (IndexedDBContentProvider). */
function toSegmentDataType(section: Pick<Section, 'type' | 'level'>): SegmentDataType {
  switch (section.type) {
    case 'time':
    case 'log':
      return 'wod';
    case 'title': {
      const level = Math.min(6, Math.max(1, section.level ?? 1));
      return `h${level}` as SegmentDataType;
    }
    case 'frontmatter':
      return 'frontmatter';
    case 'markdown':
    default:
      return 'markdown';
  }
}

/** Mirror of sectionSourceFragments — exact document slice per section. */
function sectionSourceFragments(content: string, sections: readonly Section[]): string[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return sections.map((section, index) => content.slice(
    starts[section.startLine],
    index + 1 < sections.length ? starts[sections[index + 1].startLine] : content.length,
  ));
}

/** Read ScriptBlock.contentId with runtime narrowing (segment.data is loosely typed). */
function scriptBlockContentId(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'contentId' in data && typeof data.contentId === 'string') {
    return data.contentId;
  }
  return undefined;
}

/** Mirror of StorageService.extractEffortSlugs. */
export function extractEffortSlugs(statements: readonly ICodeStatement[]): string[] {
  const slugs = new Set<string>();
  for (const statement of statements) {
    if (statement.exerciseId) {
      slugs.add(statement.exerciseId);
    } else {
      const effortMetric = statement.metrics?.getMetric?.('effort');
      const effort = effortMetric && 'effort' in effortMetric ? effortMetric.effort : undefined;
      if (typeof effort === 'string') {
        const slug = effort.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (slug) slugs.add(slug);
      }
    }
  }
  return [...slugs];
}

async function rowsByNote(sql: SqlApi, db: CliDb['db'], store: StoreName, noteId: string): Promise<unknown[]> {
  return sql.listRows(db, sql.storeDefinition(store), { only: noteId }, undefined, 'by-note');
}

export interface PersistNoteOptions {
  source: string;
  /** File path or '-' (stdin) — drives the stable note identity. */
  sourceLabel: string;
  /** Explicit note id — exported markdown carries a `wod-note-id` stamp
   * (exchange.ts) which overrides the path-derived id when present, making
   * download → edit → parse a round-trip into the same note. */
  noteId?: string;
  title?: string;
  now?: number;
}

export interface PersistNoteResult {
  noteId: string;
  note: Note;
  segments: number;
  blocks: number;
  efforts: number;
  created: boolean;
}

function titleFromLabel(sourceLabel: string): string {
  if (!sourceLabel || sourceLabel === '-') return 'stdin';
  const stem = sourceLabel.split('/').pop() ?? sourceLabel;
  return stem.replace(/\.[^.]+$/, '') || sourceLabel;
}

/** Upsert the note for a parsed source with fresh segments + block index. */
export async function persistNote(db: CliDb, options: PersistNoteOptions): Promise<PersistNoteResult> {
  const sql = await loadSql();
  const now = options.now ?? Date.now();
  const noteId = options.noteId ?? stableNoteId(options.sourceLabel, options.source);
  const title = options.title ?? titleFromLabel(options.sourceLabel);

  const sections = parseDocumentSections(options.source);
  const fragments = sectionSourceFragments(options.source, sections);
  const existingNote = (await noteById(sql, db.db, noteId)) as Note | undefined;
  const priorSegments = (await rowsByNote(sql, db.db, 'segments', noteId)) as NoteSegment[];

  // Version bump: existing segment ids get max(version)+1, new ids get 1;
  // every prior non-history row is marked history inside the same tx.
  const versionBySegmentId: Record<string, number> = {};
  for (const segment of priorSegments) {
    versionBySegmentId[segment.id] = Math.max(versionBySegmentId[segment.id] ?? 0, segment.version);
  }

  const createdAt = existingNote?.createdAt ?? now;
  const note: Note = {
    id: noteId,
    title,
    type: existingNote?.type ?? 'note',
    date: existingNote?.date ?? now,
    createdAt,
  };

  const ops: TxOp[] = [];
  const segments: NoteSegment[] = sections.map((section, position) => {
    const id = `${noteId}:${section.id}`;
    const version = (versionBySegmentId[id] ?? 0) + 1;
    return {
      id,
      version,
      noteId,
      position,
      dataType: toSegmentDataType(section),
      data: section.scriptBlock || null,
      rawContent: section.displayContent,
      sourceContent: fragments[position],
      createdAt: version === 1 ? createdAt : now,
      updatedAt: now,
      isHistory: false,
    };
  });
  for (const segment of priorSegments) {
    if (segment.isHistory !== true) {
      ops.push({ op: 'put', store: 'segments', value: { ...segment, isHistory: true, updatedAt: now } });
    }
  }
  ops.push({ op: 'put', store: 'notes', value: note });
  for (const segment of segments) ops.push({ op: 'put', store: 'segments', value: segment });

  // Block index rebuild: replace every derived row for this note.
  const priorBlocks = (await rowsByNote(sql, db.db, 'block_index', noteId)) as BlockIndexRow[];
  const priorBlockEfforts = (await rowsByNote(sql, db.db, 'block_efforts', noteId)) as BlockEffort[];
  for (const row of priorBlocks) ops.push({ op: 'delete', store: 'block_index', key: row.id });
  for (const row of priorBlockEfforts) ops.push({ op: 'delete', store: 'block_efforts', key: row.id });

  let blockCount = 0;
  let effortCount = 0;
  for (const segment of segments) {
    const blockContentId = segment.dataType === 'wod' ? scriptBlockContentId(segment.data) : undefined;
    ops.push({
      op: 'put',
      store: 'block_index',
      value: {
        id: `${noteId}:${segment.id}:${segment.version}`,
        noteId,
        segmentId: segment.id,
        segmentVersion: segment.version,
        position: segment.position,
        dataType: segment.dataType,
        blockContentId,
        rawContent: segment.rawContent,
        noteTitle: title,
        createdAt: segment.createdAt,
      } satisfies BlockIndexRow,
    });
    blockCount += 1;

    if (segment.dataType === 'wod' && segment.rawContent) {
      const script = parseScript(segment.rawContent);
      for (const effortSlug of extractEffortSlugs(script.statements)) {
        ops.push({
          op: 'put',
          store: 'block_efforts',
          value: {
            id: `${noteId}:${segment.id}:${effortSlug}`,
            noteId,
            blockId: segment.id,
            blockContentId,
            effortSlug,
            createdAt: segment.createdAt,
          } satisfies BlockEffort,
        });
        effortCount += 1;
      }
    }
  }

  await db.db.transaction(async (tx) => {
    await sql.refreshDomain(tx, ops);
  });

  return {
    noteId,
    note,
    segments: segments.length,
    blocks: blockCount,
    efforts: effortCount,
    created: existingNote === undefined,
  };
}

async function noteById(sql: SqlApi, db: CliDb['db'], noteId: string): Promise<unknown> {
  const rows = await sql.listRows(db, sql.storeDefinition('notes'));
  return (rows as Array<{ id: string }>).find((row) => row.id === noteId);
}

export interface PersistRunOptions {
  source: string;
  sourceLabel: string;
  title?: string;
  executionLog: ExecutionLog;
  now?: number;
}

export interface PersistRunResult {
  noteId: string;
  resultId: string;
  session: Session;
  events: number;
  summaries: number;
  noteCreated: boolean;
}

/**
 * Record an execution against the note for its source: session row +
 * event/summary rows, the same grain model the playground writes.
 */
export async function persistRun(db: CliDb, options: PersistRunOptions): Promise<PersistRunResult> {
  const sql = await loadSql();
  const results: WorkoutResults = options.executionLog.results;
  const logs: StoredOutputStatement[] = options.executionLog.logs ?? [];

  // Ensure the note exists (playground saves pending content before recording).
  const noteState = await persistNote(db, {
    source: options.source,
    sourceLabel: options.sourceLabel,
    title: options.title,
    now: options.now,
  });

  // The run block is the first wod segment of the note (document order).
  const segments = ((await rowsByNote(sql, db.db, 'segments', noteState.noteId)) as NoteSegment[])
    .filter((s) => s.isHistory !== true && s.dataType === 'wod')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const runSegment = segments[0];
  const blockContentId = runSegment ? scriptBlockContentId(runSegment.data) : undefined;

  const resultId = randomId();
  const session: Session = {
    id: resultId,
    segmentId: runSegment?.id,
    segmentVersion: runSegment?.version,
    noteId: noteState.noteId,
    blockId: runSegment?.id,
    blockContentId,
    origin: 'journal',
    status: results.completed === false ? 'in-progress' : 'completed',
    startTime: results.startTime,
    endTime: results.endTime,
    duration: results.duration ?? 0,
    completed: results.completed,
    createdAt: results.endTime || Date.now(),
  };

  const identity = {
    noteId: noteState.noteId,
    resultId,
    segmentId: session.segmentId,
    segmentVersion: session.segmentVersion,
    blockContentId,
    origin: session.origin,
    pageId: session.pageId,
    workoutTimestamp: session.createdAt,
  };
  const eventRows = toEventRows(logs, identity);
  const summaryRows = toSummaryEventRows(logs, identity);

  await db.db.transaction(async (tx) => {
    await sql.putRow(tx, sql.storeDefinition('sessions'), session);
    const eventsDef = sql.storeDefinition('events');
    for (const row of [...eventRows, ...summaryRows]) await sql.putRow(tx, eventsDef, row);
  });

  return {
    noteId: noteState.noteId,
    resultId,
    session,
    events: eventRows.length,
    summaries: summaryRows.length,
    noteCreated: noteState.created,
  };
}

/**
 * Upsert an exported session + its events verbatim (id-keyed, so re-imports
 * are idempotent). Used by `wod import session` for round-tripping a
 * downloaded CSV into the same — or a clean — database. Rows referencing a
 * note the target database does not have get a stub note so the session
 * stays visible and queryable.
 */
export async function persistSessionBundle(
  db: CliDb,
  session: Session,
  events: readonly EventRecord[],
): Promise<{ events: number; noteCreated: boolean }> {
  const sql = await loadSql();
  const existing = await noteById(sql, db.db, session.noteId);
  let noteCreated = false;
  if (!existing) {
    noteCreated = true;
    const now = session.createdAt || Date.now();
    await db.db.transaction(async (tx) => {
      await sql.putRow(tx, sql.storeDefinition('notes'), {
        id: session.noteId,
        title: `imported-${session.noteId.slice(0, 8)}`,
        createdAt: now,
        type: 'note',
      });
    });
  }
  await db.db.transaction(async (tx) => {
    await sql.putRow(tx, sql.storeDefinition('sessions'), session);
    const eventsDef = sql.storeDefinition('events');
    for (const row of events) await sql.putRow(tx, eventsDef, row);
  });
  return { events: events.length, noteCreated };
}
