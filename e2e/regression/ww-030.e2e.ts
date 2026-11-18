/**
 * WW-030 — Chart unit formatting inconsistent: Y-axis baseline tick '0 kg' (space) vs grouped ticks '5,000kg' (no space) on explorer bar charts (low)
 *
 * Regression test for the open QA defect WW-030 (catalog-chart-unit-mismatch-totalvolume).
 * Expected behavior: every Y-axis tick on a kg bar chart uses the shared
 * formatTimeseriesTick convention — locale-grouped digits, one space, then the
 * unit (e.g. '0 kg', '5,000 kg') — the way WqlTimeseries already renders.
 * Current defect: WqlBars routes ticks through compactNumber plus the recharts
 * YAxis unit prop instead of the shared formatter, so the baseline tick reads
 * '0 kg' while grouped ticks render without the space ('5,000kg').
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-15-smoke-214120).
 */
import { test, expect, type PlaygroundTestActor } from '../fixtures/playgroundActor';
import type { Locator, Page } from '@playwright/test';

/** Load the bundled sample corpus via the explorer prompt (the populated-corpus path). */
async function loadSampleData(app: PlaygroundTestActor): Promise<void> {
  const { page } = app;
  await app.wql.openExplorer('sum:totalVolume{} by {week}');
  const sampleBtn = page.getByRole('button', { name: /Preview with sample data/i });
  if (await sampleBtn.isVisible().catch(() => false)) {
    await sampleBtn.click();
    await expect(page.getByRole('button', { name: /Purge sample data/i })).toBeVisible({
      timeout: 30_000,
    });
  }
}

async function yAxisTickTexts(scope: Page | Locator): Promise<string[]> {
  const ticks = scope.locator('.recharts-yAxis .recharts-cartesian-axis-tick text');
  const texts: string[] = [];
  for (const tick of await ticks.all()) {
    texts.push(((await tick.textContent()) ?? '').trim());
  }
  return texts.filter(Boolean);
}

test.describe('WW-030 — bar-chart Y-axis tick unit spacing', () => {
  test('WW-030: every kg tick on an explorer bar chart uses the grouped, single-space unit format', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // Corpus assumption: the bare seed corpus has sessions=0 (WW-056), so no kg
    // bar chart renders data at all. The sample-import path is the populated
    // corpus the ledger retest was blocked on; drive it, then chart volume by
    // effort (a bars-shaped result, rendered by WqlBars).
    await loadSampleData(app);
    await app.wql.openExplorer('sum:totalVolume{} by {effort}');

    await expect
      .poll(async () => (await yAxisTickTexts(page)).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);

    const ticks = await yAxisTickTexts(page);
    // Sample-corpus assumption: at least one effort's weekly volume crosses
    // 1,000 kg, so a locale-grouped tick must exist for the spacing check to bite.
    expect(
      ticks.some((t) => t.includes(',')),
      `expected a grouped (>=1,000) tick among: ${ticks.join(' | ')}`,
    ).toBe(true);
    for (const tick of ticks) {
      expect(tick, `tick '${tick}' must follow the shared '5,000 kg' convention`).toMatch(
        /^\d{1,3}(,\d{3})*(\.\d)? kg$/,
      );
    }
  });
});
