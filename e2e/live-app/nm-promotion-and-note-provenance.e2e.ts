// spec: e2e/specs/notebooks/nm-promotion-and-note-provenance.md
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';

const PROMO_NOTE_ID = '01950000-0000-7000-8000-000000000902';
const PROMO_MD = '# N:M Promotion WOD\n\n```time\n21-15-9\n  Air Squats\n  Push-ups\n```\n';
const PEER_BASE = 'https://peer.example.org/nbk-02-provenance/';
const CINDY_MD = '# Benchmark Cindy\n\n```time\n20:00 AMRAP\n  5 Pull-ups\n  10 Push-ups\n  15 Air Squats\n```\n';
const REMOTE_PREVIEW_BASE = 'https://peer.example.org/kettlebell-feed/';
const KB_DAY1_MD =
  '---\ntitle: KB Day 1\ndate: 2026-11-01\n---\n\n# KB Day 1\n\n```time\n100 Kettlebell Swings\n```\n';

test.describe('NBK-02 — N:M Notebook Promotion & Note Provenance', () => {
  test('promotes one Note across multiple user Notebooks and opens PropertyOverrideSheet on 375x812 mobile', async ({
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

    // Verify 375x812 mobile bottom sheets (NotePromotionSheet + PropertyOverrideSheet) have zero horizontal overflow
    await page.setViewportSize({ width: 375, height: 812 });
    await app.editor.openNote(PROMO_NOTE_ID);
    await app.feeds.openPromotionPopover();
    await expect(page.getByTestId('promotion-notebook-chip-notebook/garage-crew')).toBeVisible();
    await expect(page.getByTestId('promotion-notebook-chip-notebook/travel-wods')).toBeVisible();
    const promoOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(promoOverflow, 'no horizontal overflow on NotePromotionSheet at 375x812').toBe(false);
    await app.feeds.closePromotionPopover();

    // Mobile Scoped Property Override sheet targeting personal `notebook/custom`
    await app.properties.openEffort('air-squat');
    const overrideBtn = page.getByTestId('effort-detail-override-btn');
    await expect(overrideBtn).toBeVisible();
    await overrideBtn.click();
    const overrideOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overrideOverflow, 'no horizontal overflow on PropertyOverrideSheet at 375x812').toBe(false);
    await app.properties.saveScopedOverride('notebook/custom');
    await expect(page.getByTestId(TEST_IDS.PROPERTY_OVERRIDE_SHEET)).toBeHidden();

    // Verify both user Notebooks list the promoted Note via :notebook{} WQL
    await page.setViewportSize({ width: 1280, height: 900 });
    await app.wql.setStreamLayout('/notebooks', 'feed');
    await app.wql.queryStream('/notebooks', ':notebook{notebook:garage-crew}');
    await app.wql.expectStreamContains('N:M Promotion WOD');

    await app.wql.queryStream('/notebooks', ':notebook{notebook:travel-wods}');
    await app.wql.expectStreamContains('N:M Promotion WOD');

    app.assertCleanConsole();
  });

  test('read-only Feed Note shows ownership badge and forks to editable copy via NotePromotionSheet with live Note Provenance lineage', async ({
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
    // Opt into full offline download so the upstream read-only Note is locally cached for direct /note/:id inspection.
    await banner.getByRole('checkbox', { name: /Download for offline/i }).check();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)nbk-02-peer-feed\}$/i);
    await app.feeds.waitForReady();
    await expect.poll(() => getNoteContentByRouteId(page, upstreamId), { timeout: 15_000 }).toBe(CINDY_MD);

    // Open upstream read-only Note and verify Feed ownership UI (no "Private" padlock)
    await app.editor.openNote(upstreamId);
    const pill = page.getByTestId(TEST_IDS.PUBLICATION_PILL);
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-ownership', 'feed');
    await expect(pill).toContainText(/From NBK-02 Peer Feed.*Read-only/i);
    await expect(pill).not.toContainText(/Private/i);

    // Open NotePromotionSheet and fork into an editable user notebook copy
    await app.feeds.openPromotionPopover();
    const popover = page.getByTestId(TEST_IDS.PUBLICATION_PILL_POPOVER);
    await expect(popover).toContainText('Provenance & Local Copy');
    await expect(popover).toContainText(/From NBK-02 Peer Feed.*Read-only/i);
    await expect(popover.locator('#promotion-fork-notebook')).toBeVisible();
    await popover.getByRole('button', { name: 'Fork to My Notes', exact: true }).click();

    await expect(page).toHaveURL(/\/note\/[^/]+\?edit=1$/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(new RegExp(`/note/${upstreamId}`), { timeout: 15_000 });
    await expect(page.locator('.cm-content').first()).toContainText('20:00 AMRAP', { timeout: 15_000 });

    // Forked user copy becomes writable with Origin provenance back to upstreamId
    const forkedPill = page.getByTestId(TEST_IDS.PUBLICATION_PILL);
    await expect(forkedPill).toHaveAttribute('data-ownership', 'user');
    await app.feeds.openPromotionPopover();
    const provenanceRow = page.getByTestId(TEST_IDS.PROMOTION_PROVENANCE_ROW);
    await expect(provenanceRow).toBeVisible();
    await expect(provenanceRow.getByRole('link')).toHaveAttribute('href', `/note/${upstreamId}`);
    await app.feeds.closePromotionPopover();

    expect(await getNoteContentByRouteId(page, upstreamId)).toBe(CINDY_MD);
    app.assertCleanConsole();
  });

  test('index-first peer Feed previews a remote Notebook on demand with zero bulk import and clones via Clone to My Notes dialog', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 900 });

    const peer = await app.seed.mockPeerFeed(REMOTE_PREVIEW_BASE, {
      name: 'Peer Kettlebell Feed',
      notebookSlug: 'kettlebell-club',
      notebookLabel: 'Kettlebell Club',
      notes: [{ slug: 'day-1', title: 'KB Day 1', markdown: KB_DAY1_MD, dateIso: '2026-11-01T12:00:00Z' }],
    });

    await app.goto(`/subscribe?source=${encodeURIComponent(REMOTE_PREVIEW_BASE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    // Default Subscribe is index-first (zero eager bulk chunk download)
    await expect(banner.getByRole('checkbox', { name: /Download for offline/i })).not.toBeChecked();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)peer-kettlebell-feed/i);
    await app.feeds.waitForReady();

    // Zero bulk import: upstream note is not yet stored in IndexedDB
    expect(await getNoteContentByRouteId(page, peer.noteIds[0]!)).toBeNull();

    // Open remote Notebook preview, clone via Clone to My Notes dialog, then verify on-demand single-workout viewing
    await app.goto('/notebook/kettlebell-club?feed=peer-kettlebell-feed');
    await expect(page.getByTestId(TEST_IDS.REMOTE_NOTEBOOK_PREVIEW_BANNER)).toBeVisible();
    const stream = page.getByTestId(TEST_IDS.STREAM_VIEW);
    await expect(stream.getByText('KB Day 1').first()).toBeVisible();

    const cloneBtn = stream.locator('[data-testid^="row-clone-remote-"]').first();
    await expect(cloneBtn).toBeVisible();
    await cloneBtn.click();

    const cloneDialog = page.getByRole('dialog');
    await expect(cloneDialog.getByRole('heading', { name: 'Clone to My Notes' })).toBeVisible();
    await expect(cloneDialog.locator('#clone-target-notebook')).toBeVisible();
    await cloneDialog.getByRole('button', { name: 'Clone to Notebook', exact: true }).click();
    await expect(page.getByText(/Cloned "KB Day 1"/i).first()).toBeVisible();

    // On-demand workout viewing loads the note read-only without importing the whole chunk
    await stream.getByText('KB Day 1').first().click();
    await expect(page).toHaveURL(/\/notebook\/kettlebell-club\/day-1\?feed=peer-kettlebell-feed/);
    await expect(page.locator('.cm-content').first()).toContainText('100 Kettlebell Swings', { timeout: 15_000 });
    await expect(page.getByText(/Feed · Read-only/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start / Log Workout', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fork to My Notes', exact: true })).toBeVisible();

    app.assertCleanConsole();
  });
});
