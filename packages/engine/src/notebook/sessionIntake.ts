/**
 * SessionIntake — Deep module owning external-workout archival pinning,
 * atomic Session pinning & Journal linking, explicit Fork-to-User-Notebook,
 * and upstream Note provenance resolution.
 *
 * When a workout is run or logged on ANY non-owned Note (`feed`, `system`,
 * `feed-archived`, or `remote:<feedId>:<uuid>`):
 *   1. Ensures ONE immutable local archival copy exists under the canonical
 *      workout ID (`retention: 'session-pinned'`, `BlockRevision`s,
 *      `block_index`, and structured `NoteProvenance`), never spawning a new
 *      duplicate Journal Note on every run.
 *   2. Pins the `Session` (`session.noteId = canonicalWorkoutNoteId`,
 *      `blockId`, `blockVersion`, `blockContentId`, `pageId` for the Journal
 *      calendar `Page`, `notebookIds: ['notebook/journal']`) directly to that
 *      single local copy so all repeated attempts aggregate on the workout's
 *      own page while appearing in Journal / Calendar / Sessions views via
 *      `session.pageId` and `notebook_links` (`targetKind: 'session'`).
 *   3. Preserves the WW-052 invariant: `prepareJournalSessionRun` never
 *      persists a 0s phantom `Session` before the run commits.
 *
 * Explicit editing/ownership copies use `forkNoteToUserNotebook`, which
 * creates a real editable `seedOrigin: 'user'` Note in a writable user
 * Notebook with full `NoteProvenance`, `notebook_links`, and `block_revisions`.
 */

