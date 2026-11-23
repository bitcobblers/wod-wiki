/**
 * NotebookLifecycle — Atomic lifecycle operations for user-owned Notebooks
 * shared across Playground `NotebookService` and MCP/CLI `wod_notebook_*` tools.
 */

import {
  BUILTIN_NOTEBOOKS,
  isNotebookLanding,
  notebookSlugFromId,
  toNotebookId,
  type NotebookId,
} from '@bitcobblers/wod-wiki-core';
import { userDeletedSeedKey, type IStorage } from '@bitcobblers/wod-wiki-storage';

export interface DeleteNotebookResult {
  deleted: boolean;
  notebookId: NotebookId;
  slug: string;
}

const RESERVED_SLUGS = new Set(BUILTIN_NOTEBOOKS.map((b) => b.slug));

/**
 * Atomically delete a user-created Notebook landing note, its `notebook_links`,
 * and any membership references on member Notes while keeping member Notes intact.
 * Built-in/always-present notebooks are rejected before opening a transaction.
 */
export async function deleteUserNotebook(
  storage: IStorage,
  notebookIdOrSlug: string,
): Promise<DeleteNotebookResult> {
  const nbId = toNotebookId(notebookIdOrSlug);
  const slug = notebookSlugFromId(nbId);
  if (RESERVED_SLUGS.has(slug)) {
    throw new Error(`Notebook '${nbId}' is always present and cannot be deleted.`);
  }

  return storage.transaction(
    [
      'notes',
      'notebook_links',
      'attachments',
      'note_tags',
      'block_index',
      'block_efforts',
      'block_equipment',
      'page_notes',
      'meta',
    ],
    'readwrite',
    async (tx) => {
      const allNotes = await tx.readonly('notes').getAll();
      const links = await tx
        .readonly('notebook_links')
        .getAllFromIndex('by-notebook', nbId)
        .catch(() => []);
      const linkedNoteIds = new Set(
        links.filter((l) => l.targetKind === 'note').map((l) => l.noteId),
      );

      let touchedMembers = 0;
      const noteWriter = tx.readwrite('notes');
      for (const note of allNotes) {
        if (isNotebookLanding(note)) continue;
        const hasSingle = note.notebookId === nbId;
        const hasMulti = (note.notebookIds ?? []).includes(nbId);
        const hasLink = linkedNoteIds.has(note.id);
        if (!hasSingle && !hasMulti && !hasLink) continue;

        const baseIds =
          note.notebookIds !== undefined
            ? note.notebookIds
            : note.notebookId
              ? [note.notebookId]
              : [];
        const remaining = baseIds.map((id) => toNotebookId(id)).filter((id) => id !== nbId);
        const primaryUser = remaining.find(
          (id) => id !== 'notebook/journal' && id !== 'notebook/playground',
        );
        const { notebookId: _droppedSingle, notebookIds: _droppedMulti, ...rest } = note;
        await noteWriter.put({
          ...rest,
          notebookIds: remaining,
          ...(primaryUser ? { notebookId: primaryUser } : {}),
        });
        touchedMembers++;
      }

      if (links.length > 0) {
        const linkWriter = tx.readwrite('notebook_links');
        for (const link of links) {
          await linkWriter.delete(link.id);
        }
      }

      const landing = allNotes.find((n) => n.id === nbId);
      if (landing) {
        await noteWriter.delete(nbId);
        try {
          for (const att of await tx.readonly('attachments').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('attachments').delete(att.id);
          }
          for (const link of await tx.readonly('note_tags').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('note_tags').delete(link.id);
          }
          for (const row of await tx.readonly('block_index').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('block_index').delete(row.id);
          }
          for (const row of await tx.readonly('block_efforts').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('block_efforts').delete(row.id);
          }
          for (const row of await tx.readonly('block_equipment').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('block_equipment').delete(row.id);
          }
          for (const pn of await tx.readonly('page_notes').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('page_notes').delete(pn.id);
          }
          for (const nl of await tx.readonly('notebook_links').getAllFromIndex('by-note', nbId)) {
            await tx.readwrite('notebook_links').delete(nl.id);
          }
        } catch {
          // Optional indexes on minimal storage test doubles
        }

        if (
          landing.seedOrigin === 'seed' ||
          landing.seedChunkId !== undefined ||
          landing.sourcePath !== undefined
        ) {
          await tx.readwrite('meta').put({ key: userDeletedSeedKey(nbId), value: Date.now() });
        }
      }

      return {
        deleted: Boolean(landing || touchedMembers > 0 || links.length > 0),
        notebookId: nbId,
        slug,
      };
    },
  );
}
