/**
 * Workbench run persistence — bridges a live LanguageWorkbench run into the
 * playground storage plane: the run becomes a Session pinned to a persisted
 * wod block, and its outputs become event rows in the active database.
 *
 * No React, no storybook-only imports — reusable from stories, pages, or tests.
 */
import { parseDocumentSections } from '@bitcobblers/wod-wiki-core';
import type { ScriptBlock } from '@bitcobblers/wod-wiki-core';
import { toStoredOutputStatement, type IOutputStatement } from '@/components/Editor/types';
import { v7 as uuidv7 } from 'uuid';
import { IndexedDBContentProvider } from '@/services/content/IndexedDBContentProvider';
import { captureRun } from '@/services/runCapture';
import { playgroundRecorder } from '@/services/resultRecorder';
import { storageService, whenStorageReady } from '@/services/storage';
import type { Sessions } from '@/components/Editor/types';
import type { NoteBlock } from '@/types/storage';

/** Identity of the note a workbench run belongs to. */
export interface WorkbenchRunContext {
  /** Note id in the active database (created on first save, updated after). */
  noteId: string;
  /** Display title stored on the note. */
  title: string;
  /** Full markdown note text at capture time. */
  rawContent: string;
}

/** A run pinned to a persisted wod block, ready to collect outputs. */
export interface PreparedWorkbenchRun {
  noteId: string;
  blockId: string;
  resultId: string;
  startedAt: number;
}

/** Stable, filesystem-safe note id for a story key (same key → same note). */
export function workbenchRunNoteId(storyKey: string): string {
  const slug = storyKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `workbench-${slug}`;
}

/**
 * The persisted wod block for the Nth runnable fence. The Nth time/log
 * section in document order maps to the Nth persisted wod block; the
 * section's from/to offsets must match the block's span.
 */
function resolvePersistedWodBlock(blocks: Record<string, NoteBlock>, rawContent: string, blockIndex: number): { block: NoteBlock; fence: ScriptBlock } {
  const fence = parseDocumentSections(rawContent)
    .filter((section) => section.type === 'time' || section.type === 'log')[blockIndex];
  if (!fence) throw new Error(`Workout fence ${blockIndex + 1} was not found in the note.`);
  if (!fence.scriptBlock) throw new Error('The workout fence cannot be read.');
  const block = Object.values(blocks)
    .filter((candidate) => candidate.kind === 'wod')
    .sort((a, b) => a.from - b.from)
    .find((candidate) => candidate.from === fence.from && candidate.to === fence.to);
  if (!block) throw new Error('The workout fence is not pinned in the saved note.');
  return { block, fence: fence.scriptBlock };
}

/**
 * Save or update the note in the active database through the content
 * provider, resolve the persisted wod block for `blockIndex`, and start the
 * in-progress Session (origin "playground").
 */
export async function prepareWorkbenchRun(ctx: WorkbenchRunContext, blockIndex: number): Promise<PreparedWorkbenchRun> {
  await whenStorageReady();
  const startedAt = Date.now();
  const provider = new IndexedDBContentProvider(storageService);
  const existing = await storageService.getNote(ctx.noteId);
  const saved = await provider.saveRecord({
    id: ctx.noteId,
    title: ctx.title,
    rawContent: ctx.rawContent,
    tags: [],
    targetDate: startedAt,
    type: 'playground',
    ...(existing ? { sourceRevision: existing.sourceRevision } : {}),
  });
  const { block, fence } = resolvePersistedWodBlock(saved.blocks ?? {}, ctx.rawContent, blockIndex);
  const resultId = uuidv7();
  await captureRun(
    {
      noteId: saved.id,
      rawContent: saved.rawContent,
      blocks: saved.blocks ?? {},
      expectedSourceRevision: saved.sourceRevision ?? 0,
    },
    {
      id: block.id,
      contentId: fence.contentId,
      dialect: fence.dialect,
      sport: fence.sport,
      startLine: fence.startLine,
      endLine: fence.endLine,
      content: fence.content,
      state: 'idle',
      version: fence.version,
      createdAt: fence.createdAt,
      widgetIds: {},
    },
    resultId,
    'playground',
  );
  return { noteId: saved.id, blockId: block.id, resultId, startedAt };
}

/**
 * Finalise the session: store the run payload and append the event rows for
 * the collected outputs.
 */
export async function completeWorkbenchRun(
  prepared: PreparedWorkbenchRun,
  outputs: IOutputStatement[],
  completed: boolean,
  timing: { startTime: number; endTime: number; duration: number },
): Promise<void> {
  const data: Sessions = {
    startTime: timing.startTime,
    endTime: timing.endTime,
    duration: timing.duration,
    completed,
    logs: outputs.map(toStoredOutputStatement),
  };
  await playgroundRecorder.record({
    blockId: prepared.blockId,
    noteId: prepared.noteId,
    resultId: prepared.resultId,
    data,
    createdAt: timing.endTime,
    origin: 'playground',
  });
}
