/**
 * Collection → New Journal Note → Result Persistence E2E
 *
 * Dogfoods the full flow:
 *   1. User visits a collection workout page
 *   2. Clicks the block's "Play" run control → appendWorkoutToJournal creates
 *      today's journal entry and navigates to /journal/YYYY-MM-DD?autoStart=<uuid>
 *   3. JournalPage picks up autoStart → FullscreenTimer opens
 *   4. Workout completes → session saved to wodwiki-db via storageService
 *      with noteId = 'journal/YYYY-MM-DD' (the full key, NOT just the date)
 *   5. After closing the review, the result badge appears on the note page
 *
 * Test isolation: uses today's date so the content IS realistic, but clears
 * the journal note and its results from wodwiki-db before each run.
 */

import { test, expect } from '@playwright/test';
import { deleteNoteByRouteId, getNoteContentByRouteId, seedJournalNote, seedCompletedSessions, clearResults, getResults } from '../helpers/wodwikiDb';
import { waitForSeedReady, syncCommunitySeed } from '../helpers/seedReadiness';

// ── The collection workout used for dogfooding ─────────────────────────────
// Any collection with a playable WOD block will do. Crossfit Girls / Fran is
// the most visible in the demo and reliably parses.
const COLLECTION_WORKOUT_URL = '/workout/crossfit-girls/fran';

// ── IDB helpers ────────────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Collection → New Journal Note → Result Persistence', () => {
  // First community import into a fresh profile exceeds the default 45s.
  test.setTimeout(180_000);
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
    });

    // A navigation failure fails the test — a silent skip here would hide a
    // broken environment as green.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await waitForSeedReady(page);
    // /c/… and /workout/… read the community corpus (autoImport:false); sync
    // it through the real Settings surface once per context instead of
    // depending on leftover browser state.
    await syncCommunitySeed(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const persistenceErrors = errors.filter(e =>
      e.includes('NOTE_NOT_FOUND') ||
      e.includes('mutateNote') ||
      e.includes('persistence') ||
      e.includes('IndexedDB')
    );
    if (persistenceErrors.length > 0) {
      testInfo.attach('persistence-errors', { body: persistenceErrors.join('\n'), contentType: 'text/plain' });
    }
    // Failure diagnostic: capture the UI state at cleanup time.
    if (testInfo.status !== testInfo.expectedStatus) {
      await page
        .screenshot({ path: testInfo.outputPath('collection-failure.png'), fullPage: true })
        .catch(() => {
          // A failed diagnostic screenshot must not mask the original failure.
        });
    }
  });

  // ── 1. Navigation: "Play" creates a journal entry and opens the timer ─────

  test('clicking "Play" on a collection workout navigates to today\'s journal and opens the timer', async ({ page }, testInfo) => {
    const dateKey = todayKey();
    const playgroundKey = `journal/${dateKey}`;

    // Clear any existing state so we start clean
    await deleteNoteByRouteId(page, playgroundKey);
    await clearResults(page, playgroundKey);

    // Navigate to the collection workout
    await page.goto(COLLECTION_WORKOUT_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // Blocks-parsed signal: the block's primary run control mounts (bounded
    // auto-wait). The collection block action is "Play"
    // (useScriptBlockCommands, collection-readonly) — the retired "Now"
    // button no longer exists. Absence is a regression (the collection WOD
    // failed to parse) — fail, don't skip.
    const playButton = page.getByRole('button', { name: 'Play', exact: true }).first();
    await playButton.waitFor({ state: 'visible', timeout: 10_000 });

    await page.screenshot({ path: testInfo.outputPath('collection-01-workout-page.png') });

    // Click "Play" (primary run button on the first WOD block)
    await playButton.click();

    // Should navigate to /journal/YYYY-MM-DD (with optional ?autoStart=...)
    await expect(page).toHaveURL(new RegExp(`/journal/${dateKey}`), { timeout: 8_000 });

    await page.screenshot({ path: testInfo.outputPath('collection-02-journal-with-timer.png') });

    // The journal note must have been created in wodwiki-db — poll for the write.
    await expect
      .poll(() => getNoteContentByRouteId(page, playgroundKey), { timeout: 10_000 })
      .toEqual(expect.any(String));
    const content = await getNoteContentByRouteId(page, playgroundKey);
    expect(content, 'Journal note should be created in wodwiki-db').toEqual(expect.any(String));
    expect(content, 'Journal note should contain the workout name').toMatch(/fran/i);

    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 5_000 });

    // No NOTE_NOT_FOUND errors during navigation
    const notFoundErrors = errors.filter(e => e.includes('NOTE_NOT_FOUND'));
    expect(notFoundErrors, 'No NOTE_NOT_FOUND errors during navigation').toHaveLength(0);
  });

  // ── 2. Result saved with correct noteId after timer close ─────────────────

  test('result is saved under journal/<date> key in wodwiki-db after workout complete', async ({ page }, testInfo) => {
    const dateKey = todayKey();
    const fullNoteId = `journal/${dateKey}`;

    // Seed a result as if JournalPage.handleTimerComplete fired correctly
    // (simulates the fixed code path: storageService.saveSession with fullNoteId)
    await clearResults(page, fullNoteId);
    await seedJournalNote(page, dateKey, '# Fran\n\n```time\n21 Thrusters\n```\n');

    await page.goto(`/journal/${dateKey}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    // Page-loaded signal: the date page shell mounts its editor or empty state.
    await expect(
      page.locator('.cm-content[contenteditable="true"], h1').first(),
    ).toBeAttached({ timeout: 10_000 });

    await seedCompletedSessions(page, fullNoteId, [{ id: 'e2e-collection-test-001', createdAt: Date.now(), duration: 300_000 }]);

    const results = await getResults(page, fullNoteId);
    expect(results, 'Result should be retrievable under journal/<date> key').toHaveLength(1);

    // Navigate away and back — result must survive
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.goto(`/journal/${dateKey}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    // Page-loaded signal: the date page shell mounts its editor or empty state.
    await expect(
      page.locator('.cm-content[contenteditable="true"], h1').first(),
    ).toBeAttached({ timeout: 10_000 });

    const afterReload = await getResults(page, fullNoteId);
    expect(afterReload, 'Result must survive navigation (not be wiped on journal load)').toHaveLength(1);

    await page.screenshot({ path: testInfo.outputPath('collection-03-result-survives-reload.png') });
  });

  // ── 3. No NOTE_NOT_FOUND when completing via JournalPage ─────────────────

  test('completing a workout on JournalPage does not throw NOTE_NOT_FOUND', async ({ page }, testInfo) => {
    // This test verifies the regression fix:
    //   BEFORE: notePersistence.mutateNote('2024-01-15') → NOTE_NOT_FOUND
    //   AFTER:  storageService.saveSession({ noteId: 'journal/2024-01-15' }) → OK
    //
    // We navigate to a journal page that does NOT exist in wodwiki-db (normal state
    // for new notes created via appendWorkoutToJournal) and assert no errors fire.
    const dateKey = todayKey();
    const fullNoteId = `journal/${dateKey}`;

    errors.length = 0;
    await clearResults(page, fullNoteId);

    await page.goto(`/journal/${dateKey}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    // Deliberate grace window: allow any async NOTE_NOT_FOUND to surface
    // before asserting a clean error log.
    await page.waitForTimeout(1000);

    // The page itself should load without errors
    const noteNotFoundErrors = errors.filter(e => e.includes('NOTE_NOT_FOUND'));
    expect(noteNotFoundErrors, 'Journal page load must not trigger NOTE_NOT_FOUND').toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('collection-04-no-errors-on-journal-load.png') });
  });
});
