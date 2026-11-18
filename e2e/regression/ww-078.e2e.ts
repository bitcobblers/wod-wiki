/**
 * WW-078 — Float-valued analytics readouts mix precision conventions on one panel (10.46 min 2dp, 37.1 pts 1dp, 41 MET-min truncated int) (low)
 *
 * Regression test for the open QA defect WW-078 (float-readouts-mixed-precision).
 * Expected behavior: the Workout Complete panel applies ONE precision
 * convention to its float-valued readouts — every readout on the panel shows
 * the same number of decimal places, per a single panel-level policy.
 * Current defect: per-metric formatters pick precision per metric type with no
 * panel-level convention (formatMetricAmount rounds to 1dp while duration and
 * pace render 2dp and MET-min truncates to an integer), so one panel shows
 * '10.46 min', '21.51 reps/min', '37.1 pts', '41 MET-min', '15 AU' side by side.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

const NOTE_ID = 'playground/ww-078-float-panel';
const NOTE_CONTENT = [
  '# WW-078 Float Panel',
  '',
  '```time',
  'Timer: 10:00',
  '  10 Kettlebell Swings 24kg',
  '```',
  '',
].join('\n');

/** Float readouts in the families the ledger repro lists for the Complete panel. */
const READOUT_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(reps\/min|MET-min|pts|AU|min)\b/g;

test.describe('WW-078 — Workout Complete panel float precision convention', () => {
  test('WW-078: every float readout on the Workout Complete panel uses one decimal-place convention', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // Drive a real (fast-clock) run to the Complete panel, the established way
    // to reach this surface; the defect is formatter-driven, so any completed
    // loaded workout that surfaces the readout families reproduces it.
    await app.runtime.useFastClock(60);
    await app.seed.note(NOTE_ID, NOTE_CONTENT, { type: 'playground', title: 'WW-078 Float Panel' });
    await page.goto(`/${NOTE_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-content')).toContainText('Kettlebell Swings', {
      timeout: 15_000,
    });

    const play = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(play).toBeVisible({ timeout: 15_000 });
    await play.click();
    await page.waitForURL(/\/(day|tracker|run)\//, { timeout: 15_000 });

    const dialog = page.getByRole('dialog', { name: 'Workout Complete' });
    const nextBtn = page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first();
    // Advance block by block (fast clock) until the Complete dialog lands.
    await expect
      .poll(
        async () => {
          if (await dialog.isVisible().catch(() => false)) return true;
          if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click().catch(() => {});
          }
          return false;
        },
        { timeout: 30_000, intervals: [750] },
      )
      .toBe(true);
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    const panelText = await dialog.innerText();
    const readouts = [...panelText.matchAll(READOUT_PATTERN)].map((m) => ({
      raw: m[0],
      value: m[1]!,
      unit: m[2]!,
    }));
    expect(
      readouts.length,
      `expected at least 3 float readouts on the Complete panel, saw: ${panelText.slice(0, 400)}`,
    ).toBeGreaterThanOrEqual(3);

    const decimalPlaces = new Set(
      readouts.map((r) => (r.value.split('.')[1] ?? '').length),
    );
    expect(
      decimalPlaces.size,
      `readouts mix precision conventions: ${readouts.map((r) => r.raw).join(' | ')}`,
    ).toBe(1);
  });
});
