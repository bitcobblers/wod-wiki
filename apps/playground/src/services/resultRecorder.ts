import { notePersistence, type INotePersistence } from '@/services/persistence';
import { whenStorageReady } from '@/services/storage';
import type { ResultOrigin, Session } from '@/types/storage';
import type { Sessions, ScriptBlock } from '@/components/Editor/types';
import { appError } from '@/lib/log';

export type ResultWriter = Pick<INotePersistence, 'finishSession'>;

export interface RecordResultInput {
  runBlock?: ScriptBlock | Pick<ScriptBlock, 'id' | 'contentId'> | null;
  blockId: string;
  noteId: string;
  resultId: string;
  blockVersion?: number;
  blockContentId?: string;
  blockContent?: string;
  blockDialect?: string;
  blockSport?: string;
  data: Sessions;
  createdAt: number;
  origin?: ResultOrigin;
  scheduleItemId?: string;
  sessionDate?: string;
}

export interface ResultRecorder {
  record(input: RecordResultInput): Promise<Session>;
}

type ResultSavedListener = (result: Session) => void;
const resultSavedListeners = new Set<ResultSavedListener>();

export function onResultSaved(listener: ResultSavedListener): () => void {
  resultSavedListeners.add(listener);
  return () => { resultSavedListeners.delete(listener); };
}

export function notifyResultSaved(result: Session): void {
  for (const listener of resultSavedListeners) {
    try {
      listener(result);
    } catch (err) {
      appError('resultRecorder', 'error in listener:', err);
    }
  }
}

export function createResultRecorder(writer: ResultWriter): ResultRecorder {
  return {
    async record({ resultId, noteId, blockId, runBlock, blockVersion, blockContentId, blockContent, blockDialect, blockSport, data, createdAt, origin, scheduleItemId, sessionDate }) {
      const resolvedBlockVersion =
        blockVersion ??
        (runBlock && 'version' in runBlock && typeof runBlock.version === 'number' ? runBlock.version : undefined);
      const resolvedBlockContentId = blockContentId ?? runBlock?.contentId;
      const resolvedBlockContent =
        blockContent ??
        (runBlock && 'content' in runBlock && typeof runBlock.content === 'string' ? runBlock.content : undefined);
      const resolvedBlockDialect =
        blockDialect ??
        (runBlock && 'dialect' in runBlock && typeof runBlock.dialect === 'string' ? runBlock.dialect : undefined);
      const resolvedBlockSport =
        blockSport ??
        (runBlock && 'sport' in runBlock && typeof runBlock.sport === 'string' ? runBlock.sport : undefined);
      const fallback = noteId && blockId
        ? {
            noteId,
            blockId,
            ...(resolvedBlockVersion !== undefined ? { blockVersion: resolvedBlockVersion } : {}),
            ...(resolvedBlockContentId ? { blockContentId: resolvedBlockContentId } : {}),
            ...(resolvedBlockContent !== undefined ? { blockContent: resolvedBlockContent } : {}),
            ...(resolvedBlockDialect ? { blockDialect: resolvedBlockDialect } : {}),
            ...(resolvedBlockSport ? { blockSport: resolvedBlockSport } : {}),
            ...(origin ? { origin } : {}),
            ...(scheduleItemId ? { scheduleItemId } : {}),
            ...(sessionDate ? { sessionDate } : {}),
          }
        : undefined;
      const result = await writer.finishSession(resultId, data, createdAt, fallback);
      clearPendingUnloadResult(resultId);
      setPendingUnloadState(resultId, { status: 'saved' });
      notifyResultSaved(result);
      return result;
    },
  };
}

export const playgroundRecorder = createResultRecorder(notePersistence);

// ── Hard-unload durability (WW-012 / WW-120) ────────────────────────────
// A real browser reload kills the async IndexedDB completion write mid-flight
// (document teardown), leaving the sessions store empty. Halting runs park
// their partial result here SYNCHRONOUSLY before the async write starts; the
// next page load flushes it into IndexedDB.

export interface PendingUnloadResult {
  resultId: string;
  noteId?: string;
  blockId?: string;
  blockVersion?: number;
  blockContentId?: string;
  blockContent?: string;
  blockDialect?: string;
  blockSport?: string;
  data: Sessions;
  createdAt: number;
  origin?: ResultOrigin;
  scheduleItemId?: string;
  sessionDate?: string;
}

export type PendingUnloadStatus = 'idle' | 'pending' | 'flushing' | 'saved' | 'failed';

export interface PendingUnloadState {
  status: PendingUnloadStatus;
  error?: string;
}

const unloadFlushStates = new Map<string, PendingUnloadState>();
const unloadFlushListeners = new Set<() => void>();

function notifyPendingUnloadStateChange(): void {
  for (const listener of unloadFlushListeners) {
    try {
      listener();
    } catch (err) {
      appError('resultRecorder', 'error in unload state listener:', err);
    }
  }
}

function setPendingUnloadState(sessionId: string, state: PendingUnloadState | null): void {
  if (state === null) {
    if (!unloadFlushStates.has(sessionId)) return;
    unloadFlushStates.delete(sessionId);
  } else {
    unloadFlushStates.set(sessionId, state);
  }
  notifyPendingUnloadStateChange();
}

export function onPendingUnloadStateChange(listener: () => void): () => void {
  unloadFlushListeners.add(listener);
  return () => { unloadFlushListeners.delete(listener); };
}

