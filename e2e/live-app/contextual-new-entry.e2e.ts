// spec: e2e/specs/journal/contextual-new-entry.md
import { expect, test, TEST_IDS, clickStreamAdd, openL3Action } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';

test.describe('JRN-03 — Contextual New Entry Creation & Title Persistence', () => {
  test('Scenario 1: contextual + Add adapts per library and creates Playgrounds, Journal Notes, Notebook Notes, and Tags', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    // 1. Contextual wizard options & per-library labels (via View -> + Add on desktop streams)
    await app.journal.openStream();
    await clickStreamAdd(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('new-entry-note')).toBeVisible();
    await expect(dialog.getByTestId('new-entry-playground')).toBeVisible();
    await expect(dialog.getByTestId('new-entry-notebook')).toBeVisible();
    await expect(dialog.getByTestId('new-entry-effort')).toBeVisible();
    await expect(dialog.getByTestId('new-entry-equipment')).toBeVisible();
    await expect(dialog.getByTestId('new-entry-tag')).toBeVisible();
    await expect(dialog.getByTestId('new-entry-dashboard')).toHaveCount(0);
    const writeTab = dialog.getByRole('tab', { name: 'Write a Note' });
    const pickTab = dialog.getByRole('tab', { name: 'Pick / Log a Workout' });
    await expect(writeTab).toHaveAttribute('aria-selected', 'true');
    await expect(pickTab).toHaveAttribute('aria-selected', 'false');

    // Switch to Pick / Log a Workout, search, verify Schedule works cleanly, then reopen on /journal to verify resets
    await pickTab.click();
    await expect(pickTab).toHaveAttribute('aria-selected', 'true');
    const searchBox = dialog.getByRole('searchbox', { name: 'Search workouts' });
    await expect(searchBox).toBeVisible();
    await searchBox.fill('My Workout');
    await expect(dialog.getByRole('button', { name: 'Open / Run' }).first()).toBeVisible();
    const scheduleBtn = dialog.getByRole('button', { name: 'Schedule' }).first();
    await expect(scheduleBtn).toBeVisible();
    await scheduleBtn.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}$/, { timeout: 15_000 });
    await app.goto('/journal');

    await clickStreamAdd(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Write a Note' })).toHaveAttribute('aria-selected', 'true');
    const advBtn = dialog.getByRole('button', { name: /Advanced options/i });
    await expect(advBtn).toHaveAttribute('aria-expanded', 'false');
    await advBtn.click();
    await expect(advBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByTestId('journal-create-page-toggle')).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // Reopen again on /journal -> Advanced options resets back to collapsed
    await clickStreamAdd(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Advanced options/i })).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');

    await app.goto('/playgrounds');
    await page.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_TRIGGER).click();
    await expect(page.getByTestId(TEST_IDS.STREAM_VIEW_ADD_ACTION)).toHaveText('+ Add');
    await page.keyboard.press('Escape');

    await app.notebooks.openLibrary();
    await page.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_TRIGGER).click();
    await expect(page.getByTestId(TEST_IDS.STREAM_VIEW_ADD_ACTION)).toHaveText('+ New notebook');
    await page.keyboard.press('Escape');

    await app.goto('/pages');
    await clickStreamAdd(page);
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Write a Note' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog').getByRole('button', { name: /Advanced options/i })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog').getByTestId('journal-create-page-toggle')).toBeChecked();
    await page.keyboard.press('Escape');

    // 2. Create a Playground from /journal and add a timer
    await app.journal.openStream();
    await clickStreamAdd(page);
    await dialog.getByTestId('new-entry-playground').click();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/playground\/[^/]+$/);
    await expect(page.locator('#create-journal-note-form')).toHaveCount(0);
    const playgroundEditor = page.getByRole('textbox', { name: 'Note editor' });
    await expect(playgroundEditor).toBeVisible();
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(0);
    const addTimerPlayground = page.getByRole('button', { name: 'Add timer', exact: true });
    await openL3Action(page, addTimerPlayground);
    await addTimerPlayground.click();
    await expect(playgroundEditor.getByText('10:00', { exact: true }).first()).toBeVisible();

    // 3. Create a blank Journal Note and add a timer
    await app.journal.openStream();
    await clickStreamAdd(page);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/note\/[0-9a-f-]+\?edit=1$/);
    const createdJournalNoteId = new URL(page.url()).pathname.replace(/^\/note\//, '');
    await expect(page.locator('#create-journal-note-form')).toHaveCount(0);
    const journalEditor = page.getByRole('textbox', { name: 'Note editor' });
    await expect(journalEditor).toBeVisible();
    const addTimerJournal = page.getByRole('button', { name: 'Add timer', exact: true });
    await openL3Action(page, addTimerJournal);
    await addTimerJournal.click();
    await expect(journalEditor.getByText('10:00', { exact: true }).first()).toBeVisible();
    await deleteNoteByRouteId(page, createdJournalNoteId);

    // 4. Create a Note inside a custom Notebook
    await app.notebooks.openLibrary();
    await app.notebooks.create('Combo notes');
    await expect(page).toHaveURL('/notebook/combo-notes');
    await clickStreamAdd(page);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/notebook\/combo-notes\/[0-9a-f-]+$/);
    await expect(page.locator('#create-journal-note-form')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Note editor' })).toContainText('Untitled note');
    await expect(page.getByRole('link', { name: 'combo-notes' })).toBeVisible();

    // 5. Create a Tag from catalog wizard
    await app.journal.openStream();
    await clickStreamAdd(page);
    await dialog.getByTestId('new-entry-tag').click();
    await dialog.getByPlaceholder('e.g., heavy').fill('E2E catalog tag');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL('/t/tag/e2e-catalog-tag');
    await expect(page.getByRole('heading', { name: 'Edit e2e-catalog-tag' })).toBeVisible();

    app.assertCleanConsole();
  });

  test('Scenario 2: mobile 375x812 thumb-dock ordering, WQL dashboard creation bounds, and H1 persistence across reload', async ({
    app,
  }) => {
    const { page } = app;

    // Home sticky header stays calm on desktop (Cast only; mobile mounts MobileNewEntryCombo)
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/');
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Cast to TV/ })).toBeVisible();

    // Mobile 375x812 thumb-dock ordering & custom notebook New Note
    await page.setViewportSize({ width: 375, height: 812 });
    await app.journal.openStream();
    await expect(page.getByTestId('new-entry-combo')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'New Journal entry', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New journal note', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Cast to TV/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open page options' })).toHaveCount(0);
    await expect(page.getByTestId('actions-overflow')).toBeVisible();

    const searchY = (await page.getByTestId('search-fab').boundingBox())!.y;
    const newY = (await page.getByTestId(TEST_IDS.NEW_ENTRY_PRIMARY).boundingBox())!.y;
    expect(searchY).toBeLessThan(newY);

    await app.notebooks.openNotebook('custom');
    await expect(page.getByRole('button', { name: 'New Note', exact: true })).toBeVisible();

    // Dashboard creation from WQL on guide vs absent on dashboard route (desktop + mobile)
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await app.goto('/page/guide-wql');
      const action = page.getByTestId('query-add-dashboard').first();
      await expect(action).toBeVisible();
      await action.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');

      await app.wql.openDashboard('benchmark-pr-board');
      await expect(page.getByTestId('query-add-dashboard')).toHaveCount(0);
    }

    // Editing H1 updates title and survives reload
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.journal.openStream();
    await clickStreamAdd(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/note\/[0-9a-f-]+\?edit=1$/);
    const noteId = new URL(page.url()).pathname.replace(/^\/note\//, '');
    await expect(page.locator('#create-journal-note-form')).toHaveCount(0);
    const editor = page.getByRole('textbox', { name: 'Note editor' });
    await expect(editor).toBeVisible();

    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('# Brand New Custom Title\n\n10 Pushups\n');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByRole('heading', { name: 'Brand New Custom Title', level: 1 })).toBeVisible();

    await page.reload();
    await app.feeds.waitForReady();
    await expect(page.getByRole('heading', { name: 'Brand New Custom Title', level: 1 })).toBeVisible();
    await deleteNoteByRouteId(page, noteId);

    app.assertCleanConsole();
  });
});
