import type {
  BlockEffort,
  BlockEquipment,
  BlockIndexRow,
  BlockRevision,
  IStorageTransaction,
  Note,
  NoteBlock,
  NoteTag,
  Session,
  Tag,
} from '@bitcobblers/wod-wiki-storage';
import { rowsEqual as sameRow } from '@bitcobblers/wod-wiki-storage';
import type { ExecutionLog } from '@bitcobblers/wod-wiki-engine';
import { extractNoteIdentity, extractTypedTags, readFrontmatterMeta } from '@bitcobblers/wod-wiki-engine';
import { MetricType, type EventRecord } from '@bitcobblers/wod-wiki-core';
import {
  blockContentId,
  KNOWN_SECTION_WIDGETS,
  parseDocumentSections,
  reconcileNoteBlocks,
  validateNoteBlocks,
} from '@bitcobblers/wod-wiki-core';
import { parseScript, extractStatementRefs, createReferenceIndex, bundledEfforts, parseEffortFile, parseEquipmentFile, type IEffort, type IEquipment } from '@bitcobblers/wod-wiki-lang';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { randomId, stableNoteId, uuid5, CLI_UUID_NAMESPACE, type CliDb } from './db';

const registeredWidgets = KNOWN_SECTION_WIDGETS;
const saveStores = ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment', 'tags', 'note_tags', 'sessions'] as const;

export interface PersistNoteOptions {
  source: string;
  sourceLabel: string;
  noteId?: string;
  title?: string;
  tags?: Array<{ label: string; type?: string }>;
  /** Exact current-source lineage, supplied only by a caller that owns the edits. */
  blocks?: Record<string, NoteBlock>;
  expectedSourceRevision?: number;
  now?: number;
}

export interface PersistNoteResult {
  noteId: string;
  note: Note;
  blocks: number;
  efforts: number;
  tags: number;
  created: boolean;
}

function titleFromLabel(sourceLabel: string): string {
  if (!sourceLabel || sourceLabel === '-') return 'stdin';
  const stem = sourceLabel.split('/').pop() ?? sourceLabel;
  return stem.replace(/\.[^.]+$/, '') || sourceLabel;
}


