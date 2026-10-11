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

test.describe('Efforts catalog — /efforts', () => {
  test('loads catalog chrome and shows bundled efforts', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoCatalog();
    // The effort corpus lives in the wod-wiki-community repo (not bundled);
    // seed the fixture registry this test asserts against.
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForCatalogLoaded();

    await expect(efforts.catalogSearch()).toBeVisible();
    await expect(efforts.createCustomButton()).toBeVisible();
    await expect(efforts.effortRow('burpee')).toBeVisible();
    await expect(efforts.effortRow('rowing')).toBeVisible();
    await expect.poll(() => efforts.effortRows().count(), { timeout: 15_000 }).toBeGreaterThan(10);

    errors.expectClean();
  });

  test('filters the catalog by search text', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoCatalog();
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForCatalogLoaded();
    await efforts.searchFor('burpee');

    // 'burpee' legitimately matches the whole family (Burpee, Burpee pull up,
    // Burpee box jump over, …) — assert the exact row plus the family, not a
    // singleton count.
    await expect(efforts.effortRow('burpee')).toBeVisible();
    await expect(efforts.effortRow('burpee-pull-up')).toBeVisible();
    expect(await efforts.effortRows().count()).toBeGreaterThanOrEqual(2);

    await efforts.searchFor('');
    await expect(efforts.effortRow('rowing')).toBeVisible();

    errors.expectClean();
  });

  test('opens effort detail when a catalog row is clicked', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoCatalog();
    await efforts.clickEffortRow('burpee');

    await expect(page).toHaveURL(/\/e\/burpee$/);
    await expect(efforts.detailLabel()).toHaveText('Burpee');

    errors.expectClean();
  });

  test('opens create-custom flow from the catalog CTA and creates the effort', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);
    const slug = `e2e-create-${Date.now()}`;

    await efforts.gotoCatalog();
    await efforts.createCustomButton().click();

    // Create mode renders a plain textarea + "Create Effort" action — no
    // editor chrome or detail testids (EffortDetailPage isCreateMode branch).
    await expect(page).toHaveURL(/\/e\/new\?mode=create$/);
    const doc = page.locator('textarea[aria-label="Effort document"]');
    await expect(doc).toBeVisible();
    await doc.fill([
      '---',
      `slug: ${slug}`,
      'label: E2E Create Flow',
      'aliases:',
      `  - ${slug}`,
      'baseAttributes:',
      '  met: 5.0',
      'registrySource: user',
      '---',
      'Created by the catalog CTA flow test.',
      '',
    ].join('\n'));
    await page.getByRole('button', { name: 'Create Effort' }).click();

    await expect(page).toHaveURL(new RegExp(`/e/${slug}$`), { timeout: 15_000 });
    await expect(efforts.detailLabel()).toHaveText('E2E Create Flow');
    await expect(efforts.detailSource()).toContainText('Custom');

    errors.expectClean();
  });
});
