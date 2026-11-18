/**
 * WW-074 — HRV trend widget on /dashboard/recovery-readiness labels Y-axis ticks and readout in kg instead of ms (0 kg..80 kg, '71kg') (medium)
 *
 * Regression test for the open QA defect WW-074 (hrv-trend-widget-kg-units).
 * Expected behavior: the HRV trend widget (avg:calc.hrv{} by {day}) labels its
 * Y-axis in milliseconds — the shared tick formatter renders '<number> ms' —
 * and nothing in the widget is denominated in kilograms.
 * Current defect: WqlTimeseries falls back to the mass-preference unit for the
 * unitless HRV series, so the axis renders '0 kg'..'80 kg' and the readout
 * '71kg' for a metric that is measured in ms.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-15-nightly-060324).
 */
import { test, expect, type PlaygroundTestActor } from '../fixtures/playgroundActor';
import type { Locator } from '@playwright/test';

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

function widgetByTitle(page: PlaygroundTestActor['page'], title: string): Locator {
  return page.locator(
    `xpath=//h3[normalize-space()="${title}"]/ancestor::div[contains(@class,"bg-card")][1]`,
  );
}

async function yAxisTickTexts(scope: Locator): Promise<string[]> {
  const ticks = scope.locator('.recharts-yAxis .recharts-cartesian-axis-tick text');
  const texts: string[] = [];
  for (const tick of await ticks.all()) {
    texts.push(((await tick.textContent()) ?? '').trim());
  }
  return texts.filter(Boolean);
}

test.describe('WW-074 — HRV trend widget units are milliseconds', () => {
  test('WW-074: HRV trend Y-axis ticks are denominated in ms, never kg', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // Corpus assumption: the bare seed corpus has sessions=0 (WW-056), under
    // which the recovery board renders no axis at all. The sample-import path
    // populates the Recovery & Readiness board (the ANL-05 flow), which is
    // what lets the unit assertion engage.
    await loadSampleData(app);
    await app.wql.openDashboard('recovery-readiness');

    const hrvWidget = widgetByTitle(page, 'HRV trend');
    await expect(hrvWidget).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => (await yAxisTickTexts(hrvWidget)).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);

    const ticks = await yAxisTickTexts(hrvWidget);
    for (const tick of ticks) {
      expect(tick, `HRV tick '${tick}' must be denominated in ms`).toMatch(
        /^\d{1,3}(,\d{3})*(\.\d)? ms$/,
      );
    }
    await expect(hrvWidget, 'no part of the HRV widget may be denominated in kg').not.toContainText(
      'kg',
    );
  });
});
