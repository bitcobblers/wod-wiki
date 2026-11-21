import { describe, expect, it } from 'vitest';
import {
  KNOWN_SECTION_WIDGETS,
  blockContentId,
  ensurePinnedExternalWorkout,
  forkNoteToUserNotebook,
  logSessionAgainstExternalWorkout,
  parseDocumentSections,
  prepareJournalSessionRun,
  reconcileNoteBlocks,
  resolveNoteOwnership,
  resolveUpstreamProvenance,
  type Note,
} from '../src/index';
import { SqlStorage, libsqlDatabase } from '@bitcobblers/wod-wiki-storage/sql';
import { createClient } from '@libsql/client';

function createRealSqlStorage(): SqlStorage {
  return new SqlStorage(libsqlDatabase(createClient({ url: ':memory:' })));
}

describe('External-Workout Session Intake, Single Archival Pinning & User Forking', () => {
  it('promotes a read-only Feed Note in place with retention: session-pinned, aggregates repeated sessions onto its canonical ID, and preserves version history across upstream updates/archiving', async () => {
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

    // Run 1: prepare run for the SECOND workout block ('800m Run')
    const intake = await prepareJournalSessionRun(storage, {
      noteId: seedNote.id,
      blockId: secondBlock.id,
      sessionId: 'sess-dt-run-1',
      journalDate: '2026-11-10',
      startedAt: 50_000,
    });

    expect(intake.clonedFromReadOnly).toBe(false);
    expect(intake.pinnedExternalWorkout).toBe(true);
    expect(intake.note.id).toBe(seedNote.id);
    expect(intake.note.retention).toBe('session-pinned');
    expect(intake.note.upstreamStatus).toBe('live');
    expect(intake.note.seedOrigin).toBe('seed');
    expect(intake.note.feedOrigin).toBe('feed');
    expect(intake.note.rawContent).toBe(upstreamRaw);
    expect(intake.note.provenance).toMatchObject({
      sourceNoteId: seedNote.id,
      sourceVersion: 4,
      sourceCommit: 'abc12345',
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-heroes',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });

    // WW-052: preparing a run at the Ready-to-Start gate must not persist a 0s phantom session row or spawn extra Notes.
    expect(await storage.readonly('notes').getAll()).toHaveLength(1);
    expect(await storage.readonly('sessions').getAllFromIndex('by-note', seedNote.id)).toHaveLength(0);

    // Session pins the canonical external Note and links to the 2026-11-10 Journal Page
    expect(intake.session.noteId).toBe(seedNote.id);
    expect(intake.session.notebookIds).toContain('notebook/journal');
    expect(intake.revision.rawContent).toContain('800m Run');
    const pages = await storage.readonly('page').getAllFromIndex('by-date', '2026-11-10');
    expect(pages).toHaveLength(1);
    expect(intake.session.pageId).toBe(pages[0]!.id);

    // Log two completed sessions via logSessionAgainstExternalWorkout -> both aggregate on seedNote.id with zero duplicate Notes
    const logged1 = await logSessionAgainstExternalWorkout(storage, {
      noteId: seedNote.id,
      blockId: secondBlock.id,
      sessionId: 'sess-dt-run-1',
      journalDate: '2026-11-10',
      startedAt: 50_000,
      durationMs: 185_000,
    });
    const logged2 = await logSessionAgainstExternalWorkout(storage, {
      noteId: seedNote.id,
      blockId: secondBlock.id,
      sessionId: 'sess-dt-run-2',
      journalDate: '2026-11-12',
      startedAt: 90_000,
      durationMs: 170_000,
    });

    expect(logged1.session.noteId).toBe(seedNote.id);
    expect(logged2.session.noteId).toBe(seedNote.id);
    expect(await storage.readonly('notes').getAll()).toHaveLength(1);
    const sessionsForNote = await storage.readonly('sessions').getAllFromIndex('by-note', seedNote.id);
    expect(sessionsForNote.map((s) => s.id).sort()).toEqual(['sess-dt-run-1', 'sess-dt-run-2']);

    const journalLinks = await storage.readonly('notebook_links').getAllFromIndex('by-notebook', 'notebook/journal');
    expect(journalLinks.filter((l) => l.targetKind === 'session').map((l) => l.targetId).sort()).toEqual([
      'sess-dt-run-1',
      'sess-dt-run-2',
    ]);

    // Live provenance resolves while upstream is live
    const liveLink = await resolveUpstreamProvenance(storage, logged1.note);
    expect(liveLink).toMatchObject({
      exists: true,
      sourceNoteId: seedNote.id,
      sourceVersion: 4,
      upstreamStatus: 'live',
    });

    // Upstream Feed updates DT to v5 -> prior BlockRevision v1 stays intact for pinned sessions
    const updatedUpstreamRaw = upstreamRaw.replace('800m Run', '1600m Run');
    const v5Blocks = reconcileNoteBlocks(updatedUpstreamRaw, { sourceRevision: 2 });
    await storage.transaction(['notes', 'block_revisions'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        ...logged1.note,
        rawContent: updatedUpstreamRaw,
        sourceRevision: 2,
        blocks: v5Blocks,
        seedVersion: 5,
      });
      for (const b of Object.values(v5Blocks)) {
        await tx.readwrite('block_revisions').put({
          noteId: seedNote.id,
          blockId: b.id,
          version: 2,
          kind: b.kind,
          rawContent: updatedUpstreamRaw.slice(b.from, b.to),
          savedAt: 60_000,
          dialect: b.dialect,
        });
      }
    });
    const pinnedRev1 = await storage.readonly('block_revisions').get([seedNote.id, secondBlock.id, 1]);
    expect(pinnedRev1?.rawContent).toContain('800m Run');

    // Feed unsubscribed -> archival note remains intact with upstreamStatus: 'unsubscribed' ('feed-archived')
    const archivedNote: Note = {
      ...(await storage.readonly('notes').get(seedNote.id))!,
      upstreamStatus: 'unsubscribed',
    };
    await storage.readwrite('notes').put(archivedNote);
    expect(resolveNoteOwnership(archivedNote).kind).toBe('feed-archived');
    const linkAfterUnsub = await resolveUpstreamProvenance(storage, archivedNote);
    expect(linkAfterUnsub).toMatchObject({
      exists: false,
      sourceNoteId: seedNote.id,
      sourceVersion: 4,
      sourceNotebookId: 'notebook/crossfit-heroes',
      upstreamStatus: 'unsubscribed',
    });

    await storage.close();
  });

  it('materializes a single canonical archival copy from a remote:<feedId>:<uuid> payload lazily and reuses it across runs', async () => {
    const storage = createRealSqlStorage();
    const remoteMd = '# Fran\n\n```time\n21-15-9\n  Thrusters 95lb\n  Pull-ups\n```\n';
    const remoteUuid = '01950000-0000-7000-8000-000000000f4a';
    const remoteId = `remote:sport-cf:${remoteUuid}`;

    let resolverCalls = 0;
    const resolveRemoteWorkout = async (id: string) => {
      resolverCalls++;
      expect(id).toBe(remoteId);
      return {
        rawContent: remoteMd,
        sourcePath: 'markdown/notebooks/crossfit-girls/fran.md',
        feedSourceId: 'sport-cf',
        seedVersion: 2,
        seedCommit: 'deadbeef',
      };
    };

    const pinned = await ensurePinnedExternalWorkout(storage, {
      noteId: remoteId,
      resolveRemoteWorkout,
      now: 10_000,
    });
    expect(resolverCalls).toBe(1);
    expect(pinned.created).toBe(true);
    expect(pinned.note.id).toBe(remoteUuid);
    expect(pinned.note.retention).toBe('session-pinned');
    expect(pinned.note.upstreamStatus).toBe('live');
    expect(pinned.note.sourceId).toBe('notebook:crossfit-girls/fran');
    expect(pinned.ownership.kind).toBe('feed');

    // Second run via remote:<feedId>:<uuid> hits local canonical copy without calling remote resolver again
    const logged = await logSessionAgainstExternalWorkout(storage, {
      noteId: remoteId,
      sessionId: 'sess-remote-fran-1',
      journalDate: '2026-11-15',
      startedAt: 20_000,
      durationMs: 195_000,
      resolveRemoteWorkout,
    });
    expect(resolverCalls).toBe(1);
    expect(logged.note.id).toBe(remoteUuid);
    expect(logged.session.noteId).toBe(remoteUuid);
    expect(await storage.readonly('notes').getAll()).toHaveLength(1);

    await storage.close();
  });

  it('forks an external Note into a writable user Notebook via forkNoteToUserNotebook and rejects system read-only targets', async () => {
    const storage = createRealSqlStorage();
    const raw = '# Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const seedNote: Note = {
      id: 'seed-cindy-001',
      title: 'Cindy',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      createdAt: 1000,
      sourceId: 'notebook:crossfit-girls/cindy',
      sourcePath: 'markdown/notebooks/crossfit-girls/cindy.md',
      seedOrigin: 'seed',
      seedVersion: 3,
      feedOrigin: 'feed',
      feedSourceId: 'sport-cf',
    };
    await storage.readwrite('notes').put(seedNote);

    await expect(
      forkNoteToUserNotebook(storage, seedNote.id, 'notebook/defaults'),
    ).rejects.toThrow(/read-only/i);
    await expect(
      forkNoteToUserNotebook(storage, seedNote.id, 'notebook/guides'),
    ).rejects.toThrow(/read-only/i);

    const forked = await forkNoteToUserNotebook(storage, seedNote.id, 'notebook/my-benchmarks', {
      now: 25_000,
    });
    expect(forked.id).not.toBe(seedNote.id);
    expect(forked.seedOrigin).toBe('user');
    expect(forked.feedOrigin).toBeUndefined();
    expect(forked.notebookId).toBe('notebook/my-benchmarks');
    expect(forked.notebookIds).toEqual(['notebook/journal', 'notebook/my-benchmarks']);
    expect(forked.provenance).toMatchObject({
      sourceNoteId: seedNote.id,
      sourceVersion: 3,
      feedSourceId: 'sport-cf',
      sourceNotebookId: 'notebook/crossfit-girls',
    });

    const ownership = resolveNoteOwnership(forked);
    expect(ownership.kind).toBe('user');
    expect(ownership.editable).toBe(true);
    expect(ownership.canPublish).toBe(true);

    const revs = await storage.readonly('block_revisions').getAllFromIndex('by-note', forked.id);
    expect(revs).toHaveLength(1);
    const links = await storage.readonly('notebook_links').getAllFromIndex('by-note', forked.id);
    expect(links.map((l) => l.notebookId).sort()).toEqual(['notebook/journal', 'notebook/my-benchmarks']);

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
    expect(intake.pinnedExternalWorkout).toBe(false);
    expect(intake.note.id).toBe(pgNote.id);
    expect(intake.session.noteId).toBe(pgNote.id);
    expect(intake.session.origin).toBe('playground');
    expect(intake.note.notebookIds).toContain('notebook/journal');
    expect(intake.note.notebookIds).toContain('notebook/playground');

    await storage.close();
  });

  it('resolves external workout block by blockContentId when editor blockId differs, while still rejecting unknown blockId without matching contentId', async () => {
    const storage = createRealSqlStorage();
    const raw = '# Grace\n\n```time\n30 Clean & Jerks 135lb\n```\n';
    const blocks = reconcileNoteBlocks(raw, { sourceRevision: 1 });
    const wod = Object.values(blocks).find((b) => b.kind === 'wod')!;
    const sec = parseDocumentSections(raw, { registeredWidgets: KNOWN_SECTION_WIDGETS }).find(
      (s) => s.scriptBlock,
    )!;
    const contentHash = sec.scriptBlock!.contentId ?? blockContentId(sec.scriptBlock!.content);

    const feedNote: Note = {
      id: 'feed-grace-001',
      title: 'Grace',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      createdAt: 1000,
      sourceId: 'notebook:crossfit-girls/grace',
      sourcePath: 'markdown/notebooks/crossfit-girls/grace.md',
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-cf',
    };
    await storage.readwrite('notes').put(feedNote);

    // Mismatched editor UUID + valid blockContentId resolves cleanly to the canonical stored block
    const prepared = await prepareJournalSessionRun(storage, {
      noteId: feedNote.id,
      blockId: 'ephemeral-editor-uuid',
      blockContentId: contentHash,
      sessionId: 'sess-grace-cid-1',
      journalDate: '2026-11-16',
      startedAt: 5000,
    });
    expect(prepared.session.blockId).toBe(wod.id);
    expect(prepared.session.blockContentId).toBe(contentHash);
    expect(prepared.pinnedExternalWorkout).toBe(true);

    const logged = await logSessionAgainstExternalWorkout(storage, {
      noteId: feedNote.id,
      blockId: 'ephemeral-editor-uuid-2',
      blockContentId: contentHash,
      sessionId: 'sess-grace-cid-2',
      journalDate: '2026-11-16',
      startedAt: 6000,
      durationMs: 120_000,
    });
    expect(logged.session.blockId).toBe(wod.id);

    // Unknown blockId WITHOUT matching blockContentId still throws
    await expect(
      prepareJournalSessionRun(storage, {
        noteId: feedNote.id,
        blockId: 'bogus-block-id',
        sessionId: 'sess-grace-fail-1',
      }),
    ).rejects.toThrow(/unavailable/i);

    await expect(
      prepareJournalSessionRun(storage, {
        noteId: feedNote.id,
        blockId: 'bogus-block-id',
        blockContentId: 'non-matching-content-id',
        sessionId: 'sess-grace-fail-2',
      }),
    ).rejects.toThrow(/unavailable/i);

    // Editable user notes still require exact blockId even if blockContentId matches
    const userNote: Note = {
      id: 'user-grace-local',
      title: 'My Grace',
      rawContent: raw,
      sourceRevision: 1,
      blocks,
      createdAt: 2000,
      type: 'journal',
      seedOrigin: 'user',
    };
    await storage.readwrite('notes').put(userNote);
    await expect(
      prepareJournalSessionRun(storage, {
        noteId: userNote.id,
        blockId: 'ephemeral-editor-uuid',
        blockContentId: contentHash,
        sessionId: 'sess-user-fail',
      }),
    ).rejects.toThrow(/unavailable/i);

    await storage.close();
  });
});
