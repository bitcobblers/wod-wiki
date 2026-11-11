import { describe, expect, it } from 'vitest';
import {
  MemoryFeedTree,
  getNoteNotebooks,
  getNotePublicationSummary,
  promoteNoteToNotebooks,
  publishFeedFromStorage,
  reconcileNoteBlocks,
  removeNoteFromNotebook,
  setNotebookPublic,
  setSessionPublic,
  type Note,
  type Session,
} from '../src/index';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';

function createRealSqlStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

describe('Candidate 02 — Many-to-many Notebook Membership & Private Journal', () => {
  it('promotes a Journal or Playground Note and attached Sessions to multiple user Notebooks while keeping it permanently in private notebook/journal', async () => {
    const storage = createRealSqlStorage();
    const raw = '# Heavy Fran\n\n```time\n21-15-9\n  Thrusters 95lb\n  Pull-ups\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wod = Object.values(blocks)[0]!;

    const note: Note = {
      id: '01950000-0000-7000-8000-000000000101',
      title: 'Heavy Fran',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      date: Date.parse('2026-11-10T12:00:00Z'),
      createdAt: 1000,
      type: 'journal',
      seedOrigin: 'user',
    };
    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(note);
      await tx.readwrite('block_revisions').put({
        noteId: note.id,
        blockId: wod.id,
        version: 1,
        kind: 'wod',
        rawContent: raw.slice(wod.from, wod.to),
        savedAt: 1000,
        dialect: 'time',
      });
    });
    const s1: Session = {
      id: 'sess-1',
      noteId: note.id,
      blockId: wod.id,
      blockVersion: 1,
      blockContentId: 'cid-fran',
      origin: 'journal',
      status: 'completed',
      startTime: 2000,
      endTime: 2300,
      duration: 300_000,
      completed: true,
      createdAt: 2300,
    };
    const s2: Session = {
      ...s1,
      id: 'sess-2',
      startTime: 5000,
      endTime: 5250,
      duration: 250_000,
      createdAt: 5250,
    };
    await storage.readwrite('sessions').putMany([s1, s2]);

    // Promote to TWO user notebooks at once, attaching only sess-2
    const result = await promoteNoteToNotebooks(storage, {
      noteId: note.id,
      notebookIds: ['notebook/open-prep', 'notebook/club-benchmarks'],
      sessionIds: [s2.id],
    });

    expect(result.notebookIds).toEqual([
      'notebook/journal',
      'notebook/open-prep',
      'notebook/club-benchmarks',
    ]);

    const currentMemberships = await getNoteNotebooks(storage, note.id);
    expect(currentMemberships).toEqual([
      'notebook/journal',
      'notebook/open-prep',
      'notebook/club-benchmarks',
    ]);

    // Removing from one user notebook preserves the other AND keeps notebook/journal
    await removeNoteFromNotebook(storage, note.id, 'notebook/open-prep');
    expect(await getNoteNotebooks(storage, note.id)).toEqual([
      'notebook/journal',
      'notebook/club-benchmarks',
    ]);

    // Attempting to remove a user note from notebook/journal is refused (Journal tracks all created notes/sessions)
    await expect(
      removeNoteFromNotebook(storage, note.id, 'notebook/journal'),
    ).rejects.toThrow(/journal/i);

    await storage.close();
  });

  it('refuses to mark notebook/journal, notebook/custom, notebook/defaults, or notebook/playground as public', async () => {
    const storage = createRealSqlStorage();

    await expect(setNotebookPublic(storage, 'notebook/journal', true)).rejects.toThrow(/cannot be published|private/i);
    await expect(setNotebookPublic(storage, 'notebook/custom', true)).rejects.toThrow(/cannot be published|private/i);
    await expect(setNotebookPublic(storage, 'notebook/defaults', true)).rejects.toThrow(/cannot be published|read-only/i);
    await expect(setNotebookPublic(storage, 'notebook/playground', true)).rejects.toThrow(/cannot be published|private/i);

    await storage.close();
  });

  it('publishes a Note promoted into two public user Notebooks into both chunks along with attached public Sessions', async () => {
    const storage = createRealSqlStorage();
    const raw = '# Grace\n\n```time\n30 Clean and Jerks 135lb\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wod = Object.values(blocks)[0]!;

    const note: Note = {
      id: '01950000-0000-7000-8000-000000000102',
      title: 'Grace',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      date: Date.parse('2026-11-10T12:00:00Z'),
      createdAt: 1000,
      type: 'playground',
      sourceId: 'playground',
      seedOrigin: 'user',
    };
    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(note);
      await tx.readwrite('block_revisions').put({
        noteId: note.id,
        blockId: wod.id,
        version: 1,
        kind: 'wod',
        rawContent: raw.slice(wod.from, wod.to),
        savedAt: 1000,
        dialect: 'time',
      });
    });
    const sessShared: Session = {
      id: 'sess-grace-shared',
      noteId: note.id,
      blockId: wod.id,
      blockVersion: 1,
      origin: 'playground',
      status: 'completed',
      startTime: 1000,
      endTime: 1120,
      duration: 120_000,
      completed: true,
      createdAt: 1120,
    };
    const sessPrivate: Session = {
      ...sessShared,
      id: 'sess-grace-private',
      createdAt: 1500,
    };
    await storage.readwrite('sessions').putMany([sessShared, sessPrivate]);

    await promoteNoteToNotebooks(storage, {
      noteId: note.id,
      notebookIds: ['notebook/barbell-club', 'notebook/pr-log'],
      sessionIds: [sessShared.id],
      shareSessionsPublicly: true,
    });

    // Both user notebooks still Private -> Effective visibility is Private
    expect((await getNotePublicationSummary(storage, note.id)).visibility).toBe('Private');

    // Make barbell-club and pr-log public
    await setNotebookPublic(storage, 'notebook/barbell-club', true);
    await setNotebookPublic(storage, 'notebook/pr-log', true);

    const summary = await getNotePublicationSummary(storage, note.id);
    expect(summary.visibility).toBe('Published Note + Data');
    expect(summary.publicSessions).toBe(1);

    // Also confirm explicit setSessionPublic keeps Private session unshared
    await setSessionPublic(storage, sessPrivate.id, false);

    const tree = new MemoryFeedTree();
    const report = await publishFeedFromStorage(storage, tree, {
      layout: 'feed',
      name: 'Multi-Notebook Feed',
    });

    expect(report.notebooks.sort()).toEqual(['barbell-club', 'pr-log']);
    expect(report.totalNotes).toBe(2);
    expect(report.totalPublicSessions).toBe(2);

    await storage.close();
  });
});
