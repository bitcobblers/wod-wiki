import { describe, it, expect } from 'bun:test';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { captureMetricCorrection } from './captureMetricCorrection';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import type { EventRecord, Session } from '@/types/storage';
import { NotePersistenceError } from '@/services/persistence/types';

const T0 = 1_700_000_000_000;
const source = '```time:crossfit\n21 Deadlift 60kg\n```';
const result: Session = { id: 'result-1', noteId: 'note-1', blockId: 'workout-1', blockVersion: 1, blockContentId: 'bc-test', origin: 'journal', startTime: T0, endTime: T0 + 60_000, duration: 60_000, completed: true, createdAt: T0 + 60_000 };

function segmentEvent(id = `${result.id}:0`): EventRecord {
  return { id, resultId: result.id, noteId: result.noteId, blockId: result.blockId, blockVersion: result.blockVersion, timestamp: T0, grain: 'event', outputType: 'segment',
    timeSpan: { started: T0, ended: T0 + 30_000 },
    metrics: [
      { type: 'rep', value: 21, image: '21', origin: 'parser' },
      { type: 'effort', value: 'Deadlift', image: 'Deadlift', origin: 'parser' },
      { type: 'elapsed', value: 30_000, origin: 'runtime' },
      { type: 'weight', value: 60, image: '60kg', origin: 'parser' },
    ],
    sourceBlockKey: 'block-1', stackLevel: 0, sourceStatementId: 3,
    metricTemporal: [
      { temporalKind: 'instant', instant: T0 },
      { temporalKind: 'instant', instant: T0 },
      { temporalKind: 'instant', instant: T0 },
      { temporalKind: 'instant', instant: T0 },
    ] };
}

async function harness() {
  const memory = new InMemoryStorage();
  const storage = new StorageService(memory);
  const persistence = new IndexedDBNotePersistence(storage);
  await persistence.saveNote({ noteId: result.noteId, rawContent: source, blocks: reconcileNoteBlocks(source, { sourceRevision: 1, createId: () => result.blockId }), expectedSourceRevision: 0, metadata: { title: 'Correct' } });
  await memory.readwrite('sessions').put(result);
  await storage.appendEvents([segmentEvent()]);
  return { storage, persistence };
}

const correct = (deps: { storage: StorageService; persistence: IndexedDBNotePersistence }, value: number, blockKey = 'block-1') =>
  captureMetricCorrection({ resultId: result.id, occurrence: { blockKey, sourceStatementId: 3, stackLevel: 0 }, metric: { type: MetricType.Rep, value, image: String(value) } }, deps);

function userRep(metrics: EventRecord['metrics']) {
  return metrics.find((m) => m.type === MetricType.Rep && m.origin === 'user');
}

