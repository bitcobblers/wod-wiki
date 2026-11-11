import { afterEach, describe, expect, it } from 'vitest';
import {
  DomainScenarioHarness,
  HARNESS_EPOCH,
  type QueryWqlOptions,
} from '../harness/DomainScenarioHarness';

/** Find-result slice the assertions read — notes with their notebook scope. */
interface NoteFindResult {
  notes: Array<{ id: string; title: string; notebookId?: string; notebookIds?: string[] }>;
}

const options: QueryWqlOptions = { anchorNow: HARNESS_EPOCH };

describe('Domain — Note authoring, occurrence pinning & Metric parsing', () => {
  let harness: DomainScenarioHarness;
  afterEach(() => harness?.dispose());

  const franRaw = [
    '# Fran',
    '',
    '```time',
    '21-15-9',
    '  Thrusters 95lb',
    '  Pull-ups ?',
    '```',
    '',
    '```time',
    '800m Run',
    '```',
    '',
  ].join('\n');

  it('authors a Note with N:M Notebook membership, pinned Block Revisions, and block-index projections', async () => {
    harness = await DomainScenarioHarness.create();

    const built = await harness.authorNote({
      id: 'note-fran',
      title: 'Fran',
      rawContent: franRaw,
      notebookIds: ['notebook/benchmarks', 'notebook/girls'],
      tags: ['benchmark-girl'],
    });

    // The Note aggregate persists with its primary Notebook and both memberships.
    const stored = await harness.storage.readonly('notes').get('note-fran');
    expect(stored?.title).toBe('Fran');
    expect(stored?.notebookId).toBe('notebook/benchmarks');
    expect(stored?.notebookIds).toEqual(['notebook/benchmarks', 'notebook/girls']);
    const links = await harness.storage.readonly('notebook_links').getAllFromIndex('by-note', 'note-fran');
    expect(links.map((l) => l.notebookId).sort()).toEqual(['notebook/benchmarks', 'notebook/girls']);
    expect(built.notebookLinks).toHaveLength(2);

    // Every block occurrence is pinned as an immutable Block Revision with its exact source slice.
    const revisions = await harness.storage.readonly('block_revisions').getAllFromIndex('by-note', 'note-fran');
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.rawContent)).toContain('```time\n21-15-9\n  Thrusters 95lb\n  Pull-ups ?\n```');
    expect(revisions.map((r) => r.rawContent)).toContain('```time\n800m Run\n```');
    expect(revisions.every((r) => r.noteId === 'note-fran' && r.kind === 'wod')).toBe(true);

    // Block-index projections carry the content fingerprint for cross-workout Session pinning.
    const index = await harness.storage.readonly('block_index').getAllFromIndex('by-note', 'note-fran');
    expect(index).toHaveLength(2);
    expect(index.map((row) => row.dataType)).toEqual(['wod', 'wod']);
    expect(index.map((row) => row.noteTitle)).toEqual(['Fran', 'Fran']);
    expect(index.every((row) => typeof row.blockContentId === 'string' && row.blockContentId.length > 0)).toBe(true);
    expect(index.map((row) => row.id)).toEqual(index.map((row) => `${row.noteId}:${row.blockId}`));
  });

  it('parses Whiteboard Script Metrics with rep federation, unit fusion, and collectible placeholders', async () => {
    harness = await DomainScenarioHarness.create();
    const statements = harness.readBlockMetrics('21-15-9\n  Thrusters 95lb\n  Pull-ups ?\n43kg Back Squat');

    // The descending `21-15-9` federation federates into three Rep occurrences.
    const federation = statements.find((s) => s.text.includes('21-15-9'))!;
    const reps = federation.metrics.filter((m) => m.type === 'rep');
    expect(reps.map((m) => m.value)).toEqual([21, 15, 9]);
    expect(reps.every((m) => m.origin === 'parser')).toBe(true);

    // `95lb` fuses into a dimensioned Resistance in the authored unit.
    const thrusters = statements.find((s) => s.text.includes('Thrusters'))!;
    const resistance = thrusters.metrics.find((m) => m.type === 'resistance')!;
    expect(resistance.value).toEqual({ amount: 95, unit: 'lb' });
    expect(resistance.unit).toBe('lb');
    expect(thrusters.metrics.some((m) => m.type === 'effort' && m.value === 'Thrusters')).toBe(true);

    // A `?` placeholder is a collectible Rep the athlete fills in at run time.
    const pullUps = statements.find((s) => s.text.includes('Pull-ups'))!;
    const collectible = pullUps.metrics.find((m) => m.type === 'rep')!;
    expect(collectible.value).toBeUndefined();
    expect(collectible.origin).toBe('hinted');

    // Metric weights fuse symmetrically — `43kg` stays a kilogram Resistance.
    const squat = statements.find((s) => s.text.includes('Back Squat'))!;
    const kgResistance = squat.metrics.find((m) => m.type === 'resistance')!;
    expect(kgResistance.value).toEqual({ amount: 43, unit: 'kg' });
    expect(kgResistance.unit).toBe('kg');
  });

  it('resolves authored Notes through the WQL note plane by Tag and by Notebook over the live store', async () => {
    harness = await DomainScenarioHarness.create();
    await harness.authorNote({
      id: 'note-fran',
      title: 'Fran',
      rawContent: franRaw,
      notebookId: 'notebook/girls',
      tags: ['benchmark-girl'],
    });
    await harness.authorNote({
      id: 'note-journal-musing',
      title: 'Training Musing',
      rawContent: '# Training Musing\n\nFelt slow today.\n',
    });

    const byTag = await harness.queryWql<NoteFindResult>(':note{tags:benchmark-girl}', options);
    expect(byTag.notes.map((n) => n.title)).toEqual(['Fran']);

    const byNotebook = await harness.queryWql<NoteFindResult>(':note{notebook:girls}', options);
    expect(byNotebook.notes.map((n) => n.id)).toEqual(['note-fran']);

    const untagged = await harness.queryWql<NoteFindResult>(':note{text:Musing}', options);
    expect(untagged.notes.map((n) => n.title)).toEqual(['Training Musing']);
  });
});
