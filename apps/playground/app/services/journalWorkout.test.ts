import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks, type Note } from '@bitcobblers/wod-wiki-core';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { resetStorageForTesting, setStorageForTesting, storageService } from '@/services/storage';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
import { listScheduleItemsForNote } from '@bitcobblers/wod-wiki-engine';
import { createJournalNoteFromWorkout } from './journalWorkout';

describe('Journal workout cloning & read-only Session intake', () => {
  beforeEach(() => {
    setStorageForTesting(new InMemoryStorage());
  });

  afterEach(() => {
    resetStorageForTesting();
  });
  it('clones the full Markdown document and structured provenance when sourceNoteId exists in storage', async () => {
    const fullMd = [
      '---',
      'title: Murph',
      'equipment: weight-vest',
      '---',
      '',
      '# Murph',
      '',
      'In memory of Lt. Michael Murphy.',
      '',
      '```time',
      '1 mile Run',
      '100 Pull-ups',
      '200 Push-ups',
      '300 Air Squats',
      '1 mile Run',
      '```',
      '',
    ].join('\n');

    const blocks = reconcileNoteBlocks(fullMd, { sourceRevision: 1 });
    await storageService.saveNoteSource({
      noteId: 'seed-murph-id',
      rawContent: fullMd,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'Murph', type: 'note', sourceId: 'notebook:crossfit-heroes/murph' },
    });
    const base = await storageService.getNote('seed-murph-id');
    await storageService.saveNote({
      ...base!,
      seedOrigin: 'seed',
      seedVersion: 7,
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      sourcePath: 'markdown/notebooks/crossfit-heroes/murph.md',
    } as Note);

    const pinned = await createJournalNoteFromWorkout({
      workoutName: 'Murph',
      category: 'crossfit-heroes',
      sourceNoteId: 'seed-murph-id',
      wodContent: '1 mile Run',
      date: new Date('2026-11-10T12:00:00Z'),
    });

    expect(pinned.id).toBe('seed-murph-id');
    expect(pinned.rawContent).toBe(fullMd);
    const storedMurph = await storageService.getNote('seed-murph-id');
    expect(storedMurph?.retention).toBe('schedule-pinned');
    expect(storedMurph?.provenance).toMatchObject({
      sourceNoteId: 'seed-murph-id',
      sourceVersion: 7,
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-heroes',
    });
    expect(await storageService.getAllNotes()).toHaveLength(1);
  });

  it('schedules user-owned non-journal source notes via ScheduleItem without cloning or polluting notebookIds (ADR 0009)', async () => {
    const raw = '# My Custom Complex\n\n```time\n5x3 Hang Clean\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    await storageService.saveNoteSource({
      noteId: 'user-custom-id',
      rawContent: raw,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'My Custom Complex', type: 'note' },
    });
    const baseCustom = await storageService.getNote('user-custom-id');
    await storageService.saveNote({
      ...baseCustom!,
      notebookId: 'notebook/custom',
      notebookIds: ['notebook/custom'],
    } as Note);

    const linked = await createJournalNoteFromWorkout({
      workoutName: 'My Custom Complex',
      category: 'custom',
      sourceNoteId: 'user-custom-id',
      wodContent: '5x3 Hang Clean',
      date: new Date('2026-11-10T12:00:00Z'),
    });

    expect(linked.id).toBe('user-custom-id');
    expect(linked.notebookIds).toEqual(['notebook/custom']);
    const schedule = await listScheduleItemsForNote(storageService.storage, 'user-custom-id');
    expect(schedule).toHaveLength(1);
    expect(schedule[0]?.sourceNotebookId).toBe('notebook/custom');
    expect(await storageService.getAllNotes()).toHaveLength(1);
  });

  it('IndexedDBNotePersistence.startSession pins a single archival copy for read-only Seed/Feed Notes without 0s phantom sessions (WW-052)', async () => {
    const raw = '# Helen\n\n```time\n3 Rounds\n  400m Run\n  21 Kettlebell Swings\n  12 Pull-ups\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wodBlock = Object.values(blocks)[0]!;

    await storageService.saveNoteSource({
      noteId: 'seed-helen-id',
      rawContent: raw,
      blocks,
      expectedSourceRevision: 0,
      metadata: { title: 'Helen', type: 'note', sourceId: 'notebook:crossfit-girls/helen' },
    });
    const base = await storageService.getNote('seed-helen-id');
    await storageService.saveNote({
      ...base!,
      seedOrigin: 'seed',
      seedVersion: 3,
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
    } as Note);

    const persistence = new IndexedDBNotePersistence(storageService);
    const started = await persistence.startSession(
      {
        noteId: 'seed-helen-id',
        rawContent: raw,
        blocks,
        expectedSourceRevision: 1,
      },
      {
        id: 'sess-helen-1',
        noteId: 'seed-helen-id',
        blockId: wodBlock.id,
        startTime: 10_000,
        endTime: 10_000,
        duration: 0,
        completed: false,
        createdAt: 10_000,
      },
    );

    expect(started.note.id).toBe('seed-helen-id');
    expect(started.note.retention).toBe('session-pinned');
    expect(started.session.noteId).toBe('seed-helen-id');
    expect(started.note.provenance?.sourceNoteId).toBe('seed-helen-id');
    expect(started.note.provenance?.sourceVersion).toBe(3);
    // WW-052: prepareJournalSessionRun must not persist a 0s phantom session row before the run finishes.
    expect(await storageService.getSessionsForNote('seed-helen-id')).toHaveLength(0);

    const finished = await persistence.finishSession(started.session.id, {
      startTime: 10_000,
      endTime: 70_000,
      duration: 60_000,
      completed: true,
      logs: [
        {
          id: 1,
          outputType: 'segment',
          timeSpan: { started: 10_000, ended: 70_000 },
          metrics: [{ type: 'rep', value: 21, origin: 'runtime' }],
          sourceBlockKey: '1',
          stackLevel: 0,
        },
      ],
    });
    expect(finished.status).toBe('completed');
    expect(finished.noteId).toBe('seed-helen-id');
    expect(await storageService.getSessionsForNote('seed-helen-id')).toHaveLength(1);
    expect((await storageService.getEventsByResult(started.session.id)).length).toBeGreaterThan(0);

    // Second run against the same external note reuses the single archival copy and aggregates attempts.
    const started2 = await persistence.startSession(
      {
        noteId: 'seed-helen-id',
        rawContent: raw,
        blocks,
        expectedSourceRevision: 1,
      },
      {
        id: 'sess-helen-2',
        noteId: 'seed-helen-id',
        blockId: wodBlock.id,
        startTime: 80_000,
        endTime: 80_000,
        duration: 0,
        completed: false,
        createdAt: 80_000,
      },
    );
    expect(started2.note.id).toBe('seed-helen-id');
    await persistence.finishSession(started2.session.id, {
      startTime: 80_000,
      endTime: 135_000,
      duration: 55_000,
      completed: true,
    });

    const allSessions = await storageService.getSessionsForNote('seed-helen-id');
    expect(allSessions.map((s) => s.id).sort()).toEqual(['sess-helen-1', 'sess-helen-2']);
    expect(await storageService.getAllNotes()).toHaveLength(1);
  });

  it('lazily resolves and pins remote:<feedId>:<uuid> workouts via resolveRemoteWorkout into one archival copy', async () => {
    const raw = '# Remote Cindy\n\n```time\n20 min AMRAP\n5 Pull-ups\n10 Push-ups\n15 Air Squats\n```\n';
    const pinned = await createJournalNoteFromWorkout({
      workoutName: 'Remote Cindy',
      category: 'daily-feed',
      sourceNoteId: 'remote:daily-feed:uuid-cindy-1',
      wodContent: '20 min AMRAP\n5 Pull-ups\n10 Push-ups\n15 Air Squats',
      date: new Date('2026-11-10T12:00:00Z'),
      resolveRemoteWorkout: async () => ({
        id: 'uuid-cindy-1',
        title: 'Remote Cindy',
        rawContent: raw,
        feedSourceId: 'daily-feed',
        sourceNotebookId: 'notebook/daily-feed',
        sourcePath: '2026-11-10-cindy.md',
        version: 4,
      }),
    });

    expect(pinned.id).toBe('uuid-cindy-1');
    const stored = await storageService.getNote('uuid-cindy-1');
    expect(stored?.retention).toBe('schedule-pinned');
    expect(stored?.feedOrigin).toBe('feed');
    expect(stored?.feedSourceId).toBe('daily-feed');
    expect(stored?.seedOrigin).toBe('seed');
    expect(stored?.provenance?.sourceNoteId).toBe('uuid-cindy-1');
    expect(stored?.provenance?.feedSourceId).toBe('daily-feed');
  });
});
