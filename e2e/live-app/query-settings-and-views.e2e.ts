// spec: e2e/specs/analytics/query-settings-and-views.md
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

const JOURNAL = '/journal';
const VISIBLE_TRIGGER = '[data-testid="query-settings-trigger"]:visible';
const VISIBLE_COMPOSER = '[data-testid="wql-composer-root"]:visible';
const VISIBLE_STATUS = '[data-testid="stream-query-status"]:visible';

async function openQuerySettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Page options', exact: true }).click();
  await page.locator(VISIBLE_TRIGGER).click();
  await expect(page.getByTestId('query-settings-panel')).toBeVisible();
}

async function closeQuerySettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('query-settings-panel')).toBeHidden();
}

async function composerText(page: Page): Promise<string> {
  return (await page.locator(VISIBLE_COMPOSER).first().textContent()) ?? '';
}

test.describe('ANL-01 — Per-Surface Query Settings & Explorer Navigation', () => {
  test.beforeEach(async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.journal.openStream();
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.includes('routeWql'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
  });

  test('Scenario 1: Query settings edit, validate, group-by, reset, and redirect cleanly across reload', async ({
    app,
  }) => {
    const { page } = app;

    // 1. Query settings entry & system default readout
    await openQuerySettings(page);
    await expect(page.getByRole('heading', { name: 'Journal query settings' })).toBeVisible();
    await expect(
      page.getByTestId('query-settings-panel').getByText(':note{notebook:journal} by {date} last 4w'),
    ).toBeVisible();

    // 2. Save landing default -> immediate re-seed + survives reload
    await page.getByTestId('query-settings-wql').fill(':journal{} last 52w');
    await page.getByTestId('query-settings-save').click();
    await expect.poll(() => composerText(page)).toContain('52w');
    await closeQuerySettings(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect.poll(() => composerText(page)).toContain('52w');

    // 3. Invalid WQL blocks save
    await openQuerySettings(page);
    await page.getByTestId('query-settings-wql').fill(':note{');
    await expect(page.getByTestId('query-settings-wql-error')).toBeVisible();
    await expect(page.getByTestId('query-settings-save')).toBeDisabled();

    // 4. Group-By favorite drives arrangement strip
    await page.getByTestId('query-settings-wql').fill(':journal{}');
    await page.getByTestId('query-settings-group-custom').click();
    await page.getByTestId('query-settings-group-add-week').click();
    await page.getByTestId('query-settings-save').click();
    await expect.poll(() => page.locator(VISIBLE_STATUS).first().textContent()).toContain('by week');
    await closeQuerySettings(page);

    // 5. Reset returns surface to system default across reload
    await openQuerySettings(page);
    await page.getByTestId('query-settings-reset').click();
    await expect(page.getByTestId('query-settings-wql')).toHaveValue('');
    await closeQuerySettings(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect.poll(() => composerText(page)).not.toContain('52w');

    // 6. Retired /settings/queries redirects to library
    await app.goto('/settings/queries');
    await expect(page).toHaveURL(new RegExp(`${JOURNAL}$`));

    app.assertCleanConsole();
  });

  test('Scenario 2: dashboard L2 navigation opens Metric Explorer and runs an example query (explore-navigation)', async ({
    app,
  }) => {
    const { page } = app;
    const dashboardNoteId = 'dashboard/anl01-nav-dashboard';

    await app.seed.note(
      dashboardNoteId,
      '---\ndashboard: true\nslug: anl01-nav-dashboard\ntitle: ANL01 Nav Dashboard\n---\n\n# ANL01 Nav Dashboard\n',
      { type: 'dashboard', title: 'ANL01 Nav Dashboard' },
    );

    try {
      await app.wql.openDashboard('anl01-nav-dashboard');
      const navigation = page.getByRole('navigation').first();
      await expect(navigation.getByRole('button', { name: 'Dashboards', exact: true })).toBeVisible();
      const explore = navigation.getByRole('button', { name: 'Explorer', exact: true });
      await expect(explore).toBeVisible();
      await expect(navigation.getByRole('button', { name: 'ANL01 Nav Dashboard' })).toBeVisible({ timeout: 15_000 });
      await expect(navigation.getByRole('button', { name: 'New dashboard' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'ANL01 Nav Dashboard' })).toBeVisible({ timeout: 15_000 });

      await explore.click();
      await expect(page).toHaveURL(/\/dashboards(?:\?.*)?$/);
      await expect(page.getByRole('heading', { name: 'Metric Explorer' })).toBeVisible();
      await expect(page.getByText(/Cannot parse/)).toHaveCount(0);

      const example = navigation.getByRole('button', { name: 'Weekly strength volume' });
      await expect(example).toBeVisible();
      await example.click();
      await expect(page).toHaveURL(/[?&]q=/);
      await expect(example).toContainText('Weekly strength volume');

      app.assertCleanConsole();
    } finally {
      await deleteNoteByRouteId(page, dashboardNoteId);
    }
  });
});