import {
  KNOWN_SECTION_WIDGETS,
  blockContentId,
  isNonPublishableNotebook,
  isSystemReadOnlyNotebook,
  notebookSlugFromId,
  parseDocumentSections,
  reconcileNoteBlocks,
  resolveNoteOwnership,
  toNotebookId,
  type BlockEffort,
  type BlockEquipment,
  type BlockIndexRow,
  type BlockRevision,
  type EventRecord,
  type Note,
  type NoteBlock,
  type NoteProvenance,
  type NoteUpstreamStatus,
  type NotebookId,
  type NotebookLink,
  type Page,
  type PageNote,
  type ResolvedNoteOwnership,
  type ResultOrigin,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import type { IStorage, IStorageTransaction } from '@bitcobblers/wod-wiki-storage';
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import { readFrontmatterMeta } from '../exchange';
import { makeNotebookLinkId } from './membership';

function mintUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function utcCivilDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface ParsedRemoteNoteId {
  isRemote: true;
  feedId: string;
  uuid: string;
}

export function parseRemoteNoteId(
  noteId: string,
): ParsedRemoteNoteId | { isRemote: false } {
  if (!noteId.startsWith('remote:')) return { isRemote: false };
  const rest = noteId.slice('remote:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return { isRemote: false };
  const feedId = rest.slice(0, sep);
  const uuid = rest.slice(sep + 1);
  if (!uuid) return { isRemote: false };
  return { isRemote: true, feedId, uuid };
}

export interface RemoteSeedRowLike {
  path: string;
  content: string;
  blocks: Record<string, NoteBlock>;
  blockIndex?: BlockIndexRow[];
  blockEfforts?: BlockEffort[];
  blockEquipment?: BlockEquipment[];
  commit?: string;
  uuid?: string;
  version?: number;
}

export interface ExternalWorkoutPayload {
  id?: string;
  title?: string;
  rawContent: string;
  blocks?: Record<string, NoteBlock>;
  date?: number;
  createdAt?: number;
  tags?: string[];
  type?: Note['type'];
  sourceId?: string;
  sourcePath?: string;
  seedOrigin?: 'seed' | 'user';
  seedVersion?: number;
  seedChunkId?: string;
  seedCommit?: string;
  feedOrigin?: 'feed' | 'user';
  feedSourceId?: string;
  sourceNotebookId?: string;
  upstreamStatus?: NoteUpstreamStatus;
  seedRow?: RemoteSeedRowLike;
}

export interface ResolvedRemoteWorkoutEnvelope {
  note?: Note;
  row?: RemoteSeedRowLike;
  canonicalNoteId?: string;
  remoteNoteId?: string;
  feedId?: string;
  notebookSlug?: string;
  record?: {
    uuid?: string;
    path?: string;
    commit?: string;
    version?: number;
    title?: string;
    date?: number;
  };
}

export type RemoteWorkoutResolution =
  | ExternalWorkoutPayload
  | Note
  | RemoteSeedRowLike
  | ResolvedRemoteWorkoutEnvelope;

export interface EnsurePinnedExternalWorkoutInput {
  noteId: string;
  remotePayload?: RemoteWorkoutResolution;
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
  now?: number;
}

export interface PinnedExternalWorkoutResult {
  note: Note;
  created: boolean;
  promotedFromLocal: boolean;
  ownership: ResolvedNoteOwnership;
}

export interface PrepareJournalSessionRunInput {
  noteId: string;
  blockId?: string;
  sessionId?: string;
  journalDate?: string;
  startedAt?: number;
  origin?: ResultOrigin;
  remotePayload?: RemoteWorkoutResolution;
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
}

export interface PreparedJournalSessionRun {
  note: Note;
  revision: BlockRevision;
  session: Session;
  /** Always false under single-archival-copy semantics (kept for backward shape compatibility). */
  clonedFromReadOnly: boolean;
  /** True when the Session is pinned to an external (feed/system/remote) canonical archival Note. */
  pinnedExternalWorkout: boolean;
  upstreamNoteId?: string;
}

export interface LogSessionAgainstExternalWorkoutInput {
  noteId: string;
  blockId?: string;
  sessionId?: string;
  journalDate?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  completed?: boolean;
  roundsCompleted?: number;
  totalRounds?: number;
  repsCompleted?: number;
  origin?: ResultOrigin;
  public?: boolean;
  events?: EventRecord[];
  remotePayload?: RemoteWorkoutResolution;
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
}

export interface LoggedExternalWorkoutSession {
  note: Note;
  revision: BlockRevision;
  session: Session;
  page: Page;
  links: NotebookLink[];
  events: EventRecord[];
  pinnedResult: PinnedExternalWorkoutResult;
}

export interface ForkNoteOptions {
  title?: string;
  journalDate?: string;
  now?: number;
  remotePayload?: RemoteWorkoutResolution;
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
}

export interface ResolvedUpstreamProvenance {
  exists: boolean;
  sourceNoteId: string;
  title?: string;
  sourceVersion?: number;
  currentUpstreamVersion?: number;
  sourceCommit?: string;
  feedSourceId?: string;
  sourceNotebookId?: string;
  sourcePath?: string;
  upstreamStatus?: NoteUpstreamStatus;
}

function computeWodContentId(blockSource: string): string | undefined {
  const sec = parseDocumentSections(blockSource, { registeredWidgets: KNOWN_SECTION_WIDGETS }).find(
    (s) => s.scriptBlock,
  );
  if (sec?.scriptBlock?.contentId) return sec.scriptBlock.contentId;
  if (sec?.scriptBlock?.content) return blockContentId(sec.scriptBlock.content);
  return undefined;
}

function extractTitleFromMarkdown(rawContent: string, sourcePath?: string): string {
  const fm = readFrontmatterMeta(rawContent);
  if (typeof fm['title'] === 'string' && fm['title'].trim()) return fm['title'].trim();
  const withoutFm = rawContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const line of withoutFm.split(/\r?\n/)) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  if (sourcePath) {
    const stem = (sourcePath.split('/').at(-1) ?? '').replace(/\.md$/i, '');
    if (stem) return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Workout';
}

function parseFrontmatterDateEpoch(rawContent: string): number | undefined {
  const fm = readFrontmatterMeta(rawContent);
  const rawDate = typeof fm['date'] === 'string' ? fm['date'].trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
  if (!match) return undefined;
  const ts = Date.parse(`${rawDate}T12:00:00Z`);
  if (!Number.isFinite(ts)) return undefined;
  const d = new Date(ts);
  if (d.getUTCMonth() !== Number(match[2]) - 1 || d.getUTCDate() !== Number(match[3])) {
    return undefined;
  }
  return ts;
}

function deriveNotebookSourceMeta(
  sourcePath?: string,
  notebookSlug?: string,
): { sourceId?: string; seedChunkId?: string; sourceNotebookId?: string } {
  if (sourcePath?.startsWith('markdown/notebooks/')) {
    const rel = sourcePath.slice('markdown/notebooks/'.length).replace(/\.md$/i, '');
    const segs = rel.split('/');
    const slug = segs[0];
    if (slug) {
      const isLanding = segs.length === 2 && segs[1]!.toLowerCase() === 'readme';
      return {
        sourceId: isLanding ? `notebook:${slug}` : `notebook:${rel}`,
        seedChunkId: `notebook.${slug}`,
        sourceNotebookId: toNotebookId(slug),
      };
    }
  }
  if (notebookSlug) {
    const clean = notebookSlugFromId(notebookSlug);
    return {
      sourceId: `notebook:${clean}`,
      seedChunkId: `notebook.${clean}`,
      sourceNotebookId: toNotebookId(clean),
    };
  }
  return {};
}

function isEnvelope(val: RemoteWorkoutResolution): val is ResolvedRemoteWorkoutEnvelope {
  return (
    typeof val === 'object' &&
    val !== null &&
    !('rawContent' in val) &&
    !('content' in val) &&
    ('row' in val || 'note' in val || 'canonicalNoteId' in val)
  );
}

function isBareSeedRow(val: RemoteWorkoutResolution): val is RemoteSeedRowLike {
  return typeof val === 'object' && val !== null && 'content' in val && 'path' in val && !('rawContent' in val);
}

interface NormalizedMaterialization {
  canonicalNoteId: string;
  title: string;
  rawContent: string;
  blocks: Record<string, NoteBlock>;
  date?: number;
  createdAt: number;
  tags?: string[];
  type: Note['type'];
  sourceId?: string;
  sourcePath?: string;
  seedOrigin: 'seed' | 'user';
  feedOrigin?: 'feed' | 'user';
  feedSourceId?: string;
  seedVersion: number;
  seedChunkId?: string;
  seedCommit?: string;
  sourceNotebookId?: string;
  upstreamStatus: NoteUpstreamStatus;
  seedRow?: RemoteSeedRowLike;
}

function normalizeRemoteResolution(
  requestedNoteId: string,
  resolution: RemoteWorkoutResolution,
  now: number,
): NormalizedMaterialization {
  const parsedRemote = parseRemoteNoteId(requestedNoteId);
  let notePart: Partial<Note & ExternalWorkoutPayload> | undefined;
  let seedRow: RemoteSeedRowLike | undefined;
  let envelopeFeedId: string | undefined;
  let envelopeNbSlug: string | undefined;
  let envelopeCanonicalId: string | undefined;
  let recordMeta: ResolvedRemoteWorkoutEnvelope['record'] | undefined;

  if (isEnvelope(resolution)) {
    notePart = resolution.note;
    seedRow = resolution.row;
    envelopeFeedId = resolution.feedId;
    envelopeNbSlug = resolution.notebookSlug;
    envelopeCanonicalId = resolution.canonicalNoteId;
    recordMeta = resolution.record;
  } else if (isBareSeedRow(resolution)) {
    seedRow = resolution;
  } else {
    notePart = resolution as Partial<Note & ExternalWorkoutPayload>;
    if ('seedRow' in resolution && resolution.seedRow) {
      seedRow = resolution.seedRow;
    }
  }

  const rawContent = notePart?.rawContent ?? seedRow?.content ?? '';
  if (!rawContent) {
    throw new Error(`Resolved remote workout '${requestedNoteId}' has no Markdown content.`);
  }

  const canonicalNoteId =
    envelopeCanonicalId ??
    (notePart?.id && !notePart.id.startsWith('remote:') ? notePart.id : undefined) ??
    seedRow?.uuid ??
    recordMeta?.uuid ??
    (parsedRemote.isRemote ? parsedRemote.uuid : requestedNoteId);

  const sourcePath = notePart?.sourcePath ?? seedRow?.path ?? recordMeta?.path;
  const pathDerived = deriveNotebookSourceMeta(sourcePath, envelopeNbSlug);

  const feedSourceId =
    notePart?.feedSourceId ??
    envelopeFeedId ??
    (parsedRemote.isRemote ? parsedRemote.feedId : undefined);

  const sourceNotebookId =
    notePart?.sourceNotebookId ??
    notePart?.provenance?.sourceNotebookId ??
    pathDerived.sourceNotebookId ??
    (notePart ? notebookOfItem(notePart) : undefined);

  const sourceId = notePart?.sourceId ?? pathDerived.sourceId;
  const seedChunkId = notePart?.seedChunkId ?? pathDerived.seedChunkId;
  const seedVersion = notePart?.seedVersion ?? seedRow?.version ?? recordMeta?.version ?? 1;
  const seedCommit = notePart?.seedCommit ?? seedRow?.commit ?? recordMeta?.commit;
  const date = notePart?.date ?? recordMeta?.date ?? parseFrontmatterDateEpoch(rawContent);
  const title =
    notePart?.title?.trim() ||
    recordMeta?.title?.trim() ||
    seedRow?.blockIndex?.[0]?.noteTitle?.trim() ||
    extractTitleFromMarkdown(rawContent, sourcePath);

  const rawBlocks =
    notePart?.blocks && Object.keys(notePart.blocks).length > 0
      ? notePart.blocks
      : seedRow?.blocks && Object.keys(seedRow.blocks).length > 0
        ? seedRow.blocks
        : undefined;

  let ordinal = 0;
  const blocks: Record<string, NoteBlock> = rawBlocks
    ? Object.fromEntries(
        Object.entries(rawBlocks).map(([k, b]) => [
          k,
          { ...b, version: b.version || 1, sourceRevision: 1 },
        ]),
      )
    : reconcileNoteBlocks(rawContent, {
        sourceRevision: 1,
        registeredWidgets: KNOWN_SECTION_WIDGETS,
        createId: () => `blk-${canonicalNoteId.slice(0, 8)}-${ordinal++}`,
      });

  return {
    canonicalNoteId,
    title,
    rawContent,
    blocks,
    ...(date !== undefined ? { date } : {}),
    createdAt: notePart?.createdAt ?? date ?? now,
    ...(notePart?.tags?.length ? { tags: notePart.tags.filter((t) => t !== 'preview:remote') } : {}),
    type: notePart?.type ?? 'note',
    ...(sourceId ? { sourceId } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    seedOrigin: notePart?.seedOrigin ?? 'seed',
    feedOrigin: notePart?.feedOrigin ?? 'feed',
    ...(feedSourceId ? { feedSourceId } : {}),
    seedVersion,
    ...(seedChunkId ? { seedChunkId } : {}),
    ...(seedCommit ? { seedCommit } : {}),
    ...(sourceNotebookId ? { sourceNotebookId } : {}),
    upstreamStatus: notePart?.upstreamStatus ?? 'live',
    ...(seedRow ? { seedRow } : {}),
  };
}

async function ensureNoteBlockRevisionsAndIndexInTx(
  tx: IStorageTransaction,
  note: Note,
  now: number,
  seedRow?: RemoteSeedRowLike,
): Promise<void> {
  const revStore = tx.readwrite('block_revisions');
  const idxStore = tx.readwrite('block_index');
  const blockList = Object.values(note.blocks ?? {}).sort((a, b) => a.from - b.from);
  const isStatic = note.seedOrigin === 'seed' || note.feedOrigin === 'feed' || undefined;
  const resolvedNb = notebookOfItem(note);

  const missingRevs: BlockRevision[] = [];
  const missingIdx: BlockIndexRow[] = [];

  const existingIdxRows = await idxStore.getAllFromIndex('by-note', note.id);
  const existingIdxIds = new Set(existingIdxRows.map((r) => r.id));

  for (const [pos, b] of blockList.entries()) {
    const slice = note.rawContent.slice(b.from, b.to);
    const existingRev = await revStore.get([note.id, b.id, b.version]);
    if (!existingRev) {
      missingRevs.push({
        noteId: note.id,
        blockId: b.id,
        version: b.version,
        kind: b.kind,
        rawContent: slice,
        savedAt: now,
        ...(b.dialect ? { dialect: b.dialect } : {}),
        ...(b.sport ? { sport: b.sport } : {}),
      });
    }
    const rowId = `${note.id}:${b.id}`;
    if (!existingIdxIds.has(rowId)) {
      const cid = b.kind === 'wod' ? computeWodContentId(slice) : undefined;
      missingIdx.push({
        id: rowId,
        noteId: note.id,
        blockId: b.id,
        blockVersion: b.version,
        sourceRevision: note.sourceRevision,
        from: b.from,
        to: b.to,
        position: pos,
        dataType: b.kind,
        ...(cid ? { blockContentId: cid } : {}),
        rawContent: slice,
        noteTitle: note.title,
        createdAt: note.date ?? note.createdAt ?? now,
        ...(isStatic ? { isStatic: true } : {}),
        ...(note.sourceId ? { sourceId: note.sourceId } : {}),
        ...(note.sourcePath ? { sourcePath: note.sourcePath } : {}),
        ...(resolvedNb ? { notebookId: resolvedNb } : {}),
      });
    }
  }

  if (missingRevs.length > 0) await revStore.putMany(missingRevs);
  if (missingIdx.length > 0) await idxStore.putMany(missingIdx);

  if (seedRow?.blockEfforts?.length) {
    try {
      const effortStore = tx.readwrite('block_efforts');
      const rows = seedRow.blockEfforts.map((eff) => ({
        ...eff,
        id: `${note.id}:${eff.blockId}:${eff.effortSlug}`,
        noteId: note.id,
        ...(isStatic ? { isStatic: true } : {}),
      }));
      if (rows.length > 0) await effortStore.putMany(rows);
    } catch {
      // Optional store on lightweight test mocks
    }
  }

  if (seedRow?.blockEquipment?.length) {
    try {
      const eqStore = tx.readwrite('block_equipment');
      const rows = seedRow.blockEquipment.map((eq) => ({
        ...eq,
        id: `${note.id}:${eq.blockId}:${eq.equipmentSlug}`,
        noteId: note.id,
        ...(isStatic ? { isStatic: true } : {}),
      }));
      if (rows.length > 0) await eqStore.putMany(rows);
    } catch {
      // Optional store on lightweight test mocks
    }
  }
}

async function getOrCreateJournalPageInTx(
  tx: IStorageTransaction,
  journalDate: string,
  now: number,
): Promise<Page> {
  let existingPages: Page[];
  try {
    existingPages = await tx.readonly('page').getAllFromIndex('by-date', journalDate);
  } catch {
    existingPages = (await tx.readonly('page').getAll()).filter((p) => p.date === journalDate);
  }
  if (existingPages[0]) return existingPages[0];
  const page: Page = {
    id: mintUuid(),
    date: journalDate,
    title: journalDate,
    createdAt: now,
  };
  await tx.readwrite('page').put(page);
  return page;
}

function promoteExternalNoteInPlace(
  existing: Note,
  ownership: ResolvedNoteOwnership,
  now: number,
): { updated: Note; changed: boolean } {
  const nextRetention = 'session-pinned' as const;
  const nextUpstreamStatus = existing.upstreamStatus ?? 'live';
  const nextProvenance =
    existing.provenance ??
    buildNoteProvenance(existing, ownership.sourceNotebookId ?? notebookOfItem(existing), now);

  const changed =
    existing.retention !== nextRetention ||
    existing.upstreamStatus !== nextUpstreamStatus ||
    !existing.provenance;

  if (!changed) return { updated: existing, changed: false };

  return {
    updated: {
      ...existing,
      retention: nextRetention,
      upstreamStatus: nextUpstreamStatus,
      provenance: nextProvenance,
    },
    changed: true,
  };
}

/**
 * Ensure ONE immutable local archival copy exists for an external (`feed`,
 * `system`, or `remote:<feedId>:<uuid>`) workout in `notes` with
 * `retention: 'session-pinned'`.
 *
 * - If already present locally (subscribed feed, system note, or cached remote
 *   workout), promotes it in place without creating a duplicate Note.
 * - If only remote, resolves via `remotePayload` / `resolveRemoteWorkout` and
 *   materializes the single canonical archival copy under its canonical UUID.
 * - If the Note is already user-owned (`kind === 'user'`), returns it unchanged.
 */
export async function ensurePinnedExternalWorkout(
  storage: IStorage,
  input: EnsurePinnedExternalWorkoutInput,
): Promise<PinnedExternalWorkoutResult> {
  const now = input.now ?? Date.now();
  const parsedRemote = parseRemoteNoteId(input.noteId);
  const initialCandidateId = parsedRemote.isRemote ? parsedRemote.uuid : input.noteId;

  let preloaded =
    (await storage.readonly('notes').get(initialCandidateId)) ??
    (input.noteId !== initialCandidateId
      ? await storage.readonly('notes').get(input.noteId)
      : undefined);

  let materialized: NormalizedMaterialization | undefined;
  if (!preloaded) {
    const resolved =
      input.remotePayload ??
      (input.resolveRemoteWorkout ? await input.resolveRemoteWorkout(input.noteId) : undefined);
    if (!resolved) {
      throw new Error(`Note not found: ${input.noteId}`);
    }
    materialized = normalizeRemoteResolution(input.noteId, resolved, now);
    preloaded = await storage.readonly('notes').get(materialized.canonicalNoteId);
  }

  return storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment'],
    'readwrite',
    async (tx) => {
      const targetId = materialized?.canonicalNoteId ?? preloaded?.id ?? initialCandidateId;
      const existing = await tx.readonly('notes').get(targetId);

      if (existing) {
        const ownership = resolveNoteOwnership(
          existing,
          notebookOriginOfItem(existing),
          notebookOfItem(existing),
        );
        if (ownership.kind === 'user') {
          await ensureNoteBlockRevisionsAndIndexInTx(tx, existing, now);
          return {
            note: existing,
            created: false,
            promotedFromLocal: false,
            ownership,
          };
        }

        const { updated, changed } = promoteExternalNoteInPlace(existing, ownership, now);
        if (changed) {
          await tx.readwrite('notes').put(updated);
        }
        await ensureNoteBlockRevisionsAndIndexInTx(tx, updated, now);
        const nextOwnership = resolveNoteOwnership(
          updated,
          notebookOriginOfItem(updated),
          notebookOfItem(updated),
        );
        return {
          note: updated,
          created: false,
          promotedFromLocal: changed,
          ownership: nextOwnership,
        };
      }

      if (!materialized) {
        throw new Error(`Note not found: ${input.noteId}`);
      }

      const newNote: Note = {
        id: materialized.canonicalNoteId,
        title: materialized.title,
        rawContent: materialized.rawContent,
        sourceRevision: 1,
        blocks: materialized.blocks,
        ...(materialized.date !== undefined ? { date: materialized.date } : {}),
        createdAt: materialized.createdAt,
        type: materialized.type,
        ...(materialized.sourceId ? { sourceId: materialized.sourceId } : {}),
        ...(materialized.tags?.length ? { tags: materialized.tags } : {}),
        seedOrigin: materialized.seedOrigin,
        seedVersion: materialized.seedVersion,
        ...(materialized.seedChunkId ? { seedChunkId: materialized.seedChunkId } : {}),
        ...(materialized.feedOrigin ? { feedOrigin: materialized.feedOrigin } : {}),
        ...(materialized.feedSourceId ? { feedSourceId: materialized.feedSourceId } : {}),
        ...(materialized.sourcePath ? { sourcePath: materialized.sourcePath } : {}),
        ...(materialized.seedCommit ? { seedCommit: materialized.seedCommit } : {}),
        retention: 'session-pinned',
        upstreamStatus: materialized.upstreamStatus,
        provenance: {
          sourceNoteId: materialized.canonicalNoteId,
          sourceVersion: materialized.seedVersion,
          ...(materialized.seedCommit ? { sourceCommit: materialized.seedCommit } : {}),
          ...(materialized.feedSourceId ? { feedSourceId: materialized.feedSourceId } : {}),
          ...(materialized.sourceNotebookId ? { sourceNotebookId: materialized.sourceNotebookId } : {}),
          ...(materialized.sourcePath ? { sourcePath: materialized.sourcePath } : {}),
          clonedAt: now,
        },
      };

      await tx.readwrite('notes').put(newNote);
      await ensureNoteBlockRevisionsAndIndexInTx(tx, newNote, now, materialized.seedRow);
      const ownership = resolveNoteOwnership(
        newNote,
        notebookOriginOfItem(newNote),
        notebookOfItem(newNote),
      );
      return {
        note: newNote,
        created: true,
        promotedFromLocal: false,
        ownership,
      };
    },
  );
}

/**
 * Prepare a Session run against either a user-owned Note or an external
 * (`feed` / `system` / `remote:*`) Note.
 *
 * - For external workouts: pins ONE immutable archival local copy under its
 *   canonical workout ID (`retention: 'session-pinned'`), prepares a `Session`
 *   referencing that canonical ID + today's Journal calendar `Page` (`pageId`) +
 *   `notebookIds: ['notebook/journal']`, and does NOT persist a 0s phantom
 *   `Session` row (WW-052).
 * - For user-owned workouts: anchors in `notebook/journal` (and
 *   `notebook/playground` when applicable) and prepares the in-memory `Session`.
 */
export async function prepareJournalSessionRun(
  storage: IStorage,
  input: PrepareJournalSessionRunInput,
): Promise<PreparedJournalSessionRun> {
  const startedAt = input.startedAt ?? Date.now();
  const sessionId = input.sessionId ?? mintUuid();
  const journalDate = input.journalDate ?? utcCivilDateKey(startedAt);

  // Materialize / promote external or remote workouts first if needed.
  const pinned = await ensurePinnedExternalWorkout(storage, {
    noteId: input.noteId,
    remotePayload: input.remotePayload,
    resolveRemoteWorkout: input.resolveRemoteWorkout,
    now: startedAt,
  });

  return storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'sessions', 'page', 'notebook_links'],
    'readwrite',
    async (tx) => {
      const sourceNote = await tx.readonly('notes').get(pinned.note.id);
      if (!sourceNote) {
        throw new Error(`Note not found: ${input.noteId}`);
      }

      const existingSession = await tx.readonly('sessions').get(sessionId);
      if (existingSession) {
        throw new Error(`Session already exists: ${sessionId}`);
      }

      const sourceBlocks = Object.values(sourceNote.blocks);
      const selectedSourceBlock = input.blockId
        ? sourceNote.blocks[input.blockId] ?? sourceBlocks.find((b) => b.id === input.blockId)
        : sourceBlocks.find((b) => b.kind === 'wod');

      if (!selectedSourceBlock || selectedSourceBlock.kind !== 'wod') {
        throw new Error(`Selected workout block is unavailable on Note '${input.noteId}'.`);
      }

      const targetPage = await getOrCreateJournalPageInTx(tx, journalDate, startedAt);
      const nbOrigin = notebookOriginOfItem(sourceNote);
      const resolvedNb = notebookOfItem(sourceNote);
      const ownership = resolveNoteOwnership(sourceNote, nbOrigin, resolvedNb);

      let revision = await tx
        .readonly('block_revisions')
        .get([sourceNote.id, selectedSourceBlock.id, selectedSourceBlock.version]);
      if (!revision) {
        revision = {
          noteId: sourceNote.id,
          blockId: selectedSourceBlock.id,
          version: selectedSourceBlock.version,
          kind: selectedSourceBlock.kind,
          rawContent: sourceNote.rawContent.slice(selectedSourceBlock.from, selectedSourceBlock.to),
          savedAt: startedAt,
          ...(selectedSourceBlock.dialect ? { dialect: selectedSourceBlock.dialect } : {}),
          ...(selectedSourceBlock.sport ? { sport: selectedSourceBlock.sport } : {}),
        };
        await tx.readwrite('block_revisions').put(revision);
      }

      const cid = computeWodContentId(revision.rawContent);

      if (ownership.kind !== 'user') {
        const session: Session = {
          id: sessionId,
          noteId: sourceNote.id,
          blockId: selectedSourceBlock.id,
          blockVersion: revision.version,
          ...(cid ? { blockContentId: cid } : {}),
          origin: input.origin ?? 'journal',
          pageId: targetPage.id,
          status: 'in-progress',
          startTime: startedAt,
          endTime: startedAt,
          duration: 0,
          completed: false,
          createdAt: startedAt,
          notebookIds: ['notebook/journal'],
        };

        return {
          note: sourceNote,
          revision,
          session,
          clonedFromReadOnly: false,
          pinnedExternalWorkout: true,
          upstreamNoteId: sourceNote.id,
        };
      }

      // Editable user Note: record Session in place while anchoring in `notebook/journal`
      const isPlayground =
        sourceNote.type === 'playground' ||
        sourceNote.sourceId === 'playground' ||
        sourceNote.notebookId === 'notebook/playground';

      const baseNotebooks = isPlayground
        ? ['notebook/journal', 'notebook/playground']
        : ['notebook/journal'];
      const mergedNotebooks = [
        ...new Set([
          ...baseNotebooks,
          ...(sourceNote.notebookIds ?? []),
          ...(sourceNote.notebookId ? [sourceNote.notebookId] : []),
        ]),
      ];

      const updatedNote: Note =
        JSON.stringify(sourceNote.notebookIds) === JSON.stringify(mergedNotebooks)
          ? sourceNote
          : { ...sourceNote, notebookIds: mergedNotebooks };

      if (updatedNote !== sourceNote) {
        await tx.readwrite('notes').put(updatedNote);
      }

      const effectiveOrigin: ResultOrigin =
        input.origin ?? (isPlayground ? 'playground' : 'journal');

      const session: Session = {
        id: sessionId,
        noteId: sourceNote.id,
        blockId: selectedSourceBlock.id,
        blockVersion: revision.version,
        ...(cid ? { blockContentId: cid } : {}),
        origin: effectiveOrigin,
        pageId: targetPage.id,
        status: 'in-progress',
        startTime: startedAt,
        endTime: startedAt,
        duration: 0,
        completed: false,
        createdAt: startedAt,
        notebookIds: [...baseNotebooks],
      };

      const links: NotebookLink[] = mergedNotebooks.map((nbId) => ({
        id: makeNotebookLinkId(nbId as NotebookId, 'note', sourceNote.id),
        notebookId: nbId,
        targetKind: 'note',
        targetId: sourceNote.id,
        noteId: sourceNote.id,
        createdAt: startedAt,
      }));

      await tx.readwrite('notebook_links').putMany(links);

      return {
        note: updatedNote,
        revision,
        session,
        clonedFromReadOnly: false,
        pinnedExternalWorkout: false,
      };
    },
  );
}

