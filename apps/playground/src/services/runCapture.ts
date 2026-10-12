import { createParser } from '@bitcobblers/wod-wiki-engine';
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import { notePersistence, type INotePersistence, type SaveNoteInput } from '@/services/persistence';
import { storageService } from '@/services/storage';
import type { BlockRevision, Note, ResultOrigin, Session } from '@/types/storage';
import type { ScriptBlock } from '@/components/Editor/types';

export interface CapturedRun {
  note: Note;
  session: Session;
  /** Shared immutable storage revision, never a duplicate Session source snapshot. */
  revision: BlockRevision;
  block: ScriptBlock;
}

export function blockFromRevision(revision: BlockRevision): ScriptBlock {
  if (revision.kind !== 'wod' || !revision.dialect) throw new Error('The saved revision is not a workout.');
  const section = parseDocumentSections(revision.rawContent).find(section => section.type === revision.dialect);
  if (!section?.scriptBlock) throw new Error('The saved workout fence cannot be read.');
  const content = section.scriptBlock.content;
  return {
    id: revision.blockId,
    content,
    dialect: revision.dialect,
    sport: revision.sport,
    statements: createParser().read(content, revision.sport).statements,
    startLine: 0,
    endLine: revision.rawContent.split('\n').length - 1,
    version: revision.version,
    state: 'idle',
    widgetIds: {},
    createdAt: revision.savedAt,
  };
}

export async function captureRun(input: SaveNoteInput, block: ScriptBlock, resultId: string, origin?: ResultOrigin, persistence: INotePersistence = notePersistence): Promise<CapturedRun> {
  const startedAt = Date.now();
  const captured = await persistence.startSession(input, {
    id: resultId,
    noteId: input.noteId,
    blockId: block.id,
    blockContentId: block.contentId,
    origin: origin ?? 'journal',
    startTime: startedAt,
    endTime: startedAt,
    duration: 0,
    completed: false,
    status: 'in-progress',
    createdAt: startedAt,
  });
  return { ...captured, block: blockFromRevision(captured.revision) };
}

export async function captureStoredRun(noteId: string, block: ScriptBlock, resultId: string, origin?: ResultOrigin): Promise<CapturedRun> {
  const note = await storageService.getNote(noteId);
  if (!note) throw new Error('The note is unavailable. Save the note before starting a workout.');
  return captureRun({ noteId: note.id, rawContent: note.rawContent, blocks: note.blocks, expectedSourceRevision: note.sourceRevision }, block, resultId, origin);
}
