import { test, expect } from '@playwright/test';

/**
 * Deployed-Storybook smoke: proves the artifact this pipeline just shipped
 * boots and renders the flagship workbench stories with live widget content.
 *
 * Runs against STORYBOOK_URL (set by playwright.storybook.config.ts):
 *  - main pushes → https://story.wod.wiki
 *  - PR pushes   → https://<slug>.story.wod.wiki
 *
 * Story IDs are pinned against the build's index.json — the manager-only
 * viewport here; mobile (375px) and dark-theme passes live in
 * storybook.mobile/dark.smoke.e2e.ts.
 *
 * Unit-level interaction coverage lives in apps/storybook tests
 * (vitest browser mode); this suite is the deployed-artifact gate.
 */

function storyUrl(storyId: string) {
  return `/iframe.html?id=${storyId}&viewMode=story`;
}

test('Storybook manager loads', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/storybook/i);
});

test('Language Workbench story renders live parse and wall clock panel', async ({ page }) => {
  await page.goto(storyUrl('playground--empty-workbench'), { waitUntil: 'networkidle' });

  // Compiled statements strip and wall clock panel render on workbench boot
  await expect(page.getByTestId('statement-strip')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('panel-wallclock')).toBeVisible({ timeout: 15_000 });
});

test('WQL Example Gallery story renders widgets', async ({ page }) => {
  await page.goto(storyUrl('gallery-wql-example-gallery--value-section'), { waitUntil: 'networkidle' });
  // Live gallery renders titled card over corpus QueryResult data
  await expect(page.locator('text=Average sleep').first()).toBeVisible({ timeout: 15_000 });
});

test('WQL Composer story renders clauses', async ({ page }) => {
  await page.goto(storyUrl('gallery-wql-composer--default'), { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="wql-composer"], .wql-composer').first()).toBeVisible({ timeout: 15_000 });
});

test('Timer Surfaces stories render the Minimal and General tiers', async ({ page }) => {
  await page.goto(storyUrl('gallery-timer-surfaces--minimal-rest'), { waitUntil: 'networkidle' });
  await expect(page.getByTestId('timer-status-strip')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('timer')).toBeVisible();

  await page.goto(storyUrl('gallery-timer-surfaces--general-tv'), { waitUntil: 'networkidle' });
  await expect(page.getByText('Helen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('timer-up-next-caption')).toBeVisible();
});

test('Timer Surfaces prompt-row variant renders', async ({ page }) => {
  // Live-metric prompt slot renders above the hero.
  await page.goto(storyUrl('gallery-timer-surfaces--general-prompts'), { waitUntil: 'networkidle' });
  await expect(page.getByTestId('prompts-fixture')).toBeVisible({ timeout: 15_000 });
});
