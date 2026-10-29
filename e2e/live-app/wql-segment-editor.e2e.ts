import { expect, test, type Page } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';

const VISIBLE_COMPOSER = '[data-testid="wql-composer-root"]:visible';

async function activateFirstFilter(page: Page) {
  const editor = page.locator(VISIBLE_COMPOSER).getByLabel('WQL', { exact: true });
  await editor.click();
  await editor.press('Home');
  await editor.press('Tab');
  await expect(page.getByTestId('wql-field-picker')).toBeVisible();
}

test('library WQL activation expands the sticky header and traverses segments', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/journal', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
  const boundary = page.locator('[data-page-sticky-boundary="true"]:visible').first();
  const initialHeight = (await boundary.boundingBox())?.height ?? 0;
  const groupHeader = page.locator('[data-testid^="date-group-"] .sticky, [data-testid^="stream-feed-group-"] .sticky').first();
  await activateFirstFilter(page);
  await expect(page.locator('.wql-active-segment')).toBeVisible();
  await expect.poll(async () => (await boundary.boundingBox())?.height ?? 0).toBeGreaterThan(initialHeight);
  if (await groupHeader.count() > 0) {
    const expandedBottom = (await boundary.boundingBox())?.bottom ?? 0;
    await expect.poll(async () => {
      const topStyle = await groupHeader.evaluate(el => Number.parseFloat(getComputedStyle(el).top));
      return Math.abs(topStyle - expandedBottom) < 2;
    }).toBe(true);
  }
  const picker = page.getByTestId('wql-picker-search');
  const initialLabel = await picker.getAttribute('aria-label');
  await picker.press('Tab');
  expect(await picker.getAttribute('aria-label')).not.toBe(initialLabel);
  await picker.press('Shift+Tab');
  expect(await picker.getAttribute('aria-label')).toBe(initialLabel);
});

test('mobile command palette uses the compact second-row writer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/journal', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
  await page.getByTestId('stream-query-bar-dock').getByTestId('stream-query-bar').click();
  await expect(page.getByTestId('palette-composer')).toBeVisible();
  await activateFirstFilter(page);
  const picker = page.getByTestId('wql-picker-search');
  const initialLabel = await picker.getAttribute('aria-label');
  await page.getByTestId('wql-segment-next').click();
  expect(await picker.getAttribute('aria-label')).not.toBe(initialLabel);
  await page.getByTestId('wql-segment-previous').click();
  expect(await picker.getAttribute('aria-label')).toBe(initialLabel);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
