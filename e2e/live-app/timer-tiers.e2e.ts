/**
 * Timer surface tiers — /run/:runtimeId per viewport (ADR 0003).
 *
 * The tier picker is container-driven, so one live run re-tiers on resize
 * without a reload:
 *   full (≥900px)   → Detail   (TimerDisplay / audit rail)
 *   wide (≥500px)   → General  (timer-surface-general root)
 *   compact (<500px) → Minimal (timer-surface-minimal root)
 *
 * Starts on the desktop viewport (the Play flow is desktop-shaped) and
 * resizes the viewport to walk the ladder in one session.
 */

import { test, expect } from '@playwright/test';
import { startWorkoutFromPlayground } from '../pages/WallClockPage';
import { TEST_IDS } from '../contracts/TestIdContract';

test.describe('Timer surface tiers — /run/:runtimeId', () => {
  test.setTimeout(120_000);

  test('re-tiers Detail → General → Minimal as the viewport shrinks', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 5_000 });
    await startWorkoutFromPlayground(page, 'timer-tier-e2e', '```time\nTimer: 1:00\n10 Burpees\n```');

    // Desktop (default 1280×800 ≥ 900): Detail — no surface root, stack timer present.
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeHidden();
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeHidden();
    await expect(page.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE).first()).toBeVisible({ timeout: 15_000 });

    // Tablet landscape (768×900): wide → General.
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE).first()).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeHidden();

    // Phone (375×812): compact → Minimal.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeHidden();
    // The triad keeps the shared contract ids on every tier.
    await expect(page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first()).toBeVisible();
  });
});