/**
 * Atomically ensure the single canonical external archival copy (`retention: 'session-pinned'`),
 * commit a completed `Session` directly against `canonicalNote.id` + `pageId`,
 * link `notebook/journal` (`targetKind: 'session'`), and persist optional `EventRecord`s.
 */
export async function logSessionAgainstExternalWorkout(
  storage: IStorage,
  input: LogSessionAgainstExternalWorkoutInput,
): Promise<LoggedExternalWorkoutSession> {
  const startedAt = input.startedAt ?? Date.now();
  const duration = Math.max(0, input.durationMs ?? (input.endedAt !== undefined ? input.endedAt - startedAt : 0));
  const endTime = input.endedAt ?? startedAt + duration;
  const sessionId = input.sessionId ?? mintUuid();
  const journalDate = input.journalDate ?? utcCivilDateKey(startedAt);

  const pinnedResult = await ensurePinnedExternalWorkout(storage, {
    noteId: input.noteId,
    remotePayload: input.remotePayload,
    resolveRemoteWorkout: input.resolveRemoteWorkout,
    now: startedAt,
  });

  return storage.transaction(
    ['notes', 'block_revisions', 'sessions', 'events', 'page', 'notebook_links'],
    'readwrite',
    async (tx) => {
      const note = await tx.readonly('notes').get(pinnedResult.note.id);
      if (!note) {
        throw new Error(`Pinned workout note disappeared: ${pinnedResult.note.id}`);
      }

      const existingSession = await tx.readonly('sessions').get(sessionId);
      if (existingSession) {
        throw new Error(`Session already exists: ${sessionId}`);
      }

      const blocks = Object.values(note.blocks);
      const selectedBlock = input.blockId
        ? note.blocks[input.blockId] ?? blocks.find((b) => b.id === input.blockId)
        : blocks.find((b) => b.kind === 'wod');
      if (!selectedBlock || selectedBlock.kind !== 'wod') {
        throw new Error(`Selected workout block is unavailable on Note '${note.id}'.`);
      }

      let revision = await tx
        .readonly('block_revisions')
        .get([note.id, selectedBlock.id, selectedBlock.version]);
      if (!revision) {
        revision = {
          noteId: note.id,
          blockId: selectedBlock.id,
          version: selectedBlock.version,
          kind: selectedBlock.kind,
          rawContent: note.rawContent.slice(selectedBlock.from, selectedBlock.to),
          savedAt: startedAt,
          ...(selectedBlock.dialect ? { dialect: selectedBlock.dialect } : {}),
          ...(selectedBlock.sport ? { sport: selectedBlock.sport } : {}),
        };
        await tx.readwrite('block_revisions').put(revision);
      }

      const page = await getOrCreateJournalPageInTx(tx, journalDate, startedAt);
      const cid = computeWodContentId(revision.rawContent);

      const session: Session = {
        id: sessionId,
        noteId: note.id,
        blockId: selectedBlock.id,
        blockVersion: revision.version,
        ...(cid ? { blockContentId: cid } : {}),
        origin: input.origin ?? 'journal',
        pageId: page.id,
        status: 'completed',
        startTime: startedAt,
        endTime,
        duration,
        ...(input.roundsCompleted !== undefined ? { roundsCompleted: input.roundsCompleted } : {}),
        ...(input.totalRounds !== undefined ? { totalRounds: input.totalRounds } : {}),
        ...(input.repsCompleted !== undefined ? { repsCompleted: input.repsCompleted } : {}),
        completed: input.completed ?? true,
        createdAt: endTime,
        ...(input.public !== undefined ? { public: input.public } : {}),
        notebookIds: ['notebook/journal'],
      };

      const links: NotebookLink[] = [
        {
          id: makeNotebookLinkId('notebook/journal', 'session', session.id),
          notebookId: 'notebook/journal',
          targetKind: 'session',
          targetId: session.id,
          noteId: note.id,
          createdAt: endTime,
        },
      ];

      const normalizedEvents: EventRecord[] = (input.events ?? []).map((ev) => ({
        ...ev,
        resultId: session.id,
        noteId: note.id,
        blockId: selectedBlock.id,
        blockVersion: revision.version,
        ...(cid ? { blockContentId: cid } : {}),
        pageId: page.id,
      }));

      await tx.readwrite('sessions').put(session);
      await tx.readwrite('notebook_links').putMany(links);
      if (normalizedEvents.length > 0) {
        await tx.readwrite('events').putMany(normalizedEvents);
      }

      return {
        note,
        revision,
        session,
        page,
        links,
        events: normalizedEvents,
        pinnedResult,
      };
    },
  );
}

