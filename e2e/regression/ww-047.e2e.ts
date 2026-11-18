/**
 * WW-047 — notebook library card count excludes the notebook's own landing note — contradicts the detail page stream count (low)
 *
 * Regression test for the open QA defect WW-047 (notebook-card-count-excludes-landing).
 * Expected behavior: the /notebooks library card count for a notebook equals the
 * number of notes its detail page stream shows, landing note included — a fresh
 * notebook ships exactly one landing note, so its card must read "1 note".
 * Current defect: feedCatalog.listCatalogNotebooks skips the landing note when
 * counting (feedCatalog.ts), so the card under-reports by one versus the detail
 * page stream, which does show the landing note.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-13-ondemand-163801).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

const NB_NAME = 'Count Club 2099';
const NB_SLUG = 'count-club-2099';

test.describe('WW-047 — notebook card count includes the landing note', () => {
  test('WW-047: library card count matches the notebook detail stream count', async ({ app }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    // Pin the library to the feed layout so the card subtitle (with the count)
    // is rendered, mirroring notebook-hierarchy-and-crud.e2e.ts.
    await app.wql.setStreamLayout('/notebooks', 'feed');

    // A fresh user notebook ships exactly one note: its landing note.
    await app.notebooks.openLibrary();
    await app.notebooks.create(NB_NAME);
    await expect(app.page).toHaveURL(new RegExp(`/notebook/${NB_SLUG}$`));

    // Library card: read the "N note(s)" subtitle off the notebook's row.
    await app.notebooks.openLibrary();
    const row = app.page
      .locator(`[data-testid="${TEST_IDS.LIBRARY_ROW_NOTEBOOK}"]`)
      .filter({ has: app.page.getByRole('heading', { name: NB_NAME }) })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rowText = await row.innerText();
    const countMatch = rowText.match(/(\d+)\s+notes?\b/);
    expect(countMatch, `notebook card shows a note count (row text: ${rowText})`).not.toBeNull();
    const cardCount = Number(countMatch![1]);

    // Detail page: the stream shows the landing note as a real note entry.
    await app.notebooks.openNotebook(NB_SLUG);
    const stream = app.page.getByTestId(TEST_IDS.STREAM_VIEW);
    await expect(stream).toContainText(NB_NAME, { timeout: 15_000 });
    const detailCount = await stream.locator('[data-testid="library-row-note"]').count();
    expect(detailCount, 'detail stream lists the landing note').toBe(1);

    // The two surfaces must agree.
    expect(cardCount, 'library card count equals detail stream count').toBe(detailCount);
  });
});
