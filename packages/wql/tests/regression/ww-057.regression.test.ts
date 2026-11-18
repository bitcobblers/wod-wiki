import { describe, expect, it } from 'vitest';
import type { EventRecord, StoredOutputStatement } from '@bitcobblers/wod-wiki-core';
import { toEventRows } from '../../src/derivation';
import { QueryService, type EventStore } from '../../src/QueryService';

const DAY = 86_400_000;
const BASE_TS = Math.floor(1_700_000_000_000 / DAY) * DAY;

function makeSessionRows(resultId: string, noteId: string, effortSlug: string, ts: number): EventRecord[] {
  const logs: StoredOutputStatement[] = [
    {
      id: 1,
      outputType: 'segment',
      timeSpan: { started: ts, ended: ts + 300_000 },
      metrics: [
        { type: 'effort', value: effortSlug, origin: 'parser' },
        { type: 'tis', value: 300, unit: 's', origin: 'runtime' },
      ],
    },
  ];
  return toEventRows(logs, { noteId, resultId, blockContentId: `bc-${resultId}`, workoutTimestamp: ts });
}

describe('WW-057 — :session{text:...} ignored filter must not narrow results', () => {
  it('keeps all sessions when text: is reported as ignored on :session', async () => {
    const rows = [
      ...makeSessionRows('sess-ww057-a', 'note-1', 'kettlebell-swing', BASE_TS),
      ...makeSessionRows('sess-ww057-b', 'note-1', 'burpee', BASE_TS + 60_000),
    ];
    const eventStore: EventStore = {
      getEventsByTimeRange: async () => rows,
      getEventsByResult: async (id) => rows.filter((r) => r.resultId === id),
      getEventsForNote: async (noteId) => rows.filter((r) => r.noteId === noteId),
      getEventsByContent: async (bc) => rows.filter((r) => r.blockContentId === bc),
      scanAll: async () => rows,
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    };
    const service = new QueryService(
      eventStore,
      { getAllNotes: async () => [], getNoteIdsForTag: async () => new Set(), getNoteTagLabels: async () => [] },
      { getAllBlocks: async () => [] },
      { getAllEfforts: async () => [] },
    );

    const result = await service.runQuery(':session{text:fran}');
    expect(result.advisories?.some((a) => /text/i.test(a.message))).toBe(true);
    expect(result.find?.runs).toHaveLength(2);
  });
});
