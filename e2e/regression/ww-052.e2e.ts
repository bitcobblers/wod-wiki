/**
 * WW-052 — Exiting at the Ready-to-Start gate records a 0s phantom in-progress session row (low)
 *
 * Regression test for the open QA defect WW-052 (phantom-zero-session-gate-exit).
 * Expected behavior: opening the Ready-to-Start gate — and exiting it without
 * ever starting — writes no session row at all. A session row should only exist
 * once the workout actually starts (or be deleted when the gate is exited
 * before any start).
 * Current defect: the session row is pinned at capture time — runCapture.ts
 * captureRun → IndexedDBNotePersistence.startSession writes an in-progress row
 * (durationMs 0, startTime == endTime) the moment the gate opens; the
 * stopAndReport hasStarted guard prevents finalizing it on gate exit but never
 * deletes it, so phantom rows accumulate in the sessions store (the 2026-11-18
 * repro ended with 6 rows = 3 completed + 3 phantom, all hidden from /sessions).
 * Source: QA ledger https://qa.forest-adhara.ts.net/issues.html (last seen 2026-11-18-nightly-052229).
 */
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { deleteNoteByRouteId } from '../helpers/wodwikiDb';
import { clearSessions, getSessions } from '../utils/sessionsDb';

const NOTE_ID = 'ww052-gate-probe';
const CONTENT = ['# WW052 Gate Probe', '', '```time', 'Timer: 1:00', '10 Burpees', '```', ''].join('\n');

test.describe('WW-052 — phantom session row at the Ready-to-Start gate', () => {
  test('WW-052: opening and exiting the Ready-to-Start gate without starting leaves no session row', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;

    await app.goto('/');
    await clearSessions(page);
    await app.seed.note(NOTE_ID, CONTENT, { title: 'WW052 Gate Probe' });

    try {
      await app.editor.openNote(NOTE_ID);
      await app.runtime.startWorkout();
      await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeVisible({
        timeout: 15_000,
      });

      // At the gate, before any Start: no session row may exist yet.
      await expect
        .poll(async () => (await getSessions(page)).length, { timeout: 5_000 })
        .toBe(0);

      // Exit the gate without starting (Stop at the gate closes the panel).
      await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({
        timeout: 10_000,
      });
      await app.runtime.stopSession();
      await expect(page.getByRole('heading', { name: 'Ready to Start' })).toBeHidden({
        timeout: 10_000,
      });

      // After the exit, the sessions store must still be empty — no 0s
      // in-progress phantom row (duration 0, startTime == endTime).
      const rows = await getSessions(page);
      expect(
        rows,
        `gate exit left phantom session row(s): ${JSON.stringify(rows)}`,
      ).toEqual([]);
    } finally {
      await clearSessions(page).catch(() => {});
      await deleteNoteByRouteId(page, NOTE_ID).catch(() => {});
    }
  });
});
