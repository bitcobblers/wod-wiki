/**
 * WW-084 — Explorer empty-state 'Log your first workout' CTA links to retired /collections which renders 'Page not found' — dead end for the primary new-user CTA (medium)
 *
 * Regression test for the open QA defect WW-084 (sample-prompt-cta-dead-collections-route).
 * Expected behavior: the 'Log your first workout' call-to-action in the
 * sample-data empty state points at a live logging route (e.g. /day/<today>
 * or /journal), and following it lands on that surface — never on a
 * 'Page not found' dead end.
 * Current defect: SampleDataPrompt hardcodes <Link to="/collections">, and
 * /collections has no route, so the primary new-user CTA on the empty
 * Benchmark PR Board lands on an h1 'Page not found'.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-084 — "Log your first workout" CTA resolves to a live route', () => {
  test('WW-084: the empty-board CTA links to a live logging route and lands there', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // No sample import: the bare corpus leaves the board empty (WW-056), which
    // is exactly the state in which the SampleDataPrompt card renders the CTA.
    await app.wql.openDashboard('benchmark-pr-board');

    const cta = page.getByRole('link', { name: 'Log your first workout' }).first();
    await expect(cta).toBeVisible({ timeout: 15_000 });

    const href = await cta.getAttribute('href');
    expect(href, 'CTA must not target the retired /collections route').not.toBe('/collections');
    expect(href, `CTA href '${href}' must be a live logging route`).toMatch(
      /^\/(day|journal)\b/,
    );

    await cta.click();
    await expect(page).not.toHaveURL(/\/collections$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
  });
});
