// spec: e2e/specs/runtime/readonly-intake-and-provenance-run.md
/**
 * RUN-02 — Read-only intake & single archival provenance run (P0-gate)
 *
 * A subscribed peer Feed publishes a read-only workout Note (index-first, zero
 * bulk import until opened or run). Running it pins ONE immutable local
 * archival copy under `upstreamId` (`retention: 'session-pinned'`) instead of
 * spawning a duplicate Journal Note clone, records the completed Session
 * against `upstreamId` on today's Journal calendar `Page` and `/results/:sessionId`,
 * lists logged workouts on `/note/:upstreamId`, and preserves both the pinned
 * local workout copy and its completed Session when the Feed is unsubscribed.
 */

import type { Page } from '@playwright/test';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';
import { getSessions } from '../utils/sessionsDb';

const PEER_BASE = 'https://peer.example.org/readonly-run/';
const WOD_MD = '# Hero WOD\n\n```time\n0:03 AMRAP\n  5 Air Squats\n```\n';

const CLOUD_PEER_BASE = 'https://peer.example.org/cloud-wods/';
const CLOUD_CINDY_MD = '# Cloud Cindy\n\n```wod\n0:03 AMRAP\n  5 Pull-up\n```\n';
const CLOUD_ANNIE_MD = '# Cloud Annie\n\n```time\n0:03 AMRAP\n  10 Sit-up\n```\n';

const LOCAL_WOD_MD = '# Local Garage WOD\n\n```wod\n0:03 AMRAP\n  8 Air Squats\n```\n';
const LOCAL_TIME_MD = '# Local Tempo Time\n\n```time\n0:03 AMRAP\n  6 Push-up\n```\n';

async function inspectNoteOwnershipState(
  page: Page,
  noteIds: string[],
): Promise<{
  ghostPlaygroundIds: string[];
  notesById: Record<string, { retention?: string; type?: string } | undefined>;
}> {
  return page.evaluate(
    (ids) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('notes')) {
            db.close();
            resolve({ ghostPlaygroundIds: [], notesById: {} });
            return;
          }
          const tx = db.transaction('notes', 'readonly');
          const g = tx.objectStore('notes').getAll();
          g.onsuccess = () => {
            const all = (g.result as Array<Record<string, unknown>>) ?? [];
            const ghostPlaygroundIds = all
              .filter((n) => n.type === 'playground')
              .map((n) => String(n.id));
            const notesById: Record<string, { retention?: string; type?: string } | undefined> = {};
            for (const id of ids) {
              const found = all.find((n) => n.id === id);
              if (found) {
                notesById[id] = {
                  retention: typeof found.retention === 'string' ? found.retention : undefined,
                  type: typeof found.type === 'string' ? found.type : undefined,
                };
              }
            }
            db.close();
            resolve({ ghostPlaygroundIds, notesById });
          };
          g.onerror = () => {
            db.close();
            reject(g.error);
          };
        };
      }),
    noteIds,
  );
}

function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

interface ArchivalDbSnapshot {
  matchingNotes: Array<{
    id: string;
    retention?: string;
    upstreamStatus?: string;
    seedOrigin?: string;
    rawContent: string;
  }>;
  sessionPageDate?: string;
  hasJournalSessionLink: boolean;
}

