/**
 * Import / Export exchange formats for notes and sessions.
 *
 * Pure row→string / string→row transforms with NO storage or fs coupling,
 * so the playground website can offer the same downloads/uploads against
 * IndexedDB rows while the CLI uses them over sqlite. Round-trip is a
 * design requirement: every export carries the identity needed to import
 * back into the same database (upsert) or into a clean one (recreate).
 *
 *  - Notes  → markdown composed from segment rows (as-of a chosen version),
 *    with a `wod-note-id` frontmatter key stamped for identity. `wod parse`
 *    adopts that identity, so edit-and-re-parse updates the same note.
 *  - Sessions → one CSV row per metric (event + summary grains), session
 *    fields repeated per row plus one session-only anchor row, so a clean
 *    import recreates the session and its events verbatim.
 */

import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { Note, NoteSegment, Session } from '@bitcobblers/wod-wiki-storage';

// ---------------------------------------------------------------------------
// Note markdown composition
// ---------------------------------------------------------------------------

/** Identity stamped into exported note markdown so imports can find their note. */
export const NOTE_ID_FRONTMATTER_KEY = 'wod-note-id';

export interface NoteIdentity { noteId: string; title?: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read the stamped note identity from the leading frontmatter block, if any. */
export function extractNoteIdentity(markdown: string): NoteIdentity | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!block) return undefined;
  let noteId: string | undefined;
  let title: string | undefined;
  for (const line of block[1].split(/\r?\n/)) {
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (key === NOTE_ID_FRONTMATTER_KEY && UUID_RE.test(value)) noteId = value;
    if (key === 'title' && value) title = value;
  }
  return noteId ? { noteId, title } : undefined;
}

