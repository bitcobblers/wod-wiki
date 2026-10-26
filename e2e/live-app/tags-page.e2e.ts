import { expect, test } from '@playwright/test';
import { gotoFeedSurface } from '../helpers/feedReadiness';

/**
 * Tags (/tags) — the catalogue of what a tag brings.
 *
 * A tag is a named bundle a script points at: `5 reps @ 100 kg #heavy`.
 * What the tag contributes applies to the line it sits on — a metric with a
 * typed value and a unit, another tag, or a function (a named calculation
 * that runs where the tag applies).
 *
 * This covers the authoring loop: create a tag, give it a contribution, see
 * the contribution kept, and delete the tag.
 */

const TAG_NAME = 'e2e-heavy';

test.describe('Tags — /tags', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeedSurface(page, '/tags');
    await expect(page.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();

    // Start from a clean slate so a tag from a previous run cannot leak in.
    const existing = page.getByRole('button', { name: TAG_NAME, exact: true });
    if (await existing.count()) {
      await existing.click();
      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(existing).toHaveCount(0);
    }
  });

  test('creates a tag and lists it', async ({ page }) => {
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();

    await expect(page.getByRole('button', { name: TAG_NAME, exact: true })).toBeVisible();
  });

  test('gives a tag a metric contribution and keeps it', async ({ page }) => {
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    const tag = page.getByRole('button', { name: TAG_NAME, exact: true });
    await expect(tag).toBeVisible();
    await tag.click();

    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();
    await page.getByRole('button', { name: 'Metric' }).click();
    await page.getByLabel('Metric type').fill('intensity');
    await page.getByLabel('Metric value').fill('heavy');
    await page.getByLabel('Metric unit').fill('text');
    await page.getByRole('button', { name: 'Save' }).click();
    // The save is a write — wait for the page to say it landed before
    // reloading.
    await expect(page.getByText('Saved')).toBeVisible();

    // The contribution survives a reload — it is stored, not just held in
    // the editor.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();
    const reloadedTag = page.getByRole('button', { name: TAG_NAME, exact: true });
    await expect(reloadedTag).toBeVisible();
    await reloadedTag.click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();
    await expect(page.getByLabel('Metric type')).toHaveValue('intensity');
    await expect(page.getByLabel('Metric value')).toHaveValue('heavy');
    await expect(page.getByLabel('Metric unit')).toHaveValue('text');
  });

  test('opens the tag a link points at', async ({ page }) => {
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    const tag = page.getByRole('button', { name: TAG_NAME, exact: true });
    await expect(tag).toBeVisible();

    // The editor links a tag reference to /tags?tag=<slug> — that link has
    // to land on the tag itself.
    await gotoFeedSurface(page, `/tags?tag=${TAG_NAME}`);
    await expect(page.getByRole('heading', { name: `Edit ${TAG_NAME}` })).toBeVisible();
  });

  test('deletes a tag', async ({ page }) => {
    await page.getByPlaceholder('heavy').fill(TAG_NAME);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    const tag = page.getByRole('button', { name: TAG_NAME, exact: true });
    await expect(tag).toBeVisible();
    await tag.click();

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('button', { name: TAG_NAME, exact: true })).toHaveCount(0);
  });
});
