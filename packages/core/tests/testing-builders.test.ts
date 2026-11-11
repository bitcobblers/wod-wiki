import { describe, expect, it } from 'vitest';
import { parseFrontmatter, getScalar, getList } from '../src';
import {
  buildDomainWorld,
  buildPropertyNote,
  buildTestNote,
  buildTestSession,
  resetTestingVocabulary,
  TEST_EPOCH,
  type DomainWorld,
} from '../src/testing';

const workout = ['```time', '21-15-9 thruster', '```', ''].join('\n');

describe('buildTestNote', () => {
  it('reconciles occurrence ids, revisions and block-index projections', () => {
    const built = buildTestNote({ id: 'note-fran', title: 'Fran', rawContent: `# Fran\n\n${workout}` });

    const blockIds = Object.keys(built.note.blocks);
    expect(blockIds).toEqual(['blk-0']);
    expect(built.note.blocks['blk-0']).toMatchObject({ kind: 'wod', sourceRevision: 1, version: 1 });

    expect(built.revisions).toHaveLength(1);
    expect(built.revisions[0]).toMatchObject({ noteId: 'note-fran', blockId: 'blk-0', version: 1, kind: 'wod' });
    expect(built.revisions[0].rawContent).toBe('```time\n21-15-9 thruster\n```');

    expect(built.blockIndex).toHaveLength(1);
    const row = built.blockIndex[0];
    expect(row).toMatchObject({
      id: 'note-fran:blk-0',
      noteId: 'note-fran',
      blockId: 'blk-0',
      blockVersion: 1,
      sourceRevision: 1,
      dataType: 'wod',
      noteTitle: 'Fran',
      createdAt: TEST_EPOCH,
      isStatic: false,
    });
    // Real content fingerprint for the wod body, never an occurrence id.
    expect(row.blockContentId).toMatch(/^bc-[0-9a-f]{8}$/);
    expect(row.rawContent).toContain('21-15-9 thruster');
  });

  it('marks seed-origin notes static and populates note identity fields', () => {
    const built = buildTestNote({
      id: 'seed-note',
      title: 'Seed WOD',
      rawContent: workout,
      seedOrigin: 'seed',
      sourcePath: 'efforts/fran.md',
      tags: ['girl'],
    });
    expect(built.blockIndex[0].isStatic).toBe(true);
    expect(built.blockIndex[0].sourcePath).toBe('efforts/fran.md');
    expect(built.note.seedOrigin).toBe('seed');
    expect(built.tags[0]).toMatchObject({ id: 'tag:girl', label: 'girl' });
    expect(built.noteTags[0]).toMatchObject({ noteId: 'seed-note', tagId: 'tag:girl' });
  });

  it('links notebooks with deterministic NotebookLink ids', () => {
    const built = buildTestNote({
      id: 'n1',
      rawContent: workout,
      notebookId: 'notebook/journal',
      notebookIds: ['notebook/journal', 'notebook/custom'],
    });
    expect(built.notebookLinks.map(l => l.id)).toEqual([
      'notebook/journal:note:n1',
      'notebook/custom:note:n1',
    ]);
    expect(built.notebookLinks[0]).toMatchObject({ notebookId: 'notebook/journal', targetKind: 'note', targetId: 'n1' });
    expect(built.note.notebookId).toBe('notebook/journal');
  });

  it('derives effort containment rows from registered property vocabulary', () => {
    resetTestingVocabulary();
    buildPropertyNote({ kind: 'effort', slug: 'thruster', label: 'Thruster', aliases: ['thrusters'] });
    const built = buildTestNote({ id: 'n1', rawContent: workout });

    expect(built.blockEfforts).toHaveLength(1);
    expect(built.blockEfforts[0]).toMatchObject({
      id: 'n1:blk-0:thruster',
      noteId: 'n1',
      blockId: 'blk-0',
      effortSlug: 'thruster',
    });
    // Without vocabulary (fresh process state) no rows are invented.
    resetTestingVocabulary();
    expect(buildTestNote({ id: 'n2', rawContent: workout }).blockEfforts).toEqual([]);
  });
});

