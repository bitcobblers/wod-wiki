import { validateNoteBlocks } from '@bitcobblers/wod-wiki-core';
import type { Note, BlockRevision, Session, EventRecord, NoteBlock } from '@bitcobblers/wod-wiki-core';

export interface CorpusJournal {
  $schema: string;
  kind: 'event-journal';
  id: string;
  title: string;
  description: string;
  notes: Note[];
  records: EventRecord[];
  blockRevisions: BlockRevision[];
  sessions: Session[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected corpus object');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected corpus string');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite corpus number');
  return value;
}
function positive(value: unknown): number {
  const result = number(value);
  if (!Number.isInteger(result) || result < 1) throw new Error('Expected positive corpus version');
  return result;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected corpus array');
  return value;
}
function kind(value: unknown): NoteBlock['kind'] {
  if (value !== 'wod' && value !== 'query' && value !== 'widget' && value !== 'embed') throw new Error('Invalid block kind');
  return value;
}
function dialect(value: unknown): 'time' | 'log' | undefined {
  if (value === undefined || value === 'time' || value === 'log') return value;
  throw new Error('Invalid workout dialect');
}
function origin(value: unknown): EventRecord['origin'] {
  if (value === undefined || value === 'journal' || value === 'playground' || value === 'user') return value;
  throw new Error('Invalid corpus origin');
}

export function parseCorpusJournal(value: unknown): CorpusJournal {
  const input = object(value);
  if (input.kind !== 'event-journal') throw new Error('Invalid corpus journal kind');
  const notes = array(input.notes).map(value => {
    const row = object(value);
    const blocks: Note['blocks'] = {};
    for (const [key, value] of Object.entries(object(row.blocks))) {
      const block = object(value);
      blocks[key] = { id: string(block.id), kind: kind(block.kind), version: positive(block.version),
        sourceRevision: positive(block.sourceRevision), from: number(block.from), to: number(block.to),
        dialect: dialect(block.dialect), sport: block.sport === undefined ? undefined : string(block.sport) };
    }
    const note: Note = { id: string(row.id), title: string(row.title), createdAt: number(row.createdAt),
      rawContent: string(row.rawContent), sourceRevision: positive(row.sourceRevision), blocks,
      tags: row.tags === undefined ? undefined : array(row.tags).map(string),
      sourceId: row.sourceId === undefined ? undefined : string(row.sourceId),
      type: row.type === undefined ? undefined : string(row.type) };
    validateNoteBlocks(note.rawContent, note.blocks, note.sourceRevision);
    return note;
  });
  const blockRevisions = array(input.blockRevisions).map(value => {
    const row = object(value);
    return { noteId: string(row.noteId), blockId: string(row.blockId), version: positive(row.version),
      kind: kind(row.kind), rawContent: string(row.rawContent), savedAt: number(row.savedAt),
      dialect: dialect(row.dialect), sport: row.sport === undefined ? undefined : string(row.sport) } satisfies BlockRevision;
  });
  const records: EventRecord[] = array(input.records).map(value => {
    const row = object(value);
    if (row.grain !== 'event' && row.grain !== 'summary') throw new Error('Invalid corpus grain');
    const metrics = array(row.metrics).map(value => {
      const metric = object(value);
      return { type: string(metric.type), value: metric.value,
        unit: metric.unit === undefined ? undefined : string(metric.unit),
        origin: metric.origin === undefined ? undefined : string(metric.origin),
        metadata: metric.metadata === undefined ? undefined : object(metric.metadata) };
    });
    const representation = row.representationKind;
    if (representation !== undefined && representation !== 'direct' && representation !== 'calculated'
      && representation !== 'substitute_summary') throw new Error('Invalid corpus representation');
    const stats = row.reducerStats === undefined ? undefined : object(row.reducerStats);
    const timeSpan = row.timeSpan === undefined ? undefined : object(row.timeSpan);
    return { id: string(row.id), resultId: string(row.resultId), noteId: string(row.noteId),
      outputType: string(row.outputType), timestamp: number(row.timestamp), grain: row.grain, origin: origin(row.origin), metrics,
      blockId: row.blockId === undefined ? undefined : string(row.blockId),
      blockVersion: row.blockVersion === undefined ? undefined : positive(row.blockVersion),
      blockContentId: row.blockContentId === undefined ? undefined : string(row.blockContentId),
      effortSlug: row.effortSlug === undefined ? undefined : string(row.effortSlug), representationKind: representation,
      timeSpan: timeSpan && { started: number(timeSpan.started), ended: timeSpan.ended === undefined ? undefined : number(timeSpan.ended) },
      reducerStats: stats && {
        observedCount: stats.observedCount === undefined ? undefined : number(stats.observedCount),
        sum: stats.sum === undefined ? undefined : number(stats.sum),
        min: stats.min === undefined ? undefined : number(stats.min),
        max: stats.max === undefined ? undefined : number(stats.max),
      },
    };
  });
  const sessions = array(input.sessions).map(value => {
    const row = object(value);
    if (typeof row.completed !== 'boolean' || row.status !== 'completed') throw new Error('Invalid corpus session');
    return { id: string(row.id), noteId: string(row.noteId), blockId: string(row.blockId), blockVersion: positive(row.blockVersion),
      blockContentId: row.blockContentId === undefined ? undefined : string(row.blockContentId), origin: origin(row.origin),
      status: 'completed', startTime: number(row.startTime), endTime: number(row.endTime), duration: number(row.duration),
      completed: row.completed, createdAt: number(row.createdAt) } satisfies Session;
  });
  const revisions = new Map(blockRevisions.map(row => [JSON.stringify([row.noteId, row.blockId, row.version]), row]));
  for (const note of notes) for (const block of Object.values(note.blocks)) {
    const revision = revisions.get(JSON.stringify([note.id, block.id, block.version]));
    if (!revision || revision.rawContent !== note.rawContent.slice(block.from, block.to) || revision.kind !== block.kind
      || revision.dialect !== block.dialect || revision.sport !== block.sport) throw new Error('Invalid current corpus revision');
  }
  for (const session of sessions) {
    if (!revisions.has(JSON.stringify([session.noteId, session.blockId, session.blockVersion]))) throw new Error('Unresolved corpus session pin');
  }
  for (const record of records) {
    if (record.blockId && !revisions.has(JSON.stringify([record.noteId, record.blockId, record.blockVersion]))) throw new Error('Unresolved corpus event pin');
  }
  return { $schema: string(input.$schema), kind: 'event-journal', id: string(input.id), title: string(input.title),
    description: string(input.description), notes, records, blockRevisions, sessions };
}
