import { expect, test, type Page } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Per-page query settings — a surface's own query configuration, edited
 * where the query lives.
 *
 * The landing default query, the Where-stored scope favorites, the
 * Group-By favorites and the saved navigation links used to sit on a global
 * /settings/queries page listing every surface at once. They are per-surface
 * facts about one page's query, so they belong to that page: the library
 * pages open them from their own options surface.
 *
 * Asserts:
 *   1. The options surface carries a "Query settings" entry that opens the
 *      page's own editor.
 *   2. A saved landing default takes effect on the open page — the composer
 *      re-seeds — and survives a reload.
 *   3. An unparseable default is reported and blocks the save.
 *   4. The Group-By favorites drive the arrangement: the stored favorite
 *      becomes the dimension a bare landing groups by.
 *   5. Reset returns the surface to its system default.
 *   6. The retired /settings/queries route redirects to the library.
 */

const JOURNAL = '/journal';

/**
 * The trigger is rendered in every page-options surface — the 2xl+ rail, the
 * `⋯` dropdown below it, and the mobile right drawer — so only one copy is
 * visible at a time. Scope to the visible one.
 */
const VISIBLE_TRIGGER = '[data-testid="query-settings-trigger"]:visible';

/** The visible WQL composer — the header one on desktop, the dock one on mobile. */
const VISIBLE_COMPOSER = '[data-testid="wql-composer-root"]:visible';

/** The visible arrangement strip — it names the dimension the page groups by. */
const VISIBLE_STATUS = '[data-testid="stream-query-status"]:visible';

/**
 * Open the page's options surface and the query-settings dialog.
 *
 * The options surface is the `⋯` menu on desktop and the right drawer on
 * mobile — both expose the same trigger.
 */
async function openQuerySettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Page options', exact: true }).click();
  await page.locator(VISIBLE_TRIGGER).click();
  await expect(page.getByTestId('query-settings-panel')).toBeVisible();
}

/** Close the query-settings dialog (its overlay blocks the page beneath). */
async function closeQuerySettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('query-settings-panel')).toBeHidden();
}

/** The text the visible composer currently shows. */
async function composerText(page: Page): Promise<string> {
  return (await page.locator(VISIBLE_COMPOSER).first().textContent()) ?? '';
}

test.describe('Page query settings — library surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(JOURNAL, { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    // Start from a clean slate so a stored override from an earlier test
    // cannot leak into the next one.
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.includes('routeWql'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
  });

  test('the options surface carries a Query settings entry that opens the page editor', async ({ page }) => {
    await openQuerySettings(page);

    await expect(page.getByRole('heading', { name: 'Journal query settings' })).toBeVisible();
    // The system default is shown read-only beside the editable value — the
    // copyable note-plane form (`:note{…} by {date}`), not a scoped head.
    await expect(
      page.getByTestId('query-settings-panel').getByText(':note{notebook:journal} by {date} last 4w'),
    ).toBeVisible();
  });

  test('a saved landing default takes effect on the open page and survives a reload', async ({ page }) => {
    await openQuerySettings(page);

    await page.getByTestId('query-settings-wql').fill(':journal{} last 52w');
    await page.getByTestId('query-settings-save').click();

    // The open page re-seeds — the default applies without a reload.
    await expect.poll(() => composerText(page)).toContain('52w');
    await closeQuerySettings(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await expect.poll(() => composerText(page)).toContain('52w');
  });

  test('an unparseable default is reported and blocks the save', async ({ page }) => {
    await openQuerySettings(page);

    await page.getByTestId('query-settings-wql').fill(':note{');
    await expect(page.getByTestId('query-settings-wql-error')).toBeVisible();
    await expect(page.getByTestId('query-settings-save')).toBeDisabled();
  });

  test('the Group-By favorites drive the arrangement dimension', async ({ page }) => {
    await openQuerySettings(page);

    // A query grouping beats a stored favorite (the query leg wins), so make
    // the landing bare — the journal default carries `by {date}` in the
    // query itself — then store the favorite.
    await page.getByTestId('query-settings-wql').fill(':journal{}');
    await page.getByTestId('query-settings-group-custom').click();
    await page.getByTestId('query-settings-group-add-week').click();
    await page.getByTestId('query-settings-save').click();

    // The stored favorite becomes the dimension a bare landing groups by —
    // and the strip says so.
    await expect
      .poll(() => page.locator(VISIBLE_STATUS).first().textContent())
      .toContain('by week');
    await closeQuerySettings(page);
  });

  test('reset returns the surface to its system default', async ({ page }) => {
    await openQuerySettings(page);

    await page.getByTestId('query-settings-wql').fill(':journal{} last 52w');
    await page.getByTestId('query-settings-save').click();
    await expect.poll(() => composerText(page)).toContain('52w');
    await closeQuerySettings(page);

    await openQuerySettings(page);
    await page.getByTestId('query-settings-reset').click();

    await expect(page.getByTestId('query-settings-wql')).toHaveValue('');
    await closeQuerySettings(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await expect.poll(() => composerText(page)).not.toContain('52w');
  });

  test('the retired /settings/queries route redirects to the library', async ({ page }) => {
    await page.goto('/settings/queries', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${JOURNAL}$`));
  });
});
