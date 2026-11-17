// spec: e2e/specs/runtime/timer-surfaces-and-keypad.md
import type { Page } from '@playwright/test';
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';
import {
  navigateToRunPage,
  pauseIconButton,
  playIconButton,
  startWorkoutFromPlayground,
} from '../pages/WallClockPage';
import { getSessions } from '../utils/sessionsDb';
import { WOD_DB } from '../helpers/wodwikiDb';

const board = (page: Page) => page.getByTestId(TEST_IDS.CLOCK_COMMAND_BOARD);
const repValue = (page: Page) => page.getByTestId(TEST_IDS.CLOCK_REP_VALUE);
const footerCount = (page: Page) => page.getByText(/\d+ results? captured/);

async function capturedCount(page: Page): Promise<number> {
  try {
    const text = await footerCount(page).innerText({ timeout: 2_000 });
    return Number.parseInt(text.match(/(\d+)/)![0], 10);
  } catch {
    return 0;
  }
}

async function getUserRepEvents(
  page: Page,
): Promise<Array<{ resultId: string; sourceBlockKey: string; value: unknown }>> {
  return page.evaluate(async (dbName) => {
    const { promise, resolve, reject } =
      Promise.withResolvers<Array<{ resultId: string; sourceBlockKey: string; value: unknown }>>();
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction('events', 'readonly');
      const getAll = tx.objectStore('events').getAll();
      getAll.onsuccess = () => {
        const rows = (getAll.result as Array<Record<string, unknown>>)
          .filter(
            (r) =>
              String(r.grain ?? '') === 'event' &&
              Array.isArray(r.metrics) &&
              (r.metrics as Array<Record<string, unknown>>).some(
                (m) => m.type === 'rep' && m.origin === 'user',
              ),
          )
          .map((r) => {
            const metric = (r.metrics as Array<Record<string, unknown>>).find(
              (m) => m.type === 'rep' && m.origin === 'user',
            );
            return {
              resultId: String(r.resultId ?? ''),
              sourceBlockKey: String(r.sourceBlockKey ?? ''),
              value: metric?.value,
            };
          });
        db.close();
        resolve(rows);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
    return promise;
  }, WOD_DB);
}

test.describe('RUN-03 — Responsive Timer Surface Tiers & Clock Command Board Keypad', () => {
  test.setTimeout(120_000);

  test('Scenario 1: timer surface re-tiers Detail -> General -> Minimal as viewport shrinks', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 800 });
    await startWorkoutFromPlayground(page, 'timer-tier-e2e', '```time\nTimer: 1:00\n10 Burpees\n```');

    // Desktop (1280x800): Detail
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeHidden();
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeHidden();
    await expect(page.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE).first()).toBeVisible({ timeout: 15_000 });

    // Tablet (768x900): General + Stack & Splits drawer
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_PLAY_PAUSE).first()).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeHidden();
    await page.getByTestId(TEST_IDS.TIMER_STACK_DRAWER_TOGGLE).click();
    await expect(page.getByTestId(TEST_IDS.TIMER_STACK_DRAWER)).toBeVisible();
    await page.getByRole('button', { name: 'Close stack drawer' }).click();
    await expect(page.getByTestId(TEST_IDS.TIMER_STACK_DRAWER)).toBeHidden();

    // Phone (375x812): Minimal
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_GENERAL)).toBeHidden();
    await expect(page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first()).toBeVisible();

    app.assertCleanConsole();
  });

  test('Scenario 2a: direction digits navigate, reps count independently, rounds rotate', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await startWorkoutFromPlayground(
      page,
      'clock-board-reps',
      '```time\n(2)\n  10 Push Ups\n  10 Squats\n```',
    );
    await expect(board(page)).toBeVisible();

    const before = await repValue(page).innerText();
    const segmentsBefore = await capturedCount(page);
    await page.keyboard.press('8');
    const focusedInPanel = await page.evaluate(() => {
      const el = document.activeElement;
      return el !== null && el.closest('[data-clock-panel]') !== null;
    });
    expect(focusedInPanel).toBe(true);
    await page.keyboard.press('Numpad4');
    expect(await repValue(page).innerText()).toBe(before);
    expect(await capturedCount(page)).toBe(segmentsBefore);

    await page.getByTestId(TEST_IDS.CLOCK_REP_PLUS).click();
    await expect(repValue(page)).toHaveText(/^1 \/ Target 10$/);

    await page.keyboard.press('NumpadMultiply');
    await expect(page.getByTestId(TEST_IDS.CLOCK_ENTRY_OVERLAY)).toBeVisible();
    await page.keyboard.press('7');
    await page.keyboard.press('Numpad5');
    await page.keyboard.press('NumpadEnter');
    await expect(page.getByTestId(TEST_IDS.CLOCK_ENTRY_OVERLAY)).toBeHidden();
    await expect(repValue(page)).toHaveText(/^75 \/ Target 10$/);
    expect(await capturedCount(page)).toBe(segmentsBefore);

    await page.keyboard.press('NumpadEnter');
    await expect.poll(() => capturedCount(page), { timeout: 10_000 }).toBeGreaterThan(segmentsBefore);
    await expect(repValue(page)).toHaveText(/^—/);

    app.assertCleanConsole();
  });

  test('Scenario 2b: paused Next is rejected, / toggles playback, and stop confirm preserves partials', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await startWorkoutFromPlayground(
      page,
      'clock-board-pause-stop',
      '```time\n(2)\n  5 Push Ups\n  5 Squats\n```',
    );

    await page.getByTestId(TEST_IDS.CLOCK_REP_PLUS).click();
    await expect(repValue(page)).toHaveText(/^1 \/ Target 5$/);

    await page.keyboard.press('/');
    await playIconButton(page).waitFor({ state: 'visible', timeout: 8_000 });
    const segments = await capturedCount(page);
    await page.keyboard.press('NumpadEnter');
    await expect(playIconButton(page)).toBeVisible();
    expect(await capturedCount(page)).toBe(segments);

    // Native Enter on focused Pause button pauses without double-dispatching
    await page.keyboard.press('/');
    const pauseBtn = pauseIconButton(page);
    await pauseBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await pauseBtn.focus();
    await page.keyboard.press('Enter');
    await playIconButton(page).waitFor({ state: 'visible', timeout: 8_000 });
    await page.keyboard.press('NumpadEnter');
    await expect(playIconButton(page)).toBeVisible();
    expect(await capturedCount(page)).toBe(segments);

    // Escape -> cancel -> Escape -> confirm -> partials preserved
    await page.keyboard.press('Escape');
    const confirm = page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM);
    await expect(confirm).toBeVisible();
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_CANCEL).click();
    await expect(confirm).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 10_000 });

    const repEvents = await getUserRepEvents(page);
    const recorded = repEvents.find((e) => e.value === 1);
    expect(recorded, 'measured actual rep persisted as user-origin event').toBeDefined();
    expect(recorded?.sourceBlockKey).toBeTruthy();
    const sessions = await getSessions(page);
    const partial = sessions.find(
      (s) => (s.completed === false || s.status === 'in-progress') && s.id === recorded?.resultId,
    );
    expect(partial, 'partial session preserved for the recorded result').toBeDefined();

    app.assertCleanConsole();
  });

  test('Scenario 2c: mobile 375x812 Minimal command board and pre-run ? wizard', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    await startWorkoutFromPlayground(
      page,
      'clock-board-mobile',
      '```time\n(2)\n  10 Push Ups\n```',
    );
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeVisible();
    await expect(board(page)).toBeVisible();

    await page.getByTestId(TEST_IDS.CLOCK_REP_PLUS).click();
    await expect(repValue(page)).toHaveText(/^1 \/ Target 10$/);

    await page.keyboard.press('NumpadMultiply');
    await expect(page.getByTestId(TEST_IDS.CLOCK_ENTRY_OVERLAY)).toBeVisible();
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('NumpadEnter');
    await expect(page.getByTestId(TEST_IDS.CLOCK_ENTRY_OVERLAY)).toBeHidden();
    await expect(repValue(page)).toHaveText(/^12 \/ Target 10$/);

    await page.keyboard.press('Escape');
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });

    // Pre-run `? Push Ups` wizard resolves and starts on NumpadEnter
    await page.setViewportSize({ width: 1280, height: 900 });
    await navigateToRunPage(
      page,
      'clock-board-prerun',
      '```time\nFor Time:\n  ? Push Ups\n  10 Squats\n```\n',
    );
    await expect(board(page)).toBeHidden({ timeout: 10_000 });
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('NumpadEnter');
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('NumpadEnter');
    await pauseIconButton(page).waitFor({ state: 'visible', timeout: 20_000 });
    await expect(board(page)).toBeVisible();

    app.assertCleanConsole();
  });
});
