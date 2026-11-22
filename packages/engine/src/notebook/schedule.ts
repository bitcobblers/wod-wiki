/**
 * Schedule, NoteRevision & Session Overlay Service (ADR 0009, V35)
 *
 * Pure headless TypeScript (zero DOM/React imports) managing:
 *   1. Immutable `note_revisions` snapshots whenever a Note with existing
 *      recorded Sessions is edited (`snapshotNoteRevisionIfHasSessionsInTx`).
 *   2. Many-to-many `schedule_items` linking canonical Notes (user Notebooks,
 *      Feed Notebooks, or unfiled Quick-Logs) to local civil dates (`YYYY-MM-DD`).
 *   3. Post-run mutable Session attribution (`sessionDate`, `pageId`,
 *      `scheduleItemId`) + ±N-day smart match lookup, while preserving
 *      immutable `(noteId, blockId, blockVersion, noteSourceRevision)` pins.
 *   4. Paired-by-default Journal day overlay (`getJournalDayOverlay`) and
 *      idempotent V34 -> V35 backfill (`migrateDatedPageNotesToSchedule`).
 */

import {
  resolveNoteOwnership,
  toNotebookId,
  type Note,
  type NoteRevision,
  type Page,
  type ScheduleItem,
  type ScheduleStatus,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import type { IStorage, IStorageTransaction } from '@bitcobblers/wod-wiki-storage';
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import {
  ensurePinnedExternalWorkout,
  type RemoteWorkoutResolution,
} from './sessionIntake';

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

/**
 * Format an epoch timestamp as local civil `YYYY-MM-DD`.
 */
export function localCivilDateKey(ms = Date.now(), timeZone?: string): string {
  if (timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  }
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function normalizeCivilDate(input?: string, nowMs = Date.now(), timeZone?: string): string {
  if (!input || input.trim().toLowerCase() === 'today') {
    return localCivilDateKey(nowMs, timeZone);
  }
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`Invalid civil date '${input}'; expected YYYY-MM-DD or 'today'.`);
  }
  return trimmed;
}

