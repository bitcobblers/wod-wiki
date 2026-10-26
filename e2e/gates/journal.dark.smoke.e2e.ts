import { test, expect } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Dark-theme gate (journal-dark project): key playground routes boot with the
 * dark theme actually applied — html.dark plus real rendered content. Theme is
 * forced via the wod-wiki-playground-theme storage key (ThemeProvider reads it
 * on mount and toggles the class on documentElement).
 */

const ROUTES = ['/', '/journal', '/notebooks', '/efforts', '/dashboards', '/playground/hello-world'];

for (const route of ROUTES) {
  test(`dark theme applies on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });

    // Pre-paint boot (#999): the inline script resolved the theme before
    // React mounted — the marker proves the script ran, the class that it
    // agreed with the storage key.
    await expect(page.locator('html[data-theme-boot="1"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/, { timeout: 20_000 });
    // Seed-dependent routes must finish importing before theme is checked.
    await waitForFeedReady(page);
    await expect(page.getByRole('main').first()).toBeVisible();
  });
}