/**
 * Explicit "Fork to My Notes": creates a new editable `seedOrigin: 'user'` copy
 * of any Note (local or resolved remote) in a writable user Notebook with full
 * `NoteProvenance`, `notebook_links`, and `block_revisions`.
 *
 * Rejects system read-only notebooks (`isSystemReadOnlyNotebook(targetNotebookId)`)
 * and feed-delivered target notebooks.
 */
export async function forkNoteToUserNotebook(
  storage: IStorage,
  sourceNoteId: string,
  targetNotebookId: string,
  options: ForkNoteOptions = {},
): Promise<Note> {
  const targetNb = toNotebookId(targetNotebookId);
  if (isSystemReadOnlyNotebook(targetNb)) {
    throw new Error(`Target notebook '${targetNb}' is read-only and cannot receive forked notes.`);
  }

  const now = options.now ?? Date.now();
  const parsedRemote = parseRemoteNoteId(sourceNoteId);
  const candidateId = parsedRemote.isRemote ? parsedRemote.uuid : sourceNoteId;

  let sourceNote =
    (await storage.readonly('notes').get(candidateId)) ??
    (sourceNoteId !== candidateId ? await storage.readonly('notes').get(sourceNoteId) : undefined);

  let fallbackMat: NormalizedMaterialization | undefined;
  if (!sourceNote) {
    const resolved =
      options.remotePayload ??
      (options.resolveRemoteWorkout ? await options.resolveRemoteWorkout(sourceNoteId) : undefined);
    if (!resolved) {
      throw new Error(`Source Note not found: ${sourceNoteId}`);
    }
    fallbackMat = normalizeRemoteResolution(sourceNoteId, resolved, now);
    sourceNote = await storage.readonly('notes').get(fallbackMat.canonicalNoteId);
  }

  const sourceIdForProvenance = sourceNote?.id ?? fallbackMat!.canonicalNoteId;
  const sourceTitle = options.title?.trim() || sourceNote?.title || fallbackMat!.title;
  const rawContent = sourceNote?.rawContent ?? fallbackMat!.rawContent;
  const sourceTags = sourceNote?.tags ?? fallbackMat?.tags;
  const sourceNb = sourceNote
    ? notebookOfItem(sourceNote)
    : fallbackMat?.sourceNotebookId;

  const provenance = sourceNote
    ? buildNoteProvenance(sourceNote, sourceNb, now)
    : {
        sourceNoteId: sourceIdForProvenance,
        sourceVersion: fallbackMat!.seedVersion,
        ...(fallbackMat!.seedCommit ? { sourceCommit: fallbackMat!.seedCommit } : {}),
        ...(fallbackMat!.feedSourceId ? { feedSourceId: fallbackMat!.feedSourceId } : {}),
        ...(sourceNb ? { sourceNotebookId: sourceNb } : {}),
        ...(fallbackMat!.sourcePath ? { sourcePath: fallbackMat!.sourcePath } : {}),
        clonedAt: now,
      };

  const forkedId = mintUuid();
  let ordinal = 0;
  const blocks = reconcileNoteBlocks(rawContent, {
    sourceRevision: 1,
    registeredWidgets: KNOWN_SECTION_WIDGETS,
    createId: () => `blk-${forkedId.slice(0, 8)}-${ordinal++}`,
  });

  const notebookIds: NotebookId[] = ['notebook/journal'];
  if (targetNb === 'notebook/playground' && !notebookIds.includes('notebook/playground')) {
    notebookIds.push('notebook/playground');
  }
  if (!notebookIds.includes(targetNb)) {
    notebookIds.push(targetNb);
  }

  const dateMs = options.journalDate
    ? Date.parse(`${options.journalDate}T12:00:00Z`)
    : sourceNote?.date ?? fallbackMat?.date;

  const forkedNote: Note = {
    id: forkedId,
    title: sourceTitle,
    rawContent,
    sourceRevision: 1,
    blocks,
    ...(dateMs !== undefined && Number.isFinite(dateMs) ? { date: dateMs } : {}),
    createdAt: now,
    type:
      targetNb === 'notebook/playground'
        ? 'playground'
        : targetNb === 'notebook/journal'
          ? 'journal'
          : 'note',
    sourceId: sourceIdForProvenance,
    ...(targetNb !== 'notebook/journal' && targetNb !== 'notebook/playground'
      ? { notebookId: targetNb }
      : {}),
    notebookIds,
    provenance,
    ...(sourceTags?.length ? { tags: sourceTags.filter((t) => t !== 'preview:remote') } : {}),
    seedOrigin: 'user',
  };

  return storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'notebook_links', 'page', 'page_notes'],
    'readwrite',
    async (tx) => {
      if (targetNb !== 'notebook/journal' && targetNb !== 'notebook/playground') {
        const landing = await tx.readonly('notes').get(targetNb);
        if (landing && (landing.feedOrigin === 'feed' || landing.seedOrigin === 'seed')) {
          throw new Error(`Target notebook '${targetNb}' is feed-delivered and read-only.`);
        }
        if (!landing && !isNonPublishableNotebook(targetNb)) {
          const slug = notebookSlugFromId(targetNb);
          const landingTitle =
            slug
              .split('-')
              .filter(Boolean)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ') || slug;
          await tx.readwrite('notes').put({
            id: targetNb,
            title: landingTitle,
            rawContent: `# ${landingTitle}\n`,
            sourceRevision: 1,
            blocks: {},
            createdAt: now,
            notebookId: targetNb,
            seedOrigin: 'user',
          });
        }
      }

      await tx.readwrite('notes').put(forkedNote);
      await ensureNoteBlockRevisionsAndIndexInTx(tx, forkedNote, now);

      const links: NotebookLink[] = notebookIds.map((nbId) => ({
        id: makeNotebookLinkId(nbId, 'note', forkedNote.id),
        notebookId: nbId,
        targetKind: 'note',
        targetId: forkedNote.id,
        noteId: forkedNote.id,
        createdAt: now,
      }));
      await tx.readwrite('notebook_links').putMany(links);

      if (options.journalDate) {
        const page = await getOrCreateJournalPageInTx(tx, options.journalDate, now);
        const pageNote: PageNote = {
          id: mintUuid(),
          pageId: page.id,
          noteId: forkedNote.id,
          createdAt: now,
        };
        await tx.readwrite('page_notes').put(pageNote);
      }

      return forkedNote;
    },
  );
}

