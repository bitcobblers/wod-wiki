import { describe, it, expect } from 'vitest';
import { inMemoryEventStore, QueryService } from '../src/index';
import type { EventRecord } from '../src/index';

describe('inMemoryEventStore', () => {
  const sampleEvents: EventRecord[] = [
    {
      id: 'res-1:summary:totalVolume',
      resultId: 'res-1',
      noteId: 'note-1',
      blockContentId: 'blk-1',
      blockId: 'occurrence-1',
      blockVersion: 1,
      origin: 'journal',
      grain: 'summary',
      outputType: 'analytics',
      metrics: [{ type: 'totalVolume', value: 1500, unit: 'lb', origin: 'engine' }],
      timestamp: 1000,
    },
    {
      id: 'res-2:summary:totalVolume',
      resultId: 'res-2',
      noteId: 'note-1',
      blockContentId: 'blk-1',
      blockId: 'occurrence-1',
      blockVersion: 1,
      origin: 'journal',
      grain: 'summary',
      outputType: 'analytics',
      metrics: [{ type: 'totalVolume', value: 2500, unit: 'lb', origin: 'engine' }],
      timestamp: 2000,
    },
    {
      id: 'res-3:summary:tis',
      resultId: 'res-3',
      noteId: 'note-1',
      blockContentId: 'blk-1',
      blockId: 'occurrence-1',
      blockVersion: 1,
      origin: 'journal',
      grain: 'summary',
      outputType: 'analytics',
      metrics: [{ type: 'tis', value: 45, origin: 'engine' }],
      timestamp: 3000,
    },
  ];

  it('projects facts through the event seam when queried by metric', async () => {
    const store = inMemoryEventStore(sampleEvents);
    const service = new QueryService(store);

    const allFacts = await service.getFactsByTimeRange(0, 10_000);
    const volume = allFacts.filter((f) => f.metricKey === 'totalVolume');
    expect(volume).toHaveLength(2);
    expect(volume[0].value).toBe(1500);
    expect(volume[1].value).toBe(2500);

    const tis = allFacts.filter((f) => f.metricKey === 'tis');
    expect(tis).toHaveLength(1);
    expect(tis[0].value).toBe(45);
  });

  it('windows facts by time range through the event seam', async () => {
    const store = inMemoryEventStore(sampleEvents);
    const service = new QueryService(store);
    const inRange = await service.getFactsByTimeRange(1500, 2500);
    expect(inRange).toHaveLength(1);
    expect(inRange[0].id).toBe('res-2:summary:totalVolume:0');
  });

  it('integrates seamlessly with QueryService for WQL execution', async () => {
    const store = inMemoryEventStore(sampleEvents);
    const service = new QueryService(store);

    const result = await service.runQuery('sum:totalVolume{}');
    expect(result.series).toHaveLength(1);
    // Ticket 13: the kg system default applies — 4000 lb converts.
    expect(result.series[0].points[0].value).toBeCloseTo(4000 * 0.45359237, 6);
  });
});