export function getPendingUnloadState(sessionId: string): PendingUnloadState {
  const pendingMap = readPendingUnloadResults();
  const hasStaged = sessionId in pendingMap;
  const tracked = unloadFlushStates.get(sessionId);
  if (tracked) {
    if ((tracked.status === 'pending' || tracked.status === 'failed') && !hasStaged) {
      unloadFlushStates.delete(sessionId);
      return { status: 'idle' };
    }
    return tracked;
  }
  return hasStaged ? { status: 'pending' } : { status: 'idle' };
}

const PENDING_UNLOAD_KEY = 'wodwiki:pending-halted-sessions:v1';

function reviveSessionDates(data: Sessions): Sessions {
  const reviveDate = (v: unknown): Date =>
    v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : new Date();
  const reviveOutput = (o: Record<string, unknown>) => ({
    ...o,
    ...(o.timestamp !== undefined ? { timestamp: reviveDate(o.timestamp) } : {}),
    ...(Array.isArray(o.metrics)
      ? {
          metrics: (o.metrics as Array<Record<string, unknown>>).map((m) =>
            m && typeof m === 'object' && m.timestamp !== undefined
              ? { ...m, timestamp: reviveDate(m.timestamp) }
              : m,
          ),
        }
      : {}),
    ...(o.timeSpan && typeof o.timeSpan === 'object'
      ? {
          timeSpan: {
            ...(o.timeSpan as Record<string, unknown>),
            ...((o.timeSpan as Record<string, unknown>).startTime !== undefined
              ? { startTime: reviveDate((o.timeSpan as Record<string, unknown>).startTime) }
              : {}),
            ...((o.timeSpan as Record<string, unknown>).endTime !== undefined
              ? { endTime: reviveDate((o.timeSpan as Record<string, unknown>).endTime) }
              : {}),
          },
        }
      : {}),
  });
  return {
    ...data,
    ...(Array.isArray(data.logs) ? { logs: data.logs.map((l) => reviveOutput(l as unknown as Record<string, unknown>)) as unknown as Sessions['logs'] } : {}),
  };
}

function readPendingUnloadResults(): Record<string, PendingUnloadResult> {
  try {
    const raw = localStorage.getItem(PENDING_UNLOAD_KEY);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const parsed: Record<string, PendingUnloadResult> = {};
    for (const [resultId, entry] of Object.entries(value)) {
      const candidate = entry as Partial<PendingUnloadResult>;
      if (candidate && typeof candidate.resultId === 'string' && candidate.data && typeof candidate.createdAt === 'number') {
        parsed[resultId] = {
          ...candidate,
          resultId,
          data: reviveSessionDates(candidate.data),
        } as PendingUnloadResult;
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function writePendingUnloadResults(map: Record<string, PendingUnloadResult>): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(PENDING_UNLOAD_KEY);
    else localStorage.setItem(PENDING_UNLOAD_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode): staging is best-effort.
  }
}

export function stagePendingUnloadResult(input: PendingUnloadResult): void {
  const map = readPendingUnloadResults();
  map[input.resultId] = input;
  writePendingUnloadResults(map);
  setPendingUnloadState(input.resultId, { status: 'pending' });
}

export function clearPendingUnloadResult(sessionId: string): void {
  const map = readPendingUnloadResults();
  if (sessionId in map) {
    delete map[sessionId];
    writePendingUnloadResults(map);
  }
  const tracked = unloadFlushStates.get(sessionId);
  if (tracked && tracked.status !== 'saved') {
    setPendingUnloadState(sessionId, null);
  }
}

let flushUnloadPromise: Promise<void> | null = null;

/** Commit every staged unload result into IndexedDB. Deduped single-flight;
 *  entries are cleared only when persistence succeeds so failures are never
 *  silently dropped and can be retried or surfaced to the user. */
export function flushPendingUnloadResults(recorder: ResultRecorder = playgroundRecorder): Promise<void> {
  flushUnloadPromise ??= (async () => {
    const pending = readPendingUnloadResults();
    if (Object.keys(pending).length === 0) return;
    if (recorder === playgroundRecorder) {
      await whenStorageReady().catch(() => undefined);
    }
    for (const entry of Object.values(pending)) {
      setPendingUnloadState(entry.resultId, { status: 'flushing' });
      try {
        await recorder.record({
          resultId: entry.resultId,
          noteId: entry.noteId ?? '',
          blockId: entry.blockId ?? '',
          ...(entry.blockVersion !== undefined ? { blockVersion: entry.blockVersion } : {}),
          ...(entry.blockContentId ? { blockContentId: entry.blockContentId } : {}),
          ...(entry.blockContent !== undefined ? { blockContent: entry.blockContent } : {}),
          ...(entry.blockDialect ? { blockDialect: entry.blockDialect } : {}),
          ...(entry.blockSport ? { blockSport: entry.blockSport } : {}),
          data: entry.data,
          createdAt: entry.createdAt,
          ...(entry.origin ? { origin: entry.origin } : {}),
          ...(entry.scheduleItemId ? { scheduleItemId: entry.scheduleItemId } : {}),
          ...(entry.sessionDate ? { sessionDate: entry.sessionDate } : {}),
        });
        clearPendingUnloadResult(entry.resultId);
        setPendingUnloadState(entry.resultId, { status: 'saved' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appError('resultRecorder', 'pending unload flush failed:', err);
        setPendingUnloadState(entry.resultId, { status: 'failed', error: msg });
      }
    }
  })().finally(() => { flushUnloadPromise = null; });
  return flushUnloadPromise;
}

// On load, commit anything a killed page left staged before routes read.
if (typeof window !== 'undefined') void flushPendingUnloadResults();
