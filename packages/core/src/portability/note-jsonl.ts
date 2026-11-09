import type { BlockRevision, EventRecord, NoteBlock, Session } from '../types/storage';

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
}

export interface NoteTelemetryBundle {
  note?: NoteJsonlNote;
  sessions: Session[];
  events: EventRecord[];
  revisions?: BlockRevision[];
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
    && (value.sourceId === undefined || typeof value.sourceId === 'string');
}

function validSession(value: Record<string, unknown>): boolean {
  return isString(value.id) && isString(value.noteId) && isString(value.blockId)
    && isPositiveInteger(value.blockVersion) && isString(value.blockContentId)
    && hasValidOrigin(value.origin)
    && (value.status === undefined || value.status === 'in-progress' || value.status === 'completed')
    && isFiniteNumber(value.startTime) && isFiniteNumber(value.endTime)
    && isFiniteNumber(value.duration) && typeof value.completed === 'boolean'
    && isFiniteNumber(value.createdAt);
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

function revisionToJsonl(revision: BlockRevision): RevisionJsonlRecord {
  const { kind: blockKind, ...identity } = revision;
  return { kind: 'revision', blockKind, ...identity };
}

export function serializeNoteBundleToJsonl(bundle: NoteTelemetryBundle): string {
  const records: JsonlRecord[] = [
    ...(bundle.note ? [{ kind: 'note' as const, ...bundle.note }] : []),
    ...bundle.sessions.map((session) => ({ kind: 'session' as const, ...session })),
    ...(bundle.revisions ?? []).map(revisionToJsonl),
    ...bundle.events.map((event) => ({ kind: 'event' as const, ...event })),
  ];
  return records.map((record) => JSON.stringify(record)).join('\n');
}

export async function* streamNoteBundleToJsonlLines(
  bundles: Iterable<NoteTelemetryBundle> | AsyncIterable<NoteTelemetryBundle>,
): AsyncGenerator<string, void, unknown> {
  for await (const bundle of bundles) {
    if (bundle.note) yield JSON.stringify({ kind: 'note', ...bundle.note });
    for (const session of bundle.sessions) yield JSON.stringify({ kind: 'session', ...session });
    for (const revision of bundle.revisions ?? []) yield JSON.stringify(revisionToJsonl(revision));
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
