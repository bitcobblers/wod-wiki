import { expect, test, type Page } from '@playwright/test';
import { EffortsPage } from '../pages/EffortsPage';
import { seedBundledEfforts } from '../helpers/seedEfforts';

function attachErrorCapture(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  return {
    expectClean() {
      expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
      expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
    },
  };
}

test.describe('Effort markdown seed visibility', () => {
  test('renders seeded burpee markdown body on the detail page', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoDetail('burpee');
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();

    await expect(page.getByText('Burpees are a full-body conditioning effort that combine a squat, plank, and jump.')).toBeVisible();
    await expect(page.getByText('Use this bundled note to seed markdown-backed effort detail content in the UI.')).toBeVisible();

    errors.expectClean();
  });

  test('renders seeded kettlebell swing markdown body on the detail page', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoDetail('kettlebell-swing');
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();

    await expect(page.getByText('Kettlebell swings train hip extension and cyclical power production.')).toBeVisible();
    await expect(page.getByText('The movement can be scaled as Russian or American swings depending on range of motion.')).toBeVisible();

    errors.expectClean();
  });
});
