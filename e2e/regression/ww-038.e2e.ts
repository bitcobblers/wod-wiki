/**
 * WW-038 — Invalid WQL on /dashboards destroys the rendered result pane, overwrites the shareable ?q= URL, and offers no restore to the last valid query (medium)
 *
 * Regression test for the open QA defect WW-038 (dashboards-invalid-query-clears-chart).
 * Expected behavior: editing the explorer draft must not rewrite the shareable
 * ?q= URL with unparseable text (draft→URL writes are parse-gated, mirroring
 * useComposerQueryState.setQuery), and a URL that does carry an invalid query
 * must surface an alert or a restore-to-last-valid affordance instead of
 * silently booting the broken query as the submitted one.
 * Current defect: useExplorerQueryState.setDraft rewrites ?q= on every edit
 * with no parse gate; submitted hydrates from the raw ?q= without validation,
 * so after reload the explorer boots submitted=':broken{' silently — no alert,
 * no stale banner, no restore — while the draft resets to ':dashboard{}'.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';
import type { Page } from '@playwright/test';

const VALID_QUERY = 'sum:totalVolume{} by {week}';
const INVALID_QUERY = ':broken{';

function qParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get('q');
}

async function explorerEditor(page: Page) {
  const editor = page
    .locator('[data-testid="wql-composer-root"]:visible')
    .first()
    .getByLabel('WQL', { exact: true });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  return editor;
}

test.describe('WW-038 — explorer invalid-query URL protection and recovery', () => {
  test('WW-038: typing an invalid draft does not overwrite the shareable ?q= URL', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.wql.openExplorer(VALID_QUERY);
    await expect.poll(() => qParam(page), { timeout: 15_000 }).toBe(VALID_QUERY);
    // The last valid result pane is on screen before the draft is broken.
    await expect(page.getByText('Query result')).toBeVisible({ timeout: 15_000 });

    const editor = await explorerEditor(page);
    await editor.click();
    await editor.fill(INVALID_QUERY);
    await editor.press('Enter');

    // Sample ?q= across the window in which a (buggy) draft→URL write would
    // land, and assert it carried the last valid, shareable query throughout.
    const samples: Array<string | null> = [];
    await expect
      .poll(
        () => {
          samples.push(qParam(page));
          return samples.length;
        },
        { timeout: 5_000, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(12);
    expect(
      samples.every((q) => q === VALID_QUERY),
      `an invalid draft must not replace ?q= (saw: ${JSON.stringify(samples)})`,
    ).toBe(true);
  });

  test('WW-038 (path 2): landing on an invalid ?q= surfaces an alert or a restore affordance, never a silent broken boot', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // This is the post-reload state from the ledger probe: ?q= holds ':broken{'.
    await app.wql.openExplorer(INVALID_QUERY);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 15_000,
    });

    const alert = page.getByRole('alert');
    const staleBanner = page.getByTestId('explorer-results-stale');
    const restore = page.getByRole('button', { name: /restore/i });
    await expect
      .poll(
        async () =>
          (await alert.count()) > 0 ||
          (await staleBanner.count()) > 0 ||
          (await restore.count()) > 0,
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});
