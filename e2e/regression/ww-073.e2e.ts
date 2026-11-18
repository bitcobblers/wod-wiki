/**
 * WW-073 — Feed overflow menu ignores Escape (backdrop click works) — contradicts FED-01 Scenario 3 despite handler + passing test in source (medium)
 *
 * Regression test for the open QA defect WW-073 (feed-overflow-menu-escape-noop).
 * Expected behavior: pressing Escape dismisses an open feed overflow menu,
 * wherever focus sits after interacting with the menu — the same dismissal the
 * backdrop click already provides (FED-01 Scenario 3).
 * Current defect: the only Escape handler lives on the <details> element's
 * onKeyDown (SyncSection.tsx), so it fires only while focus is inside the
 * details; once focus has left the menu (e.g. after clicking the menu panel),
 * Escape is a no-op and the menu stays open.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-14-nightly-060215).
 */
import { test, expect } from '../fixtures/playgroundActor';

const MANAGE_URL = 'https://manage.example.org/library/';
const MANAGE_REPO = 'https://github.com/example/manage-library';
const MANAGE_SOURCE = {
  id: 'manage-library',
  label: 'Manage Library',
  url: MANAGE_URL,
  repositoryUrl: MANAGE_REPO,
};
const MANAGE_MANIFEST = {
  schema: 9,
  version: 42,
  builtAt: '2026-10-15T00:00:00.000Z',
  name: MANAGE_SOURCE.label,
  description: 'Seeded e2e catalog',
  repositoryUrl: MANAGE_REPO,
  chunks: [],
};

test.describe('WW-073 — Feed overflow menu Escape dismissal', () => {
  test.beforeEach(async ({ app }) => {
    const { page } = app;
    await page.addInitScript((src) => {
      localStorage.setItem('wodwiki.seedSources', JSON.stringify([src]));
    }, MANAGE_SOURCE);
    await page.context().route(`${MANAGE_URL}manifest.json`, (route) => route.fulfill({ json: MANAGE_MANIFEST }));

    await app.goto('/settings/sync');
    await page.getByRole('checkbox', { name: 'Subscribed only' }).setChecked(false);
    await expect(page.getByTestId('feed-source-manage-library')).toBeVisible({ timeout: 15_000 });
  });

  test('WW-073: Escape closes the overflow menu after focus has left the menu panel', async ({ app }) => {
    const { page } = app;
    const row = page.getByTestId('feed-source-manage-library');
    const more = row.getByTestId('feed-more-manage-library');

    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');

    // Click the menu panel's own padding (not a button/link): the panel stays
    // open, but focus leaves the <details> element — the state a real user is
    // in after poking at the menu. Escape must still dismiss it.
    const panel = more.locator('> div').nth(1);
    await panel.click({ position: { x: 4, y: 4 } });
    await expect(more).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    await expect(more).not.toHaveAttribute('open', '');
  });

  test('WW-073 (path 2): Escape closes the overflow menu while the summary is focused (FED-01 Scenario 3)', async ({
    app,
  }) => {
    const { page } = app;
    const row = page.getByTestId('feed-source-manage-library');
    const more = row.getByTestId('feed-more-manage-library');

    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');

    await page.keyboard.press('Escape');
    await expect(more).not.toHaveAttribute('open', '');
  });
});