/** True when a scalar is safe to emit bare in a `key: value` frontmatter line. */
const FRONTMATTER_SAFE = /^[^:#\[\]{}'"*&,!?|>%@`\s][^:#\[\]{}"']*$/;

/**
 * Ensure the leading frontmatter carries `title` + `wod-note-id`. Existing
 * keys are replaced in place; a missing block is prepended. Scalars needing
 * YAML quoting are skipped (the note row title is authoritative in storage).
 */
export function injectIdentityFrontmatter(markdown: string, identity: NoteIdentity): string {
  const stamp = (lines: string[]): string[] => {
    const replaceOrInsert = (key: string, value: string | undefined): void => {
      if (value === undefined || !FRONTMATTER_SAFE.test(value)) return;
      const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
      if (idx >= 0) lines[idx] = `${key}: ${value}`;
      else lines.push(`${key}: ${value}`);
    };
    replaceOrInsert('title', identity.title);
    replaceOrInsert(NOTE_ID_FRONTMATTER_KEY, identity.noteId);
    return lines;
  };

  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (block) {
    const lines = stamp(block[1].split(/\r?\n/));
    return `---\n${lines.join('\n')}\n---${markdown.slice(block[0].length)}`;
  }
  const lines = stamp([]);
  return `---\n${lines.join('\n')}\n---\n\n${markdown}`;
}

/** Re-add source delimiters for segments without an exact source slice. */
function segmentToFragment(segment: NoteSegment): string {
  if (segment.sourceContent !== undefined) return segment.sourceContent;
  if (segment.dataType === 'wod') {
    const block = segment.data as { dialect?: string; sport?: string } | null;
    const dialect = block?.dialect ?? 'time';
    const fenceTag = block?.sport ? `${dialect}:${block.sport}` : dialect;
    return `\`\`\`${fenceTag}\n${segment.rawContent}\n\`\`\``;
  }
  if (segment.dataType === 'frontmatter') {
    return `---\n${segment.rawContent}\n---`;
  }
  return segment.rawContent;
}

/**
 * Compose a note's markdown as-of `version` (default: latest). Per segment
 * id the row with the highest version ≤ the target wins — versions beyond
 * the target never appear, segments that never reached it contribute their
 * latest. The result is stamped with the note identity for re-import.
 */
export function composeNoteMarkdown(
  note: Note,
  segments: readonly NoteSegment[],
  version?: number,
): string {
  const cap = version ?? Number.MAX_SAFE_INTEGER;
  const bySegmentId: Record<string, NoteSegment> = {};
  for (const segment of segments) {
    if (segment.version > cap) continue;
    const current = bySegmentId[segment.id];
    if (!current || segment.version > current.version) bySegmentId[segment.id] = segment;
  }
  const picked = Object.values(bySegmentId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const markdown = picked.map(segmentToFragment).join('');
  return injectIdentityFrontmatter(markdown, { noteId: note.id, title: note.title });
}

// ---------------------------------------------------------------------------
// Session CSV
// ---------------------------------------------------------------------------

type Metric = {
  type?: string;
  value?: unknown;
  unit?: string;
  image?: string;
  origin?: string;
  metadata?: unknown;
  name?: string;
};

const SESSION_HEADER = [
  'sessionId', 'noteId', 'segmentId', 'segmentVersion', 'blockId', 'blockContentId',
  'origin', 'status', 'startTime', 'endTime', 'duration', 'completed', 'sessionCreatedAt',
] as const;

const EVENT_HEADER = [
  'eventId', 'grain', 'outputType', 'timestamp', 'pageId', 'effortSlug',
  'eventSegmentId', 'eventSegmentVersion', 'eventBlockContentId', 'eventOrigin',
  'timeSpan', 'sourceBlockKey', 'sourceStatementId', 'line', 'text', 'dialect',
  'stackLevel', 'completionReason', 'representationKind',
  'metricType', 'metricValue', 'metricUnit', 'metricImage', 'metricOrigin',
  'metricMetadata', 'metricTemporal',
] as const;

export const SESSION_CSV_HEADER = [...SESSION_HEADER, ...EVENT_HEADER];

function escapeCsvField(field: unknown): string {
  if (field === undefined || field === null) return '';
  const str = typeof field === 'object' ? JSON.stringify(field) : String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const metricValueToCell = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const metricValueFromCell = (cell: string): unknown => {
  if (cell === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(cell)) return Number(cell);
  if (cell === 'true' || cell === 'false') return cell === 'true';
  if (cell.startsWith('{') || cell.startsWith('[')) {
    try {
      return JSON.parse(cell);
    } catch {
      return cell;
    }
  }
  return cell;
};

function sessionCells(session: Session): string[] {
  return [
    session.id, session.noteId, session.segmentId, session.segmentVersion,
    session.blockId, session.blockContentId, session.origin, session.status,
    session.startTime, session.endTime, session.duration, session.completed,
    session.createdAt,
  ].map(escapeCsvField);
}

function metricCells(event: EventRecord, metric: Metric, index: number): string[] {
  return [
    event.id, event.grain, event.outputType, event.timestamp, event.pageId, event.effortSlug,
    event.segmentId, event.segmentVersion, event.blockContentId, event.origin,
    event.timeSpan, event.sourceBlockKey, event.sourceStatementId, event.line, event.text, event.dialect,
    event.stackLevel, event.completionReason, event.representationKind,
    metric.type, metricValueToCell(metric.value), metric.unit, metric.image, metric.origin,
    metric.metadata === undefined ? '' : JSON.stringify(metric.metadata),
    event.metricTemporal?.[index] === undefined ? '' : JSON.stringify(event.metricTemporal[index]),
  ].map(escapeCsvField);
}

/**
 * Serialize a session + its events to CSV — one row per metric, preceded by
 * one session anchor row (empty event columns). Import with
 * {@link csvToSessionRows}.
 */
export function sessionToCsv(session: Session, events: readonly EventRecord[]): string {
  const lines = [SESSION_CSV_HEADER.join(',')];
  lines.push([...sessionCells(session), ...EVENT_HEADER.map(() => '')].join(','));
  const ordered = [...events].sort((a, b) => a.id.localeCompare(b.id));
  for (const event of ordered) {
    const metrics = event.metrics ?? [];
    if (metrics.length === 0) {
      lines.push([...sessionCells(session), ...metricCells(event, { type: '' }, 0)].join(','));
      continue;
    }
    for (let i = 0; i < metrics.length; i++) {
      lines.push([...sessionCells(session), ...metricCells(event, metrics[i], i)].join(','));
    }
  }
  return lines.join('\n') + '\n';
}

/** Parse one CSV line, honoring double-quoted fields (RFC 4180 subset). */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === '') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/** Split CSV into records on newlines that are NOT inside quoted fields. */
export function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        current += '""';
        i += 1;
        continue;
      }
      quoted = !quoted;
      current += ch;
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1;
      if (current.length > 0) records.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) records.push(current);
  return records;
}

export interface SessionImportRows {
  session: Session;
  events: EventRecord[];
}

const num = (cell: string): number | undefined => (cell === '' ? undefined : Number(cell));

