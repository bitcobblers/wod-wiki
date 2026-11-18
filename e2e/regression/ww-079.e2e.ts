/**
 * WW-079 — Script Outline rows duplicate the movement name — dup surface shrank to the live Up-next/heading lines (gate outline rows clean this build) (low)
 *
 * Regression test for the open QA defect WW-079 (script-outline-duplicates-movement-name).
 * Expected behavior: the live Up-next line names the next movement exactly once —
 * "Up next: Thrusters 42.5 kg" — with no duplicated movement name.
 * Current defect: readNextPreviewText (SessionClockProjection) joins presentation
 * labels with no dedupe, so the live Up-next paragraph (and the live heading)
 * render "Up next: Thrusters Thrusters 42.5 kg" even though the gate Script
 * Outline rows were already fixed by the projection dedupe.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { startWorkoutFromPlayground } from '../pages/WallClockPage';

test.describe('WW-079 — live Up-next duplicates the movement name', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ app }) => {
    app.page.on('dialog', (d) => {
      void d.accept();
    });
  });

  test('WW-079: Up-next names the next movement once, not twice', async ({ app }) => {
    const { page } = app;
    await app.goto('/');

    await startWorkoutFromPlayground(
      page,
      'ww079-ladder',
      '```time\n21-15-9\n  Thrusters 42.5 kg\n```',
    );

    const upNext = page.getByTestId(TEST_IDS.TIMER_UP_NEXT_CAPTION).first();
    await expect(upNext).toBeVisible({ timeout: 10_000 });
    await expect(upNext).toContainText('Thrusters', { timeout: 10_000 });

    // The caption text must contain the movement name exactly once, and no
    // rendered text anywhere may carry the duplicated "Thrusters Thrusters".
    const captionText = (await upNext.innerText()).replace(/\s+/g, ' ');
    expect(captionText).toContain('Thrusters 42.5 kg');
    expect(captionText.match(/Thrusters/g)).toHaveLength(1);
    await expect(page.getByText(/Thrusters\s+Thrusters/)).toHaveCount(0);
  });
});
