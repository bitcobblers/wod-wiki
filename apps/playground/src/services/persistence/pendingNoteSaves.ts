import type { NoteBlock } from '@/types/storage';
import { notePersistence } from './index';

export const pendingNoteSaves = new Map<string, Promise<unknown>>();

/**
 * Synchronous last-resort copies of dirty drafts: a hard unload can kill the
 * async IndexedDB save mid-write, so the latest draft is parked in
 * localStorage ('wodwiki:pending-note-saves:v1') and replayed on the next
 * page load.
 */
export interface StagedNoteSave {
  noteId: string;
  rawContent: string;
  blocks: Record<string, NoteBlock>;
  expectedSourceRevision: number;
  metadata?: { title?: string };
  noteType?: 'note' | 'playground' | 'journal';
  stagedAt: number;
}

const PENDING_NOTE_SAVES_KEY = 'wodwiki:pending-note-saves:v1';

export function readStagedNoteSaves(): Record<string, StagedNoteSave> {
  try {
    const raw = localStorage.getItem(PENDING_NOTE_SAVES_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const parsed: Record<string, StagedNoteSave> = {};
    for (const [noteId, entry] of Object.entries(value)) {
      const candidate = entry as Partial<StagedNoteSave>;
      if (
        candidate &&
        typeof candidate.noteId === 'string' &&
        typeof candidate.rawContent === 'string' &&
        candidate.blocks &&
        typeof candidate.expectedSourceRevision === 'number'
      ) {
        parsed[noteId] = { ...candidate, noteId, stagedAt: candidate.stagedAt ?? 0 } as StagedNoteSave;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeStagedNoteSaves(map: Record<string, StagedNoteSave>): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(PENDING_NOTE_SAVES_KEY);
    else localStorage.setItem(PENDING_NOTE_SAVES_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode): staging is best-effort.
  }
}

export function stageNoteSave(entry: StagedNoteSave): void {
  const map = readStagedNoteSaves();
  map[entry.noteId] = entry;
  writeStagedNoteSaves(map);
}

export function clearStagedNoteSave(noteId: string): void {
  const map = readStagedNoteSaves();
  if (!(noteId in map)) return;
  delete map[noteId];
  writeStagedNoteSaves(map);
}

let replayStagedPromise: Promise<void> | null = null;

/**
 * Commit every staged pagehide draft into IndexedDB. Deduped single-flight;
 * a staged entry whose revision already lost a race is dropped, not error'd.
 */
export function replayStagedNoteSaves(): Promise<void> {
  replayStagedPromise ??= (async () => {
    const staged = readStagedNoteSaves();
    for (const entry of Object.values(staged)) {
      try {
        await notePersistence.saveNote({
          noteId: entry.noteId,
          rawContent: entry.rawContent,
          blocks: entry.blocks,
          expectedSourceRevision: entry.expectedSourceRevision,
          ...(entry.metadata ? { metadata: entry.metadata } : {}),
          ...(entry.noteType ? { noteType: entry.noteType } : {}),
        });
      } catch {
        // A newer revision already landed in IndexedDB (or the note is gone):
        // the durable draft served its purpose — drop it.
      }
      clearStagedNoteSave(entry.noteId);
    }
  })().finally(() => {
    replayStagedPromise = null;
  });
  return replayStagedPromise;
}

export function waitForPendingNoteSave(noteId: string): Promise<void> {
  const active = [...pendingNoteSaves]
    .filter(([id]) => id === noteId)
    .map(([, promise]) => promise.then(() => undefined, () => undefined));
  return Promise.all([replayStagedNoteSaves(), ...active]).then(() => undefined);
}

export function waitForAllPendingNoteSaves(): Promise<void> {
  const pending = [...pendingNoteSaves.values()].map((promise) =>
    promise.then(() => undefined, () => undefined),
  );
  return Promise.all([replayStagedNoteSaves(), ...pending]).then(() => undefined);
}
