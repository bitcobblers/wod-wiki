/**
 * WW-056 — Benchmark PR Board widgets all 'No data for this range.' — sessions store = 0 after ready import (high)
 *
 * Regression test for the open QA defect WW-056 (sample-events-null-plane-effort).
 * Expected behavior: once sample data is loaded, the Benchmark PR Board's
 * widgets render data — the sample corpus carries benchmark-tagged notes and
 * session-level benchmark effort facts (e.g. Fran), so no widget settles on
 * 'No data for this range.'.
 * Current defect: the seed/sample import writes zero sessions rows against the
 * bare corpus, sample notes are tagged only 'sample' (never 'benchmark'), and
 * buildFran produces no session-level effortSlug — so all 5 board widgets
 * render 'No data for this range.' on a board whose queries can never match.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';
import type { Page } from '@playwright/test';
import { loadSampleData } from './helpers';

async function sessionsStoreCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('wodwiki-db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const req = db.transaction('sessions', 'readonly').objectStore('sessions').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  });
}

test.describe('WW-056 — Benchmark PR Board populates from sample data', () => {
  test('WW-056: after sample import, no Benchmark PR Board widget settles on "No data for this range."', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await loadSampleData(app);

    // The sample-import half of the pipeline does land sessions in the store;
    // the defect is that the board's queries can never see them.
    await expect
      .poll(() => sessionsStoreCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);

    await app.wql.openDashboard('benchmark-pr-board');
    await expect(
      page.getByRole('heading', { name: /Benchmark PR Board/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // All five widgets (Benchmark scores, Fran trend, Work capacity, Session
    // intensity, Training consistency) must settle with data.
    await expect
      .poll(async () => page.getByText('No data for this range.').count(), {
        timeout: 20_000,
      })
      .toBe(0);

    const franWidget = page.locator(
      'xpath=//h3[normalize-space()="Fran trend"]/ancestor::div[contains(@class,"bg-card")][1]',
    );
    await expect(franWidget).not.toContainText('No data for this range.');
  });

  test('WW-056 (reactivity): clicking Preview with sample data directly on Benchmark PR Board populates all 5 widgets without reload', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.wql.openDashboard('benchmark-pr-board');
    await expect(
      page.getByRole('heading', { name: /Benchmark PR Board/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const sampleBtn = page.getByRole('button', { name: /Preview with sample data/i });
    await expect(sampleBtn).toBeVisible({ timeout: 15_000 });
    await sampleBtn.click();

    await expect(page.getByRole('button', { name: /Purge sample data/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () => page.getByText('No data for this range.').count(), {
        timeout: 20_000,
      })
      .toBe(0);
  });
});
