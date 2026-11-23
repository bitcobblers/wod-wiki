import { describe, expect, it } from 'vitest';
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

    // 3. Kind-filtered dashboard lookup: uses by-type index with summary-first default (zero detail hydration).
    hydratedBatches.length = 0;
    const dashboards = await persistence.listNotes({ kind: 'dashboard' });
    expect(dashboards.map((e) => e.id)).toEqual(['dash-custom']);
    expect(getAllNotesCalls).toBe(0);
    expect(hydratedBatches).toEqual([]);
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

  it('pushes summary plan and limit/offset down to queryDomain and bounds local detail hydration (WW-036)', async () => {
    const memory = new InMemoryStorage();
    const service = new StorageService(memory);
    const persistence = new IndexedDBNotePersistence(service);

    const blocks = reconcileNoteBlocks(SOURCE, { sourceRevision: 1 });
    for (const [id, ts] of [['n1', 1000], ['n2', 2000], ['n3', 3000]] as const) {
      await persistence.saveNote({ noteId: id, rawContent: SOURCE, blocks, expectedSourceRevision: 0, metadata: { title: id } });
      const note = await service.getNote(id);
      await service.saveNote({ ...note!, date: ts, createdAt: ts });
    }

    const hydratedBatches: string[][] = [];
    const origGetDetailBatches = service.getDetailBatches.bind(service);
    service.getDetailBatches = async (noteIds) => {
      hydratedBatches.push([...noteIds]);
      return origGetDetailBatches(noteIds);
    };

    const localPage = await persistence.listNotes({ offset: 1, limit: 1 });
    expect(localPage.map((n) => n.id)).toEqual(['n2']);
    expect(hydratedBatches).toEqual([]);

    const detailPage = await persistence.listNotes({ projection: 'history-detail', offset: 1, limit: 1 });
    expect(detailPage.map((n) => n.id)).toEqual(['n2']);
    expect(hydratedBatches).toEqual([['n3', 'n2'], ['n2']]);

    const seenQueries: unknown[] = [];
    service.queryDomain = async (q) => {
      seenQueries.push(q);
      const allNotes = await service.getAllNotes();
      return {
        plan: 'notes',
        rows: allNotes.sort((a, b) => (b.date ?? b.createdAt) - (a.date ?? a.createdAt)).slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? allNotes.length)),
        selectedCount: allNotes.length,
        matchedCount: allNotes.length,
        projectionVersion: 5,
      };
    };

    const defaultPage = await persistence.listNotes({ offset: 1, limit: 1 });
    expect(defaultPage.map((n) => n.id)).toEqual(['n2']);
    expect(seenQueries[0]).toMatchObject({ plan: 'notes', offset: 0, limit: 2 });

    const summaryPage = await persistence.listNotes({ projection: 'summary', offset: 1, limit: 1 });
    expect(summaryPage.map((n) => n.id)).toEqual(['n2']);
    expect(seenQueries[1]).toMatchObject({ plan: 'notes', offset: 0, limit: 2 });
  });

  it('defaults unfiltered getRecords() and listNotes() to summary plan without calling getDetailBatches while preserving history-detail and getNote() hydration (WW-036 Phase 1a)', async () => {
    const memory = new InMemoryStorage();
    const service = new StorageService(memory);
    const persistence = new IndexedDBNotePersistence(service);

    const n1 = await persistence.createNote({
      id: 'sum-1',
      title: 'Summary Note 1',
      rawContent: SOURCE,
      tags: ['metcon'],
      targetDate: 1_000,
    });
    await persistence.createNote({
      id: 'sum-2',
      title: 'Summary Note 2',
      rawContent: SOURCE,
      tags: ['strength'],
      targetDate: 2_000,
    });
    await persistence.createNote({
      id: 'sum-3',
      title: 'Summary Note 3',
      rawContent: SOURCE,
      tags: ['metcon'],
      targetDate: 3_000,
    });

    const blockId = Object.keys(n1.blocks!)[0]!;
    await persistence.startSession(
      { noteId: 'sum-1', rawContent: SOURCE, blocks: n1.blocks!, expectedSourceRevision: n1.sourceRevision! },
      { id: 'sess-sum-1', noteId: 'sum-1', blockId, startTime: 100, endTime: 100, duration: 0, completed: false, createdAt: 100 },
    );
    await persistence.finishSession('sess-sum-1', { startTime: 100, endTime: 250, duration: 150, completed: true, logs: [] });

    const hydratedBatches: string[][] = [];
    const origGetDetailBatches = service.getDetailBatches.bind(service);
    service.getDetailBatches = async (noteIds) => {
      hydratedBatches.push([...noteIds]);
      return origGetDetailBatches(noteIds);
    };

    let getNotesByIdsCalls = 0;
    const origGetNotesByIds = service.getNotesByIds.bind(service);
    service.getNotesByIds = async (ids) => {
      getNotesByIdsCalls++;
      return origGetNotesByIds(ids);
    };

    const seenPlans: Array<{ plan: string; limit?: number; offset?: number }> = [];
    const origQueryDomain = service.queryDomain.bind(service);
    service.queryDomain = async (q) => {
      seenPlans.push({ plan: q.plan, limit: q.limit, offset: q.offset });
      return origQueryDomain(q);
    };

    // 1. Unfiltered getRecords() uses plan: 'notes' and zero getDetailBatches / getNotesByIds calls.
    const allRecords = await persistence.getRecords();
    expect(allRecords.map((r) => r.id)).toEqual(['sum-3', 'sum-2', 'sum-1']);
    expect(seenPlans.at(-1)).toEqual({ plan: 'notes', limit: undefined, offset: undefined });
    expect(hydratedBatches).toEqual([]);
    expect(getNotesByIdsCalls).toBe(0);

    // 2. Unfiltered listNotes() uses plan: 'notes' and zero getDetailBatches calls.
    const allListed = await persistence.listNotes();
    expect(allListed.map((r) => r.id)).toEqual(['sum-3', 'sum-2', 'sum-1']);
    expect(seenPlans.at(-1)).toEqual({ plan: 'notes', limit: undefined, offset: undefined });
    expect(hydratedBatches).toEqual([]);

    // 3. Bounded limit query respects limit without detail hydration.
    const limited = await persistence.getRecords({ limit: 2 });
    expect(limited.map((r) => r.id)).toEqual(['sum-3', 'sum-2']);
    expect(seenPlans.at(-1)).toEqual({ plan: 'notes', limit: 2, offset: 0 });
    expect(hydratedBatches).toEqual([]);

    // 4. Explicit projection: 'history-detail' still hydrates full detail (results, extendedResults, sections).
    const detailed = await persistence.listNotes({ projection: 'history-detail' });
    const detailedN1 = detailed.find((r) => r.id === 'sum-1');
    expect(seenPlans.at(-1)).toEqual({ plan: 'detail', limit: undefined, offset: undefined });
    expect(hydratedBatches.length).toBeGreaterThan(0);
    expect(detailedN1?.results?.duration).toBe(150);
    expect(detailedN1?.extendedResults?.map((s) => s.id)).toEqual(['sess-sum-1']);
    expect(detailedN1?.sections?.length).toBeGreaterThan(0);

    // 5. getNote() still hydrates full detail (results, sections).
    const single = await persistence.getNote('sum-1');
    expect(single.results?.duration).toBe(150);
    expect(single.sections?.length).toBeGreaterThan(0);
  });

  it('WW-120: finishSession upserts a missing session row from fallback after a deferred-persist reload while preserving WW-052', async () => {
    const service = new StorageService(new InMemoryStorage());
    const persistence = new IndexedDBNotePersistence(service);
    const created = await persistence.createNote({
      id: 'amrap-note',
      title: '20:00 AMRAP',
      rawContent: '```time\n20:00 AMRAP\n  5 Pullups\n  10 Pushups\n```',
      targetDate: 1_000,
    });
    const blockId = Object.keys(created.blocks!)[0]!;

    // WW-052: opening the Run gate with deferPersist: true must leave sessions=[]
    await persistence.startSession(
      { noteId: 'amrap-note', rawContent: created.rawContent, blocks: created.blocks!, expectedSourceRevision: created.sourceRevision! },
      { id: 'sess-gate-only', noteId: 'amrap-note', blockId, startTime: 2_000, endTime: 2_000, duration: 0, completed: false, createdAt: 2_000 },
      { deferPersist: true },
    );
    expect(await service.getSessionsForNote('amrap-note')).toEqual([]);

    // Simulate reload: sessionId was never persisted to IDB and is absent from in-memory preparedJournalSessions
    const finished = await persistence.finishSession(
      'sess-reloaded-partial',
      { startTime: 10_000, endTime: 25_000, duration: 15_000, completed: false, logs: [] },
      25_000,
      { noteId: 'amrap-note', blockId, origin: 'journal' },
    );

    expect(finished).toMatchObject({
      id: 'sess-reloaded-partial',
      noteId: 'amrap-note',
      blockId,
      blockVersion: 1,
      origin: 'journal',
      duration: 15_000,
      completed: false,
      status: 'completed',
      createdAt: 25_000,
    });
    const persisted = await service.getSessionById('sess-reloaded-partial');
    expect(persisted).toMatchObject({
      id: 'sess-reloaded-partial',
      noteId: 'amrap-note',
      blockId,
      completed: false,
      duration: 15_000,
    });

    // Without fallback, unknown sessions still reject with RESULT_NOT_FOUND
    await expect(
      persistence.finishSession('sess-never-existed', { startTime: 1, endTime: 2, duration: 1, completed: false, logs: [] }),
    ).rejects.toMatchObject({ code: 'RESULT_NOT_FOUND' });
  });
});
