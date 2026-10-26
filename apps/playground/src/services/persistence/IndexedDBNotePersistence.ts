import { v7 as uuidv7 } from 'uuid';

import { toShortId } from '@/lib/idUtils';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { storageService } from '@/services/storage';
import type { StorageService } from '@/services/storage/StorageService';
import type { HistoryRecord } from '@/types/history';
import type { IContentProvider } from '@/types/content-provider';
import type { Attachment, EventRecord, Note, Session, BlockRevision } from '@/types/storage';

import { resolveAttachmentInput } from './attachmentInput';
import type { INotePersistence } from './INotePersistence';
import { sessionToPayload } from './sessionPayload';
import {
  replayResultAnalytics,
} from '@/services/analytics/workoutDerivation';
import { captureWellnessFacts } from '@/services/analytics/wellness';
import { createParser } from '@bitcobblers/wod-wiki-engine';
import { toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import type { Sessions } from '@/components/Editor/types';
import { parseDocumentSections, KNOWN_SECTION_WIDGETS } from '@bitcobblers/wod-wiki-core';
import {
  NotePersistenceError,
  type CreateNoteInput,
  type GetNoteOptions,
  type NoteLocator,
  type NoteMutation,
  type NoteQuery,
  type ResultSelection,
  type SaveNoteInput,
  type StartedSession,
} from './types';

function sortNewest(results: Session[]): Session[] {
  return [...results].sort((a, b) => b.createdAt - a.createdAt);
}

function limitResults(results: Session[], limit?: number): Session[] {
  return limit == null ? results : results.slice(0, limit);
}

export class IndexedDBNotePersistence implements INotePersistence {
  constructor(
    private readonly storage: StorageService = storageService,
    private readonly contentProvider: IContentProvider = new IndexedDBContentProvider(storage),
  ) {}

  async createNote(input: CreateNoteInput): Promise<HistoryRecord> {
    await this.contentProvider.persistenceReady;
    const existing = await this.storage.getNote(input.id);
    if (existing) {
      throw new Error(`Note already exists: ${input.id}`);
    }
    return this.contentProvider.saveRecord({
      id: input.id,
      title: input.title,
      rawContent: input.rawContent,
      tags: input.tags ?? [],
      targetDate: input.targetDate,
      journalDate: input.journalDate,
      type: input.type ?? 'note',
      slug: input.slug,
      sourceId: input.sourceId,
    });
  }

  async getNote(locator: NoteLocator, options: GetNoteOptions = {}): Promise<HistoryRecord> {
    await this.contentProvider.persistenceReady;
    const note = await this.resolveNote(locator);
    if (!note) {
      throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    }

    const projection = options.projection ?? 'workbench';
    const includeSections = options.includeSections ?? projection !== 'summary';
    const includeAttachments = options.includeAttachments ?? false;
    const baseEntry = await this.contentProvider.getRecord(note.id);
    if (!baseEntry) {
      throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    }

    const resultProjection = projection === 'summary'
      ? {}
      : await this.selectResults(note, options.resultSelection);
    const attachments = includeAttachments
      ? await this.storage.getAttachmentsForNote(note.id)
      : undefined;

    return {
      ...baseEntry,
      ...resultProjection,
      sections: includeSections ? baseEntry.sections : undefined,
      attachments,
    };
  }

  async listNotes(query: NoteQuery = {}): Promise<HistoryRecord[]> {
    if (query.ids && query.ids.length > 0) {
      const projection = query.projection ?? 'summary';
      return Promise.all(
        query.ids.map(id => this.getNote(id, {
          projection,
          // Mirror the list branch: history-detail means "every result for the
          // note", not the default 'latest' single-result projection. Without
          // this, callers like the canvas that load via listNotes({ids}) get an
          // entry with no extendedResults, so the inline results bar never
          // hydrates on reload.
          ...(projection === 'history-detail' && { resultSelection: { mode: 'all-for-note' as const } }),
        })),
      );
    }

    let entries = await this.contentProvider.getRecords(query);
    if (query.journalDate) {
      // A note is on a date page when one of its placements sits on that
      // date's page — not only when the date is the note's primary one.
      // The placements list is always present but may be empty; a note with
      // no placements is not on any page, so the primary-date fallback
      // applies only when the membership list is non-empty.
      entries = entries.filter(entry =>
        entry.placements && entry.placements.length > 0
          ? entry.placements.some(placement => placement.date === query.journalDate)
          : entry.journalDate === query.journalDate);
    }
    if (query.kind) {
      entries = entries.filter(entry => entry.type === query.kind);
    }
    if (query.search) {
      const search = query.search.toLowerCase();
      entries = entries.filter(entry =>
        entry.title.toLowerCase().includes(search) ||
        entry.rawContent.toLowerCase().includes(search)
      );
    }
    if (query.projection === 'history-detail') {
      entries = await Promise.all(entries.map(entry =>
        this.getNote(entry.id, {
          projection: 'history-detail',
          resultSelection: { mode: 'all-for-note' },
        })
      ));
    }
    if (query.offset || query.limit) {
      entries = entries.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? entries.length));
    }
    return entries;
  }

  async mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryRecord> {
    await this.contentProvider.persistenceReady;
    const note = await this.resolveNote(locator);
    if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    // Pre-flight: reject a stale draft before opening the wide write
    // transaction. The in-transaction expectedSourceRevision check in
    // saveNoteSource remains the authoritative race guard.
    if (mutation.expectedSourceRevision !== undefined && mutation.expectedSourceRevision !== note.sourceRevision) {
      throw new NotePersistenceError('STALE_SOURCE', `Note ${note.id} changed since it was loaded`);
    }
    const resolvedAttachments = mutation.attachments?.add
      ? await Promise.all(mutation.attachments.add.map(input => resolveAttachmentInput(input))) : [];
    await this.storage.withTransaction(
      ['notes', 'page', 'page_notes', 'tags', 'note_tags', 'tag_types', 'block_revisions', 'sessions', 'events', 'attachments', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment'],
      async scoped => {
        const provider = new IndexedDBContentProvider(scoped);
        await provider.updateRecord(note.id, { ...mutation.metadata, rawContent: mutation.rawContent,
          blocks: mutation.blocks, expectedSourceRevision: mutation.expectedSourceRevision,
          results: mutation.workoutResult?.data, blockId: mutation.workoutResult?.blockId,
          blockVersion: mutation.workoutResult?.blockVersion, blockContentId: mutation.workoutResult?.blockContentId,
          origin: mutation.workoutResult?.origin, resultId: mutation.workoutResult?.id });
        if (mutation.rawContent !== undefined && mutation.rawContent !== note.rawContent) {
          const entry = await provider.getRecord(note.id);
          await captureWellnessFacts(note.id, mutation.rawContent, scoped, { targetDate: entry?.targetDate });
        }
        for (const attachment of resolvedAttachments) {
          await scoped.saveAttachment({ ...attachment, id: attachment.id ?? uuidv7(), noteId: note.id,
            resultId: mutation.workoutResult?.id, createdAt: Date.now() } satisfies Attachment);
        }
        for (const id of mutation.attachments?.remove ?? []) await scoped.deleteAttachment(id);
      },
    );
    return this.getNote(note.id, { includeAttachments: Boolean(mutation.attachments) });
  }

  async saveNote(input: SaveNoteInput): Promise<HistoryRecord> {
    await this.contentProvider.persistenceReady;
    const exists = await this.storage.getNote(input.noteId);
    if (exists) return this.mutateNote(input.noteId, { rawContent: input.rawContent,
      blocks: input.blocks, expectedSourceRevision: input.expectedSourceRevision, metadata: input.metadata });
    if (input.expectedSourceRevision !== 0) throw new NotePersistenceError('STALE_SOURCE', `Note ${input.noteId} no longer exists`);
    return this.contentProvider.saveRecord({ id: input.noteId, rawContent: input.rawContent,
      blocks: input.blocks, sourceRevision: 0, title: input.metadata?.title ?? 'Workout Note',
      tags: input.metadata?.tags ?? [], targetDate: input.metadata?.targetDate ?? Date.now(),
      journalDate: input.metadata?.journalDate, slug: input.metadata?.slug ?? undefined,
      type: input.metadata?.type ?? input.noteType, sourceId: input.metadata?.sourceId ?? undefined,
      createdAt: input.createdAt });
  }

  async startSession(input: SaveNoteInput, session: Omit<Session, 'blockVersion'>): Promise<StartedSession> {
    await this.contentProvider.persistenceReady;
    if (session.noteId !== input.noteId) throw new NotePersistenceError('RESULT_NOTE_MISMATCH', 'Session belongs to another Note');
    return this.storage.withTransaction(
      ['notes', 'block_revisions', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment', 'sessions', 'events', 'page', 'page_notes', 'tags', 'note_tags', 'tag_types'],
      async scoped => {
        const persistence = new IndexedDBNotePersistence(scoped, new IndexedDBContentProvider(scoped));
        await persistence.saveNote(input);
        const note = await scoped.getNote(input.noteId);
        const block = note?.blocks[session.blockId];
        if (!note || !block || block.kind !== 'wod') throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Selected workout is not in the saved Note');
        const revision = await scoped.getBlockRevision(note.id, block.id, block.version);
        if (!revision) throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Selected workout revision is missing');
        const existing = await scoped.getSessionById(session.id);
        if (existing) throw new Error(`Session already exists: ${session.id}`);
        const section = parseDocumentSections(revision.rawContent, { registeredWidgets: KNOWN_SECTION_WIDGETS }).find(section => section.scriptBlock);
        const pinned: Session = { ...session, blockId: block.id, blockVersion: revision.version,
          blockContentId: section?.scriptBlock?.contentId, status: 'in-progress' };
        await scoped.saveSession(pinned);
        return { note, revision, session: pinned };
      },
    );
  }

  async finishSession(sessionId: string, data: Sessions, createdAt?: number): Promise<Session> {
    await this.contentProvider.persistenceReady;
    return this.storage.withTransaction(['sessions', 'block_revisions', 'events'], async scoped => {
      const previous = await scoped.getSessionById(sessionId);
      if (!previous) throw new NotePersistenceError('RESULT_NOT_FOUND', `Session not found: ${sessionId}`);
      const revision = await scoped.getBlockRevision(previous.noteId, previous.blockId, previous.blockVersion);
      if (!revision) throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Pinned workout revision is missing');
      const session: Session = { ...previous, startTime: data.startTime, endTime: data.endTime,
        duration: data.duration ?? 0, roundsCompleted: data.roundsCompleted, totalRounds: data.totalRounds,
        repsCompleted: data.repsCompleted, completed: data.completed,
        // finishSession is the lifecycle finalize: the row is final whether
        // the workout completed or the user stopped early. `completed:false`
        // already records the partial outcome; leaving status 'in-progress'
        // would claim a resumable session that no caller resumes.
        status: 'completed', createdAt: createdAt ?? previous.createdAt };
      await scoped.saveSession(session);
      if (data.logs?.length) {
        const identity = { noteId: session.noteId, resultId: session.id, blockId: session.blockId,
          blockVersion: session.blockVersion, blockContentId: session.blockContentId,
          origin: session.origin, pageId: session.pageId, workoutTimestamp: session.endTime };
        await scoped.appendEvents(toEventRows(data.logs, identity));
        await scoped.finalizeSummaries(session.id, toSummaryEventRows(data.logs, identity));
      }
      return session;
    });
  }

  async getBlockRevision(noteId: string, blockId: string, version: number): Promise<BlockRevision | undefined> {
    await this.contentProvider.persistenceReady;
    return this.storage.getBlockRevision(noteId, blockId, version);
  }

  async getBlockHistory(noteId: string, blockId: string): Promise<BlockRevision[]> {
    await this.contentProvider.persistenceReady;
    return this.storage.getBlockHistory(noteId, blockId);
  }

  async getNoteBlockHistory(noteId: string): Promise<BlockRevision[]> {
    await this.contentProvider.persistenceReady;
    return this.storage.getNoteBlockHistory(noteId);
  }

  async deleteNote(locator: NoteLocator): Promise<void> {
    await this.contentProvider.persistenceReady;
    const note = await this.resolveNote(locator);
    if (!note) {
      throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    }
    await this.contentProvider.deleteRecord(note.id);
  }
  async getSessionById(sessionId: string): Promise<Session | undefined> {
    await this.contentProvider.persistenceReady;
    return this.storage.getSessionById(sessionId);
  }

  /** Replay only the immutable workout incarnation pinned at start. */
  async rederiveResultAnalytics(resultId: string): Promise<Session> {
    await this.contentProvider.persistenceReady;
    const result = await this.storage.getSessionById(resultId);
    if (!result) {
      throw new NotePersistenceError('RESULT_NOT_FOUND', `Result not found: ${resultId}`);
    }

    const revision = await this.storage.getBlockRevision(result.noteId, result.blockId, result.blockVersion);
    const scriptBlock = revision && parseDocumentSections(revision.rawContent).find(section => section.scriptBlock)?.scriptBlock;
    if (!scriptBlock || revision?.kind !== 'wod') {
      throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', `Cannot re-derive result ${resultId}: pinned workout revision is missing`);
    }
    const block = { ...scriptBlock, id: result.blockId, version: result.blockVersion,
      dialect: revision.dialect, sport: revision.sport,
      statements: createParser().read(scriptBlock.content, revision.sport).statements };
    const events = this.storage.getEventsByResult ? await this.storage.getEventsByResult(resultId) : [];
    const derivedLogs = replayResultAnalytics(block, events);

    // Event rows are the authoritative store (V21): purge the previous
    // projection and write the replayed rows so the result converges to
    // exactly one row set — re-running this is idempotent. Purge + rewrite
    // commit as ONE events transaction: a failed write rolls the delete back
    // too (the old warn-and-return lost the previous projection outright).
    if (this.storage.appendEvents && this.storage.finalizeSummaries) {
      const identity = {
        noteId: result.noteId,
        resultId: result.id,
        blockId: result.blockId,
        blockVersion: result.blockVersion,
        blockContentId: result.blockContentId,
        origin: result.origin,
        pageId: result.pageId,
        workoutTimestamp: result.createdAt,
      };
      await this.storage.withTransaction(['events'], async scoped => {
        if (events.length > 0) {
          await scoped.deleteEvents(events.map((row) => row.id));
        }
        await scoped.appendEvents(toEventRows(derivedLogs, identity));
        await scoped.finalizeSummaries(result.id, toSummaryEventRows(derivedLogs, identity));
      });
    }

    return result;
  }

  private async resolveNote(locator: NoteLocator): Promise<Note | undefined> {
    if (typeof locator === 'string') {
      return this.resolveByAnyId(locator);
    }
    if (locator.id) {
      return this.resolveByAnyId(locator.id);
    }
    if (locator.slug) {
      return this.resolveByAnyId(locator.slug);
    }
    const notes = await this.storage.getAllNotes();
    if (locator.shortId) {
      return notes.find(note => toShortId(note.id) === locator.shortId);
    }
    const title = locator.title;
    if (title) {
      return notes.find(note => note.title.toLowerCase() === title.toLowerCase());
    }
    return undefined;
  }

  private async resolveByAnyId(id: string): Promise<Note | undefined> {
    const direct = await this.storage.getNote(id);
    if (direct) return direct;
    const bySlug = await this.storage.getNoteBySlug?.(id);
    if (bySlug) return bySlug;
    const notes = await this.storage.getAllNotes();
    return notes.find(note => toShortId(note.id) === id || note.title.toLowerCase() === id.toLowerCase());
  }

  private describeLocator(locator: NoteLocator): string {
    return typeof locator === 'string'
      ? locator
      : locator.id ?? locator.slug ?? locator.shortId ?? locator.title ?? '<empty locator>';
  }


  /**
   * Cross-note "similar workouts" read path (Candidate 1 / cross-note-result-
   * aggregation ADR): every result recorded against the same blockContentId,
   * across all notes. Playground-origin rows are excluded by default — pass
   * includePlayground to reveal them. Sorted newest-first.
   */
  async getSimilarSessions(
    blockContentId: string,
    options: { excludeNoteId?: string; includePlayground?: boolean; limit?: number } = {},
  ): Promise<Session[]> {
    let results = await this.storage.getSessionsByContentId(blockContentId);
    if (options.excludeNoteId) {
      results = results.filter(r => r.noteId !== options.excludeNoteId);
    }
    if (!options.includePlayground) {
      results = results.filter(r => r.origin !== 'playground');
    }
    return limitResults(sortNewest(results), options.limit);
  }

  private async selectResults(note: Note, selection: ResultSelection = { mode: 'latest' }): Promise<Partial<HistoryRecord>> {
    const eventsFor = async (session: Session | undefined): Promise<EventRecord[]> => {
      if (!session || !this.storage.getEventsByResult) return [];
      return this.storage.getEventsByResult(session.id);
    };

    if (selection.mode === 'by-result-id') {
      const result = await this.storage.getSessionById(selection.resultId);
      if (!result) {
        throw new NotePersistenceError('RESULT_NOT_FOUND', `Result not found: ${selection.resultId}`);
      }
      if (result.noteId !== note.id) {
        throw new NotePersistenceError(
          'RESULT_NOTE_MISMATCH',
          `Result ${selection.resultId} does not belong to note ${note.id}`,
        );
      }
      return { results: sessionToPayload(result, await eventsFor(result)) };
    }

    if (selection.mode === 'latest-for-section' || selection.mode === 'all-for-section') {
      const results = sortNewest(await this.storage.getSessionsForSection(note.id, selection.blockId));
      if (selection.mode === 'all-for-section') {
        const extendedResults = limitResults(results, selection.limit);
        return { results: await this.payloadOf(extendedResults[0]), extendedResults };
      }
      return { results: await this.payloadOf(results[0]) };
    }

    const results = sortNewest(await this.storage.getSessionsForNote(note.id));
    if (selection.mode === 'all-for-note') {
      const extendedResults = limitResults(results, selection.limit);
      return { results: await this.payloadOf(extendedResults[0]), extendedResults };
    }

    return { results: await this.payloadOf(results[0]) };
  }

  private async payloadOf(session: Session | undefined): Promise<Sessions | undefined> {
    if (!session) return undefined;
    const events = this.storage.getEventsByResult ? await this.storage.getEventsByResult(session.id) : [];
    return sessionToPayload(session, events);
  }
}
