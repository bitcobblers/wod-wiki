import { describe, expect, it, beforeEach } from 'bun:test';
import { InMemoryStorage, StorageService } from '@/services/storage';
import type { Session } from '@/types/storage';

describe('StorageService sessions operations', () => {
  const storage = new InMemoryStorage();
  const service = new StorageService(storage);

  beforeEach(async () => {
    await service.wipe();
  });

  it('saves and retrieves sessions from the sessions store', async () => {
    const session: Session = {
      id: 'session-123',
      noteId: 'note-abc',
      blockId: 'block-1',
      blockVersion: 1,
      createdAt: 1000,
      startTime: 1000,
      endTime: 2000,
      duration: 1000,
      completed: true,
    };
    await storage.readwrite('block_revisions').put({ noteId: 'note-abc', blockId: 'block-1', version: 1,
      kind: 'wod', dialect: 'time', rawContent: '```time\n10 Pushups\n```', savedAt: 1 });

    await service.saveSession(session);

    const fetched = await service.getSessionById('session-123');
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('session-123');
    expect(fetched?.noteId).toBe('note-abc');

    const list = await service.getSessionsForNote('note-abc');
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('session-123');
  });
});
