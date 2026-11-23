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
    const rowSelector = `[data-testid="stream-feed-item"], [data-testid="${TEST_IDS.LIBRARY_ROW_NOTEBOOK}"]`;
    const findRow = () =>
      app.page
        .locator(rowSelector)
        .filter({ has: app.page.getByRole('heading', { name: NB_NAME }) })
        .first();
    const readCardCount = async (): Promise<number> => {
      const row = findRow();
      await expect(row).toBeVisible({ timeout: 15_000 });
      const rowText = await row.innerText();
      const countMatch = rowText.match(/(\d+)\s+notes?\b/);
      expect(countMatch, `notebook card shows a note count (row text: ${rowText})`).not.toBeNull();
      return Number(countMatch![1]);
    };
    const readDetailCount = async (): Promise<number> => {
      await app.notebooks.openNotebook(NB_SLUG);
      const stream = app.page.getByTestId(TEST_IDS.STREAM_VIEW);
      await expect(stream).toContainText(NB_NAME, { timeout: 15_000 });
      return stream.locator('[data-testid="library-row-note"], [data-testid="stream-feed-item"]').count();
    };

    // Landing note is excluded on both library card and detail stream (0 notes).
    const initialCardCount = await readCardCount();
    const initialDetailCount = await readDetailCount();
    expect(initialCardCount, 'fresh notebook card excludes its own landing note').toBe(0);
    expect(initialCardCount, 'library card count equals detail stream count when empty').toBe(
      initialDetailCount,
    );

    // Add 1 real note linked into the notebook -> both surfaces must agree at 1.
    await app.page.evaluate(async (nbId) => {
      const mc = (navigator as unknown as {
        modelContext: {
          executeTool(name: string, args: Record<string, unknown>): Promise<string>;
        };
      }).modelContext;
      await mc.executeTool('wod_note_upsert', {
        title: 'WW047 Member Note',
        content: '# WW047 Member Note\n\n```time\n10 Burpees\n```\n',
        notebookId: nbId,
      });
    }, `notebook/${NB_SLUG}`);
    await app.notebooks.openLibrary();
    const populatedCardCount = await readCardCount();
    const populatedDetailCount = await readDetailCount();
    expect(populatedCardCount, 'notebook card counts the linked note').toBe(1);
    expect(populatedCardCount, 'library card count equals detail stream count with 1 member note').toBe(
      populatedDetailCount,
    );
  });
});
