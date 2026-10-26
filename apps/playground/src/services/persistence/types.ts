import type { Sessions } from '@/components/Editor/types';
import type { HistoryRecord } from '@/types/history';
import type { Attachment, AnalyticsDataPoint, Note, NoteKind, NoteBlock, BlockRevision, ResultOrigin, EventRecord, Session } from '@/types/storage';
import type { StoreName } from '@bitcobblers/wod-wiki-storage';
import type { StorageService } from '@/services/storage/StorageService';

export type NoteLocator =
  | string
  | {
      id?: string;
      slug?: string;
      shortId?: string;
      title?: string;
    };

export interface GetNoteOptions {
  projection?: 'summary' | 'workbench' | 'review' | 'history-detail';
  resultSelection?: ResultSelection;
  includeAttachments?: boolean;
  includeSections?: boolean;
}

export type ResultSelection =
  | {
      mode: 'latest';
    }
  | {
      mode: 'by-result-id';
      resultId: string;
    }
  | {
      mode: 'latest-for-section';
      blockId: string;
    }
  | {
      mode: 'all-for-section';
      blockId: string;
      limit?: number;
    }
  | {
      mode: 'all-for-note';
      limit?: number;
    };

export interface CreateNoteInput {
  id: string;
  title: string;
  rawContent: string;
  targetDate: number;
  journalDate?: string;
  tags?: string[];
  type?: NoteKind;
  slug?: string;
  /** N-10 — the note this one was created from (template/collection source). */
  sourceId?: string;
}

export interface SaveNoteInput {
  noteId: string;
  rawContent: string;
  blocks: Record<string, NoteBlock>;
  expectedSourceRevision: number;
  metadata?: NoteMutation['metadata'];
  noteType?: NoteKind;
  createdAt?: number;
}

export interface StartedSession {
  note: Note;
  revision: BlockRevision;
  session: Session;
}

export interface NoteQuery {
  ids?: string[];
  dateRange?: { start: number; end: number };
  daysBack?: number;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
  projection?: 'summary' | 'history-detail';
  journalDate?: string;
  kind?: NoteKind;
}

export interface AttachmentFileInput {
  id?: string;
  file: File;
  label?: string;
  mimeType?: string;
  timeSpan?: { start: number; end: number };
}

export interface AttachmentDataInput {
  id?: string;
  label: string;
  mimeType: string;
  data: ArrayBuffer | string;
  timeSpan?: { start: number; end: number };
}

export type AttachmentInput = AttachmentFileInput | AttachmentDataInput;

export interface NoteMutation {
  rawContent?: string;
  blocks?: Record<string, NoteBlock>;
  expectedSourceRevision?: number;
  metadata?: Partial<{
    title: string;
    tags: string[];
    journalDate: string;
    /** Unix ms — domain date (`Note.date`) kept in sync with the calendar page. */
    targetDate: number;
    notes: string;
    type: NoteKind;
    /** `null` clears the note's source — promotion out of a source bucket
     *  (e.g. playground → journal) leaves the source scope without a
     *  residual `source:` filter match. */
    sourceId: string | null;
    /** `null` clears the route slug — promoted notes stop answering their
     *  old playground route so a later same-key intake can never update a
     *  journal note in place of the departed playground entry. */
    slug: string | null;
  }>;
  workoutResult?: {
    id?: string;
    blockId: string;
    blockVersion: number;
    blockContentId?: string;
    origin?: ResultOrigin;  // Which surface produced the result; default filters exclude 'playground'
    data: Sessions;
    createdAt?: number;
  };
  /** Kind supplied by callers creating a missing Note through saveNote. */
  noteType?: NoteKind;
  attachments?: {
    add?: Array<File | AttachmentInput>;
    remove?: string[];
  };
}

export type NotePersistenceErrorCode =
  | 'NOTE_NOT_FOUND'
  | 'NOTE_NOT_PLACED'
  | 'RESULT_NOT_FOUND'
  | 'RESULT_NOTE_MISMATCH'
  | 'BLOCK_REVISION_NOT_FOUND'
  | 'STALE_SOURCE';

export class NotePersistenceError extends Error {
  constructor(
    readonly code: NotePersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NotePersistenceError';
  }
}

export interface NotePersistenceStorage {
  getNoteBySlug?(slug: string): Promise<Note | undefined>;
  getNote(id: string): Promise<Note | undefined>;
  saveNote(note: Note): Promise<string>;
  getAllNotes(): Promise<Note[]>;
  saveNoteSource(input: SaveNoteInput): Promise<Note>;
  getBlockRevision(noteId: string, blockId: string, version: number): Promise<BlockRevision | undefined>;
  getBlockHistory(noteId: string, blockId: string): Promise<BlockRevision[]>;
  getNoteBlockHistory(noteId: string): Promise<BlockRevision[]>;
  getSessionsForNote(noteId: string): Promise<Session[]>;
  saveSession(session: Session): Promise<string>;
  /** V6 — cross-note collection aggregation: every session for one blockContentId, across all notes. */
  getSessionsByContentId(blockContentId: string): Promise<Session[]>;
  getSessionsForSection(noteId: string, blockId: string): Promise<Session[]>;
  getSessionById(sessionId: string): Promise<Session | undefined>;
  getAttachmentsForNote(noteId: string): Promise<Attachment[]>;
  saveAttachment(attachment: Attachment): Promise<string>;
  deleteAttachment(id: string): Promise<void>;
  /**
   * V16 unified event store write surface (engine `EventStore`,
   * tickets 003/005). On real backends these are load-bearing: a projection
   * failure rejects the mutation and rolls back all source writes. The
   * optional typing exists only so read-only test fakes can omit the
   * surface — omitting it SKIPS capture, it does not tolerate failures.
   */
  appendEvents?(rows: EventRecord[]): Promise<void>;
  /** Atomic finalize: clear the result's engine-authored summaries, write finals. */
  finalizeSummaries?(resultId: string, rows: EventRecord[]): Promise<void>;
  /** Reconcile deletes (wellness note-save) + GC sweeps. */
  deleteEvents?(ids: string[]): Promise<void>;
  /** Note-scoped event reads for wellness reconcile. */
  getEventsForNote?(noteId: string): Promise<EventRecord[]>;
  /** Session-scoped event reads for RPE capture and review. */
  getEventsByResult?(resultId: string): Promise<EventRecord[]>;
  /**
   * Atomic mutation scope: fn receives a storage whose EVERY method routes
   * through one underlying readwrite transaction — any rejection rolls back
   * all source writes. mutateNote depends on this for its all-or-nothing
   * contract; queryDomain is unavailable on the scoped instance.
   */
  withTransaction<K extends StoreName, R>(
    stores: K[],
    fn: (scoped: StorageService) => Promise<R>,
  ): Promise<R>;
}

export type { HistoryRecord, Attachment, AnalyticsDataPoint, Session, EventRecord };
