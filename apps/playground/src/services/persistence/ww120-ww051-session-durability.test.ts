import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryStorage, StorageService } from '@/services/storage';
import { IndexedDBNotePersistence } from './IndexedDBNotePersistence';
import {
  clearPendingUnloadResult,
  createResultRecorder,
  flushPendingUnloadResults,
  getPendingUnloadState,
  stagePendingUnloadResult,
} from '@/services/resultRecorder';

describe('WW-051 / WW-120 / WW-117 — Durable finishSession upsert & hard-reload unload staging', () => {
  let mem: InMemoryStorage;
  let storageService: StorageService;
  let persistence: IndexedDBNotePersistence;

  beforeEach(() => {
    mem = new InMemoryStorage();
    storageService = new StorageService(mem);
    persistence = new IndexedDBNotePersistence(storageService);
    localStorage.clear();
  });

  it('upserts Session and BlockRevision in finishSession even when startSession was never persisted (hard-reload / deferred-persist path)', async () => {
    const sessionId = 'sess-ww051-reload-1';
    const finished = await persistence.finishSession(
      sessionId,
      {
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_120_000,
        duration: 120_000,
        completed: true,
        logs: [],
      },
      1_700_000_120_000,
      {
        noteId: 'note-ad-hoc-1',
        blockId: 'wod-1-abc',
        blockVersion: 1,
        blockContent: '```time\n21-15-9\n  Thrusters 95lb\n  Pull-ups\n```',
        blockDialect: 'time',
        origin: 'journal',
        sessionDate: '2026-11-23',
      },
    );

    expect(finished.id).toBe(sessionId);
    expect(finished.status).toBe('completed');
    expect(finished.duration).toBe(120_000);

    const persistedSession = await storageService.getSessionById(sessionId);
    expect(persistedSession).toBeDefined();
    expect(persistedSession?.status).toBe('completed');
    expect(persistedSession?.noteId).toBe('note-ad-hoc-1');

    const persistedRev = await storageService.getBlockRevision('note-ad-hoc-1', 'wod-1-abc', 1);
    expect(persistedRev).toBeDefined();
    expect(persistedRev?.rawContent).toContain('Thrusters 95lb');
  });

  it('flushes a staged mid-run unload session into storage and marks state saved only after commit', async () => {
    const recorder = createResultRecorder(persistence);
    const sessionId = 'sess-ww120-halted-1';

    stagePendingUnloadResult({
      resultId: sessionId,
      noteId: 'note-halted-1',
      blockId: 'wod-1-halted',
      blockVersion: 1,
      blockContent: '```time\n10:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n```',
      blockDialect: 'time',
      origin: 'journal',
      sessionDate: '2026-11-23',
      data: {
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_045_000,
        duration: 45_000,
        completed: false,
        logs: [],
      },
      createdAt: 1_700_000_045_000,
    });

    expect(getPendingUnloadState(sessionId).status).toBe('pending');

    await flushPendingUnloadResults(recorder);

    expect(getPendingUnloadState(sessionId).status).toBe('saved');
    const saved = await storageService.getSessionById(sessionId);
    expect(saved).toBeDefined();
    expect(saved?.completed).toBe(false);
    expect(saved?.duration).toBe(45_000);

    clearPendingUnloadResult(sessionId);
  });

  it('retains staged session and reports failed state if persistence rejects (never lies)', async () => {
    const failingRecorder = createResultRecorder({
      finishSession: async () => {
        throw new Error('Simulated IndexedDB quota error');
      },
    });
    const sessionId = 'sess-ww120-fail-1';

    stagePendingUnloadResult({
      resultId: sessionId,
      noteId: 'note-fail-1',
      blockId: 'wod-1-fail',
      blockContent: '```time\n1:00\n```',
      data: {
        startTime: 1_000,
        endTime: 5_000,
        duration: 4_000,
        completed: false,
        logs: [],
      },
      createdAt: 5_000,
    });

    await flushPendingUnloadResults(failingRecorder);

    const state = getPendingUnloadState(sessionId);
    expect(state.status).toBe('failed');
    expect(state.error).toContain('Simulated IndexedDB quota error');

    clearPendingUnloadResult(sessionId);
  });
});
