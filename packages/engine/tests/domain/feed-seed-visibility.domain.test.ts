import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetTestingVocabulary } from '@bitcobblers/wod-wiki-core/testing';
import { DomainScenarioHarness } from '../harness/DomainScenarioHarness';

/** Find-result slice the assertions read. */
interface NoteFindResult {
  notes: Array<{ id: string; title: string; seedOrigin?: string; feedSourceId?: string; rawContent?: string }>;
}

describe('Domain — Notebook membership, Publication Visibility & Feed → Seed subscription', () => {
  let publisher: DomainScenarioHarness;
  let subscriber: DomainScenarioHarness;
  beforeEach(() => resetTestingVocabulary());
  afterEach(async () => {
    await publisher?.dispose();
    await subscriber?.dispose();
  });

  const cindyRaw = '# Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```\n';

  it('derives Publication Visibility across Private → Published Note → Published Note + Data, and publishes opted-in data only', async () => {
    publisher = await DomainScenarioHarness.create();

    // The user's `air-squat` property override — referenced by Cindy, so it must be promoted on publish.
    await publisher.definePropertyNote({
      kind: 'effort',
      slug: 'air-squat',
      label: 'Air Squat',
      aliases: ['air squats'],
      baseAttributes: { met: 8.2 },
      notebookId: 'notebook/custom',
      asOverride: true,
    });

    await publisher.authorNote({
      id: 'note-cindy',
      title: 'Cindy',
      rawContent: cindyRaw,
      notebookIds: ['notebook/benchmarks'],
    });

    // Two runs: one opted into publication, one kept private.
    await publisher.prepareAndRunSession({ noteId: 'note-cindy', sessionId: 'sess-cindy-1', journalDate: '2026-11-10' });
    await publisher.prepareAndRunSession({ noteId: 'note-cindy', sessionId: 'sess-cindy-2', journalDate: '2026-11-11' });

    // 1. Default notebook is Private.
    expect(await publisher.publicationSummary('note-cindy')).toMatchObject({ visibility: 'Private', publicSessions: 0 });

    // 2. N:M membership: the runs anchored the Note in `notebook/journal` alongside `notebook/benchmarks`.
    const links = await publisher.storage.readonly('notebook_links').getAllFromIndex('by-note', 'note-cindy');
    expect(new Set(links.map((l) => l.notebookId))).toEqual(new Set(['notebook/journal', 'notebook/benchmarks']));

    // 3. Making the Notebook public promotes visibility to Published Note.
    await publisher.setNotebookPublic('notebook/benchmarks', true);
    expect((await publisher.publicationSummary('note-cindy')).visibility).toBe('Published Note');

    // 4. Opting one Session in promotes visibility to Published Note + Data.
    await publisher.setSessionPublic('sess-cindy-1', true);
    expect(await publisher.publicationSummary('note-cindy')).toMatchObject({
      visibility: 'Published Note + Data',
      publicSessions: 1,
    });

    // 5. Before the first publish the vault is dirty; the Feed publish emits exactly the opted-in data.
    expect((await publisher.unpublishedChanges()).dirty).toBe(true);
    const { tree, report } = await publisher.publishFeed({ name: 'Peer Benchmark Feed' });
    expect(report.totalNotes).toBe(1);
    expect(report.totalPublicSessions).toBe(1);
    expect((await publisher.unpublishedChanges(tree)).dirty).toBe(false);

    // 6. A fresh subscriber imports the Feed through the production seed importer.
    subscriber = await publisher.importFeedIntoFreshHarness(tree, 'peer-feed');

    // The published Note arrives as a read-only Seed delivered by the subscribed Feed.
    const imported = await subscriber.queryWql<NoteFindResult>(':note{}');
    const cindy = imported.notes.find((n) => n.title === 'Cindy');
    expect(cindy).toBeDefined();
    expect(cindy!.seedOrigin).toBe('seed');
    expect(cindy!.feedSourceId).toBe('peer-feed');
    expect(cindy!.rawContent).toBe(cindyRaw);

    // The subscription checkpoint exists — the subscriber IS subscribed.
    expect(await subscriber.storage.readonly('meta').get('seed:peer-feed')).toBeDefined();

    // Opted-in Sessions (and their telemetry) cross the Feed; the private Session never does.
    const importedSessions = await subscriber.storage.readonly('sessions').getAll();
    expect(importedSessions.map((s) => s.id)).toEqual(['sess-cindy-1']);
    const importedEvents = await subscriber.storage.readonly('events').getAll();
    expect(importedEvents.length).toBeGreaterThan(0);
    expect(importedEvents.every((e) => e.resultId === 'sess-cindy-1')).toBe(true);

    // The referenced `air-squat` Scoped Property Override was promoted into the outbound
    // Feed and materializes on the subscriber as an Effort primitive (MET 8.2).
    const promoted = await subscriber.storage.readonly('efforts').get('air-squat');
    expect(promoted?.baseAttributes.met).toBe(8.2);
    const overrideRows = await subscriber.storage
      .readonly('property_overrides')
      .getAllFromIndex('by-kind-slug', { only: ['effort', 'air-squat'] });
    expect(overrideRows.map((o) => `${o.kind}:${o.slug}`)).toContain('effort:air-squat');

    // The private session's data is absent everywhere on the subscriber.
    expect(importedEvents.some((e) => e.resultId === 'sess-cindy-2')).toBe(false);
  });

  it('re-runs the imported read-only Seed through the journal intake, cloning it into notebook/journal', async () => {
    publisher = await DomainScenarioHarness.create();
    await publisher.authorNote({
      id: 'note-cindy',
      title: 'Cindy',
      rawContent: cindyRaw,
      notebookIds: ['notebook/benchmarks'],
      sourceId: 'notebook:benchmarks/cindy',
      sourcePath: 'markdown/notebooks/benchmarks/cindy.md',
    });
    await publisher.setNotebookPublic('notebook/benchmarks', true);
    const { tree } = await publisher.publishFeed({ name: 'Peer Benchmark Feed' });

    const subscriber = await publisher.importFeedIntoFreshHarness(tree, 'peer-feed');
    const imported = await subscriber.queryWql<NoteFindResult>(':note{}');
    const seedCindy = imported.notes.find((n) => n.title === 'Cindy')!;

    // Running the read-only Seed clones it into the subscriber's Journal — never mutating the Feed Note.
    const run = await subscriber.prepareAndRunSession({
      noteId: seedCindy.id,
      sessionId: 'sess-subscribed-cindy',
      journalDate: '2026-11-12',
    });
    expect(run.clonedFromReadOnly).toBe(true);
    expect(run.noteId).not.toBe(seedCindy.id);
    const clone = await subscriber.storage.readonly('notes').get(run.noteId);
    expect(clone?.notebookIds).toContain('notebook/journal');
    expect(run.provenance?.sourceNoteId).toBe(seedCindy.id);
  });
});
