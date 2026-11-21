import {
  buildNoteProvenance,
  ensurePinnedExternalWorkout,
  parseRemoteNoteId,
  resolveNoteOwnership,
  type ExternalWorkoutPayload,
  type Note,
  type RemoteWorkoutResolution,
} from '@bitcobblers/wod-wiki-engine';
import { notebookOfItem, notebookOriginOfItem } from '@bitcobblers/wod-wiki-wql';
import type { HistoryRecord } from '@/types/history';
import { normalizeNoteTitle } from '@/lib/noteTitle';
import { loadRemoteRecordDetail, lookupRemoteRecord } from '@/services/feed/feedCatalog';
import { storageService } from '@/services/storage';
import { formatDateKey } from './dateUtils';
import { journalNotes } from './journalNotes';

export interface CreateJournalNoteFromWorkoutOptions {
  workoutName: string;
  category: string;
  sourceNoteId?: string;
  sourceNoteLabel?: string;
  sourceNotePath?: string;
  wodContent: string;
  date?: Date;
  wrapInWod?: boolean;
  resolveRemoteWorkout?: (noteId: string) => Promise<RemoteWorkoutResolution | undefined>;
}

function noteToHistoryRecord(note: Note, journalDate: string, now: number): HistoryRecord {
  return {
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.createdAt,
    targetDate: note.date ?? now,
    journalDate,
    rawContent: note.rawContent,
    sourceRevision: note.sourceRevision,
    blocks: note.blocks,
    tags: note.tags ?? [],
    schemaVersion: 1,
    type: note.type ?? 'note',
    sourceId: note.sourceId,
    notebookId: note.notebookId,
    notebookIds: note.notebookIds,
    provenance: note.provenance,
    seedOrigin: note.seedOrigin,
  };
}

function buildWrappedMarkdown(workoutName: string, wodContent: string, wrapInWod: boolean): string {
  const lines = [`# ${workoutName}`, ''];
  if (wrapInWod) {
    lines.push('```time', wodContent.trimEnd(), '```');
  } else {
    lines.push(wodContent.trimEnd());
  }
  lines.push('');
  return lines.join('\n');
}

function deriveNotebookSourceTargets(
  sourceNoteId?: string,
  sourceNotePath?: string,
): { sourceIds: string[]; pathSuffixes: string[] } {
  const sourceIds: string[] = [];
  const pathSuffixes: string[] = [];

  if (sourceNoteId?.startsWith('notebook/')) {
    const rel = sourceNoteId.slice('notebook/'.length);
    if (rel) {
      sourceIds.push(`notebook:${rel}`);
      pathSuffixes.push(`markdown/notebooks/${rel}.md`);
    }
  }
  if (sourceNotePath) {
    sourceIds.push(sourceNotePath);
    pathSuffixes.push(sourceNotePath);
    const cleaned = sourceNotePath.split('#')[0]?.split('?')[0] ?? '';
    if (cleaned.startsWith('/notebook/')) {
      const rel = cleaned
        .slice('/notebook/'.length)
        .split('/')
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        })
        .join('/');
      if (rel) {
        sourceIds.push(`notebook:${rel}`);
        pathSuffixes.push(`markdown/notebooks/${rel}.md`);
      }
    }
  }

  return { sourceIds, pathSuffixes };
}

