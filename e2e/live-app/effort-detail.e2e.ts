import { expect, test, type Page } from '@playwright/test';
import { EffortsPage } from '../pages/EffortsPage';
import { seedBundledEfforts } from '../helpers/seedEfforts';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';
import { waitForSeedReady } from '../helpers/seedReadiness';

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

function customEffortDocument(slug: string, label: string, body: string) {
  return `---
id: effort-user-${slug}
slug: ${slug}
label: "${label}"
aliases:
  - ${slug}
baseAttributes:
  met: 7.5
  discipline: strength
  intensityTier: moderate
registrySource: user
---
${body}
`;
}

test.describe('Effort detail', () => {
  test('renders bundled effort inside the aligned note shell', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoDetail('burpee');
    // Bundled effort corpus is not part of the app bundle (community repo);
    // seed the fixture row this test renders.
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();

    await expect(efforts.detailLabel()).toHaveText('Burpee');
    await expect(efforts.detailSource()).toContainText('Bundled');
    const properties = efforts.frontmatterProperties();
    await expect(properties).toBeVisible();
    await expect(properties.getByLabel('Value for slug')).toHaveValue('burpee');
    await expect(properties.getByLabel('Value for label')).toHaveValue('Burpee');
    await expect(properties.getByLabel('MET value')).toHaveValue('10');
    await expect(efforts.notebookEditor()).toBeVisible();
    await expect(efforts.cloneButton()).toBeVisible();

    errors.expectClean();
  });

  test('copies a bundled effort and autosaves its inline properties without changing the original', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);
    await efforts.gotoDetail('burpee');
    await seedBundledEfforts(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.cloneButton().click();
    await expect(page).toHaveURL(/\/e\/burpee-custom$/);
    await expect(efforts.detailSource()).toContainText('Custom');

    const label = efforts.frontmatterProperties().getByLabel('Value for label');
    await label.fill('Burpee training notes');
    await label.press('Tab');
    await expect.poll(() => getNoteContentByRouteId(page, 'effort/burpee-custom'))
      .toContain('Burpee training notes');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(efforts.detailLabel()).toHaveText('Burpee training notes');
    await expect(efforts.notebookEditor()).toContainText('full-body conditioning');

    await efforts.gotoDetail('burpee');
    await expect(efforts.detailLabel()).toHaveText('Burpee');
    await expect(efforts.detailSource()).toContainText('Bundled');
    errors.expectClean();
  });

  test('renders a not-found state for unknown effort slugs', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const efforts = new EffortsPage(page);

    await efforts.gotoDetail('nonexistent-effort-12345');

    await expect(efforts.detailNotFound()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Catalog' })).toBeVisible();

    errors.expectClean();
  });

  test('creates a custom effort through the note editor (create shares the edit layout)', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const slug = `e2e-effort-${Date.now()}`;

    await page.goto('/e/new?mode=create', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(page);

    await expect(page.locator('.cm-note-editor')).toBeVisible({ timeout: 15_000 });
    const editor = page.locator('.cm-note-editor .cm-content').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(customEffortDocument(slug, 'E2E Created Effort', 'Created through the note editor.'));

    await page.getByTestId('effort-create-btn').click();
    await expect(page).toHaveURL(new RegExp(`/e/${slug}$`), { timeout: 15_000 });
    const efforts = new EffortsPage(page);
    await expect(efforts.detailLabel()).toHaveText('E2E Created Effort');
    await expect(efforts.detailSource()).toContainText('Custom');

    // The committed note is the durable source — a reload reads it back.
    await expect
      .poll(() => getNoteContentByRouteId(page, `effort/${slug}`), { timeout: 15_000 })
      .toContain('Created through the note editor.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();
    await expect(efforts.detailLabel()).toHaveText('E2E Created Effort');
    await expect(efforts.notebookEditor()).toBeVisible();

    errors.expectClean();
  });
});
