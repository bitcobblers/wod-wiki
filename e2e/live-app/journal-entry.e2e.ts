/**
 * Journal Entry E2E Tests
 *
 * Validates the /journal/:date route against the intended empty-date UX
 * (issue #698): an unseeded date shows an empty state — NO auto-seeded
 * template and NO editor. Tests seed a journal note first
 * (`seedJournalNote`), then drive the editor:
 * 1. A seeded date loads its note content
 * 2. Edited content is saved after the edit settles
 * 3. Edited content is saved when navigating away immediately after typing
 *    (the date page persists per keystroke via journalNotes.update — serialized
 *    per note; navigation must never drop the final write)
 * 4. Content survives a full page reload
 * 5. A clone of the day's note clears the inherited named page, resolves its
 *    fresh slug, keeps the lineage backlink, and joins the original on the
 *    shared journal date in both journal views
 *
 * Tests run against the live app at https://pluto.forest-adhara.ts.net:5173
 * via playwright.journal.config.ts.
 *
 * Test isolation: each test uses a unique stable date in 2099 that is cleared
 * in the IndexedDB before the test begins.
 */

import { test, expect, type Page } from '@playwright/test';
import { JournalEntryPage } from '../pages/JournalEntryPage';
import { seedJournalNote } from '../helpers/wodwikiDb';
import { waitForSeedReady } from '../helpers/seedReadiness';

// Stable test dates — far future so they never conflict with real entries
const DATE_LOAD = '2099-06-01';
const DATE_SAVE_NORMAL = '2099-06-02';
const DATE_SAVE_QUICK = '2099-06-03';
const DATE_RELOAD = '2099-06-04';

