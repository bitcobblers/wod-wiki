/**
 * WW-044 — Export→Import round-trip broken — repository-layout export prefixes every artifact 'dist/' while importFromZip skips 'dist/' paths (high)
 *
 * Regression test for the open QA defect WW-044 (feed-export-import-roundtrip-noop).
 * Expected behavior: a Feed Repository .zip produced by the app's own export can
 * be uploaded on /load and restores the exported notes — the export → import
 * round-trip is lossless at the note level.
 * Current defect: the repository-layout export writes every artifact under
 * 'dist/' (packages/engine/src/feed/publisher.ts), while importFromZip filters
 * out every path starting with 'dist/' (ExportImportService.ts), so importing
 * the app's own export silently imports nothing.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-14-nightly-060215).
 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

const NOTE_ID = '01950000-0000-7000-8000-000000000944';
const NOTE_TITLE = 'WW044 Roundtrip Benchmark';
const NOTEBOOK_SLUG = 'ww044-repo';
const CONTENT = [
  `# ${NOTE_TITLE}`,
  '',
  '```time',
  '(3)',
  '  15 Kettlebell Swings 24kg',
  '```',
  '',
].join('\n');

test.describe('WW-044 — feed export → import round-trip', () => {
  test('WW-044: importing the app’s own Feed Repository .zip on /load restores the exported note', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.seed.world({
      propertyNotes: [{ kind: 'effort', slug: 'kettlebell-swing', label: 'Kettlebell Swing' }],
      notes: [{ id: NOTE_ID, title: NOTE_TITLE, rawContent: CONTENT, seedOrigin: 'user' }],
    });
    await app.seed.notebook(NOTEBOOK_SLUG, { title: 'WW044 Repo' });

    try {
      // Publish the notebook so the repository export includes the note.
      await app.editor.openNote(NOTE_ID);
      await app.notebooks.promoteNote([NOTEBOOK_SLUG]);
      await app.notebooks.setNotebookPublic(NOTEBOOK_SLUG, true);
      await app.feeds.expectPublicationVisibility('Published Note');

      // Export the Feed Repository .zip through the publication popover and
      // keep the raw bytes for the import half of the round-trip.
      await app.feeds.openPromotionPopover();
      const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
      const downloadPromise = page.waitForEvent('download');
      await popover.getByTestId(TEST_IDS.PUBLICATION_EXPORT_REPO_ZIP_BTN).click();
      const download = await downloadPromise;
      const archivePath = await download.path();
      if (!archivePath) throw new Error('Playwright download path unavailable');
      const zipBuffer = readFileSync(archivePath);

      // Sanity: the export really is the repository layout (the defect's
      // export half prefixes every artifact with 'dist/').
      const exported = await JSZip.loadAsync(zipBuffer);
      const exportedFiles = Object.keys(exported.files).filter((name) => !exported.files[name]!.dir);
      expect(exportedFiles.length).toBeGreaterThan(0);
      expect(exportedFiles.every((name) => name.startsWith('dist/'))).toBe(true);

      // Purge the note so the import has to restore it from zero.
      await deleteNoteByRouteId(page, NOTE_ID);
      expect(await app.editor.readStoredContent(NOTE_ID)).toBeNull();

      // Import the app's own export on /load.
      await app.goto('/load');
      await expect(page.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeVisible();
      await page.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT).setInputFiles({
        name: 'wod-wiki-feed-repository.zip',
        mimeType: 'application/zip',
        buffer: zipBuffer,
      });

      // The note must come back — with the defect, every 'dist/' artifact is
      // skipped and the import restores nothing.
      await app.journal.expectNotePersisted(NOTE_ID, NOTE_TITLE);
      await expect
        .poll(() => app.editor.readStoredContent(NOTE_ID), { timeout: 15_000 })
        .toContain('Kettlebell Swings');
    } finally {
      await deleteNoteByRouteId(page, NOTE_ID).catch(() => {});
    }
  });
});
