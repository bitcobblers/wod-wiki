import type {
  BlockRevision,
  EventRecord,
  NoteBlock,
  NoteRevision,
  NotebookLink,
  ScheduleItem,
  Session,
} from '../types/storage';

export interface NoteJsonlNote {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  targetDate: number;
  rawContent: string;
  sourceRevision?: number;
  blocks?: Record<string, NoteBlock>;
  tags?: string[];
  type?: string;
  sourceId?: string;
  notebookIds?: string[];
}

export interface ParseLoadRecord {
  id: string;
  noteId: string;
  blockId?: string;
  blockVersion?: number;
  stage: 'parse' | 'load';
  status: 'ok' | 'warning' | 'error';
  timestamp: number;
  diagnostics?: string[];
  metrics?: Record<string, unknown>;
}

export interface NoteTelemetryBundle {
  note?: NoteJsonlNote;
  sessions: Session[];
  events: EventRecord[];
  revisions?: BlockRevision[];
  noteRevisions?: NoteRevision[];
  scheduleItems?: ScheduleItem[];
  notebookLinks?: NotebookLink[];
  parses?: ParseLoadRecord[];
}

export interface NoteTelemetryBundleResult {
  bundles: NoteTelemetryBundle[];
  errors: string[];
}

type RevisionJsonlRecord = Omit<BlockRevision, 'kind'> & {
  kind: 'revision';
  blockKind: BlockRevision['kind'];
};

type JsonlRecord =
  | ({ kind: 'note' } & NoteJsonlNote)
  | ({ kind: 'session' } & Session)
  | ({ kind: 'event' } & EventRecord)
  | ({ kind: 'parse' } & ParseLoadRecord)
  | ({ kind: 'note_revision' } & NoteRevision)
  | ({ kind: 'schedule_item' } & ScheduleItem)
  | ({ kind: 'notebook_link' } & NotebookLink)
  | RevisionJsonlRecord;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasValidOrigin(value: unknown): boolean {
  return value === undefined || value === 'journal' || value === 'playground' || value === 'user';
}

