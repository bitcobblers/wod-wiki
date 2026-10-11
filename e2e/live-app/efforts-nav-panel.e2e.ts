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

test.describe('Efforts nav panel', () => {
  test('shows origin and discipline filters on the catalog route', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoCatalog();
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForCatalogLoaded();

    await efforts.applyQuery(':effort{discipline:kettlebell}');
    await expect(efforts.effortRow('kettlebell-swing')).toBeVisible();
    await expect(efforts.effortRow('burpee')).toHaveCount(0);

    await efforts.applyQuery(':effort{origin:bundled}');
    await expect(efforts.effortRow('burpee')).toBeVisible();

    errors.expectClean();
  });

  test('filters to custom efforts when a user-defined effort exists', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoCatalog();
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await efforts.clearUserEfforts();
    await efforts.seedUserEffort({
      slug: 'qa-custom-effort',
      label: 'QA Custom Effort',
      discipline: 'strength',
      intensityTier: 'moderate',
      body: 'Custom effort body seeded from Playwright.',
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForCatalogLoaded();
    await efforts.applyQuery(':effort{origin:user}');

    await expect(efforts.effortRow('qa-custom-effort')).toBeVisible();
    await expect(efforts.effortRows()).toHaveCount(1);

    errors.expectClean();
  });
});
