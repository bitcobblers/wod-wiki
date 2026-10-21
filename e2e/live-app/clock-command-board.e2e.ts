/**
 * Clock command board — live-app acceptance (desktop + 375×812 mobile).
 *
 * Covers the browser command-board behavior on the /tracker overlay:
 *   - NumLock-independent direction digits (`8/2/4/6` printable and Numpad)
 *     navigate the clock panel; they never mutate the workout.
 *   - Keypad Enter is the primary command exactly once; main Enter on a
 *     focused button keeps native semantics.
 *   - Actual reps: explicit grouped selection, `+`/`−`, entry digits are data;
 *     unknown (—) differs from zero; counts rotate with repeated rounds.
 *   - Paused Next is rejected; `/` toggles playback.
 *   - Escape opens the stop confirmation; cancel resumes; confirm preserves
 *     partials into the review (FullscreenTimer) — Exit then verifies the
 *     durable user-origin rep in the persisted result.
 *   - Pre-run `? Push Ups` resolves through the wizard, leads Ready, and an
 *     explicit keypad Enter starts the workout.
 *
 * Durable post-run corrections and the receiver path have their own owners
 * (collection-workout-run spec / cast e2e).
 */

import { test, expect, type Page } from '@playwright/test';
import { startWorkoutFromPlayground, navigateToRunPage, pauseIconButton, playIconButton } from '../pages/WallClockPage';
import { getSessions } from '../utils/sessionsDb';
import { WOD_DB } from '../helpers/wodwikiDb';
import { TEST_IDS } from '../contracts/TestIdContract';

const board = (page: Page) => page.getByTestId(TEST_IDS.CLOCK_COMMAND_BOARD);
const repValue = (page: Page) => page.getByTestId(TEST_IDS.CLOCK_REP_VALUE);
const footerCount = (page: Page) => page.getByText(/\d+ results? captured/);

/** Captured-segment count; 0 while no footer exists yet (milestone-tolerant). */
async function capturedCount(page: Page): Promise<number> {
  try {
    const text = await footerCount(page).innerText({ timeout: 4_000 });
    return Number.parseInt(text.match(/(\d+)/)![0], 10);
  } catch {
    return 0;
  }
}


/** All user-origin rep events in the normalized events store (durable actuals). */
async function getUserRepEvents(page: Page): Promise<Array<{ resultId: string; sourceBlockKey: string; value: unknown }>> {
  return page.evaluate(async (dbName) => {
    const { promise, resolve, reject } = Promise.withResolvers<Array<{ resultId: string; sourceBlockKey: string; value: unknown }>>();
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) { db.close(); resolve([]); return; }
      const tx = db.transaction('events', 'readonly');
      const getAll = tx.objectStore('events').getAll();
      getAll.onsuccess = () => {
        const rows = (getAll.result as Array<Record<string, unknown>>)
          .filter(r =>
            String(r.grain ?? '') === 'event' &&
            Array.isArray(r.metrics) &&
            (r.metrics as Array<Record<string, unknown>>).some(
              m => m.type === 'rep' && m.origin === 'user',
            ),
          )
          .map(r => {
            const metric = (r.metrics as Array<Record<string, unknown>>).find(m => m.type === 'rep' && m.origin === 'user');
            return {
              resultId: String(r.resultId ?? ''),
              sourceBlockKey: String(r.sourceBlockKey ?? ''),
              value: metric?.value,
            };
          });
        db.close();
        resolve(rows);
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
    return promise;
  }, WOD_DB);
}

