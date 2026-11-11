/**
 * JournalSessionIntake — Deep module owning read-only workout cloning into
 * `notebook/journal`, atomic Session pinning, and upstream Note provenance
 * resolution.
 *
 * When a workout is started on ANY read-only Note (`seedOrigin === 'seed'`,
 * `feedOrigin === 'feed'`, `notebook/defaults`, `notebook/guides`, or a
 * subscribed Feed Notebook), this module atomically:
 *   1. Clones the full Note (Markdown prose, frontmatter, all workout & widget
 *      blocks, and immutable `BlockRevision`s) into `notebook/journal`,
 *   2. Places the cloned Note onto the requested calendar `Page` (`YYYY-MM-DD`),
 *   3. Records structured `NoteProvenance` (`sourceNoteId`, `sourceVersion`,
 *      `sourceCommit`, `feedSourceId`, `sourceNotebookId`, `sourcePath`),
 *   4. Pins the new `Session` to the corresponding block occurrence on the
 *      Journal clone — leaving the read-only upstream Note untouched.
 */

import {
  KNOWN_SECTION_WIDGETS,
  blockContentId,
  isNoteEditable,
  parseDocumentSections,
  reconcileNoteBlocks,
  type BlockIndexRow,
  type BlockRevision,
  type Note,
  type NoteBlock,
  type NoteProvenance,
  type NotebookLink,
  type Page,
  type PageNote,
  type ResultOrigin,
  type Session,
} from '@bitcobblers/wod-wiki-core';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import { makeNotebookLinkId } from './membership';

