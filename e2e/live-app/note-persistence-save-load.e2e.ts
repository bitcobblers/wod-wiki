/**
 * Note Persistence — save/load/complete-workout E2E flow
 *
 * Exercises the note persistence seam end-to-end through the live app:
 * 1. Load a journal note and verify its content persists across navigation
 * 2. Start a workout and confirm the runtime session launches
 * 3. Complete the workout and verify the result is saved to IndexedDB
 * 4. Navigate back to the note and verify the result badge appears
 *
 * These tests exercise IndexedDBNotePersistence through WorkbenchContext.
 *
 * Test isolation: all tests use far-future dates (2099) so they never
 * collide with real user data. IndexedDB is cleared before each test.
 */

import { test, expect, type Page } from '@playwright/test';
import { JournalEntryPage } from '../pages/JournalEntryPage';
import { seedJournalNote, seedCompletedSessions, clearResults, getResults, WOD_DB } from '../helpers/wodwikiDb';
import { waitForSeedReady } from '../helpers/seedReadiness';
import { clearSessions, getSessions } from '../utils/sessionsDb';
import { TEST_IDS } from '../contracts/TestIdContract';

// ── Stable test dates ─────────────────────────────────────────────────────────
const DATE_CONTENT_ROUNDTRIP = '2099-08-01';
const DATE_WORKOUT_SAVE = '2099-08-02';
const DATE_MULTI_RESULT = '2099-08-03';

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Note Persistence — save / load / workout flow', () => {
  let journal: JournalEntryPage;
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
    });
    journal = new JournalEntryPage(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(page);
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    const persistenceErrors = errors.filter(e =>
      e.includes('NOTE_NOT_FOUND') ||
      e.includes('mutateNote') ||
      e.includes('persistence') ||
      e.includes('IndexedDB')
    );
    if (persistenceErrors.length > 0) {
      testInfo.annotations.push({
        type: 'warning',
        description: `⚠️  Persistence errors during test: ${JSON.stringify(persistenceErrors)}`,
      });
    }
  });

  // ── 1. Content round-trip ──────────────────────────────────────────────────

  test('note content persists across navigation and reload', async ({ page }, testInfo) => {
    const uniqueContent = `E2E-PERSIST-${Date.now()}`;
    // Seed a note so the date page mounts the editor (empty dates render
    // "No Notes" only). seedNote overwrites the same id each run.
    await seedJournalNote(page, DATE_CONTENT_ROUNDTRIP, '# E2E Seed\n');
    await journal.goto(DATE_CONTENT_ROUNDTRIP);

    // Type unique content into the editor
    await journal.typeInEditor(uniqueContent);

    // Signal-based: poll IDB until the debounced write lands (replaces the
    // fixed 700ms debounce sleep).
    await journal.awaitNotePersisted(`journal/${DATE_CONTENT_ROUNDTRIP}`, uniqueContent);

    // Navigate away via SPA navigation
    await journal.gotoJournalList();

    // Verify raw IDB write happened
    const stored = await journal.storedContent(DATE_CONTENT_ROUNDTRIP);
    expect(stored, 'Content should be persisted to IndexedDB after debounce').toContain(uniqueContent);

    // Navigate back — editor must show the saved content
    await journal.goto(DATE_CONTENT_ROUNDTRIP);
    await journal.expectEditorContains(uniqueContent);

    // Hard reload — still there
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await journal.waitForEditor();
    await journal.expectEditorContains(uniqueContent);

    // No persistence errors during the flow
    const persistenceErrors = errors.filter(e => e.includes('NOTE_NOT_FOUND') || e.includes('mutateNote'));
    expect(persistenceErrors, 'No persistence errors should occur').toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('persistence-01-content-roundtrip.png') });
  });

  // ── 2. Workout start via play button ──────────────────────────────────────

  test('starting a workout opens a runtime session without persistence errors', async ({ page }, testInfo) => {
    const wodContent = `# Test Workout ${Date.now()}\n\n\`\`\`time\nTimer: 1:00\n5 Burpees\n\`\`\``;
    await seedJournalNote(page, DATE_WORKOUT_SAVE, '# E2E Seed\n');
    await clearResults(page, DATE_WORKOUT_SAVE);
    await journal.goto(DATE_WORKOUT_SAVE);

    // Replace content with a WOD block
    await journal.replaceEditorContent(wodContent);
    // Blocks-parsed signal: the block's run control mounts (bounded auto-wait).
    await expect(page.locator('[data-testid="editor-start-workout"]').first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: testInfo.outputPath('persistence-02a-before-start.png') });

    // Start the workout via the block's inline run control. The journal WOD
    // block action is "Run" (data-testid=editor-start-workout, InlineCommandBar)
    // — the old actions-menu "Workout → Run" dropdown is retired. DOM-click:
    // the block overlay's decoration layers can intercept pointer events
    // (see wod-index-play-button.e2e.ts).
    const runControl = page.locator('[data-testid="editor-start-workout"]').first();
    await expect(runControl).toBeVisible({ timeout: 10_000 });
    await runControl.evaluate((el) => (el as HTMLElement).click());

    // Runtime session contract: the inline tracker mounts with its accessible
    // Stop control (the old FullscreenTimer "Close" text button is retired).
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 5000 });

    // No NOTE_NOT_FOUND or persistence errors on start
    const persistenceErrors = errors.filter(e => e.includes('NOTE_NOT_FOUND') || e.includes('mutateNote'));
    expect(persistenceErrors, 'No persistence errors on workout start').toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('persistence-02b-timer-open.png') });
  });

  // ── 3. Workout result saved to IndexedDB ──────────────────────────────────

  test('a seeded workout result survives a page reload', async ({ page }, testInfo) => {
    // Seeds a result directly into wodwiki-db and verifies:
    //   a) the result survives navigation (IDB not wiped on page load)
    //   b) no NOTE_NOT_FOUND errors are triggered when loading the note
    // The full timer-based completion flow is covered by wod-index-play-button.e2e.ts.
    const noteId = `journal/${DATE_WORKOUT_SAVE}`;
    await seedJournalNote(page, DATE_WORKOUT_SAVE, '# E2E Seed\n\n```time\n5 Burpees\n```\n');
    await clearResults(page, noteId);
    await journal.goto(DATE_WORKOUT_SAVE);

    await seedCompletedSessions(page, noteId, [{ id: 'seeded-result-001', createdAt: Date.now(), duration: 430 }]);

    expect(await getResults(page, noteId)).toHaveLength(1);

    // Navigate away and back — result must persist
    await journal.gotoJournalList();
    await journal.goto(DATE_WORKOUT_SAVE);
    // goto's editor-attached wait doubles as the settle window for any
    // hypothetical async wipe-on-load to run before we assert survival.

    expect(
      await getResults(page, noteId),
      'IDB results must not be deleted when note page loads'
    ).toHaveLength(1);

    // Hard reload — still intact
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await journal.waitForEditor();
    expect(
      await getResults(page, noteId),
      'IDB results must survive a hard page reload'
    ).toHaveLength(1);

    const persistenceErrors = errors.filter(e =>
      e.includes('NOTE_NOT_FOUND') || e.includes('RESULT_NOT_FOUND')
    );
    expect(persistenceErrors, 'No persistence errors on note load with existing results').toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('persistence-03-result-survives-reload.png') });
  });

  // ── 4. Multiple results accumulate ────────────────────────────────────────

  test('multiple workouts accumulate results without overwriting previous ones', async ({ page }, testInfo) => {
    const noteId = `journal/${DATE_MULTI_RESULT}`;
    await seedJournalNote(page, DATE_MULTI_RESULT, '# E2E Seed\n\n```time\n5 Burpees\n```\n');
    await clearResults(page, noteId);
    await seedCompletedSessions(page, noteId, [
      { id: 'test-result-1', createdAt: 1000, duration: 100 },
      { id: 'test-result-2', createdAt: 2000, duration: 100 },
    ]);

    // Verify both results are present
    const results = await getResults(page, noteId);
    expect(results).toHaveLength(2);

    // Navigate to the date — results should NOT be wiped by page load
    await journal.goto(DATE_MULTI_RESULT);
    // goto's editor-attached wait doubles as the settle window for any
    // hypothetical async wipe-on-load to run before we assert survival.

    const afterLoad = await getResults(page, noteId);
    expect(afterLoad, 'Page load must not delete existing workout results').toHaveLength(2);

    await page.screenshot({ path: testInfo.outputPath('persistence-04-multi-result.png') });
  });

  // ── 5. No NOTE_NOT_FOUND in static/read-only contexts ─────────────────────

  test('visiting a static syntax page causes no NOTE_NOT_FOUND errors', async ({ page }, testInfo) => {
    // Static pages use the same atomic persistence path with an in-memory store.
    // Before FIX-7, analytics persistence would throw NOTE_NOT_FOUND on workout complete in static mode.
    // This test verifies no such errors surface during normal static page navigation.
    errors.length = 0;

    await page.goto('/guide/protocols', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(page);

    // The editor should be present on the syntax page
    const editor = page.locator('.cm-content[contenteditable="true"]:visible').first();
    await expect(editor).toBeAttached({ timeout: 10_000 });
    // Just focus the editor — no keyboard input that might trigger navigation
    await editor.focus().catch(() => {});
    // Deliberate grace window for async NOTE_NOT_FOUND errors to surface.
    await page.waitForTimeout(500);

    const noteNotFoundErrors = errors.filter(e => e.includes('NOTE_NOT_FOUND'));
    expect(noteNotFoundErrors, 'No NOTE_NOT_FOUND errors on static pages').toHaveLength(0);

    await page.screenshot({ path: testInfo.outputPath('persistence-05-static-no-errors.png') });
  });

  // ── 6-8. /notes/:id overlay runs persist through the recorder (dogfood #1) ──

  const NOTE_DATE = '2099-08-04';
  const NOTE_ID = `journal/${NOTE_DATE}`;
  // The reported repro fixture verbatim: Next-driven runs never press Start,
  // so they previously drained the stack while execution stayed idle and
  // nothing ever reported.
  const OVERLAY_WOD = '```time\n0:03 Count Down\n10 Pushups\n```';

  /**
   * Open /notes/:id once (seeding the note), then start overlay runs against
   * it. Later runs skip the seed so results stack in one note — the Run
   * control is DOM-clicked, which bypasses the block overlay's pointer
   * interception and hover gating alike.
   */
  async function startOverlayRun(page: Page, seed = true): Promise<void> {
    if (seed) {
      await seedJournalNote(page, NOTE_DATE, `# Overlay Run\n\n${OVERLAY_WOD}\n`);
      await page.goto(`/notes/${encodeURIComponent(NOTE_ID)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    }
    const runControl = page.locator('[data-testid="editor-start-workout"]').first();
    await expect(runControl).toBeAttached({ timeout: 15_000 });
    await runControl.evaluate((el) => (el as HTMLElement).click());
    // Track view mounts (Exit = FocusedDialog close control).
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeVisible({ timeout: 8_000 });
    // Leave the SessionRoot gate — Next advances into the countdown.
    await page.getByTestId(TEST_IDS.TIMER_NEXT_BLOCK).first().click();
  }

  /**
   * Drive the run to end-of-section with Next and dismiss whichever surface
   * is up: the natural-finish results view (Exit) or the track view the
   * moment before its completed report rendered (header Stop). A Stop that
   * lands on the drained stack persists completed:true and shows the results
   * view — dismissed here too. Both paths leave exactly one session.
   */
  async function finishRunAtEndOfSection(page: Page, dismissClicks = 1): Promise<void> {
    for (let i = 0; i < 8; i++) {
      if (await page.getByText('Workout Complete').isVisible().catch(() => false)) break;
      const next = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
      if ((await next.count()) === 0) break;
      await next.click().catch(() => {});
      await page.getByText('Workout Complete').waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
    }
    if (await page.getByText('Workout Complete').isVisible().catch(() => false)) {
      const close = page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first();
      for (let i = 0; i < dismissClicks; i++) await close.click({ timeout: 2_000 }).catch(() => {});
    } else {
      const stop = page.getByRole('button', { name: 'Stop', exact: true }).first();
      for (let i = 0; i < dismissClicks; i++) await stop.click({ timeout: 2_000 }).catch(() => {});
      if (await page.getByText('Workout Complete').isVisible().catch(() => false)) {
        await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
      }
    }
    await expectOverlayGone(page);
  }

  async function expectOverlayGone(page: Page): Promise<void> {
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 8_000 });
  }

  /** Rows in the unified event store for one note (the run's metrics). */
  async function getEventCount(page: Page, noteId: string): Promise<number> {
    return page.evaluate(async (noteId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        if (!db.objectStoreNames.contains('events')) return 0;
        return await new Promise<number>((resolve, reject) => {
          const tx = db.transaction('events', 'readonly');
          const req = tx.objectStore('events').getAll();
          req.onsuccess = () =>
            resolve((req.result as { noteId?: string }[]).filter((e) => e.noteId === noteId).length);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, noteId);
  }

  /** Make exactly the NEXT `sessions`-store put throw (transaction aborts). */
  async function failNextSessionPut(page: Page): Promise<void> {
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      if (!w.__putPatched) {
        w.__putPatched = true;
        const orig = IDBObjectStore.prototype.put;
        w.__origPut = orig;
        IDBObjectStore.prototype.put = function (...args: unknown[]) {
          if ((this as IDBObjectStore).name === 'sessions' && w.__failNextSessionPut) {
            w.__failNextSessionPut = false;
            throw new DOMException('injected session write failure', 'AbortError');
          }
          return (orig as (...a: unknown[]) => IDBRequest).apply(this, args);
        };
      }
      w.__failNextSessionPut = true;
    });
  }

  test('three /notes overlay runs (Stop ×2, Exit ×1) yield three unique persisted sessions with events and Sessions entries', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await clearSessions(page, NOTE_ID);

    // ── Run 1: rapid double Stop at end-of-section — the dedupe path.
    await startOverlayRun(page);
    await finishRunAtEndOfSection(page, 2);
    expect(await getSessions(page, NOTE_ID)).toHaveLength(1);

    // ── Run 2: header Stop after end-of-section — Stop persists completed:true.
    await startOverlayRun(page, false);
    await finishRunAtEndOfSection(page);

    // ── Run 3: natural completion, "Saved" claim, then results-view Exit.
    await startOverlayRun(page, false);
    for (let i = 0; i < 8; i++) {
      if (await page.getByText('Workout Complete').isVisible().catch(() => false)) break;
      const next = page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first();
      if ((await next.count()) === 0) break;
      await next.click().catch(() => {});
      await page.getByText('Workout Complete').waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
    }
    await expect(page.getByText('Workout Complete')).toBeVisible({ timeout: 5_000 });
    // "Saved" may only be claimed after the real commit landed.
    await expect(page.getByText('Saved ✓')).toBeVisible({ timeout: 8_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expectOverlayGone(page);

    // ── Three unique sessions — every end-of-section run completed:true.
    const sessions = await getSessions(page, NOTE_ID);
    expect(sessions, 'exactly one session per run').toHaveLength(3);
    expect(new Set(sessions.map((s) => s.id)).size, 'session ids are unique').toBe(3);
    expect(
      sessions.every((s) => s.completed === true),
      'end-of-section Stop persists completed:true, never a partial',
    ).toBe(true);

    // Event metrics: every persisted run projected rows into the event store
    // (the skipped countdown alone emits at least one output per run).
    const eventCount = await getEventCount(page, NOTE_ID);
    expect(eventCount, 'each run contributes event rows').toBeGreaterThanOrEqual(3);

    // The note stacks one query:table per run — distinct result ids (the
    // debounced content save flushes shortly after the last overlay closes).
    await expect
      .poll(async () => {
        const stored = await journal.storedContent(NOTE_DATE);
        return [...(stored ?? '').matchAll(/:session\{result:([0-9a-f-]+)\}/g)].map((m) => m[1]);
      }, { timeout: 10_000 })
      .toHaveLength(3);
    const markers = [...(await journal.storedContent(NOTE_DATE) ?? '').matchAll(/:session\{result:([0-9a-f-]+)\}/g)].map((m) => m[1]);
    expect(new Set(markers).size, 'one table per unique result id').toBe(3);

    // Sessions listing shows EXACTLY these three identities before and after
    // a reload — "3 of 3" plus one /results/:id card per session id.
    const expectedHrefs = sessions.map((s) => `/results/${s.id}`).sort();
    const expectExactSessions = async () => {
      await expect
        .poll(
          async () => {
            const hrefs = await page
              .locator('a[href^="/results/"]')
              .evaluateAll((els) => els.map((a) => a.getAttribute('href')));
            return [...new Set(hrefs)].sort();
          },
          { timeout: 15_000 },
        )
        .toEqual(expectedHrefs);
      await expect(page.getByText('3 of 3')).toBeVisible();
    };
    await page.goto(`/sessions?q=${encodeURIComponent(':session{}')}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.getByTestId('stream-view-settings-trigger').click();
    await page.getByTestId('view-settings-layout-feed').click();
    await page.getByTestId('view-settings-close').click();
    await expectExactSessions();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expectExactSessions();

    await page.screenshot({ path: testInfo.outputPath('persistence-06-overlay-three-runs.png') });
  });

  test('mid-run Exit on a Next-driven run persists a partial session', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await clearSessions(page, NOTE_ID);
    await startOverlayRun(page);
    // Second Next: the countdown segment emits captured outputs while the
    // execution never flipped to 'running' — Exit must halt+report, not discard.
    await page.locator(`[data-testid="${TEST_IDS.TIMER_NEXT_BLOCK}"]:visible`).first().click().catch(() => {});
    await expect(page.getByText(/results? captured/)).toBeVisible({ timeout: 8_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expectOverlayGone(page);

    const sessions = await getSessions(page, NOTE_ID);
    expect(sessions, 'the partial is persisted, not discarded').toHaveLength(1);
    expect(sessions[0]!.completed).toBe(false);

    await page.screenshot({ path: testInfo.outputPath('persistence-08-next-exit-partial.png') });
  });

  test('a rejected completion preserves the START pin and Retry finalizes the same Session without partial writes', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await clearSessions(page, NOTE_ID);
    await startOverlayRun(page);
    const pinnedSessions = await getSessions(page, NOTE_ID);
    expect(pinnedSessions, 'START commits one immutable Session pin').toHaveLength(1);
    expect(pinnedSessions[0]!.status).toBe('in-progress');
    const eventsBeforeCompletion = await getEventCount(page, NOTE_ID);
    await failNextSessionPut(page);

    // Early Stop: the partial's write fails inside the atomic transaction.
    await page.getByRole('button', { name: 'Stop', exact: true }).first().click();

    // The overlay stays open: visible error + Retry, no fake success.
    await expect(page.getByRole('alert')).toContainText('Save failed', { timeout: 8_000 });
    const retry = page.getByRole('button', { name: 'Retry save' });
    await expect(retry).toBeVisible();

    expect(await getSessions(page, NOTE_ID), 'failed completion leaves the committed START pin unchanged').toEqual(pinnedSessions);
    expect(await getEventCount(page, NOTE_ID), 'failed completion adds no partial events').toBe(eventsBeforeCompletion);

    // Same-ID retry: exactly one session and its events, one query:table.
    await retry.click();
    await expectOverlayGone(page);

    const sessions = await getSessions(page, NOTE_ID);
    expect(sessions, 'retry persists exactly one session').toHaveLength(1);
    expect(sessions[0]!.completed).toBe(false);
    expect(sessions[0]!.id, 'Retry finalizes the original Session identity').toBe(pinnedSessions[0]!.id);
    expect(sessions[0]!.status).toBe('completed');
    expect(await getEventCount(page, NOTE_ID), 'retry persists the event metrics').toBeGreaterThanOrEqual(1);

    // No duplicate query:table from the retry — the one table from the first
    // (failed) attempt is reused, and it references the persisted session.
    await expect
      .poll(async () => {
        const stored = await journal.storedContent(NOTE_DATE);
        return [...(stored ?? '').matchAll(/:session\{result:([0-9a-f-]+)\}/g)].length;
      }, { timeout: 10_000 })
      .toBe(1);
    expect(await getSessions(page, NOTE_ID)).toHaveLength(1);

    // Completion then Stop/Exit never duplicates: reloading the note writes
    // nothing further.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    expect(await getSessions(page, NOTE_ID)).toHaveLength(1);

    await page.screenshot({ path: testInfo.outputPath('persistence-07-retry-saves-once.png') });
  });
});
