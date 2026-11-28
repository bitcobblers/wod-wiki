import { describe, expect, it } from 'vitest';
import {
  MemoryFeedTree,
  getNoteNotebooks,
  getNotePublicationSummary,
  promoteNoteToNotebooks,
  publishFeedFromStorage,
  reconcileNoteBlocks,
  removeNoteFromNotebook,
  setNoteNotebooks,
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
      notebookIds: ['notebook/journal'],
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

    // Removing from one user notebook preserves the other AND keeps notebook/journal if previously attached
    await removeNoteFromNotebook(storage, note.id, 'notebook/open-prep');
    expect(await getNoteNotebooks(storage, note.id)).toEqual([
      'notebook/journal',
      'notebook/club-benchmarks',
    ]);

    // ADR 0009 + Annotation 2: detaching remaining Notebooks cleanly leaves an unfiled/orphaned Note (`[]`)
    await removeNoteFromNotebook(storage, note.id, 'notebook/club-benchmarks');
    await removeNoteFromNotebook(storage, note.id, 'notebook/journal');
    expect(await getNoteNotebooks(storage, note.id)).toEqual([]);

    await storage.close();
  });

  it('allows notebook/journal, notebook/custom, and notebook/playground to toggle public while keeping system notebooks gated (WW-128)', async () => {
    const storage = createRealSqlStorage();

    const pubJournal = await setNotebookPublic(storage, 'notebook/journal', true);
    expect(pubJournal.public).toBe(true);
    const pubCustom = await setNotebookPublic(storage, 'notebook/custom', true);
    expect(pubCustom.public).toBe(true);
    const pubPlayground = await setNotebookPublic(storage, 'notebook/playground', true);
    expect(pubPlayground.public).toBe(true);

    await expect(setNotebookPublic(storage, 'notebook/defaults', true)).rejects.toThrow(/cannot be published|read-only|private/i);
    await expect(setNotebookPublic(storage, 'notebook/guides', true)).rejects.toThrow(/cannot be published|read-only|private/i);
    await expect(setNotebookPublic(storage, 'notebook/efforts', true)).rejects.toThrow(/cannot be published|read-only|private/i);
    await expect(setNotebookPublic(storage, 'notebook/equipment', true)).rejects.toThrow(/cannot be published|read-only|private/i);
    await expect(setNotebookPublic(storage, 'notebook/dashboards', true)).rejects.toThrow(/cannot be published|read-only|private/i);

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

  it('WW-111: setNoteNotebooks moves a Note from source notebook A to target notebook B, stripping stale links and notebook: tags with 0 duplicates', async () => {
    const storage = createRealSqlStorage();
    const raw = '# Starter Workout\n\n```time\n10 Push-ups\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const note: Note = {
      id: '01950000-0000-7000-8000-000000000199',
      title: 'Starter Workout',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      createdAt: 1000,
      type: 'note',
      notebookId: 'notebook/source-a',
      notebookIds: ['notebook/source-a'],
      tags: ['notebook:source-a', 'strength'],
      seedOrigin: 'user',
    };
    await storage.readwrite('notes').put(note);
    await promoteNoteToNotebooks(storage, {
      noteId: note.id,
      notebookIds: ['notebook/source-a'],
    });

    const moved = await setNoteNotebooks(storage, {
      noteId: note.id,
      notebookIds: ['notebook/target-b'],
    });
    expect(moved).toEqual(['notebook/target-b']);
    expect(await getNoteNotebooks(storage, note.id)).toEqual(['notebook/target-b']);

    const stored = await storage.readonly('notes').get(note.id);
    expect(stored?.notebookId).toBe('notebook/target-b');
    expect(stored?.notebookIds).toEqual(['notebook/target-b']);
    expect(stored?.tags).toEqual(['strength']);

    const sourceLinks = await storage.readonly('notebook_links').getAllFromIndex('by-notebook', 'notebook/source-a');
    expect(sourceLinks.filter((l) => l.noteId === note.id)).toEqual([]);

    const allNotes = await storage.readonly('notes').getAll();
    expect(allNotes.filter((n) => n.title === 'Starter Workout')).toHaveLength(1);

    await storage.close();
  });
});
