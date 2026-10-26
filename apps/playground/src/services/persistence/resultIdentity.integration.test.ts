import { describe, expect, it } from 'bun:test';
import { InMemoryStorage } from '../storage/InMemoryStorage';
import { StorageService } from '../storage/StorageService';
import { IndexedDBContentProvider } from '../content/IndexedDBContentProvider';
import { IndexedDBNotePersistence } from './IndexedDBNotePersistence';
import { projectEventToFacts } from '@bitcobblers/wod-wiki-wql';

const SOURCE = '# Fran\n\n```time\n21 Thrusters 95lb\n```\n';

describe('pinned result identities', () => {
  it('pins exact version at start and preserves that pin after an edit and finish', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const persistence = new IndexedDBNotePersistence(service, provider);
    const saved = await persistence.createNote({ id: 'n', title: 'Fran', rawContent: SOURCE, targetDate: 1 });
    const blockId = Object.keys(saved.blocks!)[0]!;
    const started = await persistence.startSession({ noteId: saved.id, rawContent: SOURCE, blocks: saved.blocks!, expectedSourceRevision: 1 },
      { id: 'run', noteId: saved.id, blockId, origin: 'journal', startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: 1 });
    await provider.updateRecord(saved.id, { rawContent: SOURCE.replace('95lb', '75lb'), blocks: saved.blocks, expectedSourceRevision: 1 });
    const result = await persistence.finishSession('run', { startTime: 1, endTime: 10, duration: 9, completed: true,
      logs: [{ id: 1, outputType: 'segment', metrics: [{ type: 'rep', value: 21, origin: 'runtime' }], sourceBlockKey: '1', stackLevel: 0 }] });
    expect(result.blockId).toBe(blockId);
    expect(result.blockVersion).toBe(1);
    expect(await persistence.getBlockRevision(saved.id, blockId, 1)).toEqual(started.revision);
    const events = await service.getEventsByResult('run');
    expect(events.every(row => row.blockId === blockId && row.blockVersion === 1)).toBe(true);
    expect(events.flatMap(projectEventToFacts).every(row => row.blockId === blockId && row.blockVersion === 1)).toBe(true);
  });

  it('keeps duplicate occurrence histories separate while fingerprints join across notes', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const persistence = new IndexedDBNotePersistence(service, provider);
    for (const id of ['a', 'b']) {
      const saved = await provider.saveRecord({ id, title: 'Fran', rawContent: SOURCE + SOURCE, tags: [], targetDate: 1 });
      const blockIds = Object.keys(saved.blocks!);
      expect(blockIds).toHaveLength(2);
      for (const [index, blockId] of blockIds.entries()) {
        await persistence.startSession({ noteId: id, rawContent: saved.rawContent, blocks: saved.blocks!, expectedSourceRevision: 1 },
          { id: `run-${id}-${index}`, noteId: id, blockId, origin: id === 'a' ? 'journal' : 'playground',
            startTime: 1, endTime: 1, duration: 0, completed: false, createdAt: index + 1 });
      }
      expect(await service.getBlockHistory(id, blockIds[0]!)).toHaveLength(1);
      expect(await service.getBlockHistory(id, blockIds[1]!)).toHaveLength(1);
    }
    const result = await service.getSessionById('run-a-0');
    const similar = await persistence.getSimilarSessions(result!.blockContentId!);
    expect(similar.map(row => row.id).sort()).toEqual(['run-a-0', 'run-a-1']);
    expect(await persistence.getSimilarSessions(result!.blockContentId!, { includePlayground: true })).toHaveLength(4);
  });
});
