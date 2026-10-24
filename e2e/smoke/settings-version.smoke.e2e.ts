import { test, expect } from '@playwright/test';
import { appBaseURL } from '../utils/url-helpers';

/**
 * Version surfaces (settings gear popover + System settings About section).
 * The popover is pure-CSS hover/focus chrome on the desktop rail; the About
 * section links the stamped build back to its GitHub release.
 */
test.describe(`Settings version surfaces — ${appBaseURL()}`, () => {
  test('settings gear hover popover shows the build version', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const gear = page.getByTestId('nav-settings');
    await expect(gear).toBeVisible();
    await gear.hover();

    // Scope to the gear: the rail renders one role="tooltip" per nav item,
    // all in-DOM (opacity-0) — a page-level locator is a strict-mode violation.
    const tooltip = gear.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(/v.+/, { timeout: 5_000 });
  });

  test('system settings About section shows version and links the GitHub release', async ({ page }) => {
    await page.goto('/settings/system', { waitUntil: 'domcontentloaded' });

    const about = page.getByTestId('settings-about');
    await expect(about).toBeVisible();
    await expect(about).toContainText(/v.+/);

    const link = page.getByTestId('settings-release-link');
    await expect(link).toHaveAttribute('href', /github\.com\/bitcobblers\/wod-wiki\/releases/);
    await expect(link).toHaveAttribute('target', '_blank');
  });
});
