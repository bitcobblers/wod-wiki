import { describe, expect, it } from 'vitest';
import type { Note } from '@bitcobblers/wod-wiki-storage';
import { parseQuery, type ParsedFindQuery } from '../../src/wql';
import { QueryService, type EventStore } from '../../src/QueryService';

const EMPTY_EVENTS: EventStore = {
  getEventsByTimeRange: async () => [],
  getEventsByResult: async () => [],
  getEventsForNote: async () => [],
  getEventsByContent: async () => [],
  scanAll: async () => [],
  appendEvents: async () => {},
  finalizeSummaries: async () => {},
  deleteEvents: async () => {},
};

function makeNote(id: string, title: string, rawContent: string): Note {
  return {
    id,
    title,
    rawContent,
    createdAt: 1_700_000_000_000,
    sourceRevision: 1,
    blocks: {},
  };
}

describe('WW-089 — multi-word note text search in WQL', () => {
  it('filters notes by multi-word text phrase ":note{text:\\"Dumbbell Day\\"}"', async () => {
    const notes = [
      makeNote('note-db', 'Dumbbell Day', '# Dumbbell Day\n\nDumbbell presses and rows.\n'),
      makeNote('note-bb', 'Barbell Club', '# Barbell Club\n\nBarbell squats only.\n'),
    ];
    const service = new QueryService(
      EMPTY_EVENTS,
      { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
      { getAllBlocks: async () => [] },
      { getAllEfforts: async () => [] },
    );

    const parsed = parseQuery(':note{text:"Dumbbell Day"}') as ParsedFindQuery;
    expect(parsed.error).toBeUndefined();
    expect(parsed.family).toBe('find');

    const result = await service.runFind(parsed);
    const ids = result.notes?.map((n) => n.id) ?? [];
    expect(ids).toContain('note-db');
    expect(ids).not.toContain('note-bb');
  });
});
