/**
 * WW-065 — prebuilt /dashboard/benchmark-pr-board settle latency — moot while every widget settles 'No data' (WW-056) (medium)
 *
 * Regression test for the open QA defect WW-065 (prebuilt-board-widget-hydration-latency).
 * Expected behavior: with a populated corpus, the prebuilt Benchmark PR Board
 * settles promptly — every widget rendered with data, none left on
 * 'No data for this range.', within a 15-second settle budget from navigation.
 * Current defect: settle latency cannot even be judged, because every widget
 * settles 'No data' (WW-056: the board's queries match zero sessions). A board
 * that never populates never settles, so this test measures time-to-populated
 * and fails while the board stays empty.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-16-smoke-014925).
 */
import { test, expect } from '../fixtures/playgroundActor';
import { loadSampleData } from './helpers';

test.describe('WW-065 — Benchmark PR Board settle latency (populated)', () => {
  test('WW-065: the populated Benchmark PR Board settles with data in every widget within 15s', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await loadSampleData(app);

    const startedAt = Date.now();
    await app.wql.openDashboard('benchmark-pr-board');

    // Settled = no widget still showing the empty state AND the chart widgets
    // actually mounted (guards against reading the transient pre-render page).
    let settledMs: number | null = null;
    await expect
      .poll(
        async () => {
          const emptyCount = await page.getByText('No data for this range.').count();
          const chartCount = await page.locator('.recharts-wrapper').count();
          if (emptyCount === 0 && chartCount >= 3) {
            settledMs = Date.now() - startedAt;
            return true;
          }
          return false;
        },
        { timeout: 20_000, intervals: [250] },
      )
      .toBe(true)
      .catch(() => {
        // settledMs stays null; the assertion below reports it properly.
      });

    expect(
      settledMs,
      'board never settled populated — every latency reading is moot while widgets sit on "No data" (WW-056)',
    ).not.toBeNull();
    expect(settledMs!).toBeLessThan(15_000);
  });
});
