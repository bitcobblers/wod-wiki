/**
 * WW-019 — Boot/import readiness contract still broken: cold-boot bare-'loading' stalls, ready-at-partial-stream-total, and sample-data import runs 'ready' with importPending=false (high)
 *
 * Regression test for the open QA defect WW-019 (ready-before-seed-import-settles).
 * Expected behavior: there is a single settled readiness contract — the app must not
 * declare data-feed-state 'ready' while a feed import is still pending, must never
 * report 'ready' alongside a partial stream total, must not sit on a bare 'loading'
 * surface during cold boot, and a sample-data import must surface as a loading state
 * (agent view-state status 'loading' / importPending=true) while it runs.
 * Current defect: feedReadiness.ts markFeedFirstPaint flips the app to 'ready' before
 * full corpus hydration and the sessions commit land, so cold /efforts can report
 * ready at a partial totalUnbatchedCount after a long bare-'loading' stall, and the
 * analytics sample-data import runs while the agent contract still says ready with
 * importPending=false.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/playgroundActor';
import { WOD_DB } from '../helpers/wodwikiDb';

interface BootSample {
  t: number;
  state: string | null;
  pending: string | null;
  total: number | null;
  body: string;
}

interface AgentViewState {
  status: string | null;
  importPending: boolean | null;
}

async function countStore(page: Page, store: string): Promise<number> {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).count();
          req.onsuccess = () => resolve(req.result);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: WOD_DB, storeName: store },
  );
}

async function readViewState(page: Page): Promise<AgentViewState | null> {
  return page.evaluate(() => {
    const el = document.getElementById('agent-view-state');
    if (!el?.textContent) return null;
    const parsed = JSON.parse(el.textContent) as { status?: string; importPending?: boolean };
    return { status: parsed.status ?? null, importPending: parsed.importPending ?? null };
  });
}

test.describe('WW-019 — boot/import readiness contract', () => {
  test('WW-019: cold boot never declares ready at a partial stream total, while import is pending, or after a bare-loading stall @cold-boot', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;

    // Sample the readiness contract every 100ms from the very first document:
    // <html> data-feed-state / data-feed-import-pending, the agent view-state
    // stream total, and the visible body text (bare-'loading' detection).
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
      const samples: BootSample[] = [];
      (window as unknown as { __ww019Samples: BootSample[] }).__ww019Samples = samples;
      window.setInterval(() => {
        if (samples.length > 1200) return;
        let total: number | null = null;
        const el = document.getElementById('agent-view-state');
        if (el?.textContent) {
          try {
            const parsed = JSON.parse(el.textContent) as {
              stream?: { totalUnbatchedCount?: number | null };
            };
            total = parsed.stream?.totalUnbatchedCount ?? null;
          } catch {
            total = null;
          }
        }
        samples.push({
          t: performance.now(),
          state: document.documentElement.dataset.feedState ?? null,
          pending: document.documentElement.dataset.feedImportPending ?? null,
          total,
          body: (document.body?.innerText ?? '').trim(),
        });
      }, 100);
    });

    await page.goto('/efforts', { waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();

    // Ground truth: how many effort rows the import actually committed.
    const finalEffortCount = await countStore(page, 'efforts');
    expect(finalEffortCount).toBeGreaterThan(0);
    // Let any still-growing total settle so samples are judged against the final corpus.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const el = document.getElementById('agent-view-state');
            if (!el?.textContent) return null;
            const parsed = JSON.parse(el.textContent) as {
              stream?: { totalUnbatchedCount?: number | null };
            };
            return parsed.stream?.totalUnbatchedCount ?? null;
          }),
        { timeout: 30_000 },
      )
      .toBe(finalEffortCount);

    const samples = await page.evaluate(
      () => (window as unknown as { __ww019Samples: BootSample[] }).__ww019Samples,
    );
    expect(samples.some((s) => s.state === 'ready')).toBe(true);

    // 'ready' must never be reported while the feed import is still pending.
    const readyWhilePending = samples.filter((s) => s.state === 'ready' && s.pending === 'true');
    expect(
      readyWhilePending,
      `data-feed-state flipped to 'ready' while data-feed-import-pending was still set (${readyWhilePending.length} samples)`,
    ).toEqual([]);

    // 'ready' must never be reported alongside a partial stream total.
    const readyAtPartial = samples.filter(
      (s) => s.state === 'ready' && s.total !== null && s.total !== finalEffortCount,
    );
    expect(
      readyAtPartial.map((s) => s.total),
      `stream total was still partial when the app already reported 'ready' (final total ${finalEffortCount})`,
    ).toEqual([]);

    // Cold boot must not stall on a bare 'loading' surface (>= 1s of samples
    // whose entire visible text is just 'loading').
    let bareRun = 0;
    let maxBareRun = 0;
    for (const s of samples) {
      bareRun = s.body.toLowerCase() === 'loading' ? bareRun + 1 : 0;
      maxBareRun = Math.max(maxBareRun, bareRun);
    }
    expect(
      maxBareRun,
      `cold boot stalled on a bare 'loading' surface for ~${(maxBareRun / 10).toFixed(1)}s`,
    ).toBeLessThan(10);
  });

  test('WW-019 (path 2): sample-data import reports a loading state with importPending=true while it runs', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;

    await app.goto('/dashboards?q=sum%3AtotalVolume%7B%7D+by+%7Bweek%7D');
    const sampleBtn = page.getByRole('button', { name: /Preview with sample data/i });
    await expect(sampleBtn).toBeVisible({ timeout: 15_000 });

    // Record every agent view-state transition while the import runs.
    const transitions: AgentViewState[] = [];
    const pushState = (state: AgentViewState | null): void => {
      if (!state) return;
      const last = transitions[transitions.length - 1];
      if (!last || last.status !== state.status || last.importPending !== state.importPending) {
        transitions.push(state);
      }
    };
    pushState(await readViewState(page));

    await sampleBtn.click();
    const purgeBtn = page.getByRole('button', { name: /Purge sample data/i });
    // Sample the view state on a tight poll for the whole import window.
    await expect
      .poll(
        async () => {
          pushState(await readViewState(page));
          return purgeBtn.isVisible().catch(() => false);
        },
        { timeout: 30_000, intervals: [50] },
      )
      .toBe(true);
    await expect(purgeBtn).toBeVisible({ timeout: 15_000 });

    expect(
      transitions.some((s) => s.status === 'loading' || s.importPending === true),
      `sample-data import ran without the agent contract ever reporting a loading state (transitions: ${JSON.stringify(transitions)})`,
    ).toBe(true);
  });
});
