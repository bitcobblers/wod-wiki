// spec: e2e/specs/properties/tags-management.md
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/playgroundActor';

const TAG_NAME = 'e2e-heavy';
const VISIBLE_COMPOSER = '[data-testid="wql-composer-root"]:visible';

async function deleteTagIfPresent(page: Page, gotoTags: (url: string) => Promise<void>): Promise<void> {
  await gotoTags(`/tags?q=${encodeURIComponent(`:tag{tag:${TAG_NAME}}`)}`);
  const row = page.getByTestId('library-row-tag').filter({ hasText: TAG_NAME });
  if ((await row.count()) > 0) {
    await page.goto(`/t/general/${TAG_NAME}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toHaveCount(0);
  }
}

test.describe('PRP-05 — Tag Catalog Query Surface & Direct Property Editor', () => {
  test.beforeEach(async ({ app }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await deleteTagIfPresent(app.page, (url) => app.goto(url));
  });

  test('Scenario 1: /tags binds :tag{} default, narrows via ?q= across reload, and renders contribution summary', async ({
    app,
  }) => {
    const { page } = app;

    await app.properties.openTags('general', TAG_NAME);
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();

    await page.getByRole('button', { name: 'Metric' }).click();
    await page.getByLabel('Metric type').fill('intensity');
    await page.getByLabel('Metric value').fill('heavy');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // Default /tags query surface (Split-Pills at rest, Scope Map when toggled)
    await app.properties.openTags();
    await expect(page.locator(VISIBLE_COMPOSER).getByTestId('token-slot-value-target')).toHaveText('tag');
    await expect(page.getByTestId('stream-query-status')).toContainText(':tag');
    await page.locator(VISIBLE_COMPOSER).getByTestId('wql-scope-toggle').click();
    await expect(page.locator(VISIBLE_COMPOSER)).toContainText(':tag{}');

    // ?q= override narrows list and survives reload
    const q = `:tag{tag:${TAG_NAME}}`;
    await app.goto(`/tags?q=${encodeURIComponent(q)}`);
    await expect(page.locator(VISIBLE_COMPOSER).getByTestId('token-slot-value-tag')).toHaveText(TAG_NAME);
    await page.locator(VISIBLE_COMPOSER).getByTestId('wql-scope-toggle').click();
    await expect(page.locator(VISIBLE_COMPOSER)).toContainText(`tag:${TAG_NAME}`);
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(q);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    const row = page.getByTestId('library-row-tag').filter({ hasText: TAG_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('contributes metric intensity');

    await row.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe(`/t/general/${TAG_NAME}`);

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toHaveCount(0);
    app.assertCleanConsole();
  });

  test('Scenario 2: /t/:type/:tag creates a Tag with contribution, persists across reload, and deletes cleanly', async ({
    app,
  }) => {
    const { page } = app;

    await app.properties.openTags('general', TAG_NAME);
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();

    await page.getByRole('button', { name: 'Metric' }).click();
    await page.getByLabel('Metric type').fill('resistance');
    await page.getByLabel('Metric value').fill('24');
    await page.getByLabel('Metric unit').fill('kg');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Metric type')).toHaveValue('resistance');
    await expect(page.getByLabel('Metric value')).toHaveValue('24');
    await expect(page.getByLabel('Metric unit')).toHaveValue('kg');

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toHaveCount(0);
    app.assertCleanConsole();
  });
});
