import { describe, expect, it } from 'vitest';
import type { Note } from '@bitcobblers/wod-wiki-core';
import { QueryService, type EffortQueryStore, type IEffort, type NoteQueryStore } from '../src/QueryService';
import { parseQuery, isFindQuery, type ParsedFindQuery } from '../src/wql';

function makeEffort(overrides: Partial<IEffort> = {}): IEffort {
  return {
    id: 'e-1',
    slug: 'push-up',
    label: 'Push-Up',
    aliases: ['pushup', 'press-up'],
    baseAttributes: { met: 3.8, discipline: 'strength', intensityTier: 'moderate' },
    registrySource: 'bundled',
    ...overrides,
  } as IEffort;
}

const efforts: IEffort[] = [
  makeEffort({ id: 'e-1', slug: 'push-up', label: 'Push-Up', baseAttributes: { met: 3.8, discipline: 'strength', intensityTier: 'moderate' }, registrySource: 'bundled' }),
  makeEffort({ id: 'e-2', slug: 'fran', label: 'Fran', aliases: [], baseAttributes: { met: 11.5, discipline: 'gymnastics', intensityTier: 'high' }, registrySource: 'bundled' }),
  makeEffort({ id: 'e-3', slug: 'my-wod', label: 'My Custom WOD', aliases: ['fran-ish'], baseAttributes: { met: 9.0, intensityTier: 'high' }, registrySource: 'user' }),
];

