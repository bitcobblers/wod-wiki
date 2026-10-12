/**
 * Collection Workout — run → record → results E2E
 *
 * Flow under test (live app):
 *   1. /c/:collection/:workout (a seeded collection-style note) → click Play
 *      on the WOD block. Date-shaped names take the date-scoped collection
 *      route, so the fixtures use plain slug workout names.
 *      This must CREATE A NEW RECORD: a journal note for today containing the
 *      cloned workout block, and the runtime auto-starts on the date page.
 *   2a. Stopping the workout early must persist a WorkoutResult against the
 *       created note and show the results review.
 *   2b. Letting a short workout complete naturally must persist a completed
 *       WorkoutResult and show the completion results view.
 *   3. After a reload, the note page displays the result inline on the block
 *      (results survive as first-class records, matched by content id).
 *
 * The two collection files are real; their content is overridden with short
 * E2E timers via IDB-first loading (usePlaygroundContent prefers stored
 * content over the bundled markdown). Dates are the real today — the run
 * profile's IndexedDB is ephemeral, and each test cleans up the journal note
 * it creates.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedNote, WOD_DB } from '../helpers/wodwikiDb';
import { waitForSeedReady } from '../helpers/seedReadiness';
import { getSessions } from '../utils/sessionsDb';
import { installFastClock } from '../utils/fastClock';
import { TEST_IDS } from '../contracts/TestIdContract';

// ── Fixtures ────────────────────────────────────────────────────────────────
const STOP_NOTE_ID = 'zombiefit/e2e-stop-run';
const COMPLETE_NOTE_ID = 'zombiefit/e2e-complete-run';
const STOP_TITLE = 'e2e-stop-run';
const COMPLETE_TITLE = 'e2e-complete-run';

const STOP_CONTENT = '# E2E Stop Run\n\n```time\n10:00 AMRAP\n  5 Air Squats\n  5 Push Ups\n```\n';
const COMPLETE_CONTENT = '# E2E Complete Run\n\n```time\n0:03 AMRAP\n  5 Air Squats\n```\n';

function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ── IDB helpers ─────────────────────────────────────────────────────────────

/** Find a note's uuid by title (journal notes created by the run flow). */
async function findNoteIdByTitle(page: Page, title: string): Promise<string | null> {
  return page.evaluate(async ({ dbName, title }) => {
    return new Promise<string | null>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('notes', 'readonly');
        const getAll = tx.objectStore('notes').getAll();
        getAll.onsuccess = () => {
          const match = (getAll.result as Array<{ id: string; title?: string }>)
            .filter(n => n.title === title)
            .pop();
          db.close();
          resolve(match?.id ?? null);
        };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }, { dbName: WOD_DB, title });
}


async function deleteNoteAndResults(page: Page, noteId: string | null): Promise<void> {
  if (!noteId) return;
  await page.evaluate(async ({ dbName, noteId }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        const stores = ['notes', 'block_index', 'block_efforts', 'note_tags', 'sessions']
          .filter(s => db.objectStoreNames.contains(s));
        const tx = db.transaction(stores, 'readwrite');
        tx.objectStore('notes').delete(noteId);
        for (const storeName of ['block_index', 'block_efforts', 'note_tags', 'sessions']) {
          if (!stores.includes(storeName)) continue;
          const cursorReq = tx.objectStore(storeName).index('by-note').openCursor(IDBKeyRange.only(noteId));
          cursorReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result;
            if (cursor) { cursor.delete(); cursor.continue(); }
          };
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }, { dbName: WOD_DB, noteId });
}

/** Click the WOD block's Play command (DOM-click: overlay decorations can
 *  intercept pointer events, matching the wod-index spec pattern). */
