/**
 * WW-085 — Ready-to-Start gate: mouse clicks on Start do nothing (keyboard '/' works), and after keyboard start the overlay stays frozen on 'Ready to Start' 00:00 while the engine reports live/running; raw CSS keyframes text present in overlay DOM (high)
 *
 * Regression test for the open QA defect WW-085 (gate-start-click-dead-overlay-frozen).
 * Expected behavior: a mouse click on the gate's Start control starts the workout
 * (gate dismisses, the run shows as running), and a keyboard start leaves an
 * overlay that agrees with the engine — no frozen 'Ready to Start' heading, and
 * no raw CSS text rendered as visible overlay content.
 * Current defect: the pointer start path in RuntimeTimerPanel.handleStart /
 * clockCommands never fires (keyboard '/' starts the engine), and the view model
 * desyncs — the overlay stays on 'Ready to Start' at 00:00 while the engine
 * reports live/running, with raw @keyframes text present in the overlay.
 * NOTE: not retested by the 2026-11-18 nightly run; the ledger's last repro is
 * 2026-11-16. Both documented repro paths are exercised below.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-16-nightly-052356).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { navigateToRunPage, pauseIconButton, playIconButton } from '../pages/WallClockPage';

test.describe('WW-085 — Ready-to-Start gate start paths', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-085: mouse click on Start at the gate starts the workout', async ({ app }) => {
    const { page } = app;
    await app.goto('/');

    await navigateToRunPage(page, 'ww085-pointer', '```time\nTimer: 1:00\n10 Burpees\n```');
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({
      timeout: 10_000,
    });

    // The gate's primary Start control (the timer play/pause circle in its
    // Start state), clicked with the mouse — the ledger's dead path.
    await expect(playIconButton(page)).toBeVisible({ timeout: 10_000 });
    await playIconButton(page).click();

    // Correct behavior: the gate dismisses and the run is visibly running.
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeHidden({
      timeout: 8_000,
    });
    await expect(pauseIconButton(page)).toBeVisible({ timeout: 8_000 });
  });

  test("WW-085 (path 2): keyboard '/' start leaves a live overlay, not a frozen 'Ready to Start'", async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/');

    await navigateToRunPage(page, 'ww085-keyboard', '```time\nTimer: 1:00\n10 Burpees\n```');
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({
      timeout: 10_000,
    });

    // The keyboard path that DOES start the engine in the ledger.
    await page.keyboard.press('/');

    // The overlay must agree with the engine: gate heading gone, run shown
    // running (pause control), timer no longer parked at the gate state.
    await expect(pauseIconButton(page)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeHidden({
      timeout: 8_000,
    });

    // Raw CSS keyframes must not be rendered as visible overlay text.
    const visibleText = await page.evaluate(() => document.body.innerText);
    expect(visibleText).not.toContain('@keyframes');
    expect(page.getByTestId(TEST_IDS.TIMER_DISPLAY).first()).toBeVisible();
  });
});
