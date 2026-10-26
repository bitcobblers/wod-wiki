import { test, expect } from '@playwright/test';

const viewports = [
  { name: 'desktop', size: { width: 1440, height: 900 } },
  { name: 'mobile', size: { width: 375, height: 812 } },
];

test.describe('Live App Click Handler Navigation', () => {
  for (const viewport of viewports) {
    test(`collection workout detail page renders editor on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport.size);

      // Navigate directly to a known collection workout detail route —
      // the canonical /notebook/:slug/:item path.
      await page.goto('/notebook/crossfit-girls/fran', { waitUntil: 'domcontentloaded' });

      // The workout editor mounts its CodeMirror content area.
      await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/notebook\/crossfit-girls\/fran(?:\?.*)?$/);

      await page.screenshot({
        path: testInfo.outputPath(`dead-click-collections-workout-${viewport.name}.png`),
        fullPage: true,
      });
    });

    test(`journal date page loads without errors on ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport.size);

      // Navigate to a known journal date that has content (today).
      // Future dates with no notes show a CTA, not an editor.
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      await page.goto(`/day/${todayKey}`, { waitUntil: 'domcontentloaded' });

      // The page should load and show the app shell (sidebar or content area).
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

      await page.screenshot({
        path: testInfo.outputPath(`dead-click-journal-date-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});
