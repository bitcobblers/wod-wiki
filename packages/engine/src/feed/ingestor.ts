/**
 * VaultIngestor & PublicationManager — transactional Note/Telemetry ingestion,
 * zero-import remote preview, single-Note cloning, and Publication Visibility
 * controls over IStorage.
 */

import {
  KNOWN_SECTION_WIDGETS,
  blockContentId,
  derivePublicationVisibility,
  isNonPublishableNotebook,
  isPublishableNotebookLanding,
  isSystemReadOnlyNotebook,
  parseDocumentSections,
  parseNoteBundleFromJsonl,
  reconcileNoteBlocks,
  serializeNoteBundleToJsonl,
  toNotebookId,
  type BlockEffort,
  type BlockEquipment,
  type BlockIndexRow,
  type BlockRevision,
  type EventRecord,
  type Note,
  type NoteBlock,
  type NoteProvenance,
  type NoteTag,
  type NoteTelemetryBundle,
  type NotebookLink,
  type PublicationVisibilitySummary,
  type Session,
  type Tag,
} from '@bitcobblers/wod-wiki-core';
import {
  bundledEfforts,
  createReferenceIndex,
  extractStatementRefs,
  parseScript,
  type ReferenceIndex,
} from '@bitcobblers/wod-wiki-lang';
import type { IReadWriteStore, IStorage } from '@bitcobblers/wod-wiki-storage';
import { notebookOfItem, notebooksOfItem } from '@bitcobblers/wod-wiki-wql';
import { getNoteNotebooks, makeNotebookLinkId } from '../notebook/membership';
import {
  composeNoteMarkdown,
  csvToTelemetryBundle,
  parseFrontmatterDateMs,
  parseNoteMarkdown,
  readFrontmatterMeta,
  telemetryBundleToCsv,
} from '../exchange';
import { SEED_REGISTERED_WIDGETS, type NotebookIndex, type SeedRecordRef, type SeedRow } from '../seed/contract';
import { seedNoteId } from '../seed/runtime';
import { assertNotebookIndex, assertSeedRow } from '../seed/validation';
import { decodeUtf8, FeedTreeError, type FeedTreeReader, type FetchLike } from './tree';

function mintUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Publication Visibility management over IStorage ─────────────────────────

export async function getNotePublicationSummary(
  storage: IStorage,
  noteId: string,
): Promise<PublicationVisibilitySummary> {
  const note = await storage.readonly('notes').get(noteId);
  if (!note) {
    return derivePublicationVisibility({ notebookPublic: false, publicSessions: 0, totalSessions: 0 });
  }

  if (isPublishableNotebookLanding(note)) {
    const notebookPublic = note.public === true;
    const [allNotes, allSessions] = await Promise.all([
      storage.readonly('notes').getAll(),
      storage.readonly('sessions').getAll(),
    ]);
    let linkedNoteIds = new Set<string>();
    try {
      const links = await storage.readonly('notebook_links').getAllFromIndex('by-notebook', note.id);
      linkedNoteIds = new Set(links.filter((l) => l.targetKind === 'note').map((l) => l.noteId));
    } catch {
      // Optional index on lightweight mocks
    }
    const memberIds = new Set(
      allNotes
        .filter((n) => !isPublishableNotebookLanding(n) && (linkedNoteIds.has(n.id) || notebooksOfItem(n).includes(toNotebookId(note.id))))
        .map((n) => n.id),
    );
    const nbSessions = allSessions.filter((s) => memberIds.has(s.noteId));
    const pubCount = nbSessions.filter((s) => s.public === true).length;
    return derivePublicationVisibility({
      notebookPublic,
      publicSessions: pubCount,
      totalSessions: nbSessions.length,
      notebookId: note.id,
      notebookIds: [note.id],
      publicNotebookIds: notebookPublic ? [note.id] : [],
    });
  }

  const linkedNotebooks = await getNoteNotebooks(storage, note.id);
  const candidateNotebooks = linkedNotebooks.length > 0
    ? linkedNotebooks
    : (note.notebookId ? [toNotebookId(note.notebookId)] : notebooksOfItem(note));

  const publicNotebookIds: string[] = [];
  for (const nbId of candidateNotebooks) {
    if (isNonPublishableNotebook(nbId)) continue;
    const landing = await storage.readonly('notes').get(nbId);
    if (landing && isPublishableNotebookLanding(landing) && landing.public === true) {
      publicNotebookIds.push(nbId);
    }
  }
  const notebookPublic = publicNotebookIds.length > 0;
  const primaryNbId =
    publicNotebookIds[0] ??
    candidateNotebooks.find((id) => !isNonPublishableNotebook(id)) ??
    candidateNotebooks[0] ??
    notebookOfItem(note);

  let noteSessions: Session[];
  try {
    noteSessions = await storage.readonly('sessions').getAllFromIndex('by-note', noteId);
  } catch {
    noteSessions = (await storage.readonly('sessions').getAll()).filter((s) => s.noteId === noteId);
  }
  const publicSessions = noteSessions.filter((s) => s.public === true).length;
  return derivePublicationVisibility({
    notebookPublic,
    publicSessions,
    totalSessions: noteSessions.length,
    notebookId: primaryNbId,
    notebookIds: [...candidateNotebooks],
    publicNotebookIds,
  });
}

