/**
 * WW-041 — Uploading a manifest-less/empty .zip on /load silently bounces to Home with zero import feedback (medium)
 *
 * Regression test for the open QA defect WW-041 (load-empty-zip-silent-bounce).
 * Expected behavior: uploading an empty (manifest-less) .zip on /load stays on
 * /load and surfaces the bundle import error — the same contract the corrupt-zip
 * path already honors — so the user learns nothing was imported.
 * Current defect: importFromZip returns { imported: 0, errors: [] } for an empty
 * archive, and LoadZipPage treats that as success: it toasts 'Imported 0 note(s)'
 * and navigates Home, leaving zero import feedback on the surface.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import JSZip from 'jszip';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('WW-041 — empty .zip upload on /load', () => {
  test('WW-041: uploading an empty .zip stays on /load and surfaces the import error', async ({
    app,
  }) => {
    const { page } = app;

    // A structurally valid zip with no entries at all — no manifest, no notes.
    const emptyZip = await new JSZip().generateAsync({ type: 'nodebuffer' });

    await app.goto('/load');
    await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();
    await page.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT).setInputFiles({
      name: 'empty-bundle.zip',
      mimeType: 'application/zip',
      buffer: emptyZip,
    });

    // The import surface must report that nothing importable was found…
    const errorAlert = page.getByTestId(TEST_IDS.BUNDLE_IMPORT_ERROR);
    await expect(errorAlert).toBeVisible({ timeout: 15_000 });
    await expect(errorAlert).toHaveAttribute('role', 'alert');

    // …and the user must stay on /load instead of being bounced to Home.
    await expect(page).toHaveURL(/\/load$/);
    await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();
  });
});
