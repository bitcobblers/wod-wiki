/**
 * WW-048 — note header shows a backlink chip for only one of two linked notebooks — N:M membership under-represented in the header (low)
 *
 * Regression test for the open QA defect WW-048 (note-header-single-backlink-chip).
 * Expected behavior: a note linked into two user notebooks (N:M NotebookLink
 * membership) shows a context/backlink entry for BOTH notebooks on its note page.
 * Current defect: collectionLinks() in noteContextLinks.tsx derives membership
 * only from the note's single primary notebookId (plus tags/sourceId) and never
 * reads the notebook_links rows, so the second linked notebook is missing from
 * the note's context navigation.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-13-ondemand-163801).
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-048 — N:M notebook membership fully represented on the note page', () => {
  test('WW-048: note context shows both linked notebooks, not just the primary one', async ({ app }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/');

    // One note, anchored in garage-crew-2099 (primary) and linked into
    // travel-wods-2099 via a second NotebookLink row — the NBK-02 N:M shape.
    const { noteId } = await app.seed.world({
      notes: [
        {
          id: 'note-nm-provenance-2099',
          title: 'N:M Provenance WOD 2099',
          rawContent: '# N:M Provenance WOD 2099\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n```\n',
          notebookIds: ['notebook/garage-crew-2099', 'notebook/travel-wods-2099'],
        },
      ],
    });

    await app.editor.openNote(noteId);
    await expect(app.page.locator('.cm-content').first()).toContainText('20:00 AMRAP', {
      timeout: 15_000,
    });

    // The note context navigation (Collections section fed by
    // collectionLinks) must carry an entry for each linked notebook.
    // Labels render as the notebook slug or its display name depending on
    // surface, so match either form.
    await expect(
      app.page.getByRole('button', { name: /garage-crew-2099|Garage Crew 2099/i }).first(),
      'primary notebook appears in the note context',
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      app.page.getByRole('button', { name: /travel-wods-2099|Travel Wods 2099/i }).first(),
      'second linked notebook appears in the note context',
    ).toBeVisible({ timeout: 15_000 });
  });
});
