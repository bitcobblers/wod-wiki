import { describe, it, expect } from 'bun:test';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { StorageService } from '@/services/storage/StorageService';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
import { captureSessionRpe } from './captureSessionRpe';
import { MetricType } from '@bitcobblers/wod-wiki-engine';
import type { EventRecord, Session } from '@/types/storage';
import { NotePersistenceError } from '@/services/persistence/types';

const T0 = 1_700_000_000_000;
const source = '```time:crossfit\n21 Deadlift 60kg\n```';
const result: Session = { id: 'result-1', noteId: 'note-1', blockId: 'workout-1', blockVersion: 1, blockContentId: 'bc-test', origin: 'journal', startTime: T0, endTime: T0 + 60_000, duration: 60_000, completed: true, createdAt: T0 + 60_000 };

function segmentEvent(id = `${result.id}:0`): EventRecord {
  return { id, resultId: result.id, noteId: result.noteId, blockId: result.blockId, blockVersion: result.blockVersion, timestamp: T0, grain: 'event', outputType: 'segment', metrics: [
    { type: 'rep', value: 21, image: '21', origin: 'runtime' },
    { type: 'effort', value: 'Deadlift', image: 'Deadlift', origin: 'parser' },
    { type: 'elapsed', value: 60_000, origin: 'runtime' },
  ], sourceBlockKey: 'block-1', stackLevel: 0 };
}

async function harness() {
  const memory = new InMemoryStorage();
  const storage = new StorageService(memory);
  const persistence = new IndexedDBNotePersistence(storage);
  await persistence.saveNote({ noteId: result.noteId, rawContent: source, blocks: reconcileNoteBlocks(source, { sourceRevision: 1, createId: () => result.blockId }), expectedSourceRevision: 0, metadata: { title: 'RPE' } });
  await memory.readwrite('sessions').put(result);
  await storage.appendEvents([segmentEvent()]);
  return { storage, persistence };
}

function userRatings(events: EventRecord[]) {
  return events.filter(row => row.grain === 'event' && row.outputType === 'segment' && row.metrics.some(metric => metric.type === MetricType.SessionRPE && metric.origin === 'user'));
}

describe('captureSessionRpe', () => {
  it('returns not-found for an absent Session', async () => {
    const { storage, persistence } = await harness();
    expect(await captureSessionRpe('missing-id', 7, { storage, persistence })).toBe('not-found');
  });

  it('appends a pinned user rating and replays after Note deletion without modifying Session', async () => {
    const { storage, persistence } = await harness();
    await persistence.deleteNote(result.noteId);
    expect(await captureSessionRpe(result.id, 8, { storage, persistence })).toBe('captured');
    const events = await storage.getEventsByResult(result.id);
    expect(userRatings(events)).toHaveLength(1);
    expect(userRatings(events)[0]).toMatchObject({ blockId: result.blockId, blockVersion: 1, metrics: [{ type: MetricType.SessionRPE, value: 8, origin: 'user', image: 'rpe: 8' }] });
    expect(events.some(event => event.grain === 'summary')).toBe(true);
    expect(await storage.getSessionById(result.id)).toEqual(result);
  });

  it('replaces a prior user rating without duplicate events', async () => {
    const { storage, persistence } = await harness();
    await captureSessionRpe(result.id, 5, { storage, persistence });
    await captureSessionRpe(result.id, 9, { storage, persistence });
    const ratings = userRatings(await storage.getEventsByResult(result.id));
    expect(ratings).toHaveLength(1);
    expect(ratings[0].metrics[0].value).toBe(9);
  });

  it('preserves non-user metric origins', async () => {
    const { storage, persistence } = await harness();
    const event = segmentEvent('analyzed-rating');
    event.metrics.push({ type: MetricType.SessionRPE, value: 5, origin: 'analyzed', image: 'rpe: 5' });
    await storage.appendEvents([event]);
    await captureSessionRpe(result.id, 9, { storage, persistence });
    const events = await storage.getEventsByResult(result.id);
    expect(userRatings(events)[0].metrics[0].value).toBe(9);
    expect(events.flatMap(row => row.metrics).some(metric => metric.type === MetricType.SessionRPE && metric.origin === 'analyzed')).toBe(true);
  });

  it('retains the valid pin and rating when its immutable revision cannot be loaded for replay', async () => {
    const { storage } = await harness();
    class UnavailableReplay extends IndexedDBNotePersistence {
      override async rederiveResultAnalytics(): Promise<Session> {
        throw new NotePersistenceError('BLOCK_REVISION_NOT_FOUND', 'Pinned revision is unavailable');
      }
    }
    const persistence = new UnavailableReplay(storage);
    expect(await captureSessionRpe(result.id, 7, { storage, persistence })).toBe('captured-no-rederive');
    expect(userRatings(await storage.getEventsByResult(result.id))[0].metrics[0].value).toBe(7);
    expect(await storage.getSessionById(result.id)).toEqual(result);
  });
});
