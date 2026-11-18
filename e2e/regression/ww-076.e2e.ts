/**
 * WW-076 — For Time '21-15-9' live run shows rep target '9' on the 21-rep first movement (ladder target resolves to last rung) (medium)
 *
 * Regression test for the open QA defect WW-076 (fortime-ladder-target-miscomputed).
 * Expected behavior: on the first rung of a 21-15-9 ladder, the live rep counter
 * shows the CURRENT rung's target — "Target 21" while the athlete is on the
 * 21-rep movement.
 * Current defect: lastRepTarget (actuals.ts) returns the LAST non-user rep metric
 * on the block, so the ladder resolves to its final rung (9) from the start;
 * ClockCommandBoard renders "/ Target 9" on the 21-rep Thrusters.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { startWorkoutFromPlayground } from '../pages/WallClockPage';

test.describe('WW-076 — ladder rep target resolves to the current rung', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-076: first rung of 21-15-9 shows Target 21, not Target 9', async ({ app }) => {
    const { page } = app;
    await app.goto('/');

    await startWorkoutFromPlayground(
      page,
      'ww076-ladder',
      '```time\n21-15-9\n  Thrusters 42.5 kg\n```',
    );

    // The run is live on the first movement (the 21-rep rung). The command
    // board's rep counter must target the current rung.
    const repValue = page.getByTestId(TEST_IDS.CLOCK_REP_VALUE);
    await expect(repValue).toBeVisible({ timeout: 10_000 });
    await expect(repValue).toHaveText(/\/ Target 21\s*$/, { timeout: 10_000 });
    await expect(repValue).not.toHaveText(/Target 9\s*$/);
  });
});
