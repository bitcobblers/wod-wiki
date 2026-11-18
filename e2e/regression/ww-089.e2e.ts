/**
 * WW-089 — Shared /notes?q= link with space-separated words fails WQL parse — 'Invalid query — showing previous results' + unfiltered corpus (medium)
 *
 * Regression test for the open QA defect WW-089 (notes-q-plain-text-no-salvage).
 * Expected behavior: a shared /notes?q= link whose query is plain words
 * ("Dumbbell Day") is salvaged as a text search — the same plain-text parity
 * /efforts already has — and filters the stream instead of erroring.
 * Current defect: NOTES_STREAM_PROFILE has no plain-text salvageQ, so the
 * unparseable URL query falls to the rejection path: an "Invalid query —
 * showing previous results" strip over the full unfiltered corpus.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect } from '../fixtures/playgroundActor';

test.describe('WW-089 — Shared /notes?q= plain-text link', () => {
  test('WW-089: /notes?q=Dumbbell Day filters by text instead of showing the Invalid query strip unfiltered', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.seed.note('markdown/notes/dumbbell-day.md', '# Dumbbell Day\n\nDumbbell presses and rows.\n', {
      title: 'Dumbbell Day',
    });
    await app.seed.note('markdown/notes/barbell-club.md', '# Barbell Club\n\nBarbell squats only.\n', {
      title: 'Barbell Club',
    });

    // The shared-link form: plain words in ?q=, exactly as a copied link carries them.
    await app.wql.queryStream('/notes', 'Dumbbell Day');

    // No error strip: the query was understood, not rejected.
    await expect(page.getByText('Invalid query — showing previous results')).toHaveCount(0);

    // The stream is actually filtered: the matching note is in, the
    // unrelated note is out (with the defect both render, unfiltered).
    await app.wql.expectStreamContains('Dumbbell Day');
    await app.wql.expectStreamExcludes('Barbell Club');
  });
});
