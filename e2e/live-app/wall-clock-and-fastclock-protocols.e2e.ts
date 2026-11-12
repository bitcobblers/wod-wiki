// spec: e2e/specs/runtime/wall-clock-and-fastclock-protocols.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import {
  advanceUntilReview,
  pauseIconButton,
  playIconButton,
  startWorkoutFromPlayground,
  timerSeconds,
} from '../pages/WallClockPage';
import { clearSessions, getSessions } from '../utils/sessionsDb';

const SURVIVAL_NOTE_ID = 'crossfit-girls/run-01-survival-probe';
const SURVIVAL_MD = '# Session Routes Probe\n\n```time\n5:00 AMRAP\n  5 Push Ups\n```\n';
const EMPTY_DATE = '2099-12-30';

test.describe('RUN-01 — Wall Clock & FastClock Execution Protocols', () => {
  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('Wall Clock pause/resume, Next Block segment advance, and guarded Stop Session partial persistence', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await app.goto('/');
    await clearSessions(page);

    // 1. Pause freezes countdown, Resume restarts, Stop Session records partial (completed: false)
    await startWorkoutFromPlayground(page, 'run01-pause-stop', '```time\nTimer: 1:00\n10 Burpees\n```');
    await pauseIconButton(page).click();
    await expect(playIconButton(page)).toBeVisible({ timeout: 5_000 });

    const frozen = await timerSeconds(page);
    await page.waitForTimeout(1_500);
    expect(await timerSeconds(page)).toBe(frozen);

    await playIconButton(page).click();
    await expect(pauseIconButton(page)).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => timerSeconds(page), { timeout: 5_000 }).toBeLessThan(frozen);

    await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
    const acceptStop = page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT);
    await expect(acceptStop).toBeVisible({ timeout: 5_000 });
    await acceptStop.click();

    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();

    await expect.poll(async () => (await getSessions(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);
    for (const s of await getSessions(page)) {
      expect(s.completed).not.toBe(true);
    }

    // 2. Next Block advances segments
    await startWorkoutFromPlayground(page, 'run01-next-seg', '```time\n(2)\n  5 Burpees\n  10 Squats\n```');
    const nextButton = page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
    await expect(nextButton).toBeVisible({ timeout: 5_000 });
    await nextButton.click();
    await expect(page.getByText(/squat/i).first()).toBeVisible({ timeout: 5_000 });

    app.assertCleanConsole();
  });

  test('FastClock natural completion and multi-set forced-rest overrun complete into Workout Complete review', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await app.runtime.useFastClock(20);
    await app.goto('/');
    await clearSessions(page);

    // 1. Natural 0:06 countdown expiration under 20x fastClock
    const wallStart = Date.now();
    await startWorkoutFromPlayground(page, 'run01-fast-complete', '```time\nTimer: 0:06\n5 Burpees\n```');
    await expect(page.getByText(/burpees/i).first()).toBeVisible({ timeout: 10_000 });
    await advanceUntilReview(page);

    const sessions = await getSessions(page);
    const completed = sessions.find((s) => s.completed === true);
    expect(completed).toBeTruthy();
    expect(Date.now() - wallStart).toBeLessThan(20_000);
    expect(completed?.duration).toBeGreaterThanOrEqual(5_000);
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();

    // 2. Forced-rest *:30 overrun across 2 sets completes cleanly
    await app.seed.note(
      'playground/run01-rest-overrun',
      '# rest-overrun\n\n```time\n(2 Sets)\n  10 Kettlebell Swings 24kg\n  *:30 Rest\n```\n',
      { type: 'playground', title: 'rest-overrun' },
    );
    await page.goto('/playground/run01-rest-overrun', { waitUntil: 'domcontentloaded' });
    const play = page.getByRole('button', { name: 'Play', exact: true }).first();
    await expect(play).toBeVisible({ timeout: 15_000 });
    await play.evaluate((el) => (el as HTMLElement).click());
    await page.waitForURL(/\/(tracker|run)\//, { timeout: 15_000 });

    await advanceUntilReview(page);
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible();
    await expect(page.getByText(/Timer can['’]t be skipped/i)).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'Kettlebell Swings' })).toHaveCount(2);

    app.assertCleanConsole();
  });

  test('active session survives route changes and defensive empty-block / unknown-runtime states render cleanly', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await app.seed.note(SURVIVAL_NOTE_ID, SURVIVAL_MD, { title: 'Session Routes Probe' });

    // 1. Start workout from /notebook/:slug/:item -> parks & survives Back/Forward
    await app.goto(`/notebook/${SURVIVAL_NOTE_ID}`);
    await expect(page.locator('.cm-content')).toContainText('5:00', { timeout: 15_000 });
    await page.locator('.cm-content').getByText('5:00').first().click();
    const play = page.locator('button[aria-label="Play"]').first();
    await expect(play).toBeVisible({ timeout: 10_000 });
    await play.evaluate((el) => (el as HTMLElement).click());

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await page.waitForURL(new RegExp(`/day/${todayKey}`), { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Stop Session', exact: true }).first()).toBeVisible({ timeout: 15_000 });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/notebook/${SURVIVAL_NOTE_ID}`), { timeout: 15_000 });
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/day/${todayKey}`), { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Stop Session', exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // Stop parked session cleanly before testing empty/defensive routes
    await app.runtime.stopSession();
    const closeReview = page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
    if ((await closeReview.count()) > 0 && (await closeReview.isVisible().catch(() => false))) {
      await closeReview.click();
    }

    // 2. Empty block shows 'Nothing to run'
    await app.journal.clearDate(EMPTY_DATE);
    await app.seed.journalNote(EMPTY_DATE, '# Empty\n\n```time\n```\n');
    await app.journal.openDate(EMPTY_DATE);
    const startEmpty = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(startEmpty).toBeVisible({ timeout: 10_000 });
    await startEmpty.evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByText('Nothing to run')).toBeVisible({ timeout: 15_000 });

    // 3. Unknown /run/:runtimeId cold load shows defensive message
    await page.goto(`/run/${crypto.randomUUID()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(
      page.getByText('Runtime not found. Please start the workout from the editor.'),
    ).toBeVisible({ timeout: 15_000 });

    app.assertCleanConsole();
  });
});
