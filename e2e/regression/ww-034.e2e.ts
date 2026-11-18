/**
 * WW-034 — WQL plain-text fallback on /efforts dead — bare words like 'kettlebell' parse as vacuous aggregates instead of engaging :effort{text:...} (low)
 *
 * Regression test for the open QA defect WW-034 (wql-invalid-no-syntax-hint).
 * Expected behavior: a bare word in the /efforts query bar engages the
 * plain-text fallback, filters the catalog, and shows NO parse alert — the
 * composer must not keep displaying its own 'Cannot parse' error for a query
 * the stream successfully ran in converted form.
 * Current defect: the fallback now filters correctly (residual defect), but a
 * stale [role=alert] 'Cannot parse "kettlebell". Expected agg:metric{filters}
 * by {dims} .rollup(period)' stays visible alongside the successful results,
 * because WqlComposer parses the raw draft independently of the stream's
 * converted query.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('WW-034 — plain-text fallback leaves no stale parse alert', () => {
  test('WW-034: bare word "kettlebell" filters /efforts with no "Cannot parse" alert left on screen', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.seed.bundledEfforts();

    const efforts = await app.properties.openEffort();
    await efforts.waitForCatalogLoaded();
    await expect(page.getByTestId(TEST_IDS.STREAM_QUERY_BAR)).toBeVisible();

    // The ledger repro typed the bare word into the query bar; the ?q= form
    // exercises the same composer-draft vs stream-run split.
    await app.wql.queryStream('/efforts', 'kettlebell');

    // The fallback half already works: the catalog narrows to kettlebell efforts.
    await expect(efforts.effortRow('kettlebell-swing')).toBeVisible({ timeout: 15_000 });
    await expect(efforts.effortRow('burpee')).toHaveCount(0);
    await expect(page.getByTestId('stream-query-status')).toContainText(':effort');

    // The residual defect: the composer's own parse of the raw draft keeps its
    // alert rendered next to the successful results. Correct behavior: none.
    await expect(
      page.getByRole('alert').filter({ hasText: /Cannot parse/i }),
      'no stale parse alert may accompany fallback-filtered results',
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('stream-query-status')).not.toContainText('Invalid query');
  });
});
