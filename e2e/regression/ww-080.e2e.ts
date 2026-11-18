/**
 * WW-080 — Create Note dialog 'Start from' template combobox dumps ~1,355 unsorted corpus notes as native <option> rows (low)
 *
 * Regression test for the open QA defect WW-080 (create-note-template-select-1357-options).
 * Expected behavior: the Create Note dialog's 'Start from' template picker is
 * a bounded, scalable control (searchable / grouped / capped) — it must not
 * pour the entire bundled corpus into one native <select> as ~1,355 unsorted
 * <option> rows.
 * Current defect: CreateJournalNoteDialog renders every script-notebook item
 * from getScriptNotebooks() as a native <option> inside
 * select#journal-create-template, so the option count grows with the whole
 * corpus (~1,355 rows on the live build).
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

// Generous ceiling for a bounded picker: the bundled "Your Notebook Notes"
// group plus a curated starter set fits far below this; the corpus dump
// (~1,355) exceeds it by an order of magnitude.
const MAX_TEMPLATE_OPTIONS = 100;

test.describe('WW-080 — Create Note template picker stays bounded', () => {
  test('WW-080: the Start from template select does not dump the whole corpus as options', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/journal');

    // Open the unified Create dialog and switch to the Note form (same entry
    // point as new-entry-combo.e2e.ts).
    await app.page.getByTestId(TEST_IDS.NEW_ENTRY_PRIMARY).click();
    const dialog = app.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByTestId('new-entry-note').click();

    const control = dialog.getByTestId('journal-create-template');
    await expect(control, "'Start from' template control is present").toBeVisible({
      timeout: 15_000,
    });

    const tagName = await control.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
      // Template sources load in the background; wait until the picker has
      // populated beyond the lone "Blank note" row before measuring it.
      await expect
        .poll(() => control.locator('option').count(), { timeout: 20_000 })
        .toBeGreaterThan(1);

      const optionCount = await control.locator('option').count();
      expect(
        optionCount,
        `template picker exposes ${optionCount} native options — a bounded picker stays at or under ${MAX_TEMPLATE_OPTIONS}`,
      ).toBeLessThanOrEqual(MAX_TEMPLATE_OPTIONS);
    } else {
      // Searchable combobox or custom picker: open if collapsed, then verify
      // the rendered item/option count stays bounded.
      const isExpanded = await control.getAttribute('aria-expanded');
      if (isExpanded === 'false') {
        await control.click();
      }
      const renderedCount = await app.page
        .locator('[role="option"], [data-radix-collection-item]')
        .count();
      expect(
        renderedCount,
        `template picker renders ${renderedCount} items/options — a bounded picker stays at or under ${MAX_TEMPLATE_OPTIONS}`,
      ).toBeLessThanOrEqual(MAX_TEMPLATE_OPTIONS);
    }
  });
});
