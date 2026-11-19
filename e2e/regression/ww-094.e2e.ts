/**
 * WW-094 — count:note{} and by {month} bucket aggregation
 *
 * Regression test for QA defect WW-094 (wql-count-note-and-month).
 * Verifies /dashboards executes `count:note{}`, `count:note{} by {week}`,
 * and `count:note{} by {month}` against the note store cleanly without parse
 * errors or false-empty `"No data for this range."`.
 */
import { expect, test } from '../fixtures/playgroundActor';
import { seedNote, WOD_DB } from '../helpers/wodwikiDb';

test.describe('WW-094 — count:note{} and by {month} analytics queries', () => {
  test.setTimeout(120_000);

  test('WW-094: count:note{} renders scalar count and by {week} / by {month} render non-empty charts on /dashboards', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/');

    const now = Date.now();
    const olderTs = now - 35 * 86_400_000;
    await seedNote(page, 'ww094-month-1', '# WW094 Note 1\n\n```time\n10 Burpees\n```', {
      type: 'workout',
      title: 'WW094 Note 1',
    });
    await page.evaluate(
      async ({ dbName, id, ts }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(dbName);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('notes', 'readwrite');
            const store = tx.objectStore('notes');
            const getReq = store.get(id);
            getReq.onsuccess = () => {
              const row = getReq.result as Record<string, unknown> | undefined;
              if (row) {
                row.date = ts;
                row.createdAt = ts;
                store.put(row);
              }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { dbName: WOD_DB, id: 'ww094-month-1', ts: olderTs },
    );

    await seedNote(page, 'ww094-month-2', '# WW094 Note 2\n\n```time\n20 Air Squats\n```', {
      type: 'workout',
      title: 'WW094 Note 2',
    });

    await app.goto(`/dashboards?q=${encodeURIComponent('count:note{}')}`);
    await expect(page.getByText('No data for this range.')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/Query error:/i)).toHaveCount(0);
    await expect(page.getByText('count(note)')).toBeVisible({ timeout: 15_000 });

    await app.goto(`/dashboards?q=${encodeURIComponent('count:note{} by {week}')}`);
    await expect(page.getByText('No data for this range.')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/Query error:/i)).toHaveCount(0);

    await app.goto(`/dashboards?q=${encodeURIComponent('count:note{} by {month}')}`);
    await expect(page.getByText('No data for this range.')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/Query error:/i)).toHaveCount(0);
    await expect(page.locator('.recharts-wrapper, .recharts-surface').first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
