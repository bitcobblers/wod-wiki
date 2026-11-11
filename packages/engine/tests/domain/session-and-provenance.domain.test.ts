import { afterEach, describe, expect, it } from 'vitest';
import { DomainScenarioHarness, HARNESS_EPOCH } from '../harness/DomainScenarioHarness';

/** `:session{}` run-card slice the assertions read. */
interface SessionFindResult {
  runs: Array<{ resultId: string; noteId: string }>;
}

describe('Domain — Journal Session intake, provenance lineage & EventRecord persistence', () => {
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

  it('clones a read-only Feed Note into notebook/journal on run, pins the Session to the exact block occurrence, and persists EventRecords', async () => {
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

    // The read-only source was cloned verbatim into the Journal.
    expect(run.clonedFromReadOnly).toBe(true);
    expect(run.noteId).not.toBe(seed.note.id);
    const clone = await harness.storage.readonly('notes').get(run.noteId);
    expect(clone?.rawContent).toBe(heroRaw);
    expect(clone?.notebookIds).toContain('notebook/journal');
    expect(clone?.seedOrigin).toBe('user');
    expect(clone?.feedOrigin).toBeUndefined();

    // Note Provenance lineage points back at the upstream Feed Note.
    expect(run.provenance).toMatchObject({
      sourceNoteId: seed.note.id,
      feedSourceId: 'sport-crossfit',
      sourceNotebookId: 'notebook/crossfit-heroes',
      sourcePath: 'markdown/notebooks/crossfit-heroes/dt.md',
    });

    // The Session pins the Journal clone, never the upstream Seed Note.
    expect(run.session.noteId).toBe(run.noteId);
    expect(run.session.completed).toBe(true);
    const seedSessions = await harness.storage.readonly('sessions').getAllFromIndex('by-note', seed.note.id);
    const cloneSessions = await harness.storage.readonly('sessions').getAllFromIndex('by-note', run.noteId);
    expect(seedSessions).toHaveLength(0);
    expect(cloneSessions.map((s) => s.id)).toEqual(['sess-dt-run-1']);

    // Calendar placement: the run lands on the 2026-11-10 Journal Page.
    const pages = await harness.storage.readonly('page').getAllFromIndex('by-date', '2026-11-10');
    expect(pages).toHaveLength(1);
    const placements = await harness.storage.readonly('page_notes').getAllFromIndex('by-note', run.noteId);
    expect(placements.map((p) => p.pageId)).toEqual([pages[0]!.id]);

    // EventRecords persisted from the real runtime run — the 800m distance survives.
    expect(run.events.length).toBeGreaterThan(0);
    const allEvents = await harness.storage.readonly('events').getAll();
    expect(allEvents.length).toBeGreaterThan(0);
    expect(allEvents.every((e) => e.noteId === run.noteId && e.resultId === 'sess-dt-run-1')).toBe(true);
    const distanceEvent = allEvents.find((e) => e.metrics.some((m) => m.type === 'distance'));
    expect(distanceEvent).toBeDefined();
    expect(distanceEvent!.metrics.find((m) => m.type === 'distance')!.value).toEqual({ amount: 800, unit: 'm' });

    // The WQL session plane reads the same rows back over the live stores.
    const found = await harness.queryWql<SessionFindResult>(':session{note:' + run.noteId + '}');
    expect(found.runs).toHaveLength(1);
    expect(found.runs[0]!.resultId).toBe('sess-dt-run-1');
    expect(found.runs[0]!.noteId).toBe(run.noteId);

    // Live upstream lineage resolves while the Feed Note exists.
    expect(run.upstream).toMatchObject({ exists: true, sourceNoteId: seed.note.id, title: 'Hero DT + Cashout' });
  });

  it('keeps the Journal clone and its Session pinned when the upstream Note updates, then reports a broken lineage after deletion', async () => {
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

    // The Journal clone and its pinned Session are untouched by the upstream sync.
    const cloneAfterSync = await harness.storage.readonly('notes').get(run.noteId);
    expect(cloneAfterSync?.rawContent).toContain('800m Run');
    expect(cloneAfterSync?.rawContent).not.toContain('1600m Run');
    const pinnedSessions = await harness.storage.readonly('sessions').getAllFromIndex('by-note', run.noteId);
    expect(pinnedSessions.map((s) => s.id)).toEqual(['sess-dt-run-1']);

    const liveLineage = await harness.upstreamProvenance(run.noteId);
    expect(liveLineage?.exists).toBe(true);
    expect(liveLineage?.sourceNoteId).toBe('seed-dt');

    // Unsubscribing deletes the upstream Seed Note — the clone reports a broken lineage but keeps everything.
    await harness.storage.readwrite('notes').delete('seed-dt');
    const brokenLineage = await harness.upstreamProvenance(run.noteId);
    expect(brokenLineage).toMatchObject({ exists: false, sourceNoteId: 'seed-dt' });
    const cloneAfterDelete = await harness.storage.readonly('notes').get(run.noteId);
    expect(cloneAfterSync?.rawContent).toBe(cloneAfterDelete?.rawContent);
  });
});
