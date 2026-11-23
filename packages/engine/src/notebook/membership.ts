/**
 * NotebookMembership — Deep module owning many-to-many Note and Session
 * membership across Notebooks (`notebook_links` store + synchronized
 * `Note.notebookIds` and `Session.notebookIds` projections).
 *
 * Invariants:
 *   1. Notes are cleanly decoupled from `notebook/journal`: user Notes authored
 *      in custom Notebooks stay in those Notebooks, and Notes detached from all
 *      Notebooks remain valid unfiled (`notebookIds: []`) records discoverable
 *      via `:note{!notebook:*}`.
 *   2. Read-only system Notebooks (`notebook/defaults`, `notebook/guides`,
 *      `notebook/efforts`, `notebook/equipment`, `notebook/dashboards`) and
 *      feed-delivered Notebooks (`origin: 'feed'`) reject user Note membership
 *      mutations.
 *   3. Non-publishable Notebooks (`journal`, `playground`, `defaults`,
 *      `custom`, `guides`, `efforts`, `equipment`, `dashboards`) can never be
 *      marked `public`.
 */

import {
  isNonPublishableNotebook,
  isSystemReadOnlyNotebook,
  notebookSlugFromId,
  toNotebookId,
  type Note,
  type NotebookId,
  type NotebookLink,
  type NotebookLinkTargetKind,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { notebooksOfItem } from '@bitcobblers/wod-wiki-wql';

export function makeNotebookLinkId(
  notebookId: NotebookId,
  targetKind: NotebookLinkTargetKind,
  targetId: string,
): string {
  return `${notebookId}:${targetKind}:${targetId}`;
}

function isPropertyDefinitionNoteId(noteId: string): boolean {
  return (
    noteId.startsWith('effort/') ||
    noteId.startsWith('equipment/') ||
    noteId.startsWith('t/')
  );
}

function isNotebookLandingNote(note: Pick<Note, 'id' | 'notebookId'>): boolean {
  return note.id.startsWith('notebook/') && note.notebookId === note.id;
}

function baseUserMemberships(note: Note): NotebookId[] {
  if (note.seedOrigin === 'seed' || note.feedOrigin === 'feed') return [];
  if (isNotebookLandingNote(note) || isPropertyDefinitionNoteId(note.id)) return [];
  const base: NotebookId[] = [];
  if (note.type === 'playground' || note.sourceId === 'playground') {
    base.push('notebook/playground');
  }
  return base;
}

function dedupeNotebooks(ids: Iterable<string>): NotebookId[] {
  const out: NotebookId[] = [];
  for (const raw of ids) {
    if (!raw || !raw.trim()) continue;
    const norm = toNotebookId(raw);
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

async function assertWritableTargetNotebook(
  tx: Parameters<Parameters<IStorage['transaction']>[2]>[0],
  notebookId: NotebookId,
): Promise<void> {
  if (isSystemReadOnlyNotebook(notebookId)) {
    throw new Error(`Notebook '${notebookId}' is read-only and cannot accept promoted notes.`);
  }
  const landing = await tx.readonly('notes').get(notebookId);
  if (landing && (landing.feedOrigin === 'feed' || landing.seedOrigin === 'seed')) {
    throw new Error(`Notebook '${notebookId}' is feed-delivered and read-only.`);
  }
}

async function ensureUserNotebookLanding(
  tx: Parameters<Parameters<IStorage['transaction']>[2]>[0],
  notebookId: NotebookId,
  now: number,
): Promise<void> {
  if (isNonPublishableNotebook(notebookId)) return;
  const existing = await tx.readonly('notes').get(notebookId);
  if (existing) return;
  const slug = notebookSlugFromId(notebookId);
  const title = slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || slug;
  await tx.readwrite('notes').put({
    id: notebookId,
    title,
    rawContent: `# ${title}\n`,
    sourceRevision: 1,
    blocks: {},
    createdAt: now,
    notebookId,
    seedOrigin: 'user',
  });
}

export async function createUserNotebookLanding(
  storage: IStorage,
  rawName: string,
): Promise<NotebookId> {
  const trimmed = rawName.trim();
  let slug =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'notebook';
  if (isNonPublishableNotebook(slug)) slug = `${slug}-user`;
  const nbId = toNotebookId(slug);
  await storage.transaction(['notes'], 'readwrite', async (tx) => {
    const existing = await tx.readonly('notes').get(nbId);
    if (!existing) {
      await tx.readwrite('notes').put({
        id: nbId,
        title: trimmed || slug,
        rawContent: `# ${trimmed || slug}\n`,
        sourceRevision: 1,
        blocks: {},
        createdAt: Date.now(),
        notebookId: nbId,
        seedOrigin: 'user',
      });
    }
  });
  return nbId;
}

export interface PromoteNoteToNotebooksInput {
  noteId: string;
  /** Target user Notebooks to link this Note (and optional Sessions) into. */
  notebookIds: readonly string[];
  /** Optional subset of attached Session IDs on this Note to promote alongside it. */
  sessionIds?: readonly string[];
  /** When true, marks the promoted `sessionIds` as `public: true` for Feed publication. */
  shareSessionsPublicly?: boolean;
}

export interface PromoteNoteResult {
  note: Note;
  notebookIds: NotebookId[];
  promotedSessionIds: string[];
}

/**
 * Promote a Note (Journal, Playground, or regular user Note) and optional
 * attached Sessions into one or more user Notebooks without evicting the Note
 * from `notebook/journal`.
 */
export async function promoteNoteToNotebooks(
  storage: IStorage,
  input: PromoteNoteToNotebooksInput,
): Promise<PromoteNoteResult> {
  const requestedTargets = dedupeNotebooks(input.notebookIds);
  const now = Date.now();

  return storage.transaction(
    ['notes', 'sessions', 'notebook_links', 'block_revisions'],
    'readwrite',
    async (tx) => {
      const note = await tx.readonly('notes').get(input.noteId);
      if (!note) {
        throw new Error(`Note not found: ${input.noteId}`);
      }
      if (note.seedOrigin === 'seed' || note.feedOrigin === 'feed') {
        throw new Error(`Read-only Feed Note '${input.noteId}' must be cloned before promotion.`);
      }

      for (const target of requestedTargets) {
        if (target !== 'notebook/journal' && target !== 'notebook/playground') {
          await assertWritableTargetNotebook(tx, target);
          await ensureUserNotebookLanding(tx, target, now);
        }
      }

      const existingLinks = await tx.readonly('notebook_links').getAllFromIndex('by-note', note.id);
      const existingNoteLinks = existingLinks
        .filter((l) => l.targetKind === 'note' && l.targetId === note.id)
        .map((l) => toNotebookId(l.notebookId));

      const merged = dedupeNotebooks([
        ...baseUserMemberships(note),
        ...(note.notebookIds ?? []),
        ...(note.notebookId ? [note.notebookId] : []),
        ...existingNoteLinks,
        ...requestedTargets,
      ]);

      const primaryUserNb = merged.find(
        (id) => id !== 'notebook/journal' && id !== 'notebook/playground',
      );
      const updatedNote: Note = {
        ...note,
        notebookIds: merged,
        ...(primaryUserNb ? { notebookId: primaryUserNb } : {}),
      };
      await tx.readwrite('notes').put(updatedNote);

      const linkRows: NotebookLink[] = merged.map((nbId) => ({
        id: makeNotebookLinkId(nbId, 'note', note.id),
        notebookId: nbId,
        targetKind: 'note',
        targetId: note.id,
        noteId: note.id,
        createdAt: now,
      }));

      const promotedSessionIds: string[] = [];
      if (input.sessionIds && input.sessionIds.length > 0) {
        const wantedSessions = new Set(input.sessionIds);
        const sessions = await tx.readonly('sessions').getAllFromIndex('by-note', note.id);
        for (const sess of sessions) {
          if (!wantedSessions.has(sess.id)) continue;
          const sessNotebooks = dedupeNotebooks([
            ...(sess.notebookIds ?? []),
            ...requestedTargets,
          ]);
          const updatedSess: Session = {
            ...sess,
            notebookIds: sessNotebooks,
            ...(input.shareSessionsPublicly !== undefined ? { public: input.shareSessionsPublicly } : {}),
          };
          await tx.readwrite('sessions').put(updatedSess);
          promotedSessionIds.push(sess.id);

          for (const nbId of sessNotebooks) {
            linkRows.push({
              id: makeNotebookLinkId(nbId, 'session', sess.id),
              notebookId: nbId,
              targetKind: 'session',
              targetId: sess.id,
              noteId: note.id,
              createdAt: now,
            });
          }
        }
      }

      if (linkRows.length > 0) {
        await tx.readwrite('notebook_links').putMany(linkRows);
      }

      return {
        note: updatedNote,
        notebookIds: merged,
        promotedSessionIds,
      };
    },
  );
}

/**
 * Replace the exact set of user Notebooks a Note is linked to (`[]` is valid
 * for unfiled / orphaned Notes).
 */
export async function setNoteNotebooks(
  storage: IStorage,
  input: { noteId: string; notebookIds: readonly string[] },
): Promise<NotebookId[]> {
  const requested = dedupeNotebooks(input.notebookIds);
  const now = Date.now();

  return storage.transaction(['notes', 'notebook_links', 'block_revisions'], 'readwrite', async (tx) => {
    const note = await tx.readonly('notes').get(input.noteId);
    if (!note) throw new Error(`Note not found: ${input.noteId}`);
    if (note.seedOrigin === 'seed' || note.feedOrigin === 'feed') {
      throw new Error(`Read-only Feed Note '${input.noteId}' cannot change Notebook membership.`);
    }

    const userTargets = requested.filter((id) => id !== 'notebook/playground');
    for (const target of userTargets) {
      if (target !== 'notebook/journal') {
        await assertWritableTargetNotebook(tx, target);
        await ensureUserNotebookLanding(tx, target, now);
      }
    }

    const finalMemberships = dedupeNotebooks([
      ...baseUserMemberships(note),
      ...userTargets,
    ]);

    const existingLinks = await tx.readonly('notebook_links').getAllFromIndex('by-note', note.id);
    const linkStore = tx.readwrite('notebook_links');
    for (const link of existingLinks) {
      if (link.targetKind === 'note' && link.targetId === note.id) {
        if (!finalMemberships.includes(toNotebookId(link.notebookId))) {
          await linkStore.delete(link.id);
        }
      }
    }

    for (const nbId of finalMemberships) {
      await linkStore.put({
        id: makeNotebookLinkId(nbId, 'note', note.id),
        notebookId: nbId,
        targetKind: 'note',
        targetId: note.id,
        noteId: note.id,
        createdAt: now,
      });
    }

    const primaryUserNb = finalMemberships.find(
      (id) => id !== 'notebook/journal' && id !== 'notebook/playground',
    );
    const cleanedTags = note.tags
      ? note.tags.filter((tag) => {
          if (!tag.startsWith('notebook:') && !tag.startsWith('notebook/')) return true;
          const slug = notebookSlugFromId(tag);
          if (!slug) return true;
          return finalMemberships.includes(toNotebookId(slug));
        })
      : undefined;
    const { notebookId: _priorSingle, ...rest } = note;
    const updatedNote: Note = {
      ...rest,
      notebookIds: finalMemberships,
      ...(cleanedTags !== undefined ? { tags: cleanedTags } : {}),
      ...(primaryUserNb ? { notebookId: primaryUserNb } : {}),
    };
    await tx.readwrite('notes').put(updatedNote);
    return finalMemberships;
  });
}

/**
 * Detach a Note from one user Notebook. When detaching the last Notebook, the
 * Note becomes unfiled/orphaned (`notebookIds: []`).
 */
export async function removeNoteFromNotebook(
  storage: IStorage,
  noteId: string,
  notebookIdOrSlug: string,
): Promise<NotebookId[]> {
  const target = toNotebookId(notebookIdOrSlug);
  const current = await getNoteNotebooks(storage, noteId);
  const remaining = current.filter((id) => id !== target);
  return setNoteNotebooks(storage, { noteId, notebookIds: remaining });
}

/**
 * Resolve all Notebooks currently linked to a Note across `notebook_links` and
 * the Note's persisted membership fields.
 */
export async function getNoteNotebooks(
  storage: IStorage,
  noteId: string,
): Promise<NotebookId[]> {
  const note = await storage.readonly('notes').get(noteId);
  if (!note) return [];
  let linkNotebookIds: string[] = [];
  try {
    const links = await storage.readonly('notebook_links').getAllFromIndex('by-note', noteId);
    linkNotebookIds = links
      .filter((l) => l.targetKind === 'note' && l.targetId === noteId)
      .map((l) => l.notebookId);
  } catch {
    // Fallback for lightweight mock storages without notebook_links index
  }
  const hasExplicitArray = Array.isArray(note.notebookIds);
  return dedupeNotebooks([
    ...baseUserMemberships(note),
    ...(note.notebookIds ?? []),
    ...linkNotebookIds,
    ...(hasExplicitArray ? [] : notebooksOfItem(note)),
  ]);
}
