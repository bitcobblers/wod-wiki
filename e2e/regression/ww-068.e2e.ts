/**
 * WW-068 — Live timer chip accessible names leak raw values — resistance 'Value: [object Object]' (prior), now also Up-Next duration 'Value: 1200000 Origin: parser' and effort 'Value: AMRAP' (low)
 *
 * Regression test for the open QA defect WW-068 (resistance-chip-label-object-object).
 * Expected behavior: metric chips on the timer surfaces expose formatted,
 * human-readable values in their tooltips/accessible names — a resistance
 * reads as a weight (e.g. 95 lb), a duration as a clock time — never raw
 * internal values.
 * Current defect: labelFormatting.ts buildTooltip interpolates metric.value
 * verbatim, so object values render as '[object Object]' and durations as raw
 * milliseconds ('Value: 1200000'); MetricVisualizer and OutputStatementsTable
 * surface that string as the chip title/accessible name.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import type { Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

/** All chip tooltips currently in the DOM (buildTooltip strings start 'Type: …'). */
async function chipTitles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[title]'))
      .map((el) => el.getAttribute('title') ?? '')
      .filter((t) => t.includes('Type:')),
  );
}

function expectNoRawLeaks(titles: string[], surface: string): void {
  expect(titles.length, `${surface}: metric chips are rendered`).toBeGreaterThan(0);
  for (const title of titles) {
    expect(title, `${surface}: no chip leaks an object value`).not.toContain('[object Object]');
    expect(title, `${surface}: no chip leaks a raw millisecond value`).not.toMatch(
      /Value: \d{5,}/,
    );
  }
}

test.describe('WW-068 — timer chip labels format metric values', () => {
  test('WW-068: gate and live chips never expose [object Object] or raw millisecond values', async ({
    app,
  }) => {
    test.setTimeout(90_000);
    await app.runtime.useFastClock(20);
    await app.seed.note(
      'regression-chip-probe-2099',
      '# Chip Probe 2099\n\n```time\n20:00 AMRAP\n  21 Thrusters 95lb\n```\n',
      { title: 'Chip Probe 2099' },
    );
    await app.editor.openNote('regression-chip-probe-2099');

    // Gate ("Ready to Start"): the Up Next chips carry the 20:00 duration —
    // QA captured 'Type: duration Value: 1200000 Origin: parser' here.
    await app.runtime.startWorkout();
    await expect(app.page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(() => chipTitles(app.page).then((t) => t.length), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expectNoRawLeaks(await chipTitles(app.page), 'gate');

    // Live block: the Thrusters statement's resistance chip — QA captured
    // 'Type: resistance Value: [object Object] Origin: parser' here.
    await app.runtime.advance(1);
    await expect
      .poll(
        () =>
          chipTitles(app.page).then((titles) =>
            titles.some((t) => t.startsWith('Type: resistance')),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    const liveTitles = await chipTitles(app.page);
    expectNoRawLeaks(liveTitles, 'live');
    const resistance = liveTitles.find((t) => t.startsWith('Type: resistance'));
    expect(resistance, 'resistance chip formats the load as a weight').toContain('95');
    expect(resistance, 'resistance chip formats the load as a weight').toContain('lb');

    // Tidy exit; assertions above are the test.
    await app.page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first().click();
  });
});
