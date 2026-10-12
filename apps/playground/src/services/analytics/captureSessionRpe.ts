/**
 * captureSessionRpe — post-workout RPE write path (#735).
 *
 * Appends a user-origin SessionRPE metric to a stored workout result's logs,
 * saves the result, and re-derives analytics so Tier-2 projections (e.g.
 * SessionLoad) reflect the user's authoritative rating.
 */
import type { StoredOutputStatement } from '@/components/Editor/types';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { storageService } from '@/services/storage';
import { NotePersistenceError } from '@/services/persistence/types';
import type { StorageService } from '@/services/storage';
import type { EventRecord } from '@/types/storage';

export type CaptureSessionRpeOutcome = 'captured' | 'captured-no-rederive' | 'not-found';

/**
 * Read the user-captured session RPE from a result's logs — the value written
 * by {@link captureSessionRpe}. Returns undefined when the run was never rated.
 */
export function readSessionRpe(logs: StoredOutputStatement[] | undefined): number | undefined {
  if (!logs) return undefined;
  for (const statement of logs) {
    if (statement.outputType !== 'segment') continue;
    const metric = statement.metrics.find(
      (m) => m.type === MetricType.SessionRPE && m.origin === 'user',
    );
    if (metric && typeof metric.value === 'number') return metric.value;
  }
  return undefined;
}

export interface CaptureSessionRpeDeps {
  storage?: StorageService;
  persistence?: IndexedDBNotePersistence;
}

export async function captureSessionRpe(
  resultId: string,
  rpe: number,
  deps: CaptureSessionRpeDeps = {},
): Promise<CaptureSessionRpeOutcome> {
  const storage = deps.storage ?? storageService;
  const persistence = deps.persistence ?? new IndexedDBNotePersistence(storage);

  const result = await storage.getSessionById(resultId);
  if (!result) {
    return 'not-found';
  }

  const events = storage.getEventsByResult ? await storage.getEventsByResult(resultId) : [];

  // Strip any existing user-origin SessionRPE event rows so a re-answer replaces
  // rather than duplicates.
  const userRpeRows = events.filter(
    (row) =>
      row.grain === 'event' &&
      row.metrics.some((m) => m.type === MetricType.SessionRPE && m.origin === 'user'),
  );
  if (userRpeRows.length > 0 && storage.deleteEvents) {
    await storage.deleteEvents(userRpeRows.map((row) => row.id));
  }

  // Re-fetch events after deletion so the anchor resolves to a non-RPE segment.
  const currentEvents = storage.getEventsByResult ? await storage.getEventsByResult(resultId) : [];

  // Anchor the new event to the last real segment row so the review grid keeps
  // a coherent block association, falling back to a synthetic session key.
  let sourceBlockKey = 'session';
  let stackLevel = 0;
  const segmentRows = currentEvents.filter((row) => row.outputType === 'segment');
  if (segmentRows.length > 0) {
    const lastSegment = segmentRows[segmentRows.length - 1]!;
    sourceBlockKey = lastSegment.sourceBlockKey ?? 'session';
    stackLevel = lastSegment.stackLevel ?? 0;
  }

  const ended = result.endTime ?? result.startTime ?? Date.now();

  const rpeEvent: EventRecord = {
    id: `${resultId}:rpe:${Date.now()}`,
    resultId,
    noteId: result.noteId,
    blockId: result.blockId,
    blockVersion: result.blockVersion,
    blockContentId: result.blockContentId,
    pageId: result.pageId,
    origin: 'user',
    timestamp: ended,
    grain: 'event',
    outputType: 'segment',
    metrics: [
      {
        type: MetricType.SessionRPE,
        value: rpe,
        origin: 'user',
        image: `rpe: ${rpe}`,
      },
    ],
    sourceBlockKey,
    stackLevel,
  };

  if (storage.appendEvents) {
    await storage.appendEvents([rpeEvent]);
  }

  try {
    await persistence.rederiveResultAnalytics(resultId);
    return 'captured';
  } catch (err) {
    if (err instanceof NotePersistenceError && err.code === 'BLOCK_REVISION_NOT_FOUND') {
      return 'captured-no-rederive';
    }
    throw err;
  }
}
