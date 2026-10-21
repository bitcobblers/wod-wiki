/**
 * captureMetricCorrection — durable per-occurrence user metric correction
 * (clock-command-board post-run value entry).
 *
 * Replaces one user-origin metric inside the EXACT segment EventRecord row
 * (matched by sourceBlockKey, plus optional sourceStatementId/stackLevel) in
 * a single events transaction. No second row is appended — eventsToStoredLogs
 * maps rows 1:1 to segments, so an appended correction row would double-count
 * totals. Every other metric on the row (planned target, elapsed, effort,
 * load) is retained; repeated corrections converge on the same row id, and
 * rederive preserves user-origin metrics (only 'analyzed' is stripped).
 */
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { storageService } from '@/services/storage';
import { NotePersistenceError } from '@/services/persistence/types';
import type { StorageService } from '@/services/storage';
import type { EventRecord } from '@/types/storage';

export interface MetricCorrectionOccurrence {
  /** Persisted segment identity — EventRecord.sourceBlockKey (block.key.toString()). */
  blockKey: string;
  sourceStatementId?: number;
  stackLevel?: number;
}

export interface MetricCorrectionMetric {
  type: MetricType;
  value: number;
  image: string;
}

export interface CaptureMetricCorrectionInput {
  resultId: string;
  occurrence: MetricCorrectionOccurrence;
  metric: MetricCorrectionMetric;
}

export interface CaptureMetricCorrectionDeps {
  storage?: StorageService;
  persistence?: IndexedDBNotePersistence;
}

export type CaptureMetricCorrectionOutcome = 'captured' | 'captured-no-rederive' | 'not-found';

export async function captureMetricCorrection(
  input: CaptureMetricCorrectionInput,
  deps: CaptureMetricCorrectionDeps = {},
): Promise<CaptureMetricCorrectionOutcome> {
  const { resultId, occurrence, metric } = input;
  if (!resultId || typeof resultId !== 'string') {
    throw new TypeError('captureMetricCorrection: resultId is required');
  }
  if (!occurrence?.blockKey || typeof occurrence.blockKey !== 'string') {
    throw new TypeError('captureMetricCorrection: occurrence.blockKey is required');
  }
  if (!metric || typeof metric.image !== 'string' || metric.image.length === 0) {
    throw new TypeError('captureMetricCorrection: metric.image is required');
  }
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
    throw new RangeError(`captureMetricCorrection: metric.value must be finite, got ${metric.value}`);
  }
  if (metric.type === MetricType.Rep
      && (!Number.isSafeInteger(metric.value) || metric.value < 0)) {
    throw new RangeError(`captureMetricCorrection: rep corrections must be nonnegative safe integers, got ${metric.value}`);
  }

  // Deps resolve lazily inside the call — cold e2e imports stay side-effect free.
  const storage = deps.storage ?? storageService;
  const persistence = deps.persistence ?? new IndexedDBNotePersistence(storage);

  const result = await storage.getSessionById(resultId);
  if (!result) {
    return 'not-found';
  }

  const captured = await storage.withTransaction(['events'], async (scoped) => {
    const events = await scoped.getEventsByResult(resultId);
    const candidates = events.filter((row) =>
      row.grain === 'event'
      && row.outputType === 'segment'
      && row.sourceBlockKey === occurrence.blockKey
      && (occurrence.sourceStatementId === undefined || row.sourceStatementId === occurrence.sourceStatementId)
      && (occurrence.stackLevel === undefined || row.stackLevel === occurrence.stackLevel));
    if (candidates.length === 0) {
      // No session-anchored fallback: a correction anchors to its exact
      // occurrence only; identity drift stays a retryable not-found.
      return 'not-found' as const;
    }
    if (candidates.length > 1) {
      throw new Error(
        `captureMetricCorrection: ambiguous occurrence ${occurrence.blockKey} in result ${resultId}`
        + ` — ${candidates.length} segments match; pass sourceStatementId/stackLevel`,
      );
    }

    const row = candidates[0];
    // Replace only prior user-authored metrics of this type on this exact
    // occurrence; everything else on the row is retained. An explicit 0 is a
    // real value and replaces like any other.
    const kept = row.metrics.filter((m) => !(m.origin === 'user' && m.type === metric.type));
    const metrics = [
      ...kept,
      { type: metric.type, value: metric.value, image: metric.image, origin: 'user' as const, timestamp: new Date() },
    ];
    // metricTemporal mirrors metrics 1:1 (toEventRows) — rebuild so fact
    // projection keeps every entry anchored to the segment's own instant.
    const instant = row.timeSpan?.started ?? row.timestamp;
    const next: EventRecord = {
      ...row,
      metrics,
      ...(row.metricTemporal
        ? { metricTemporal: metrics.map(() => ({ temporalKind: 'instant' as const, instant })) }
        : {}),
    };
    // put() overwrites the same row id — atomic with the read via the
    // enclosing transaction; a failure rolls the rewrite back.
    await scoped.appendEvents([next]);
    return 'captured' as const;
  });

  if (captured === 'not-found') {
    return 'not-found';
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
