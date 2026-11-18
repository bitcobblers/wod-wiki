/**
 * WW-066 — Cast to TV click with no receiver produces zero user-facing feedback — console-only failure (medium)
 *
 * Regression test for the open QA defect WW-066 (cast-to-tv-silent-failure).
 * Expected behavior: clicking Cast to TV when no receiver is available surfaces
 * user-facing feedback (a toast / alert / status message explaining that casting
 * failed or that no receiver is available) — not silence.
 * Current defect: the startSession failure is caught in CastButtonRpc and only
 * written to the console (console.error); the user sees nothing happen.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-13-ondemand-163801).
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-066 — Cast to TV silent failure', () => {
  test.setTimeout(90_000);

  test('WW-066: clicking Cast to TV with no receiver produces visible feedback', async ({ app }) => {
    const { page } = app;
    await app.goto('/');

    // The cast control lives in the app chrome (AppContent mounts CastButtonRpc
    // in the navbar). There is no receiver in the test environment.
    const castButton = page.getByRole('button', { name: /Cast to TV/ }).first();
    await expect(castButton).toBeVisible({ timeout: 15_000 });

    // Force the click: in a browser without a cast backend the control renders
    // disabled ("Cast to TV (unavailable)"), which is exactly the no-receiver
    // situation the ledger documents — the click must still tell the user why
    // nothing happened, in the page, not only in the console.
    await castButton.click({ force: true });

    const feedback = page
      .locator('[role="alert"], [role="status"], [data-state="open"][data-radix-toast-viewport], li[data-state]')
      .filter({ hasText: /cast|receiver|device|TV/i })
      .or(page.getByText(/no (cast )?(receiver|device)|cast(ing)? (failed|unavailable|not available)/i));
    await expect(feedback.first()).toBeVisible({ timeout: 8_000 });
  });
});
