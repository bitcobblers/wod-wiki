import { expect, test } from '@playwright/test';

import { waitForFeedReady } from '../helpers/feedReadiness';

test.describe('Contextual new entry actions', () => {
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
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(0);
    await page.getByRole('button', { name: 'Page options' }).click();
    await page.getByRole('menuitem', { name: 'Add timer', exact: true }).click();
    await expect(page.locator('.cm-content').getByText('10:00', { exact: true }).first()).toBeVisible();
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

  test('does not offer generic creation on detail pages', async ({ page }) => {
    await page.goto('/');
    await waitForFeedReady(page);
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Cast to TV/ })).toBeVisible();
  });

  test('orders mobile bubbles and removes the global journal shortcut', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/journal');
    await waitForFeedReady(page);
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'New Journal entry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New journal note', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Cast to TV/ })).toBeVisible();
    await expect(page.getByTestId('actions-overflow')).toBeVisible();

    const searchY = (await page.getByTestId('search-fab').boundingBox())!.y;
    const newY = (await page.getByTestId('new-entry-primary').boundingBox())!.y;
    const menuY = (await page.getByTestId('actions-overflow').boundingBox())!.y;
    expect(searchY).toBeLessThan(newY);
    expect(newY).toBeLessThan(menuY);
  });
});