export async function setNotebookPublic(
  storage: IStorage,
  notebookIdOrSlug: string,
  isPublic: boolean,
): Promise<Note> {
  const notebookId = toNotebookId(notebookIdOrSlug);
  if (isNonPublishableNotebook(notebookId)) {
    throw new Error(`Notebook '${notebookId}' is private or system-managed and cannot be published.`);
  }
  return storage.transaction(['notes'], 'readwrite', async (tx) => {
    const store = tx.readwrite('notes');
    const existing = await store.get(notebookId);
    if (existing && (existing.feedOrigin === 'feed' || existing.seedOrigin === 'seed')) {
      throw new Error(`Subscribed feed notebooks cannot be published directly (${notebookId}). Clone into a user notebook first.`);
    }
    const base: Note = existing ?? {
      id: notebookId,
      title: notebookId.slice('notebook/'.length),
      rawContent: `# ${notebookId.slice('notebook/'.length)}\n`,
      sourceRevision: 1,
      blocks: {},
      createdAt: Date.now(),
      notebookId,
      seedOrigin: 'user',
    };
    const updated: Note = {
      ...base,
      notebookId,
      public: isPublic,
    };
    await store.put(updated);
    return updated;
  });
}

export async function setSessionPublic(
  storage: IStorage,
  sessionId: string,
  isPublic: boolean,
): Promise<Session> {
  return storage.transaction(['sessions'], 'readwrite', async (tx) => {
    const store = tx.readwrite('sessions');
    const existing = await store.get(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const updated: Session = { ...existing, public: isPublic };
    await store.put(updated);
    return updated;
  });
}

// ── Zero-import Remote Preview & Single-Record Clone ────────────────────────

let cachedDefaultReferenceIndex: ReferenceIndex | null = null;
function defaultLazyReferenceIndex(): ReferenceIndex {
  if (!cachedDefaultReferenceIndex) {
    cachedDefaultReferenceIndex = createReferenceIndex({
      efforts: [...bundledEfforts],
      equipment: [],
    });
  }
  return cachedDefaultReferenceIndex;
}

function titleFromMarkdown(path: string, markdown: string): string {
  const fm = readFrontmatterMeta(markdown);
  const fmTitle = typeof fm['title'] === 'string' ? fm['title'].trim().replace(/^["']|["']$/g, '') : '';
  if (fmTitle) return fmTitle;
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return (path.split('/').at(-1) ?? path)
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function notebookSlugFromFeedPath(path: string): string | undefined {
  const match = /^markdown\/notebooks\/([^/]+)\//.exec(path);
  return match?.[1] && match[1] !== '_root' ? match[1] : undefined;
}

export interface CompileMarkdownSeedRowInput {
  path: string;
  markdown: string;
  uuid?: string;
  commit?: string;
  version?: number;
  title?: string;
  date?: number;
  sourceId?: string;
  routeId?: string;
  createdAt?: number;
  referenceIndex?: ReferenceIndex;
}

/**
 * Compile a raw portable `.md` document into a validated `SeedRow` lazily
 * in-client (headless; zero DOM/React/Node fs dependencies).
 */
export async function compileSeedRowFromMarkdown(
  input: CompileMarkdownSeedRowInput,
): Promise<SeedRow> {
  const path = input.path.replace(/^\/+/, '');
  if (!path || path.split('/').includes('..')) {
    throw new Error(`Invalid seed markdown path: '${input.path}'`);
  }
  const content = input.markdown;
  const uuid = input.uuid || (await seedNoteId(path));
  const fm = readFrontmatterMeta(content);
  const title = input.title?.trim() || titleFromMarkdown(path, content);
  const rawDate = typeof fm['date'] === 'string' ? fm['date'] : undefined;
  const parsedDate = parseFrontmatterDateMs(rawDate);
  const createdAt = input.date ?? parsedDate ?? input.createdAt ?? 0;

  let ordinal = 0;
  const blocks: Record<string, NoteBlock> = reconcileNoteBlocks(content, {
    sourceRevision: 1,
    registeredWidgets: SEED_REGISTERED_WIDGETS,
    createId: () => `seed:${path}:${ordinal++}`,
  });

  const sections = parseDocumentSections(content, { registeredWidgets: SEED_REGISTERED_WIDGETS });
  const blockIndex: BlockIndexRow[] = Object.values(blocks).map((block, position) => {
    const section = sections.find((s) => s.from === block.from && s.to === block.to);
    const fingerprint =
      block.kind === 'wod'
        ? blockContentId(section?.scriptBlock?.content ?? content.slice(block.from, block.to))
        : undefined;
    return {
      id: `${uuid}:${block.id}`,
      noteId: uuid,
      blockId: block.id,
      blockVersion: 1,
      sourceRevision: 1,
      from: block.from,
      to: block.to,
      position,
      dataType: block.kind,
      ...(fingerprint ? { blockContentId: fingerprint } : {}),
      rawContent: content.slice(block.from, block.to),
      noteTitle: title,
      createdAt,
      isStatic: true,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      sourcePath: path,
      ...(input.routeId ? { routeId: input.routeId } : {}),
    };
  });

  const referenceIndex = input.referenceIndex ?? defaultLazyReferenceIndex();
  const blockEfforts: BlockEffort[] = [];
  const blockEquipment: BlockEquipment[] = [];

  for (const proj of blockIndex) {
    if (proj.dataType !== 'wod' || !proj.rawContent) continue;
    const sec = parseDocumentSections(proj.rawContent, { registeredWidgets: SEED_REGISTERED_WIDGETS }).find(
      (s) => s.scriptBlock,
    );
    const parsed = parseScript(sec?.scriptBlock?.content ?? proj.rawContent, { references: referenceIndex });
    const refs = extractStatementRefs(parsed.statements);

    const seenEfforts = new Set<string>();
    for (const rawSlug of refs.efforts) {
      const canonical = referenceIndex.resolveEffort(rawSlug)?.slug;
      if (!canonical || seenEfforts.has(canonical)) continue;
      seenEfforts.add(canonical);
      blockEfforts.push({
        id: `${proj.id}:${canonical}`,
        noteId: uuid,
        blockId: proj.blockId,
        ...(proj.blockContentId ? { blockContentId: proj.blockContentId } : {}),
        effortSlug: canonical,
        isStatic: true,
        sourcePath: path,
        createdAt,
      });
    }

    const seenEquipment = new Set<string>();
    for (const rawSlug of refs.equipment) {
      const canonical = referenceIndex.resolveEquipment(rawSlug)?.slug;
      if (!canonical || seenEquipment.has(canonical)) continue;
      seenEquipment.add(canonical);
      blockEquipment.push({
        id: `${proj.id}:${canonical}`,
        noteId: uuid,
        blockId: proj.blockId,
        ...(proj.blockContentId ? { blockContentId: proj.blockContentId } : {}),
        equipmentSlug: canonical,
        isStatic: true,
        sourcePath: path,
        createdAt,
      });
    }
  }

  return assertSeedRow({
    path,
    content,
    blocks,
    blockIndex,
    blockEfforts,
    blockEquipment,
    uuid,
    commit: input.commit ?? '',
    version: input.version ?? 1,
  });
}

async function readTextFromReaderOrUrl(
  reader: FeedTreeReader,
  target: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  if (/^https?:\/\//i.test(target)) {
    const parsed = new URL(target);
    if (parsed.username || parsed.password) {
      throw new FeedTreeError('permission', 'Disallowed credentials in feed URL');
    }
    const doFetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    const res = await doFetch(parsed.toString());
    if (res.status === 404) {
      throw new FeedTreeError('not-found', `HTTP 404 for ${parsed.toString()}`);
    }
    if (!res.ok) {
      throw new FeedTreeError('permission', `HTTP ${res.status} fetching ${parsed.toString()}`);
    }
    return await res.text();
  }
  return decodeUtf8(await reader.read(target));
}

export async function previewRemoteNotebook(
  reader: FeedTreeReader,
  indexPath: string,
): Promise<NotebookIndex> {
  const raw = decodeUtf8(await reader.read(indexPath));
  return assertNotebookIndex(JSON.parse(raw));
}

export async function previewRemoteRecord(
  reader: FeedTreeReader,
  recordOrPath: string | SeedRecordRef,
  options?: { fetchImpl?: FetchLike },
): Promise<SeedRow> {
  if (typeof recordOrPath === 'string') {
    if (/\.md$/i.test(recordOrPath)) {
      const markdown = await readTextFromReaderOrUrl(reader, recordOrPath, options?.fetchImpl);
      return compileSeedRowFromMarkdown({ path: recordOrPath, markdown });
    }
    const raw = await readTextFromReaderOrUrl(reader, recordOrPath, options?.fetchImpl);
    return assertSeedRow(JSON.parse(raw));
  }

  if (recordOrPath.recordPath) {
    try {
      const raw = await readTextFromReaderOrUrl(reader, recordOrPath.recordPath, options?.fetchImpl);
      return assertSeedRow(JSON.parse(raw));
    } catch (err) {
      const hasMarkdownFallback = Boolean(recordOrPath.rawUrl || /\.md$/i.test(recordOrPath.path));
      const isNotFound = err instanceof FeedTreeError && err.code === 'not-found';
      if (!isNotFound || !hasMarkdownFallback) throw err;
    }
  }

  const rawTarget = recordOrPath.rawUrl ?? recordOrPath.path;
  const markdown = await readTextFromReaderOrUrl(reader, rawTarget, options?.fetchImpl);
  return compileSeedRowFromMarkdown({
    path: recordOrPath.path,
    markdown,
    uuid: recordOrPath.uuid,
    commit: recordOrPath.commit,
    version: recordOrPath.version,
    title: recordOrPath.title,
    date: recordOrPath.date,
  });
}

export async function cloneRemoteRecord(
  storage: IStorage,
  reader: FeedTreeReader,
  input: {
    feedId: string;
    record: SeedRecordRef;
    targetNotebookId: string;
    sourceNotebookId?: string;
    includePublicTelemetry?: boolean;
  },
): Promise<Note> {
  const targetNotebookId = toNotebookId(input.targetNotebookId);
  if (isSystemReadOnlyNotebook(targetNotebookId)) {
    throw new Error(`Target notebook '${targetNotebookId}' is read-only`);
  }
  const seedRow = await previewRemoteRecord(reader, input.record);
  const newNoteId = mintUuidV4();
  const now = Date.now();

  const sourceRevision = 1;
  const blocks: Record<string, NoteBlock> = {};
  const revisions: BlockRevision[] = [];
  const blockIndex: BlockIndexRow[] = [];

  for (const [key, block] of Object.entries(seedRow.blocks)) {
    blocks[key] = { ...block, version: 1, sourceRevision: 1 };
    revisions.push({
      noteId: newNoteId,
      blockId: block.id,
      version: 1,
      kind: block.kind,
      rawContent: seedRow.content.slice(block.from, block.to),
      savedAt: now,
      ...(block.dialect ? { dialect: block.dialect } : {}),
      ...(block.sport ? { sport: block.sport } : {}),
    });
  }

  for (const proj of seedRow.blockIndex) {
    blockIndex.push({
      ...proj,
      id: `${newNoteId}:${proj.blockId}`,
      noteId: newNoteId,
      blockVersion: 1,
      sourceRevision: 1,
      isStatic: false,
      notebookId: targetNotebookId,
    });
  }

  const blockEfforts: BlockEffort[] = seedRow.blockEfforts.map((eff) => ({
    ...eff,
    id: `${newNoteId}:${eff.blockId}:${eff.effortSlug}`,
    noteId: newNoteId,
    isStatic: false,
  }));

  const blockEquipment: BlockEquipment[] = seedRow.blockEquipment.map((eq) => ({
    ...eq,
    id: `${newNoteId}:${eq.blockId}:${eq.equipmentSlug}`,
    noteId: newNoteId,
    isStatic: false,
  }));

  const inferredNbSlug = notebookSlugFromFeedPath(seedRow.path);
  const sourceNotebookId = input.sourceNotebookId
    ? toNotebookId(input.sourceNotebookId)
    : inferredNbSlug
      ? toNotebookId(inferredNbSlug)
      : undefined;
  const sourceNoteId = input.record.uuid || seedRow.uuid || (await seedNoteId(seedRow.path));
  const sourceVersion = input.record.version ?? seedRow.version;
  const sourceCommit = (input.record.commit || seedRow.commit) || undefined;
  const provenance: NoteProvenance = {
    sourceNoteId,
    ...(sourceVersion !== undefined ? { sourceVersion } : {}),
    ...(sourceCommit ? { sourceCommit } : {}),
    feedSourceId: input.feedId,
    ...(sourceNotebookId ? { sourceNotebookId } : {}),
    sourcePath: seedRow.path,
    clonedAt: now,
  };

  const clonedNote: Note = {
    id: newNoteId,
    title: input.record.title || seedRow.blockIndex[0]?.noteTitle || 'Cloned Note',
    rawContent: seedRow.content,
    sourceRevision,
    blocks,
    ...(input.record.date !== undefined ? { date: input.record.date } : {}),
    createdAt: now,
    notebookId: targetNotebookId,
    notebookIds: [targetNotebookId],
    provenance,
    sourceId: `feed:${input.feedId}/${seedRow.path}`,
    sourcePath: seedRow.path,
    seedOrigin: 'user',
  };

  const clonedSessions: Session[] = [];
  const clonedEvents: EventRecord[] = [];
  if (input.includePublicTelemetry !== false && seedRow.telemetry) {
    const sessionIdMap = new Map<string, string>();
    for (const s of seedRow.telemetry.sessions) {
      const nextSid = mintUuidV4();
      sessionIdMap.set(s.id, nextSid);
      clonedSessions.push({
        ...s,
        id: nextSid,
        noteId: newNoteId,
        public: false,
      });
    }
    for (const ev of seedRow.telemetry.events) {
      const nextSid = sessionIdMap.get(ev.resultId);
      if (!nextSid) continue;
      clonedEvents.push({
        ...ev,
        id: `${nextSid}:${ev.id}`,
        resultId: nextSid,
        noteId: newNoteId,
      });
    }
  }

  const notebookLink: NotebookLink = {
    id: makeNotebookLinkId(targetNotebookId, 'note', newNoteId),
    notebookId: targetNotebookId,
    targetKind: 'note',
    targetId: newNoteId,
    noteId: newNoteId,
    createdAt: now,
  };

  await storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'sessions', 'events', 'notebook_links'],
    'readwrite',
    async (tx) => {
      const landing = await tx.readonly('notes').get(targetNotebookId);
      if (landing && (landing.feedOrigin === 'feed' || landing.seedOrigin === 'seed')) {
        throw new Error(`Target notebook '${targetNotebookId}' is read-only`);
      }
      await tx.readwrite('notes').put(clonedNote);
      await tx.readwrite('notebook_links').put(notebookLink);
      if (revisions.length > 0) await tx.readwrite('block_revisions').putMany(revisions);
      if (blockIndex.length > 0) await tx.readwrite('block_index').putMany(blockIndex);
      if (blockEfforts.length > 0) await tx.readwrite('block_efforts').putMany(blockEfforts);
      if (blockEquipment.length > 0) await tx.readwrite('block_equipment').putMany(blockEquipment);
      if (clonedSessions.length > 0) await tx.readwrite('sessions').putMany(clonedSessions);
      if (clonedEvents.length > 0) await tx.readwrite('events').putMany(clonedEvents);
    },
  );

  return clonedNote;
}

type RetentionNote = Note & {
  retention?: 'indexed' | 'cached' | 'session-pinned';
  upstreamStatus?: 'live' | 'unsubscribed' | 'removed';
};

async function clearRowsByNoteIndex<T>(
  store: IReadWriteStore<T>,
  noteId: string,
  keyOf: (row: T) => IDBValidKey | undefined,
): Promise<void> {
  let rows: T[];
  try {
    rows = await store.getAllFromIndex('by-note', noteId);
  } catch {
    rows = await store.getAll();
  }
  for (const row of rows) {
    const rec = row as unknown as Record<string, unknown> | undefined;
    if (!rec || rec['noteId'] !== noteId) continue;
    const key = keyOf(row);
    if (key !== undefined) await store.delete(key);
  }
}

/**
 * Persist an on-demand fetched/compiled remote workout under its canonical
 * UUID with `retention: 'cached'` and `upstreamStatus: 'live'`.
 * Never overwrites user-authored notes or `session-pinned` local copies.
 */
export async function materializeCachedRemoteRecord(
  storage: IStorage,
  input: {
    feedId?: string;
    notebookId?: string;
    notebookSlug?: string;
    record?: SeedRecordRef;
    seedRow: SeedRow;
    retention?: 'cached' | 'session-pinned';
    upstreamStatus?: 'live' | 'unsubscribed' | 'removed';
  },
): Promise<RetentionNote> {
  const canonicalId = input.record?.uuid || input.seedRow.uuid || (await seedNoteId(input.seedRow.path));
  const inferredNbSlug = input.notebookSlug ?? notebookSlugFromFeedPath(input.seedRow.path);
  const notebookId = input.notebookId
    ? toNotebookId(input.notebookId)
    : inferredNbSlug
      ? toNotebookId(inferredNbSlug)
      : undefined;
  const seedChunkId = inferredNbSlug
    ? `notebook.${inferredNbSlug}`
    : notebookId
      ? `notebook.${notebookId.replace(/^notebook\//, '')}`
      : undefined;
  const version = input.record?.version ?? input.seedRow.version ?? 1;
  const title =
    input.record?.title ||
    input.seedRow.blockIndex[0]?.noteTitle ||
    titleFromMarkdown(input.seedRow.path, input.seedRow.content);
  const commit = (input.record?.commit || input.seedRow.commit) || undefined;
  const now = Date.now();

  return storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment'],
    'readwrite',
    async (tx) => {
      const notesStore = tx.readwrite('notes');
      const existing = (await notesStore.get(canonicalId)) as RetentionNote | undefined;
      if (existing) {
        const isUserOwned =
          existing.seedOrigin !== 'seed' && existing.feedOrigin !== 'feed' && !existing.retention;
        if (isUserOwned || existing.retention === 'session-pinned') {
          return existing;
        }
        if (
          existing.rawContent === input.seedRow.content &&
          Object.keys(existing.blocks).length > 0 &&
          existing.retention === 'cached'
        ) {
          if (
            existing.upstreamStatus !== (input.upstreamStatus ?? 'live') ||
            (input.feedId && existing.feedSourceId !== input.feedId)
          ) {
            const refreshed: RetentionNote = {
              ...existing,
              ...(input.feedId ? { feedOrigin: 'feed', feedSourceId: input.feedId } : {}),
              upstreamStatus: input.upstreamStatus ?? 'live',
            };
            await notesStore.put(refreshed);
            return refreshed;
          }
          return existing;
        }
      }

      const sourceRevision = existing ? existing.sourceRevision + 1 : 1;
      const blocks: Record<string, NoteBlock> = {};
      const revisions: BlockRevision[] = [];
      const revStore = tx.readwrite('block_revisions');
      const blockVer = existing ? sourceRevision : 1;

      for (const [key, block] of Object.entries(input.seedRow.blocks)) {
        blocks[key] = { ...block, version: blockVer, sourceRevision };
        revisions.push({
          noteId: canonicalId,
          blockId: block.id,
          version: blockVer,
          kind: block.kind,
          rawContent: input.seedRow.content.slice(block.from, block.to),
          savedAt: now,
          ...(block.dialect ? { dialect: block.dialect } : {}),
          ...(block.sport ? { sport: block.sport } : {}),
        });
      }

      const cachedSourceId = input.feedId ? `feed:${input.feedId}/${input.seedRow.path}` : input.seedRow.path;
      const blockIndexStore = tx.readwrite('block_index');
      const blockEffortsStore = tx.readwrite('block_efforts');
      const blockEquipmentStore = tx.readwrite('block_equipment');
      await clearRowsByNoteIndex(blockIndexStore, canonicalId, (r) => r.id);
      await clearRowsByNoteIndex(blockEffortsStore, canonicalId, (r) => r.id);
      await clearRowsByNoteIndex(blockEquipmentStore, canonicalId, (r) => r.id);

      const blockIndex: BlockIndexRow[] = input.seedRow.blockIndex.map((proj) => ({
        ...proj,
        id: `${canonicalId}:${proj.blockId}`,
        noteId: canonicalId,
        blockVersion: blockVer,
        sourceRevision,
        isStatic: true,
        sourceId: cachedSourceId,
        sourcePath: input.seedRow.path,
        ...(notebookId ? { notebookId } : {}),
      }));
      const blockEfforts: BlockEffort[] = input.seedRow.blockEfforts.map((eff) => ({
        ...eff,
        id: `${canonicalId}:${eff.blockId}:${eff.effortSlug}`,
        noteId: canonicalId,
        isStatic: true,
      }));
      const blockEquipment: BlockEquipment[] = input.seedRow.blockEquipment.map((eq) => ({
        ...eq,
        id: `${canonicalId}:${eq.blockId}:${eq.equipmentSlug}`,
        noteId: canonicalId,
        isStatic: true,
      }));

      const cachedNote: RetentionNote = {
        id: canonicalId,
        title,
        rawContent: input.seedRow.content,
        sourceRevision,
        blocks,
        ...(input.record?.date !== undefined ? { date: input.record.date } : existing?.date !== undefined ? { date: existing.date } : {}),
        createdAt: existing?.createdAt ?? input.record?.date ?? now,
        ...(notebookId ? { notebookId, notebookIds: [notebookId] } : existing?.notebookId ? { notebookId: existing.notebookId } : {}),
        ...(input.feedId ? { feedOrigin: 'feed' as const, feedSourceId: input.feedId } : existing?.feedOrigin ? { feedOrigin: existing.feedOrigin, feedSourceId: existing.feedSourceId } : {}),
        seedOrigin: 'seed',
        ...(seedChunkId ? { seedChunkId } : existing?.seedChunkId ? { seedChunkId: existing.seedChunkId } : {}),
        seedVersion: version,
        ...(commit ? { seedCommit: commit } : {}),
        sourceId: cachedSourceId,
        sourcePath: input.seedRow.path,
        retention: input.retention ?? 'cached',
        upstreamStatus: input.upstreamStatus ?? 'live',
      };

      await notesStore.put(cachedNote);
      if (revisions.length > 0) await revStore.putMany(revisions);
      if (blockIndex.length > 0) await blockIndexStore.putMany(blockIndex);
      if (blockEfforts.length > 0) await blockEffortsStore.putMany(blockEfforts);
      if (blockEquipment.length > 0) await blockEquipmentStore.putMany(blockEquipment);
      return cachedNote;
    },
  );
}

// ── Symmetric Portable Files Export & Import (.md + .jsonl / .csv) ──────────

export interface PortableFileEntry {
  path: string;
  content?: string;
  bytes?: Uint8Array;
}

const portableTextDecoder = new TextDecoder();

function decodePortableFileContent(entry: PortableFileEntry): string {
  if (typeof entry.content === 'string') return entry.content;
  if (entry.bytes instanceof Uint8Array) return portableTextDecoder.decode(entry.bytes);
  throw new Error(`PortableFileEntry '${entry.path}' is missing both 'content' and 'bytes'.`);
}

export interface PortabilityImportReport {
  notesImported: number;
  revisionsImported: number;
  sessionsImported: number;
  eventsImported: number;
  errors: string[];
}

export async function exportPortableFilesFromStorage(
  storage: IStorage,
  options: {
    noteIds?: readonly string[];
    telemetryFormat?: 'jsonl' | 'csv' | 'both';
  } = {},
): Promise<PortableFileEntry[]> {
  const telemetryFormat = options.telemetryFormat ?? 'jsonl';
  const [allNotes, allSessions, allEvents, allRevisions] = await Promise.all([
    storage.readonly('notes').getAll(),
    storage.readonly('sessions').getAll(),
    storage.readonly('events').getAll(),
    storage.readonly('block_revisions').getAll(),
  ]);

  const wantedIds = options.noteIds ? new Set(options.noteIds) : null;
  const notes = allNotes.filter((n) => {
    if (wantedIds) return wantedIds.has(n.id);
    return n.seedOrigin !== 'seed' && n.feedOrigin !== 'feed';
  });

  const sessionsByNote = new Map<string, Session[]>();
  for (const s of allSessions) {
    const arr = sessionsByNote.get(s.noteId) ?? [];
    arr.push(s);
    sessionsByNote.set(s.noteId, arr);
  }
  const eventsBySession = new Map<string, EventRecord[]>();
  for (const ev of allEvents) {
    const arr = eventsBySession.get(ev.resultId) ?? [];
    arr.push(ev);
    eventsBySession.set(ev.resultId, arr);
  }
  const revisionsByNote = new Map<string, BlockRevision[]>();
  for (const rev of allRevisions) {
    const arr = revisionsByNote.get(rev.noteId) ?? [];
    arr.push(rev);
    revisionsByNote.set(rev.noteId, arr);
  }

  const files: PortableFileEntry[] = [];
  const usedPaths = new Set<string>();

  for (const note of notes) {
    const baseStem = note.id.replace(/[^a-zA-Z0-9-_]/g, '_');
    let stem = baseStem;
    let i = 2;
    while (usedPaths.has(stem)) stem = `${baseStem}_${i++}`;
    usedPaths.add(stem);

    files.push({
      path: `${stem}.md`,
      content: composeNoteMarkdown(note),
    });

    const sessions = sessionsByNote.get(note.id) ?? [];
    const revisions = revisionsByNote.get(note.id) ?? [];
    const events = sessions.flatMap((s) => eventsBySession.get(s.id) ?? []);

    if (sessions.length > 0 || revisions.length > 0) {
      const bundle: NoteTelemetryBundle = {
        revisions,
        sessions,
        events,
      };
      if (telemetryFormat === 'jsonl' || telemetryFormat === 'both') {
        files.push({
          path: `${stem}.jsonl`,
          content: serializeNoteBundleToJsonl(bundle) + '\n',
        });
      }
      if (telemetryFormat === 'csv' || telemetryFormat === 'both') {
        files.push({
          path: `${stem}.csv`,
          content: telemetryBundleToCsv(bundle),
        });
      }
    }
  }

  return files;
}

export async function ingestPortableFilesIntoStorage(
  storage: IStorage,
  files: readonly PortableFileEntry[],
  options: { defaultNotebookId?: string; now?: number } = {},
): Promise<PortabilityImportReport> {
  const now = options.now ?? Date.now();
  const errors: string[] = [];
  let notesImported = 0;
  let revisionsImported = 0;
  let sessionsImported = 0;
  let eventsImported = 0;

  const mdFiles = files.filter((f) => /\.md$/i.test(f.path) && !/(?:^|\/)README\.md$/i.test(f.path));
  const jsonlFiles = files.filter((f) => /\.jsonl$/i.test(f.path));
  const jsonlStems = new Set(jsonlFiles.map((f) => f.path.replace(/\.jsonl$/i, '')));
  const csvFiles = files.filter(
    (f) => /\.csv$/i.test(f.path) && !jsonlStems.has(f.path.replace(/\.csv$/i, '')),
  );
  const telemetryBundles: NoteTelemetryBundle[] = [];
  for (const jf of jsonlFiles) {
    const parsed = parseNoteBundleFromJsonl(decodePortableFileContent(jf));
    errors.push(...parsed.errors.map((e) => `${jf.path}: ${e}`));
    telemetryBundles.push(...parsed.bundles);
  }
  for (const cf of csvFiles) {
    const parsed = csvToTelemetryBundle(decodePortableFileContent(cf));
    errors.push(...parsed.errors.map((e) => `${cf.path}: ${e}`));
    telemetryBundles.push(...parsed.bundles);
  }

  await storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'tags', 'note_tags', 'sessions', 'events'],
    'readwrite',
    async (tx) => {
      const noteStore = tx.readwrite('notes');
      const revStore = tx.readwrite('block_revisions');
      const idxStore = tx.readwrite('block_index');
      const tagStore = tx.readwrite('tags');
      const noteTagStore = tx.readwrite('note_tags');
      const sessionStore = tx.readwrite('sessions');
      const eventStore = tx.readwrite('events');

      // 1. Restore revisions first so historical session pins remain intact
      for (const bundle of telemetryBundles) {
        if (bundle.revisions && bundle.revisions.length > 0) {
          await revStore.putMany(bundle.revisions);
          revisionsImported += bundle.revisions.length;
        }
      }

      // 2. Ingest Markdown notes
      for (const mf of mdFiles) {
        try {
          const fallbackTitle = (mf.path.split('/').at(-1) ?? 'Imported Note').replace(/\.md$/i, '');
          const parsed = parseNoteMarkdown(decodePortableFileContent(mf), { fallbackTitle });
          const noteId = parsed.id ?? (await seedNoteId(`import:${mf.path}:${now}`));
          const existing = await noteStore.get(noteId);
          const nextRev =
            existing && existing.rawContent !== parsed.rawContent
              ? existing.sourceRevision + 1
              : (existing?.sourceRevision ?? 1);
          const blocks =
            existing && existing.rawContent === parsed.rawContent
              ? existing.blocks
              : reconcileNoteBlocks(parsed.rawContent, {
                  sourceRevision: nextRev,
                  blocks: existing?.blocks,
                  registeredWidgets: KNOWN_SECTION_WIDGETS,
                });

          const noteRow: Note = {
            ...(existing ?? {}),
            id: noteId,
            title: parsed.title,
            rawContent: parsed.rawContent,
            sourceRevision: nextRev,
            blocks,
            ...(parsed.date !== undefined ? { date: parsed.date } : {}),
            createdAt: existing?.createdAt ?? parsed.date ?? now,
            ...(parsed.notebookId
              ? { notebookId: parsed.notebookId }
              : options.defaultNotebookId
                ? { notebookId: toNotebookId(options.defaultNotebookId) }
                : {}),
            ...(parsed.public !== undefined ? { public: parsed.public } : {}),
            tags: parsed.tags,
            seedOrigin: 'user',
          };
          await noteStore.put(noteRow);

          // Ensure current block revisions & block_index exist
          const sections = parseDocumentSections(noteRow.rawContent, { registeredWidgets: KNOWN_SECTION_WIDGETS });
          for (const [pos, b] of Object.values(blocks).entries()) {
            const existingRev = await revStore.get([noteId, b.id, b.version]);
            if (!existingRev) {
              await revStore.put({
                noteId,
                blockId: b.id,
                version: b.version,
                kind: b.kind,
                rawContent: noteRow.rawContent.slice(b.from, b.to),
                savedAt: now,
                ...(b.dialect ? { dialect: b.dialect } : {}),
                ...(b.sport ? { sport: b.sport } : {}),
              });
            }
            const sec = sections.find((s) => s.from === b.from && s.to === b.to);
            await idxStore.put({
              id: `${noteId}:${b.id}`,
              noteId,
              blockId: b.id,
              blockVersion: b.version,
              sourceRevision: nextRev,
              from: b.from,
              to: b.to,
              position: pos,
              dataType: b.kind,
              ...(b.kind === 'wod'
                ? { blockContentId: blockContentId(sec?.scriptBlock?.content ?? noteRow.rawContent.slice(b.from, b.to)) }
                : {}),
              rawContent: noteRow.rawContent.slice(b.from, b.to),
              noteTitle: noteRow.title,
              createdAt: noteRow.date ?? noteRow.createdAt,
              isStatic: false,
              ...(noteRow.notebookId ? { notebookId: noteRow.notebookId } : {}),
            });
          }

          // Link typed tags
          if (parsed.typedTags.length > 0) {
            const allTags = await tagStore.getAll();
            for (const item of parsed.typedTags) {
              const tagType = item.type ?? 'general';
              let tag = allTags.find((t) => t.label === item.label && (t.type ?? 'general') === tagType);
              if (!tag) {
                tag = { id: mintUuidV4(), label: item.label, type: tagType, createdAt: now } satisfies Tag;
                await tagStore.put(tag);
                allTags.push(tag);
              }
              const linkId = `${noteId}:${tag.id}`;
              await noteTagStore.put({ id: linkId, noteId, tagId: tag.id } satisfies NoteTag);
            }
          }

          notesImported++;
        } catch (err) {
          errors.push(`${mf.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. Ingest JSONL / CSV telemetry bundles (including optional embedded note fallback)
      for (const bundle of telemetryBundles) {
        if (bundle.note) {
          const existing = await noteStore.get(bundle.note.id);
          if (!existing) {
            const blocks =
              bundle.note.blocks ??
              reconcileNoteBlocks(bundle.note.rawContent, {
                sourceRevision: bundle.note.sourceRevision ?? 1,
                registeredWidgets: KNOWN_SECTION_WIDGETS,
              });
            await noteStore.put({
              id: bundle.note.id,
              title: bundle.note.title,
              rawContent: bundle.note.rawContent,
              sourceRevision: bundle.note.sourceRevision ?? 1,
              blocks,
              date: bundle.note.targetDate,
              createdAt: bundle.note.createdAt,
              tags: bundle.note.tags ?? [],
              ...(bundle.note.type ? { type: bundle.note.type } : {}),
              ...(bundle.note.sourceId ? { sourceId: bundle.note.sourceId } : {}),
              seedOrigin: 'user',
            });
            for (const b of Object.values(blocks)) {
              const hasRev = await revStore.get([bundle.note.id, b.id, b.version]);
              if (!hasRev) {
                await revStore.put({
                  noteId: bundle.note.id,
                  blockId: b.id,
                  version: b.version,
                  kind: b.kind,
                  rawContent: bundle.note.rawContent.slice(b.from, b.to),
                  savedAt: now,
                  ...(b.dialect ? { dialect: b.dialect } : {}),
                  ...(b.sport ? { sport: b.sport } : {}),
                });
              }
            }
            notesImported++;
          }
        }

        for (const session of bundle.sessions) {
          try {
            const parent = await noteStore.get(session.noteId);
            if (!parent) {
              throw new Error(`Parent note ${session.noteId} does not exist`);
            }
            const rev = await revStore.get([session.noteId, session.blockId, session.blockVersion]);
            if (!rev || rev.kind !== 'wod') {
              throw new Error(
                `Pinned wod BlockRevision [${session.noteId}, ${session.blockId}, ${session.blockVersion}] does not exist`,
              );
            }
            const sessionEvents = bundle.events.filter((ev) => ev.resultId === session.id);
            for (const ev of sessionEvents) {
              if (
                ev.noteId !== session.noteId ||
                ev.blockId !== session.blockId ||
                ev.blockVersion !== session.blockVersion ||
                ev.blockContentId !== session.blockContentId
              ) {
                throw new Error(`Event ${ev.id} does not match session ${session.id} identity`);
              }
            }
            await sessionStore.put(session);
            if (sessionEvents.length > 0) {
              await eventStore.putMany(sessionEvents);
              eventsImported += sessionEvents.length;
            }
            sessionsImported++;
          } catch (err) {
            errors.push(
              `Failed to import session ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    },
  );

  return {
    notesImported,
    revisionsImported,
    sessionsImported,
    eventsImported,
    errors,
  };
}
