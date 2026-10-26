import { expect, test } from '@playwright/test';

/**
 * Tag Types (/settings/tags) — the taxonomy of tag kinds.
 *
 * A kind says what a tag is for (equipment, discipline, …). The tags
 * themselves — and what they contribute — are authored on the Tags page
 * (/tags); this page administers the kinds, and reports how many tags use
 * each one.
 */

test.describe('Tag Types — /settings/tags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/tags');
    await expect(page.getByRole('heading', { name: 'Tag Types', level: 2 })).toBeVisible();
  });

  test('lists the kinds the app offers', async ({ page }) => {
    // Scope to the section — the nav rail and its tooltip also carry
    // an exact 'Equipment' text.
    const section = page.locator('section');
    await expect(section.getByText('Equipment', { exact: true })).toBeVisible();
    await expect(section.getByText('Discipline', { exact: true })).toBeVisible();
  });

  test('points at the Tags page for the tags themselves', async ({ page }) => {
    await expect(page.getByText('/tags')).toBeVisible();
  });

  test('creates a kind', async ({ page }) => {
    await page.getByPlaceholder('Type name (e.g. discipline)').fill('movement');
    await page.getByPlaceholder('Display label (e.g. Discipline)').fill('Movement');
    await page.getByRole('button', { name: /Add Type/i }).click();

    await expect(page.getByText('Movement', { exact: true })).toBeVisible();
  });
});
