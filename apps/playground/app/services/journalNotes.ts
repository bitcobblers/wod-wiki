import { v7 as uuidv7 } from 'uuid';

import type { INotePersistence } from '@/services/persistence';
import { notePersistence } from '@/services/persistence';
import type { HistoryEntry } from '@/types/history';
import type { NoteBlock } from '@/types/storage';
import { reconcileNoteBlocks, mapNoteBlockChanges, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import type { WidgetOpResult } from '@bitcobblers/wod-wiki-wql';

import { normalizeNoteTitle } from '@/lib/noteTitle';
import { parseJournalDate } from './parseJournalDate';

export interface CreateJournalNoteInput {
  /** Optional - dashboard and other non-journal notes carry no date. */
  journalDate?: string;
  title: string;
  rawContent: string;
  tags?: string[];
  slug?: string;
  sourceId?: string;
  type?: 'note' | 'playground' | 'journal' | 'dashboard';
}

export interface JournalNotes {
  create(input: CreateJournalNoteInput): Promise<HistoryEntry>;
  getById(noteId: string): Promise<HistoryEntry>;
  resolve(idOrSlug: string): Promise<HistoryEntry>;
  listByDate(journalDate: string): Promise<HistoryEntry[]>;
  update(note: Pick<HistoryEntry, 'id' | 'rawContent' | 'blocks' | 'sourceRevision'>, rawContent: string, lineage?: Pick<Extract<WidgetOpResult, { ok: true }>, 'changes' | 'retainedBlocks'>): Promise<HistoryEntry>;
  moveToDate(noteId: string, journalDate: string): Promise<HistoryEntry>;
  delete(noteId: string): Promise<void>;
}

export interface JournalNotesDependencies {
  persistence: Pick<INotePersistence, 'createNote' | 'getNote' | 'listNotes' | 'mutateNote' | 'deleteNote'>;
  uuid?: () => string;
}

function dateTimestamp(journalDate: string): number {
  const parsed = parseJournalDate(journalDate);
  if (!parsed) throw new Error(`Invalid journal date: ${journalDate}`);
  return parsed.date.getTime();
}
export function createJournalNotes({
  persistence,
  uuid = uuidv7,
}: JournalNotesDependencies): JournalNotes {
  // Serialize per-note mutations: asynchronous reads before the write transaction
  // can otherwise let an older keystroke overwrite the final edit.
  const updateQueue = new Map<string, Promise<unknown>>();

  return {
    async create(input) {
      const targetDate = input.journalDate ? dateTimestamp(input.journalDate) : Date.now();
      return persistence.createNote({
        id: uuid(),
        title: normalizeNoteTitle(input.title),
        rawContent: input.rawContent,
        tags: input.tags ?? [],
        targetDate,
        journalDate: input.journalDate || undefined,
        type: input.type ?? 'journal',
        slug: input.slug,
        sourceId: input.sourceId,
      });
    },

    getById(noteId) {
      return persistence.getNote({ id: noteId }, {
        projection: 'workbench',
        resultSelection: { mode: 'all-for-note' },
        includeSections: true,
        includeAttachments: true,
      });
    },

    resolve(idOrSlug) {
      return persistence.getNote(idOrSlug, {
        projection: 'workbench',
        resultSelection: { mode: 'all-for-note' },
        includeSections: true,
        includeAttachments: true,
      });
    },

    async listByDate(journalDate) {
      dateTimestamp(journalDate);
      const notes = await persistence.listNotes({
        journalDate,
        kind: 'journal',
        projection: 'summary',
      });
      return notes.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    update(note, rawContent, lineage) {
      const noteId = note.id;
      const heading = normalizeNoteTitle(rawContent.match(/^#\s+(.+)$/m)?.[1]?.trim());
      const revision = note.sourceRevision;
      if (revision === undefined) return Promise.reject(new Error('Loaded Note source revision is required'));
      let from = 0;
      while (from < note.rawContent.length && from < rawContent.length && note.rawContent[from] === rawContent[from]) from++;
      let oldTo = note.rawContent.length;
      let newTo = rawContent.length;
      while (oldTo > from && newTo > from && note.rawContent[oldTo - 1] === rawContent[newTo - 1]) { oldTo--; newTo--; }
      const mapped: Record<string, NoteBlock> = mapNoteBlockChanges(note.blocks ?? {}, lineage?.changes ?? [{ from, to: oldTo, insert: rawContent.slice(from, newTo) }]);
      for (const retained of lineage?.retainedBlocks ?? []) {
        const block = Object.values(note.blocks ?? {}).find(block => block.from === retained.from && block.to === retained.to);
        if (block) mapped[block.id] = { ...block, from: retained.nextFrom, to: retained.nextTo };
      }
      const blocks = reconcileNoteBlocks(rawContent, { sourceRevision: revision, registeredWidgets: KNOWN_SECTION_WIDGETS, blocks: mapped });
      const write = async () => persistence.mutateNote({ id: noteId }, {
        rawContent, blocks, expectedSourceRevision: revision,
        metadata: heading ? { title: heading } : undefined,
      });
      // Chain onto this note's pending write so a rejection never wedges it.
      const prev = updateQueue.get(noteId) ?? Promise.resolve();
      const next = prev.then(write, write);
      updateQueue.set(noteId, next);
      // Settled entries are dropped so the map cannot grow unbounded. Both
      // outcomes handled here so a failed write never surfaces as an
      // unhandled rejection from this internal cleanup chain.
      const cleanup = () => {
        if (updateQueue.get(noteId) === next) updateQueue.delete(noteId);
      };
      next.then(cleanup, cleanup);
      return next;
    },

    moveToDate(noteId, journalDate) {
      // Validate the route date shape first — a malformed or impossible date
      // must not reach the store (throws).
      const targetDate = dateTimestamp(journalDate);
      return persistence.mutateNote({ id: noteId }, {
        metadata: {
          journalDate,
          targetDate,
        },
      });
    },

    delete(noteId) {
      return persistence.deleteNote({ id: noteId });
    },
  };
}

export const journalNotes = createJournalNotes({ persistence: notePersistence });