test.describe('Journal Entry — /journal/:date', () => {
  let journal: JournalEntryPage;
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    journal = new JournalEntryPage(page);

    // Suppress the First-Note Wizard — its backdrop intercepts every click on
    // fresh browser profiles (see runtime-execution.e2e.ts).
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });

    // Navigate once to seed IndexedDB access before clearing
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(page);
  });

  test.afterEach(() => {
    if (errors.length > 0) {
      console.warn('Page errors during test:', errors);
    }
  });

  // ── 1. Seeded date loads its note content ────────────────────────────────

  test('loads the note content for a seeded date', async ({ page }, testInfo) => {
    const seeded = `# E2E-LOAD-${Date.now()}\n\n` + '```time\nTimer: 0:01\n1 Burpee\n```\n';
    await journal.clearStoredEntry(DATE_LOAD);
    await seedJournalNote(journal.page, DATE_LOAD, seeded);
    await journal.goto(DATE_LOAD);

    // The seeded note's content renders (no auto-template — see #698).
    await journal.expectEditorContains('E2E-LOAD');

    // No page errors
    expect(errors).toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('journal-entry-01-template.png') });
  });

  // ── 2. Content saved after normal debounce (≥500ms) ──────────────────────

  test('saves content after waiting for debounce then navigating away', async ({ page }, testInfo) => {
    const uniqueText = `E2E-SAVE-NORMAL-${Date.now()}`;
    await journal.clearStoredEntry(DATE_SAVE_NORMAL);
    await seedJournalNote(journal.page, DATE_SAVE_NORMAL, 'Note\n');
    await journal.goto(DATE_SAVE_NORMAL);

    await journal.typeInEditor(uniqueText);

    // Coalesced autosave: a line change flushes the draft (no idle timer).
    await page.keyboard.press('Enter');
    await journal.awaitNotePersisted(`journal/${DATE_SAVE_NORMAL}`, uniqueText);

    // Navigate away
    await journal.gotoJournalList();

    // Verify IndexedDB was written
    const stored = await journal.storedContent(DATE_SAVE_NORMAL);
    expect(stored).toContain(uniqueText);

    // Navigate back — editor must show the saved content
    await journal.goto(DATE_SAVE_NORMAL);
    await journal.expectEditorContains(uniqueText);

    await page.screenshot({ path: testInfo.outputPath('journal-entry-02-save-normal.png') });
  });

  // ── 3. Content saved on quick SPA departure after typing ──────────────────

  test('saves content when navigating away before 500ms debounce fires', async ({ page }, testInfo) => {
    const uniqueText = `E2E-SAVE-QUICK-${Date.now()}`;
    await journal.clearStoredEntry(DATE_SAVE_QUICK);
    await seedJournalNote(journal.page, DATE_SAVE_QUICK, 'Note\n');
    await journal.goto(DATE_SAVE_QUICK);

    await journal.typeInEditor(uniqueText);

    // Navigate away immediately after the final keystroke. The date page
    // persists per keystroke via journalNotes.update (serialized per note);
    // the SPA navigation must keep the page context alive so the last write
    // commits — quick navigation must not lose a single edit.
    await journal.gotoJournalList();

    // Poll IDB until the unmount-flush write lands (replaces the fixed 300ms wait).
    await journal.awaitNotePersisted(`journal/${DATE_SAVE_QUICK}`, uniqueText);

    // Verify IndexedDB was written despite quick navigation
    const stored = await journal.storedContent(DATE_SAVE_QUICK);
    expect(stored).toContain(uniqueText);

    // Navigate back — content must appear
    await journal.goto(DATE_SAVE_QUICK);
    await journal.expectEditorContains(uniqueText);

    await page.screenshot({ path: testInfo.outputPath('journal-entry-03-save-quick.png') });
  });

  // ── 4. Content survives a full page reload ────────────────────────────────

  test('content persists across a hard page reload', async ({ page }, testInfo) => {
    const uniqueText = `E2E-RELOAD-${Date.now()}`;
    await journal.clearStoredEntry(DATE_RELOAD);
    await seedJournalNote(journal.page, DATE_RELOAD, 'Note\n');
    await journal.goto(DATE_RELOAD);

    await journal.typeInEditor(uniqueText);

    // Coalesced autosave: a line change flushes the draft (no idle timer).
    await page.keyboard.press('Enter');
    await journal.awaitNotePersisted(`journal/${DATE_RELOAD}`, uniqueText);

    // Hard reload
    await journal.page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await journal.waitForEditor();

    await journal.expectEditorContains(uniqueText);

    await page.screenshot({ path: testInfo.outputPath('journal-entry-04-reload.png') });
  });

  // ── 5. Title shows the date ───────────────────────────────────────────────

  test('page title reflects the journal date', async ({ page }, testInfo) => {
    await journal.clearStoredEntry(DATE_LOAD);
    await seedJournalNote(journal.page, DATE_LOAD, 'Note\n');
    await journal.goto(DATE_LOAD);

    // The date appears somewhere in the page title / heading
    // e.g. "June 1, 2099" or "2099-06-01"
    const titleText = await journal.title().innerText();
    // Accepts any format that includes the year
    expect(titleText).toMatch(/2099/);

    await page.screenshot({ path: testInfo.outputPath('journal-entry-05-title.png') });
  });

  // ── 6. Clone identity + shared-day journal membership ────────────────────

  test('clone clears the inherited slug and both notes list on the shared day', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    // The journal stream defaults to `last 4w`, so the shared day must be
    // today, not a far-future isolation date.
    const today = todayKey();
    const stamp = Date.now();
    const uniqueTitle = `E2E Clone ${stamp}`;
    const originalSlug = `e2e-orig-${stamp}`;
    const cloneSlug = `e2e-clone-${stamp}`;
    // Cascades every note linked to the date page — including UUID clones
    // left by previous runs — so the day under test starts empty. The second
    // pass hits the page cascade (it only runs once the route note is gone).
    await journal.clearStoredEntry(today);
    await journal.clearStoredEntry(today);
    await seedJournalNote(page, today, `# ${uniqueTitle}\n`, { title: uniqueTitle });
    await page.goto(`/notes/${encodeURIComponent(`journal/${today}`)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // Wait for the note action pills after content restore.
    await openPageAction(page, 'Note relationships');
    await page.locator('#note-placement-slug').fill(originalSlug);
    await page.locator('button[form="note-placement-form"]').click();
    await expect(page.locator(`a[href="/p/${originalSlug}"]`)).toBeVisible({ timeout: 30_000 });

    // …then clone: the dialog must NOT inherit the original's slug.
    await openPageAction(page, 'Clone');
    await expect(page.locator('#note-placement-slug')).toHaveValue('');
    // A fresh slug names the clone's own page; the date defaults to the
    // original's day, so both notes land on the same journal date.
    await page.locator('#note-placement-slug').fill(cloneSlug);
    await page.locator('button[form="note-placement-form"]').click();

    // Lands on the clone's UUID page: different id, own /p/ link, lineage
    // backlink to the original, and never the original's link.
    await page.waitForURL(/\/notes\/[0-9a-f-]{36}/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).not.toContain(encodeURIComponent(`journal/${today}`));
    await expect(page.locator(`a[href="/p/${cloneSlug}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/p/${originalSlug}"]`)).toHaveCount(0);
    await expect(page.getByText('Cloned from')).toBeVisible();

    // The journal day page lists both notes on the shared date.
    await page.goto(`/journal/${today}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByText('2 notes', { exact: true })).toBeVisible({ timeout: 45_000 });

    // Verify both identities in the journal stream before and after reload.
    await page.goto('/journal', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(page);
    await expect(page.getByTestId(`date-group-${today}`)).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(page);
    const dayGroup = page.getByTestId(`date-group-${today}`);
    await expect(dayGroup).toBeVisible({ timeout: 45_000 });
    await expect(dayGroup).toContainText('2 entries');
    const dayRows = dayGroup.getByTestId('library-row-note');
    await expect(dayRows).toHaveCount(2);
    // Both cards carry the unique title — identity membership, not a generic
    // date string (cards render no date breadcrumb).
    await expect(dayRows.first()).toContainText(uniqueTitle);
    await expect(dayRows.nth(1)).toContainText(uniqueTitle);

    await page.screenshot({ path: testInfo.outputPath('journal-entry-06-clone.png') });
  });
});

/** Local calendar date key (YYYY-MM-DD) — matches the app's getTodayDateKey. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

/** Open a note-page action pill — the desktop header renders them inline once
 *  the content store has restored, so wait for the pill rather than probing. */
async function openPageAction(page: Page, name: string): Promise<void> {
  const action = page.getByRole('button', { name, exact: true });
  await expect(action).toBeVisible({ timeout: 45_000 });
  await action.click();
}