describe('captureMetricCorrection', () => {
  it('returns not-found for an absent Session and for an unknown occurrence', async () => {
    const { storage, persistence } = await harness();
    expect(await captureMetricCorrection({ resultId: 'missing-id', occurrence: { blockKey: 'block-1' }, metric: { type: MetricType.Rep, value: 17, image: '17' } }, { storage, persistence })).toBe('not-found');
    expect(await correct({ storage, persistence }, 17, 'block-unknown')).toBe('not-found');
    const events = await storage.getEventsByResult(result.id);
    expect(events).toHaveLength(1); // no session-anchored fallback row appeared
    expect(userRep(events[0].metrics)).toBeUndefined();
  });

  it('rewrites the exact segment row in place — one row, user rep wins, others retained', async () => {
    const { storage, persistence } = await harness();
    expect(await correct({ storage, persistence }, 17)).toBe('captured');
    // Rederive re-stores engine Tier-2 analytics outputs as extra event-grain
    // rows (outputType 'analytics') — valid derived output. The corrected
    // occurrence itself must be exactly ONE segment row.
    const events = await storage.getEventsByResult(result.id);
    const segments = events.filter((row) => row.outputType === 'segment');
    expect(segments).toHaveLength(1); // same segment, no appended double-count row
    expect(segments[0].grain).toBe('event');
    expect(segments[0].id).toBe(`${result.id}:0`);
    expect(segments[0].timestamp).toBe(T0); // occurrence time unchanged
    expect(userRep(segments[0].metrics)).toMatchObject({ value: 17, origin: 'user' });
    // planned target + non-rep metrics survive untouched
    expect(segments[0].metrics.filter((m) => m.type === MetricType.Rep)).toHaveLength(2);
    expect(segments[0].metrics.find((m) => m.type === 'weight')).toMatchObject({ value: 60, origin: 'parser' });
    expect(segments[0].metrics.find((m) => m.type === 'elapsed')).toMatchObject({ value: 30_000, origin: 'runtime' });
    expect(segments[0].metrics.find((m) => m.type === 'effort')).toMatchObject({ value: 'Deadlift' });
    // derived analytics rows project the ownership winner, never planned+actual
    const numericRepValues = events
      .flatMap((row) => row.metrics)
      .filter((m) => m.type === MetricType.Rep && m.origin === 'user')
      .map((m) => m.value);
    expect(numericRepValues).toEqual([17]);
    // summary rederived from the corrected row
    const summaries = events.filter((row) => row.grain === 'summary');
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('keeps metricTemporal parallel to metrics after a correction', async () => {
    const { storage, persistence } = await harness();
    await correct({ storage, persistence }, 17);
    const [row] = (await storage.getEventsByResult(result.id)).filter((row) => row.grain === 'event');
    expect(row.metricTemporal).toHaveLength(row.metrics.length);
  });

  it('converges repeated corrections on the same row — explicit zero included', async () => {
    const { storage, persistence } = await harness();
    await correct({ storage, persistence }, 15);
    await correct({ storage, persistence }, 0);
    const events = await storage.getEventsByResult(result.id);
    // user-origin rep lives only on the one segment row — analytics/summary
    // rows carry derived origins, so the user winner is never duplicated
    const reps = events.flatMap((row) => row.metrics).filter((m) => m.type === MetricType.Rep && m.origin === 'user');
    expect(reps).toHaveLength(1);
    expect(reps[0].value).toBe(0); // explicit zero is a real count, not unknown
    expect(events.filter((row) => row.outputType === 'segment')).toHaveLength(1);
  });

  it('rejects stale unknown occurrences without a last-segment fallback and validates domains', async () => {
    const { storage, persistence } = await harness();
    // a stale blockKey must never fall back to ANY existing segment (the
    // second row below would be the "last segment" a fallback would wrongly pick)
    await storage.appendEvents([segmentEvent(`${result.id}:1`)]);
    expect(await correct({ storage, persistence }, 17, 'block-9')).toBe('not-found');
    await expect(captureMetricCorrection({ resultId: result.id, occurrence: { blockKey: 'block-1' }, metric: { type: MetricType.Rep, value: -1, image: '-1' } }, { storage, persistence })).rejects.toThrow(RangeError);
    await expect(captureMetricCorrection({ resultId: result.id, occurrence: { blockKey: 'block-1' }, metric: { type: MetricType.Rep, value: 1.5, image: '1.5' } }, { storage, persistence })).rejects.toThrow(RangeError);
    await expect(captureMetricCorrection({ resultId: result.id, occurrence: { blockKey: 'block-1' }, metric: { type: MetricType.Distance, value: NaN, image: 'x' } }, { storage, persistence })).rejects.toThrow(RangeError);
  });

  it('retains the correction when its immutable revision cannot be replayed', async () => {
    const { storage } = await harness();
    class UnavailableReplay extends IndexedDBNotePersistence {
      override async rederiveResultAnalytics(): Promise<Session> {
        throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Pinned revision is unavailable');
      }
    }
    const persistence = new UnavailableReplay(storage);
    expect(await correct({ storage, persistence }, 17)).toBe('captured-no-rederive');
    expect(userRep((await storage.getEventsByResult(result.id))[0].metrics)).toMatchObject({ value: 17 });
  });
});