async function saveSource(
  db: CliDb,
  options: PersistNoteOptions,
  startTime?: number,
): Promise<PersistNoteResult & { session?: Session; revision?: BlockRevision }> {
  const noteId = options.noteId ?? stableNoteId(options.sourceLabel, options.source);
  const observed = await db.storage.readonly('notes').get(noteId);
  const expected = options.expectedSourceRevision ?? observed?.sourceRevision ?? 0;
  const now = options.now ?? Date.now();
  return db.storage.transaction([...saveStores], 'readwrite', async (tx) => {
    const existing = await tx.readonly('notes').get(noteId);
    if ((existing?.sourceRevision ?? 0) !== expected) {
      throw new Error(`Stale Note source revision for ${noteId}; expected ${expected}`);
    }
    let sourceRevision = existing?.rawContent === options.source
      ? existing.sourceRevision
      : (existing?.sourceRevision ?? 0) + 1;
    const history = await tx.readonly('block_revisions').getAllFromIndex('by-note', noteId);
    const latest = new Map<string, BlockRevision>();
    for (const row of history) {
      if ((latest.get(row.blockId)?.version ?? 0) < row.version) latest.set(row.blockId, row);
    }
    // ponytail: deterministic block UUIDs by noteId + ordinal; add explicit block IDs in markdown frontmatter when user-authored block identity is supported.
    let ordinal = 0;
    const blocks = reconcileNoteBlocks(options.source, {
      sourceRevision,
      blocks: options.blocks ?? (existing?.rawContent === options.source ? existing.blocks : undefined),
      registeredWidgets,
      createId: () => {
        while (true) {
          const candidate = uuid5(CLI_UUID_NAMESPACE, `${noteId}:block:${ordinal++}`);
          if (!latest.has(candidate)) return candidate;
        }
      },
    });
    validateNoteBlocks(options.source, blocks, sourceRevision, { registeredWidgets });
    const revisions: BlockRevision[] = [];
    for (const block of Object.values(blocks)) {
      const saved = latest.get(block.id);
      const rawContent = options.source.slice(block.from, block.to);
      const unchanged = saved && saved.rawContent === rawContent && saved.kind === block.kind &&
        saved.dialect === block.dialect && saved.sport === block.sport;
      block.version = unchanged ? saved.version : (saved?.version ?? 0) + 1;
      if (!unchanged) revisions.push({
        noteId, blockId: block.id, version: block.version, kind: block.kind,
        rawContent, savedAt: now,
        ...(block.dialect ? { dialect: block.dialect } : {}),
        ...(block.sport ? { sport: block.sport } : {}),
      });
    }
    if (existing?.rawContent === options.source && !sameRow(existing.blocks, blocks)) {
      sourceRevision++;
      for (const block of Object.values(blocks)) block.sourceRevision = sourceRevision;
    }
    const fm = readFrontmatterMeta(options.source);
    const catalog =
      (typeof fm['catalog'] === 'string' && fm['catalog'].trim()) ||
      (typeof fm['collection'] === 'string' && fm['collection'].trim()) ||
      existing?.catalog;
    const note: Note = {
      ...existing,
      id: noteId,
      title: options.title ?? existing?.title ?? titleFromLabel(options.sourceLabel),
      type: existing?.type ?? 'note',
      date: existing?.date ?? now,
      createdAt: existing?.createdAt ?? now,
      rawContent: options.source,
      sourceRevision,
      blocks,
      ...(catalog ? { catalog } : {}),
    };
    const priorRows = await tx.readonly('block_index').getAllFromIndex('by-note', noteId);
    const priorEfforts = await tx.readonly('block_efforts').getAllFromIndex('by-note', noteId);
    const priorEquipment = await tx.readonly('block_equipment').getAllFromIndex('by-note', noteId);
    // One shared resolver pass per save: canonical refs from the stored
    // definition catalog, exactly like the app rebuild and the seed build.
    const storedEfforts = (await tx.readonly('efforts').getAll()) as IEffort[];
    const effortsBySlug = new Map<string, IEffort>();
    for (const effort of bundledEfforts) effortsBySlug.set(effort.slug, effort);
    for (const effort of storedEfforts) effortsBySlug.set(effort.slug, effort);
    const referenceIndex = createReferenceIndex({
      efforts: [...effortsBySlug.values()],
      equipment: (await tx.readonly('equipment').getAll()) as IEquipment[],
    });
    const priorById = new Map(priorRows.map((row) => [row.id, row]));
    const nextRows: BlockIndexRow[] = [];
    const nextEfforts: BlockEffort[] = [];
    const nextEquipment: BlockEquipment[] = [];
    for (const [position, block] of Object.values(blocks).sort((a, b) => a.from - b.from).entries()) {
      const id = `${noteId}:${block.id}`;
      const prior = priorById.get(id);
      const rawContent = options.source.slice(block.from, block.to);
      const body = parseDocumentSections(rawContent, { registeredWidgets })[0]?.displayContent ?? rawContent;
      const fingerprint = block.kind === 'wod' ? blockContentId(body) : undefined;
      nextRows.push({
        ...prior,
        id, noteId, blockId: block.id, blockVersion: block.version,
        dataType: block.kind, sourceRevision, from: block.from, to: block.to, position,
        rawContent, noteTitle: note.title, createdAt: prior?.createdAt ?? now,
        blockContentId: fingerprint,
        ...(catalog ? { catalog } : {}),
        ...(note.sourceId ? { sourceId: note.sourceId } : {}),
      });
      if (block.kind === 'wod') {
        const statements = parseScript(body, { sport: block.sport, dialect: block.dialect, references: referenceIndex }).statements;
        const refs = extractStatementRefs(statements);
        const effortSlugs = new Set(refs.efforts);
        if (effortSlugs.size === 0) {
          for (const s of statements) {
            const m = s.metrics?.getMetric?.(MetricType.Effort);
            const val = typeof m?.value === 'string' ? m.value : (m && 'effort' in m ? String((m as { effort?: unknown }).effort) : '');
            const slug = val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (slug && !['rest', 'amrap', 'emom', 'tabata', 'for-time'].includes(slug)) {
              effortSlugs.add(slug);
            }
          }
        }
        for (const effortSlug of effortSlugs) {
          const effortId = `${noteId}:${block.id}:${effortSlug}`;
          const previous = priorEfforts.find((row) => row.id === effortId);
          nextEfforts.push({
            ...previous, id: effortId, noteId, blockId: block.id,
            blockContentId: fingerprint, effortSlug, createdAt: previous?.createdAt ?? now,
          });
        }
        for (const equipmentSlug of refs.equipment) {
          const equipmentId = `${noteId}:${block.id}:${equipmentSlug}`;
          const previous = priorEquipment.find((row) => row.id === equipmentId);
          nextEquipment.push({
            ...previous, id: equipmentId, noteId, blockId: block.id,
            blockContentId: fingerprint, equipmentSlug, createdAt: previous?.createdAt ?? now,
          });
        }
      }
    }
    if (!sameRow(existing, note)) await tx.readwrite('notes').put(note);
    if (revisions.length) await tx.readwrite('block_revisions').putMany(revisions);
    await diffProjection(tx, 'block_index', priorRows, nextRows);
    await diffProjection(tx, 'block_efforts', priorEfforts, nextEfforts);
    await diffProjection(tx, 'block_equipment', priorEquipment, nextEquipment);
    const tags = await saveTags(tx, noteId, options.tags, now);
    let session: Session | undefined;
    let revision: BlockRevision | undefined;
    if (startTime !== undefined) {
      const block = Object.values(blocks).filter((row) => row.kind === 'wod').sort((a, b) => a.from - b.from)[0];
      if (!block) throw new Error('[wod run] Note has no actionable workout block');
      revision = revisions.find((row) => row.blockId === block.id) ?? latest.get(block.id);
      if (!revision) throw new Error('[wod run] Saved workout revision is unavailable');
      session = {
        id: randomId(), noteId, blockId: block.id, blockVersion: block.version,
        blockContentId: blockContentId(parseDocumentSections(revision.rawContent)[0]?.displayContent ?? revision.rawContent),
        origin: 'journal', status: 'in-progress',
        startTime, endTime: startTime, duration: 0, completed: false, createdAt: startTime,
      };
      await tx.readwrite('sessions').put(session);
    }
    return { noteId, note, blocks: nextRows.length, efforts: nextEfforts.length, tags, created: !existing, session, revision };
  });
}

