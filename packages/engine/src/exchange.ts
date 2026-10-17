/**
 * Import / Export exchange formats for notes and sessions.
 *
 * Pure row→string / string→row transforms with NO storage or fs coupling,
 * so the playground website can offer the same downloads/uploads against
 * IndexedDB rows while the CLI uses them over sqlite. Round-trip is a
 * design requirement: every export carries the identity needed to import
 * back into the same database (upsert) or into a clean one (recreate).
 *
 *  - Notes export their exact authored source with an identity stamp.
 *    `wod parse` adopts the stamp when importing the note.
 *  - Sessions → one CSV row per metric (event + summary grains), session
 *    fields repeated per row plus one session-only anchor row, so a clean
 *    import recreates the session and its events verbatim.
 */

import { WQL_TYPED_TAG_KEYS } from '@bitcobblers/wod-wiki-wql';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import type { Note, Session } from '@bitcobblers/wod-wiki-storage';

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
    const newline = markdown.startsWith('---\r\n') ? '\r\n' : '\n';
    const lines = stamp(block[1].split(/\r?\n/));
    return `---${newline}${lines.join(newline)}${newline}---${markdown.slice(block[0].length)}`;
  }
  const lines = stamp([]);
  return `---\n${lines.join('\n')}\n---\n\n${markdown}`;
}

/** Export the exact authored Note source, with identity for re-import. */
export function composeNoteMarkdown(note: Note): string {
  return injectIdentityFrontmatter(note.rawContent, { noteId: note.id, title: note.title });
}

// ---------------------------------------------------------------------------
// Frontmatter tags (general + typed: equipment, quality, …)
// ---------------------------------------------------------------------------

export interface TypedTagItem { label: string; type?: string }

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Minimal frontmatter reader (the corpus subset): `key: scalar`, `key:` +
 * `- item` lists, and inline `[a, b]` lists. Keys are lowercased. Returns {}
 * when no leading block exists.
 */
export function readFrontmatterMeta(markdown: string): Record<string, string | string[]> {
  const match = FRONTMATTER_BLOCK_RE.exec(markdown);
  if (!match) return {};
  const meta: Record<string, string | string[]> = {};
  const lines = match[1].split(/\r?\n/);
  let currentListKey: string | undefined;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && currentListKey) {
      (meta[currentListKey] as string[]).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const value = kv[2].trim();
    if (value === '') {
      meta[key] = [];
      currentListKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter((v) => v.length > 0);
      currentListKey = undefined;
    } else {
      meta[key] = value;
      currentListKey = undefined;
    }
  }
  return meta;
}

const asList = (value: string | string[] | undefined): string[] =>
  Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((v) => v.trim()).filter((v) => v.length > 0)
      : [];

/**
 * Extract a note's frontmatter tags: the general `tags:` list plus typed
 * keys (equipment, quality, domain, format, intent by default — the WQL
 * typed-tag vocabulary). Mirrors the playground's
 * `extractTypedFrontmatterTags` (frontmatter.ts) so CLI and app imports
 * classify identically.
 */
export function extractTypedTags(
  markdown: string,
  typedKeys: readonly string[] = WQL_TYPED_TAG_KEYS,
): TypedTagItem[] {
  const meta = readFrontmatterMeta(markdown);
  const results: TypedTagItem[] = asList(meta['tags']).map((label) => ({ label }));
  const metaKeys = Object.keys(meta);
  for (const typeName of typedKeys) {
    if (typeName === 'tags') continue;
    const matchedKey = metaKeys.find((k) => k === typeName.toLowerCase());
    if (!matchedKey) continue;
    for (const label of asList(meta[matchedKey])) {
      results.push({ label, type: typeName });
    }
  }
  return results.filter((t) => t.label.length > 0);
}

// ---------------------------------------------------------------------------
// Definition registry (markdown serialization — parsing lives in lang)
// ---------------------------------------------------------------------------

