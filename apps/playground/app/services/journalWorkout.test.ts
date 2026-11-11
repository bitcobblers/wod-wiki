import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { reconcileNoteBlocks, type Note } from '@bitcobblers/wod-wiki-core';
import { InMemoryStorage } from '@/services/storage/InMemoryStorage';
import { resetStorageForTesting, setStorageForTesting, storageService } from '@/services/storage';
import { IndexedDBNotePersistence } from '@/services/persistence/IndexedDBNotePersistence';
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

    const cloned = await createJournalNoteFromWorkout({
      workoutName: 'Murph',
      category: 'crossfit-heroes',
      sourceNoteId: 'seed-murph-id',
      wodContent: '1 mile Run',
      date: new Date('2026-11-10T12:00:00Z'),
    });

    expect(cloned.id).not.toBe('seed-murph-id');
    expect(cloned.rawContent).toBe(fullMd);
    expect(cloned.sourceId).toBe('seed-murph-id');
    expect(cloned.provenance).toMatchObject({
      sourceNoteId: 'seed-murph-id',
      sourceVersion: 7,
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-heroes',
    });
  });

  it('IndexedDBNotePersistence.startSession clones a read-only Seed Note into notebook/journal instead of mutating or pinning the Seed Note', async () => {
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

    expect(started.note.id).not.toBe('seed-helen-id');
    expect(started.session.noteId).toBe(started.note.id);
    expect(started.note.provenance?.sourceNoteId).toBe('seed-helen-id');
    expect(started.note.provenance?.sourceVersion).toBe(3);
    expect(await storageService.getSessionsForNote('seed-helen-id')).toHaveLength(0);
    expect(await storageService.getSessionsForNote(started.note.id)).toHaveLength(1);
  });
});