function makeService(): QueryService {
  const effortStore: EffortQueryStore = { getAllEfforts: async () => efforts };
  return new QueryService(
    {
      getEventsByTimeRange: async () => [],
      getEventsByResult: async () => [],
      getEventsForNote: async () => [],
      getEventsByContent: async () => [],
      scanAll: async () => [],
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    },
    { getAllNotes: async () => [], getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
    { getAllBlocks: async () => [] },
    effortStore,
  );
}

function find(raw: string): ParsedFindQuery {
  const parsed = parseQuery(raw);
  if (!isFindQuery(parsed)) throw new Error(`not a find query: ${raw}`);
  return parsed;
}

describe(':effort queries', () => {
  it('returns the whole registry with empty filters', async () => {
    const result = await makeService().runFind(find(':effort in all'));
    expect(result.efforts).toHaveLength(3);
    expect(result.stages.selected).toBe(3);
    expect(result.stages.matched).toBe(3);
    expect(result.notes).toEqual([]);
    expect(result.blocks).toEqual([]);
  });

  it('parses the efforts head end-to-end from WQL text', async () => {
    const result = await makeService().runFind(find(':effort{discipline:strength} in all'));
    expect(result.efforts?.map(e => e.slug)).toEqual(['push-up']);
  });

  it('filters by intensity tier', async () => {
    const result = await makeService().runFind(find(':effort{intensity:high} in all'));
    expect(result.efforts?.map(e => e.slug).sort()).toEqual(['fran', 'my-wod']);
  });

  it('filters by registry origin', async () => {
    const result = await makeService().runFind(find(':effort{origin:user} in all'));
    expect(result.efforts?.map(e => e.slug)).toEqual(['my-wod']);
  });

  it('matches the effort key by slug, label, or alias', async () => {
    const bySlug = await makeService().runFind(find(':effort{effort:fran} in all'));
    expect(bySlug.efforts?.map(e => e.slug)).toEqual(['fran']);
    const byLabel = await makeService().runFind(find(':effort{effort:Push-Up} in all'));
    expect(byLabel.efforts?.map(e => e.slug)).toEqual(['push-up']);
    const byAlias = await makeService().runFind(find(':effort{effort:fran-ish} in all'));
    expect(byAlias.efforts?.map(e => e.slug)).toEqual(['my-wod']);
  });

  it('filters text as substring over label, slug, and aliases', async () => {
    const result = await makeService().runFind(find(':effort{text:press} in all'));
    expect(result.efforts?.map(e => e.slug)).toEqual(['push-up']);
  });

  it('ANDs across keys and ORs within a key', async () => {
    const result = await makeService().runFind(
      find(':effort{intensity:high,discipline:gymnastics} in all'),
    );
    expect(result.efforts?.map(e => e.slug)).toEqual(['fran']);
  });

  it('honors negated filters', async () => {
    const parsed = find(':effort{intensity:high} in all');
    parsed.filters[0]!.negate = true;
    const result = await makeService().runFind(parsed);
    expect(result.efforts?.map(e => e.slug)).toEqual(['push-up']);
  });
});

describe(':effort queries — the note plane', () => {
  function makeNote(id: string, title: string): Note {
    return { id, title, createdAt: 1, rawContent: `---\nslug: ${id}\n---\n`, sourceRevision: 1, blocks: {} };
  }

  // Projections of notes: each matched effort resolves to its owning note.
  const notedEfforts: IEffort[] = [
    makeEffort({ id: 'e-1', slug: 'push-up', label: 'Push-Up', ownerNoteId: 'note-1', baseAttributes: { met: 3.8, discipline: 'strength', intensityTier: 'moderate' } }),
    makeEffort({ id: 'e-2', slug: 'fran', label: 'Fran', aliases: [], ownerNoteId: 'note-2', baseAttributes: { met: 11.5, discipline: 'gymnastics', intensityTier: 'high' } }),
    // Registry orphan: no owning note — definitions live in the note index,
    // so it never surfaces as a result note.
    makeEffort({ id: 'e-3', slug: 'ghost', label: 'Ghost', aliases: [], baseAttributes: { met: 5.0, intensityTier: 'high' } }),
  ];
  const notes: Note[] = [makeNote('note-1', 'Push-Up'), makeNote('note-2', 'Fran')];

  function makeNotedService(noteStore: Partial<NoteQueryStore>): QueryService {
    const effortStore: EffortQueryStore = { getAllEfforts: async () => notedEfforts };
    return new QueryService(
      {
        getEventsByTimeRange: async () => [],
        getEventsByResult: async () => [],
        getEventsForNote: async () => [],
        getEventsByContent: async () => [],
        scanAll: async () => [],
        appendEvents: async () => {},
        finalizeSummaries: async () => {},
        deleteEvents: async () => {},
      },
      { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [], ...noteStore },
      { getAllBlocks: async () => [] },
      effortStore,
    );
  }

  it('returns the owning definition notes, not just registry rows', async () => {
    const result = await makeNotedService({}).runFind(find(':effort in all'));
    expect(result.efforts).toHaveLength(3);
    expect(result.notes.map(n => n.id)).toEqual(['note-1', 'note-2']);
    expect(result.stages.matched).toBe(3);
  });

  it('filters on the registry plane and resolves results on the note plane', async () => {
    const result = await makeNotedService({}).runFind(find(':effort{intensity:high} in all'));
    expect(result.efforts?.map(e => e.slug).sort()).toEqual(['fran', 'ghost']);
    expect(result.notes.map(n => n.id)).toEqual(['note-2']);
  });

  it('hydrates owner notes through getNotesByIds when available', async () => {
    const calls: string[][] = [];
    const service = makeNotedService({
      getNotesByIds: async (ids) => {
        calls.push([...ids]);
        return notes.filter(n => ids.includes(n.id));
      },
    });
    const result = await service.runFind(find(':effort{effort:push-up} in all'));
    expect(calls).toEqual([['note-1']]);
    expect(result.notes.map(n => n.title)).toEqual(['Push-Up']);
  });

  it('falls back to getAllNotes when getNotesByIds is unavailable', async () => {
    const result = await makeNotedService({ getNotesByIds: undefined }).runFind(find(':effort in all'));
    expect(result.notes.map(n => n.id)).toEqual(['note-1', 'note-2']);
  });
});
