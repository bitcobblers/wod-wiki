import {
  createParser,
  ensurePinnedExternalWorkout,
  getNoteNotebooks,
  parseRemoteNoteId,
  resolveScopedPropertyCatalog,
  type RemoteWorkoutResolution,
  type ResolvedScopedCatalog,
} from '@bitcobblers/wod-wiki-engine';
import {
  bundledEfforts,
  createReferenceIndex,
  InMemoryEffortRegistry,
} from '@bitcobblers/wod-wiki-lang';
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import { loadRemoteRecordDetail, lookupRemoteRecord } from '@/services/feed/feedCatalog';
import { notePersistence, type INotePersistence, type SaveNoteInput } from '@/services/persistence';
import { storageService } from '@/services/storage';
import { getTagIndex } from '@/services/tags/tagCatalogue';
import type { BlockRevision, Note, ResultOrigin, Session } from '@/types/storage';
import type { ScriptBlock } from '@/components/Editor/types';
import { useActiveRunStore } from '@/stores/activeRunStore';

const scopedCatalogByBlock = new WeakMap<ScriptBlock, ResolvedScopedCatalog>();

export function setBlockScopedCatalog(
  block: ScriptBlock,
  catalog: ResolvedScopedCatalog | undefined,
): void {
  if (catalog) {
    scopedCatalogByBlock.set(block, catalog);
  }
}

export function getBlockScopedCatalog(block: ScriptBlock): ResolvedScopedCatalog | undefined {
  return scopedCatalogByBlock.get(block);
}

export function buildEffectiveReferenceIndex(
  scopedCatalog: Pick<ResolvedScopedCatalog, 'efforts' | 'equipment'>,
) {
  const registry = new InMemoryEffortRegistry();
  registry.seed(bundledEfforts);
  registry.seed(scopedCatalog.efforts);
  return createReferenceIndex({
    efforts: registry.list(),
    equipment: scopedCatalog.equipment,
  });
}

export interface CapturedRun {
  note: Note;
  session: Session;
  /** Shared immutable storage revision, never a duplicate Session source snapshot. */
  revision: BlockRevision;
  block: ScriptBlock;
}

export function blockFromRevision(
  revision: BlockRevision,
  scopedCatalog?: Pick<ResolvedScopedCatalog, 'tagIndex' | 'referenceIndex'> &
    Partial<Pick<ResolvedScopedCatalog, 'efforts' | 'equipment'>>,
): ScriptBlock {
  if (revision.kind !== 'wod' || !revision.dialect) throw new Error('The saved revision is not a workout.');
  const section = parseDocumentSections(revision.rawContent).find(section => section.type === revision.dialect);
  if (!section?.scriptBlock) throw new Error('The saved workout fence cannot be read.');
  const content = section.scriptBlock.content;
  const effectiveReferences =
    scopedCatalog?.efforts !== undefined
      ? buildEffectiveReferenceIndex({
          efforts: scopedCatalog.efforts,
          equipment: scopedCatalog.equipment ?? [],
        })
      : scopedCatalog?.referenceIndex;
  const effectiveTags =
    scopedCatalog && ('tags' in scopedCatalog ? (scopedCatalog as ResolvedScopedCatalog).tags.length > 0 : true)
      ? scopedCatalog.tagIndex
      : getTagIndex();
  return {
    id: revision.blockId,
    content,
    dialect: revision.dialect,
    sport: revision.sport,
    statements: createParser({
      tags: effectiveTags,
      ...(effectiveReferences ? { references: effectiveReferences } : {}),
    }).read(content, revision.sport).statements,
    startLine: 0,
    endLine: revision.rawContent.split('\n').length - 1,
    version: revision.version,
    state: 'idle',
    widgetIds: {},
    createdAt: revision.savedAt,
  };
}