function addDaysToCivilDate(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + deltaDays, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function diffDaysCivil(a: string, b: string): number {
  const pa = Date.parse(`${a}T12:00:00Z`);
  const pb = Date.parse(`${b}T12:00:00Z`);
  return Math.round((pa - pb) / 86_400_000);
}

async function getOrCreatePageForDateInTx(
  tx: IStorageTransaction,
  dateKey: string,
  now: number,
): Promise<Page> {
  let existing: Page[];
  try {
    existing = await tx.readonly('page').getAllFromIndex('by-date', dateKey);
  } catch {
    existing = (await tx.readonly('page').getAll()).filter((p) => p.date === dateKey);
  }
  if (existing[0]) return existing[0];
  const created: Page = {
    id: mintUuid(),
    date: dateKey,
    title: dateKey,
    createdAt: now,
  };
  await tx.readwrite('page').put(created);
  return created;
}

// ---------------------------------------------------------------------------
// NoteRevision Snapshots (Annotation 1)
// ---------------------------------------------------------------------------

export async function noteHasRecordedSessionsInTx(
  tx: IStorageTransaction,
  noteId: string,
): Promise<boolean> {
  try {
    const count = await tx.readonly('sessions').countFromIndex('by-note', noteId);
    if (count > 0) return true;
  } catch {
    const all = await tx.readonly('sessions').getAll();
    return all.some((s) => s.noteId === noteId);
  }
  return false;
}

/**
 * Persist an immutable NoteRevision snapshot (`[noteId, previous.sourceRevision]`)
 * before mutating a Note whenever one or more recorded Sessions exist for that
 * Note. Ensures historical Sessions remain mapped to an existing `(noteId, version)`.
 */
export async function snapshotNoteRevisionIfHasSessionsInTx(
  tx: IStorageTransaction,
  previous: Note | undefined,
  now = Date.now(),
): Promise<NoteRevision | undefined> {
  if (!previous) return undefined;
  const hasSessions = await noteHasRecordedSessionsInTx(tx, previous.id);
  if (!hasSessions) return undefined;

  const existingRev = await tx
    .readonly('note_revisions')
    .get([previous.id, previous.sourceRevision])
    .catch(() => undefined);
  if (existingRev) return existingRev;

  const snapshot: NoteRevision = {
    noteId: previous.id,
    version: previous.sourceRevision,
    title: previous.title,
    rawContent: previous.rawContent,
    ...(previous.tags ? { tags: [...previous.tags] } : {}),
    ...(previous.type ? { type: previous.type } : {}),
    ...(previous.notebookIds ? { notebookIds: [...previous.notebookIds] } : {}),
    blocks: structuredClone(previous.blocks),
    savedAt: now,
  };
  await tx.readwrite('note_revisions').put(snapshot);
  return snapshot;
}

export async function getNoteRevision(
  storage: IStorage,
  noteId: string,
  version: number,
): Promise<NoteRevision | undefined> {
  return storage.readonly('note_revisions').get([noteId, version]);
}

export async function listNoteRevisions(
  storage: IStorage,
  noteId: string,
): Promise<NoteRevision[]> {
  try {
    const rows = await storage.readonly('note_revisions').getAllFromIndex('by-note', noteId);
    return rows.sort((a, b) => b.version - a.version);
  } catch {
    const all = await storage.readonly('note_revisions').getAll();
    return all.filter((r) => r.noteId === noteId).sort((a, b) => b.version - a.version);
  }
}

// ---------------------------------------------------------------------------
// ScheduleItem CRUD (M:N Scheduling without cloning)
// ---------------------------------------------------------------------------

export interface ScheduleNoteOnDateInput {
  id?: string;
  noteId: string;
  date: string;
  blockId?: string;
  slot?: string;
  notes?: string;
  position?: number;
  status?: ScheduleStatus;
  sourceNotebookId?: string;
  now?: number;
  remotePayload?: RemoteWorkoutResolution;
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
}

/**
 * Link an existing Note (user Notebook, Feed Notebook, or unfiled Quick-Log)
 * onto a civil calendar date without cloning the Note.
 *
 * External/Feed workouts are automatically pinned locally with
 * `retention: 'schedule-pinned'` so offline execution and Feed unsubscribes
 * preserve scheduled training days cleanly.
 */
export async function scheduleNoteOnDate(
  storage: IStorage,
  input: ScheduleNoteOnDateInput,
): Promise<ScheduleItem> {
  const now = input.now ?? Date.now();
  const dateKey = normalizeCivilDate(input.date, now);

  const pinned = await ensurePinnedExternalWorkout(storage, {
    noteId: input.noteId,
    remotePayload: input.remotePayload,
    resolveRemoteWorkout: input.resolveRemoteWorkout,
    retention: 'schedule-pinned',
    now,
  });

  return storage.transaction(
    ['schedule_items', 'page', 'notes'],
    'readwrite',
    async (tx) => {
      const note = (await tx.readonly('notes').get(pinned.note.id)) ?? pinned.note;
      const page = await getOrCreatePageForDateInTx(tx, dateKey, now);

      let existingForDate: ScheduleItem[];
      try {
        existingForDate = await tx.readonly('schedule_items').getAllFromIndex('by-date', dateKey);
      } catch {
        existingForDate = (await tx.readonly('schedule_items').getAll()).filter((s) => s.date === dateKey);
      }
      const nextPos =
        input.position ??
        (existingForDate.reduce((max, item) => Math.max(max, item.position), -1) + 1);

      const resolvedNb =
        input.sourceNotebookId ??
        notebookOfItem(note) ??
        pinned.ownership.sourceNotebookId;

      const item: ScheduleItem = {
        id: input.id ?? mintUuid(),
        date: dateKey,
        noteId: note.id,
        pageId: page.id,
        ...(resolvedNb ? { sourceNotebookId: toNotebookId(resolvedNb) } : {}),
        ...(note.title ? { fallbackTitle: note.title } : {}),
        ...(input.blockId ? { blockId: input.blockId } : {}),
        position: nextPos,
        ...(input.slot?.trim() ? { slot: input.slot.trim() } : {}),
        status: input.status ?? 'planned',
        ...(input.notes !== undefined && input.notes.trim() ? { notes: input.notes.trim() } : {}),
        createdAt: now,
        updatedAt: now,
      };

      await tx.readwrite('schedule_items').put(item);
      return item;
    },
  );
}

export async function batchScheduleNotes(
  storage: IStorage,
  entries: readonly ScheduleNoteOnDateInput[],
): Promise<ScheduleItem[]> {
  const created: ScheduleItem[] = [];
  for (const entry of entries) {
    created.push(await scheduleNoteOnDate(storage, entry));
  }
  return created;
}

export interface UpdateScheduleItemPatch {
  date?: string;
  slot?: string | null;
  position?: number;
  status?: ScheduleStatus;
  notes?: string | null;
  blockId?: string | null;
  now?: number;
}

export async function updateScheduleItem(
  storage: IStorage,
  id: string,
  patch: UpdateScheduleItemPatch,
): Promise<ScheduleItem> {
  const now = patch.now ?? Date.now();
  return storage.transaction(['schedule_items', 'page'], 'readwrite', async (tx) => {
    const existing = await tx.readonly('schedule_items').get(id);
    if (!existing) throw new Error(`ScheduleItem not found: ${id}`);

    const nextDate = patch.date !== undefined ? normalizeCivilDate(patch.date, now) : existing.date;
    let nextPageId = existing.pageId;
    let movedFromDate = existing.movedFromDate;
    let nextStatus = patch.status ?? existing.status;

    if (nextDate !== existing.date) {
      const page = await getOrCreatePageForDateInTx(tx, nextDate, now);
      nextPageId = page.id;
      if (patch.status === undefined && existing.status === 'planned') {
        movedFromDate = existing.date;
      } else if (patch.status === 'moved') {
        movedFromDate = existing.date;
      }
    }

    const updated: ScheduleItem = {
      ...existing,
      date: nextDate,
      ...(nextPageId ? { pageId: nextPageId } : {}),
      position: patch.position ?? existing.position,
      status: nextStatus,
      ...(movedFromDate ? { movedFromDate } : {}),
      updatedAt: now,
    };

    if (patch.slot === null) delete updated.slot;
    else if (patch.slot !== undefined) updated.slot = patch.slot.trim() || undefined;

    if (patch.notes === null) delete updated.notes;
    else if (patch.notes !== undefined) updated.notes = patch.notes.trim() || undefined;

    if (patch.blockId === null) delete updated.blockId;
    else if (patch.blockId !== undefined) updated.blockId = patch.blockId.trim() || undefined;

    await tx.readwrite('schedule_items').put(updated);
    return updated;
  });
}

export async function removeScheduleItem(storage: IStorage, id: string): Promise<boolean> {
  return storage.transaction(['schedule_items'], 'readwrite', async (tx) => {
    const existing = await tx.readonly('schedule_items').get(id);
    if (!existing) return false;
    await tx.readwrite('schedule_items').delete(id);
    return true;
  });
}

export async function listScheduleItemsByDateRange(
  storage: IStorage,
  fromDate: string,
  toDate: string,
): Promise<ScheduleItem[]> {
  const fromKey = normalizeCivilDate(fromDate);
  const toKey = normalizeCivilDate(toDate);
  let rows: ScheduleItem[];
  try {
    rows = await storage.readonly('schedule_items').getAll();
  } catch {
    rows = [];
  }
  return rows
    .filter((item) => item.date >= fromKey && item.date <= toKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position || a.createdAt - b.createdAt);
}

export async function listScheduleItemsForNote(
  storage: IStorage,
  noteId: string,
): Promise<ScheduleItem[]> {
  let rows: ScheduleItem[];
  try {
    rows = await storage.readonly('schedule_items').getAllFromIndex('by-note', noteId);
  } catch {
    rows = (await storage.readonly('schedule_items').getAll()).filter((item) => item.noteId === noteId);
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
}

export interface NoteUsageCounts {
  scheduleCount: number;
  sessionCount: number;
  scheduledDates: string[];
}

export async function getScheduleAndSessionCountsByNote(
  storage: IStorage,
): Promise<Map<string, NoteUsageCounts>> {
  const [schedules, sessions] = await Promise.all([
    storage.readonly('schedule_items').getAll().catch(() => [] as ScheduleItem[]),
    storage.readonly('sessions').getAll().catch(() => [] as Session[]),
  ]);
  const counts = new Map<string, NoteUsageCounts>();
  const ensure = (noteId: string): NoteUsageCounts => {
    let entry = counts.get(noteId);
    if (!entry) {
      entry = { scheduleCount: 0, sessionCount: 0, scheduledDates: [] };
      counts.set(noteId, entry);
    }
    return entry;
  };
  for (const s of schedules) {
    if (s.status === 'skipped') continue;
    const entry = ensure(s.noteId);
    entry.scheduleCount += 1;
    if (!entry.scheduledDates.includes(s.date)) entry.scheduledDates.push(s.date);
  }
  for (const sess of sessions) {
    const entry = ensure(sess.noteId);
    entry.sessionCount += 1;
  }
  for (const entry of counts.values()) {
    entry.scheduledDates.sort();
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Mutable Session Attribution & Smart Schedule Match
// ---------------------------------------------------------------------------

export interface AttributeSessionInput {
  sessionId: string;
  /** New civil training date (`YYYY-MM-DD`), or omitted to keep existing. */
  sessionDate?: string;
  /** Optional explicit ScheduleItem ID, or `null` to unlink from any planned slot. */
  scheduleItemId?: string | null;
  now?: number;
}

/**
 * Re-attribute a recorded Session's `sessionDate`, `pageId`, and/or `scheduleItemId`
 * without altering its immutable `(noteId, blockId, blockVersion, noteSourceRevision)` pin.
 */
export async function attributeSession(
  storage: IStorage,
  input: AttributeSessionInput,
): Promise<Session> {
  const now = input.now ?? Date.now();
  return storage.transaction(['sessions', 'schedule_items', 'page'], 'readwrite', async (tx) => {
    const session = await tx.readonly('sessions').get(input.sessionId);
    if (!session) throw new Error(`Session not found: ${input.sessionId}`);

    let nextSessionDate = session.sessionDate;
    let nextPageId = session.pageId;
    let nextScheduleItemId = session.scheduleItemId;

    if (input.scheduleItemId === null) {
      if (session.scheduleItemId) {
        const prevItem = await tx.readonly('schedule_items').get(session.scheduleItemId);
        if (prevItem && prevItem.status === 'completed') {
          await tx.readwrite('schedule_items').put({
            ...prevItem,
            status: 'planned',
            updatedAt: now,
          });
        }
      }
      nextScheduleItemId = undefined;
    } else if (input.scheduleItemId !== undefined) {
      const targetItem = await tx.readonly('schedule_items').get(input.scheduleItemId);
      if (!targetItem) throw new Error(`ScheduleItem not found: ${input.scheduleItemId}`);
      if (session.scheduleItemId && session.scheduleItemId !== targetItem.id) {
        const prevItem = await tx.readonly('schedule_items').get(session.scheduleItemId);
        if (prevItem && prevItem.status === 'completed') {
          await tx.readwrite('schedule_items').put({
            ...prevItem,
            status: 'planned',
            updatedAt: now,
          });
        }
      }
      nextScheduleItemId = targetItem.id;
      if (input.sessionDate === undefined) {
        nextSessionDate = targetItem.date;
      }
      if (targetItem.status !== 'completed') {
        await tx.readwrite('schedule_items').put({
          ...targetItem,
          status: 'completed',
          updatedAt: now,
        });
      }
    }

    if (input.sessionDate !== undefined) {
      nextSessionDate = normalizeCivilDate(input.sessionDate, now);
    }

    if (nextSessionDate) {
      const page = await getOrCreatePageForDateInTx(tx, nextSessionDate, now);
      nextPageId = page.id;
    }

    const updated: Session = {
      ...session,
      ...(nextPageId !== undefined ? { pageId: nextPageId } : {}),
      ...(nextSessionDate !== undefined ? { sessionDate: nextSessionDate } : {}),
    };
    if (nextScheduleItemId !== undefined) updated.scheduleItemId = nextScheduleItemId;
    else delete updated.scheduleItemId;

    await tx.readwrite('sessions').put(updated);
    return updated;
  });
}

export async function findNearbyMatchingScheduleItems(
  storage: IStorage,
  session: Pick<Session, 'id' | 'noteId' | 'sessionDate' | 'startTime' | 'scheduleItemId'>,
  windowDays = 2,
): Promise<ScheduleItem[]> {
  if (session.scheduleItemId) return [];
  const baseDate = session.sessionDate ?? localCivilDateKey(session.startTime);
  const fromDate = addDaysToCivilDate(baseDate, -windowDays);
  const toDate = addDaysToCivilDate(baseDate, windowDays);

  const candidates = await listScheduleItemsForNote(storage, session.noteId);
  return candidates
    .filter((item) => item.status === 'planned' && item.date >= fromDate && item.date <= toDate)
    .sort((a, b) => Math.abs(diffDaysCivil(a.date, baseDate)) - Math.abs(diffDaysCivil(b.date, baseDate)) || a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Journal Day Overlay & V34 -> V35 Migration
// ---------------------------------------------------------------------------

export interface JournalOverlayPlannedEntry {
  item: ScheduleItem;
  note?: Note;
  pairedSessions: Session[];
}

export interface JournalOverlayAdhocSession {
  session: Session;
  note?: Note;
}

export interface JournalDayOverlay {
  date: string;
  pageId: string | null;
  planned: JournalOverlayPlannedEntry[];
  adhocSessions: JournalOverlayAdhocSession[];
  allSessions: Session[];
}

export function resolveSessionCivilDate(
  session: Pick<Session, 'sessionDate' | 'startTime' | 'createdAt'>,
  pageDateById?: ReadonlyMap<string, string>,
  sessionPageId?: string,
): string {
  if (session.sessionDate) return session.sessionDate;
  if (sessionPageId && pageDateById?.has(sessionPageId)) {
    return pageDateById.get(sessionPageId)!;
  }
  return localCivilDateKey(session.startTime || session.createdAt);
}

/**
 * Paired-by-default day overlay uniting `ScheduleItem`s + executed `Session`s.
 */
export async function getJournalDayOverlay(
  storage: IStorage,
  rawDate?: string,
): Promise<JournalDayOverlay> {
  const dateKey = normalizeCivilDate(rawDate);
  const [pages, daySchedules, allSessions, allNotes] = await Promise.all([
    storage.readonly('page').getAll().catch(() => [] as Page[]),
    listScheduleItemsByDateRange(storage, dateKey, dateKey),
    storage.readonly('sessions').getAll().catch(() => [] as Session[]),
    storage.readonly('notes').getAll().catch(() => [] as Note[]),
  ]);

  const pageDateById = new Map<string, string>();
  let pageId: string | null = null;
  for (const p of pages) {
    if (p.date) {
      pageDateById.set(p.id, p.date);
      if (p.date === dateKey && !pageId) pageId = p.id;
    }
  }
  const notesById = new Map<string, Note>(allNotes.map((n) => [n.id, n]));

  const daySessions = allSessions
    .filter((s) => resolveSessionCivilDate(s, pageDateById, s.pageId) === dateKey)
    .sort((a, b) => a.startTime - b.startTime);

  const pairedByScheduleId = new Map<string, Session[]>();
  const pairedSessionIds = new Set<string>();
  for (const s of daySessions) {
    if (!s.scheduleItemId) continue;
    const match = daySchedules.find((item) => item.id === s.scheduleItemId);
    if (match) {
      const bucket = pairedByScheduleId.get(match.id) ?? [];
      bucket.push(s);
      pairedByScheduleId.set(match.id, bucket);
      pairedSessionIds.add(s.id);
    }
  }

  const planned: JournalOverlayPlannedEntry[] = daySchedules.map((item) => ({
    item,
    note: notesById.get(item.noteId),
    pairedSessions: pairedByScheduleId.get(item.id) ?? [],
  }));

  const adhocSessions: JournalOverlayAdhocSession[] = daySessions
    .filter((s) => !pairedSessionIds.has(s.id))
    .map((session) => ({
      session,
      note: notesById.get(session.noteId),
    }));

  return {
    date: dateKey,
    pageId,
    planned,
    adhocSessions,
    allSessions: daySessions,
  };
}

/**
 * Idempotently copy legacy dated `page_notes` rows into `schedule_items` (V35 backfill).
 */
export async function migrateDatedPageNotesToSchedule(storage: IStorage): Promise<number> {
  return storage.transaction(['page', 'page_notes', 'schedule_items', 'notes'], 'readwrite', async (tx) => {
    const [pages, pageNotes, existingSchedules, notes] = await Promise.all([
      tx.readonly('page').getAll(),
      tx.readonly('page_notes').getAll(),
      tx.readonly('schedule_items').getAll(),
      tx.readonly('notes').getAll(),
    ]);

    const dateByPage = new Map<string, string>();
    for (const p of pages) {
      if (p.date) dateByPage.set(p.id, p.date);
    }
    const existingIds = new Set(existingSchedules.map((s) => s.id));
    const notesById = new Map(notes.map((n) => [n.id, n]));
    const toCreate: ScheduleItem[] = [];

    for (const pn of pageNotes) {
      const date = dateByPage.get(pn.pageId);
      if (!date) continue;
      const deterministicId = `sched-${pn.id}`;
      if (existingIds.has(deterministicId)) continue;
      const alreadySameNoteOnDate = existingSchedules.some(
        (s) => s.date === date && s.noteId === pn.noteId && s.pageId === pn.pageId,
      );
      if (alreadySameNoteOnDate) continue;

      const note = notesById.get(pn.noteId);
      const createdAt = pn.createdAt ?? Date.now();
      const ownership = note
        ? resolveNoteOwnership(note, notebookOriginOfItem(note), notebookOfItem(note))
        : undefined;
      const resolvedNb = note ? (notebookOfItem(note) ?? ownership?.sourceNotebookId) : undefined;

      toCreate.push({
        id: deterministicId,
        date,
        noteId: pn.noteId,
        pageId: pn.pageId,
        ...(resolvedNb ? { sourceNotebookId: resolvedNb } : {}),
        ...(note?.title ? { fallbackTitle: note.title } : {}),
        position: pn.position ?? 0,
        status: 'planned',
        createdAt,
        updatedAt: createdAt,
      });
    }

    if (toCreate.length > 0) {
      await tx.readwrite('schedule_items').putMany(toCreate);
    }
    return toCreate.length;
  });
}