async function inspectArchivalRunState(
  page: Page,
  upstreamId: string,
  sessionId: string,
): Promise<ArchivalDbSnapshot> {
  return page.evaluate(
    ({ noteId, sessId }) =>
      new Promise<ArchivalDbSnapshot>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = async () => {
          const db = req.result;
          const stores = ['notes', 'sessions', 'page', 'notebook_links'].filter((s) =>
            db.objectStoreNames.contains(s),
          );
          const tx = db.transaction(stores, 'readonly');
          const allNotes = await new Promise<Array<Record<string, unknown>>>((res, rej) => {
            const g = tx.objectStore('notes').getAll();
            g.onsuccess = () => res((g.result as Array<Record<string, unknown>>) ?? []);
            g.onerror = () => rej(g.error);
          });
          const matchingNotes = allNotes
            .filter((n) => n.id === noteId || n.title === 'Hero WOD')
            .map((n) => ({
              id: String(n.id),
              retention: typeof n.retention === 'string' ? n.retention : undefined,
              upstreamStatus: typeof n.upstreamStatus === 'string' ? n.upstreamStatus : undefined,
              seedOrigin: typeof n.seedOrigin === 'string' ? n.seedOrigin : undefined,
              rawContent: String(n.rawContent ?? ''),
            }));

          let pId: string | undefined;
          if (db.objectStoreNames.contains('sessions')) {
            const sessRow = await new Promise<Record<string, unknown> | undefined>((res, rej) => {
              const g = tx.objectStore('sessions').get(sessId);
              g.onsuccess = () => res(g.result as Record<string, unknown> | undefined);
              g.onerror = () => rej(g.error);
            });
            if (typeof sessRow?.pageId === 'string') pId = sessRow.pageId;
          }

          let sessionPageDate: string | undefined;
          if (pId && db.objectStoreNames.contains('page')) {
            const pageRow = await new Promise<Record<string, unknown> | undefined>((res, rej) => {
              const g = tx.objectStore('page').get(pId);
              g.onsuccess = () => res(g.result as Record<string, unknown> | undefined);
              g.onerror = () => rej(g.error);
            });
            if (typeof pageRow?.date === 'string') sessionPageDate = pageRow.date;
          }

          let hasJournalSessionLink = false;
          if (db.objectStoreNames.contains('notebook_links')) {
            const linkRow = await new Promise<unknown>((res, rej) => {
              const g = tx.objectStore('notebook_links').get(`notebook/journal:session:${sessId}`);
              g.onsuccess = () => res(g.result);
              g.onerror = () => rej(g.error);
            });
            hasJournalSessionLink = Boolean(linkRow);
          }

          db.close();
          resolve({ matchingNotes, sessionPageDate, hasJournalSessionLink });
        };
      }),
    { noteId: upstreamId, sessId: sessionId },
  );
}

