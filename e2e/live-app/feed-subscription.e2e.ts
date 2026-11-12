import { test, expect } from '@playwright/test';

test('more actions menu dismisses on Escape and backdrop click without blocking browse', async ({ page }) => {
  await page.goto('/settings/sync');
  const subscribedOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
  await subscribedOnly.setChecked(false);

  const moreDetails = page.locator('details[data-testid^="feed-more-"]').first();
  await expect(moreDetails).toBeVisible();

  // Open details
  await moreDetails.locator('summary').click();
  await expect(moreDetails).toHaveAttribute('open', '');

  // Escape dismisses
  await page.keyboard.press('Escape');
  await expect(moreDetails).not.toHaveAttribute('open', '');

  // Open again and click backdrop
  await moreDetails.locator('summary').click();
  await expect(moreDetails).toHaveAttribute('open', '');
  const backdrop = moreDetails.locator('[data-testid="feed-more-backdrop"]');
  await expect(backdrop).toBeVisible();
  await backdrop.click({ position: { x: 5, y: 5 } });
  await expect(moreDetails).not.toHaveAttribute('open', '');
});