/**
 * Compose an effort registry row back into corpus-style markdown. Export
 * paths prefer the owning note's raw source (byte-identical); this
 * reconstruction is the fallback for rows without an owner note.
 */
export function effortToMarkdown(effort: {
  id: string;
  slug: string;
  label: string;
  aliases?: string[];
  baseAttributes: Record<string, unknown>;
  body?: string;
}): string {
  const lines = ['---', `id: ${effort.id}`, `slug: ${effort.slug}`, `label: ${effort.label}`];
  if (effort.aliases && effort.aliases.length > 0) {
    lines.push('aliases:');
    for (const alias of effort.aliases) lines.push(`  - ${alias}`);
  }
  const attrs = Object.entries(effort.baseAttributes).filter(([, v]) => typeof v === 'number' || typeof v === 'string');
  if (attrs.length > 0) {
    lines.push('baseAttributes:');
    for (const [k, v] of attrs) lines.push(`  ${k}: ${String(v)}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n${(effort.body ?? '').trim()}`.trimEnd() + '\n';
}

/** Compose an equipment registry row back into corpus-style markdown (effortToMarkdown's equipment twin). */
export function equipmentToMarkdown(equipment: {
  id: string;
  slug: string;
  label: string;
  aliases?: string[];
  body?: string;
}): string {
  const lines = ['---', 'type: equipment', `id: ${equipment.id}`, `slug: ${equipment.slug}`, `label: ${equipment.label}`];
  if (equipment.aliases && equipment.aliases.length > 0) {
    lines.push('aliases:');
    for (const alias of equipment.aliases) lines.push(`  - ${alias}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n${(equipment.body ?? '').trim()}`.trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// Equipment catalog (typed tags, CSV round-trip)
// ---------------------------------------------------------------------------

/** One-label-per-row CSV (header `label`) for equipment catalogs. */
export function equipmentToCsv(labels: readonly string[]): string {
  return ['label', ...labels].map((l) => escapeCsvField(l)).join('\n') + '\n';
}

export function csvToEquipmentLabels(csv: string): string[] {
  const lines = splitCsvRecords(csv);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const labelIdx = header[0] === 'label' ? 0 : -1;
  const start = labelIdx >= 0 ? 1 : 0; // tolerate headerless files
  const labels: string[] = [];
  for (const line of lines.slice(start)) {
    const cells = parseCsvLine(line);
    const label = (labelIdx >= 0 ? cells[0] : cells.join(',')).trim();
    if (label) labels.push(label);
  }
  return [...new Set(labels)];
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
  'sessionId', 'noteId', 'blockId', 'blockVersion', 'blockContentId',
  'origin', 'status', 'startTime', 'endTime', 'duration', 'completed', 'sessionCreatedAt', 'sessionExtraJson',
] as const;

const EVENT_HEADER = [
  'eventId', 'grain', 'outputType', 'timestamp', 'pageId', 'effortSlug',
  'eventBlockId', 'eventBlockVersion', 'eventBlockContentId', 'eventOrigin',
  'timeSpan', 'sourceBlockKey', 'sourceStatementId', 'line', 'text', 'dialect',
  'stackLevel', 'completionReason', 'representationKind',
  'metricType', 'metricValue', 'metricUnit', 'metricImage', 'metricOrigin',
  'metricMetadata', 'metricTemporal',
  // Verbatim JSON backstops: make the machine round-trip lossless across
  // schema fields that have no dedicated spreadsheet column. Explicit cells
  // above still win on import, so hand-edited values are honored.
  'metricJson', 'eventExtraJson',
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
    session.id, session.noteId, session.blockId, session.blockVersion,
    session.blockContentId, session.origin, session.status,
    session.startTime, session.endTime, session.duration, session.completed,
    session.createdAt, JSON.stringify(session),
  ].map(escapeCsvField);
}

function metricCells(event: EventRecord, metric: Metric, index: number): string[] {
  return [
    event.id, event.grain, event.outputType, event.timestamp, event.pageId, event.effortSlug,
    event.blockId, event.blockVersion, event.blockContentId, event.origin,
    event.timeSpan, event.sourceBlockKey, event.sourceStatementId, event.line, event.text, event.dialect,
    event.stackLevel, event.completionReason, event.representationKind,
    metric.type, metricValueToCell(metric.value), metric.unit, metric.image, metric.origin,
    metric.metadata === undefined ? '' : JSON.stringify(metric.metadata),
    event.metricTemporal?.[index] === undefined ? '' : JSON.stringify(event.metricTemporal[index]),
    JSON.stringify(metric),
  ].map(escapeCsvField);
}

/** Event fields with no dedicated column, serialized verbatim (minus the
 * metrics array, which gets its own columns). metricTemporal is kept: the
 * importer discards it and rebuilds from the per-row column, so an empty
 * array still round-trips where no rows carry temporals. Returns the
 * CSV-escaped cell. */
function eventExtraCells(event: EventRecord): string {
  const { metrics: _metrics, ...rest } = event;
  return escapeCsvField(JSON.stringify(rest));
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
    const extra = eventExtraCells(event);
    const metrics = event.metrics ?? [];
    if (metrics.length === 0) {
      lines.push([...sessionCells(session), ...metricCells(event, { type: '' }, 0), extra].join(','));
      continue;
    }
    for (let i = 0; i < metrics.length; i++) {
      lines.push([...sessionCells(session), ...metricCells(event, metrics[i], i), extra].join(','));
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
const nonempty = (cell: string): string | undefined => (cell === '' ? undefined : cell);

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
  if (header.some((name) => /segment/i.test(name))) {
    throw new Error('[wod import] Incompatible Session CSV segment pins; blockId/blockVersion are required');
  }
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`[wod import] Session CSV missing column "${name}"`);
    return idx;
  };
  const at = (cells: string[], name: string): string => cells[col(name)] ?? '';

  const eventRows = new Map<string, EventRecord>();
  let session: Session | undefined;

  const ensureSession = (cells: string[]): Session => {
    const id = at(cells, 'sessionId');
    const noteId = at(cells, 'noteId');
    const blockId = at(cells, 'blockId');
    const blockVersion = Number(at(cells, 'blockVersion'));
    if (!id || !noteId || !blockId || !Number.isSafeInteger(blockVersion) || blockVersion < 1) {
      throw new Error('[wod import] Session CSV requires sessionId, noteId, blockId and positive blockVersion');
    }
    if (session) {
      if (session.id !== id || session.noteId !== noteId || session.blockId !== blockId || session.blockVersion !== blockVersion) {
        throw new Error('[wod import] Session CSV contains inconsistent source pins');
      }
      return session;
    }
    const extra = jsonCell<Partial<Session>>(at(cells, 'sessionExtraJson')) ?? {};
    if ('segmentId' in extra || 'segmentVersion' in extra || 'version' in extra || 'rawContent' in extra || 'data' in extra) {
      throw new Error('[wod import] Incompatible Session CSV source snapshot or segment pin');
    }
    session = {
      ...extra,
      id,
      noteId,
      blockId,
      blockVersion,
      blockContentId: at(cells, 'blockContentId') || undefined,
      origin: (at(cells, 'origin') || undefined) as Session['origin'],
      status: (at(cells, 'status') || undefined) as Session['status'],
      startTime: Number(at(cells, 'startTime') || 0),
      endTime: Number(at(cells, 'endTime') || 0),
      duration: Number(at(cells, 'duration') || 0),
      completed: at(cells, 'completed') === 'true',
      createdAt: Number(at(cells, 'sessionCreatedAt') || 0),
    };
    if (![session.startTime, session.endTime, session.duration, session.createdAt].every(Number.isFinite)) {
      throw new Error('[wod import] Session CSV lifecycle values must be finite numbers');
    }
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
      // eventExtraJson is the verbatim backstop; explicit spreadsheet cells
      // override it so hand-edited values are honored on import.
      const extra = jsonCell<Record<string, unknown>>(at(cells, 'eventExtraJson')) ?? {};
      if ('segmentId' in extra || 'segmentVersion' in extra) {
        throw new Error('[wod import] Incompatible Session CSV event segment pins');
      }
      const blockId = nonempty(at(cells, 'eventBlockId'));
      const blockVersion = num(at(cells, 'eventBlockVersion'));
      if (blockId !== currentSession.blockId || blockVersion !== currentSession.blockVersion) {
        throw new Error('[wod import] Event source pin differs from Session source pin');
      }
      event = {
        ...extra,
        id: eventId,
        resultId: currentSession.id,
        noteId: nonempty(at(cells, 'noteId')) ?? (extra.noteId as string | undefined) ?? currentSession.noteId,
        blockContentId: nonempty(at(cells, 'eventBlockContentId')) ?? (extra.blockContentId as string | undefined),
        pageId: nonempty(at(cells, 'pageId')) ?? (extra.pageId as string | undefined),
        origin: (nonempty(at(cells, 'eventOrigin')) ?? extra.origin) as EventRecord['origin'],
        timestamp: Number(at(cells, 'timestamp') || extra.timestamp || 0),
        grain: (nonempty(at(cells, 'grain')) ?? extra.grain ?? 'event') as EventRecord['grain'],
        effortSlug: nonempty(at(cells, 'effortSlug')) ?? (extra.effortSlug as string | undefined),
        outputType: nonempty(at(cells, 'outputType')) ?? (extra.outputType as string | undefined) ?? 'event',
        blockId,
        blockVersion,
        timeSpan: jsonCell(at(cells, 'timeSpan')) ?? (extra.timeSpan as EventRecord['timeSpan']),
        sourceBlockKey: nonempty(at(cells, 'sourceBlockKey')) ?? (extra.sourceBlockKey as string | undefined),
        sourceStatementId: num(at(cells, 'sourceStatementId')) ?? (extra.sourceStatementId as number | undefined),
        line: num(at(cells, 'line')) ?? (extra.line as number | undefined),
        text: nonempty(at(cells, 'text')) ?? (extra.text as string | undefined),
        dialect: nonempty(at(cells, 'dialect')) ?? (extra.dialect as string | undefined),
        stackLevel: num(at(cells, 'stackLevel')) ?? (extra.stackLevel as number | undefined),
        completionReason: nonempty(at(cells, 'completionReason')) ?? (extra.completionReason as string | undefined),
        representationKind: (nonempty(at(cells, 'representationKind')) ??
          extra.representationKind) as EventRecord['representationKind'],
        metrics: [],
        // Rebuild anchors from metric rows while preserving an authored empty array.
        metricTemporal: Array.isArray(extra.metricTemporal) ? [] : undefined,
      };
      eventRows.set(eventId, event);
    }

    const metricType = at(cells, 'metricType');
    if (!metricType) continue; // metrics:[] event row
    // metricJson is the verbatim backstop; explicit cells override it.
    const baseMetric = jsonCell<Metric>(at(cells, 'metricJson')) ?? {};
    const metric: Metric = {
      ...baseMetric,
      type: metricType,
      ...(at(cells, 'metricValue') !== '' ? { value: metricValueFromCell(at(cells, 'metricValue')) } : {}),
      ...(nonempty(at(cells, 'metricUnit')) ? { unit: at(cells, 'metricUnit') } : {}),
      ...(nonempty(at(cells, 'metricImage')) ? { image: at(cells, 'metricImage') } : {}),
      ...(nonempty(at(cells, 'metricOrigin')) ? { origin: at(cells, 'metricOrigin') } : {}),
      ...(at(cells, 'metricMetadata') !== ''
        ? { metadata: jsonCell(at(cells, 'metricMetadata')) }
        : {}),
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
