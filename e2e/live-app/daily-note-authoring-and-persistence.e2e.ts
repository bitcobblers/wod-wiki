// spec: e2e/specs/journal/daily-note-authoring-and-persistence.md
import type { Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

// Stable far-future dates — never collide with real entries; cleared before
// each test so scenarios start from the intended world.
const DATE_LOAD = '2099-07-01';
const DATE_NAV = '2099-07-02';
const DATE_RELOAD = '2099-07-03';
const DATE_EMPTY = '2099-07-04';
const DATE_WYSIWYG_RUN = '2099-07-05';
const DATE_CLONE = '2099-07-06';

async function openNotePageAction(page: Page, name: string): Promise<void> {
  const action = page.getByRole('button', { name, exact: true });
  const options = page.getByRole('button', { name: 'Page options' });
  await expect(action.or(options).first()).toBeVisible({ timeout: 20_000 });
  if (!(await action.isVisible().catch(() => false))) {
    await options.click();
  }
  await expect(action).toBeVisible({ timeout: 10_000 });
  await action.click();
}

test.describe('Daily note authoring and persistence — /day/:date', () => {
  test('an unseeded date renders an empty state while a seeded date loads its Note into the day editor', async ({
    app,
  }) => {
    await app.journal.clearDate(DATE_EMPTY);
    await app.goto(`/day/${DATE_EMPTY}`);
    await expect(app.page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 15_000,
    });
    await expect(app.page.locator('.cm-content[contenteditable="true"]')).toHaveCount(0);
    await expect(app.page.locator('h1').first()).toContainText('2099');

    await app.journal.clearDate(DATE_LOAD);
    await app.seed.journalNote(DATE_LOAD, 'Swim 2,000m easy\nBike 40min zone 2');

    const day = await app.journal.openDate(DATE_LOAD);

    await expect(day.editor()).toContainText('Bike 40min zone 2');
    await day.expectTitleContains(DATE_LOAD);
    app.assertCleanConsole();
  });

  test('a line typed before autosave survives navigation', async ({ app }) => {
    await app.journal.clearDate(DATE_NAV);
    await app.seed.journalNote(DATE_NAV, 'Warm-up: 400m easy');

    const day = await app.journal.openDate(DATE_NAV);
    await day.typeInEditor('\nCooldown: mobility flow');

    // SPA navigation immediately after same-line typing (no trailing Enter) —
    // unmount flush must never drop the final write.
    await app.page.keyboard.type(' + stretch');
    await day.gotoJournalList();

    await app.journal.expectNotePersisted(`journal/${DATE_NAV}`, 'Cooldown: mobility flow + stretch');
    const reopened = await app.journal.openDate(DATE_NAV);
    await reopened.expectEditorContains('Cooldown: mobility flow + stretch');
    app.assertCleanConsole();
  });

  test('authored content survives a full page reload', async ({ app }) => {
    await app.journal.clearDate(DATE_RELOAD);
    await app.seed.journalNote(DATE_RELOAD, 'AMRAP 20: 10 push-ups');

    const day = await app.journal.openDate(DATE_RELOAD);
    await day.typeInEditor('\nScore: 6 rounds + 4');
    await app.page.keyboard.press('Enter');
    await app.journal.expectNotePersisted(`journal/${DATE_RELOAD}`, 'Score: 6 rounds + 4');

    // openDate performs a hard page.goto — a genuine full reload.
    const reloaded = await app.journal.openDate(DATE_RELOAD);
    await reloaded.expectEditorContains('Score: 6 rounds + 4');
    app.assertCleanConsole();
  });

  test('same-line typing without newline survives immediate hard navigation and /plan resolves today entry', async ({
    app,
  }) => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await app.journal.clearDate(todayKey);
    await app.seed.journalNote(todayKey, 'Tempo Run 5km');

    const day = await app.journal.openDate(todayKey);
    await day.editor().click();
    await app.page.keyboard.press('End');
    await app.page.keyboard.type(' — Mobility finisher');

    // Immediate hard navigation (<100ms, before idle debounce) to /plan (WW-022 + WW-024)
    await app.page.goto('/plan');
    await expect(app.page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 15_000,
    });

    const statusStrip = app.page.getByTestId('stream-query-status');
    await expect(statusStrip).toBeVisible();
    await expect(statusStrip).not.toContainText('0 of 0');
    await expect(statusStrip).not.toContainText('(query)');

    const reopened = await app.journal.openDate(todayKey);
    await reopened.expectEditorContains('Tempo Run 5km — Mobility finisher');
    await app.journal.clearDate(todayKey);
    app.assertCleanConsole();
  });

  test('explicit Ctrl+S flush, live WYSIWYG task/table edits, and inline workout launch persist cleanly', async ({
    app,
  }) => {
    const { page } = app;
    await app.journal.clearDate(DATE_WYSIWYG_RUN);
    await app.seed.journalNote(
      DATE_WYSIWYG_RUN,
      [
        '# Conditioning & Lift',
        '',
        '- [ ] Warmup mobility',
        '',
        '| Lift | Weight |',
        '| --- | --- |',
        '| Squat | 100kg |',
        '',
        '```time',
        'Timer: 1:00',
        '5 Burpees',
        '```',
        '',
        'Session notes',
      ].join('\n'),
    );

    await app.journal.openDate(DATE_WYSIWYG_RUN);

    // Move caret to trailing line so prose widgets above render in WYSIWYG mode
    await page.evaluate(() => {
      const host = document.querySelector('.cm-note-editor') as
        | (HTMLElement & { __codemirrorView?: import('@codemirror/view').EditorView })
        | null;
      const view = host?.__codemirrorView;
      if (view) {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
    });

    // 1. Toggle WYSIWYG task checkbox -> `- [x] Warmup mobility`
    const checkbox = page.locator('button.cm-md-task-checkbox').first();
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');

    // 2. Edit rendered GFM table cell inline -> `Front Squat`
    const tableCell = page.locator('.cm-table-preview tbody td').first();
    await expect(tableCell).toContainText('Squat');
    await tableCell.click();
    const cellInput = tableCell.locator('input');
    await expect(cellInput).toBeVisible();
    await cellInput.fill('Front Squat');
    await cellInput.press('Enter');
    await expect(page.locator('.cm-table-preview tbody td').first()).toContainText('Front Squat');

    // 3. Single-line typing + explicit ControlOrMeta+s flushes pending draft without Enter or blur
    await page.getByText('Session notes').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — RPE 7');
    await page.keyboard.press('ControlOrMeta+s');
    await app.journal.expectNotePersisted(`journal/${DATE_WYSIWYG_RUN}`, '- [x] Warmup mobility');
    await app.journal.expectNotePersisted(`journal/${DATE_WYSIWYG_RUN}`, 'Front Squat');
    await app.journal.expectNotePersisted(`journal/${DATE_WYSIWYG_RUN}`, 'Session notes — RPE 7');

    // 4. Launching workout directly from the edited day Note opens inline session cleanly
    const runBtn = page.getByTestId(TEST_IDS.EDITOR_START_WORKOUT).first();
    await expect(runBtn).toBeVisible({ timeout: 10_000 });
    await runBtn.click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 10_000 });

    await app.journal.clearDate(DATE_WYSIWYG_RUN);
    app.assertCleanConsole();
  });

  test('cloning a placed Note clears the inherited named-page slug, preserves lineage, and lists both Notes on the shared day', async ({
    app,
  }) => {
    test.setTimeout(90_000);
    const { page } = app;
    const stamp = Date.now();
    const uniqueTitle = `E2E Clone ${stamp}`;
    const originalSlug = `e2e-orig-${stamp}`;
    const cloneSlug = `e2e-clone-${stamp}`;

    await app.journal.clearDate(DATE_CLONE);
    await app.journal.clearDate(DATE_CLONE);
    await app.seed.journalNote(DATE_CLONE, `# ${uniqueTitle}\n\nMobility block`, { title: uniqueTitle });

    await app.goto(`/note/${encodeURIComponent(`journal/${DATE_CLONE}`)}`);

    // Place original Note onto named page `/page/<originalSlug>`
    await openNotePageAction(page, 'Note placements');
    await page.getByTestId(TEST_IDS.PLACEMENT_SLUG_INPUT).fill(originalSlug);
    await page.getByTestId(TEST_IDS.PLACEMENT_ADD_BTN).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator(`a[href="/page/${originalSlug}"]`)).toBeVisible({ timeout: 15_000 });

    // Open Clone -> named-page slug starts empty while journal date defaults to DATE_CLONE
    await openNotePageAction(page, 'Clone');
    await expect(page.getByTestId(TEST_IDS.PLACEMENT_SLUG_INPUT)).toHaveValue('');
    await expect(page.getByTestId(TEST_IDS.PLACEMENT_DATE_INPUT)).toHaveValue(DATE_CLONE);
    await page.getByTestId(TEST_IDS.PLACEMENT_SLUG_INPUT).fill(cloneSlug);
    await page.getByTestId(TEST_IDS.PLACEMENT_CLONE_SUBMIT_BTN).click();

    await page.waitForURL(/\/note\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const cloneUuid = new URL(page.url()).pathname.replace(/^\/note\//, '');
    expect(cloneUuid).not.toContain(`journal/${DATE_CLONE}`);
    await expect(page.locator(`a[href="/page/${cloneSlug}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/page/${originalSlug}"]`)).toHaveCount(0);
    await expect(page.getByText('Cloned from')).toBeVisible();

    // Shared journal day lists both Notes before and after reload
    await app.goto(`/day/${DATE_CLONE}`);
    await expect(page.getByText('2 notes', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(page.getByText('2 notes', { exact: true })).toBeVisible({ timeout: 20_000 });

    await deleteNoteByRouteId(page, cloneUuid);
    await app.journal.clearDate(DATE_CLONE);
    app.assertCleanConsole();
  });
});
