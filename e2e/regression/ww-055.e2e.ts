/**
 * WW-055 — Settings→Storage 'Export Feed Repository (.zip)' is a silent no-op on the happy path (public notebook present) — no blob, no toast, no error, no console after 36s (high)
 *
 * Regression test for the open QA defect WW-055 (feed-repo-export-silent-noop).
 * Expected behavior: with a public notebook present, clicking 'Export Feed
 * Repository (.zip)' in Settings → Storage downloads wod-wiki-feed-repository.zip
 * and shows the 'Exported wod-wiki-feed-repository.zip' toast.
 * Current defect: the click is a silent no-op on the happy path — no download,
 * no toast, no error, nothing in the console even after 36s (DataSection.tsx
 * runAction('pub-zip') → ExportImportService.exportFeedRepositoryZip never
 * produces the blob). This defect is also what blocks the WW-044 round-trip
 * repro through the Settings surface.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import { test, expect } from '../fixtures/playgroundActor';

const NOTE_ID = '01950000-0000-7000-8000-000000000955';
const NOTEBOOK_SLUG = 'ww055-public';
const CONTENT = '# WW055 Export Source\n\n```time\n(5)\n  12 Deadlifts\n  9 Hang Power Cleans\n```\n';

test.describe('WW-055 — Settings → Storage Export Feed Repository (.zip)', () => {
  test('WW-055: exporting the feed repository with a public notebook present downloads the .zip and toasts', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // The happy path from the repro: a public notebook with a public note.
    await app.seed.world({
      notes: [{ id: NOTE_ID, title: 'WW055 Export Source', rawContent: CONTENT, seedOrigin: 'user' }],
    });
    await app.seed.notebook(NOTEBOOK_SLUG, { title: 'WW055 Public' });
    await app.editor.openNote(NOTE_ID);
    await app.notebooks.promoteNote([NOTEBOOK_SLUG]);
    await app.notebooks.setNotebookPublic(NOTEBOOK_SLUG, true);
    await app.feeds.expectPublicationVisibility('Published Note');

    await app.goto('/settings/storage');
    const exportBtn = page.getByTestId('data-export-feed-repo-zip');
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });

    // With the defect this wait times out: no blob is ever produced.
    const downloadPromise = page.waitForEvent('download', { timeout: 25_000 });
    await exportBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('wod-wiki-feed-repository.zip');

    await expect(page.getByText('Exported wod-wiki-feed-repository.zip')).toBeVisible({
      timeout: 10_000,
    });
  });
});
