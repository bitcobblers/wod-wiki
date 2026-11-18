/**
 * WW-072 — /subscribe probe failure surfaces raw browser error 'Failed to fetch' with no remediation hint (medium)
 *
 * Regression test for the open QA defect WW-072 (subscribe-probe-raw-fetch-error).
 * Expected behavior: when the feed-manifest probe fails at the network level, the
 * intake banner explains in plain language that the feed could not be reached and
 * tells the user what to do next (check the URL/connection, try again) — it never
 * shows the raw browser error string.
 * Current defect: FeedIntakeBanner stores `err.message` verbatim, so a failed
 * fetch renders the browser's raw TypeError text "Failed to fetch" with no hint.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

const BROKEN_SOURCE = 'https://unreachable.example.org/training/';

test.describe('WW-072 — /subscribe probe failure error copy', () => {
  test('WW-072: a failed feed probe shows a human-readable error with a remediation hint, not the raw browser error', async ({
    app,
  }) => {
    const { page } = app;

    // Network-level failure: aborting the manifest request makes fetch()
    // reject with the browser's raw TypeError ("Failed to fetch") — exactly
    // the string the defect leaks into the banner.
    await page.context().route(`${BROKEN_SOURCE}manifest.json`, (route) => route.abort('connectionrefused'));

    await page.goto(`/subscribe?source=${encodeURIComponent(BROKEN_SOURCE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText('Feed Probe Failed');

    // Correct behavior: no raw browser error text anywhere in the banner…
    await expect(banner).not.toContainText('Failed to fetch');

    // …and a next step the user can actually act on.
    await expect(banner).toContainText(
      /check (the )?(url|link|address|connection)|try again|could not reach|unable to reach|unreachable/i,
    );
  });
});
