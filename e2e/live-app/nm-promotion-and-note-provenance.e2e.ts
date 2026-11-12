// spec: e2e/specs/notebooks/nm-promotion-and-note-provenance.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';

const PROMO_NOTE_ID = '01950000-0000-7000-8000-000000000902';
const PROMO_MD = '# N:M Promotion WOD\n\n```time\n21-15-9\n  Air Squats\n  Push-ups\n```\n';
const PEER_BASE = 'https://peer.example.org/nbk-02-provenance/';
const CINDY_MD = '# Benchmark Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```\n';

test.describe('NBK-02 — N:M Notebook Promotion & Note Provenance', () => {
  test('promotes one Note across multiple user Notebooks on desktop and 375x812 mobile while preserving UUID', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    await app.seed.world({
      notes: [{ id: PROMO_NOTE_ID, title: 'N:M Promotion WOD', rawContent: PROMO_MD, seedOrigin: 'user' }],
    });

    await app.editor.openNote(PROMO_NOTE_ID);
    await app.feeds.openPromotionPopover();

    const newNbInput = page.getByTestId(TEST_IDS.PROMOTION_NEW_NOTEBOOK_INPUT);
    const newNbSubmit = page.getByTestId(TEST_IDS.PROMOTION_NEW_NOTEBOOK_SUBMIT);

    await newNbInput.fill('Garage Crew');
    await newNbSubmit.click();
    await expect(page.getByTestId('promotion-notebook-chip-notebook/garage-crew')).toBeVisible();

    await newNbInput.fill('Travel WODs');
    await newNbSubmit.click();
    await expect(page.getByTestId('promotion-notebook-chip-notebook/travel-wods')).toBeVisible();

    // Canonical Note UUID does not change on N:M NotebookLink promotion
    await expect(page).toHaveURL(new RegExp(`/note/${PROMO_NOTE_ID}$`));
    await app.feeds.closePromotionPopover();

    // Verify 375x812 mobile bottom sheet has zero horizontal overflow
    await page.setViewportSize({ width: 375, height: 812 });
    await app.editor.openNote(PROMO_NOTE_ID);
    await app.feeds.openPromotionPopover();
    await expect(page.getByTestId('promotion-notebook-chip-notebook/garage-crew')).toBeVisible();
    await expect(page.getByTestId('promotion-notebook-chip-notebook/travel-wods')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, 'no horizontal overflow at 375x812').toBe(false);
    await app.feeds.closePromotionPopover();

    // Verify both user Notebooks list the promoted Note via :notebook{} WQL
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.wql.setStreamLayout('/notebooks', 'feed');
    await app.wql.queryStream('/notebooks', ':notebook{notebook:garage-crew}');
    await app.wql.expectStreamContains('N:M Promotion WOD');

    await app.wql.queryStream('/notebooks', ':notebook{notebook:travel-wods}');
    await app.wql.expectStreamContains('N:M Promotion WOD');

    app.assertCleanConsole();
  });

  test('read-only Feed Note clones to Journal via NotePromotionSheet with live Note Provenance lineage', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const feed = await app.seed.mockPeerFeed(PEER_BASE, {
      name: 'NBK-02 Peer Feed',
      notebookSlug: 'benchmark-library',
      notes: [{ slug: 'cindy', title: 'Benchmark Cindy', markdown: CINDY_MD }],
    });
    const upstreamId = feed.noteIds[0]!;

    await app.goto(`/subscribe?source=${encodeURIComponent(PEER_BASE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)nbk-02-peer-feed\}$/i);
    await app.feeds.waitForReady();
    await expect.poll(() => getNoteContentByRouteId(page, upstreamId), { timeout: 15_000 }).toBe(CINDY_MD);

    // Open upstream read-only Note and trigger Clone to Journal
    await app.editor.openNote(upstreamId);
    await app.feeds.openPromotionPopover();
    const cloneBtn = page.getByTestId(TEST_IDS.PROMOTION_CLONE_READONLY_BTN);
    await expect(cloneBtn).toBeVisible();
    await cloneBtn.click();

    // Clone navigates to a new editable Note (or placement dialog submit if shown)
    const placementCloneSubmit = page.getByTestId(TEST_IDS.PLACEMENT_CLONE_SUBMIT_BTN);
    if ((await placementCloneSubmit.count()) > 0 && (await placementCloneSubmit.isVisible().catch(() => false))) {
      await placementCloneSubmit.click();
    }

    await expect(page).not.toHaveURL(new RegExp(`/note/${upstreamId}$`), { timeout: 15_000 });
    await expect(page.locator('.cm-content').first()).toContainText('20:00 AMRAP', { timeout: 15_000 });

    // Inspect NotePromotionSheet on the cloned Note -> Origin links back to upstreamId
    await app.feeds.openPromotionPopover();
    const provenanceRow = page.getByTestId(TEST_IDS.PROMOTION_PROVENANCE_ROW);
    await expect(provenanceRow).toBeVisible();
    await expect(provenanceRow.getByRole('link')).toHaveAttribute('href', `/note/${upstreamId}`);
    await app.feeds.closePromotionPopover();

    expect(await getNoteContentByRouteId(page, upstreamId)).toBe(CINDY_MD);
    app.assertCleanConsole();
  });
});
