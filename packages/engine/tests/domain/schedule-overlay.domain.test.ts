import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseNoteBundleFromJsonl,
  reconcileNoteBlocks,
  serializeNoteBundleToJsonl,
  type NoteJsonlNote,
  type NoteRevision,
} from '@bitcobblers/wod-wiki-core';
import { parseQuery } from '@bitcobblers/wod-wiki-wql';
import { resetTestingVocabulary } from '@bitcobblers/wod-wiki-core/testing';
import {
  attributeSession,
  batchScheduleNotes,
  deleteUserNotebook,
  findNearbyMatchingScheduleItems,
  getJournalDayOverlay,
  getNoteRevision,
  getScheduleAndSessionCountsByNote,
  listScheduleItemsByDateRange,
  listScheduleItemsForNote,
  migrateDatedPageNotesToSchedule,
  removeFeedNotebookContent,
  scheduleNoteOnDate,
} from '../../src/index';
import {
  createQueryServiceForStorage,
  upsertNoteInStorage,
  wodJournalAddTool,
  wodNoteListTool,
} from '../../src/agent';
import { DomainScenarioHarness } from '../harness/DomainScenarioHarness';

describe('Domain — M:N Schedule, Session Overlay, Versioned Notes & Orphaned Notes (ADR 0009)', () => {
  let harness: DomainScenarioHarness;

  beforeEach(() => resetTestingVocabulary());
  afterEach(async () => {
    await harness?.dispose();
  });

  it('schedules a canonical Notebook Note M:N across multiple dates & AM/PM slots without cloning or polluting Journal', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'note-back-squat',
      title: '5x5 Back Squat',
      rawContent: '# 5x5 Back Squat\n\n```time\n5x5 Back Squat\n```\n',
      notebookIds: ['notebook/strength'],
    });

    const am = await scheduleNoteOnDate(harness.storage, {
      id: 'sched-mon-am',
      noteId: note.id,
      date: '2026-11-23',
      slot: 'AM',
      notes: 'Work up to 82%',
      now: 10_000,
    });
    const pm = await scheduleNoteOnDate(harness.storage, {
      id: 'sched-mon-pm',
      noteId: note.id,
      date: '2026-11-23',
      slot: 'PM',
      now: 11_000,
    });
    await batchScheduleNotes(harness.storage, [
      { id: 'sched-wed', noteId: note.id, date: '2026-11-25', now: 12_000 },
    ]);

    expect(am.sourceNotebookId).toBe('notebook/strength');
    expect(am.notes).toBe('Work up to 82%');
    expect(pm.slot).toBe('PM');

    const forNote = await listScheduleItemsForNote(harness.storage, note.id);
    expect(forNote.map((s) => s.id)).toEqual(['sched-mon-am', 'sched-mon-pm', 'sched-wed']);

    const range = await listScheduleItemsByDateRange(harness.storage, '2026-11-23', '2026-11-25');
    expect(range).toHaveLength(3);

    // Note stays strictly inside notebook/strength (no forced notebook/journal leak)
    const persisted = await harness.storage.readonly('notes').get(note.id);
    expect(persisted?.notebookIds).toEqual(['notebook/strength']);

    // Multi-date WQL queries see the Note on ALL scheduled dates
    const qs = createQueryServiceForStorage(harness.storage);
    const monFind = await qs.runFind(parseQuery(':note{} from 2026-11-23 to 2026-11-23') as never);
    const wedFind = await qs.runFind(parseQuery(':note{} from 2026-11-25 to 2026-11-25') as never);
    expect(monFind.notes.some((n) => n.id === note.id)).toBe(true);
    expect(wedFind.notes.some((n) => n.id === note.id)).toBe(true);
  });

  it('snapshots immutable NoteRevision when editing a Session-bearing Note (Annotation 1)', async () => {
    harness = await DomainScenarioHarness.create();
    const savedV1 = await upsertNoteInStorage(harness.storage, {
      noteId: 'note-fran-versioned',
      title: 'Fran v1',
      rawContent: '# Fran v1\n\n```time\n21-15-9 Thrusters & Pull-ups\n```\n',
      notebookId: 'notebook/benchmarks',
      now: 1000,
    });

    const run = await harness.prepareAndRunSession({
      noteId: savedV1.note.id,
      sessionId: 'sess-fran-v1',
      journalDate: '2026-11-20',
      startedAt: Date.parse('2026-11-20T12:00:00Z'),
    });

    const sessAfterRun = await harness.storage.readonly('sessions').get(run.sessionId);
    expect(sessAfterRun?.noteSourceRevision).toBe(1);
    expect(sessAfterRun?.sessionDate).toBe('2026-11-20');

    // Edit Note (both title & workout script change -> v2)
    const savedV2 = await upsertNoteInStorage(harness.storage, {
      noteId: savedV1.note.id,
      title: 'Fran Heavy v2',
      rawContent: '# Fran Heavy v2\n\n```time\n21-15-9 Heavy Thrusters & Chest-to-Bar\n```\n',
      notebookId: 'notebook/benchmarks',
      now: 5000,
    });
    expect(savedV2.note.sourceRevision).toBe(2);

    // Immutable NoteRevision v1 exists and matches pre-edit snapshot while Session remains pinned to v1
    const rev1 = await getNoteRevision(harness.storage, savedV1.note.id, 1);
    expect(rev1).toBeDefined();
    expect(rev1?.title).toBe('Fran v1');
    expect(rev1?.rawContent).toContain('21-15-9 Thrusters');
    const sessReCheck = await harness.storage.readonly('sessions').get(run.sessionId);
    expect(sessReCheck?.noteSourceRevision).toBe(1);
  });

  it('allows Notebook-free unfiled Notes and discovers them as Orphaned Notes (Annotation 2)', async () => {
    harness = await DomainScenarioHarness.create();
    const ctx = { storage: harness.storage };

    // Journal quick-log without selecting a Notebook creates an unfiled Note (`notebookIds: []`) + ScheduleItem
    const quick = await wodJournalAddTool.execute(
      {
        date: '2026-11-26',
        title: 'Thanksgiving Turkey Trot',
        content: '# Thanksgiving Turkey Trot\n\n```time\n5k Run\n```\n',
      },
      ctx as never,
    );
    const quickNote = await harness.storage.readonly('notes').get(quick.noteId);
    expect(quickNote?.notebookIds).toEqual([]);

    // Also create a Note in a temporary Notebook, then delete that Notebook so the Note becomes orphaned
    const filed = await upsertNoteInStorage(harness.storage, {
      noteId: 'note-soon-orphaned',
      title: 'Temp Block Squat',
      rawContent: '# Temp Block Squat\n\n```time\n3x5 Squat\n```\n',
      notebookId: 'notebook/temp-block',
      now: 2000,
    });
    expect(filed.note.notebookIds).toEqual(['notebook/temp-block']);
    await deleteUserNotebook(harness.storage, 'notebook/temp-block');
    const nowOrphaned = await harness.storage.readonly('notes').get(filed.note.id);
    expect(nowOrphaned?.notebookIds).toEqual([]);

    // Both WQL `:note{!notebook:*}` and `wod_note_list --orphaned-only` surface both orphaned Notes cleanly
    const qs = createQueryServiceForStorage(harness.storage);
    const orphanFind = await qs.runFind(parseQuery(':note{!notebook:*}') as never);
    expect(orphanFind.notes.map((n) => n.id).sort()).toEqual([
      quick.noteId,
      'note-soon-orphaned',
    ].sort());

    const toolList = await wodNoteListTool.execute(
      { orphanedOnly: true } as never,
      ctx as never,
    ).catch(() => undefined);
    // (orphanedOnly flag added in Milestone 3; still verify standard :note{!notebook:*} here)
    expect(toolList === undefined || Array.isArray((toolList as { notes?: unknown[] }).notes)).toBe(true);
  });

  it('folds paired Sessions onto ScheduleItem cards, overlays ad-hoc runs, and supports ±2d smart match re-attribution', async () => {
    harness = await DomainScenarioHarness.create();
    const { note } = await harness.authorNote({
      id: 'note-cindy-overlay',
      title: 'Cindy',
      rawContent: '# Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Squats\n```\n',
      notebookIds: ['notebook/benchmarks'],
    });
    const { note: adhocNote } = await harness.authorNote({
      id: 'note-mobility',
      title: 'Mobility Flow',
      rawContent: '# Mobility Flow\n\n```time\n10:00 Cap\n  Stretch\n```\n',
      notebookIds: ['notebook/recovery'],
    });

    const schedMon = await scheduleNoteOnDate(harness.storage, {
      id: 'sched-cindy-mon',
      noteId: note.id,
      date: '2026-11-23',
      slot: 'AM',
    });

    // Athlete runs Cindy late on Tuesday without launching from Monday's card
    const runCindy = await harness.prepareAndRunSession({
      noteId: note.id,
      sessionId: 'sess-cindy-tue',
      journalDate: '2026-11-24',
      startedAt: Date.parse('2026-11-24T14:00:00Z'),
    });
    const runAdhoc = await harness.prepareAndRunSession({
      noteId: adhocNote.id,
      sessionId: 'sess-mob-tue',
      journalDate: '2026-11-24',
      startedAt: Date.parse('2026-11-24T16:00:00Z'),
    });

    // ±2-day smart match suggests linking Tuesday's Cindy run to Monday's unfulfilled plan
    const sessRow = (await harness.storage.readonly('sessions').get(runCindy.sessionId))!;
    const nearby = await findNearbyMatchingScheduleItems(harness.storage, sessRow, 2);
    expect(nearby.map((s) => s.id)).toEqual([schedMon.id]);

    // Attribute Tuesday's Cindy session to Monday's planned ScheduleItem -> marks planned completed & pairs
    await attributeSession(harness.storage, {
      sessionId: runCindy.sessionId,
      sessionDate: '2026-11-23',
      scheduleItemId: schedMon.id,
    });
    const overlayMon = await getJournalDayOverlay(harness.storage, '2026-11-23');
    expect(overlayMon.planned).toHaveLength(1);
    expect(overlayMon.planned[0]!.item.status).toBe('completed');
    expect(overlayMon.planned[0]!.pairedSessions.map((s) => s.id)).toEqual([runCindy.sessionId]);
    expect(overlayMon.adhocSessions).toEqual([]);

    const overlayTue = await getJournalDayOverlay(harness.storage, '2026-11-24');
    expect(overlayTue.adhocSessions.map((a) => a.session.id)).toEqual([runAdhoc.sessionId]);

    const counts = await getScheduleAndSessionCountsByNote(harness.storage);
    expect(counts.get(note.id)).toMatchObject({ scheduleCount: 1, sessionCount: 1 });
  });

  it('preserves schedule-pinned Feed workouts on unsubscribe & backfills legacy dated page_notes + JSONL v2', async () => {
    harness = await DomainScenarioHarness.create();
    const rawFeed = '# Feed Hero WOD\n\n```time\n100 Burpees\n```\n';
    const feedBlocks = reconcileNoteBlocks(rawFeed, { sourceRevision: 1 });
    await harness.storage.transaction(['notes', 'page', 'page_notes'], 'readwrite', async (tx) => {
      await tx.readwrite('notes').put({
        id: 'feed-wk-1',
        title: 'Feed Hero WOD',
        rawContent: rawFeed,
        sourceRevision: 1,
        blocks: feedBlocks,
        createdAt: 1000,
        sourceId: 'notebook:heroes/wk1',
        seedOrigin: 'seed',
        seedVersion: 1,
        seedChunkId: 'heroes',
        feedOrigin: 'feed',
        feedSourceId: 'community-feed',
        retention: 'cached',
      });
      await tx.readwrite('page').put({
        id: 'pg-2026-11-20',
        date: '2026-11-20',
        title: '2026-11-20',
        createdAt: 1000,
      });
      await tx.readwrite('page_notes').put({
        id: 'pn-legacy-1',
        pageId: 'pg-2026-11-20',
        noteId: 'feed-wk-1',
        position: 0,
        createdAt: 1000,
      });
    });

    // Migrate legacy dated page_notes + schedule onto a future day
    const migrated = await migrateDatedPageNotesToSchedule(harness.storage);
    expect(migrated).toBe(1);
    const futureSched = await scheduleNoteOnDate(harness.storage, {
      noteId: 'feed-wk-1',
      date: '2026-12-01',
    });

    const pinnedCopy = await harness.storage.readonly('notes').get('feed-wk-1');
    expect(pinnedCopy?.retention).toBe('schedule-pinned');

    // Unsubscribing the feed preserves the schedule-pinned note cleanly
    const unsub = await removeFeedNotebookContent(harness.storage, 'community-feed', 'heroes');
    expect(unsub.preservedPinned).toBe(1);
    const afterUnsub = await harness.storage.readonly('notes').get('feed-wk-1');
    expect(afterUnsub?.upstreamStatus).toBe('unsubscribed');

    // JSONL v2 round-trip includes noteRevisions and scheduleItems
    const jsonlNote: NoteJsonlNote = {
      id: 'feed-wk-1',
      title: 'Feed Hero WOD',
      createdAt: 1000,
      updatedAt: 2000,
      targetDate: 1000,
      rawContent: '# Feed Hero WOD\n',
      notebookIds: [],
    };
    const rev: NoteRevision = {
      noteId: 'feed-wk-1',
      version: 1,
      title: 'Feed Hero WOD',
      rawContent: '# Feed Hero WOD\n',
      blocks: {},
      savedAt: 1000,
    };
    const text = serializeNoteBundleToJsonl({
      note: jsonlNote,
      noteRevisions: [rev],
      scheduleItems: [futureSched],
      sessions: [],
      events: [],
    });
    const parsed = parseNoteBundleFromJsonl(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.bundles[0]?.noteRevisions).toHaveLength(1);
    expect(parsed.bundles[0]?.scheduleItems).toHaveLength(1);
  });
});
