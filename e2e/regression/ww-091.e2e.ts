/**
 * WW-091 — Link-as-Alias target <select> renders 0 options on cold load — Confirm Link permanently disabled, flow unusable (medium)
 *
 * Regression test for the open QA defect WW-091 (alias-link-select-empty-cold-load).
 * Expected behavior: on a cold, direct load of an unknown /effort/:slug, the
 * Link as Alias picker offers the registered efforts as targets, so a target
 * can be selected and Confirm Link enabled (PRP-01 Scenario 4, step 2).
 * Current defect: the not-found branch renders the picker from the
 * existingEfforts memo while the effort registry has not hydrated on the cold
 * load, so the select has 0 <option> elements and Confirm Link stays disabled.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('WW-091 — Link-as-Alias picker on cold load', () => {
  test('WW-091: cold-loading an unknown slug offers alias targets and Confirm Link works', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    const unknownSlug = `never-registered-${Date.now().toString().slice(-6)}`;

    // Cold load: navigate straight to the unknown slug as a fresh page load.
    // Do NOT pass through the hydrated /efforts catalog first — the warm
    // in-app transition is the path that masks this defect (it is how the
    // existing PRP-01 Scenario 4 exercises the picker).
    const detail = await app.properties.openEffort(unknownSlug);
    await expect(detail.detailNotFound()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_BTN).click();
    const aliasSelect = page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_SELECT);
    await expect(aliasSelect).toBeVisible();
    await aliasSelect.click();

    await expect
      .poll(async () => page.getByRole('option').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const burpeeOption = page.getByRole('option', { name: /\(burpee\)/i });
    await expect(burpeeOption).toBeVisible();

    await burpeeOption.click();
    const confirm = page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_ALIAS_CONFIRM);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(/\/effort\/burpee$/, { timeout: 15_000 });
    await expect(detail.detailLabel()).toHaveText('Burpee');
  });
});
