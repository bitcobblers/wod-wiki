import { describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks } from '@bitcobblers/wod-wiki-core';
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
    const saved = await provider.saveRecord({ id: 'n', title: 'Workout', rawContent: SOURCE, targetDate: 1, tags: ['manual'] });
    const note = await service.getNote('n');
    await service.saveNote({ ...note!, seedOrigin: 'seed', seedChunkId: 'owned', seedVersion: 1, sourcePath: 'markdown/notebooks/x.md' });
    const attachment = { id: 'a', label: 'GPS', mimeType: 'text/plain', data: 'track', timeSpan: { start: 1, end: 2 } };
    await persistence.mutateNote('n', { attachments: { add: [attachment] } });
    await persistence.saveNote({ noteId: 'n', rawContent: SOURCE.replace('10 Pushups', '20 Pushups'),
      blocks: saved.blocks!, expectedSourceRevision: 1 });
    expect(await service.getNote('n')).toMatchObject({ seedOrigin: 'seed', seedChunkId: 'owned', seedVersion: 1,
      sourcePath: 'markdown/notebooks/x.md' });
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

  it('pushes journalDate and kind predicates to storage indexes without scanning or hydrating non-matching notes (WW-001)', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service);

    // Seed 40 unrelated corpus notes, 2 journal notes on different dates, and 1 dashboard note.
    for (let i = 0; i < 40; i++) {
      await persistence.createNote({
        id: `corpus-${i}`,
        title: `Corpus Workout ${i}`,
        rawContent: SOURCE,
        tags: i % 2 === 0 ? ['metcon'] : ['strength'],
        targetDate: 1_000 + i,
      });
    }
    await persistence.createNote({
      id: 'journal-target',
      title: 'Target Day Entry',
      rawContent: SOURCE,
      type: 'journal',
      journalDate: '2026-04-17',
      targetDate: 5_000,
    });
    await persistence.createNote({
      id: 'journal-other',
      title: 'Other Day Entry',
      rawContent: SOURCE,
      type: 'journal',
      journalDate: '2026-04-18',
      targetDate: 6_000,
    });
    await persistence.createNote({
      id: 'dash-custom',
      title: 'Custom Volume Dashboard',
      rawContent: '---\ndashboard: true\n---\n# Volume\n',
      type: 'dashboard',
      slug: 'custom-volume',
      targetDate: 7_000,
    });

    let getAllNotesCalls = 0;
    const origGetAllNotes = service.getAllNotes.bind(service);
    service.getAllNotes = async () => {
      getAllNotesCalls++;
      return origGetAllNotes();
    };

    const hydratedBatches: string[][] = [];
    const origGetDetailBatches = service.getDetailBatches.bind(service);
    service.getDetailBatches = async (noteIds) => {
      hydratedBatches.push([...noteIds]);
      return origGetDetailBatches(noteIds);
    };

    // 1. Empty journal date: zero full-vault scans and zero detail hydration calls.
    const emptyDay = await persistence.listNotes({
      journalDate: '2026-04-19',
      kind: 'journal',
      projection: 'summary',
    });
    expect(emptyDay).toEqual([]);
    expect(getAllNotesCalls).toBe(0);
    expect(hydratedBatches).toEqual([]);

    // 2. Populated journal date: hydrates ONLY the matching date's journal note, never corpus or other days.
    const targetDay = await persistence.listNotes({
      journalDate: '2026-04-17',
      kind: 'journal',
      projection: 'summary',
    });
    expect(targetDay.map((e) => e.id)).toEqual(['journal-target']);
    expect(getAllNotesCalls).toBe(0);
    expect(hydratedBatches).toEqual([['journal-target']]);

    // 3. Kind-filtered dashboard lookup: uses by-type index and hydrates ONLY the 1 dashboard note.
    hydratedBatches.length = 0;
    const dashboards = await persistence.listNotes({ kind: 'dashboard' });
    expect(dashboards.map((e) => e.id)).toEqual(['dash-custom']);
    expect(getAllNotesCalls).toBe(0);
    expect(hydratedBatches).toEqual([['dash-custom']]);
  });

  it('window getRecords keeps undated notes dated by their journal page placement (WW-024 Bug C)', async () => {
    const memory = new InMemoryStorage();
    const service = new StorageService(memory);
    const persistence = new IndexedDBNotePersistence(service);

    const now = Date.now();
    const day = 86_400_000;
    const isoOf = (ms: number): string => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // Undated notes created 300 days ago; only their journal-page placement
    // carries the date of record. persistence.saveNote pins the block
    // revisions the storage layer validates; the raw save then strips the
    // date (placement-dated) and backdates createdAt.
    const blocks = reconcileNoteBlocks(SOURCE, { sourceRevision: 1 });
    for (const [id, title] of [['placed-today', 'Placed Today'], ['placed-old', 'Placed Old'], ['dated', 'Dated']] as const) {
      await persistence.saveNote({ noteId: id, rawContent: SOURCE, blocks, expectedSourceRevision: 0, metadata: { title } });
      const note = await service.getNote(id);
      await service.saveNote({ ...note!, date: id === 'dated' ? now - day : undefined, createdAt: now - 300 * day });
    }

    await memory.readwrite('page').put({ id: 'page-today', date: isoOf(now), createdAt: now });
    await memory.readwrite('page').put({ id: 'page-old', date: isoOf(now - 30 * day), createdAt: now });
    await memory.readwrite('page_notes').put({ id: 'pn-1', pageId: 'page-today', noteId: 'placed-today', position: 1, createdAt: now });
    await memory.readwrite('page_notes').put({ id: 'pn-2', pageId: 'page-old', noteId: 'placed-old', position: 1, createdAt: now });

    const records = await persistence.getRecords({ dateRange: { start: now - 2 * day, end: now + day } });
    const ids = records.map((r) => r.id);
    expect(ids).toContain('placed-today');
    expect(ids).toContain('dated');
    expect(ids).not.toContain('placed-old');
  });
});
