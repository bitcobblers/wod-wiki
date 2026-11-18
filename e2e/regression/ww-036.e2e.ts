/**
 * WW-036 — Unfiltered /notes still full-corpus detail-hydrates — 7.8-14.7s ready gates across all three workers on a ~1640-note corpus (medium)
 *
 * Regression test for the open QA defect WW-036 (notes-unfiltered-full-detail-hydration-residual).
 * Expected behavior: navigating to the unfiltered /notes library reaches its full
 * 'N of N' ready state within the ready-gate budget (5s for an in-app navigation
 * once the boot import has settled) — the list read must be bounded or served
 * from a denormalized stream-summary store, not a full-corpus detail scan.
 * Current defect: listNotes → getRecords runs a full-corpus {plan:'detail'} scan,
 * so the /notes ready gate measured 7,824ms (analytics, full page), 14,651ms
 * (properties, SPA nav /efforts → /notes), and 11,772ms (runtime) on the
 * ~1,640-note corpus.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/playgroundActor';
import { WOD_DB } from '../helpers/wodwikiDb';

// ANL-05 Scenario 2 ready-gate budget extension: with the boot import settled,
// an in-app navigation to /notes should be near-instant once the detail read is
// bounded; 5s is the generous end of that budget. Observed defect: 7.8–14.7s.
const READY_GATE_BUDGET_MS = 5_000;

async function countNotes(page: Page): Promise<number> {
  return page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').count();
        req.onsuccess = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, WOD_DB);
}

test.describe('WW-036 — unfiltered /notes ready gate', () => {
  test('WW-036: in-app navigation to unfiltered /notes reaches the full total within the ready-gate budget', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // Settle the boot import first (the bundled corpus this defect needs), then
    // start from /efforts — the properties repro path was SPA nav /efforts → /notes.
    await app.goto('/');
    await app.goto('/efforts');
    const total = await countNotes(page);
    expect(total).toBeGreaterThan(1_000);

    const strip = page.getByTestId('stream-query-status');
    const started = Date.now();
    await page.locator('a[href="/notes"]').first().click();
    await expect(page).toHaveURL(/\/notes/);

    // Ready = the query truth strip reports the full corpus total, not
    // 'Searching…' and not a partial count.
    await expect
      .poll(
        async () => {
          const text = (await strip.textContent().catch(() => null)) ?? '';
          const match = /(\d+) of (\d+)/.exec(text);
          if (!match) return false;
          return Number(match[1]) === total && Number(match[2]) === total;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const elapsedMs = Date.now() - started;

    expect(
      elapsedMs,
      `unfiltered /notes ready gate took ${elapsedMs}ms on a ${total}-note corpus (budget ${READY_GATE_BUDGET_MS}ms; defect measured 7.8–14.7s)`,
    ).toBeLessThan(READY_GATE_BUDGET_MS);
  });
});