export async function captureRun(
  input: SaveNoteInput,
  block: ScriptBlock,
  resultId: string,
  origin?: ResultOrigin,
  persistence: INotePersistence = notePersistence,
  options?: { deferPersist?: boolean; scheduleItemId?: string; sessionDate?: string },
): Promise<CapturedRun> {
  const startedAt = Date.now();
  useActiveRunStore.getState().setActiveSessionMeta(resultId, input.noteId);
  const captured = await persistence.startSession(input, {
    id: resultId,
    noteId: input.noteId,
    blockId: block.id,
    blockContentId: block.contentId,
    origin: origin ?? 'journal',
    ...(options?.scheduleItemId ? { scheduleItemId: options.scheduleItemId } : {}),
    ...(options?.sessionDate ? { sessionDate: options.sessionDate } : {}),
    startTime: startedAt,
    endTime: startedAt,
    duration: 0,
    completed: false,
    status: 'in-progress',
    createdAt: startedAt,
  }, options);
  if (captured.note.id !== input.noteId) {
    useActiveRunStore.getState().setActiveSessionMeta(resultId, captured.note.id);
  }
  const backingStorage =
    (persistence as { persistenceStorage?: { storage?: typeof storageService.storage } })
      .persistenceStorage?.storage ?? storageService.storage;
  const linkedNotebooks = await getNoteNotebooks(backingStorage, captured.note.id).catch(() => []);
  const noteForScope =
    linkedNotebooks.length > 0
      ? { ...captured.note, notebookIds: linkedNotebooks }
      : captured.note;
  const scopedCatalog = await resolveScopedPropertyCatalog(backingStorage, {
    note: noteForScope,
  }).catch(() => undefined);
  const hasScopedEntities = Boolean(
    scopedCatalog &&
      (scopedCatalog.efforts.length > 0 ||
        scopedCatalog.equipment.length > 0 ||
        scopedCatalog.tags.length > 0 ||
        scopedCatalog.tagTypes.length > 0),
  );
  const capturedBlock = blockFromRevision(
    captured.revision,
    hasScopedEntities ? scopedCatalog : undefined,
  );
  if (hasScopedEntities && scopedCatalog) {
    setBlockScopedCatalog(capturedBlock, scopedCatalog);
  }
  return { ...captured, block: capturedBlock };
}

export async function captureStoredRun(
  noteId: string,
  block: ScriptBlock,
  resultId: string,
  origin?: ResultOrigin,
  options?: {
    resolveRemoteWorkout?: (id: string) => Promise<RemoteWorkoutResolution | undefined>;
    deferPersist?: boolean;
    scheduleItemId?: string;
    sessionDate?: string;
  },
): Promise<CapturedRun> {
  const parsedRemote = parseRemoteNoteId(noteId);
  const lookupId = parsedRemote.isRemote ? parsedRemote.uuid : noteId;
  let note =
    (await storageService.getNote(lookupId)) ??
    (lookupId !== noteId ? await storageService.getNote(noteId) : undefined);

  if (!note && parsedRemote.isRemote) {
    const resolved = options?.resolveRemoteWorkout
      ? await options.resolveRemoteWorkout(noteId)
      : await loadRemoteRecordDetail(noteId).catch(() => undefined);
    const meta = lookupRemoteRecord(noteId);
    const remotePayload: RemoteWorkoutResolution | undefined = resolved
      ? 'content' in resolved && 'path' in resolved
        ? {
            row: resolved,
            canonicalNoteId: meta?.record.uuid ?? parsedRemote.uuid,
            remoteNoteId: noteId,
            feedId: meta?.feedId ?? parsedRemote.feedId,
            notebookSlug: meta?.notebookSlug,
            record: meta?.record,
          }
        : resolved
      : undefined;
    if (remotePayload) {
      const pinned = await ensurePinnedExternalWorkout(storageService.storage, {
        noteId,
        remotePayload,
      });
      note = pinned.note;
    }
  }

  if (!note) throw new Error('The note is unavailable. Save the note before starting a workout.');
  return captureRun(
    { noteId: note.id, rawContent: note.rawContent, blocks: note.blocks, expectedSourceRevision: note.sourceRevision },
    block,
    resultId,
    origin,
    notePersistence,
    {
      ...(options?.deferPersist !== undefined ? { deferPersist: options.deferPersist } : {}),
      ...(options?.scheduleItemId ? { scheduleItemId: options.scheduleItemId } : {}),
      ...(options?.sessionDate ? { sessionDate: options.sessionDate } : {}),
    },
  );
}
