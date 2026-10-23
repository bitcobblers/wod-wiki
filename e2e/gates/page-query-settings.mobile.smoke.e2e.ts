import { test, expect } from '@playwright/test';
import { waitForSeedReady } from '../helpers/seedReadiness';

/**
 * Mobile gate (journal-mobile-375 project): the per-page query settings
 * sheet renders without horizontal overflow at a 375px viewport.
 *
 * The editor is a bottom sheet on phones — the same panel the desktop
 * dialog shows — so the sheet must fit the narrow viewport.
 */

test('the query settings sheet fits 375px without horizontal overflow', async ({ page }) => {
  await page.goto('/journal', { waitUntil: 'domcontentloaded' });
  await waitForSeedReady(page);
  await expect(page.getByRole('main').first()).toBeVisible();

  // The page options drawer carries the trigger on phones.
  await page.getByRole('button', { name: 'Open page options' }).click();
  await page.locator('[data-testid="query-settings-trigger"]:visible').click();

  const panel = page.getByTestId('query-settings-panel');
  await expect(panel).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  // The sheet offers the same editor as the desktop dialog.
  await expect(panel.getByTestId('query-settings-wql')).toBeVisible();
  await expect(panel.getByTestId('query-settings-save')).toBeVisible();
});