async function clickPlayOnBlock(page: Page, blockText: string) {
  // Place the cursor inside the WOD block so its command bar renders.
  await page.locator('.cm-content').getByText(blockText).first().click();
  const play = page.locator('button[aria-label="Play"]').first();
  await expect(play).toBeVisible({ timeout: 10_000 });
  await play.evaluate((el) => (el as HTMLElement).click());
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Collection Workout — run and record', () => {
  // Fresh browser profiles re-run the seed corpus import (~25s in dev) before
  // /c/:collection/:workout resolves its content, so the default 45s is too tight.
  test.setTimeout(120_000);

  // Fast clock (20×): the 0:03 AMRAP completes in ~150ms wall time; the
  // 10:00 AMRAP stop-early flow is unaffected (it never runs to completion).
  test.beforeEach(async ({ page }) => {
    await installFastClock(page);
  });

  /**
   * Boot the app and wait for the background seed import to settle before
   * seeding test notes — otherwise the importer's collection chunk overwrites
   * the E2E content and /c/… pages render fallback markdown mid-race. Uses the
   * shared <html data-seed-state> readiness gate (no console-event waits, no
   * silent catch-and-proceed): a failed sync fails the test here.
   */
  async function gotoHomeAfterSeedImport(page: Page): Promise<void> {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForSeedReady(page);
  }

  test('creates a journal record on start; stopping early saves and displays results', async ({ page }, testInfo) => {
    const today = todayKey();

    await gotoHomeAfterSeedImport(page);
    await seedNote(page, STOP_NOTE_ID, STOP_CONTENT, { title: 'E2E Stop Run' });
    await deleteNoteAndResults(page, await findNoteIdByTitle(page, STOP_TITLE));

    // 1. Start the workout from the collection workout page. Gate on the
    // stored E2E content actually being mounted (not just any editor): the
    // IDB-first load swaps bundled markdown for the override after mount,
    // and Play must hit the post-swap DOM. (Workout names must not look
    // like dates — /c/:slug/:date is the date-scoped collection view.)
    await page.goto(`/c/${STOP_NOTE_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-content')).toContainText('10:00 AMRAP', { timeout: 15_000 });
    await clickPlayOnBlock(page, '10:00 AMRAP');

    // A new record (journal note for today) is created and the runtime opens.
    await page.waitForURL(new RegExp(`/journal/${today}`), { timeout: 15_000 });
    await expect(page.locator('.cm-content')).toContainText(STOP_TITLE, { timeout: 15_000 });
    const noteUuid = await findNoteIdByTitle(page, STOP_TITLE);
    expect(noteUuid, 'Play must create a journal note for today').toBeTruthy();

    // Timer auto-starts the session clock; the workout waits at the
    // Ready-to-Start gate. Step through it (Next) to mount the first block —
    // the designed start gesture (see runtime-execution.e2e.ts).
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
    // Deliberate accumulation window: let the runtime produce some log
    // output before the early stop. At the 20× fast clock this 500ms of
    // wall time is ~10s of runtime.
    await page.waitForTimeout(500);

    // 2. Stop early → result persists against the created note.
    await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).click();

    await expect
      .poll(async () => (await getSessions(page, noteUuid!)).length, { timeout: 10_000 })
      .toBe(1);
    const sessions = await getSessions(page, noteUuid!);
    expect(sessions[0]?.completed, 'manual stop records an incomplete result').toBe(false);

    // Results are displayed on the note page: the inline result panel renders
    // under the WOD block (a review overlay may also open when the run has
    // logs — close it so the note page is visible).
    const closeReview = page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
    if (await closeReview.isVisible().catch(() => false)) {
      await closeReview.click();
    }
    await expect(
      page.locator('.cm-query-block-preview, [data-testid="rows-table"]').first(),
      'result renders inline on the WOD block after stopping',
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('collection-run-stop-review.png') });

    // 3. The inline result survives a hard reload (persisted record).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-content')).toContainText(STOP_TITLE, { timeout: 15_000 });
    await expect(
      page.locator('.cm-query-block-preview, [data-testid="rows-table"]').first(),
      'persisted result renders inline on the WOD block',
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('collection-run-stop-inline.png') });

    await deleteNoteAndResults(page, noteUuid);
  });

  test('completing a short workout saves a completed result and shows the results view', async ({ page }, testInfo) => {
    const today = todayKey();

    await gotoHomeAfterSeedImport(page);
    await seedNote(page, COMPLETE_NOTE_ID, COMPLETE_CONTENT, { title: 'E2E Complete Run' });
    await deleteNoteAndResults(page, await findNoteIdByTitle(page, COMPLETE_TITLE));

    await page.goto(`/c/${COMPLETE_NOTE_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-content')).toContainText('0:03 AMRAP', { timeout: 15_000 });
    await clickPlayOnBlock(page, '0:03 AMRAP');

    await page.waitForURL(new RegExp(`/journal/${today}`), { timeout: 15_000 });
    const noteUuid = await findNoteIdByTitle(page, COMPLETE_TITLE);
    expect(noteUuid, 'Play must create a journal note for today').toBeTruthy();

    // Step through the Ready-to-Start gate; the 3s AMRAP then completes
    // naturally → a results view opens (the timer's own completion view
    // and/or the page's review overlay).
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
    await expect(page.getByText(/Workout (Complete|Review)/).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('collection-run-complete.png') });

    await expect
      .poll(async () => (await getSessions(page, noteUuid!)).length, { timeout: 10_000 })
      .toBe(1);
    const sessions = await getSessions(page, noteUuid!);
    expect(sessions[0]?.completed, 'natural finish records a completed result').toBe(true);

    await deleteNoteAndResults(page, noteUuid);
  });
});
