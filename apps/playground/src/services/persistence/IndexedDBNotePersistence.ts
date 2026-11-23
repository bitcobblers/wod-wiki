import { v7 as uuidv7 } from 'uuid';
import {
  isNoteEditable,
  isSystemReadOnlyNotebook,
  parseDocumentSections,
  reconcileNoteBlocks,
  resolveNoteOwnership,
  toNotebookId,
  KNOWN_SECTION_WIDGETS,
  projectPlacements,
  resolvePlacements,
  type NotebookId,
  type PageTarget,
} from '@bitcobblers/wod-wiki-core';
import {
  createParser,
  makeNotebookLinkId,
  parseRemoteNoteId,
  prepareJournalSessionRun,
} from '@bitcobblers/wod-wiki-engine';
import { notebookOfItem, notebookOriginOfItem, toEventRows, toSummaryEventRows } from '@bitcobblers/wod-wiki-wql';
import { rowsEqual, type DomainDetail, type DomainPredicate, type DomainQuery } from '@bitcobblers/wod-wiki-storage';

import type { ScriptBlock, Sessions } from '@/components/Editor/types';
import { localDateKey } from '@/lib/dateFormat';
import { extractTypedFrontmatterTags } from '@/lib/frontmatter';
import { toShortId } from '@/lib/idUtils';
import { formatPlaygroundTimestampId } from '@/lib/playgroundDisplay';
import { captureWellnessFacts } from '@/services/analytics/wellness';
import { replayResultAnalytics } from '@/services/analytics/workoutDerivation';
import { loadRemoteRecordDetail, lookupRemoteRecord } from '@/services/feed/feedCatalog';
import { storageService, type StorageService } from '@/services/storage';
import type {
  AttachmentCreateInput,
  ContentProviderMode,
  IContentProvider,
  NoteRecordPatch,
  NoteSaveInput,
} from '@/types/content-provider';
import type { HistoryQuery, HistoryRecord, ProviderCapabilities } from '@/types/history';
import type { Attachment, BlockRevision, EventRecord, Note, NoteBlock, Page, Session } from '@/types/storage';

import { resolveAttachmentInput } from './attachmentInput';
import { unmarkNoteDeleting } from './noteDeletionGuard';
import type { INotePersistence } from './INotePersistence';
import { sessionToPayload } from './sessionPayload';
import {
  NotePersistenceError,
  type CreateNoteInput,
  type FinishSessionFallback,
  type GetNoteOptions,
  type NoteLocator,
  type NoteMutation,
  type NoteQuery,
  type ResultSelection,
  type SaveNoteInput,
  type StartedSession,
} from './types';

const BLOCK_OPTIONS = { registeredWidgets: KNOWN_SECTION_WIDGETS };
const preparedJournalSessions = new Map<string, Session>();
const MUTATION_STORES = [
  'notes',
  'block_revisions',
  'note_revisions',
  'schedule_items',
  'page',
  'page_notes',
  'tags',
  'note_tags',
  'tag_types',
  'sessions',
  'events',
  'block_index',
  'block_efforts',
  'block_equipment',
  'efforts',
  'equipment',
  'notebook_links',
] as const;

function sortNewest(results: Session[]): Session[] {
  return [...results].sort((a, b) => b.createdAt - a.createdAt);
}

function limitResults(results: Session[], limit?: number): Session[] {
  return limit == null ? results : results.slice(0, limit);
}

/** Local noon of a civil date — the same representative instant the WQL
 *  calendar (zonedNoon) uses for placement-dated entries. */
function localNoon(iso: string): number {
  return new Date(`${iso}T12:00:00`).getTime();
}

function entryFromDomainRow(row: DomainDetail): HistoryRecord {
  const placements = resolvePlacements(row.links, row.pages);
  const projection = projectPlacements(placements);
  // The journal page IS the date of record for an undated note (WW-024):
  // its civil date anchors targetDate so date windows admit it.
  const placedTs = placements.find((p) => p.date !== undefined)?.date;
  const placedDate = placedTs !== undefined ? localNoon(placedTs) : NaN;
  return {
    id: row.note.id,
    title: row.note.title,
    slug: projection.pageSlug,
    pageId: projection.pageId,
    journalDate:
      projection.journalDate ??
      (row.note.type === 'journal' && row.note.date !== undefined
        ? localDateKey(new Date(row.note.date))
        : undefined),
    placements,
    createdAt: row.note.createdAt,
    updatedAt: row.note.createdAt,
    targetDate: row.note.date ?? (Number.isFinite(placedDate) ? placedDate : row.note.createdAt),
    rawContent: row.note.rawContent,
    blocks: row.note.blocks,
    sourceRevision: row.note.sourceRevision,
    tags: row.tags.map(tag => tag.label),
    type: row.note.type ?? 'note',
    sourceId: row.note.sourceId,
    notebookId: row.note.notebookId,
    notebookIds: row.note.notebookIds,
    provenance: row.note.provenance,
    seedOrigin: row.note.seedOrigin,
    schemaVersion: 1,
  };
}

function entryFromNoteSummary(note: Note): HistoryRecord {
  return {
    id: note.id,
    title: note.title,
    journalDate:
      note.type === 'journal' && note.date !== undefined
        ? localDateKey(new Date(note.date))
        : undefined,
    createdAt: note.createdAt,
    updatedAt: note.createdAt,
    targetDate: note.date ?? note.createdAt,
    rawContent: note.rawContent,
    blocks: note.blocks,
    sourceRevision: note.sourceRevision,
    tags: note.tags ?? [],
    type: note.type ?? 'note',
    sourceId: note.sourceId,
    notebookId: note.notebookId,
    notebookIds: note.notebookIds,
    provenance: note.provenance,
    seedOrigin: note.seedOrigin,
    schemaVersion: 1,
  };
}

function entryDateWindow(query?: HistoryQuery): { start: number; end: number } | undefined {
  if (query?.dateRange) return query.dateRange;
  if (query?.daysBack != null) {
    const end = Date.now();
    return { start: end - query.daysBack * 86_400_000, end };
  }
  return undefined;
}

export interface SelectiveRecordQuery extends HistoryQuery, Pick<NoteQuery, 'journalDate' | 'kind' | 'search' | 'offset' | 'limit'> {
  projection?: NoteQuery['projection'] | 'workbench';
}

