/**
 * WW-093 — Session card mislabels load as 'Volume: 42.5 kg' (kg = bar load, not volume); /sessions strip '2 of 2' vs 3-row sessions store (phantom rows uncounted) (low)
 *
 * Regression test for the open QA defect WW-093 (session-card-volume-load-mislabel).
 * Expected behavior: the /sessions card never labels the bar load as volume —
 * the chip either reads 'Load: 42.5 kg' or a Volume value actually computed as
 * load × reps — and the strip count ('N of N') reconciles with the number of
 * session rows in the store, including a halted in-progress session.
 * Current defect: entryMapper's 'Volume:' chip renders extractRunMetrics().loadLbs,
 * which falls back to segmentLoadTotal (the sum of per-segment loads, i.e. the
 * 42.5 kg bar load), duplicating the load value as 'Volume: 42.5 kg'; and the
 * strip total ignores hidden in-progress rows, showing '2 of 2' while the
 * sessions store holds 3 rows.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { advanceUntilReview, startWorkoutFromPlayground } from '../pages/WallClockPage';
import { clearSessions, getSessions } from '../utils/sessionsDb';

test.describe('WW-093 — session card volume mislabel and count reconciliation', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test("WW-093: card does not present the 42.5 kg bar load as 'Volume'", async ({ app }) => {
    const { page } = app;
    await app.runtime.useFastClock(20);
    await app.goto('/');
    await clearSessions(page);

    // The ledger's exact workout: 21-15-9 Thrusters at 42.5 kg (45 reps total).
    await startWorkoutFromPlayground(
      page,
      'ww093-volume',
      '```time\n21-15-9\n  Thrusters 42.5 kg\n```',
    );
    await advanceUntilReview(page, 12);
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();

    await app.goto('/sessions');
    const stream = page.getByTestId(TEST_IDS.STREAM_VIEW);
    await expect
      .poll(async () => (await stream.innerText()).includes('Thrusters'), { timeout: 15_000 })
      .toBe(true);
    const text = (await stream.innerText()).replace(/\s+/g, ' ');

    // The bar load is not volume. The defective chip reads 'Volume: 42.5 kg'.
    expect(text).not.toContain('Volume: 42.5 kg');

    // If a Volume chip is shown at all, it must be load × reps for the reps on
    // the same card — not the load value duplicated.
    const volumeMatch = text.match(/Volume: ([\d,]+(?:\.\d+)?) kg/);
    const repsMatch = text.match(/(\d+) reps/);
    if (volumeMatch && repsMatch) {
      const volume = Number(volumeMatch[1]!.replace(/,/g, ''));
      const reps = Number(repsMatch[1]);
      expect(volume).toBeCloseTo(42.5 * reps, 1);
    }
  });

  test('WW-093 (path 2): /sessions strip count reconciles with the sessions store', async ({ app }) => {
    const { page } = app;
    await app.runtime.useFastClock(20);
    await app.goto('/');
    await clearSessions(page);

    // Two completed sessions.
    for (const id of ['ww093-count-a', 'ww093-count-b']) {
      await startWorkoutFromPlayground(page, id, '```time\nTimer: 0:06\n5 Burpees\n```');
      await advanceUntilReview(page);
      await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
      await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({
        timeout: 10_000,
      });
    }

    // One halted session: reload mid-run leaves an in-progress/partial row in
    // the store (the ledger's phantom row).
    await startWorkoutFromPlayground(page, 'ww093-count-c', '```time\n20:00 AMRAP\n  10 Burpees\n```');
    await app.runtime.advance(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('halted-run-notice')).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => (await getSessions(page)).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);
    const storeCount = (await getSessions(page)).length;

    await app.goto('/sessions');
    const stream = page.getByTestId(TEST_IDS.STREAM_VIEW);
    // Strip reads '<matched> of <total>'; both must equal the store row count.
    // Defect: the hidden in-progress row is uncounted ('2 of 2' vs 3 rows).
    await expect
      .poll(
        async () => {
          const m = (await stream.innerText()).match(/(\d+) of (\d+)/);
          return m ? { matched: Number(m[1]), total: Number(m[2]) } : null;
        },
        { timeout: 15_000 },
      )
      .toEqual({ matched: storeCount, total: storeCount });
  });
});
