/**
 * Runtime Execution Loop — behavioral e2e (WOD wayfinder #691)
 *
 * The missing core: the previous suite stopped at "timer opens / pause button
 * visible". These tests assert what the runtime actually *does*:
 *
 *   1. Countdown progresses and tracks wall clock
 *   2. Pause freezes the countdown (and resume restarts it)
 *   3. Next Block advances segments
 *   4. Stop Session confirms, then records a partial (never completed) result
 *   5. Natural completion → inline review + completed result row
 *   6. Completion result feeds the results inlay (produce/consume loop)
 *   7. /run/:runtimeId reload → designed defensive state (in-memory runtimes)
 *
 * Entry point is a seeded playground note → Play → /run/:runtimeId (the
 * journal-date flow is quarantined pending the empty-date behavior decision
 * in #698). Behavior contracts encoded here (from source, not fixtures):
 *   - Stop (and natural completion) surface the review as an inline
 *     "Workout Complete" dialog on /run — it stays mounted until explicitly
 *     exited via the FocusedDialog close button.
 *   - Manual stop: results are still recorded, but with `completed: false`
 *     (the journal list renders these as "Partial" by design).
 *   - /run/:runtimeId reads an in-memory `pendingRuntimes` map; a reload
 *     loses it and the page answers "Runtime not found." by design.
 */

import { test, expect, type Page } from '@playwright/test';
import { clearSessions, getSessions } from '../utils/sessionsDb';
import { installFastClock } from '../utils/fastClock';
import {
  startWorkoutFromPlayground,
  advanceUntilReview,
  timerSeconds,
  playIconButton,
  pauseIconButton,
} from '../pages/WallClockPage';
import { TEST_IDS } from '../contracts/TestIdContract';

/** Clear the results store, then start the workout (per-test isolation). */
async function startCleanWorkout(page: Page, id: string, wodScript: string): Promise<void> {
  await clearSessions(page);
  await startWorkoutFromPlayground(page, id, wodScript);
}

test.describe('Runtime Execution Loop — /playground → /run/:runtimeId', () => {
  const errors: string[] = [];

  // Cold Vite transforms make the first page loads slow; the 45s config
  // default is too tight for seed → load → play → /run → reload.
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    // Active workout sessions register a beforeunload guard (Workbench
    // Effect). Playwright's default is to dismiss dialogs, which CANCELS the
    // navigation for beforeunload — accept instead so reloads go through.
    page.on('dialog', (d) => { void d.accept(); });
    // Suppress the First-Note Wizard (ADR-0010): it opens over fresh installs
    // and its backdrop intercepts every click on the page. The
    // profileInitialized flag is the app's own permanent-dismissal gate
    // (useProfileInitialized) — set it before any app code runs.
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    // Seed IndexedDB access on the app origin before any IDB helpers run.
    // A navigation failure fails the test — a silent skip here would hide a
    // broken environment as green.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 5_000 });
  });

  test('countdown progresses and tracks wall clock', async ({ page }) => {
    await startCleanWorkout(page, 'runtime-e2e-countdown', '```time\nTimer: 1:00\n10 Burpees\n```');

    const v0 = await timerSeconds(page);
    expect(v0).toBeGreaterThan(0);

    await page.waitForTimeout(4000);
    const v1 = await timerSeconds(page);

    const elapsed = v0 - v1;
    // 4s wall clock → countdown dropped 2–6s (±2s drift tolerance).
    expect(elapsed).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThanOrEqual(6);
  });

  test('pause freezes the countdown and resume restarts it', async ({ page }) => {
    await startCleanWorkout(page, 'runtime-e2e-pause', '```time\nTimer: 1:00\n10 Burpees\n```');

    await pauseIconButton(page).click();
    await expect(playIconButton(page)).toBeVisible({ timeout: 5_000 });

    const frozen = await timerSeconds(page);
    await page.waitForTimeout(2000);
    expect(await timerSeconds(page)).toBe(frozen);

    await playIconButton(page).click();
    await expect(pauseIconButton(page)).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(2000);
    expect(await timerSeconds(page)).toBeLessThan(frozen);
  });

  test('next block advances to the next segment', async ({ page }) => {
    await startCleanWorkout(page, 'runtime-e2e-next', '```time\n(2)\n  5 Burpees\n  10 Squats\n```');

    // First child is current; advancing surfaces the next movement.
    const nextButton = page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
    await expect(nextButton).toBeVisible({ timeout: 5_000 });
    await nextButton.click();

    await expect(page.getByText(/squat/i).first()).toBeVisible({ timeout: 5_000 });
    expect(errors).toEqual([]);
  });

  test('stop session records no completed result', async ({ page }) => {
    await startCleanWorkout(page, 'runtime-e2e-stop', '```time\nTimer: 1:00\n10 Burpees\n```');

    // Session-output signal: the countdown has started ticking (replaces the
    // fixed 1s "let the session produce some output" sleep).
    await expect.poll(() => timerSeconds(page), { timeout: 5_000 }).toBeLessThan(60);

    // Stop is guarded: playback stays live until the confirm is accepted.
    await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
    const acceptStop = page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT);
    await expect(acceptStop).toBeVisible({ timeout: 5_000 });
    await acceptStop.click();

    // The partial is preserved into the inline review (same surface as
    // natural completion). Exit it explicitly, then no timer UI remains.
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(pauseIconButton(page)).toBeHidden({ timeout: 15_000 });

    // Partials are recorded by design — but never marked completed.
    await expect
      .poll(async () => (await getSessions(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const sessions = await getSessions(page);
    for (const s of sessions) {
      expect(s.completed).not.toBe(true);
    }
  });

  test('natural completion shows inline review and records a completed result', async ({ page }) => {
    // Fast clock (20×): the 6s countdown completes in ~0.3s wall time. Not
    // applied file-wide — 'countdown progresses' verifies wall-clock tracking.
    await installFastClock(page);
    await startCleanWorkout(page, 'runtime-e2e-complete', '```time\nTimer: 0:06\n5 Burpees\n```');

    // The wall budget covers the run itself, not seed/page-load — cold Vite
    // transforms make load time environment-dependent (CI variance), while
    // the assertion's intent is that the accelerated run completes quickly.
    const wallStart = Date.now();

    // Blocks are advanced manually (Next) — the 6s countdown expires, then
    // keep advancing through the effort block until the session completes
    // and WallClockPage records the result and opens the inline
    // "Workout Complete" review on /run (no route change; exit is explicit).
    await advanceUntilReview(page);

    const sessions = await getSessions(page);
    expect(sessions.some((s) => s.completed === true)).toBe(true);
    // The accelerated run completes in single-digit seconds of wall time…
    expect(Date.now() - wallStart).toBeLessThan(15_000);
    // …but the persisted duration reflects the accelerated 6s span, not wall time.
    const completed = sessions.find((s) => s.completed === true);
    expect(completed?.duration).toBeGreaterThanOrEqual(5_000);
    expect(errors).toEqual([]);
  });

  test('reload of /run/:runtimeId shows the designed defensive state', async ({ page }) => {
    // A fresh full-page load of an unregistered runtimeId lands in exactly
    // the state a reload produces: pendingRuntimes is in-memory, so any full
    // load finds it empty. The stronger "reload mid-workout" variant needs a
    // working /run page — it is folded into the #699 quarantine: the /run
    // mount can hard-block the main thread, which makes reload itself hang.
    await page.goto(`/run/${crypto.randomUUID()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(
      page.getByText('Runtime not found. Please start the workout from the editor.'),
    ).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });
});