/**
 * Unified IndexedDB-backed note persistence & content provider.
 *
 * Consolidates `INotePersistence` (high-level note, session, and replay API)
 * and `IContentProvider` (record CRUD, placements, tags, and attachments)
 * into a single service over `StorageService`.
 */
export class IndexedDBNotePersistence implements INotePersistence, IContentProvider {
  readonly mode: ContentProviderMode = 'history';
  readonly capabilities: ProviderCapabilities = {
    canWrite: true,
    canDelete: true,
    canFilter: true,
    canMultiSelect: true,
    supportsHistory: true,
  };

  constructor(
    private readonly storage: StorageService = storageService,
    private readonly contentProviderOverride?: IContentProvider,
  ) {}

  get persistenceStorage(): StorageService {
    return this.storage;
  }

  private get provider(): IContentProvider {
    return this.contentProviderOverride ?? this;
  }

  // ── INotePersistence ───────────────────────────────────────────────────────

  async createNote(input: CreateNoteInput): Promise<HistoryRecord> {
    await this.provider.persistenceReady;
    unmarkNoteDeleting(input.id);
    const existing = await this.storage.getNote(input.id);
    if (existing) {
      throw new Error(`Note already exists: ${input.id}`);
    }
    return this.provider.saveRecord({
      id: input.id,
      title: input.title,
      rawContent: input.rawContent,
      tags: input.tags ?? [],
      targetDate: input.targetDate,
      journalDate: input.journalDate,
      type: input.type ?? 'note',
      slug: input.slug,
      sourceId: input.sourceId,
      ...(input.notebookIds !== undefined ? { notebookIds: input.notebookIds } : {}),
    });
  }