function validNote(value: Record<string, unknown>): boolean {
  return isString(value.id) && typeof value.title === 'string'
    && isFiniteNumber(value.createdAt) && isFiniteNumber(value.updatedAt)
    && isFiniteNumber(value.targetDate) && typeof value.rawContent === 'string'
    && (value.sourceRevision === undefined || isPositiveInteger(value.sourceRevision))
    && (value.blocks === undefined || isObject(value.blocks))
    && (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string')))
    && (value.type === undefined || typeof value.type === 'string')
    && (value.sourceId === undefined || typeof value.sourceId === 'string')
    && (value.notebookIds === undefined || (Array.isArray(value.notebookIds) && value.notebookIds.every((id) => typeof id === 'string')));
}

function validSession(value: Record<string, unknown>): boolean {
  return isString(value.id) && isString(value.noteId) && isString(value.blockId)
    && isPositiveInteger(value.blockVersion) && isString(value.blockContentId)
    && (value.noteSourceRevision === undefined || isPositiveInteger(value.noteSourceRevision))
    && (value.sessionDate === undefined || isString(value.sessionDate))
    && (value.scheduleItemId === undefined || isString(value.scheduleItemId))
    && (value.pageId === undefined || typeof value.pageId === 'string')
    && hasValidOrigin(value.origin)
    && (value.status === undefined || value.status === 'in-progress' || value.status === 'completed')
    && (value.public === undefined || typeof value.public === 'boolean')
    && isFiniteNumber(value.startTime) && isFiniteNumber(value.endTime)
    && isFiniteNumber(value.duration) && typeof value.completed === 'boolean'
    && isFiniteNumber(value.createdAt);
}

function validParseRecord(value: Record<string, unknown>): boolean {
  return isString(value.id) && isString(value.noteId)
    && (value.blockId === undefined || isString(value.blockId))
    && (value.blockVersion === undefined || isPositiveInteger(value.blockVersion))
    && (value.stage === 'parse' || value.stage === 'load')
    && (value.status === 'ok' || value.status === 'warning' || value.status === 'error')
    && isFiniteNumber(value.timestamp)
    && (value.diagnostics === undefined || (Array.isArray(value.diagnostics) && value.diagnostics.every((d) => typeof d === 'string')))
    && (value.metrics === undefined || isObject(value.metrics));
}

function validEvent(value: Record<string, unknown>): boolean {
  return isString(value.id) && isString(value.resultId) && isString(value.noteId)
    && isString(value.blockId) && isPositiveInteger(value.blockVersion)
    && isString(value.blockContentId) && hasValidOrigin(value.origin)
    && isFiniteNumber(value.timestamp) && (value.grain === 'event' || value.grain === 'summary')
    && typeof value.outputType === 'string' && Array.isArray(value.metrics)
    && value.metrics.every((metric) => isObject(metric) && typeof metric.type === 'string')
    && (value.grain !== 'summary' || value.metrics.length === 1)
    && (value.representationKind === undefined || value.representationKind === 'direct'
      || value.representationKind === 'calculated' || value.representationKind === 'substitute_summary');
}

function validRevision(value: Record<string, unknown>): boolean {
  return isString(value.noteId) && isString(value.blockId) && isPositiveInteger(value.version)
    && ['wod', 'query', 'widget', 'embed'].includes(String(value.blockKind))
    && typeof value.rawContent === 'string' && isFiniteNumber(value.savedAt)
    && (value.dialect === undefined || value.dialect === 'time' || value.dialect === 'log')
    && (value.sport === undefined || typeof value.sport === 'string');
}

function validNoteRevision(value: Record<string, unknown>): boolean {
  return isString(value.noteId) && isPositiveInteger(value.version)
    && typeof value.title === 'string' && typeof value.rawContent === 'string'
    && isObject(value.blocks) && isFiniteNumber(value.savedAt)
    && (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string')))
    && (value.notebookIds === undefined || (Array.isArray(value.notebookIds) && value.notebookIds.every((id) => typeof id === 'string')))
    && (value.type === undefined || typeof value.type === 'string');
}

function validScheduleItem(value: Record<string, unknown>): boolean {
  return isString(value.id) && isString(value.date) && isString(value.noteId)
    && isFiniteNumber(value.position)
    && (value.status === 'planned' || value.status === 'completed' || value.status === 'skipped' || value.status === 'moved')
    && isFiniteNumber(value.createdAt) && isFiniteNumber(value.updatedAt)
    && (value.pageId === undefined || typeof value.pageId === 'string')
    && (value.sourceNotebookId === undefined || typeof value.sourceNotebookId === 'string')
    && (value.fallbackTitle === undefined || typeof value.fallbackTitle === 'string')
    && (value.blockId === undefined || typeof value.blockId === 'string')
    && (value.slot === undefined || typeof value.slot === 'string')
    && (value.notes === undefined || typeof value.notes === 'string')
    && (value.movedFromDate === undefined || typeof value.movedFromDate === 'string');
}

function validNotebookLink(value: Record<string, unknown>): boolean {
  return isString(value.id) && isString(value.notebookId)
    && (value.targetKind === 'note' || value.targetKind === 'session')
    && isString(value.targetId) && isString(value.noteId)
    && isFiniteNumber(value.createdAt);
}

function revisionToJsonl(revision: BlockRevision): RevisionJsonlRecord {
  const { kind: blockKind, ...identity } = revision;
  return { kind: 'revision', blockKind, ...identity };
}

export function serializeNoteBundleToJsonl(bundle: NoteTelemetryBundle): string {
  const records: JsonlRecord[] = [
    ...(bundle.note ? [{ kind: 'note' as const, ...bundle.note }] : []),
    ...(bundle.noteRevisions ?? []).map((rev) => ({ kind: 'note_revision' as const, ...rev })),
    ...(bundle.revisions ?? []).map(revisionToJsonl),
    ...(bundle.notebookLinks ?? []).map((link) => ({ kind: 'notebook_link' as const, ...link })),
    ...(bundle.scheduleItems ?? []).map((item) => ({ kind: 'schedule_item' as const, ...item })),
    ...(bundle.parses ?? []).map((parse) => ({ kind: 'parse' as const, ...parse })),
    ...bundle.sessions.map((session) => ({ kind: 'session' as const, ...session })),
    ...bundle.events.map((event) => ({ kind: 'event' as const, ...event })),
  ];
  return records.map((record) => JSON.stringify(record)).join('\n');
}

export async function* streamNoteBundleToJsonlLines(
  bundles: Iterable<NoteTelemetryBundle> | AsyncIterable<NoteTelemetryBundle>,
): AsyncGenerator<string, void, unknown> {
  for await (const bundle of bundles) {
    if (bundle.note) yield JSON.stringify({ kind: 'note', ...bundle.note });
    for (const noteRevision of bundle.noteRevisions ?? []) yield JSON.stringify({ kind: 'note_revision', ...noteRevision });
    for (const revision of bundle.revisions ?? []) yield JSON.stringify(revisionToJsonl(revision));
    for (const link of bundle.notebookLinks ?? []) yield JSON.stringify({ kind: 'notebook_link', ...link });
    for (const item of bundle.scheduleItems ?? []) yield JSON.stringify({ kind: 'schedule_item', ...item });
    for (const parse of bundle.parses ?? []) yield JSON.stringify({ kind: 'parse', ...parse });
    for (const session of bundle.sessions) yield JSON.stringify({ kind: 'session', ...session });
    for (const event of bundle.events) yield JSON.stringify({ kind: 'event', ...event });
  }
}

export function parseNoteBundleFromJsonl(jsonlText: string): NoteTelemetryBundleResult {
  const bundles = new Map<string, NoteTelemetryBundle>();
  const errors: string[] = [];
  const lines = jsonlText.split(/\r?\n/);

  const bundleFor = (noteId: string): NoteTelemetryBundle => {
    const existing = bundles.get(noteId);
    if (existing) return existing;
    const created: NoteTelemetryBundle = { sessions: [], events: [] };
    bundles.set(noteId, created);
    return created;
  };

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const lineNumber = index + 1;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isObject(parsed) || typeof parsed.kind !== 'string') {
        errors.push(`Line ${lineNumber}: missing record kind`);
        continue;
      }
      const { kind, ...value } = parsed;
      if (kind === 'note') {
        if (!validNote(value)) {
          errors.push(`Line ${lineNumber}: invalid note record`);
          continue;
        }
        const note = value as unknown as NoteJsonlNote;
        const bundle = bundleFor(note.id);
        if (bundle.note) {
          errors.push(`Line ${lineNumber}: duplicate note ${note.id}`);
          continue;
        }
        bundle.note = note;
      } else if (kind === 'revision') {
        if (!validRevision(value)) {
          errors.push(`Line ${lineNumber}: invalid revision record`);
          continue;
        }
        const { blockKind, ...identity } = value;
        const revision = { ...identity, kind: blockKind } as unknown as BlockRevision;
        (bundleFor(revision.noteId).revisions ??= []).push(revision);
      } else if (kind === 'note_revision') {
        if (!validNoteRevision(value)) {
          errors.push(`Line ${lineNumber}: invalid note_revision record`);
          continue;
        }
        const noteRevision = value as unknown as NoteRevision;
        (bundleFor(noteRevision.noteId).noteRevisions ??= []).push(noteRevision);
      } else if (kind === 'schedule_item') {
        if (!validScheduleItem(value)) {
          errors.push(`Line ${lineNumber}: invalid schedule_item record`);
          continue;
        }
        const scheduleItem = value as unknown as ScheduleItem;
        (bundleFor(scheduleItem.noteId).scheduleItems ??= []).push(scheduleItem);
      } else if (kind === 'notebook_link') {
        if (!validNotebookLink(value)) {
          errors.push(`Line ${lineNumber}: invalid notebook_link record`);
          continue;
        }
        const link = value as unknown as NotebookLink;
        (bundleFor(link.noteId).notebookLinks ??= []).push(link);
      } else if (kind === 'session') {
        if (!validSession(value)) {
          errors.push(`Line ${lineNumber}: invalid session record`);
          continue;
        }
        const session = value as unknown as Session;
        bundleFor(session.noteId).sessions.push(session);
      } else if (kind === 'event') {
        if (!validEvent(value)) {
          errors.push(`Line ${lineNumber}: invalid event record`);
          continue;
        }
        const event = value as unknown as EventRecord;
        bundleFor(event.noteId).events.push(event);
      } else if (kind === 'parse') {
        if (!validParseRecord(value)) {
          errors.push(`Line ${lineNumber}: invalid parse/load record`);
          continue;
        }
        const parseRec = value as unknown as ParseLoadRecord;
        (bundleFor(parseRec.noteId).parses ??= []).push(parseRec);
      } else {
        errors.push(`Line ${lineNumber}: unknown record kind ${kind}`);
      }
    } catch (error) {
      errors.push(`Line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const bundle of bundles.values()) {
    const sessionIds = new Set(bundle.sessions.map((session) => session.id));
    for (const event of bundle.events) {
      if (!sessionIds.has(event.resultId)) {
        errors.push(`Event ${event.id}: no session ${event.resultId} for note ${event.noteId}`);
      }
    }
  }

  return { bundles: [...bundles.values()], errors };
}
