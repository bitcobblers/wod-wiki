import { test, expect, type Page } from '@playwright/test';

/**
 * Deployed-Storybook acceptance: the database-driven stories work against a
 * REAL browser IndexedDB, not fixtures.
 *
 * Runs against STORYBOOK_URL (set by playwright.storybook.config.ts) the same
 * way storybook.smoke.e2e.ts does. Story IDs are pinned against the build's
 * index.json.
 *
 * The flow mirrors what a person does on the landing page:
 *   1. land on the IndexedDB selection page,
 *   2. see the default database and its imported core corpus,
 *   3. create a second database and switch to it,
 *   4. search the active database's notes and load one into the workbench,
 *   5. run the workout and see it stored as a session,
 *   6. find that session in the Session Explorer,
 *   7. find notes through the WQL library search,
 *   8. generate a dashboard in the active database.
 *
 * The database page is the FIRST story in the sorted sidebar, so a fresh
 * visitor lands on it.
 */

function storyUrl(storyId: string) {
  return `/iframe.html?id=${storyId}&viewMode=story`;
}

/** The core seed import is a network round trip; give it room on a cold origin. */
const SEED_TIMEOUT = 60_000;

async function gotoStory(page: Page, storyId: string) {
  await page.goto(storyUrl(storyId), { waitUntil: 'domcontentloaded' });
}

test.describe('database-driven Storybook stories', () => {
  test('the landing page lists the default database with the core corpus imported', async ({ page }) => {
    await gotoStory(page, 'database--indexed-db-selection');

    // The default database is created and activated on first use.
    await expect(page.getByTestId('database-row-wodwiki-db')).toBeVisible({ timeout: SEED_TIMEOUT });
    await expect(page.getByTestId('database-active-badge')).toBeVisible();

    // The core corpus is auto-populated exactly like the playground app.
    await expect(page.getByTestId('seed-status')).toContainText(/core corpus imported/i, { timeout: SEED_TIMEOUT });
  });

  test('a second database can be created and selected', async ({ page }) => {
    await gotoStory(page, 'database--indexed-db-selection');
    await expect(page.getByTestId('database-row-wodwiki-db')).toBeVisible({ timeout: SEED_TIMEOUT });

    const name = 'wodwiki-e2e-scratch';
    await page.getByTestId('database-create-input').fill(name);
    await page.getByTestId('database-create-button').click();

    // The new database appears and becomes the active one. Only a
    // non-active database offers a "Use" button, so the active marker
    // moves rather than a button appearing.
    const createdRow = page.getByTestId(`database-row-${name}`);
    await expect(createdRow).toBeVisible({ timeout: SEED_TIMEOUT });
    await expect(createdRow.getByTestId('database-active-badge')).toBeVisible({ timeout: SEED_TIMEOUT });

    // Switch back: the default database becomes active again.
    await page.getByTestId('database-select-wodwiki-db').click();
    await expect(page.getByTestId('database-row-wodwiki-db').getByTestId('database-active-badge')).toBeVisible({ timeout: SEED_TIMEOUT });
  });

  test('an invalid database name is rejected inline', async ({ page }) => {
    await gotoStory(page, 'database--indexed-db-selection');
    await expect(page.getByTestId('database-row-wodwiki-db')).toBeVisible({ timeout: SEED_TIMEOUT });

    await page.getByTestId('database-create-input').fill('not a valid name');
    await page.getByTestId('database-create-button').click();

    await expect(page.getByTestId('database-create-error')).toBeVisible();
  });

  test('a workout run is stored as a session in the active database', async ({ page }) => {
    await gotoStory(page, 'playground--library-page');
    await expect(page.getByTestId('playground-library-page')).toBeVisible({ timeout: SEED_TIMEOUT });

    // The command palette opens from the Find button (or Ctrl+/ shortcut).
    await page.getByTestId('playground-library-find').click();

    // The palette searches the active database notes.
    const searchInput = page.getByTestId('palette-search-input');
    await expect(searchInput).toBeVisible({ timeout: SEED_TIMEOUT });
    await searchInput.fill('AMRAP');

    // Select the matching workout note to load it into the workbench.
    const amrapOption = page.getByRole('option', { name: /AMRAP/i }).first();
    await expect(amrapOption).toBeVisible({ timeout: SEED_TIMEOUT });
    await amrapOption.click();

    // The note is loaded into the active indicator and workbench.
    await expect(page.getByTestId('playground-library-selected')).toContainText('AMRAP');
    // The workbench compiles the fence and the run starts.
    await expect(page.getByTestId('statement-strip')).toBeVisible();
    await expect(page.getByTestId('panel-wallclock')).toBeVisible();

    // Stop the run: the session is finalized and written to the database.
    // The write is asynchronous — wait for the saved signal before moving on.
    await page.getByTestId('timer-stop-session').click();
    await expect(page.getByTestId('workbench-persist-status')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
    await expect(page.getByTestId('workbench-persist-error')).toHaveCount(0);

    // The stored session is visible in the Session Explorer.
    await gotoStory(page, 'sessions--session-explorer');
    await expect(page.getByTestId('session-row').first()).toBeVisible({ timeout: SEED_TIMEOUT });
  });

  test('the WQL library search returns notes from the active database', async ({ page }) => {
    await gotoStory(page, 'data--wql-library-search');
    await expect(page.getByTestId('library-search-results')).toBeVisible({ timeout: SEED_TIMEOUT });
    await expect(page.getByTestId('library-search-row').first()).toBeVisible({ timeout: SEED_TIMEOUT });
  });

  test('the dashboard generator writes a dashboard into the active database', async ({ page }) => {
    await gotoStory(page, 'data--dashboard-generator');
    await expect(page.getByTestId('dashboard-title-input')).toBeVisible({ timeout: SEED_TIMEOUT });

    const title = `E2E Board ${Date.now()}`;
    await page.getByTestId('dashboard-title-input').fill(title);
    await page.getByRole('button', { name: /create dashboard/i }).click();

    // The new dashboard is listed back from the active database.
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible({ timeout: 30_000 });
  });
});
