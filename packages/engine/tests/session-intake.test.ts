import { describe, expect, it } from 'vitest';
import {
  prepareJournalSessionRun,
  reconcileNoteBlocks,
  resolveUpstreamProvenance,
  type Note,
} from '../src/index';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';

function createRealSqlStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

describe('Candidate 01 — Journal Session Intake & Upstream Provenance', () => {
  it('clones a read-only Feed Note verbatim into notebook/journal on run, pins the Session to the exact block occurrence, and preserves permanent version history across upstream updates and deletion', async () => {
    const storage = createRealSqlStorage();

    const upstreamRaw = [
      '---',
      'title: Hero DT + Cashout',
      'discipline: weightlifting',
      '---',
      '',
      '# Hero DT + Cashout',
      '',
      'Coach stimulus: unbroken barbell cycling.',
      '',
      '```time',
      '5 Rounds',
      '  12 Deadlifts 155lb',
      '  9 Hang Power Cleans 155lb',
      '  6 Push Jerks 155lb',
      '```',
      '',
      '```time',
      '800m Run',
      '```',
      '',
    ].join('\n');

    const blocks = reconcileNoteBlocks(upstreamRaw, { sourceRevision: 1 });
    const blockList = Object.values(blocks);
    expect(blockList).toHaveLength(2);
    const secondBlock = blockList[1]!;

    const seedNote: Note = {
      id: 'seed-dt-uuid-001',
      title: 'Hero DT + Cashout',
      rawContent: upstreamRaw,
      sourceRevision: 1,
      blocks,
      createdAt: 4,
      sourceId: 'notebook:crossfit-heroes/dt',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
      seedOrigin: 'seed',
      seedVersion: 4,
      seedChunkId: 'notebook.crossfit-heroes',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      seedCommit: 'abc12345',
    };

    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(seedNote);
      for (const b of blockList) {
        await tx.readwrite('block_revisions').put({
          noteId: seedNote.id,
          blockId: b.id,
          version: 1,
          kind: b.kind,
          rawContent: upstreamRaw.slice(b.from, b.to),
          savedAt: 1000,
          dialect: b.dialect,
        });
      }
    });

    // Run the SECOND workout block ('800m Run') on the read-only Feed Note
    const intake = await prepareJournalSessionRun(storage, {
      noteId: seedNote.id,
      blockId: secondBlock.id,
      sessionId: 'sess-dt-run-1',
      journalDate: '2026-11-10',
      startedAt: 50_000,
    });

    expect(intake.clonedFromReadOnly).toBe(true);
    expect(intake.note.id).not.toBe(seedNote.id);
    // Full Markdown (frontmatter, coach prose, and BOTH blocks) is preserved verbatim
    expect(intake.note.rawContent).toBe(upstreamRaw);
    expect(intake.note.notebookIds).toContain('notebook/journal');
    expect(intake.note.seedOrigin).toBe('user');
    expect(intake.note.feedOrigin).toBeUndefined();
    expect(intake.note.provenance).toMatchObject({
      sourceNoteId: seedNote.id,
      sourceVersion: 4,
      sourceCommit: 'abc12345',
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-heroes',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });

    // Session is pinned to the Journal clone's SECOND block, never the upstream Seed Note
    expect(intake.session.noteId).toBe(intake.note.id);
    expect(intake.revision.rawContent).toContain('800m Run');
    expect(await storage.readonly('sessions').getAllFromIndex('by-note', seedNote.id)).toHaveLength(0);
    expect(await storage.readonly('sessions').getAllFromIndex('by-note', intake.note.id)).toHaveLength(1);

    // Placed onto the 2026-11-10 Journal Page
    const pages = await storage.readonly('page').getAllFromIndex('by-date', '2026-11-10');
    expect(pages).toHaveLength(1);
    const pageLinks = await storage.readonly('page_notes').getAllFromIndex('by-note', intake.note.id);
    expect(pageLinks.map((l) => l.pageId)).toEqual([pages[0]!.id]);

    // Live provenance link resolves while upstream Note exists
    const liveLink = await resolveUpstreamProvenance(storage, intake.note);
    expect(liveLink).toMatchObject({
      exists: true,
      sourceNoteId: seedNote.id,
      title: 'Hero DT + Cashout',
      sourceVersion: 4,
    });

    // Upstream Feed updates DT to version 5 with modified text -> Journal clone & Session revision stay pinned to v4!
    const updatedUpstreamRaw = upstreamRaw.replace('800m Run', '1600m Run');
    const v5Blocks = reconcileNoteBlocks(updatedUpstreamRaw, { sourceRevision: 2 });
    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        ...seedNote,
        rawContent: updatedUpstreamRaw,
        sourceRevision: 2,
        blocks: v5Blocks,
        seedVersion: 5,
      });
      for (const b of Object.values(v5Blocks)) {
        await tx.readwrite('block_revisions').put({
          noteId: seedNote.id,
          blockId: b.id,
          version: b.version,
          kind: b.kind,
          rawContent: updatedUpstreamRaw.slice(b.from, b.to),
          savedAt: 60_000,
          dialect: b.dialect,
        });
      }
    });

    const journalCopyAfterSync = await storage.readonly('notes').get(intake.note.id);
    expect(journalCopyAfterSync?.rawContent).toContain('800m Run');
    expect(journalCopyAfterSync?.rawContent).not.toContain('1600m Run');
    const linkAfterUpdate = await resolveUpstreamProvenance(storage, journalCopyAfterSync!);
    expect(linkAfterUpdate?.exists).toBe(true);
    expect(linkAfterUpdate?.currentUpstreamVersion).toBe(5);

    // Upstream Feed is unsubscribed and original Seed Note is deleted -> Journal clone & Session remain intact; provenance reports exists: false
    await storage.readwrite('notes').delete(seedNote.id);
    const linkAfterDelete = await resolveUpstreamProvenance(storage, journalCopyAfterSync!);
    expect(linkAfterDelete).toMatchObject({
      exists: false,
      sourceNoteId: seedNote.id,
      sourceVersion: 4,
      sourceNotebookId: 'notebook/crossfit-heroes',
    });

    await storage.close();
  });

  it('records Sessions in place without duplicating when running an editable user Journal or Playground Note', async () => {
    const storage = createRealSqlStorage();
    const raw = '# Scratch EMOM\n\n```time\n10:00 EMOM\n  5 Burpees\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wod = Object.values(blocks)[0]!;

    const pgNote: Note = {
      id: 'pg-user-note-1',
      title: 'Scratch EMOM',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      createdAt: 1000,
      type: 'playground',
      sourceId: 'playground',
      seedOrigin: 'user',
    };
    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put(pgNote);
      await tx.readwrite('block_revisions').put({
        noteId: pgNote.id,
        blockId: wod.id,
        version: 1,
        kind: 'wod',
        rawContent: raw.slice(wod.from, wod.to),
        savedAt: 1000,
        dialect: 'time',
      });
    });

    const intake = await prepareJournalSessionRun(storage, {
      noteId: pgNote.id,
      blockId: wod.id,
      sessionId: 'sess-pg-1',
      startedAt: 2000,
    });

    expect(intake.clonedFromReadOnly).toBe(false);
    expect(intake.note.id).toBe(pgNote.id);
    expect(intake.session.noteId).toBe(pgNote.id);
    expect(intake.session.origin).toBe('playground');
    expect(intake.note.notebookIds).toContain('notebook/journal');
    expect(intake.note.notebookIds).toContain('notebook/playground');

    await storage.close();
  });
});
