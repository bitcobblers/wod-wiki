import { expect, test } from '@playwright/test';

import { waitForFeedReady } from '../helpers/feedReadiness';

test.describe('Desktop new entry combo', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test('uses the library type and hides notebook notes without a notebook context', async ({ page }) => {
    await page.goto('/journal');
    await waitForFeedReady(page);
    await expect(page.getByTestId('new-entry-primary')).toHaveText('New Journal entry');
    await page.getByRole('button', { name: 'Choose new entry type' }).click();
    await expect(page.getByTestId('new-entry-note')).toHaveCount(0);
    await expect(page.getByTestId('new-entry-playground')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/playgrounds');
    await expect(page.getByTestId('new-entry-primary')).toHaveText('New Playground');
    await page.goto('/notebooks');
    await expect(page.getByTestId('notebooks-create-button')).toHaveText('New Notebook');
    await page.goto('/notebook/defaults');
    await expect(page.getByTestId('new-entry-primary')).toHaveText('New Note');
    await page.getByRole('button', { name: 'Choose new entry type' }).click();
    await expect(page.getByTestId('new-entry-note')).toBeVisible();
  });

  test('creates a playground from another library', async ({ page }) => {
    await page.goto('/journal');
    await waitForFeedReady(page);
    await page.getByRole('button', { name: 'Choose new entry type' }).click();
    await page.getByTestId('new-entry-playground').click();
    await expect(page).toHaveURL(/\/playground\/[^/]+$/);
    await expect(page.locator('.cm-content')).toBeVisible();
  });
  test('creates a note in the current notebook', async ({ page }) => {
    await page.goto('/notebooks');
    await waitForFeedReady(page);
    await page.getByTestId('notebooks-create-button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('e.g., Morning Routines').fill('Combo notes');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL('/notebook/combo-notes');

    await page.getByTestId('new-entry-primary').click();
    await expect(page).toHaveURL(/\/notebook\/combo-notes\/[0-9a-f-]+$/);
    await expect(page.locator('.cm-content')).toContainText('Untitled note');
  });

  test('does not duplicate the desktop combo on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/journal');
    await waitForFeedReady(page);
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(0);
  });
});
