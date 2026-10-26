import { test, expect } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Mobile gate (journal-mobile-375 project): key playground routes render with
 * zero horizontal overflow at a 375px viewport, in forced light theme.
 *
 * Scope is deliberate (map #990 acceptance gate): only routes verified clean
 * by the dark-mode/mobile inventory (docs/research/008, H3). Surfaces known
 * broken at phone width get added here by their fix tickets — not before.
 */

const ROUTES = ['/', '/journal', '/notebooks', '/efforts', '/dashboards', '/playground/hello-world'];

for (const route of ROUTES) {
  test(`no horizontal overflow at 375px on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded' });

    // Pre-paint boot (#999) ran before React mounted
    await expect(page.locator('html[data-theme-boot="1"]')).toHaveCount(1);
    // Seed-dependent routes must finish importing before layout is measured.
    await waitForFeedReady(page);
    await expect(page.getByRole('main').first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
