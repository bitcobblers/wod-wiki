import { afterEach, describe, expect, it } from 'vitest';
import { forkNoteToUserNotebook, resolveNoteOwnership } from '../../src/index';
import { DomainScenarioHarness, HARNESS_EPOCH } from '../harness/DomainScenarioHarness';

/** `:session{}` run-card slice the assertions read. */
interface SessionFindResult {
  runs: Array<{ resultId: string; noteId: string }>;
}

describe('Domain — Journal Session intake, archival pinning, provenance & EventRecord persistence', () => {
  let harness: DomainScenarioHarness;
  afterEach(() => harness?.dispose());

  const heroRaw = [
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

  it('pins a read-only Feed Note in place as one immutable archival copy on run, aggregates repeated sessions on its canonical ID, and persists EventRecords', async () => {
    harness = await DomainScenarioHarness.create();

    // A read-only Note delivered by a subscribed Feed, carrying two workout blocks.
    const seed = await harness.authorNote({
      id: 'seed-dt',
      title: 'Hero DT + Cashout',
      rawContent: heroRaw,
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      sourceId: 'notebook:crossfit-heroes/dt',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });
    const wodBlocks = seed.blockIndex.filter((row) => row.dataType === 'wod');
    expect(wodBlocks).toHaveLength(2);

    // Run the SECOND workout block (the 800m Run cashout).
    const run = await harness.prepareAndRunSession({
      noteId: seed.note.id,
      blockId: wodBlocks[1]!.blockId,
      sessionId: 'sess-dt-run-1',
      journalDate: '2026-11-10',
      startedAt: HARNESS_EPOCH + 50_000,
    });

    // Single archival copy: no duplicate Journal Note was spawned.
    expect(run.clonedFromReadOnly).toBe(false);
    expect(run.pinnedExternalWorkout).toBe(true);
    expect(run.noteId).toBe(seed.note.id);
    const pinnedNote = await harness.storage.readonly('notes').get(run.noteId);
    expect(pinnedNote?.rawContent).toBe(heroRaw);
    expect(pinnedNote?.retention).toBe('session-pinned');
    expect(pinnedNote?.upstreamStatus).toBe('live');
    expect(pinnedNote?.seedOrigin).toBe('seed');
    expect(pinnedNote?.feedOrigin).toBe('feed');
    expect(await harness.storage.readonly('notes').getAll()).toHaveLength(1);

    // Note Provenance lineage points at the upstream Feed source.
    expect(run.provenance).toMatchObject({
      sourceNoteId: seed.note.id,
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-heroes',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });

    // The Session pins the canonical Note ID and links to today's Journal Page + notebook/journal.
    expect(run.session.noteId).toBe(seed.note.id);
    expect(run.session.completed).toBe(true);
    expect(run.session.notebookIds).toContain('notebook/journal');
    const pages = await harness.storage.readonly('page').getAllFromIndex('by-date', '2026-11-10');
    expect(pages).toHaveLength(1);
    expect(run.session.pageId).toBe(pages[0]!.id);

    // Second run on the same Feed workout aggregates onto the exact same canonical Note ID.
    const run2 = await harness.prepareAndRunSession({
      noteId: seed.note.id,
      blockId: wodBlocks[1]!.blockId,
      sessionId: 'sess-dt-run-2',
      journalDate: '2026-11-11',
      startedAt: HARNESS_EPOCH + 90_000,
    });
    expect(run2.noteId).toBe(seed.note.id);
    expect(await harness.storage.readonly('notes').getAll()).toHaveLength(1);

    const canonicalSessions = await harness.storage.readonly('sessions').getAllFromIndex('by-note', seed.note.id);
    expect(canonicalSessions.map((s) => s.id).sort()).toEqual(['sess-dt-run-1', 'sess-dt-run-2']);

    // EventRecords persisted from the real runtime run — the 800m distance survives.
    expect(run.events.length).toBeGreaterThan(0);
    const allEvents = await harness.storage.readonly('events').getAll();
    expect(allEvents.length).toBeGreaterThan(0);
    expect(allEvents.some((e) => e.noteId === seed.note.id && e.resultId === 'sess-dt-run-1')).toBe(true);
    const distanceEvent = allEvents.find((e) => e.metrics.some((m) => m.type === 'distance'));
    expect(distanceEvent).toBeDefined();
    expect(distanceEvent!.metrics.find((m) => m.type === 'distance')!.value).toEqual({ amount: 800, unit: 'm' });

    // The WQL session plane reads both runs back against the canonical workout ID.
    const found = await harness.queryWql<SessionFindResult>(':session{note:' + seed.note.id + '}');
    expect(found.runs).toHaveLength(2);
    expect(found.runs.map((r) => r.resultId).sort()).toEqual(['sess-dt-run-1', 'sess-dt-run-2']);

    // Live upstream lineage resolves while the Feed Note is live.
    expect(run.upstream).toMatchObject({ exists: true, sourceNoteId: seed.note.id, upstreamStatus: 'live' });
  });

  it('keeps BlockRevision v1 pinned when upstream updates to v2, preserves archival copy on unsubscribe, and supports explicit user forking', async () => {
    harness = await DomainScenarioHarness.create();

    const seed = await harness.authorNote({
      id: 'seed-dt',
      title: 'Hero DT + Cashout',
      rawContent: heroRaw,
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      sourceId: 'notebook:crossfit-heroes/dt',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });

    const run = await harness.prepareAndRunSession({
      noteId: seed.note.id,
      sessionId: 'sess-dt-run-1',
      journalDate: '2026-11-10',
    });

    // Upstream publishes a new version that renames the cashout.
    await harness.authorNote({
      id: 'seed-dt',
      title: 'Hero DT + Cashout',
      rawContent: heroRaw.replace('800m Run', '1600m Run'),
      sourceRevision: 2,
      priorBlocks: seed.note.blocks,
      seedOrigin: 'seed',
      feedOrigin: 'feed',
      feedSourceId: 'sport-crossfit',
      sourceId: 'notebook:crossfit-heroes/dt',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });

    // Pinned Session still points at BlockRevision v1 (pre-update text)
    const rev1 = await harness.storage.readonly('block_revisions').get([
      run.session.noteId,
      run.session.blockId,
      run.session.blockVersion,
    ]);
    expect(rev1).toBeDefined();
    expect(rev1?.version).toBe(1);

    // Archival copy stays protected across unsubscribe (`upstreamStatus: 'unsubscribed'`)
    const current = (await harness.storage.readonly('notes').get('seed-dt'))!;
    await harness.storage.readwrite('notes').put({
      ...current,
      retention: 'session-pinned',
      upstreamStatus: 'unsubscribed',
    });
    const archived = (await harness.storage.readonly('notes').get('seed-dt'))!;
    expect(resolveNoteOwnership(archived).kind).toBe('feed-archived');

    const brokenLineage = await harness.upstreamProvenance(run.noteId);
    expect(brokenLineage).toMatchObject({
      exists: false,
      sourceNoteId: 'seed-dt',
      upstreamStatus: 'unsubscribed',
    });

    // Explicit Fork to My Notes creates a separate editable user Note with full provenance
    const forked = await forkNoteToUserNotebook(harness.storage, 'seed-dt', 'notebook/my-benchmarks');
    expect(forked.id).not.toBe('seed-dt');
    expect(forked.seedOrigin).toBe('user');
    expect(resolveNoteOwnership(forked).editable).toBe(true);
    expect(forked.provenance?.sourceNoteId).toBe('seed-dt');
  });
});
