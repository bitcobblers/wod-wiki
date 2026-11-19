/**
 * WW-096 — Mobile timer keypad digit keys and board toggle chips below 44px touch minimum at 375x812
 *
 * Regression test for QA defect WW-096 (mobile-timer-touch-targets-under-44px).
 * Verifies that on a 375x812 viewport, Nav/Keypad/Keys?/Values* toggles, −/+
 * rep controls, and all 12 keypad buttons meet the 44x44px touch target minimum,
 * digit keys have accessible aria-label/title attributes, and opening the
 * keypad introduces zero horizontal overflow.
 */
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import { startWorkoutFromPlayground } from '../pages/WallClockPage';

test.describe('WW-096 — mobile timer touch targets >= 44px at 375x812', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-096: command board toggles and numeric keypad keys meet 44x44px minimum without overflow', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await app.goto('/');

    await startWorkoutFromPlayground(page, 'ww096-mobile-keypad', '```time\n10:00 AMRAP\n  5 Pullups\n```');

    const board = page.getByTestId(TEST_IDS.CLOCK_COMMAND_BOARD);
    await expect(board).toBeVisible({ timeout: 15_000 });

    const keypadToggle = board.getByRole('button', { name: 'Keypad' });
    await keypadToggle.click();

    const keypadGroup = board.getByRole('group', { name: 'Numeric keypad' });
    await expect(keypadGroup).toBeVisible({ timeout: 10_000 });

    const targets = [
      { label: 'Nav toggle', locator: board.getByRole('button', { name: 'Nav' }) },
      { label: 'Keypad toggle', locator: keypadToggle },
      { label: 'Keys? button', locator: board.getByTestId(TEST_IDS.CLOCK_KEY_CHECK_BUTTON) },
      { label: 'Values * button', locator: board.getByTestId(TEST_IDS.CLOCK_VALUES_BUTTON) },
      { label: 'Rep minus', locator: board.getByTestId(TEST_IDS.CLOCK_REP_MINUS) },
      { label: 'Rep plus', locator: board.getByTestId(TEST_IDS.CLOCK_REP_PLUS) },
      ...(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const).map((digit) => ({
        label: `Digit ${digit}`,
        locator: keypadGroup.getByRole('button', { name: `Digit ${digit}` }),
      })),
      { label: 'Backspace', locator: keypadGroup.getByRole('button', { name: 'Backspace' }) },
      { label: 'Set reps', locator: keypadGroup.getByRole('button', { name: 'Set reps' }) },
    ];

    for (const { label, locator } of targets) {
      await expect(locator, `${label} should be visible`).toBeVisible();
      const box = await locator.boundingBox();
      expect(box, `${label} should have a bounding box`).not.toBeNull();
      expect(box!.width, `${label} width >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${label} height >= 44px`).toBeGreaterThanOrEqual(44);
    }

    for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const) {
      const btn = keypadGroup.getByRole('button', { name: `Digit ${digit}` });
      await expect(btn).toHaveAttribute('aria-label', `Digit ${digit}`);
      await expect(btn).toHaveAttribute('title', `Digit ${digit}`);
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
  });
});
