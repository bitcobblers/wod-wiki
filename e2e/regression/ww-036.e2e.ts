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

async function seedSyntheticNotes(page: Page, count: number): Promise<void> {
  await page.evaluate(
    async ({ dbName, targetAdd }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('notes', 'readwrite');
          const store = tx.objectStore('notes');
          const now = Date.now();
          for (let i = 0; i < targetAdd; i += 1) {
            const id = `ww036-synth-${String(i).padStart(4, '0')}`;
            store.put({
              id,
              title: `WW036 Corpus Note ${i}`,
              type: 'note',
              createdAt: now - i * 1000,
              rawContent: `# WW036 Corpus Note ${i}\n\n\`\`\`time\n10 Air Squats\n\`\`\`\n`,
              sourceRevision: 1,
              blocks: {},
              notebookId: 'notebook/journal',
              sourceId: 'journal',
              seedOrigin: 'user',
            });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, targetAdd: count },
  );
}

test.describe('WW-036 — unfiltered /notes ready gate', () => {
  test('WW-036: in-app navigation to unfiltered /notes reaches the full total within the ready-gate budget', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // Settle the boot import first; when sample feeds run in index-only mode,
    // seed synthetic local notes so the /notes scan still exercises >1,000 rows.
    await app.goto('/');
    if ((await countNotes(page)) < 1_050) {
      await seedSyntheticNotes(page, 1_050);
    }
    await app.goto('/efforts');
    const total = await countNotes(page);
    expect(total).toBeGreaterThan(1_000);

    await page.getByRole('button', { name: 'Pages', exact: true }).first().click();
    const notesBtn = page.getByRole('button', { name: 'Notes', exact: true }).first();
    await expect(notesBtn).toBeVisible({ timeout: 10_000 });
    const strip = page.getByTestId('stream-query-status');
    const started = Date.now();
    await notesBtn.click();
    await expect(page).toHaveURL(/\/notes/);

    // Ready = the query truth strip reports the full settled corpus scan, not
    // 'Searching…' and not a partial count (notebook landing notes are filtered out of :note{notebook:*}).
    await expect
      .poll(
        async () => {
          const text = (await strip.textContent().catch(() => null)) ?? '';
          const match = /(\d+) of (\d+)/.exec(text);
          if (!match) return false;
          const shown = Number(match[1]);
          const matchedTotal = Number(match[2]);
          return matchedTotal >= total && shown > 1_000;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready');
    const elapsedMs = Date.now() - started;

    expect(
      elapsedMs,
      `unfiltered /notes ready gate took ${elapsedMs}ms on a ${total}-note corpus (budget ${READY_GATE_BUDGET_MS}ms; defect measured 7.8–14.7s)`,
    ).toBeLessThan(READY_GATE_BUDGET_MS);
  });
});
