import type { BlockRevision, Session } from '@/types/storage';
import type { Sessions } from '@/components/Editor/types';
import type { CreateNoteInput, GetNoteOptions, NoteLocator, NoteMutation, NoteQuery, SaveNoteInput, StartedSession } from './types';
import type { HistoryRecord } from '@/types/history';

export interface INotePersistence {
  createNote(input: CreateNoteInput): Promise<HistoryRecord>;
  getNote(locator: NoteLocator, options?: GetNoteOptions): Promise<HistoryRecord>;
  listNotes(query?: NoteQuery): Promise<HistoryRecord[]>;
  mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryRecord>;
  deleteNote(locator: NoteLocator): Promise<void>;
  saveNote(input: SaveNoteInput): Promise<HistoryRecord>;
  startSession(input: SaveNoteInput, session: Omit<Session, 'blockVersion'>): Promise<StartedSession>;
  finishSession(sessionId: string, data: Sessions, createdAt?: number): Promise<Session>;
  getBlockRevision(noteId: string, blockId: string, version: number): Promise<BlockRevision | undefined>;
  getBlockHistory(noteId: string, blockId: string): Promise<BlockRevision[]>;
  getNoteBlockHistory(noteId: string): Promise<BlockRevision[]>;
  /**
   * Fetch sessions for the same workout block (same `blockContentId`) recorded in
   * other notes. Optional because not every backend adapter supports this query.
   */
  getSimilarSessions?(
    blockContentId: string,
    options?: { excludeNoteId?: string; includePlayground?: boolean; limit?: number },
  ): Promise<Session[]>;
  getSessionById?(sessionId: string): Promise<Session | undefined>;
}
