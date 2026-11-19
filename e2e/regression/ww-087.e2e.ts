/**
 * WW-087 — Runtime gate dialog renders at 0×0 on viewports ≤820px wide (mobile gate never paints) (high)
 *
 * Regression test for the open QA defect WW-087 (runtime-mobile-gate-0x0-dialog-le820px).
 * (Ledger title is empty in the record; the defect is reconstructed from its
 * summary, fingerprint, and root-cause fields.)
 * Expected behavior: on a phone-width viewport (375×812, and at the 820px
 * boundary), the workout gate dialog — [role="dialog"][aria-label="Workout"],
 * the FocusedDialog that hosts the run — paints at full viewport size so the
 * athlete can see and use the gate controls.
 * Current defect: the dialog measures 0×0 at ≤820px, so the mobile runtime gate
 * is invisible/unusable even though it is mounted in the DOM. Root cause points
 * at the responsive sheet sizing in ResponsiveActions.tsx and the FocusedDialog
 * container. Not re-probed by the 2026-11-18 nightly run — the provisional
 * probe selector was exactly the dialog selector asserted here.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import { test, expect } from '../fixtures/playgroundActor';
import { navigateToRunPage } from '../pages/WallClockPage';

test.describe('WW-087 — mobile runtime gate dialog size', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-087: the Workout dialog paints at viewport size on ≤820px viewports', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await app.goto('/');

    await navigateToRunPage(page, 'ww087-mobile-gate', '```time\nTimer: 1:00\n10 Burpees\n```');

    // Closed Page options mobile overflow sheet must not expose role="dialog".
    await expect(page.locator('[role="dialog"][aria-label="Page options"]')).toHaveCount(0);

    const dialog = page.locator('[role="dialog"][aria-label="Workout"]').first();
    await expect(dialog).toBeAttached({ timeout: 15_000 });

    // Defect: bounding box is 0×0 — Playwright also reports such an element as
    // not visible, so both assertions fail while the defect is open.
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const box375 = await dialog.boundingBox();
    expect(box375, 'dialog has a bounding box at 375px wide').not.toBeNull();
    expect(box375!.width).toBeGreaterThanOrEqual(370);
    expect(box375!.height).toBeGreaterThanOrEqual(800);

    // The defect boundary is ≤820px: re-check at exactly 820px wide.
    await page.setViewportSize({ width: 820, height: 900 });
    const box820 = await dialog.boundingBox();
    expect(box820, 'dialog has a bounding box at 820px wide').not.toBeNull();
    expect(box820!.width).toBeGreaterThanOrEqual(800);
    expect(box820!.height).toBeGreaterThanOrEqual(880);
  });
});
