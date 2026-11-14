// spec: e2e/specs/runtime/wall-clock-and-fastclock-protocols.md
import type { Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';
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

async function waitBrowserClockElapsed(page: Page, minMs: number): Promise<void> {
  const started = await page.evaluate(() => performance.now());
  await expect
    .poll(() => page.evaluate(() => performance.now()), { timeout: minMs + 5_000 })
    .toBeGreaterThanOrEqual(started + minMs);
}

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

    // 1. Pause freezes countdown across >1.2s elapsed wall time, Resume restarts, Stop records partial (completed: false)
    await startWorkoutFromPlayground(page, 'run01-pause-stop', '```time\nTimer: 1:00\n10 Burpees\n```');
    await pauseIconButton(page).click();
    await expect(playIconButton(page)).toBeVisible({ timeout: 5_000 });

    const frozen = await timerSeconds(page);
    await waitBrowserClockElapsed(page, 1_300);
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

    // 2. Forced-rest *:30 overrun across 2 sets completes cleanly via real pointer click on Play
    await app.seed.note(
      'playground/run01-rest-overrun',
      '# rest-overrun\n\n```time\n(2 Sets)\n  10 Kettlebell Swings 24kg\n  *:30 Rest\n```\n',
      { type: 'playground', title: 'rest-overrun' },
    );
    await page.goto('/playground/run01-rest-overrun', { waitUntil: 'domcontentloaded' });
    const play = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(play).toBeVisible({ timeout: 15_000 });
    await play.click();
    await page.waitForURL(/\/(tracker|run)\//, { timeout: 15_000 });

    await advanceUntilReview(page);
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible();
    await expect(page.getByText(/Timer can['’]t be skipped/i)).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'Kettlebell Swings' })).toHaveCount(2);

    app.assertCleanConsole();
  });

  test('notebook-launched session survives route changes, persists inline partial result across reload, and renders defensive empty/unknown states', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await app.goto('/');
    await clearSessions(page);
    await app.seed.note(SURVIVAL_NOTE_ID, SURVIVAL_MD, { title: 'Session Routes Probe' });

    // 1a. Start workout from /notebook/:slug/:item via real pointer click -> early Stop saves partial Session & inline result across reload
    await app.goto(`/notebook/${SURVIVAL_NOTE_ID}`);
    await expect(page.locator('.cm-content')).toContainText('5:00', { timeout: 15_000 });
    await page.locator('.cm-content').getByText('5:00').first().click();
    const play = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(play).toBeVisible({ timeout: 10_000 });
    await play.click();

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await page.waitForURL(new RegExp(`/day/${todayKey}`), { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    await app.runtime.advance(1);
    await expect(page.getByText(/Push Ups/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 8_000 });

    await expect.poll(async () => (await getSessions(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);
    const savedSession = (await getSessions(page))[0]!;
    expect(savedSession.completed).toBe(false);
    expect(savedSession.noteId).toBeTruthy();

    await expect(page.locator('.cm-query-block-preview, [data-testid="rows-table"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(page.locator('.cm-query-block-preview, [data-testid="rows-table"]').first()).toBeVisible({
      timeout: 15_000,
    });
    if (savedSession.noteId) {
      await deleteNoteByRouteId(page, savedSession.noteId);
    }
    await app.journal.clearDate(todayKey);

    // 1b. Active session launched from /notebook/:slug/:item survives Back/Forward SPA route transitions
    await app.goto(`/notebook/${SURVIVAL_NOTE_ID}`);
    await expect(page.locator('.cm-content')).toContainText('5:00', { timeout: 15_000 });
    await page.locator('.cm-content').getByText('5:00').first().click();
    const playSurvival = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(playSurvival).toBeVisible({ timeout: 10_000 });
    await playSurvival.click();

    await page.waitForURL(new RegExp(`/day/${todayKey}`), { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/notebook/${SURVIVAL_NOTE_ID}`), { timeout: 15_000 });
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/day/${todayKey}`), { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    // 2. Empty block shows 'Nothing to run' via real pointer click (hard goto resets prior runtime cleanly)
    await app.journal.clearDate(EMPTY_DATE);
    await app.seed.journalNote(EMPTY_DATE, '# Empty\n\n```time\n```\n');
    await app.journal.openDate(EMPTY_DATE);
    const startEmpty = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(startEmpty).toBeVisible({ timeout: 10_000 });
    await startEmpty.click();
    await expect(page.getByText('Nothing to run')).toBeVisible({ timeout: 15_000 });

    // Clean up any cloned today note created by 1b
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['notes'], 'readwrite');
          const store = tx.objectStore('notes');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const row of all.result as Array<{ id: string; title?: string; type?: string }>) {
              if (row.title === 'Session Routes Probe' && row.id !== 'crossfit-girls/run-01-survival-probe') {
                store.delete(row.id);
              }
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await app.journal.clearDate(todayKey);

    // 3. Unknown /run/:runtimeId cold load shows defensive message
    await page.goto(`/run/${crypto.randomUUID()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(
      page.getByText('Runtime not found. Please start the workout from the editor.'),
    ).toBeVisible({ timeout: 15_000 });

    app.assertCleanConsole();
  });

  test('recognizes wod + time fences, holds Ready-to-Start clock at 00:00, formats MET Minutes, and persists partial session across mid-run reload', async ({
    app,
  }) => {
    const { page } = app;
    const noteId = `qa-runtime-round2-${Date.now()}`;
    await app.seed.note(
      noteId,
      [
        '# QA Runtime Round 2',
        '',
        '```time',
        '20:00 AMRAP',
        '  10 Burpees',
        '  15 Kettlebell Swings 24kg',
        '```',
        '',
        '```wod',
        '3 Rounds',
        '  12 Wall Balls 20lb',
        '```',
      ].join('\n'),
      { title: 'QA Runtime Round 2' },
    );

    await app.goto(`/note/${noteId}`);

    // Runtime finding #6: both ```time and ```wod fences register as runnable workout blocks
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const el = document.getElementById('agent-view-state');
          if (!el?.textContent) return 0;
          const parsed = JSON.parse(el.textContent) as {
            editor?: { workoutBlockIds?: string[] } | null;
          };
          return parsed.editor?.workoutBlockIds?.length ?? 0;
        });
      })
      .toBe(2);

    // Launch first workout block into timer overlay
    await page.getByRole('button', { name: /^Run$/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({ timeout: 10_000 });

    // Runtime finding #5: elapsed clock stays 00:00 across >1.3s real wall time while gated on Ready to Start
    await waitBrowserClockElapsed(page, 1_300);
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible();
    await expect(page.locator('[data-clock-panel]')).toContainText('00:00');

    // Advance twice deterministically so at least 1 segment is completed & captured
    const nextBtn = page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
    await nextBtn.click();
    await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeHidden({ timeout: 5_000 });
    await expect(page.getByText(/Burpees/i).first()).toBeVisible({ timeout: 5_000 });
    await nextBtn.click();
    await expect(page.getByText(/Kettlebell Swings/i).first()).toBeVisible({ timeout: 5_000 });

    // Runtime finding #7: mobile 375x812 aggregate bubble never renders 'Calc.met Minutes'
    await page.setViewportSize({ width: 375, height: 812 });
    const panelText = await page.locator('[data-clock-panel]').innerText();
    expect(panelText).not.toContain('Calc.met Minutes');
    expect(panelText.toUpperCase()).not.toContain('CALC.MET MINUTES');

    // WW-012 + WW-020: full browser reload mid-run preserves note, shows halted-run-notice, and saves partial session
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 15_000,
    });

    const notice = page.getByTestId('halted-run-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    const resultsHref = await notice.getByRole('link', { name: /partial results/i }).getAttribute('href');
    expect(resultsHref).toMatch(/^\/results\/.+/);

    await app.goto(resultsHref!);
    await expect(page.getByText('Session not found.')).toHaveCount(0);
    app.assertCleanConsole();
  });
});
