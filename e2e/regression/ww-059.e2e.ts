/**
 * WW-059 — /day/:date has no Page options panel — Delete note, Clone, Export, Notebooks & Promotion unavailable vs /note/:id (medium)
 *
 * Regression test for the open QA defect WW-059 (day-view-note-actions-missing).
 * Expected behavior: the day view for a journal note offers the same Page
 * options actions as /note/:id — Delete note, Clone, Export Note (.md), and
 * Notebooks & Promotion — for the note shown on that date.
 * Current defect: JournalDatePage publishes only an "Add timer" helpful action
 * through useNotePageNav, so the Page options panel on /day/:date lacks every
 * note-management action that NoteByIdPage registers.
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-17-nightly-052156).
 */
import { test, expect } from '../fixtures/playgroundActor';

// Stable far-future date — never collides with real entries (same convention
// as daily-note-authoring-and-persistence.e2e.ts).
const DATE = '2099-07-07';

test.describe('WW-059 — day view offers full Page options parity with /note/:id', () => {
  test('WW-059: /day/:date Page options include Delete note, Clone, Export, and Notebooks & Promotion', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 1280, height: 900 });
    await app.journal.clearDate(DATE);
    await app.seed.journalNote(DATE, '# Day Actions Probe 2099\n\nMobility block', {
      title: 'Day Actions Probe 2099',
    });

    const day = await app.journal.openDate(DATE);
    await day.expectTitleContains(DATE);

    // Open the Page options surface the same way the daily-note suite does:
    // actions may render inline in the rail or behind the drawer trigger.
    const options = app.page.getByRole('button', { name: 'Page options' });
    const addTimer = app.page.getByRole('button', { name: 'Add timer', exact: true });
    await expect(addTimer.or(options).first()).toBeVisible({ timeout: 20_000 });
    if (!(await addTimer.isVisible().catch(() => false))) {
      await options.click();
    }
    // Control: the one action the day view does publish proves the panel is
    // open and the note is loaded — the defect is the missing actions below.
    await expect(addTimer, 'day view Page options panel is open').toBeVisible({ timeout: 10_000 });

    for (const label of ['Delete note', 'Clone', 'Export Note (.md)', 'Notebooks & Promotion']) {
      await expect(
        app.page.getByRole('button', { name: label, exact: true }),
        `/day/:date Page options include "${label}" (parity with /note/:id)`,
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
