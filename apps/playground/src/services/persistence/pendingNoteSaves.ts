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

type ActiveDraftFlusher = () => Promise<boolean>;
const activeDraftFlushers = new Map<string, Set<ActiveDraftFlusher>>();

/**
 * Register a live editor draft so staged pagehide replays coordinate through
 * the mounted draft state instead of writing behind its back.
 */
export function registerActiveDraft(noteId: string, flushIfDirty: ActiveDraftFlusher): () => void {
  let set = activeDraftFlushers.get(noteId);
  if (!set) {
    set = new Set();
    activeDraftFlushers.set(noteId, set);
  }
  set.add(flushIfDirty);
  return () => {
    const current = activeDraftFlushers.get(noteId);
    if (!current) return;
    current.delete(flushIfDirty);
    if (current.size === 0) activeDraftFlushers.delete(noteId);
  };
}

let replayStagedPromise: Promise<void> | null = null;

/**
 * Commit every staged pagehide draft into IndexedDB. Deduped single-flight;
 * flushes any live dirty draft first so background reads never save behind its
 * back, and drops orphaned staged copies whose revision already lost a race.
 */
export function replayStagedNoteSaves(): Promise<void> {
  replayStagedPromise ??= (async () => {
    const staged = readStagedNoteSaves();
    for (const entry of Object.values(staged)) {
      const inFlight = pendingNoteSaves.get(entry.noteId);
      if (inFlight) {
        await inFlight.then(() => undefined, () => undefined);
      }
      const currentStaged = readStagedNoteSaves()[entry.noteId];
      if (!currentStaged) continue;

      const flushers = activeDraftFlushers.get(currentStaged.noteId);
      if (flushers && flushers.size > 0) {
        let handledByLiveDraft = false;
        for (const flushIfDirty of [...flushers]) {
          try {
            if (await flushIfDirty()) {
              handledByLiveDraft = true;
            }
          } catch {
            // The live draft owns the edit and surfaced the error; do not save
            // behind its back or drop its staged draft.
            handledByLiveDraft = true;
          }
        }
        if (handledByLiveDraft) continue;
      }

      const savePromise = notePersistence.saveNote({
        noteId: currentStaged.noteId,
        rawContent: currentStaged.rawContent,
        blocks: currentStaged.blocks,
        expectedSourceRevision: currentStaged.expectedSourceRevision,
        ...(currentStaged.metadata ? { metadata: currentStaged.metadata } : {}),
        ...(currentStaged.noteType ? { noteType: currentStaged.noteType } : {}),
      });
      pendingNoteSaves.set(currentStaged.noteId, savePromise);
      try {
        await savePromise;
      } catch {
        // A newer revision already landed in IndexedDB (or the note is gone):
        // the durable draft served its purpose — drop it.
      } finally {
        if (pendingNoteSaves.get(currentStaged.noteId) === savePromise) {
          pendingNoteSaves.delete(currentStaged.noteId);
        }
      }
      clearStagedNoteSave(currentStaged.noteId);
    }
  })().finally(() => {
    replayStagedPromise = null;
  });
  return replayStagedPromise;
}

export async function waitForPendingNoteSave(noteId: string): Promise<void> {
  const active = [...pendingNoteSaves]
    .filter(([id]) => id === noteId)
    .map(([, promise]) => promise.then(() => undefined, () => undefined));
  if (active.length > 0) {
    await Promise.all(active);
  }
  await replayStagedNoteSaves();
}

export async function waitForAllPendingNoteSaves(): Promise<void> {
  if (pendingNoteSaves.size > 0) {
    const pending = [...pendingNoteSaves.values()].map((promise) =>
      promise.then(() => undefined, () => undefined),
    );
    await Promise.all(pending);
  }
  await replayStagedNoteSaves();
}
