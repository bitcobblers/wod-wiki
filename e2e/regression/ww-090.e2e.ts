/**
 * WW-090 — Custom effort creation silently drops authored body prose — /effort/:slug?mode=create persists frontmatter only (medium)
 *
 * Regression test for the open QA defect WW-090 (custom-effort-create-body-dropped).
 * Expected behavior: body prose typed into the create-mode editor is persisted
 * with the new custom effort — it is in the stored note and renders on the
 * effort detail page, surviving reload (PRP-01 Scenario 4).
 * Current defect: the created effort's note is frontmatter-only (no body, no
 * createdAt/updatedAt); the authored prose never reaches the stored document
 * and the detail editor shows zero prose lines.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';

test.describe('WW-090 — Custom effort creation preserves body prose', () => {
  test('WW-090: prose typed in create mode persists in the stored note and on the detail page', async ({ app }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const slug = `sled-drive-${Date.now().toString().slice(-6)}`;
    // The exact prose from the QA repro.
    const prose = '10 Sled Drive (empty sled) QA effort';

    // Unknown slug -> not-found -> Create Effort Page (lands in ?mode=create).
    const missing = await app.properties.openEffort(slug);
    await expect(missing.detailNotFound()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND_CREATE_BTN).click();
    await expect(page).toHaveURL(new RegExp(`/effort/${slug}\\?mode=create$`));

    // Type the body prose at the end of the seeded create document, below the
    // frontmatter — the authoring path from the QA repro (typing in the note
    // editor, not a YAML-document replacement).
    const editor = page.locator('.cm-content[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(prose);

    await page.getByTestId('effort-create-btn').click();
    await expect(page).toHaveURL(new RegExp(`/effort/${slug}$`), { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL)).toBeVisible({ timeout: 15_000 });

    // The stored note carries the prose (with the defect it is frontmatter-only)…
    await expect
      .poll(() => app.editor.readStoredContent(`effort/${slug}`), { timeout: 15_000 })
      .toContain(prose);

    // …the detail editor renders it…
    await expect(page.getByTestId(TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR)).toContainText(prose);

    // …and it survives a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(page.getByTestId(TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR)).toContainText(prose, {
      timeout: 15_000,
    });
  });
});
