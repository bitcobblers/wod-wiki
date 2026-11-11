import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetTestingVocabulary } from '@bitcobblers/wod-wiki-core/testing';
import { DomainScenarioHarness, HARNESS_EPOCH, type QueryWqlOptions } from '../harness/DomainScenarioHarness';

/** Find-result slices the assertions read. */
interface NoteFindResult {
  notes: Array<{ id: string; title: string; seedOrigin?: string; feedSourceId?: string }>;
}
interface SessionFindResult {
  runs: Array<{ resultId: string; noteId: string }>;
}
interface NotebookContainersResult {
  notes: Array<{ id: string; title: string; tags?: string[] }>;
}

const options: QueryWqlOptions = { anchorNow: HARNESS_EPOCH };

describe('Domain — Entity Scope resolution & WQL planes over real SqlStorage', () => {
  let harness: DomainScenarioHarness;
  beforeEach(() => resetTestingVocabulary());
  afterEach(() => harness?.dispose());

  it('resolves Effort, Equipment, Tag, Tag Category, Notebook, Feed, and Note scopes to their WQL planes', async () => {
    harness = await DomainScenarioHarness.create();

    const effort = harness.resolveEntityScope({ noteId: 'effort/thruster', label: 'Thruster' });
    expect(effort.kind).toBe('effort');
    expect(effort.scopeFilter).toBe('effort:thruster');
    expect(effort.notesWql).toBe(':note{effort:thruster}');
    expect(effort.sessionsWql).toBe(':session{effort:thruster}');

    const equipment = harness.resolveEntityScope({ noteId: 'equipment/kettlebell', label: 'Kettlebell' });
    expect(equipment.kind).toBe('equipment');
    expect(equipment.scopeFilter).toBe('equipment:kettlebell');

    const typedTag = harness.resolveEntityScope({ noteId: 't/domain/crossfit', label: 'CrossFit' });
    expect(typedTag.kind).toBe('tag');
    expect(typedTag.scopeFilter).toBe('domain:crossfit');

    const customTag = harness.resolveEntityScope({ noteId: 't/tag/heavy', label: 'Heavy' });
    expect(customTag.kind).toBe('tag');
    expect(customTag.scopeFilter).toBe('tags:heavy');

    const notebook = harness.resolveEntityScope({ noteId: 'notebook/crossfit-girls', label: 'CrossFit Girls' });
    expect(notebook.kind).toBe('notebook');
    expect(notebook.notesWql).toBe(':note{notebook:crossfit-girls}');
    expect(notebook.sessionsWql).toBe(':session{} where :note{notebook:crossfit-girls}');

    const feed = harness.resolveEntityScope({ noteId: 'feed/wod-science', label: 'WOD Science' });
    expect(feed.kind).toBe('feed');
    expect(feed.notesWql).toBe(':notebook{feed:wod-science}');
    expect(feed.sessionsWql).toBe(':session{} where :notebook{feed:wod-science}');

    const note = harness.resolveEntityScope({
      noteId: 'note-123',
      label: 'Fran Dashboard',
      rawContent: '---\ntitle: Fran\nwql: ":segment{effort:thruster}"\n---\nBody',
    });
    expect(note.kind).toBe('note');
    expect(note.sessionsWql).toBe(':session{note:note-123}');
    expect(note.primaryWql).toBe(':segment{effort:thruster}');
  });

  it('executes :note{} planes through the live block_efforts / block_equipment / tags / notebook stores', async () => {
    harness = await DomainScenarioHarness.create();

    // Property definitions register the canonical vocabulary mentions resolve against.
    await harness.definePropertyNote({ kind: 'effort', slug: 'thruster', label: 'Thruster', aliases: ['thrusters'] });
    await harness.definePropertyNote({ kind: 'equipment', slug: 'kettlebell', label: 'Kettlebell', aliases: ['kettlebell'] });

    await harness.authorNote({
      id: 'note-fran',
      title: 'Fran',
      rawContent: '# Fran\n\n```time\n21 Thrusters 95lb\n```\n',
      notebookId: 'notebook/girls',
      tags: ['benchmark-girl'],
    });
    await harness.authorNote({
      id: 'note-helen',
      title: 'Helen',
      rawContent: '# Helen\n\n```time\n(3)\n  400m Run\n  21 Kettlebell Swings\n  12 Pull-ups\n```\n',
      notebookId: 'notebook/girls',
      tags: ['benchmark-girl'],
    });

    // Effort scope: containment rows land in `block_efforts` and the effort plane finds Fran.
    const byEffort = await harness.queryWql<NoteFindResult>(':note{effort:thruster}', options);
    expect(byEffort.notes.map((n) => n.id)).toEqual(['note-fran']);

    // Equipment scope: `block_equipment` containment finds Helen.
    const byEquipment = await harness.queryWql<NoteFindResult>(':note{equipment:kettlebell}', options);
    expect(byEquipment.notes.map((n) => n.id)).toEqual(['note-helen']);

    // Tag and Notebook scopes: note-tags junction rows and notebook membership.
    const byTag = await harness.queryWql<NoteFindResult>(':note{tags:benchmark-girl}', options);
    expect(byTag.notes.map((n) => n.id).sort()).toEqual(['note-fran', 'note-helen']);
    const byNotebook = await harness.queryWql<NoteFindResult>(':note{notebook:girls}', options);
    expect(byNotebook.notes.map((n) => n.id).sort()).toEqual(['note-fran', 'note-helen']);
  });

  it('executes :session{} planes and aggregation pipelines over events read from the live SqlStorage', async () => {
    harness = await DomainScenarioHarness.create();

    await harness.authorNote({
      id: 'note-fran',
      title: 'Fran',
      rawContent: '# Fran\n\n```time\n21 Thrusters 95lb\n```\n',
      notebookId: 'notebook/girls',
    });
    await harness.authorNote({
      id: 'note-helen',
      title: 'Helen',
      rawContent: '# Helen\n\n```time\n(3)\n  400m Run\n  21 Kettlebell Swings\n  12 Pull-ups\n```\n',
      notebookId: 'notebook/girls',
    });

    await harness.prepareAndRunSession({ noteId: 'note-fran', sessionId: 'sess-fran', startedAt: HARNESS_EPOCH });
    await harness.prepareAndRunSession({ noteId: 'note-helen', sessionId: 'sess-helen', startedAt: HARNESS_EPOCH + 3_600_000 });

    // Session runs group the persisted EventRecords per result.
    const franRun = await harness.queryWql<SessionFindResult>(':session{note:note-fran}', options);
    expect(franRun.runs).toHaveLength(1);
    expect(franRun.runs[0]).toMatchObject({ resultId: 'sess-fran', noteId: 'note-fran' });

    // Aggregation over the same events: 21 (Fran) + 21 swings + 12 pull-ups (Helen) reps.
    const totalReps = await harness.queryAggregate('sum:reps{}', options);
    expect(typeof totalReps.scalar).toBe('number');
    expect(totalReps.scalar!).toBeGreaterThanOrEqual(54);
  });

  it('serves the :notebook{type:notebook} container plane from the notebook catalog over the live stores', async () => {
    harness = await DomainScenarioHarness.create();

    await harness.authorNote({
      id: 'note-fran',
      title: 'Fran',
      rawContent: '# Fran\n\n```time\n21 Thrusters 95lb\n```\n',
      notebookIds: ['notebook/girls', 'notebook/journal'],
    });

    const containers = await harness.queryWql<NotebookContainersResult>(':notebook{type:notebook}', options);
    const girls = containers.notes.find((n) => n.id === 'notebook/girls');
    expect(girls).toBeDefined();
    expect(girls!.tags).toContain('origin:user');
    expect(girls!.tags).toContain('count:1');
    expect(girls!.tags).toContain('subscribed:false');
  });
});