describe('buildPropertyNote', () => {
  it('emits parseable effort frontmatter with required met', () => {
    const { note, override } = buildPropertyNote({
      kind: 'effort',
      slug: 'Thruster',
      label: 'Barbell Thruster',
      aliases: ['thrusters'],
      metrics: { reps: '21-15-9' },
      summaries: { totalReps: 'sum(reps)' },
      baseAttributes: { met: 6.0, discipline: 'strength' },
    });
    expect(note.id).toBe('property/effort/thruster');

    const fm = parseFrontmatter(note.rawContent);
    expect(getScalar(fm.meta, 'slug')).toBe('thruster');
    expect(getScalar(fm.meta, 'label')).toBe('Barbell Thruster');
    expect(getScalar(fm.meta, 'id')).toBe('effort-thruster');
    expect(getList(fm.meta, 'aliases')).toEqual(['thrusters']);
    expect(getScalar(fm.meta, 'type')).toBeUndefined();
    expect(fm.meta['metrics.reps']).toBe('21-15-9');
    expect(fm.meta['metrics.met']).toBe(6);
    expect(fm.meta['discipline']).toBe('strength');
    expect(fm.meta['summaries.totalReps']).toBe('sum(reps)');
    // No override without an explicit scope.
    expect(override).toBeUndefined();
  });

  it('emits equipment discriminator and override row for a scoped notebook', () => {
    const { note, override } = buildPropertyNote({
      kind: 'equipment',
      slug: 'dumbbell',
      label: 'Dumbbell',
      aliases: ['db'],
      notebookId: 'notebook/custom',
    });
    const fm = parseFrontmatter(note.rawContent);
    expect(getScalar(fm.meta, 'type')).toBe('equipment');
    expect(getScalar(fm.meta, 'id')).toBe('equipment-dumbbell');

    expect(override).toBeDefined();
    expect(override).toMatchObject({
      id: 'notebook/custom:equipment:dumbbell',
      notebookId: 'notebook/custom',
      kind: 'equipment',
      slug: 'dumbbell',
      label: 'Dumbbell',
      ownerNoteId: 'override/custom/equipment/dumbbell',
      seedOrigin: 'user',
      updatedAt: TEST_EPOCH,
    });
    expect(override?.rawContent).toBe(note.rawContent);
    expect(override?.payload).toMatchObject({ slug: 'dumbbell', registrySource: 'user' });
  });

  it('suppresses overrides for the defaults scope and honors asOverride default scope', () => {
    expect(buildPropertyNote({ kind: 'tag', slug: 'girl', label: 'Girl', notebookId: 'notebook/defaults' }).override).toBeUndefined();
    const forced = buildPropertyNote({ kind: 'tag', slug: 'girl', label: 'Girl', asOverride: true });
    expect(forced.override?.id).toBe('notebook/custom:tag:girl');
    expect(forced.override?.payload).toMatchObject({ label: 'girl', type: 'tag' });

    const tagType = buildPropertyNote({ kind: 'tag-type', slug: 'qualification', label: 'Qualification', asOverride: true });
    expect(tagType.override?.payload).toMatchObject({ name: 'qualification', label: 'Qualification' });
  });
});

