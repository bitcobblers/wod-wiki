// spec: e2e/specs/properties/effort-creation-and-tag-mobile-layout.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('PRP-03 — Effort Creation, WQL Syntax Guidance & Mobile Tag Layout', () => {
  test('Scenario 1: invalid WQL shows syntax hint and newly created Effort resolves immediately on /effort/:slug', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.seed.bundledEfforts();

    await app.goto('/efforts');
    await app.wql.fillStreamQueryBar('kettlebell');

    const status = page.getByTestId('stream-query-status');
    await expect(status).toContainText('Invalid query — showing previous results');
    await expect(status).toContainText(':effort{text:kettlebell}');

    // Create new Effort via + Add dialog (WW-035)
    await page.getByRole('button', { name: /\+ Add/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Select Catalog / Effort tab or radio option
    const catalogBtn = dialog.getByRole('button', { name: /Catalog/i });
    if (await catalogBtn.count()) {
      await catalogBtn.first().click();
    }
    const effortOption = dialog.getByRole('button', { name: /^Effort$/i }).or(dialog.getByText(/^Effort$/i));
    if (await effortOption.count()) {
      await effortOption.first().click();
    }

    const titleInput = dialog.getByLabel(/Title|Name/i).or(dialog.locator('input[type="text"]').first());
    const uniqueName = `QA Turkish Get Up ${Date.now().toString().slice(-4)}`;
    await titleInput.first().fill(uniqueName);
    await dialog.getByRole('button', { name: /^Create$/i }).click();

    await expect(page).toHaveURL(/\/effort\/qa-turkish-get-up/);
    await expect(page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND)).toHaveCount(0);
    await expect(page.locator('main').first()).toContainText(uniqueName);
    app.assertCleanConsole();
  });

  test('Scenario 2: /t/quality/strength fits 375x812 without overflow and unknown /notebook/:slug shows not-found', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });

    // WW-037: Tag drill-down at 375x812 must have zero horizontal overflow
    await app.goto('/t/quality/strength');
    await expect(page.locator('#tags-new')).toBeVisible();
    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowPx).toBeLessThanOrEqual(1);

    // WW-032: Unknown notebook slug renders explicit not-found recovery state
    await app.goto('/notebook/does-not-exist-qa');
    const notFound = page.getByTestId(TEST_IDS.NOTEBOOK_NOT_FOUND);
    await expect(notFound).toBeVisible();
    await expect(notFound).toContainText('does-not-exist-qa');
    await expect(page.getByRole('button', { name: /\+ Add Note/i })).toHaveCount(0);

    app.assertCleanConsole();
  });
});