async function diffProjection(
  tx: IStorageTransaction,
  store: 'block_index' | 'block_efforts' | 'block_equipment',
  previous: Array<BlockIndexRow | BlockEffort | BlockEquipment>,
  next: Array<BlockIndexRow | BlockEffort | BlockEquipment>,
): Promise<void> {
  const nextIds = new Set(next.map((row) => row.id));
  for (const row of previous) if (!nextIds.has(row.id)) await tx.readwrite(store).delete(row.id);
  const old = new Map(previous.map((row) => [row.id, row]));
  for (const row of next) {
    if (!sameRow(old.get(row.id), row)) {
      if (store === 'block_index' && 'blockVersion' in row) await tx.readwrite('block_index').put(row);
      if (store === 'block_efforts' && 'effortSlug' in row) await tx.readwrite('block_efforts').put(row);
      if (store === 'block_equipment' && 'equipmentSlug' in row) await tx.readwrite('block_equipment').put(row);
    }
  }
}

async function saveTags(tx: IStorageTransaction, noteId: string, items: PersistNoteOptions['tags'], now: number): Promise<number> {
  const previous = await tx.readonly('note_tags').getAllFromIndex('by-note', noteId);
  if (!items) return previous.length;
  const next = new Map<string, NoteTag>();
  for (const item of items) {
    const label = item.label.trim();
    if (!label) continue;
    const found = (await tx.readonly('tags').getAllFromIndex('by-label', label))[0];
    const tag: Tag = found
      ? { ...found, ...(!found.type && item.type ? { type: item.type } : {}) }
      : { id: uuid5(CLI_UUID_NAMESPACE, `tag:${label}`), label, type: item.type, createdAt: now };
    if (!sameRow(found, tag)) await tx.readwrite('tags').put(tag);
    const id = previous.find((link) => link.tagId === tag.id)?.id ?? uuid5(CLI_UUID_NAMESPACE, `note-tag:${noteId}:${tag.id}`);
    next.set(id, { ...previous.find((link) => link.id === id), id, noteId, tagId: tag.id });
  }
  for (const link of previous) if (!next.has(link.id)) await tx.readwrite('note_tags').delete(link.id);
  const old = new Map(previous.map((row) => [row.id, row]));
  for (const link of next.values()) if (!sameRow(old.get(link.id), link)) await tx.readwrite('note_tags').put(link);
  return next.size;
}

