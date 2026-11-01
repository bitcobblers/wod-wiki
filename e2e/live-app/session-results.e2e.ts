import { expect, test, type Page } from '@playwright/test';
import { WOD_DB, noteFixture } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';
import { parseDocumentSections } from '../../packages/core/src/sections';

const SESSION_ID = '01a198c7-6a49-76be-b728-b8ac7af4b0c9';
const NOTE_ID = 'crossfit-girls/session-results-table';
const CONTENT = '# Session Results Table\n\n```time\n5:00 AMRAP\n  5 Kettlebell Swings\n```\n';

async function seedSession(page: Page): Promise<void> {
  const fixture = noteFixture(NOTE_ID, CONTENT, { title: 'Session Results Table' });
  const workout = Object.values(fixture.note.blocks).find(block => block.kind === 'wod');
  if (!workout) throw new Error('No workout block in session fixture');
  const rawContent = CONTENT.slice(workout.from, workout.to);
  const blockContentId = parseDocumentSections(rawContent).find(section => section.scriptBlock)?.contentId;
  if (!blockContentId) throw new Error('No workout content id in session fixture');

  await page.evaluate(async ({ dbName, sessionId, noteId, fixture, blockId, blockVersion, blockContentId }) => {
    const { promise: dbPromise, resolve: resolveDb, reject: rejectDb } = Promise.withResolvers<IDBDatabase>();
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolveDb(request.result);
    request.onerror = () => rejectDb(request.error);
    const db = await dbPromise;
    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const tx = db.transaction(['notes', 'block_revisions', 'block_index', 'sessions', 'events'], 'readwrite');
      const now = Date.now();
      tx.objectStore('notes').put(fixture.note);
      for (const row of fixture.revisions) tx.objectStore('block_revisions').put(row);
      for (const row of fixture.index) tx.objectStore('block_index').put(row);
      tx.objectStore('sessions').put({
        id: sessionId,
        noteId,
        blockId,
        blockVersion,
        blockContentId,
        startTime: now - 74_000,
        endTime: now,
        duration: 74_000,
        completed: true,
        status: 'completed',
        createdAt: now,
      });
      tx.objectStore('events').put({
        id: `${sessionId}:0`,
        resultId: sessionId,
        noteId,
        blockId,
        blockVersion,
        blockContentId,
        timestamp: now,
        grain: 'event',
        outputType: 'segment',
        effortSlug: 'kettlebell-swing',
        metrics: [{ type: 'tis', value: 74, unit: 's', metadata: { canonicalKey: 'tis' } }],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      await promise;
    } finally {
      db.close();
    }
  }, {
    dbName: WOD_DB,
    sessionId: SESSION_ID,
    noteId: NOTE_ID,
    fixture,
    blockId: workout.id,
    blockVersion: workout.version,
    blockContentId,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
  await seedSession(page);
});

test('session details filter a results table and seed dashboard composition with the same WQL', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/results/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });

  const table = page.getByTestId('property-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody')).toContainText('kettlebell-swing');

  const filteredQuery = `:session{result:${SESSION_ID},plane:segment,effort:kettlebell-swing}`;
  const editor = page.getByTestId('stream-query-bar').getByLabel('WQL', { exact: true });
  await editor.fill(filteredQuery);
  await expect(page).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(filteredQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  await page.getByTestId('save-stream-query').click();
  await expect(page.getByTestId('widget-composer-subset')).toHaveText(filteredQuery);
  await expect(page.getByTestId('widget-composer-wql')).toHaveText(filteredQuery);
  await expect(page.getByTestId('widget-composer-apply')).toBeEnabled();
  await page.screenshot({ path: '/tmp/session-results-dashboard.png', fullPage: true });
});

test('session details use the results table on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/results/${SESSION_ID}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('property-table')).toBeVisible();
  await expect(page.getByTestId('property-table').locator('tbody')).toContainText('kettlebell-swing');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/session-results-mobile.png', fullPage: true });
});
