import { describe, expect, it } from 'bun:test';
import { createResultRecorder, onResultSaved } from './resultRecorder';
import type { Session } from '@/types/storage';
import type { Sessions } from '@/components/Editor/types';

const pinned: Session = { id: 'run', noteId: 'deleted-note', blockId: 'second-occurrence', blockVersion: 2, startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: 1 };
const data: Sessions = { startTime: 1, endTime: 61_001, duration: 61_000, completed: true };

describe('result recorder', () => {
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
});
