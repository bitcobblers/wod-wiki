/**
 * WW-095 — 'Preview with sample data' loading feedback & duplicate sample banners
 *
 * Regression test for QA defect WW-095 (sample-preview-no-loading-feedback-duplicate-banners).
 * Verifies clicking 'Preview with sample data' gives visible loading feedback
 * without flashing 'Purging sample data…' and renders at most one
 * 'Purge sample data' banner when a subsequent query returns empty.
 */
import { expect, test } from '../fixtures/playgroundActor';

test.describe('WW-095 — sample data prompt loading state and single banner', () => {
  test.setTimeout(120_000);

  test('WW-095: Preview with sample data shows loading feedback and at most one Purge sample data banner on empty results', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.goto(`/dashboards?q=${encodeURIComponent('sum:totalVolume{}')}`);

    const loadButton = page.getByRole('button', { name: /Preview with sample data/i });
    await expect(loadButton).toBeVisible({ timeout: 20_000 });
    await loadButton.click();

    await expect(page.locator('p[role="status"]').filter({ hasText: /Loading sample data/i })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/Purging sample data/i)).toHaveCount(0);

    const purgeButton = page.getByRole('button', { name: /Purge sample data/i });
    await expect(purgeButton).toBeVisible({ timeout: 30_000 });

    // Query that remains empty even after sample data is loaded must still render at most one Purge banner.
    await app.goto(`/dashboards?q=${encodeURIComponent('sum:totalVolume{effort:nonexistent_ww095}')}`);
    await expect(page.getByText('No data for this range.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Purge sample data/i })).toHaveCount(1);
  });
});
