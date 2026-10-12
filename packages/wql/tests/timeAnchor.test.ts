import { describe, expect, it } from 'vitest';
import type { EventRecord, Note } from '@bitcobblers/wod-wiki-core';
import { parseQuery, type ParsedFindQuery, type ParsedAggregateQuery } from '../src/wql';
import { QueryService, type EventStore } from '../src/QueryService';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30); // "today" in the test

function eventRow(noteId: string, metricDate: string, value: number): EventRecord {
  return {
    id: `r:${noteId}:summary:totalVolume`,
    resultId: `r-${noteId}`,
    noteId,
    timestamp: NOW,
    grain: 'summary',
    outputType: 'analytics',
    metrics: [{ type: 'totalVolume', value, metadata: { canonicalKey: 'totalVolume' } }],
    metricTemporal: [{ temporalKind: 'civil-date', civilDate: metricDate }],
    metricDateKeys: [`d:${metricDate}`],
  } as unknown as EventRecord;
}

function makeService(notes: Note[], events: EventRecord[]) {
  const eventStore: EventStore = {
    getEventsByTimeRange: async (start, end) => events.filter((r) => r.timestamp >= start && r.timestamp <= end),
    getEventsByResult: async () => [],
    getEventsForNote: async () => [],
    getEventsByContent: async () => [],
    getEventsByMetricDates: async (dates) =>
      events.filter((r) => (r.metricDateKeys ?? []).some((k) => dates.includes(k.slice(2)))),
    scanAll: async () => events,
    appendEvents: async () => {},
    finalizeSummaries: async () => {},
    deleteEvents: async () => {},
  };
  return new QueryService({
    eventStore,
    noteStore: { getAllNotes: async () => notes, getNoteIdsForTag: async () => new Set<string>(), getNoteTagLabels: async () => [] },
  });
}

describe('#1050 — time windows filter on "when it happened"', () => {
  const twoWeeksAgo = NOW - 14 * DAY;
  const backdatedNote: Note = {
    id: 'jrnl-backdated',
    title: 'Back-dated workout',
    createdAt: NOW, // typed today…
    date: twoWeeksAgo, // …but dated two weeks ago
    type: 'note',
    rawContent: '', sourceRevision: 1, blocks: {},
  } as Note;
  const noDateNote: Note = {
    id: 'jrnl-fresh',
    title: 'Fresh note',
    createdAt: NOW,
    type: 'note',
    rawContent: '', sourceRevision: 1, blocks: {},
  } as Note;
  const events = [eventRow('jrnl-backdated', '2026-09-16', 1000)];

  it('a note dated two weeks ago but created today is excluded from last 1w and included in last 3w', async () => {
    const service = makeService([backdatedNote], []);
    const last1w = await service.runFind(
      parseQuery(':note{note:jrnl-backdated} last 1w') as ParsedFindQuery,
      { anchorNow: NOW },
    );
    expect(last1w.notes).toHaveLength(0);

    const last3w = await service.runFind(
      parseQuery(':note{note:jrnl-backdated} last 3w') as ParsedFindQuery,
      { anchorNow: NOW },
    );
    expect(last3w.notes.map((n) => n.id)).toEqual(['jrnl-backdated']);
  });

  it('notes without a date still filter on their creation time', async () => {
    const service = makeService([noDateNote], []);
    const result = await service.runFind(
      parseQuery(':note{note:jrnl-fresh} last 1w') as ParsedFindQuery,
      { anchorNow: NOW },
    );
    expect(result.notes.map((n) => n.id)).toEqual(['jrnl-fresh']);
  });

  it(':note and sum: windows agree for the same back-dated workout', async () => {
    const service = makeService([backdatedNote], events);
    // The metric is recorded 2026-09-16 (two weeks before NOW) — inside 3w, outside 1w.
    const notes1w = await service.runFind(
      parseQuery(':note{note:jrnl-backdated} last 1w') as ParsedFindQuery,
      { anchorNow: NOW },
    );
    const vol1w = await service.run(
      parseQuery('sum:totalVolume{} last 1w') as ParsedAggregateQuery,
      { context: { instant: NOW, timeZone: 'UTC' } },
    );
    expect(notes1w.notes).toHaveLength(0);
    const matched1w = (vol1w.series ?? []).flatMap((s) => (s.points ?? []).filter((p) => !p.missing && p.value !== 0));
    expect(matched1w).toHaveLength(0);

    const notes3w = await service.runFind(
      parseQuery(':note{note:jrnl-backdated} last 3w') as ParsedFindQuery,
      { anchorNow: NOW },
    );
    const vol3w = await service.run(
      parseQuery('sum:totalVolume{} last 3w') as ParsedAggregateQuery,
      { context: { instant: NOW, timeZone: 'UTC' } },
    );
    expect(notes3w.notes).toHaveLength(1);
    expect(vol3w.scalar).toBe(1000);
  });
});