  async getNote(locator: NoteLocator, options: GetNoteOptions = {}): Promise<HistoryRecord> {
    await this.provider.persistenceReady;
    const note = await this.resolveNote(locator);
    if (!note) {
      throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    }

    const projection = options.projection ?? 'workbench';
    const includeSections = options.includeSections ?? projection !== 'summary';
    const includeAttachments = options.includeAttachments ?? false;
    const baseEntry = await this.provider.getRecord(note.id);
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
          ...(projection === 'history-detail' && { resultSelection: { mode: 'all-for-note' as const } }),
        })),
      );
    }

    let entries = await this.provider.getRecords(query);
    if (query.journalDate) {
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
    if (query.offset || query.limit) {
      entries = entries.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? entries.length));
    }
    if (query.projection === 'history-detail') {
      entries = await Promise.all(entries.map(entry =>
        this.getNote(entry.id, {
          projection: 'history-detail',
          resultSelection: { mode: 'all-for-note' },
        })
      ));
    }
    return entries;
  }

  async mutateNote(locator: NoteLocator, mutation: NoteMutation): Promise<HistoryRecord> {
    await this.provider.persistenceReady;
    const note = await this.resolveNote(locator);
    if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    if (mutation.expectedSourceRevision !== undefined && mutation.expectedSourceRevision !== note.sourceRevision) {
      throw new NotePersistenceError('STALE_SOURCE', `Note ${note.id} changed since it was loaded`);
    }
    const resolvedAttachments = mutation.attachments?.add
      ? await Promise.all(mutation.attachments.add.map(input => resolveAttachmentInput(input))) : [];
    await this.storage.withTransaction(
      [...MUTATION_STORES, 'attachments'],
      async scoped => {
        const scopedProvider = new IndexedDBNotePersistence(scoped);
        await scopedProvider.updateRecord(note.id, {
          ...mutation.metadata,
          rawContent: mutation.rawContent,
          blocks: mutation.blocks,
          expectedSourceRevision: mutation.expectedSourceRevision,
          results: mutation.workoutResult?.data,
          blockId: mutation.workoutResult?.blockId,
          blockVersion: mutation.workoutResult?.blockVersion,
          blockContentId: mutation.workoutResult?.blockContentId,
          origin: mutation.workoutResult?.origin,
          resultId: mutation.workoutResult?.id,
        });
        if (mutation.rawContent !== undefined && mutation.rawContent !== note.rawContent) {
          const entry = await scopedProvider.getRecord(note.id);
          await captureWellnessFacts(note.id, mutation.rawContent, scoped, { targetDate: entry?.targetDate });
        }
        for (const attachment of resolvedAttachments) {
          await scoped.saveAttachment({
            ...attachment,
            id: attachment.id ?? uuidv7(),
            noteId: note.id,
            resultId: mutation.workoutResult?.id,
            createdAt: Date.now(),
          } satisfies Attachment);
        }
        for (const id of mutation.attachments?.remove ?? []) await scoped.deleteAttachment(id);
      },
    );
    return this.getNote(note.id, { includeAttachments: Boolean(mutation.attachments) });
  }

  async saveNote(input: SaveNoteInput): Promise<HistoryRecord> {
    await this.provider.persistenceReady;
    const exists = await this.storage.getNote(input.noteId);
    if (exists) {
      return this.mutateNote(input.noteId, {
        rawContent: input.rawContent,
        blocks: input.blocks,
        expectedSourceRevision: input.expectedSourceRevision,
        metadata: input.metadata,
      });
    }
    if (input.expectedSourceRevision !== 0) {
      throw new NotePersistenceError('STALE_SOURCE', `Note ${input.noteId} no longer exists`);
    }
    return this.provider.saveRecord({
      id: input.noteId,
      rawContent: input.rawContent,
      blocks: input.blocks,
      sourceRevision: 0,
      title: input.metadata?.title ?? 'Workout Note',
      tags: input.metadata?.tags ?? [],
      targetDate: input.metadata?.targetDate ?? Date.now(),
      journalDate: input.metadata?.journalDate,
      slug: input.metadata?.slug ?? undefined,
      type: input.metadata?.type ?? input.noteType,
      sourceId: input.metadata?.sourceId ?? undefined,
      createdAt: input.createdAt,
    });
  }

  async startSession(
    input: SaveNoteInput,
    session: Omit<Session, 'blockVersion'>,
    options?: { deferPersist?: boolean },
  ): Promise<StartedSession> {
    await this.provider.persistenceReady;
    if (session.noteId !== input.noteId) {
      throw new NotePersistenceError('RESULT_NOTE_MISMATCH', 'Session belongs to another Note');
    }
    const parsedRemote = parseRemoteNoteId(input.noteId);
    const lookupId = parsedRemote.isRemote ? parsedRemote.uuid : input.noteId;
    const existingStored =
      (await this.storage.getNote(lookupId)) ??
      (lookupId !== input.noteId ? await this.storage.getNote(input.noteId) : undefined);

    if (
      parsedRemote.isRemote ||
      (existingStored &&
        (!isNoteEditable(
          existingStored,
          notebookOriginOfItem(existingStored),
          notebookOfItem(existingStored),
        ) ||
          resolveNoteOwnership(
            existingStored,
            notebookOriginOfItem(existingStored),
            notebookOfItem(existingStored),
          ).kind !== 'user'))
    ) {
      let remotePayload: Parameters<typeof prepareJournalSessionRun>[1]['remotePayload'];
      if (!existingStored && parsedRemote.isRemote) {
        const seedRow = await loadRemoteRecordDetail(input.noteId).catch(() => undefined);
        const meta = lookupRemoteRecord(input.noteId);
        if (seedRow) {
          remotePayload = {
            row: seedRow,
            canonicalNoteId: meta?.record.uuid ?? parsedRemote.uuid,
            remoteNoteId: input.noteId,
            feedId: meta?.feedId ?? parsedRemote.feedId,
            notebookSlug: meta?.notebookSlug,
            record: meta?.record,
          };
        } else if (input.rawContent?.trim()) {
          remotePayload = {
            id: parsedRemote.uuid,
            title: input.metadata?.title,
            rawContent: input.rawContent,
            blocks: input.blocks,
            feedSourceId: meta?.feedId ?? parsedRemote.feedId,
            sourceNotebookId: meta?.notebookSlug ? `notebook/${meta.notebookSlug}` : undefined,
          };
        }
      }

      const civilDate = session.sessionDate ?? localDateKey(new Date(session.createdAt || session.startTime || Date.now()));
      const prepared = await prepareJournalSessionRun(this.storage.storage, {
        noteId: existingStored ? existingStored.id : input.noteId,
        blockId: session.blockId,
        ...(session.blockContentId ? { blockContentId: session.blockContentId } : {}),
        sessionId: session.id,
        journalDate: civilDate,
        startedAt: session.startTime,
        ...(session.scheduleItemId ? { scheduleItemId: session.scheduleItemId } : {}),
        origin: session.origin,
        ...(remotePayload ? { remotePayload } : {}),
      });
      preparedJournalSessions.set(prepared.session.id, prepared.session);
      return {
        note: prepared.note,
        revision: prepared.revision,
        session: prepared.session,
      };
    }
    return this.storage.withTransaction(
      ['notes', 'block_revisions', 'note_revisions', 'schedule_items', 'block_index', 'block_efforts', 'block_equipment', 'efforts', 'equipment', 'sessions', 'events', 'page', 'page_notes', 'tags', 'note_tags', 'tag_types', 'notebook_links'],
      async scoped => {
        const scopedPersistence = new IndexedDBNotePersistence(scoped);
        await scopedPersistence.saveNote(input);
        const note = await scoped.getNote(input.noteId);
        const block = note?.blocks[session.blockId];
        if (!note || !block || block.kind !== 'wod') {
          throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Selected workout is not in the saved Note');
        }
        const revision = await scoped.getBlockRevision(note.id, block.id, block.version);
        if (!revision) {
          throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Selected workout revision is missing');
        }
        const existing = await scoped.getSessionById(session.id);
        if (existing || preparedJournalSessions.has(session.id)) {
          throw new Error(`Session already exists: ${session.id}`);
        }
        const section = parseDocumentSections(revision.rawContent, BLOCK_OPTIONS).find(sec => sec.scriptBlock);
        const civilDate = session.sessionDate ?? localDateKey(new Date(session.createdAt || session.startTime || Date.now()));
        const explicitNotebooks = session.notebookIds?.length
          ? session.notebookIds
          : (note.notebookIds && note.notebookIds.length > 0 ? note.notebookIds : undefined);
        const pinned: Session = {
          ...session,
          blockId: block.id,
          blockVersion: revision.version,
          blockContentId: section?.scriptBlock?.contentId,
          noteSourceRevision: session.noteSourceRevision ?? note.sourceRevision,
          sessionDate: civilDate,
          status: 'in-progress',
          ...(explicitNotebooks ? { notebookIds: explicitNotebooks } : {}),
        };
        if (options?.deferPersist) {
          preparedJournalSessions.set(pinned.id, pinned);
        } else {
          await scoped.saveSession(pinned);
        }
        return { note, revision, session: pinned };
      },
    );
  }

  async finishSession(
    sessionId: string,
    data: Sessions,
    createdAt?: number,
    fallback?: FinishSessionFallback,
  ): Promise<Session> {
    await this.provider.persistenceReady;
    const finished = await this.storage.withTransaction(['sessions', 'notes', 'block_revisions', 'events', 'notebook_links', 'schedule_items'], async scoped => {
      const storedPrevious = await scoped.getSessionById(sessionId);
      let previous = storedPrevious ?? preparedJournalSessions.get(sessionId);
      if (!previous && fallback?.noteId && fallback?.blockId) {
        const parsedRemote = parseRemoteNoteId(fallback.noteId);
        const lookupId = parsedRemote.isRemote ? parsedRemote.uuid : fallback.noteId;
        const note =
          (await scoped.getNote(lookupId)) ??
          (lookupId !== fallback.noteId ? await scoped.getNote(fallback.noteId) : undefined);
        const targetNoteId = note?.id ?? lookupId;
        const block = note?.blocks[fallback.blockId];
        const targetBlockId = block?.id ?? fallback.blockId;
        const targetVersion = fallback.blockVersion ?? block?.version;

        let revision =
          targetVersion !== undefined
            ? await scoped.getBlockRevision(targetNoteId, targetBlockId, targetVersion)
            : undefined;
        if (!revision) {
          const history = await scoped.getBlockHistory(targetNoteId, targetBlockId);
          revision = history.reduce<BlockRevision | undefined>(
            (latest, item) => (!latest || item.version > latest.version ? item : latest),
            undefined,
          );
        }
        if (!revision && note) {
          const wodBlocks = Object.values(note.blocks).filter((b) => b.kind === 'wod');
          if (wodBlocks.length === 1) {
            const singleBlock = wodBlocks[0]!;
            revision = await scoped.getBlockRevision(note.id, singleBlock.id, singleBlock.version);
          }
        }

        if (revision) {
          const section = parseDocumentSections(revision.rawContent, BLOCK_OPTIONS).find(sec => sec.scriptBlock);
          const civilDate = fallback.sessionDate ?? localDateKey(new Date(data.endTime || data.startTime || createdAt || Date.now()));
          const explicitNotebooks = note?.notebookIds && note.notebookIds.length > 0 ? note.notebookIds : undefined;
          previous = {
            id: sessionId,
            noteId: revision.noteId,
            blockId: revision.blockId,
            blockVersion: revision.version,
            blockContentId: fallback.blockContentId ?? section?.scriptBlock?.contentId,
            noteSourceRevision: note?.sourceRevision,
            origin: fallback.origin ?? 'journal',
            ...(fallback.scheduleItemId ? { scheduleItemId: fallback.scheduleItemId } : {}),
            sessionDate: civilDate,
            startTime: data.startTime,
            endTime: data.endTime,
            duration: data.duration ?? 0,
            completed: data.completed,
            status: 'in-progress',
            createdAt: createdAt ?? data.endTime ?? Date.now(),
            ...(explicitNotebooks ? { notebookIds: explicitNotebooks } : {}),
          };
        }
      }
      if (!previous) throw new NotePersistenceError('RESULT_NOT_FOUND', `Session not found: ${sessionId}`);
      const revision = await scoped.getBlockRevision(previous.noteId, previous.blockId, previous.blockVersion);
      if (!revision) throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Pinned workout revision is missing');
      const civilDate = previous.sessionDate ?? localDateKey(new Date(data.endTime || data.startTime || previous.createdAt || Date.now()));
      const session: Session = {
        ...previous,
        sessionDate: civilDate,
        startTime: data.startTime,
        endTime: data.endTime,
        duration: data.duration ?? 0,
        roundsCompleted: data.roundsCompleted,
        totalRounds: data.totalRounds,
        repsCompleted: data.repsCompleted,
        completed: data.completed,
        status: 'completed',
        createdAt: createdAt ?? previous.createdAt,
      };
      await scoped.saveSession(session);
      if (session.scheduleItemId) {
        try {
          const scheduleStore = scoped.storage.readwrite('schedule_items');
          const scheduled = await scheduleStore.get(session.scheduleItemId);
          if (scheduled && scheduled.status !== 'completed') {
            await scheduleStore.put({
              ...scheduled,
              status: 'completed',
              updatedAt: session.endTime || Date.now(),
            });
          }
        } catch {
          // Optional schedule_items store on minimal mocks
        }
      }
      const nbIds = session.notebookIds ?? [];
      if (nbIds.length > 0) {
        const links = nbIds.map((notebookId) => ({
          id: `${notebookId}:session:${session.id}`,
          notebookId,
          targetKind: 'session' as const,
          targetId: session.id,
          noteId: session.noteId,
          createdAt: session.createdAt,
        }));
        await scoped.storage.readwrite('notebook_links').putMany(links);
      }
      if (data.logs?.length) {
        const identity = {
          noteId: session.noteId,
          resultId: session.id,
          blockId: session.blockId,
          blockVersion: session.blockVersion,
          blockContentId: session.blockContentId,
          origin: session.origin,
          pageId: session.pageId,
          workoutTimestamp: session.endTime,
        };
        await scoped.appendEvents(toEventRows(data.logs, identity));
        await scoped.finalizeSummaries(session.id, toSummaryEventRows(data.logs, identity));
      }
      return session;
    });
    preparedJournalSessions.delete(sessionId);
    return finished;
  }

  async getBlockRevision(noteId: string, blockId: string, version: number): Promise<BlockRevision | undefined> {
    await this.provider.persistenceReady;
    return this.storage.getBlockRevision(noteId, blockId, version);
  }

  async getBlockHistory(noteId: string, blockId: string): Promise<BlockRevision[]> {
    await this.provider.persistenceReady;
    return this.storage.getBlockHistory(noteId, blockId);
  }

  async getNoteBlockHistory(noteId: string): Promise<BlockRevision[]> {
    await this.provider.persistenceReady;
    return this.storage.getNoteBlockHistory(noteId);
  }

  async deleteNote(locator: NoteLocator): Promise<void> {
    await this.provider.persistenceReady;
    const note = await this.resolveNote(locator);
    if (!note) {
      throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${this.describeLocator(locator)}`);
    }
    await this.provider.deleteRecord(note.id);
  }

  async getSessionById(sessionId: string): Promise<Session | undefined> {
    await this.provider.persistenceReady;
    return this.storage.getSessionById(sessionId);
  }

  /** Replay only the immutable workout incarnation pinned at start. */
  async rederiveResultAnalytics(resultId: string): Promise<Session> {
    await this.provider.persistenceReady;
    const result = await this.storage.getSessionById(resultId);
    if (!result) {
      throw new NotePersistenceError('RESULT_NOT_FOUND', `Result not found: ${resultId}`);
    }

    const revision = await this.storage.getBlockRevision(result.noteId, result.blockId, result.blockVersion);
    const scriptBlock = revision && parseDocumentSections(revision.rawContent).find(section => section.scriptBlock)?.scriptBlock;
    if (!scriptBlock || revision?.kind !== 'wod') {
      throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', `Cannot re-derive result ${resultId}: pinned workout revision is missing`);
    }
    const block: ScriptBlock = {
      ...scriptBlock,
      results: undefined,
      id: result.blockId,
      version: result.blockVersion,
      dialect: revision.dialect,
      sport: revision.sport,
      widgetIds: {},
      statements: createParser().read(scriptBlock.content, revision.sport).statements,
    };
    const events = this.storage.getEventsByResult ? await this.storage.getEventsByResult(resultId) : [];
    const derivedLogs = replayResultAnalytics(block, events);

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
          await scoped.deleteEvents(events.map(row => row.id));
        }
        await scoped.appendEvents(toEventRows(derivedLogs, identity));
        await scoped.finalizeSummaries(result.id, toSummaryEventRows(derivedLogs, identity));
      });
    }

    return result;
  }

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

  // ── IContentProvider ───────────────────────────────────────────────────────

  private async selectLocalCandidateIds(
    query: SelectiveRecordQuery | undefined,
    window: { start: number; end: number } | undefined,
  ): Promise<{ candidateIds: string[]; loadedNotes: Map<string, Note> | null }> {
    let candidateIds: Set<string> | null = null;
    let loadedNotes: Map<string, Note> | null = null;

    const intersect = (ids: Iterable<string>): void => {
      if (candidateIds === null) {
        candidateIds = new Set(ids);
        return;
      }
      const next = new Set<string>();
      for (const id of ids) {
        if (candidateIds.has(id)) next.add(id);
      }
      candidateIds = next;
    };

    if (query?.journalDate) {
      intersect(await this.storage.getNoteIdsForJournalDate(query.journalDate));
      if (candidateIds!.size === 0) return { candidateIds: [], loadedNotes };
    }

    if (query?.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        intersect(await this.storage.getNoteIdsForTag(tag));
        if (candidateIds!.size === 0) return { candidateIds: [], loadedNotes };
      }
    }

    if (query?.kind && query.kind !== 'note' && candidateIds === null) {
      const typedNotes = await this.storage.getNotesByType(query.kind);
      loadedNotes = new Map(typedNotes.map((n) => [n.id, n]));
      intersect(typedNotes.map((n) => n.id));
      if (candidateIds!.size === 0) return { candidateIds: [], loadedNotes };
    }

    if (window) {
      const placedNoteIds = new Set<string>();
      const allPages = await this.storage.getAllPages();
      const inWindowPages = allPages.filter((p) => {
        if (!p.date) return false;
        const ts = localNoon(p.date);
        return Number.isFinite(ts) && ts >= window.start && ts <= window.end;
      });
      if (inWindowPages.length > 0) {
        const linkGroups = await Promise.all(
          inWindowPages.map((p) => this.storage.getPageNotes(p.id)),
        );
        for (const group of linkGroups) {
          for (const link of group) placedNoteIds.add(link.noteId);
        }
      }

      if (candidateIds === null) {
        const ranged = await this.storage.getNotesByDateRange(window.start, window.end);
        const unionIds = new Set<string>(ranged.map((n) => n.id));
        for (const id of placedNoteIds) unionIds.add(id);
        if (placedNoteIds.size === 0) {
          loadedNotes = new Map(ranged.map((n) => [n.id, n]));
        }
        intersect([...unionIds]);
        if (candidateIds!.size === 0) return { candidateIds: [], loadedNotes };
      } else {
        const currentIds: string[] = [...(candidateIds as Set<string>)];
        if (!loadedNotes) {
          const fetched = await this.storage.getNotesByIds(currentIds);
          loadedNotes = new Map(fetched.map((n) => [n.id, n]));
        }
        const inWindow: string[] = [];
        for (const id of currentIds) {
          const note = loadedNotes.get(id);
          if (!note) continue;
          const targetDate = note.date ?? note.createdAt;
          if ((targetDate >= window.start && targetDate <= window.end) || placedNoteIds.has(id)) {
            inWindow.push(id);
          }
        }
        intersect(inWindow);
        if (candidateIds!.size === 0) return { candidateIds: [], loadedNotes };
      }
    }

    if (candidateIds === null) {
      const all = await this.storage.getAllNotes();
      loadedNotes = new Map(all.map((n) => [n.id, n]));
      intersect(all.map((n) => n.id));
      if (candidateIds!.size === 0) return { candidateIds: [], loadedNotes };
    }

    const survivingIds: string[] = [...(candidateIds as Set<string>)];
    const searchLower = query?.search?.toLowerCase();
    if ((query?.kind || searchLower) && !loadedNotes) {
      const fetched = await this.storage.getNotesByIds(survivingIds);
      loadedNotes = new Map(fetched.map((n) => [n.id, n]));
    }

    if (loadedNotes && (query?.kind || searchLower)) {
      const filtered: string[] = [];
      for (const id of survivingIds) {
        const note = loadedNotes.get(id);
        if (!note) continue;
        if (query?.kind && (note.type ?? 'note') !== query.kind) continue;
        if (
          searchLower &&
          !note.title.toLowerCase().includes(searchLower) &&
          !note.rawContent.toLowerCase().includes(searchLower)
        ) {
          continue;
        }
        filtered.push(id);
      }
      return { candidateIds: filtered, loadedNotes };
    }

    return { candidateIds: survivingIds, loadedNotes };
  }

  async getRecords(query?: SelectiveRecordQuery): Promise<HistoryRecord[]> {
    const window = entryDateWindow(query);
    const selection: DomainPredicate[] = [];
    if (window) selection.push({ field: 'date', start: window.start, end: window.end });
    for (const tag of query?.tags ?? []) selection.push({ field: 'tags', values: [tag] });
    if (query?.kind && query.kind !== 'note') selection.push({ field: 'type', values: [query.kind] });
    if (query?.search?.trim()) selection.push({ field: 'text', value: query.search.trim() });

    const requestedDetail = query?.projection === 'history-detail' || query?.projection === 'workbench';
    const requiresDetailJoin = Boolean(query?.journalDate) || Boolean(query?.tags?.length) || Boolean(window);
    const useSummaryPlan = !requestedDetail && !requiresDetailJoin;
    const canBoundWindow = query?.limit !== undefined && !query?.journalDate && query?.kind !== 'note' && !window && !(query?.tags?.length);
    const boundedLimit = canBoundWindow ? (query?.offset ?? 0) + query.limit! : undefined;

    const domainQuery: DomainQuery = {
      plan: useSummaryPlan ? 'notes' : 'detail',
      ...(selection.length ? { selection } : {}),
      order: [{ field: 'date', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }],
      ...(boundedLimit !== undefined ? { offset: 0, limit: boundedLimit } : {}),
    };
    const result = await this.storage.queryDomain(domainQuery);
    let entries: HistoryRecord[];
    if (result?.plan === 'detail') {
      entries = result.rows.map(entryFromDomainRow);
    } else if (result?.plan === 'notes') {
      entries = result.rows.map(entryFromNoteSummary);
    } else {
      const selected = await this.selectLocalCandidateIds(query, window);
      let candidateIds = selected.candidateIds;
      let loadedNotes = selected.loadedNotes;
      if (candidateIds.length === 0) return [];
      if (boundedLimit !== undefined && candidateIds.length > boundedLimit) {
        if (!loadedNotes) {
          const notes = await this.storage.getNotesByIds(candidateIds);
          loadedNotes = new Map(notes.map((n) => [n.id, n]));
        }
        const byId = loadedNotes;
        candidateIds = [...candidateIds]
          .sort((a, b) => {
            const na = byId.get(a);
            const nb = byId.get(b);
            return (nb?.date ?? nb?.createdAt ?? 0) - (na?.date ?? na?.createdAt ?? 0);
          })
          .slice(0, boundedLimit);
      }
      if (useSummaryPlan) {
        const notes = loadedNotes
          ? candidateIds.map((id) => loadedNotes!.get(id)).filter((n): n is Note => n !== undefined)
          : await this.storage.getNotesByIds(candidateIds);
        entries = notes.map(entryFromNoteSummary);
      } else {
        const bundles = await this.storage.getDetailBatches(candidateIds);
        entries = [...bundles.values()].map(entryFromDomainRow);
      }
    }
    entries = entries.filter(entry =>
      (!window || (entry.targetDate >= window.start && entry.targetDate <= window.end))
      && (query?.tags ?? []).every(tag => entry.tags.includes(tag)));
    return entries.sort((a, b) => b.targetDate - a.targetDate);
  }

  async getRecord(id: string): Promise<HistoryRecord | null> {
    const note = await this.resolveStoredNote(id);
    if (!note) return null;
    const bundle = (await this.storage.getDetailBatches([note.id])).get(note.id);
    if (!bundle) return null;
    const entry = entryFromDomainRow(bundle);
    const latest = (await this.storage.getSessionsForNote(note.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
    const sections = parseDocumentSections(note.rawContent, BLOCK_OPTIONS).map(section => {
      const block = Object.values(note.blocks as Record<string, NoteBlock>).find(b => b.from === section.from && b.to === section.to);
      if (!block) return section;
      return {
        ...section,
        id: block.id,
        version: block.version,
        scriptBlock: section.scriptBlock ? { ...section.scriptBlock, id: block.id, version: block.version } : undefined,
      };
    });
    return {
      ...entry,
      sections,
      results: latest ? sessionToPayload(latest, await this.storage.getEventsByResult(latest.id)) : undefined,
    };
  }

  async cloneRecord(sourceId: string, targetDate?: number): Promise<HistoryRecord> {
    const source = await this.getRecord(sourceId);
    if (!source) throw new Error(`Source entry not found: ${sourceId}`);
    const date = targetDate ?? Date.now();
    return this.saveRecord({
      title: source.title,
      rawContent: source.rawContent,
      tags: source.tags,
      targetDate: date,
      journalDate: localDateKey(new Date(date)),
      type: 'journal',
      sourceId: source.id,
    });
  }

  async saveRecord(entry: NoteSaveInput): Promise<HistoryRecord> {
    const now = Date.now();
    let noteId = entry.id ?? (entry.type === 'playground' ? formatPlaygroundTimestampId(now) : uuidv7());
    if (!entry.id && entry.type === 'playground') {
      const base = noteId;
      for (let suffix = 1; await this.storage.getNote(noteId); suffix++) {
        if (suffix > 100) throw new Error('Unable to allocate unique playground timestamp ID');
        noteId = `${base}-${suffix}`;
      }
    }
    await this.storage.withTransaction([...MUTATION_STORES], async scoped => {
      const previous = await scoped.getNote(noteId);
      const expected = previous ? entry.sourceRevision : 0;
      if (expected === undefined) {
        throw new NotePersistenceError('STALE_SOURCE', `An expected source revision is required for ${noteId}`);
      }
      const scopedPersistence = new IndexedDBNotePersistence(scoped);
      const tags = await scopedPersistence.changedManualTags(noteId, entry.tags);
      const blocks = entry.blocks ?? (
        previous?.rawContent === entry.rawContent
          ? previous.blocks
          : reconcileNoteBlocks(entry.rawContent, { ...BLOCK_OPTIONS, sourceRevision: expected || 1 })
      );
      await scoped.saveNoteSource({
        noteId,
        rawContent: entry.rawContent,
        blocks,
        expectedSourceRevision: expected,
        createdAt: entry.createdAt,
        metadata: {
          title: entry.title,
          type: entry.type,
          tags,
          targetDate: entry.targetDate,
          sourceId: entry.sourceId,
        },
      });
      await scopedPersistence.updateRelationships(noteId, { journalDate: entry.journalDate, slug: entry.slug });
      await scopedPersistence.updateTags(noteId, entry.rawContent, tags);
      const written = await scoped.getNote(noteId);
      if (written) {
        const seedOrigin = entry.seedOrigin ?? previous?.seedOrigin ?? 'user';
        const isLandingOrProperty =
          written.id.startsWith('notebook/') ||
          written.id.startsWith('effort/') ||
          written.id.startsWith('equipment/') ||
          written.id.startsWith('t/');
        if (seedOrigin === 'seed' || written.feedOrigin === 'feed' || isLandingOrProperty) {
          if (written.seedOrigin !== seedOrigin) {
            await scoped.saveNote({ ...written, seedOrigin });
          }
        } else {
          const hasExplicitTargets = entry.notebookIds !== undefined || entry.notebookId !== undefined;
          const requestedTargets = [...(entry.notebookIds ?? []), ...(entry.notebookId ? [entry.notebookId] : [])]
            .map((raw) => raw.trim())
            .filter(Boolean)
            .map((raw) => toNotebookId(raw))
            .filter((nb) => !isSystemReadOnlyNotebook(nb));
          const priorTargets = hasExplicitTargets && entry.notebookIds !== undefined
            ? []
            : (previous?.notebookIds ?? [])
                .filter(Boolean)
                .map((raw) => toNotebookId(raw))
                .filter((nb) => !isSystemReadOnlyNotebook(nb));
          const merged = Array.from(
            new Set<NotebookId>([
              ...(written.type === 'playground' || written.sourceId === 'playground'
                ? (['notebook/playground'] as const)
                : []),
              ...priorTargets,
              ...requestedTargets,
            ]),
          );
          const primaryUserNb = merged.find((nb) => nb !== 'notebook/playground') ?? merged[0];
          const nextNote: Note = {
            ...written,
            seedOrigin,
            notebookIds: merged,
            ...(primaryUserNb ? { notebookId: primaryUserNb } : { notebookId: undefined }),
          };
          if (!rowsEqual(written, nextNote)) {
            await scoped.saveNote(nextNote);
          }
          try {
            const linkStore = scoped.storage.readwrite('notebook_links');
            const existingLinks = await linkStore.getAllFromIndex('by-note', noteId);
            const mergedSet = new Set(merged);
            const existingByNb = new Set(
              existingLinks
                .filter((l) => l.targetKind === 'note' && l.targetId === noteId)
                .map((l) => toNotebookId(l.notebookId)),
            );
            if (entry.notebookIds !== undefined) {
              for (const link of existingLinks) {
                if (link.targetKind === 'note' && link.targetId === noteId && !mergedSet.has(toNotebookId(link.notebookId))) {
                  await linkStore.delete(link.id);
                }
              }
            }
            const linkNow = Date.now();
            const toPut = merged
              .filter((nbId) => !existingByNb.has(nbId))
              .map((nbId) => ({
                id: makeNotebookLinkId(nbId, 'note' as const, noteId),
                notebookId: nbId,
                targetKind: 'note' as const,
                targetId: noteId,
                noteId,
                createdAt: linkNow,
              }));
            if (toPut.length > 0) await linkStore.putMany(toPut);
          } catch {
            // Optional store/index on minimal storage mocks
          }
        }
      }
    });
    const saved = await this.getRecord(noteId);
    if (!saved) throw new Error(`Saved note disappeared: ${noteId}`);
    return saved;
  }

  async updateRecord(id: string, patch: NoteRecordPatch): Promise<HistoryRecord> {
    const resolved = await this.resolveStoredNote(id);
    if (!resolved) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${id}`);
    await this.storage.withTransaction([...MUTATION_STORES], async scoped => {
      const note = await scoped.getNote(resolved.id);
      if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${resolved.id}`);
      const rawContent = patch.rawContent ?? note.rawContent;
      const mustProtectImmutableExternalSource =
        note.id.startsWith('remote:') ||
        note.retention === 'indexed' ||
        note.retention === 'session-pinned' ||
        note.retention === 'cached' ||
        note.feedOrigin === 'feed' ||
        note.upstreamStatus === 'unsubscribed' ||
        note.upstreamStatus === 'removed';
      if (patch.rawContent !== undefined && patch.rawContent !== note.rawContent && mustProtectImmutableExternalSource) {
        const ownership = resolveNoteOwnership(note, notebookOriginOfItem(note), notebookOfItem(note));
        if (!ownership.editable) {
          throw new Error(`Note '${note.id}' is read-only (${ownership.kind}) and cannot be edited directly.`);
        }
      }
      if (patch.rawContent !== undefined && patch.expectedSourceRevision === undefined) {
        throw new NotePersistenceError('STALE_SOURCE', `An expected source revision is required for ${note.id}`);
      }
      const expected = patch.expectedSourceRevision ?? note.sourceRevision;
      const scopedPersistence = new IndexedDBNotePersistence(scoped);
      const tags = patch.tags === undefined ? undefined : await scopedPersistence.changedManualTags(note.id, patch.tags);
      const blocks = patch.blocks ?? (
        rawContent === note.rawContent
          ? note.blocks
          : reconcileNoteBlocks(rawContent, { ...BLOCK_OPTIONS, sourceRevision: expected })
      );
      await scoped.saveNoteSource({
        noteId: note.id,
        rawContent,
        blocks,
        expectedSourceRevision: expected,
        metadata: {
          title: patch.title,
          type: patch.type,
          tags,
          targetDate: patch.targetDate,
          sourceId: patch.sourceId,
        },
      });
      await scopedPersistence.updateRelationships(note.id, patch);
      if (patch.tags !== undefined || rawContent !== note.rawContent) {
        await scopedPersistence.updateTags(note.id, rawContent, tags);
      }
      if (patch.results) {
        if (!patch.blockId || !patch.blockVersion) throw new Error('Recording a result requires its frozen block pin');
        const revision = await scoped.getBlockRevision(note.id, patch.blockId, patch.blockVersion);
        if (!revision || revision.kind !== 'wod') {
          throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Pinned workout revision not found');
        }
        const previous = patch.resultId ? await scoped.getSessionById(patch.resultId) : undefined;
        if (previous && (previous.noteId !== note.id || previous.blockId !== patch.blockId || previous.blockVersion !== patch.blockVersion)) {
          throw new NotePersistenceError('RESULT_NOTE_MISMATCH', 'Cannot replace a Session pin');
        }
        const data = patch.results;
        const session: Session = {
          ...previous,
          id: patch.resultId ?? uuidv7(),
          noteId: note.id,
          blockId: patch.blockId,
          blockVersion: patch.blockVersion,
          blockContentId: patch.blockContentId,
          noteSourceRevision: previous?.noteSourceRevision ?? note.sourceRevision,
          sessionDate:
            patch.sessionDate ??
            previous?.sessionDate ??
            localDateKey(new Date(data.endTime ?? data.startTime ?? previous?.createdAt ?? Date.now())),
          ...(patch.scheduleItemId ?? previous?.scheduleItemId
            ? { scheduleItemId: patch.scheduleItemId ?? previous?.scheduleItemId }
            : {}),
          origin: patch.origin ?? previous?.origin,
          startTime: data.startTime,
          endTime: data.endTime,
          duration: data.duration ?? 0,
          completed: data.completed,
          roundsCompleted: data.roundsCompleted,
          totalRounds: data.totalRounds,
          repsCompleted: data.repsCompleted,
          status: 'completed',
          createdAt: previous?.createdAt ?? data.endTime ?? Date.now(),
        };
        await scoped.saveSession(session);
        if (session.scheduleItemId) {
          try {
            const schedStore = scoped.storage.readwrite('schedule_items');
            const sched = await schedStore.get(session.scheduleItemId);
            if (sched && sched.status !== 'completed') {
              await schedStore.put({ ...sched, status: 'completed', updatedAt: session.endTime || Date.now() });
            }
          } catch {
            // Optional store on mocks
          }
        }
        if (data.logs?.length) {
          const identity = {
            noteId: session.noteId,
            resultId: session.id,
            blockId: session.blockId,
            blockVersion: session.blockVersion,
            blockContentId: session.blockContentId,
            origin: session.origin,
            pageId: session.pageId,
            workoutTimestamp: session.endTime,
          };
          await scoped.appendEvents(toEventRows(data.logs, identity));
          await scoped.finalizeSummaries(session.id, toSummaryEventRows(data.logs, identity));
        }
      }
    });
    const updated = await this.getRecord(resolved.id);
    if (!updated) throw new Error(`Saved note disappeared: ${resolved.id}`);
    return updated;
  }

  async addRecordPlacement(id: string, target: PageTarget): Promise<HistoryRecord> {
    const noteId = await this.resolvePlacementNoteId(id);
    const page = await this.resolveTargetPage(noteId, target);
    await this.storage.addNoteToPage(noteId, page.id);
    const updated = await this.getRecord(noteId);
    if (!updated) throw new Error(`Saved note disappeared: ${noteId}`);
    return updated;
  }

  async removeRecordPlacement(id: string, pageId: string): Promise<HistoryRecord> {
    const noteId = await this.resolvePlacementNoteId(id);
    await this.storage.removeNoteFromPage(noteId, pageId);
    const updated = await this.getRecord(noteId);
    if (!updated) throw new Error(`Saved note disappeared: ${noteId}`);
    return updated;
  }

  async moveRecordPlacement(id: string, fromPageId: string, target: PageTarget): Promise<HistoryRecord> {
    const noteId = await this.resolvePlacementNoteId(id);
    const page = await this.resolveTargetPage(noteId, target);
    await this.storage.moveNoteBetweenPages(noteId, fromPageId, page.id);
    const updated = await this.getRecord(noteId);
    if (!updated) throw new Error(`Saved note disappeared: ${noteId}`);
    return updated;
  }

  async getPageRecords(slug: string): Promise<HistoryRecord[]> {
    const page = await this.storage.getPageBySlug(slug);
    if (!page) return [];
    const placements = await this.storage.getPagePlacements(page.id);
    if (placements.length === 0) return [];
    const bundles = await this.storage.getDetailBatches(placements.map(placement => placement.noteId));
    return placements
      .map(placement => bundles.get(placement.noteId))
      .filter((bundle): bundle is DomainDetail => bundle !== undefined)
      .map(entryFromDomainRow);
  }

  async deleteRecord(id: string): Promise<void> {
    await this.storage.deleteNote(id);
  }

  async getAttachments(noteId: string): Promise<Attachment[]> {
    return this.storage.getAttachmentsForNote(noteId);
  }

  async saveAttachment(noteId: string, attachment: AttachmentCreateInput): Promise<Attachment> {
    const full: Attachment = { ...attachment, id: attachment.id ?? uuidv7(), noteId, createdAt: Date.now() };
    await this.storage.saveAttachment(full);
    return full;
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.storage.deleteAttachment(id);
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private async updateRelationships(noteId: string, patch: Pick<NoteRecordPatch, 'journalDate' | 'slug'>): Promise<void> {
    for (const flavor of ['journalDate', 'slug'] as const) {
      const value = patch[flavor];
      if (value === undefined) continue;
      if (!value) {
        for (const link of await this.storage.getNotePages(noteId)) {
          const page = await this.storage.getPage(link.pageId);
          const matches = flavor === 'journalDate' ? !!page?.date : !!page?.slug && !page.date;
          if (matches) await this.storage.removeNoteFromPage(noteId, link.pageId);
        }
        continue;
      }
      const destination = await this.resolvePage(noteId, flavor, value);
      await this.storage.addNoteToPage(noteId, destination.id);
    }
  }

  private async resolvePage(noteId: string, flavor: 'journalDate' | 'slug', value: string): Promise<Page> {
    if (flavor === 'journalDate') return this.storage.getOrCreatePageForDate(value);
    const existing = await this.storage.getPageBySlug(value);
    if (existing) return existing;
    const page: Page = { id: uuidv7(), slug: value, title: (await this.storage.getNote(noteId))?.title, createdAt: Date.now() };
    await this.storage.savePage(page);
    return page;
  }

  private async resolveTargetPage(noteId: string, target: PageTarget): Promise<Page> {
    if (target.date) return this.storage.getOrCreatePageForDate(target.date);
    if (target.slug) return this.resolvePage(noteId, 'slug', target.slug);
    throw new Error('A placement target needs a date or a slug');
  }

  private async resolvePlacementNoteId(id: string): Promise<string> {
    const rawId = id.startsWith('playground/') ? id.slice('playground/'.length) : id;
    const note = await this.storage.getNote(id) ?? (rawId !== id ? await this.storage.getNote(rawId) : undefined);
    if (!note) throw new NotePersistenceError('NOTE_NOT_FOUND', `Note not found: ${id}`);
    return note.id;
  }

  private async resolveStoredNote(id: string): Promise<Note | undefined> {
    const rawId = id.startsWith('playground/') ? id.slice('playground/'.length) : id;
    return await this.storage.getNote(id)
      ?? (rawId !== id ? await this.storage.getNote(rawId) : undefined)
      ?? await this.storage.getNoteBySlug(id)
      ?? (rawId !== id ? await this.storage.getNoteBySlug(rawId) : undefined);
  }

  private async changedManualTags(noteId: string, supplied: string[]): Promise<string[] | undefined> {
    const current = (await this.storage.getTagsForNote(noteId)).map(tag => tag.label).sort();
    const next = [...new Set(supplied.map(tag => tag.trim()).filter(Boolean))].sort();
    return current.length === next.length && current.every((tag, index) => tag === next[index]) ? undefined : next;
  }

  private async updateTags(noteId: string, rawContent: string, manual?: string[]): Promise<void> {
    const knownTypes = (await this.storage.getAllTagTypes()).map(type => type.name);
    const declared = parseDocumentSections(rawContent, BLOCK_OPTIONS)
      .filter(section => section.type === 'frontmatter')
      .flatMap(section => extractTypedFrontmatterTags(section.displayContent, knownTypes));
    const base = manual ?? (await this.storage.getNote(noteId))?.tags ?? [];
    await this.storage.setNoteTags(noteId, [...base, ...declared.map(tag => tag.type ? tag : tag.label)]);
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