export function persistNote(db: CliDb, options: PersistNoteOptions): Promise<PersistNoteResult> {
  return saveSource(db, options);
}

export interface StartedRun {
  session: Session;
  revision: BlockRevision;
  noteCreated: boolean;
}

export async function startRun(db: CliDb, options: PersistNoteOptions, startTime = Date.now()): Promise<StartedRun> {
  const saved = await saveSource(db, options, startTime);
  if (!saved.session || !saved.revision) throw new Error('[wod run] Atomic run capture failed');
  return { session: saved.session, revision: saved.revision, noteCreated: saved.created };
}

export interface PersistRunResult {
  noteId: string;
  resultId: string;
  session: Session;
  events: number;
  summaries: number;
  noteCreated: boolean;
}

export async function persistRun(db: CliDb, started: StartedRun, executionLog: ExecutionLog): Promise<PersistRunResult> {
  const results = executionLog.results;
  const session: Session = {
    ...started.session,
    status: results.completed ? 'completed' : 'in-progress',
    endTime: results.endTime, duration: results.duration ?? 0, completed: results.completed,
  };
  const identity = {
    noteId: session.noteId, resultId: session.id, blockId: session.blockId, blockVersion: session.blockVersion,
    blockContentId: session.blockContentId, origin: session.origin, pageId: session.pageId,
    workoutTimestamp: session.createdAt,
  };
  const events = toEventRows(executionLog.logs, identity);
  const summaries = toSummaryEventRows(executionLog.logs, identity);
  await db.storage.transaction(['sessions', 'events', 'block_revisions'], 'readwrite', async (tx) => {
    const saved = await tx.readonly('sessions').get(session.id);
    if (!saved || saved.noteId !== session.noteId || saved.blockId !== session.blockId || saved.blockVersion !== session.blockVersion) {
      throw new Error('[wod run] Captured Session source pin changed');
    }
    const revision = await tx.readonly('block_revisions').get([session.noteId, session.blockId, session.blockVersion]);
    if (!revision || !sameRow(revision, started.revision)) throw new Error('[wod run] Captured revision is unavailable');
    await tx.readwrite('sessions').put(session);
    await tx.readwrite('events').putMany([...events, ...summaries]);
  });
  return { noteId: session.noteId, resultId: session.id, session, events: events.length, summaries: summaries.length, noteCreated: started.noteCreated };
}

/** Import only when the exact immutable revision is already available. */
export async function persistSessionBundle(db: CliDb, session: Session, events: readonly EventRecord[]): Promise<{ events: number }> {
  if ('segmentId' in session || 'segmentVersion' in session || 'version' in session || 'rawContent' in session || 'data' in session || !session.noteId || !session.blockId || !Number.isSafeInteger(session.blockVersion) || session.blockVersion < 1) {
    throw new Error('[wod import] Session requires an exact block revision pin');
  }
  await db.storage.transaction(['sessions', 'events', 'block_revisions'], 'readwrite', async (tx) => {
    const revision = await tx.readonly('block_revisions').get([session.noteId, session.blockId, session.blockVersion]);
    if (!revision || revision.kind !== 'wod') throw new Error('[wod import] Exact immutable workout revision is unavailable');
    for (const event of events) {
      if (event.resultId !== session.id || event.noteId !== session.noteId || event.blockId !== session.blockId || event.blockVersion !== session.blockVersion) {
        throw new Error('[wod import] Event source pin differs from Session source pin');
      }
    }
    const existing = await tx.readonly('sessions').get(session.id);
    if (existing && !sameRow(existing, session)) throw new Error('[wod import] Session identity conflicts with existing row');
    if (!existing) await tx.readwrite('sessions').put(session);
    for (const event of events) {
      const old = await tx.readonly('events').get(event.id);
      if (old && !sameRow(old, event)) throw new Error('[wod import] Event identity conflicts with existing row');
      if (!old) await tx.readwrite('events').put(event);
    }
  });
  return { events: events.length };
}

