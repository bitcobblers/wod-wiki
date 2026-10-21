/**
 * Collection Clock Values — pre-run targets, Ready/Start, durable post-run actuals.
 *
 * Live-app flow (journal date page → NoteEditor inline runtime →
 * FullscreenTimer, the surface that passes the pinned resultId):
 *   1. A workout with ONE hinted final field (`? Push Ups`) shows the target
 *      wizard; saving the field leads Ready — Start is a separate action and
 *      the timer does NOT auto-start.
 *   2. Stopping the live run asks for confirmation first; confirming keeps
 *      partial results and opens the missing-actual queue.
 *   3. Answering the actual persists it as a durable user-origin correction
 *      on the exact occurrence (survives reload); a skipped actual stays
 *      unknown (no user-origin rep event is invented).
 *
 * Exercises the real clock without accelerated time.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedNote, WOD_DB } from '../helpers/wodwikiDb';
import { waitForSeedReady, syncCommunitySeed } from '../helpers/seedReadiness';
import { getSessions } from '../utils/sessionsDb';
import { pauseIconButton } from '../pages/WallClockPage';
import { TEST_IDS } from '../contracts/TestIdContract';

const NOTE_ID = 'zombiefit/e2e-clock-values';
// One hinted field only — the single-final-field Ready case.
const CONTENT = '# E2E Clock Values\n\n```time\n5:00\n  ? Push Ups\n```\n';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function findNoteIdByTitle(page: Page, title: string): Promise<string | null> {
  return page.evaluate(async ({ dbName, title }) => {
    const { promise, resolve, reject } = Promise.withResolvers<string | null>();
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('notes', 'readonly');
      const getAll = tx.objectStore('notes').getAll();
      getAll.onsuccess = () => {
        const match = (getAll.result as Array<{ id: string; title?: string; type?: string }>)
          .filter(n => n.title === title && (n.type === 'journal' || n.id.startsWith('journal/')))
          .pop();
        db.close();
        resolve(match?.id ?? null);
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
    return promise;
  }, { dbName: WOD_DB, title });
}

async function deleteNoteAndResults(page: Page, noteId: string | null): Promise<void> {
  if (!noteId) return;
  await page.evaluate(async ({ dbName, noteId }) => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
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
    return promise;
  }, { dbName: WOD_DB, noteId });
}

async function clickPlayOnBlock(page: Page, blockText: string) {
  await page.locator('.cm-content').getByText(blockText).first().click();
  const play = page.locator('button[aria-label="Play"]').first();
  await expect(play).toBeVisible({ timeout: 10_000 });
  await play.evaluate((el) => (el as HTMLElement).click());
}

/** All user-origin rep events in the events store (durable corrections). */
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

test.describe('Collection clock values — targets, Ready/Start, durable actuals', () => {
  test.setTimeout(180_000);


  test('single final target leads Ready; stop confirms; post-run actual persists durably', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem('wodwiki.castBackend', 'local');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForSeedReady(page);
    await syncCommunitySeed(page);
    await seedNote(page, NOTE_ID, CONTENT, { title: 'E2E Clock Values' });
    await deleteNoteAndResults(page, await findNoteIdByTitle(page, 'e2e-clock-values'));

    await page.goto(`/c/${NOTE_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-content')).toContainText('5:00', { timeout: 15_000 });
    await clickPlayOnBlock(page, '5:00');

    const today = todayKey();
    await page.waitForURL(new RegExp(`/journal/${today}`), { timeout: 15_000 });
    const noteUuid = await findNoteIdByTitle(page, 'e2e-clock-values');
    expect(noteUuid, 'Play must create a journal note for today').toBeTruthy();

    // ── Pre-run wizard: single hinted target ────────────────────────────────
    const value = page.getByTestId('entry-value');
    await expect(value).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Set Your Targets')).toBeVisible();

    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Cast to TV' }).first().click();
    const receiver = await popupPromise;
    await expect(receiver.getByTestId('entry-value')).toBeVisible({ timeout: 20_000 });

    // Zero is a value, Save is always offered — enter 7 via the on-screen grid.
    await page.getByTestId('entry-digit-7').click();
    await page.getByTestId('entry-save').click();

    // Final field saved → Ready panel; the run must NOT auto-start.
    await expect(page.getByTestId('collection-start')).toBeVisible({ timeout: 10_000 });
    await expect(receiver.getByRole('button', { name: 'Start Workout' })).toBeVisible();
    await expect(pauseIconButton(page)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('clock-values-ready.png') });

    // Separate explicit start mounts the runtime. The session gate may sit at
    // "Ready to Start" or be auto-popped by autoStart — assert on controls,
    // never on wording, then advance if the gate is still up.
    await receiver.getByRole('button', { name: 'Start Workout' }).focus();
    await receiver.keyboard.press('Enter');
    await expect(page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first()).toBeVisible({ timeout: 10_000 });
    const gateNext = page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
    await gateNext.click().catch(() => {});
    await expect(pauseIconButton(page)).toBeVisible({ timeout: 10_000 });

    // Let the live occurrence mount before stopping it.
    await page.waitForTimeout(500);

    // ── Live stop requests confirmation — never silent ──────────────────────
    await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
    await expect(page.getByText('Stop workout?')).toBeVisible({ timeout: 5_000 });
    // Cancel keeps the run live.
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_CANCEL).click();
    await expect(pauseIconButton(page)).toBeVisible({ timeout: 5_000 });
    // Confirm halts and keeps partial results.
    await page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
    await page.getByTestId(TEST_IDS.CLOCK_STOP_CONFIRM_ACCEPT).click();

    // Raw save settles first, then the missing-actual queue opens.
    const queueTitle = page.getByText('Fill in your actuals');
    await expect(queueTitle).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: testInfo.outputPath('clock-values-queue.png') });

    // ── Answer the actual — durable correction on the exact occurrence ──────
    await expect(receiver.getByTestId('entry-value')).toBeVisible({ timeout: 20_000 });
    await receiver.keyboard.press('Numpad9');
    await receiver.keyboard.press('NumpadEnter');
    await expect(value).toBeHidden({ timeout: 20_000 });

    // Queue drains → review grid (queue dismissed by completion).
    await expect(page.getByText('Workout Complete')).toBeVisible({ timeout: 20_000 });
    const review = page.getByRole('dialog', { name: 'Workout Complete' });
    await expect(review.getByRole('row').filter({ hasText: 'Push Ups' }).getByText(/^9\s*👤$/)).toBeVisible();

    // The correction is durable before any reload: one user-origin rep event
    // on the run's occurrence (sourceBlockKey identity, value 9).
    await expect.poll(async () => (await getUserRepEvents(page)).length).toBe(1);
    const repEvents = await getUserRepEvents(page);
    expect(repEvents[0]?.value).toBe(9);
    expect(repEvents[0]?.sourceBlockKey, 'occurrence key is the runtime block key').toBeTruthy();
    const resultId = repEvents[0]?.resultId;
    expect(resultId).toBeTruthy();
    const sessions = await getSessions(page, noteUuid!);
    expect(sessions.length).toBe(1);

    // ── Reload: the corrected value survives (durable, re-derived) ──────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await getUserRepEvents(page)).filter(e => e.resultId === resultId).length).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('clock-values-reloaded.png') });
    await receiver.close();

    await deleteNoteAndResults(page, noteUuid);
  });
});
