// spec: e2e/specs/runtime/readonly-intake-and-provenance-run.md
/**
 * RUN-02 — Read-only intake & provenance run (P0-gate)
 *
 * A subscribed peer Feed delivers one read-only workout Note. Running it must
 * snapshot the Note verbatim into private `notebook/journal` carrying Note
 * Provenance back to the upstream Note, record a completed Session reachable
 * at /results/:sessionId, and leave the upstream Feed Note byte-identical.
 */

import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';
import { getSessions } from '../utils/sessionsDb';

const PEER_BASE = 'https://peer.example.org/readonly-run/';
const WOD_MD = '# Hero WOD\n\n```time\n0:03 AMRAP\n  5 Air Squats\n```\n';

function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

test.describe('RUN-02 — read-only Feed intake & provenance run', () => {
  test('running a subscribed read-only Feed Note snapshots into the Journal with Note Provenance and leaves upstream untouched', async ({ app }, testInfo) => {
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

    // 1. Subscribe through the real consent surface; the intake imports the notebook.
    await app.goto(`/subscribe?source=${encodeURIComponent(PEER_BASE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)e2e-readonly-run-feed\}$/i);
    await app.feeds.waitForReady();

    const imported = await getNoteContentByRouteId(page, upstreamId);
    expect(imported, 'the Feed import lands the authored markdown verbatim').toBe(WOD_MD);

    // 2. Open the subscribed Feed Notebook stream and click Run on the read-only Note card.
    await app.notebooks.openNotebook('peer-run-source');
    await expect(page.getByRole('heading', { name: /Hero WOD/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Run', exact: true }).first().click();
    const today = todayKey();
    await page.waitForURL(new RegExp(`/day/${today}`), { timeout: 15_000 });
    await expect(page.locator('.cm-content'), 'the Journal snapshot carries the workout').toContainText('0:03 AMRAP', { timeout: 15_000 });
    await expect(page.getByTestId(TEST_IDS.TIMER_STOP_SESSION).first()).toBeVisible({ timeout: 15_000 });

    // 3. Step through the Ready-to-Start gate; the 0:03 AMRAP completes at 25×.
    await app.runtime.advance(1);
    await expect(page.getByText('Workout Complete')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first().click();
    await expect(page.getByTestId(TEST_IDS.FOCUSED_DIALOG_CLOSE).first()).toBeHidden({ timeout: 8_000 });
    await expect(
      page.locator('.cm-query-block-preview, [data-testid="rows-table"]').first(),
      'the completed result renders inline on the Journal snapshot',
    ).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('readonly-run-review.png') });

    // 4. The completed Session belongs to the cloned Journal note, never upstream.
    await expect
      .poll(async () => (await getSessions(page)).some((s) => s.completed), { timeout: 15_000 })
      .toBe(true);
    const session = (await getSessions(page)).find((s) => s.completed);
    const sessionId = session?.id;
    const cloneId = session?.noteId;
    expect(sessionId, 'a completed session id is recorded').toBeTruthy();
    expect(cloneId, 'the session carries the clone id').toBeTruthy();
    expect(cloneId, 'the session is not recorded against the upstream note').not.toBe(upstreamId);

    // 5. The snapshot persists on the Journal calendar with its own note id.
    await app.journal.expectNotePersisted(`journal/${today}`, '0:03 AMRAP');
    const cloneStored = await app.editor.readStoredContent(cloneId!);
    expect(cloneStored, 'the Journal snapshot preserves the workout verbatim').toContain(WOD_MD.trim());
    expect(cloneStored, 'the completed Session query widget is embedded on the clone').toContain(`:session{result:${sessionId}}`);

    // 6. The canonical results route resolves the recorded execution.
    await app.goto(`/results/${sessionId!}`);
    await expect(page).toHaveURL(new RegExp(`/results/${sessionId}`));
    await expect(page.getByText(/AMRAP|Air Squats|Hero WOD/i).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('readonly-run-results.png') });

    // 7. Note Provenance: the clone's promotion sheet links the upstream note.
    await app.editor.openNote(cloneId!);
    await app.feeds.openPromotionPopover();
    const provenanceRow = page.getByTestId(TEST_IDS.PROMOTION_PROVENANCE_ROW);
    await expect(provenanceRow).toBeVisible();
    await expect(provenanceRow.getByRole('link')).toHaveAttribute('href', `/note/${upstreamId}`);
    await app.feeds.closePromotionPopover();

    // 8. The upstream Seed Note is untouched: byte-identical and still rendered.
    expect(await getNoteContentByRouteId(page, upstreamId), 'upstream content untouched by the run').toBe(imported);
    await app.editor.openNote(upstreamId);
    await expect(page.locator('.cm-content')).toContainText('0:03 AMRAP', { timeout: 15_000 });
    await app.assertCleanConsole();
  });
});