function jsonCell<T>(cell: string): T | undefined {
  if (!cell) return undefined;
  try {
    return JSON.parse(cell) as T;
  } catch {
    return undefined;
  }
}

/**
 * Parse {@link sessionToCsv} output back into a session + event rows.
 * The session anchor row may be absent (pure event export) as long as
 * session columns are present on the event rows.
 */
export function csvToSessionRows(csv: string): SessionImportRows {
  const lines = splitCsvRecords(csv);
  if (lines.length < 2) throw new Error('[wod import] Session CSV has no data rows');
  const header = parseCsvLine(lines[0]);
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`[wod import] Session CSV missing column "${name}"`);
    return idx;
  };
  const at = (cells: string[], name: string): string => cells[col(name)] ?? '';

  const eventRows = new Map<string, EventRecord>();
  let session: Session | undefined;

  const ensureSession = (cells: string[]): Session => {
    if (session) return session;
    session = {
      id: at(cells, 'sessionId'),
      noteId: at(cells, 'noteId'),
      segmentId: at(cells, 'segmentId') || undefined,
      segmentVersion: num(at(cells, 'segmentVersion')),
      blockId: at(cells, 'blockId') || undefined,
      blockContentId: at(cells, 'blockContentId') || undefined,
      origin: (at(cells, 'origin') || undefined) as Session['origin'],
      status: (at(cells, 'status') || undefined) as Session['status'],
      startTime: Number(at(cells, 'startTime') || 0),
      endTime: Number(at(cells, 'endTime') || 0),
      duration: Number(at(cells, 'duration') || 0),
      completed: at(cells, 'completed') === 'true',
      createdAt: Number(at(cells, 'sessionCreatedAt') || 0),
    };
    return session;
  };

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length === 1 && cells[0] === '') continue;
    const currentSession = ensureSession(cells);
    const eventId = at(cells, 'eventId');
    if (!eventId) continue; // session anchor row

    let event = eventRows.get(eventId);
      if (!event) {
      event = {
        id: eventId,
        resultId: currentSession.id,
        noteId: at(cells, 'noteId'),
        blockContentId: at(cells, 'eventBlockContentId') || undefined,
        pageId: at(cells, 'pageId') || undefined,
        origin: (at(cells, 'eventOrigin') || undefined) as EventRecord['origin'],
        timestamp: Number(at(cells, 'timestamp') || 0),
        grain: (at(cells, 'grain') || 'event') as EventRecord['grain'],
        effortSlug: at(cells, 'effortSlug') || undefined,
        outputType: at(cells, 'outputType') || 'event',
        segmentId: at(cells, 'eventSegmentId') || undefined,
        segmentVersion: num(at(cells, 'eventSegmentVersion')),
        timeSpan: jsonCell(at(cells, 'timeSpan')),
        sourceBlockKey: at(cells, 'sourceBlockKey') || undefined,
        sourceStatementId: num(at(cells, 'sourceStatementId')),
        line: num(at(cells, 'line')),
        text: at(cells, 'text') || undefined,
        dialect: at(cells, 'dialect') || undefined,
        stackLevel: num(at(cells, 'stackLevel')),
        completionReason: at(cells, 'completionReason') || undefined,
        representationKind: (at(cells, 'representationKind') || undefined) as EventRecord['representationKind'],
        metrics: [],
      };
      eventRows.set(eventId, event);
    }

    const metricType = at(cells, 'metricType');
    if (!metricType) continue; // metrics:[] event row
    const metric: Metric = {
      type: metricType,
      value: metricValueFromCell(at(cells, 'metricValue')),
      ...(at(cells, 'metricUnit') ? { unit: at(cells, 'metricUnit') } : {}),
      ...(at(cells, 'metricImage') ? { image: at(cells, 'metricImage') } : {}),
      ...(at(cells, 'metricOrigin') ? { origin: at(cells, 'metricOrigin') } : {}),
      ...(at(cells, 'metricMetadata') ? { metadata: jsonCell(at(cells, 'metricMetadata')) } : {}),
    };
    (event.metrics as Metric[]).push(metric);
    const temporal = jsonCell<unknown>(at(cells, 'metricTemporal'));
    if (temporal !== undefined) {
      (event.metricTemporal ??= []).push(temporal as NonNullable<EventRecord['metricTemporal']>[number]);
    }
  }

  if (!session) throw new Error('[wod import] Session CSV did not contain session columns');
  return { session, events: [...eventRows.values()] };
}
