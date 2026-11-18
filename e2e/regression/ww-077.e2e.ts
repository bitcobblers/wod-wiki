/**
 * WW-077 — Live run cannot advance past the first movement — Next/Enter never activate movement 2 (AMRAP-path specific; For Time ladder advances) (medium)
 *
 * Regression test for the open QA defect WW-077 (live-run-cannot-advance-first-movement).
 * Expected behavior: in a multi-movement AMRAP, Next advances the run — from the
 * gate into movement 1, and from movement 1 into movement 2 — so the Up-next
 * caption and the rep target track the movement the athlete is actually on.
 * Current defect: the AMRAP header block's next() throws; NextAction catches the
 * exception into runtime.errors (silent, never surfaced), so two Next clicks and
 * Enter leave the outline on the '20:00 AMRAP' header with 'Up next: 10 Burpees'
 * unchanged and zero console errors.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { navigateToRunPage } from '../pages/WallClockPage';

test.describe('WW-077 — AMRAP live run advancement', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-077: Next advances an AMRAP from the gate through movement 1 into movement 2', async ({ app }) => {
    const { page } = app;
    await app.goto('/');

    await navigateToRunPage(
      page,
      'ww077-amrap',
      '```time\n20:00 AMRAP\n  10 Burpees\n  15 Kettlebell Swings 24kg\n  20 Air Squats\n```',
    );

    const upNext = page.getByTestId(TEST_IDS.TIMER_UP_NEXT_CAPTION).first();
    const nextButton = page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
    await expect(nextButton).toBeVisible({ timeout: 10_000 });

    // Gate → movement 1 (Burpees), then movement 1 → movement 2 (Kettlebell
    // Swings). Both go through the same NextEvent dispatch the ledger exercised
    // (its Enter presses are the keypad's primary command = Next).
    await nextButton.click();
    await nextButton.click();

    // On movement 2, Up next must be the third movement and the rep counter
    // must target Kettlebell Swings' 15 reps. With the defect both stay frozen
    // at the gate state ('Up next: 10 Burpees', no advance at all).
    await expect(upNext).toContainText('Air Squats', { timeout: 10_000 });
    await expect(upNext).not.toContainText('10 Burpees');
    await expect(page.getByTestId(TEST_IDS.CLOCK_REP_VALUE)).toHaveText(/\/ Target 15\s*$/, {
      timeout: 10_000,
    });
  });
});
