/**
 * Route session survival — a running workout survives route changes.
 *
 * Start a workout on the collection page → the journal page owns the run →
 * navigate away and come back. The run must still be alive: the runtime is
 * parked (not disposed) when its surface unmounts and re-bound on return, so
 * the clock kept running while the user was elsewhere.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedNote, WOD_DB } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

const NOTE_ID = 'crossfit-girls/session-routes-probe';
const CONTENT = '# Session Routes Probe\n\n```time\n5:00 AMRAP\n  5 Push Ups\n```\n';

async function deleteNote(page: Page, noteId: string): Promise<void> {
  await page.evaluate(async ({ dbName, noteId }) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const stores = ['notes', 'block_index', 'block_efforts', 'note_tags', 'sessions']
        .filter(s => db.objectStoreNames.contains(s));
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore('notes').delete(noteId);
      for (const storeName of ['block_index', 'block_efforts', 'note_tags', 'sessions']) {
        const cursorReq = tx.objectStore(storeName).index('by-note').openCursor(IDBKeyRange.only(noteId));
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest).result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
      }
      tx.oncomplete = () => db.close();
    };
  }, { dbName: WOD_DB, noteId });
}

test('a running workout survives route changes', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
  await seedNote(page, NOTE_ID, CONTENT, { title: 'Session Routes Probe' });

  await page.goto(`/c/${NOTE_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.cm-content')).toContainText('5:00', { timeout: 15_000 });
  await page.locator('.cm-content').getByText('5:00').first().click();
  const play = page.locator('button[aria-label="Play"]').first();
  await expect(play).toBeVisible({ timeout: 10_000 });
  await play.evaluate((el) => (el as HTMLElement).click());

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.waitForURL(new RegExp(`/journal/${todayKey}`), { timeout: 15_000 });
  const stop = page.getByRole('button', { name: 'Stop Session', exact: true }).first();
  await expect(stop).toBeVisible({ timeout: 15_000 });

  // Navigate away (client-side route change) and come back.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${NOTE_ID}`), { timeout: 15_000 });
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/journal/${todayKey}`), { timeout: 15_000 });

  // The run must still be alive — the clock kept running while parked.
  await expect(page.getByRole('button', { name: 'Stop Session', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/session-routes-proof.png' });

  await deleteNote(page, NOTE_ID);
});
