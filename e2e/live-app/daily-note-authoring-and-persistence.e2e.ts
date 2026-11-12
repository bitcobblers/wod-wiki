// spec: e2e/specs/journal/daily-note-authoring-and-persistence.md
import { test, expect } from '../fixtures/playgroundActor';

// Stable far-future dates — never collide with real entries; cleared before
// each test so scenarios start from the intended world.
const DATE_LOAD = '2099-07-01';
const DATE_NAV = '2099-07-02';
const DATE_RELOAD = '2099-07-03';

test.describe('Daily note authoring and persistence — /day/:date', () => {
  test('a seeded date loads its note into the day editor', async ({ app }) => {
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
});