function mintUuid(): string {
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

function utcCivilDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface PrepareJournalSessionRunInput {
  noteId: string;
  blockId?: string;
  sessionId?: string;
  journalDate?: string;
  startedAt?: number;
  origin?: ResultOrigin;
}

export interface PreparedJournalSessionRun {
  note: Note;
  revision: BlockRevision;
  session: Session;
  clonedFromReadOnly: boolean;
  upstreamNoteId?: string;
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
}

function computeWodContentId(blockSource: string): string | undefined {
  const sec = parseDocumentSections(blockSource, { registeredWidgets: KNOWN_SECTION_WIDGETS }).find(
    (s) => s.scriptBlock,
  );
  if (sec?.scriptBlock?.contentId) return sec.scriptBlock.contentId;
  if (sec?.scriptBlock?.content) return blockContentId(sec.scriptBlock.content);
  return undefined;
}

export async function prepareJournalSessionRun(
  storage: IStorage,
  input: PrepareJournalSessionRunInput,
): Promise<PreparedJournalSessionRun> {
  const startedAt = input.startedAt ?? Date.now();
  const sessionId = input.sessionId ?? mintUuid();
  const journalDate = input.journalDate ?? utcCivilDateKey(startedAt);

  return storage.transaction(
    ['notes', 'block_revisions', 'block_index', 'sessions', 'page', 'page_notes', 'notebook_links'],
    'readwrite',
    async (tx) => {
      const sourceNote = await tx.readonly('notes').get(input.noteId);
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

      const nbOrigin = notebookOriginOfItem(sourceNote);
      const resolvedNb = notebookOfItem(sourceNote);
      const editable = isNoteEditable(sourceNote, nbOrigin, resolvedNb);

      if (!editable) {
        // Read-only Note: snapshot verbatim into private `notebook/journal`
        const clonedNoteId = mintUuid();
        let ordinal = 0;
        const clonedBlocks: Record<string, NoteBlock> = reconcileNoteBlocks(sourceNote.rawContent, {
          sourceRevision: 1,
          registeredWidgets: KNOWN_SECTION_WIDGETS,
          createId: () => `blk-${clonedNoteId.slice(0, 8)}-${ordinal++}`,
        });

        const clonedBlockList = Object.values(clonedBlocks);
        const mappedBlock =
          clonedBlockList.find(
            (b) =>
              b.kind === 'wod' &&
              b.from === selectedSourceBlock.from &&
              b.to === selectedSourceBlock.to,
          ) ?? clonedBlockList.find((b) => b.kind === 'wod');

        if (!mappedBlock) {
          throw new Error('Cloned Journal Note contains no runnable workout block.');
        }

        const revisions: BlockRevision[] = [];
        const projections: BlockIndexRow[] = [];
        let pinnedRevision: BlockRevision | undefined;

        for (const [pos, b] of clonedBlockList.entries()) {
          const slice = sourceNote.rawContent.slice(b.from, b.to);
          const rev: BlockRevision = {
            noteId: clonedNoteId,
            blockId: b.id,
            version: 1,
            kind: b.kind,
            rawContent: slice,
            savedAt: startedAt,
            ...(b.dialect ? { dialect: b.dialect } : {}),
            ...(b.sport ? { sport: b.sport } : {}),
          };
          revisions.push(rev);
          if (b.id === mappedBlock.id) pinnedRevision = rev;

          const cid = b.kind === 'wod' ? computeWodContentId(slice) : undefined;
          projections.push({
            id: `${clonedNoteId}:${b.id}`,
            noteId: clonedNoteId,
            blockId: b.id,
            blockVersion: 1,
            sourceRevision: 1,
            from: b.from,
            to: b.to,
            position: pos,
            dataType: b.kind,
            ...(cid ? { blockContentId: cid } : {}),
            rawContent: slice,
            noteTitle: sourceNote.title,
            createdAt: startedAt,
            isStatic: false,
            notebookId: 'notebook/journal',
          });
        }

        const provenance = buildNoteProvenance(sourceNote, resolvedNb, startedAt);

        const dateEpoch = Date.parse(`${journalDate}T12:00:00Z`);
        const clonedNote: Note = {
          id: clonedNoteId,
          title: sourceNote.title,
          rawContent: sourceNote.rawContent,
          sourceRevision: 1,
          blocks: clonedBlocks,
          ...(Number.isFinite(dateEpoch) ? { date: dateEpoch } : {}),
          createdAt: startedAt,
          type: 'journal',
          sourceId: sourceNote.id,
          notebookIds: ['notebook/journal'],
          provenance,
          ...(sourceNote.tags?.length ? { tags: [...sourceNote.tags] } : {}),
          seedOrigin: 'user',
        };

        // Place onto Journal calendar Page (`YYYY-MM-DD`)
        let existingPages: Page[];
        try {
          existingPages = await tx.readonly('page').getAllFromIndex('by-date', journalDate);
        } catch {
          existingPages = (await tx.readonly('page').getAll()).filter((p) => p.date === journalDate);
        }
        let targetPage = existingPages[0];
        if (!targetPage) {
          targetPage = {
            id: mintUuid(),
            date: journalDate,
            title: journalDate,
            createdAt: startedAt,
          };
          await tx.readwrite('page').put(targetPage);
        }
        const pageNote: PageNote = {
          id: mintUuid(),
          pageId: targetPage.id,
          noteId: clonedNoteId,
          createdAt: startedAt,
        };

        const cid = computeWodContentId(pinnedRevision!.rawContent);
        const session: Session = {
          id: sessionId,
          noteId: clonedNoteId,
          blockId: mappedBlock.id,
          blockVersion: 1,
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

        const links: NotebookLink[] = [
          {
            id: makeNotebookLinkId('notebook/journal', 'note', clonedNoteId),
            notebookId: 'notebook/journal',
            targetKind: 'note',
            targetId: clonedNoteId,
            noteId: clonedNoteId,
            createdAt: startedAt,
          },
          {
            id: makeNotebookLinkId('notebook/journal', 'session', sessionId),
            notebookId: 'notebook/journal',
            targetKind: 'session',
            targetId: sessionId,
            noteId: clonedNoteId,
            createdAt: startedAt,
          },
        ];

        await tx.readwrite('notes').put(clonedNote);
        if (revisions.length > 0) await tx.readwrite('block_revisions').putMany(revisions);
        if (projections.length > 0) await tx.readwrite('block_index').putMany(projections);
        await tx.readwrite('page_notes').put(pageNote);
        await tx.readwrite('sessions').put(session);
        await tx.readwrite('notebook_links').putMany(links);

        return {
          note: clonedNote,
          revision: pinnedRevision!,
          session,
          clonedFromReadOnly: true,
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
      const effectiveOrigin: ResultOrigin =
        input.origin ?? (isPlayground ? 'playground' : 'journal');

      const session: Session = {
        id: sessionId,
        noteId: sourceNote.id,
        blockId: selectedSourceBlock.id,
        blockVersion: revision.version,
        ...(cid ? { blockContentId: cid } : {}),
        origin: effectiveOrigin,
        status: 'in-progress',
        startTime: startedAt,
        endTime: startedAt,
        duration: 0,
        completed: false,
        createdAt: startedAt,
        notebookIds: [...baseNotebooks],
      };

      const links: NotebookLink[] = mergedNotebooks.map((nbId) => ({
        id: makeNotebookLinkId(nbId as `notebook/${string}`, 'note', sourceNote.id),
        notebookId: nbId,
        targetKind: 'note',
        targetId: sourceNote.id,
        noteId: sourceNote.id,
        createdAt: startedAt,
      }));
      links.push({
        id: makeNotebookLinkId('notebook/journal', 'session', sessionId),
        notebookId: 'notebook/journal',
        targetKind: 'session',
        targetId: sessionId,
        noteId: sourceNote.id,
        createdAt: startedAt,
      });

      await tx.readwrite('sessions').put(session);
      await tx.readwrite('notebook_links').putMany(links);

      return {
        note: updatedNote,
        revision,
        session,
        clonedFromReadOnly: false,
      };
    },
  );
}

/**
 * Resolve a cloned Note's upstream provenance against current storage.
 * Returns `exists: true` while the original Note remains in storage (so UI can
 * link directly to it), and `exists: false` with preserved metadata if the
 * upstream Feed was later unsubscribed or removed.
 */
export async function resolveUpstreamProvenance(
  storage: IStorage,
  note: Pick<Note, 'provenance' | 'sourceId'>,
): Promise<ResolvedUpstreamProvenance | null> {
  const sourceNoteId =
    note.provenance?.sourceNoteId ??
    (note.sourceId &&
    !note.sourceId.startsWith('/') &&
    !note.sourceId.includes(':') &&
    note.sourceId !== 'playground'
      ? note.sourceId
      : undefined);

  if (!sourceNoteId) return null;

  const upstream = await storage.readonly('notes').get(sourceNoteId);
  if (upstream) {
    return {
      exists: true,
      sourceNoteId,
      title: upstream.title,
      sourceVersion: note.provenance?.sourceVersion,
      currentUpstreamVersion: upstream.seedVersion ?? upstream.sourceRevision,
      sourceCommit: note.provenance?.sourceCommit ?? upstream.seedCommit,
      feedSourceId: note.provenance?.feedSourceId ?? upstream.feedSourceId,
      sourceNotebookId: note.provenance?.sourceNotebookId ?? notebookOfItem(upstream),
      sourcePath: note.provenance?.sourcePath ?? upstream.sourcePath,
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
