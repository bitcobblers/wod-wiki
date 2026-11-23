import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingUnloadResult,
  createResultRecorder,
  flushPendingUnloadResults,
  getPendingUnloadState,
  onResultSaved,
  stagePendingUnloadResult,
} from './resultRecorder';
import { IndexedDBNotePersistence } from './persistence/IndexedDBNotePersistence';
import { StorageService } from './storage/StorageService';
import { InMemoryStorage } from './storage/InMemoryStorage';
import type { Session } from '@/types/storage';
import type { Sessions } from '@/components/Editor/types';

const PENDING_UNLOAD_KEY = 'wodwiki:pending-halted-sessions:v1';
const pinned: Session = { id: 'run', noteId: 'deleted-note', blockId: 'second-occurrence', blockVersion: 2, startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: 1 };
const data: Sessions = { startTime: 1, endTime: 61_001, duration: 61_000, completed: true };

describe('result recorder', () => {
  beforeEach(() => {
    localStorage.removeItem(PENDING_UNLOAD_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(PENDING_UNLOAD_KEY);
  });

  it('finishes the persisted pin without reading latest source or a surviving Note', async () => {
    const calls: string[] = [];
    const recorder = createResultRecorder({ finishSession: async (id, outcome) => {
      calls.push(id);
      return { ...pinned, ...outcome };
    } });
    const saved = await recorder.record({ resultId: 'run', noteId: 'wrong-latest-note', blockId: 'wrong-current-block', data, createdAt: data.endTime });
    expect(calls).toEqual(['run']);
    expect(saved).toMatchObject({ noteId: 'deleted-note', blockId: 'second-occurrence', blockVersion: 2, completed: true });
  });

  it('notifies only after the pinned completion succeeds and exposes write errors', async () => {
    const notifications: Session[] = [];
    const unsubscribe = onResultSaved(session => notifications.push(session));
    const recorder = createResultRecorder({ finishSession: async () => { throw new Error('write conflict'); } });
    try {
      await expect(recorder.record({ resultId: 'run', noteId: pinned.noteId, blockId: pinned.blockId, data, createdAt: data.endTime })).rejects.toThrow('write conflict');
      expect(notifications).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('WW-120: flushPendingUnloadResults upserts a staged partial session into IndexedDBNotePersistence when no prior session row exists', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service);
    const note = await persistence.createNote({
      id: 'note-amrap',
      title: '20:00 AMRAP',
      rawContent: '```time\n20:00 AMRAP\n  5 Pullups\n```',
      targetDate: 1_000,
    });
    const blockId = Object.keys(note.blocks!)[0]!;
    const partial: Sessions = { startTime: 5_000, endTime: 20_000, duration: 15_000, completed: false, logs: [] };

    stagePendingUnloadResult({
      resultId: 'sess-unload-upsert',
      noteId: 'note-amrap',
      blockId,
      data: partial,
      createdAt: 20_000,
      origin: 'journal',
    });
    expect(getPendingUnloadState('sess-unload-upsert').status).toBe('pending');

    const recorder = createResultRecorder(persistence);
    await flushPendingUnloadResults(recorder);

    expect(getPendingUnloadState('sess-unload-upsert').status).toBe('saved');
    expect(localStorage.getItem(PENDING_UNLOAD_KEY)).toBeNull();
    const saved = await service.getSessionById('sess-unload-upsert');
    expect(saved).toMatchObject({
      id: 'sess-unload-upsert',
      noteId: 'note-amrap',
      blockId,
      duration: 15_000,
      completed: false,
      origin: 'journal',
    });
  });

  it('WW-120: flushPendingUnloadResults retains staged data and records failed state on error instead of dropping it', async () => {
    const partial: Sessions = { startTime: 10, endTime: 5_010, duration: 5_000, completed: false };
    stagePendingUnloadResult({
      resultId: 'sess-fail-retain',
      noteId: 'missing-note',
      blockId: 'b1',
      data: partial,
      createdAt: 5_010,
    });

    const failingRecorder = createResultRecorder({
      finishSession: async () => {
        throw new Error('Session not found: sess-fail-retain');
      },
    });
    await flushPendingUnloadResults(failingRecorder);

    // Must NOT drop staged data on failure
    expect(localStorage.getItem(PENDING_UNLOAD_KEY)).not.toBeNull();
    expect(getPendingUnloadState('sess-fail-retain')).toEqual({
      status: 'failed',
      error: 'Session not found: sess-fail-retain',
    });

    // Retry with a succeeding recorder commits and clears the staged entry
    const succeedingRecorder = createResultRecorder({
      finishSession: async (id, outcome) => ({ ...pinned, id, ...outcome }),
    });
    await flushPendingUnloadResults(succeedingRecorder);
    expect(localStorage.getItem(PENDING_UNLOAD_KEY)).toBeNull();
    expect(getPendingUnloadState('sess-fail-retain').status).toBe('saved');

    clearPendingUnloadResult('sess-fail-retain');
  });
});
