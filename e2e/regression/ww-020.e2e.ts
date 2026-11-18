/**
 * WW-020 — User-authored notes silently deleted within seconds of creation by the boot/feed import cycle — now 7 reproductions across journal and runtime authoring paths (critical)
 *
 * Regression test for the open QA defect WW-020 (reload-boot-sync-wipes-user-data).
 * Expected behavior: notes authored through the day page ('Create a note' and
 * '+ Add' → Create) are committed to the notes store and survive navigation and a
 * full page reload — the day page keeps showing them and their content stays
 * readable from the store.
 * Current defect: in the latest repro (analytics, 2026-11-18 nightly) two day-note
 * drafts created through the UI never landed in the notes store at all — the count
 * stayed static across 10–12s debounce waits, navigation, and a full reload while
 * sync_outbox grew with undrained 'notes' ops and the day page stayed at '0 notes'.
 * The live repro is timing/environment-dependent (same-session runtime and
 * properties probes survived), so this test drives the exact authoring flow and
 * asserts the persistence invariant unconditionally.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

const DATE = '2099-08-03';

/** Create one note on the day page via the create dialog and type prose into it. Returns the new note's id. */
async function createDayNote(
  page: Page,
  trigger: 'empty-state' | 'add-button',
  title: string,
  prose: string,
): Promise<string> {
  if (trigger === 'empty-state') {
    await page.getByRole('button', { name: 'Create a note' }).click();
  } else {
    await page.getByRole('button', { name: '+ Add note' }).click();
  }
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/Title/).fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();

  // Creation navigates to the canonical single-note editor.
  await page.waitForURL(/\/note\//, { timeout: 15_000 });
  const noteId = decodeURIComponent(new URL(page.url()).pathname.replace(/^\/note\//, ''));
  expect(noteId).toBeTruthy();

  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.type(prose);
  await page.keyboard.press('Enter');
  return noteId;
}

test.describe('WW-020 — user-authored notes deleted by the boot/feed import cycle', () => {
  test('WW-020: two notes authored on a day page land in the notes store and survive a full reload', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    const stamp = Date.now();
    const titleOne = `WW020 Draft One ${stamp}`;
    const titleTwo = `WW020 Draft Two ${stamp}`;
    const proseOne = `WW020 survival prose one ${stamp}`;
    const proseTwo = `WW020 survival prose two ${stamp}`;
    let noteOneId = '';
    let noteTwoId = '';

    try {
      await app.journal.clearDate(DATE);
      // Plain goto, not journal.openDate: the empty day page has no editor
      // surface for the page object's waitForLoad to attach to.
      await app.goto(`/day/${DATE}`);
      await expect(page.getByText('No Notes on this date yet.')).toBeVisible({ timeout: 15_000 });

      // Path 1: the empty-state 'Create a note' flow from the repro.
      noteOneId = await createDayNote(page, 'empty-state', titleOne, proseOne);

      // The write must actually land in the notes store — in the defect the
      // sync_outbox grows while the row never appears.
      await expect
        .poll(() => app.editor.readStoredContent(noteOneId), { timeout: 20_000 })
        .toContain(proseOne);

      // Path 2: the '+ Add' → Create flow from the same repro.
      await app.goto(`/day/${DATE}`);
      noteTwoId = await createDayNote(page, 'add-button', titleTwo, proseTwo);
      await expect
        .poll(() => app.editor.readStoredContent(noteTwoId), { timeout: 20_000 })
        .toContain(proseTwo);

      // Full reload of the day page: both notes are still listed (the defect
      // left the day page stuck at '0 notes').
      await app.goto(`/day/${DATE}`);
      await expect(page.getByText('2 notes', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(titleOne).first()).toBeVisible();
      await expect(page.getByText(titleTwo).first()).toBeVisible();

      // And both rows are still in the store after the reload/import cycle.
      await expect
        .poll(() => app.editor.readStoredContent(noteOneId), { timeout: 15_000 })
        .toContain(proseOne);
      await expect
        .poll(() => app.editor.readStoredContent(noteTwoId), { timeout: 15_000 })
        .toContain(proseTwo);
    } finally {
      if (noteOneId) await deleteNoteByRouteId(page, noteOneId).catch(() => {});
      if (noteTwoId) await deleteNoteByRouteId(page, noteTwoId).catch(() => {});
      await app.journal.clearDate(DATE).catch(() => {});
    }
  });
});