/**
 * Resolve a Note's upstream provenance against current storage.
 *
 * - For user forks (`provenance.sourceNoteId !== note.id`): checks whether the
 *   upstream Note still exists and has not been unsubscribed/removed.
 * - For single local archival copies (`retention: 'session-pinned'` where
 *   `provenance.sourceNoteId === note.id`): reports `exists: true` while
 *   `upstreamStatus` is `'live'` (or unset) and `exists: false` once
 *   `upstreamStatus` is `'unsubscribed'` or `'removed'`.
 */
export async function resolveUpstreamProvenance(
  storage: IStorage,
  note: Pick<
    Note,
    | 'provenance'
    | 'sourceId'
    | 'upstreamStatus'
    | 'retention'
    | 'seedOrigin'
    | 'feedOrigin'
    | 'seedVersion'
    | 'sourceRevision'
    | 'seedCommit'
    | 'feedSourceId'
    | 'sourcePath'
  > & { id?: string },
): Promise<ResolvedUpstreamProvenance | null> {
  const isExternalPinned =
    Boolean(note.id) &&
    (note.retention === 'session-pinned' ||
      note.upstreamStatus !== undefined ||
      note.seedOrigin === 'seed' ||
      note.feedOrigin === 'feed');
  const sourceNoteId =
    note.provenance?.sourceNoteId ??
    (note.sourceId &&
    !note.sourceId.startsWith('/') &&
    !note.sourceId.includes(':') &&
    note.sourceId !== 'playground'
      ? note.sourceId
      : isExternalPinned
        ? note.id
        : undefined);

  if (!sourceNoteId) return null;

  // Single archival local copy pointing to itself as canonical upstream ID
  if (note.id && sourceNoteId === note.id) {
    const status = note.upstreamStatus ?? 'live';
    const isLive = status === 'live';
    return {
      exists: isLive,
      sourceNoteId,
      ...(isLive ? { currentUpstreamVersion: note.seedVersion ?? note.sourceRevision } : {}),
      sourceVersion: note.provenance?.sourceVersion ?? note.seedVersion ?? note.sourceRevision,
      sourceCommit: note.provenance?.sourceCommit ?? note.seedCommit,
      feedSourceId: note.provenance?.feedSourceId ?? note.feedSourceId,
      sourceNotebookId: note.provenance?.sourceNotebookId,
      sourcePath: note.provenance?.sourcePath ?? note.sourcePath,
      upstreamStatus: status,
    };
  }

  const upstream = await storage.readonly('notes').get(sourceNoteId);
  if (upstream) {
    const upstreamGone =
      upstream.upstreamStatus === 'unsubscribed' || upstream.upstreamStatus === 'removed';
    return {
      exists: !upstreamGone,
      sourceNoteId,
      title: upstream.title,
      sourceVersion: note.provenance?.sourceVersion,
      currentUpstreamVersion: upstream.seedVersion ?? upstream.sourceRevision,
      sourceCommit: note.provenance?.sourceCommit ?? upstream.seedCommit,
      feedSourceId: note.provenance?.feedSourceId ?? upstream.feedSourceId,
      sourceNotebookId: note.provenance?.sourceNotebookId ?? notebookOfItem(upstream),
      sourcePath: note.provenance?.sourcePath ?? upstream.sourcePath,
      upstreamStatus: upstream.upstreamStatus ?? 'live',
    };
  }

  return {
    exists: false,
    sourceNoteId,
    sourceVersion: note.provenance?.sourceVersion,
    sourceCommit: note.provenance?.sourceCommit,
    feedSourceId: note.provenance?.feedSourceId,
    sourceNotebookId: note.provenance?.sourceNotebookId,
    sourcePath: note.provenance?.sourcePath,
    ...(note.upstreamStatus ? { upstreamStatus: note.upstreamStatus } : {}),
  };
}

export function buildNoteProvenance(
  sourceNote: Pick<Note, 'id' | 'seedVersion' | 'sourceRevision' | 'seedCommit' | 'feedSourceId' | 'sourcePath'>,
  sourceNotebookId: string | undefined,
  clonedAt: number,
): NoteProvenance {
  return {
    sourceNoteId: sourceNote.id,
    sourceVersion: sourceNote.seedVersion ?? sourceNote.sourceRevision,
    ...(sourceNote.seedCommit ? { sourceCommit: sourceNote.seedCommit } : {}),
    ...(sourceNote.feedSourceId ? { feedSourceId: sourceNote.feedSourceId } : {}),
    ...(sourceNotebookId ? { sourceNotebookId } : {}),
    ...(sourceNote.sourcePath ? { sourcePath: sourceNote.sourcePath } : {}),
    clonedAt,
  };
}