export async function createJournalNoteFromWorkout({
  workoutName,
  category,
  sourceNoteId,
  sourceNotePath,
  wodContent,
  date,
  wrapInWod = true,
  resolveRemoteWorkout,
}: CreateJournalNoteFromWorkoutOptions): Promise<HistoryRecord> {
  const now = date ? date.getTime() : Date.now();
  const journalDate = formatDateKey(date ?? new Date());
  const resolvedSourcePath = sourceNotePath?.trim() || `/notebook/${encodeURIComponent(category)}`;
  const parsedRemote = sourceNoteId ? parseRemoteNoteId(sourceNoteId) : ({ isRemote: false } as const);
  const directLookupId = parsedRemote.isRemote ? parsedRemote.uuid : sourceNoteId;

  let upstream = directLookupId
    ? await storageService.getNote(directLookupId).catch(() => undefined)
    : undefined;
  if (!upstream && sourceNoteId && sourceNoteId !== directLookupId) {
    upstream = await storageService.getNote(sourceNoteId).catch(() => undefined);
  }
  if (!upstream && (sourceNoteId || sourceNotePath)) {
    const { sourceIds, pathSuffixes } = deriveNotebookSourceTargets(sourceNoteId, sourceNotePath);
    if (sourceIds.length > 0 || pathSuffixes.length > 0) {
      const all = await storageService.getAllNotes().catch(() => []);
      upstream = all.find(
        (n) =>
          (n.sourcePath && pathSuffixes.includes(n.sourcePath)) ||
          (n.sourceId && sourceIds.includes(n.sourceId)),
      );
    }
  }

  if (upstream) {
    const ownership = resolveNoteOwnership(
      upstream,
      notebookOriginOfItem(upstream),
      notebookOfItem(upstream),
    );
    if (ownership.kind !== 'user') {
      const pinned = await ensurePinnedExternalWorkout(storageService.storage, {
        noteId: upstream.id,
        now,
      });
      return noteToHistoryRecord(pinned.note, journalDate, now);
    }

    const sourceNb = notebookOfItem(upstream) ?? (category ? `notebook/${category}` : undefined);
    const created = await journalNotes.create({
      journalDate,
      title: normalizeNoteTitle(workoutName || upstream.title),
      rawContent: upstream.rawContent,
      tags: upstream.tags,
      sourceId: upstream.id,
      type: 'journal',
    });
    const stored = await storageService.getNote(created.id);
    if (stored) {
      const provenance = buildNoteProvenance(upstream, sourceNb, now);
      await storageService.saveNote({
        ...stored,
        notebookIds: ['notebook/journal'],
        provenance,
      });
      return {
        ...created,
        rawContent: upstream.rawContent,
        sourceId: upstream.id,
        notebookIds: ['notebook/journal'],
        provenance,
      };
    }
    return created;
  }

  if (parsedRemote.isRemote && sourceNoteId) {
    const meta = lookupRemoteRecord(sourceNoteId);
    const fetched = resolveRemoteWorkout
      ? await resolveRemoteWorkout(sourceNoteId)
      : await loadRemoteRecordDetail(sourceNoteId).catch(() => undefined);

    let remotePayload: RemoteWorkoutResolution | undefined;
    if (fetched) {
      remotePayload =
        'content' in fetched && 'path' in fetched && !('rawContent' in fetched)
          ? {
              row: fetched,
              canonicalNoteId: meta?.record.uuid ?? parsedRemote.uuid,
              remoteNoteId: sourceNoteId,
              feedId: meta?.feedId ?? parsedRemote.feedId,
              notebookSlug: meta?.notebookSlug,
              record: meta?.record,
            }
          : fetched;
    } else if (wodContent.trim()) {
      const fallbackSlug = meta?.notebookSlug ?? (category || undefined);
      const payload: ExternalWorkoutPayload = {
        id: parsedRemote.uuid,
        title: normalizeNoteTitle(workoutName),
        rawContent: buildWrappedMarkdown(workoutName, wodContent, wrapInWod),
        feedSourceId: meta?.feedId ?? parsedRemote.feedId,
        ...(fallbackSlug ? { sourceNotebookId: `notebook/${fallbackSlug}` } : {}),
        ...(meta?.record.path ? { sourcePath: meta.record.path } : {}),
      };
      remotePayload = payload;
    }

    if (!remotePayload) {
      throw new Error(`No runnable workout block in this entry (${sourceNoteId}).`);
    }

    const pinned = await ensurePinnedExternalWorkout(storageService.storage, {
      noteId: sourceNoteId,
      remotePayload,
      now,
    });
    return noteToHistoryRecord(pinned.note, journalDate, now);
  }

  return journalNotes.create({
    journalDate,
    title: normalizeNoteTitle(workoutName),
    rawContent: buildWrappedMarkdown(workoutName, wodContent, wrapInWod),
    sourceId: resolvedSourcePath,
  });
}