/** Definition import result — the note identity the document landed on. */
export interface PersistDefinitionResult {
  slug: string;
  noteId: string;
  /** True when no note existed at the resolved identity before this import. */
  createdNote: boolean;
}

/**
 * Import an effort/equipment definition document (canonical markdown):
 * the NOTE is the storage form, the registry row its projection. ONE
 * storage transaction commits both, so a definition is never half-imported
 * (note without projection or the reverse). Identity: a stamped
 * `wod-note-id` wins, then the prior projection's owning note, then the
 * deterministic `effort/<slug>` / `equipment/<slug>` home — so
 * `wod export` → `wod import` round-trips to the same note.
 */
export async function persistDefinitionNote(db: CliDb, kind: 'effort' | 'equipment', source: string): Promise<PersistDefinitionResult> {
  const parsed = kind === 'effort' ? parseEffortFile(source) : parseEquipmentFile(source);
  if (!parsed) {
    throw new Error(kind === 'effort'
      ? '[wod import] Unparseable effort file (need frontmatter id/slug/label + numeric baseAttributes.met)'
      : '[wod import] Unparseable equipment file (need frontmatter type: equipment + id/slug/label)');
  }
  const family = kind === 'effort' ? 'efforts' : 'equipment';
  const prior = (await db.storage.readonly(family).get(parsed.slug)) as
    | { ownerNoteId?: string; registrySource?: 'bundled' | 'user'; createdAt?: string }
    | undefined;
  const stamped = extractNoteIdentity(source)?.noteId;
  const noteId = stamped ?? prior?.ownerNoteId ?? `${kind}/${parsed.slug}`;
  const now = Date.now();
  return db.storage.transaction(['notes', family, 'tags', 'note_tags'], 'readwrite', async (tx) => {
    const previous = (await tx.readonly('notes').get(noteId)) as Note | undefined;
    const sourceRevision = (previous?.sourceRevision ?? 0) + (previous?.rawContent === source ? 0 : 1);
    const blocks = reconcileNoteBlocks(source, { sourceRevision, registeredWidgets, blocks: previous?.blocks });
    validateNoteBlocks(source, blocks, sourceRevision, { registeredWidgets });
    const note: Note = {
      ...previous,
      id: noteId,
      title: parsed.label,
      type: previous?.type ?? 'note',
      createdAt: previous?.createdAt ?? now,
      rawContent: source,
      sourceRevision,
      blocks,
      sourceId: family,
      sourcePath: noteId,
    };
    await tx.readwrite('notes').put(note);
    // ponytail: definitions carry no fenced blocks, so no block_revisions /
    // block_index rows are written here; add when definition docs grow
    // script blocks.
    const isoNow = new Date(now).toISOString();
    await tx.readwrite(family).put({
      ...parsed,
      registrySource: prior?.registrySource ?? 'user',
      ownerNoteId: noteId,
      sourceId: family,
      sourcePath: noteId,
      createdAt: prior?.createdAt ?? isoNow,
      updatedAt: isoNow,
    });
    // Materialize the definition's tag frontmatter through the same path as
    // note import, so typed tags are searchable/autocomplete-resolvable via
    // the tag graph — not just stored verbatim in the note.
    await saveTags(tx, noteId, extractTypedTags(source), now);
    return { slug: parsed.slug, noteId, createdNote: !previous };
  });
}

export async function persistTypedTags(db: CliDb, labels: readonly string[], type: string): Promise<number> {
  return db.storage.transaction(['tags'], 'readwrite', async (tx) => {
    let added = 0;
    for (const raw of labels) {
      const label = raw.trim();
      if (!label) continue;
      const tag = (await tx.readonly('tags').getAllFromIndex('by-label', label))[0];
      if (!tag) {
        await tx.readwrite('tags').put({ id: uuid5(CLI_UUID_NAMESPACE, `tag:${label}`), label, type, createdAt: Date.now() });
        added++;
      } else if (!tag.type) {
        await tx.readwrite('tags').put({ ...tag, type });
      }
    }
    return added;
  });
}
