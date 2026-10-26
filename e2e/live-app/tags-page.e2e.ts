import { expect, test, type Page } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Tags — /tags is a query surface like every other list route, and
 * /t/:type/:tag is the tag's own editor.
 *
 * A tag is a named bundle a script points at: `5 reps @ 100 kg #heavy`.
 * The catalogue binds the tag plane's default query (`:tag{}`), accepts
 * `?q=` overrides that reproduce through the URL, renders one row per tag
 * (the row shows what the tag contributes), and links each row to the
 * tag's direct route. Authoring — create a tag, give it a contribution,
 * keep it, delete it — lives on the direct route.
 */

const TAG_NAME = 'e2e-heavy';

/** The visible WQL composer — the header one on desktop, the dock one on mobile. */
const VISIBLE_COMPOSER = '[data-testid="wql-composer-root"]:visible';

async function deleteTagIfPresent(page: Page): Promise<void> {
  // Start from a clean slate so a tag from a previous run cannot leak in.
  await page.goto(`/tags?q=${encodeURIComponent(`:tag{tag:${TAG_NAME}}`)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  });
  // /tags is a seed-gated surface like every other list route (#1066): let
  // the boot seed sync settle before touching rows. Waiting here also means
  // the import completes before the next navigation instead of stranding
  // its claim mid-flight.
  await waitForFeedReady(page);
  const row = page.getByTestId('library-row-tag').filter({ hasText: TAG_NAME });
  if ((await row.count()) > 0) {
    await page.goto(`/t/general/${TAG_NAME}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toHaveCount(0);
  }
}

test.describe('Tags — /tags query surface', () => {
  test.beforeEach(async ({ page }) => {
    await deleteTagIfPresent(page);
  });

  test('binds the tag plane default and renders one row per tag', async ({ page }) => {
    await page.goto(`/t/general/${TAG_NAME}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();

    await page.goto('/tags', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    // The composer carries the plane's default query.
    await expect(page.locator(VISIBLE_COMPOSER)).toContainText(':tag{}');
    // The query truth strip names the tag target.
    await expect(page.getByTestId('stream-query-status')).toContainText(':tag');
    // The tag renders as a row, and the row links to the tag's own route.
    const row = page.getByTestId('library-row-tag').filter({ hasText: TAG_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe(`/t/general/${TAG_NAME}`);
  });

  test('a ?q= override narrows the list and the URL reproduces it exactly', async ({ page }) => {
    await page.goto(`/t/general/${TAG_NAME}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();

    const q = `:tag{tag:${TAG_NAME}}`;
    await page.goto(`/tags?q=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    // The override beat the default: the composer shows the override and
    // the URL keeps it verbatim.
    await expect(page.locator(VISIBLE_COMPOSER)).toContainText(`tag:${TAG_NAME}`);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe(q);

    // The same URL reproduces the same list after a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await expect(page.getByTestId('library-row-tag').filter({ hasText: TAG_NAME })).toBeVisible({ timeout: 15_000 });
  });

  test('a tag row shows what the tag carries', async ({ page }) => {
    await page.goto(`/t/general/${TAG_NAME}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();

    await page.getByRole('button', { name: 'Metric' }).click();
    await page.getByLabel('Metric type').fill('intensity');
    await page.getByLabel('Metric value').fill('heavy');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    await page.goto(`/tags?q=${encodeURIComponent(`:tag{tag:${TAG_NAME}}`)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await waitForFeedReady(page);
    const row = page.getByTestId('library-row-tag').filter({ hasText: TAG_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('contributes metric intensity');
  });
});

test.describe('Tags — /t/:type/:tag editor', () => {
  test.beforeEach(async ({ page }) => {
    await deleteTagIfPresent(page);
  });

  test('creates a tag, keeps its contribution across a reload, and deletes it', async ({ page }) => {
    await page.goto(`/t/general/${TAG_NAME}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();

    await page.getByRole('button', { name: 'Metric' }).click();
    await page.getByLabel('Metric type').fill('intensity');
    await page.getByLabel('Metric value').fill('heavy');
    await page.getByLabel('Metric unit').fill('text');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // The contribution survives a reload — it is stored, not just held in
    // the editor.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Metric type')).toHaveValue('intensity');
    await expect(page.getByLabel('Metric value')).toHaveValue('heavy');
    await expect(page.getByLabel('Metric unit')).toHaveValue('text');

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toHaveCount(0);
  });
});
