import { describe, expect, it } from 'bun:test';
import { IndexedDBNotePersistence } from './IndexedDBNotePersistence';
import { IndexedDBContentProvider } from '../content/IndexedDBContentProvider';
import { StorageService } from '../storage/StorageService';
import { InMemoryStorage } from '../storage/InMemoryStorage';

const SOURCE = '```time\n10 Pushups\n```\n\n```time\n10 Pushups\n```';

describe('Note persistence projections', () => {
  it('uses the injected storage for create, reopen, edits and stale run capture', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service);
    const created = await persistence.createNote({ id: 'injected', title: 'Workout', rawContent: SOURCE, targetDate: 1 });
    const reopened = await persistence.getNote(created.id);
    expect(reopened.rawContent).toBe(SOURCE);
    expect(reopened.blocks).toEqual(created.blocks);
    const edited = await persistence.saveNote({ noteId: created.id, rawContent: SOURCE.replace('10 Pushups', '20 Pushups'),
      blocks: created.blocks!, expectedSourceRevision: created.sourceRevision! });
    expect((await service.getNote(created.id))?.sourceRevision).toBe(edited.sourceRevision);
    await expect(persistence.startSession({ noteId: created.id, rawContent: SOURCE, blocks: created.blocks!, expectedSourceRevision: 0 },
      { id: 'stale-run', noteId: created.id, blockId: Object.keys(created.blocks!)[0]!, startTime: 1, endTime: 1,
        duration: 0, completed: false, createdAt: 1 })).rejects.toMatchObject({ code: 'STALE_SOURCE' });
    expect(await service.getSessionById('stale-run')).toBeUndefined();
    expect((await persistence.getNote(created.id)).rawContent).toBe(edited.rawContent);
  });

  it('selects results by exact occurrence without mixing equal-content duplicates', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service);
    const saved = await persistence.createNote({ id: 'n', title: 'Workout', rawContent: SOURCE, targetDate: 1 });
    const ids = Object.keys(saved.blocks!);
    for (const [index, blockId] of ids.entries()) {
      await persistence.startSession({ noteId: 'n', rawContent: SOURCE, blocks: saved.blocks!, expectedSourceRevision: 1 },
        { id: `run-${index}`, noteId: 'n', blockId, startTime: index, endTime: index, duration: 0,
          completed: false, createdAt: index + 1 });
      await persistence.finishSession(`run-${index}`, { startTime: index, endTime: index + 10,
        duration: 10, completed: true, logs: [] });
    }
    const detail = await persistence.getNote('n', { projection: 'history-detail',
      resultSelection: { mode: 'all-for-section', blockId: ids[0]! } });
    expect(detail.extendedResults?.map(row => row.id)).toEqual(['run-0']);
    expect(detail.rawContent).toBe(SOURCE);
    expect(detail.blocks).toEqual(saved.blocks);
    const all = await persistence.listNotes({ ids: ['n'], projection: 'history-detail' });
    expect(all[0]?.extendedResults?.map(row => row.id)).toEqual(['run-1', 'run-0']);
    const exact = await persistence.getNote('n', { resultSelection: { mode: 'by-result-id', resultId: 'run-0' } });
    expect(exact.results?.duration).toBe(10);
  });

  it('preserves attachments and ownership fields during source edits', async () => {
    const service = new StorageService(new InMemoryStorage());
    const provider = new IndexedDBContentProvider(service);
    const persistence = new IndexedDBNotePersistence(service, provider);
    const saved = await provider.saveEntry({ id: 'n', title: 'Workout', rawContent: SOURCE, targetDate: 1, tags: ['manual'] });
    const note = await service.getNote('n');
    await service.saveNote({ ...note!, seedOrigin: 'seed', seedChunkId: 'owned', seedVersion: 1, sourcePath: 'markdown/collections/x.md' });
    const attachment = { id: 'a', label: 'GPS', mimeType: 'text/plain', data: 'track', timeSpan: { start: 1, end: 2 } };
    await persistence.mutateNote('n', { attachments: { add: [attachment] } });
    await persistence.saveNote({ noteId: 'n', rawContent: SOURCE.replace('10 Pushups', '20 Pushups'),
      blocks: saved.blocks!, expectedSourceRevision: 1 });
    expect(await service.getNote('n')).toMatchObject({ seedOrigin: 'seed', seedChunkId: 'owned', seedVersion: 1,
      sourcePath: 'markdown/collections/x.md' });
    expect(await service.getAttachmentsForNote('n')).toMatchObject([{ id: 'a', data: 'track', label: 'GPS' }]);
    expect((await service.getTagsForNote('n')).map(tag => tag.label)).toContain('manual');
  });

  it('rejects replay with a missing pinned revision instead of reading current content', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service, new IndexedDBContentProvider(service));
    await expect(service.saveSession({ id: 'orphan', noteId: 'deleted', blockId: 'removed', blockVersion: 2,
      startTime: 1, endTime: 2, duration: 1, completed: true, createdAt: 2 })).rejects.toThrow();
    await expect(persistence.rederiveResultAnalytics('orphan')).rejects.toMatchObject({ code: 'RESULT_NOT_FOUND' });
  });
});
