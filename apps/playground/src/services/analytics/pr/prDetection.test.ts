import { describe, it, expect } from 'vitest';
import type { AnalyticsDataPoint, EventRecord } from '@/types/storage';
import { inMemoryEventStore } from '@bitcobblers/wod-wiki-engine';
import { detectPRsForSession } from './prDetection';

function mockFact(
  id: string,
  resultId: string,
  metricKey: string,
  value: number,
  timestamp: number,
): AnalyticsDataPoint {
  return {
    id,
    noteId: 'note-1',
    blockContentId: 'bc-fran',
    grain: 'summary',
    blockId: 'block-1',
    blockVersion: 1,
    resultId,
    type: metricKey,
    metricKey,
    value,
    label: metricKey,
    timestamp,
    createdAt: timestamp,
  };
}

function eventsStoreFromFacts(facts: AnalyticsDataPoint[]) {
  const rows: EventRecord[] = facts.map((f) => ({
    id: `${f.resultId}:summary:${f.metricKey ?? f.type}`,
    resultId: f.resultId,
    noteId: f.noteId,
    blockContentId: f.blockContentId,
    blockId: f.blockId,
    blockVersion: f.blockVersion,
    timestamp: f.timestamp,
    grain: 'summary',
    outputType: 'analytics',
    metrics: [{ type: f.metricKey ?? f.type, value: f.value, unit: f.unit, origin: 'engine' }],
  }));
  return inMemoryEventStore(rows);
}

describe('prDetection', () => {
  it('detects a PR when current value is better than all previous attempts', async () => {
    const facts: AnalyticsDataPoint[] = [
      mockFact('f1', 'res-1', 'totalVolume', 4000, 1000),
      mockFact('f2', 'res-2', 'totalVolume', 4200, 2000),
      mockFact('f3', 'res-3', 'totalVolume', 4600, 3000), // current target result
    ];

    const eventsStore = eventsStoreFromFacts(facts);

    const prs = await detectPRsForSession('bc-fran', 'res-3', { eventsStore });
    expect(prs).toHaveLength(1);
    expect(prs[0]).toEqual({
      metricKey: 'totalVolume',
      metricLabel: 'totalVolume',
      unit: undefined,
      currentValue: 4600,
      previousBest: 4200,
      isPR: true,
      improvement: 400,
      totalAttempts: 3,
    });
  });

  it('detects no PR when current value is worse than a previous attempt', async () => {
    const facts: AnalyticsDataPoint[] = [
      mockFact('f1', 'res-1', 'totalVolume', 5000, 1000),
      mockFact('f2', 'res-2', 'totalVolume', 4200, 2000), // current target result
    ];

    const eventsStore = eventsStoreFromFacts(facts);

    const prs = await detectPRsForSession('bc-fran', 'res-2', { eventsStore });
    expect(prs).toHaveLength(1);
    expect(prs[0].isPR).toBe(false);
    expect(prs[0].previousBest).toBe(5000);
  });

  it('handles lower-is-better metrics (elapsed / time)', async () => {
    const facts: AnalyticsDataPoint[] = [
      mockFact('f1', 'res-1', 'elapsed', 180, 1000),
      mockFact('f2', 'res-2', 'elapsed', 150, 2000), // current target result (faster time!)
    ];

    const eventsStore = eventsStoreFromFacts(facts);

    const prs = await detectPRsForSession('bc-fran', 'res-2', { eventsStore });
    expect(prs).toHaveLength(1);
    expect(prs[0].isPR).toBe(true);
    expect(prs[0].previousBest).toBe(180);
    expect(prs[0].improvement).toBe(-30);
  });

  it('detects first attempt as a PR', async () => {
    const facts: AnalyticsDataPoint[] = [
      mockFact('f1', 'res-1', 'totalReps', 100, 1000),
    ];

    const eventsStore = eventsStoreFromFacts(facts);

    const prs = await detectPRsForSession('bc-fran', 'res-1', { eventsStore });
    expect(prs).toHaveLength(1);
    expect(prs[0].isPR).toBe(true);
    expect(prs[0].previousBest).toBeUndefined();
    expect(prs[0].totalAttempts).toBe(1);
  });
});
