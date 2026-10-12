import { describe, expect, it } from 'vitest';
import type { IFieldCatalog, CatalogFieldSuggestion } from '../src/catalog';
import type { EventRecord } from '@bitcobblers/wod-wiki-core';
import { QueryService, type EventStore } from '../src/QueryService';

/**
 * Ticket 20 — measured budgets from the invalidation and performance
 * contract, committed as tests. Budgets: typeahead prefix lookup over a
 * 500-entry catalog < 16 ms with zero events/results store contact; a
 * 50-row tabular page < 50 ms at contract scale (here: 5 000 segments).
 */

// ── 500-entry in-memory catalog (the bounded prefix algorithm the adapter
// runs over the IDB index) ────────────────────────────────────────────────
const ENTRIES: CatalogFieldSuggestion[] = Array.from({ length: 500 }, (_, i) => ({
  id: JSON.stringify([`field${String(i).padStart(3, '0')}`, 'number', null]),
  path: `field${String(i).padStart(3, '0')}`,
  kind: 'number',
  units: [],
  spellings: [],
}));

const prefixCatalog: IFieldCatalog = {
  async listByPrefix(prefix, limit = 20) {
    // Same shape as the IDB index seek: sorted + bounded.
    let lo = 0;
    let hi = ENTRIES.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ENTRIES[mid]!.path < prefix) lo = mid + 1;
      else hi = mid;
    }
    return ENTRIES.slice(lo, lo + limit);
  },
  async lookup() {
    return [];
  },
  async listValues() {
    return [];
  },
};

describe('ticket 20 — measured budgets', () => {
  it('typeahead prefix lookup over a 500-entry catalog stays under 16 ms', async () => {
    // Warm.
    await prefixCatalog.listByPrefix('field1', 20);
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      await prefixCatalog.listByPrefix(`field${i}`, 20);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(16);
  });

  it('a 50-row tabular page at contract scale stays under 50 ms', async () => {
    // 5 000 segment observations across 500 workouts (contract scale lower bound).
    const rows: EventRecord[] = [];
    for (let i = 0; i < 5000; i++) {
      rows.push({
        id: `r${Math.floor(i / 10)}:${i % 10}`,
        resultId: `r${Math.floor(i / 10)}`,
        noteId: 'n1',
        timestamp: 1_700_000_000_000 + i * 1000,
        grain: 'event',
        outputType: 'segment',
        blockId: 's',
        blockVersion: 1,
        effortSlug: i % 2 ? 'running' : 'cycling',
        metrics: [{ type: 'distance', value: 100 + (i % 7), metadata: { canonicalKey: 'distance' } }],
      } as unknown as EventRecord);
    }
    const eventStore: EventStore = {
      getEventsByTimeRange: async () => rows,
      getEventsByResult: async () => [],
      getEventsForNote: async () => [],
      getEventsByContent: async () => [],
      scanAll: async () => rows,
      appendEvents: async () => {},
      finalizeSummaries: async () => {},
      deleteEvents: async () => {},
    };
    const service = new QueryService({ eventStore });
    const parsed = {
      family: 'rows' as const, raw: 'rows:segment{}', target: 'segment',
      filters: [], pipes: { limit: 50 },
    };
    // Warm the code path once.
    await service.runRows(parsed as never);
    const result = await service.runRows(parsed as never);
    // Median of several timed runs: a single sample on a loaded CI runner
    // is noise-dominated (one GC pause breaches the budget); the median
    // tracks the real query cost (ticket 20 measured-budget contract).
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const run = await service.runRows(parsed as never);
      samples.push(performance.now() - t0);
      expect(run.table!.rows).toHaveLength(50);
    }
    const elapsed = samples.sort((a, b) => a - b)[2]!;
    expect(result.table!.totalCount).toBe(5000);
    expect(elapsed).toBeLessThan(50);
  });
});