test.describe('RUN-02 — read-only Feed intake & provenance run', () => {
  test('running a read-only Feed Note pins one archival copy under upstreamId and survives unsubscribe', async ({
    app,
  }, testInfo) => {
    test.setTimeout(180_000);
    const { page } = app;
    // The fast clock must be installed before the first app load.
    await app.runtime.useFastClock(25);

    const feed = await app.seed.mockPeerFeed(PEER_BASE, {
      name: 'E2E Readonly Run Feed',
      notebookSlug: 'peer-run-source',
      notes: [{ slug: 'hero-wod', title: 'Hero WOD', markdown: WOD_MD }],
    });
    const upstreamId = feed.noteIds[0]!;
    expect(upstreamId, 'the mock peer feed mints the canonical upstream uuid').toBeTruthy();

    // 1. Subscribe index-first through the consent card (zero bulk chunk download on subscribe).
    await app.goto(`/subscribe?source=${encodeURIComponent(PEER_BASE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)e2e-readonly-run-feed\}$/i);
    await app.feeds.waitForReady();
    expect(await getNoteContentByRouteId(page, upstreamId)).toBeNull();

    // 2. Open the subscribed Feed Notebook stream (on-demand index preview) and trigger Start workout from row overflow.
    await app.notebooks.openNotebook('peer-run-source');
    await expect(page.getByRole('heading', { name: /Hero WOD/i })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(TEST_IDS.LIBRARY_ROW_OVERFLOW).first().click();
    await page.getByTestId(TEST_IDS.LIBRARY_ACTION_RUN).first().click();
    const today = todayKey();
    await page.waitForURL(new RegExp(`/day/${today}`), { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    // 3. Step through the Ready-to-Start gate; the 0:03 AMRAP completes at 25×.
    await app.runtime.advance(1);
    await expect(page.getByText('Workout Complete')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 8_000 });
    await page.screenshot({ path: testInfo.outputPath('readonly-run-review.png') });

    // 4. Single-archival-copy contract: Session pins to upstreamId with today's Journal calendar Page & no clone Note.
    await expect
      .poll(async () => (await getSessions(page)).some((s) => s.completed), { timeout: 15_000 })
      .toBe(true);
    const session = (await getSessions(page)).find((s) => s.completed);
    const sessionId = session?.id;
    expect(sessionId, 'a completed session id is recorded').toBeTruthy();
    expect(session?.noteId, 'the session records directly against canonical upstreamId').toBe(upstreamId);

    const dbSnapshot = await inspectArchivalRunState(page, upstreamId, sessionId!);
    expect(dbSnapshot.matchingNotes, 'exactly one archival copy of Hero WOD exists in notes').toHaveLength(1);
    expect(dbSnapshot.matchingNotes[0]?.id).toBe(upstreamId);
    expect(dbSnapshot.matchingNotes[0]?.retention).toBe('session-pinned');
    expect(dbSnapshot.matchingNotes[0]?.rawContent).toBe(WOD_MD);
    expect(dbSnapshot.sessionPageDate, 'session links to today Journal calendar page').toBe(today);
    expect(dbSnapshot.hasJournalSessionLink, 'notebook/journal session link exists').toBe(true);

    // 5. /sessions and /results/:sessionId surface the recorded execution.
    await app.goto('/sessions');
    await expect(page.getByTestId(TEST_IDS.STREAM_VIEW).getByText(/Hero WOD/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await app.goto(`/results/${sessionId!}`);
    await expect(page).toHaveURL(new RegExp(`/results/${sessionId}`));
    await expect(page.getByText(/AMRAP|Air Squats|Hero WOD/i).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('readonly-run-results.png') });

    // 6. Canonical /note/:upstreamId renders Logged Workouts, Provenance, and non-Private badge.
    await app.editor.openNote(upstreamId);
    await expect(page.locator('.cm-content').first()).toContainText('0:03 AMRAP', { timeout: 15_000 });
    const pill = page.getByTestId(TEST_IDS.PUBLICATION_PILL);
    await expect(pill).not.toContainText(/Private/i);
    await expect(page.getByText(/Logged Workouts \(1\)/i)).toBeVisible();
    await expect(page.locator(`a[href="/results/${sessionId!}"]`)).toBeVisible();

    await app.feeds.openPromotionPopover();
    const provenanceRow = page.getByTestId(TEST_IDS.PROMOTION_PROVENANCE_ROW);
    await expect(provenanceRow).toBeVisible();
    await expect(provenanceRow.getByRole('link')).toHaveAttribute('href', `/note/${upstreamId}`);
    await app.feeds.closePromotionPopover();

    // 7. Unsubscribe the Feed via Settings -> Sync EditorDialog; pinned archival Note + Session survive.
    await app.goto('/settings/sync');
    const row = page.getByTestId('feed-source-e2e-readonly-run-feed');
    await expect(row).toBeVisible();
    await row.getByTestId('feed-more-e2e-readonly-run-feed').locator('summary').click();
    await row.getByTestId('feed-unsubscribe-e2e-readonly-run-feed').click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
    await expect(confirmDialog).toBeHidden();

    // Wait for unsubscribe sweep; verify pinned Note (upstreamStatus: 'unsubscribed') and Session stay intact.
    await expect
      .poll(async () => (await inspectArchivalRunState(page, upstreamId, sessionId!)).matchingNotes[0]?.upstreamStatus, {
        timeout: 15_000,
      })
      .toBe('unsubscribed');
    const afterUnsub = await inspectArchivalRunState(page, upstreamId, sessionId!);
    expect(afterUnsub.matchingNotes[0]?.retention).toBe('session-pinned');
    expect(afterUnsub.matchingNotes[0]?.rawContent).toBe(WOD_MD);
    expect((await getSessions(page)).some((s) => s.id === sessionId && s.completed)).toBe(true);

    // 8. Reopening /note/:upstreamId displays preserved archived badge, Logged Workouts, and (archived) provenance.
    await app.editor.openNote(upstreamId);
    const archivedPill = page.getByTestId(TEST_IDS.PUBLICATION_PILL);
    await expect(archivedPill).toHaveAttribute('data-ownership', 'feed-archived');
    await expect(archivedPill).toContainText(/Upstream removed — local copy preserved/i);
    await expect(page.locator(`a[href="/results/${sessionId!}"]`)).toBeVisible();
    await app.feeds.openPromotionPopover();
    await expect(page.getByTestId(TEST_IDS.PROMOTION_PROVENANCE_ROW)).toContainText(/archived/i);
    await app.feeds.closePromotionPopover();

    app.assertCleanConsole();
  });

  test('starting virtual cloud workouts via WorkoutEditorPage and remote NoteByIdPage creates zero ghost notes and pins session-pinned retention', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    await app.runtime.useFastClock(25);

    const feed = await app.seed.mockPeerFeed(CLOUD_PEER_BASE, {
      name: 'Cloud WOD Feed',
      notebookSlug: 'cloud-wod-source',
      notebookLabel: 'Cloud WOD Source',
      notes: [
        { slug: 'cloud-cindy', title: 'Cloud Cindy', markdown: CLOUD_CINDY_MD },
        { slug: 'cloud-annie', title: 'Cloud Annie', markdown: CLOUD_ANNIE_MD },
      ],
    });
    const cindyId = feed.noteIds[0]!;
    const annieId = feed.noteIds[1]!;

    await app.goto(`/subscribe?source=${encodeURIComponent(CLOUD_PEER_BASE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await app.feeds.waitForReady();
    expect(await getNoteContentByRouteId(page, cindyId)).toBeNull();
    expect(await getNoteContentByRouteId(page, annieId)).toBeNull();

    // 1. Open virtual cloud note in WorkoutEditorPage via remote notebook preview.
    await app.goto('/notebook/cloud-wod-source?feed=cloud-wod-feed');
    const stream = page.getByTestId(TEST_IDS.STREAM_VIEW);
    await expect(stream.getByText('Cloud Cindy').first()).toBeVisible({ timeout: 15_000 });
    await stream.getByText('Cloud Cindy').first().click();
    await expect(page).toHaveURL(/\/notebook\/cloud-wod-source\/cloud-cindy\?feed=cloud-wod-feed/);
    await expect(page.locator('.cm-content').first()).toContainText('0:03 AMRAP', { timeout: 15_000 });

    const beforeStart = await inspectNoteOwnershipState(page, [cindyId, annieId]);
    expect(beforeStart.ghostPlaygroundIds).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('wodwiki:pending-note-saves:v1'))).toBeNull();

    const startEditorBtn = page.getByRole('button', { name: 'Start / Log Workout', exact: true });
    await expect(startEditorBtn).toBeVisible({ timeout: 10_000 });
    await startEditorBtn.click();

    await page.waitForURL(/\/run\//, { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    const afterCindyStart = await inspectNoteOwnershipState(page, [cindyId, annieId]);
    expect(afterCindyStart.ghostPlaygroundIds).toEqual([]);
    expect(afterCindyStart.notesById[cindyId]?.retention).toBe('session-pinned');

    await app.runtime.advance(1);
    await expect(page.getByText('Workout Complete')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 8_000 });
    await page.waitForURL(/\/results\//, { timeout: 15_000 });

    // 2. Open virtual cloud note directly on NoteByIdPage (/note/remote:...).
    await app.goto(`/note/${encodeURIComponent(`remote:cloud-wod-feed:${annieId}`)}`);
    await expect(page.locator('.cm-content').first()).toContainText('0:03 AMRAP', { timeout: 15_000 });
    const startNoteBtn = page.getByRole('button', { name: 'Start / Log Workout', exact: true });
    await expect(startNoteBtn).toBeVisible({ timeout: 10_000 });
    await startNoteBtn.click();

    await page.waitForURL(/\/run\//, { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    const afterAnnieStart = await inspectNoteOwnershipState(page, [cindyId, annieId]);
    expect(afterAnnieStart.ghostPlaygroundIds).toEqual([]);
    expect(afterAnnieStart.notesById[annieId]?.retention).toBe('session-pinned');
    expect(await page.evaluate(() => localStorage.getItem('wodwiki:pending-note-saves:v1'))).toBeNull();

    app.assertCleanConsole();
  });

  test('starting locally authored wod and time notes via L3 Outline and /journal stream works cleanly without ghost notes', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const { page } = app;
    await app.runtime.useFastClock(25);

    const localWodId = 'local-run-wod-1';
    const localTimeId = 'local-run-time-1';
    const today = todayKey();
    const now = Date.now();
    await app.seed.world({
      notes: [
        {
          id: localWodId,
          title: 'Local Garage WOD',
          rawContent: LOCAL_WOD_MD,
          type: 'journal',
          notebookId: 'notebook/journal',
          sourceId: 'guides:starter-template',
          date: now,
          createdAt: now,
        },
        {
          id: localTimeId,
          title: 'Local Tempo Time',
          rawContent: LOCAL_TIME_MD,
          type: 'journal',
          notebookId: 'notebook/journal',
          date: now,
          createdAt: now,
        },
      ],
      pages: [{ id: `page-${today}`, date: today, createdAt: now }],
      pageNotes: [
        {
          id: `page-${today}:${localTimeId}`,
          pageId: `page-${today}`,
          noteId: localTimeId,
          position: 0,
          createdAt: now,
        },
      ],
    });

    // 1. Open guides-cloned local ```wod journal note -> verify user ownership & start via L3 Outline.
    await app.editor.openNote(localWodId);
    await expect(page.locator('.cm-content').first()).toContainText('0:03 AMRAP', { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.PUBLICATION_PILL)).toHaveAttribute('data-ownership', 'user');

    const l3Start = page.locator('button[title="Start workout"]:visible').first();
    const l3Trigger = page.getByRole('button', { name: 'Page options' });
    await expect(l3Start.or(l3Trigger).first()).toBeVisible({ timeout: 15_000 });
    if (!(await l3Start.isVisible().catch(() => false))) {
      await l3Trigger.click();
    }
    await expect(l3Start).toBeVisible({ timeout: 10_000 });
    await l3Start.hover();
    await l3Start.click();

    await page.waitForURL(/\/run\//, { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    const afterWodStart = await inspectNoteOwnershipState(page, [localWodId, localTimeId]);
    expect(afterWodStart.ghostPlaygroundIds).toEqual([]);

    await app.runtime.advance(1);
    await expect(page.getByText('Workout Complete')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 8_000 });
    await page.waitForURL(/\/results\//, { timeout: 15_000 });

    // 2. Open /journal and trigger Run directly on the local ```time note row.
    await app.goto('/journal');
    const journalStream = page.getByTestId(TEST_IDS.STREAM_VIEW);
    await expect(journalStream.getByText('Local Tempo Time').first()).toBeVisible({ timeout: 15_000 });
    const rowRunBtn = journalStream
      .locator('[role="button"]', { hasText: 'Local Tempo Time' })
      .first()
      .getByTestId(TEST_IDS.LIBRARY_ACTION_RUN);
    await expect(rowRunBtn).toBeVisible({ timeout: 10_000 });
    await rowRunBtn.click();

    await page.waitForURL(/\/run\//, { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    const afterTimeStart = await inspectNoteOwnershipState(page, [localWodId, localTimeId]);
    expect(afterTimeStart.ghostPlaygroundIds).toEqual([]);

    app.assertCleanConsole();
  });
});
