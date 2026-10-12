import { describe, expect, it } from 'vitest';
import type { StoredOutputStatement, EventRecord } from '@bitcobblers/wod-wiki-core';
import { toEventRows, projectEventToFacts } from '../src/derivation';
import { captureContext } from '../src/calendar';
import { QueryService, type EventStore } from '../src/QueryService';

const DAY = 86_400_000;
const day0 = Date.UTC(2026, 8, 7, 4); // Mon Sep 7 2026 00:00 EDT = 04:00Z

type Metrics = EventRecord['metrics'];

function statement(timeSpan: { started: number; ended?: number } | undefined): StoredOutputStatement {
  return {
    id: 's1',
    outputType: 'segment',
    timeSpan,
    metrics: [{ type: 'distance', value: 5000, unit: 'm', metadata: { canonicalKey: 'distance' } }],
  } as unknown as StoredOutputStatement;
}

function summaryRow(id: string, resultId: string, timestamp: number, temporal?: EventRecord['metricTemporal']): EventRecord {
  return {
    id,
    resultId,
    noteId: 'n1',
    timestamp,
    grain: 'summary',
    outputType: 'analytics',
    blockId: '',
    blockVersion: 0,
    metrics: [
      { type: "distance", value: timestamp === Date.UTC(2026, 8, 5, 16) ? 1000 : 2000, metadata: { canonicalKey: "distance" } } as unknown as Metrics,
    ] as Metrics,
    ...(temporal ? { metricTemporal: temporal } : {}),
  };
}

function store(rows: EventRecord[]): EventStore {
  return {
    getEventsByTimeRange: async (start, end) => rows.filter((r) => r.timestamp >= start && r.timestamp <= end),
    getEventsByResult: async () => [],
    getEventsForNote: async () => [],
    getEventsByContent: async () => [],
    scanAll: async () => rows,
    appendEvents: async () => {},
    finalizeSummaries: async () => {},
    deleteEvents: async () => {},
  };
}

describe('ticket 12 — engine-level time alignment', () => {
  it('a workout-start timestamp never relocates a metric observation whose own date differs (acceptance 8)', () => {
    // Workout recorded Sep 10; the statement's own span starts Sep 5 18:00 EDT.
    const workoutTimestamp = day0 + 3 * DAY;
    const ownStart = Date.UTC(2026, 8, 5, 22); // Sep 5 18:00 EDT
    const identity = { noteId: 'n1', resultId: 'r1', workoutTimestamp };
    const rows = toEventRows([statement({ started: ownStart, ended: ownStart + 3_600_000 })], identity);
    const facts = projectEventToFacts(rows[0]!);
    // The fact carries its own occurrence instant, not the workout start.
    expect(facts[0]!.timestamp).toBe(ownStart);
  });

  it('one captured context resolves every window in a run (acceptance 7 — context plumbed via options)', async () => {
    // Two observations one week apart; the captured instant decides which
    // Monday-start week `last 1w` covers.
    const r1 = summaryRow('r1:0', 'r1', Date.UTC(2026, 8, 5, 16)); // Sat Sep 5 noon EDT
    const r2 = summaryRow('r2:0', 'r2', Date.UTC(2026, 8, 14, 4, 5)); // Mon Sep 14 00:05 EDT
    const service = new QueryService({ eventStore: store([r1, r2]) });
    // `last 1w` from Sun Sep 6 23:55 EDT = the week of Mon Aug 31, through
    // the captured instant: only r1.
    const result = await service.runQuery('sum:distance{} last 1w', {
      context: captureContext(Date.UTC(2026, 8, 7, 3, 55), 'America/New_York'),
    });
    expect(result.scalar).toBe(1000);
    // Same query, captured a week later: the week of Mon Sep 14 — only r2.
    const later = await service.runQuery('sum:distance{} last 1w', {
      context: captureContext(Date.UTC(2026, 8, 14, 4, 5), 'America/New_York'),
    });
    expect(later.scalar).toBe(2000);
  });

  it('a civil-date fact groups under its recorded civil date, not a fabricated instant', async () => {
    // Date-only wellness observation recorded as civil 2026-09-05; its fetch
    // timestamp is the New-York midnight hint. Grouping under a Tokyo-system
    // capture must still use civil 2026-09-05.
    const rows: EventRecord[] = [
      {
        id: 'wellness:n1:hrv', resultId: 'wellness:n1', noteId: 'n1',
        timestamp: Date.UTC(2026, 8, 5, 4), // Sep 5 00:00 EDT hint
        grain: 'summary', outputType: 'wellness', blockId: '', blockVersion: 0,
        metrics: [{ type: "hrv", value: 48, metadata: { canonicalKey: "hrv" } }] as unknown as Metrics,
        metricTemporal: [{ temporalKind: 'civil-date', civilDate: '2026-09-05' }],
      },
    ];
    const service = new QueryService({ eventStore: store(rows) });
    const byDay = await service.runQuery('sum:hrv{} by {day}', {
      context: captureContext(Date.UTC(2026, 8, 6, 0), 'Asia/Tokyo'),
    });
    // Observed extent = the one civil date; its display anchor is local noon
    // of 2026-09-05 in Tokyo — the civil date survives the system timezone.
    expect(byDay.series[0]!.points).toHaveLength(1);
    expect(byDay.series[0]!.points[0]!.value).toBe(48);
    expect(byDay.series[0]!.points[0]!.missing).toBeUndefined();
    // local noon of 2026-09-05 in Tokyo = 2026-09-05T03:00Z
    expect(byDay.series[0]!.points[0]!.ts).toBe(Date.UTC(2026, 8, 5, 3));
  });
});