test.describe('Clock command board', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
  });

  test('direction digits navigate, reps count independently, rounds rotate', async ({ page }) => {
    await startWorkoutFromPlayground(
      page,
      'clock-board-reps',
      '```time\n(2)\n  10 Push Ups\n  10 Squats\n```',
    );
    await expect(board(page)).toBeVisible();

    // ── Direction digits move focus inside the clock panel, mutate nothing.
    const before = await repValue(page).innerText();
    const segmentsBefore = await capturedCount(page);
    await page.keyboard.press('8'); // up
    const focusedInPanel = await page.evaluate(() => {
      const el = document.activeElement;
      return el !== null && el.closest('[data-clock-panel]') !== null;
    });
    expect(focusedInPanel).toBe(true);
    await page.keyboard.press('Numpad4'); // left (Num Lock independent)
    expect(await repValue(page).innerText()).toBe(before);
    expect(await capturedCount(page)).toBe(segmentsBefore);

    await page.getByTestId(TEST_IDS.CLOCK_REP_PLUS).click();
    await expect(repValue(page)).toHaveText(/^1 \/ Target 10$/);

    // ── Entry digits are data: `*` opens the card, Numpad digits (Num Lock
    // off shape included) append, Enter commits once and never advances.
    await page.keyboard.press('NumpadMultiply');
    await expect(page.getByTestId(TEST_IDS.CLOCK_ENTRY_OVERLAY)).toBeVisible();
    await page.keyboard.press('7');
    await page.keyboard.press('Numpad5');
    await page.keyboard.press('NumpadEnter');
    await expect(page.getByTestId(TEST_IDS.CLOCK_ENTRY_OVERLAY)).toBeHidden();
    await expect(repValue(page)).toHaveText(/^75 \/ Target 10$/); // over target allowed
    expect(await capturedCount(page)).toBe(segmentsBefore);

    // ── Repeated rounds: advancing into the next occurrence resets the count
    // to unknown (—), never 0. Milestone: any captured-segment growth.
    await page.keyboard.press('NumpadEnter');
    await expect
      .poll(() => capturedCount(page), { timeout: 10_000 })
      .toBeGreaterThan(segmentsBefore);
    await expect(repValue(page)).toHaveText(/^—/);
  });

  test('paused Next is rejected; / toggles playback; stop confirm preserves partials for review', async ({ page }) => {
    await startWorkoutFromPlayground(
      page,
      'clock-board-pause-stop',
      '```time\n(2)\n  5 Push Ups\n  5 Squats\n```',
    );

    // One active movement per step is selected automatically.
    await page.getByTestId(TEST_IDS.CLOCK_REP_PLUS).click();
    await expect(repValue(page)).toHaveText(/^1 \/ Target 5$/);

    // Pause via `/`, then keypad Enter must NOT advance (paused gate).
    await page.keyboard.press('/');
    await playIconButton(page).waitFor({ state: 'visible', timeout: 8_000 });
    const segments = await capturedCount(page);
    await page.keyboard.press('NumpadEnter');
    await page.waitForTimeout(300);
    expect(await capturedCount(page)).toBe(segments);

    // Escape opens stop confirmation; cancel resumes the paused run.
    await page.keyboard.press('Escape');
    const confirm = page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM);
    await expect(confirm).toBeVisible();
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_CANCEL).click();
    await expect(confirm).toBeHidden();

    // Escape again → confirm → partials are preserved into the review
    // (FullscreenTimer keeps the run open for collection) instead of closing.
    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });

    // Exit the review, then verify the durable result through the events
    // store: a user-origin rep event (measured actual 1, occurrence-keyed)
    // tied to the preserved partial session.
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
  });

  test('native focus semantics: main Enter clicks the focused button, keypad Enter stays gated', async ({ page }) => {
    await startWorkoutFromPlayground(
      page,
      'clock-board-focus',
      '```time\n(2)\n  5 Push Ups\n```',
    );

    // Focus the Pause button and press MAIN Enter: native semantics pause the
    // run — no secondary dispatch.
    const pauseBtn = pauseIconButton(page);
    await pauseBtn.focus();
    await page.keyboard.press('Enter');
    await playIconButton(page).waitFor({ state: 'visible', timeout: 8_000 });

    // Keypad Enter while paused is consumed by the clock (gate rejects Next,
    // native activation suppressed): still paused, no segment change.
    const segments = await capturedCount(page);
    await page.keyboard.press('NumpadEnter');
    await page.waitForTimeout(300);
    await expect(playIconButton(page)).toBeVisible();
    expect(await capturedCount(page)).toBe(segments);
  });

  test('mobile 375×812: board, entry digits and stop confirm work on the Minimal tier', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await startWorkoutFromPlayground(
      page,
      'clock-board-mobile',
      '```time\n(2)\n  10 Push Ups\n```',
    );
    await expect(page.getByTestId(TEST_IDS.TIMER_SURFACE_MINIMAL)).toBeVisible();
    await expect(board(page)).toBeVisible();

    // Single movement per round → auto-selected.
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
  });

  test('pre-run `? Push Ups` resolves through the wizard, leads Ready, Enter starts', async ({ page }) => {
    await navigateToRunPage(
      page,
      'clock-board-prerun',
      '```time\nFor Time:\n  ? Push Ups\n  10 Squats\n```\n',
    );

    // Wizard owns the foreground (authority priority 10): the live board is
    // not mounted. Type the target with the shared keyboard and commit.
    await expect(board(page)).toBeHidden({ timeout: 10_000 });
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('NumpadEnter');
    // Let the wizard flip from the saved field to its Ready state before the
    // explicit start (a held/queued Enter must never save AND start at once).
    await page.waitForTimeout(600);
    await page.keyboard.press('NumpadEnter');
    await pauseIconButton(page).waitFor({ state: 'visible', timeout: 20_000 });

    // The board is live now and the runtime started from Ready.
    await expect(board(page)).toBeVisible();
  });
});