describe('buildTestSession', () => {
  it('pins sessions and events to the block with deterministic ids', () => {
    const built = buildTestSession({
      id: 'r1',
      noteId: 'note-fran',
      blockId: 'blk-0',
      blockVersion: 2,
      startedAt: TEST_EPOCH + 1_000,
      durationMs: 300_000,
      origin: 'journal',
      isPublic: true,
      notebookIds: ['notebook/custom'],
      events: [{ metrics: [{ type: 'rep', value: 45 }], outputType: 'segment' }],
    });

    expect(built.session).toMatchObject({
      id: 'r1',
      noteId: 'note-fran',
      blockId: 'blk-0',
      blockVersion: 2,
      status: 'completed',
      startTime: TEST_EPOCH + 1_000,
      endTime: TEST_EPOCH + 301_000,
      duration: 300_000,
      completed: true,
      public: true,
    });
    expect(built.events[0]).toMatchObject({
      id: 'r1:0',
      resultId: 'r1',
      noteId: 'note-fran',
      blockId: 'blk-0',
      blockVersion: 2,
      grain: 'event',
      metrics: [{ type: 'rep', value: 45 }],
    });
    expect(built.notebookLinks[0].id).toBe('notebook/custom:session:r1');
  });

  it('defaults the block pin and session id deterministically', () => {
    const built = buildTestSession({ noteId: 'note-fran' });
    expect(built.session).toMatchObject({ id: 'session-note-fran:1', blockId: 'blk-0', blockVersion: 1, startTime: TEST_EPOCH });
    expect(built.events).toEqual([]);
    expect(built.notebookLinks).toEqual([]);
  });
});

describe('buildDomainWorld', () => {
  it('aggregates a deterministic snapshot across all stores', () => {
    resetTestingVocabulary();
    const world: DomainWorld = buildDomainWorld({
      propertyNotes: [{ kind: 'effort', slug: 'thruster', label: 'Thruster', notebookId: 'notebook/defaults' }],
      notes: [
        { id: 'n1', title: 'Fran', rawContent: workout, tags: ['girl'], notebookId: 'notebook/journal' },
        { id: 'n2', title: 'Copy', rawContent: workout, seedOrigin: 'user' },
      ],
      sessions: [{ noteId: 'n1', startedAt: TEST_EPOCH, events: [{ id: 'e-custom' }] }],
      pages: [{ id: 'page-1', slug: 'girls', title: 'Girls', createdAt: TEST_EPOCH }],
      pageNotes: [{ id: 'pn-1', pageId: 'page-1', noteId: 'n1', createdAt: TEST_EPOCH }],
    });

    // Notes: 2 authored + 1 property note; landing notes land in
    // world.notebooks. The defaults scope suppresses its override, so it
    // emits neither an override row nor a notebook entry.
    expect(world.notes.map(n => n.id)).toEqual(['n1', 'n2', 'property/effort/thruster']);
    expect(world.notebooks.map(n => n.id)).toEqual(['notebook/journal']);

    expect(world.blockIndex.map(r => r.id)).toEqual(['n1:blk-0', 'n2:blk-0']);
    expect(world.revisions).toHaveLength(2);
    expect(world.blockEfforts.map(e => e.id)).toEqual(['n1:blk-0:thruster', 'n2:blk-0:thruster']);

    expect(world.tags).toEqual([{ id: 'tag:girl', label: 'girl', createdAt: TEST_EPOCH }]);
    expect(world.noteTags.map(t => t.id)).toEqual(['n1:tag:girl']);

    expect(world.propertyOverrides).toEqual([]);
  });

  it('pins world sessions to the real first wod block and content fingerprint', () => {
    resetTestingVocabulary();
    const world = buildDomainWorld({
      notes: [{ id: 'n1', title: 'Fran', rawContent: workout }],
      sessions: [{ noteId: 'n1' }, { id: 'custom-id', noteId: 'n1', startedAt: TEST_EPOCH + 5_000 }],
    });
    expect(world.sessions.map(s => s.id)).toEqual(['session-n1:1', 'custom-id']);
    const firstWod = world.blockIndex.find(r => r.dataType === 'wod');
    for (const session of world.sessions) {
      expect(session.blockId).toBe(firstWod?.blockId);
      expect(session.blockVersion).toBe(firstWod?.blockVersion);
      expect(session.blockContentId).toBe(firstWod?.blockContentId);
    }
    expect(world.events).toEqual([]);
    expect(world.notebookLinks).toEqual([]);
    expect(world.pages).toEqual([]);
    expect(world.pageNotes).toEqual([]);
  });
});
