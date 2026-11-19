import { describe, expect, it } from 'vitest';
import type { EventRecord, Note } from '@bitcobblers/wod-wiki-core';
import { QueryService } from '../src/QueryService';
import { parseQuery } from '../src/wql';

const janNote: Note = {
  id: 'note-jan-1',
  title: 'Fran Benchmark',
  rawContent: '# Fran Benchmark\n',
  tags: ['benchmark'],
  blocks: {},
  createdAt: Date.UTC(2026, 0, 10, 12, 0, 0),
  sourceRevision: 1,
  type: 'workout',
  seedOrigin: 'user',
};

const janNote2: Note = {
  id: 'note-jan-2',
  title: 'Cindy Benchmark',
  rawContent: '# Cindy Benchmark\n',
  tags: ['benchmark'],
  blocks: {},
  createdAt: Date.UTC(2026, 0, 20, 12, 0, 0),
  sourceRevision: 1,
  type: 'workout',
  seedOrigin: 'user',
};

const marNote: Note = {
  id: 'note-mar-1',
  title: 'Journal Reflection',
  rawContent: '# Journal Reflection\n',
  tags: ['recovery'],
  blocks: {},
  createdAt: Date.UTC(2026, 2, 15, 12, 0, 0),
  sourceRevision: 1,
  type: 'note',
  sourceId: 'notebook/journal',
};

function makeNoteQueryService(notes: Note[], events: EventRecord[] = []) {
  const tagIds = (label: string) =>
    new Set(notes.filter((n) => (n.tags ?? []).includes(label)).map((n) => n.id));
  return new QueryService({
    eventStore: {
      getEventsByTimeRange: async () => events,
      getEventsByResult: async () => [],
      getEventsForNote: async () => [],
      getEventsByContent: async () => [],
      scanAll: async () => events,
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    },
    noteStore: {
      getAllNotes: async () => notes,
      getNoteIdsForTag: async (label) => tagIds(label),
      getNoteTagLabels: async (id) => notes.find((n) => n.id === id)?.tags ?? [],
    },
  });
}

describe('WW-094: count:note{} and by {month} bucketing', () => {
  it('evaluates count:note{} from NoteQueryStore even when EventStore is empty', async () => {
    const qs = makeNoteQueryService([janNote, janNote2, marNote]);
    const res = await qs.runQuery('count:note{}');
    expect(res.error).toBeUndefined();
    expect(res.parsed.error).toBeUndefined();
    expect(res.scalar).toBe(3);
    expect(res.stages.selected).toBe(3);
  });

  it('supports count:note{} by {week} and count:note{} by {month}', async () => {
    const qs = makeNoteQueryService([janNote, janNote2, marNote]);
    const opts = { context: { instant: Date.UTC(2026, 3, 1, 12, 0, 0), timeZone: 'UTC' } };

    const byWeek = await qs.runQuery('count:note{} by {week}', opts);
    expect(byWeek.error).toBeUndefined();
    expect(byWeek.series).toHaveLength(1);
    const weekSum = byWeek.series[0]!.points.reduce((sum, p) => sum + p.value, 0);
    expect(weekSum).toBe(3);

    const byMonth = await qs.runQuery('count:note{} by {month} from 2026-01-01 to 2026-03-31', opts);
    expect(byMonth.error).toBeUndefined();
    expect(byMonth.series).toHaveLength(1);
    // Jan (2), Feb (0 intermediate), Mar (1)
    expect(byMonth.series[0]!.points.map((p) => p.value)).toEqual([2, 0, 1]);
  });

  it('supports content filters like type: and tags: on count:note{} without content-key rejection', async () => {
    expect(parseQuery('count:note{type:workout}').error).toBeUndefined();
    expect(parseQuery('count:note{tags:benchmark} by {month}').error).toBeUndefined();

    const qs = makeNoteQueryService([janNote, janNote2, marNote]);
    const opts = { context: { instant: Date.UTC(2026, 3, 1, 12, 0, 0), timeZone: 'UTC' } };

    const tagged = await qs.runQuery('count:note{tags:benchmark} by {month}', opts);
    expect(tagged.error).toBeUndefined();
    expect(tagged.series[0]!.points.map((p) => p.value)).toEqual([2]);

    const typed = await qs.runQuery('count:note{type:workout}', opts);
    expect(typed.error).toBeUndefined();
    expect(typed.scalar).toBe(2);
  });

  it('buckets event-backed aggregates by {month}', async () => {
    const events: EventRecord[] = [
      {
        id: 'ev-1',
        resultId: 'res-1',
        noteId: janNote.id,
        blockId: 'b1',
        blockVersion: 1,
        timestamp: Date.UTC(2026, 0, 12, 12, 0, 0),
        grain: 'summary',
        outputType: 'analytics',
        metrics: [{ type: 'totalVolume', value: 1000, unit: 'kg', metadata: { canonicalKey: 'totalVolume' } }],
      },
      {
        id: 'ev-2',
        resultId: 'res-2',
        noteId: marNote.id,
        blockId: 'b2',
        blockVersion: 1,
        timestamp: Date.UTC(2026, 2, 12, 12, 0, 0),
        grain: 'summary',
        outputType: 'analytics',
        metrics: [{ type: 'totalVolume', value: 1500, unit: 'kg', metadata: { canonicalKey: 'totalVolume' } }],
      },
    ];
    const qs = makeNoteQueryService([janNote, marNote], events);
    const opts = { context: { instant: Date.UTC(2026, 3, 1, 12, 0, 0), timeZone: 'UTC' } };

    const monthly = await qs.runQuery('sum:totalVolume{} by {month} from 2026-01-01 to 2026-03-31', opts);
    expect(monthly.error).toBeUndefined();
    expect(monthly.series[0]!.points.map((p) => p.value)).toEqual([1000, 0, 1500]);
  });
});
