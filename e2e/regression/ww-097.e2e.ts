/**
 * WW-097 — FOR TIME completed ladder: rep controls dead and stale target footer
 *
 * Regression test for QA defect WW-097 (fortime-rep-entry-dead-after-ladder-complete).
 * Verifies active rungs advance cleanly through 21 -> 15 -> 9 with working
 * + / - controls carrying descriptive titles, and once the final rung completes
 * there is neither a stale 'Actual reps — / Target 21' counter nor enabled
 * no-op rep controls.
 */
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { advanceUntilReview, startWorkoutFromPlayground } from '../pages/WallClockPage';

test.describe('WW-097 — FOR TIME ladder rep controls lifecycle', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-097: active FOR TIME rungs track 21 -> 15 -> 9 and leave no stale Target 21 or dead controls after completion', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await app.goto('/');

    await startWorkoutFromPlayground(
      page,
      'ww097-fortime-ladder',
      '```time\nFOR TIME (21-15-9)\n  Thrusters 42.5kg\n```',
    );

    const repValue = page.getByTestId(TEST_IDS.CLOCK_REP_VALUE);
    const plusBtn = page.getByTestId(TEST_IDS.CLOCK_REP_PLUS);
    const minusBtn = page.getByTestId(TEST_IDS.CLOCK_REP_MINUS);

    await expect(repValue).toHaveText(/^— \/ Target 21$/, { timeout: 10_000 });
    await expect(plusBtn).toHaveAttribute('title', 'Add one rep');
    await expect(minusBtn).toHaveAttribute('title', 'Subtract one rep');

    await plusBtn.click();
    await expect(repValue).toHaveText(/^1 \/ Target 21$/);

    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
    await expect(repValue).toHaveText(/^— \/ Target 15$/, { timeout: 10_000 });

    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
    await expect(repValue).toHaveText(/^— \/ Target 9$/, { timeout: 10_000 });

    await advanceUntilReview(page, 4);
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText(/Target 21/)).toHaveCount(0);
    await expect(page.locator(`[data-testid="${TEST_IDS.CLOCK_REP_PLUS}"]:enabled`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="${TEST_IDS.CLOCK_REP_MINUS}"]:enabled`)).toHaveCount(0);
  });
});
