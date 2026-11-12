import { notePersistence, type INotePersistence } from '@/services/persistence';
import type { ResultOrigin, Session } from '@/types/storage';
import type { Sessions, ScriptBlock } from '@/components/Editor/types';
import { appError } from '@/lib/log';

export type ResultWriter = Pick<INotePersistence, 'finishSession'>;

export interface RecordResultInput {
  runBlock?: ScriptBlock | Pick<ScriptBlock, 'id' | 'contentId'> | null;
  blockId: string;
  noteId: string;
  resultId: string;
  data: Sessions;
  createdAt: number;
  origin?: ResultOrigin;
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
    async record({ resultId, data, createdAt }) {
      const result = await writer.finishSession(resultId, data, createdAt);
      clearPendingUnloadResult(resultId);
      notifyResultSaved(result);
      return result;
    },
  };
}

export const playgroundRecorder = createResultRecorder(notePersistence);

// ── Hard-unload durability (WW-012) ─────────────────────────────────────
// A real browser reload kills the async IndexedDB completion write mid-flight
// (document teardown), leaving the sessions store empty. Halting runs park
// their partial result here SYNCHRONOUSLY before the async write starts; the
// next page load flushes it into IndexedDB.

export interface PendingUnloadResult {
  resultId: string;
  noteId?: string;
  blockId?: string;
  data: Sessions;
  createdAt: number;
  origin?: ResultOrigin;
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
    ...(Array.isArray(data.logs) ? { logs: data.logs.map((l) => reviveOutput(l as unknown as Record<string, unknown>)) as Sessions['logs'] } : {}),
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
}

export function clearPendingUnloadResult(sessionId: string): void {
  const map = readPendingUnloadResults();
  if (!(sessionId in map)) return;
  delete map[sessionId];
  writePendingUnloadResults(map);
}

let flushUnloadPromise: Promise<void> | null = null;

/** Commit every staged unload result into IndexedDB. Deduped single-flight;
 *  entries are dropped even when the write fails so they cannot poison
 *  later flushes. */
export function flushPendingUnloadResults(recorder: ResultRecorder = playgroundRecorder): Promise<void> {
  flushUnloadPromise ??= (async () => {
    const pending = readPendingUnloadResults();
    for (const entry of Object.values(pending)) {
      try {
        await recorder.record({
          resultId: entry.resultId,
          noteId: entry.noteId ?? '',
          blockId: entry.blockId ?? '',
          data: entry.data,
          createdAt: entry.createdAt,
          ...(entry.origin ? { origin: entry.origin } : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Session not found')) {
          appError('resultRecorder', 'pending unload flush failed:', err);
        }
      }
      clearPendingUnloadResult(entry.resultId);
    }
  })().finally(() => { flushUnloadPromise = null; });
  return flushUnloadPromise;
}

// On load, commit anything a killed page left staged before routes read.
if (typeof window !== 'undefined') void flushPendingUnloadResults();
