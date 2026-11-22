/**
 * WW-092 — Workout Complete segment table leaks internal labels ('segm', 'Type: segment | #<uuid>:0 · Block: waiting-to-start · Reason: user-advance') and all split offsets persist as +00:00 with zero durations (medium)
 *
 * Regression test for the open QA defect WW-092 (segment-table-internal-label-leak).
 * Expected behavior: the recorded-outputs (segment) list on the results surface
 * shows human-readable segment titles, hover text free of internal identifiers
 * (no raw block keys, completion reasons, or 'Type: segment | #…' strings), and
 * real split offsets — segments after the first start later than +00:00.
 * Current defect: OutputStatementsTable renders the type chip as
 * String(outputType).slice(0, 4) ('segm') and exposes '#id · Block:
 * waiting-to-start · Reason: user-advance' verbatim as hover/title text, while
 * every offset renders +00:00 because split spans are never persisted (the
 * WW-051 data defect on the same events plane).
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';
import { startWorkoutFromPlayground } from '../pages/WallClockPage';
import { clearSessions, getSessions } from '../utils/sessionsDb';

test.describe('WW-092 — segment table internal-label leak', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-092: results segment list shows human titles, clean hover text, and real split offsets', async ({
    app,
  }) => {
    const { page } = app;
    await app.runtime.useFastClock(20);
    await app.goto('/');
    await clearSessions(page);

    await startWorkoutFromPlayground(page, 'ww092-segments', '```time\n(2)\n  5 Burpees\n  10 Squats\n```');
    await app.runtime.advance(2);
    await app.runtime.stopSession();
    await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible({
      timeout: 15_000,
    });

    await expect
      .poll(async () => (await getSessions(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    const session = (await getSessions(page))[0]!;

    // The durable results surface for the recorded session.
    await app.goto(`/results/${session.id}`);
    const splitsTable = page.locator('table').first();
    await expect(splitsTable).toBeVisible({ timeout: 15_000 });
    const splitsText = (await splitsTable.innerText()).replace(/\s+/g, ' ');
    expect(splitsText).not.toMatch(/\bsegm\b/);
    expect(splitsText).not.toContain('waiting-to-start');
    expect(splitsText).not.toContain('user-advance');

    // Switch to Tab 4 (Raw Events) where OutputStatementsTable renders segment outputs & split offsets.
    await page.getByRole('tab', { name: /Raw Events/i }).click();
    const outputs = page.locator(
      '[data-testid="output-statements-cards"], [data-testid="output-statements-table"]',
    ).first();
    await expect(outputs).toBeVisible({ timeout: 15_000 });
    const text = (await outputs.innerText()).replace(/\s+/g, ' ');

    // No truncated internal type label as a segment title.
    expect(text).not.toMatch(/\bsegm\b/);
    expect(text).not.toContain('waiting-to-start');
    expect(text).not.toContain('user-advance');

    // Hover/title attributes must not leak internal identifiers either.
    const leakyTitles = await outputs.evaluate((root) => {
      const bad: string[] = [];
      root.querySelectorAll('[title]').forEach((el) => {
        const t = el.getAttribute('title') ?? '';
        if (/Type: segment|Block:|Reason:|waiting-to-start|#[0-9a-f]{8}-[0-9a-f]{4}/i.test(t)) {
          bad.push(t);
        }
      });
      return bad;
    });
    expect(leakyTitles).toEqual([]);

    // Real split offsets: with several advanced segments, at least one split
    // starts after +00:00. Defect: every offset persists as +00:00.
    const offsets = [...text.matchAll(/\+(\d{2}):(\d{2})/g)].map(
      (m) => Number(m[1]) * 60 + Number(m[2]),
    );
    expect(offsets.length).toBeGreaterThanOrEqual(2);
    expect(offsets.some((s) => s > 0)).toBe(true);
  });
});
