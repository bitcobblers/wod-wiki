import { test, expect } from '@playwright/test';
import { appBaseURL } from '../utils/url-helpers';

/**
 * WOD-647 — E2E Smoke: Receiver Workflow
 *
 * Browser-level verification of the Chromecast receiver entry point as it is
 * actually deployed. The receiver (receiver-rpc.html) requires the Cast
 * Receiver SDK, which is not available in a standard desktop browser, so we
 * verify it loads and boots gracefully without a cast session. The receiver
 * panel states (waiting/preview/active/review) are covered by unit tests
 * (tests/panels/, src/__tests__/chromecast-panel-adapters) — the former
 * Storybook-state smoke moved there when the app storybook was retired.
 *
 * Target resolves via appBaseURL(): local dev server by default, deployed
 * app in CI, E2E_APP_URL overrides both.
 */

const APP_BASE = appBaseURL();

// ────────────────────────────────────────────────────────────────────────────
// Receiver entry point
// ────────────────────────────────────────────────────────────────────────────
test.describe(`Receiver — Entry Point (${APP_BASE})`, () => {
  test('receiver-rpc.html loads without JavaScript crashes', async ({ page }) => {
    await page.goto(`${APP_BASE}/receiver-rpc.html`, { waitUntil: 'domcontentloaded' });

    // The root container should mount even when Cast SDK is absent
    const app = page.locator('#root').first();
    await expect(app).toBeVisible({ timeout: 5000 });

    // Wod.Wiki branding should always appear
    await expect(page.locator('text=/Wod.Wiki/i').first()).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/smoke-receiver-entry.png', fullPage: false });
  });

  test('no critical console errors on receiver page', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${APP_BASE}/receiver-rpc.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#root').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/Wod.Wiki/i').first()).toBeVisible();

    const criticalErrors = errors.filter((err) => {
      const lower = err.toLowerCase();
      return (
        !lower.includes('extension') &&
        !lower.includes('chrome-extension') &&
        !lower.includes('adblock') &&
        !lower.includes('cast') // Cast SDK is absent in desktop browsers — expected
      );
    });

    expect(criticalErrors).toHaveLength(0);
  });
});
