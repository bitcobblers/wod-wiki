/**
 * Navigation ladder acceptance (ticket 10) — L1 list, L2 thing, L3 place.
 *
 * Validates against the live app:
 *  1. Every L1 zone is a canonical library list route. Efforts, Equipment,
 *     and Tags have their own L1 destinations and route-keyed saved queries.
 *     Tags adds one default L2 filter per registered tag type.
 *  2. Active state follows route identity: the notebooks zone lights for the
 *     whole notebook family (/notebooks, /notebook/:slug, /journal,
 *     /day/:date, /playgrounds) and only that family.
 *  3. The journal and playgrounds views render inside the notebooks zone's
 *     L2 panel — each with its own view chrome (create actions, landing).
 *  4. L3 remains the injected document index ("On this page") for page, note
 *     and dashboard documents on a desktop viewport.
 */

import { expect, test } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

const L1_LABELS = ['Home', 'Notebooks', 'Journal', 'Pages', 'Efforts', 'Equipment', 'Tags', 'Dashboards', 'Sessions'];

test.describe('Nav ladder — L1 zones derive from the route scheme', () => {
  test('L1 rail labels include the primary effort, equipment, and tag libraries', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-boot-feed-settled', /^\d+(\.\d+)?$/, { timeout: 30_000 });
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

    const primary = page.getByRole('navigation', { name: 'Primary' });
    for (const label of L1_LABELS) {
      await expect(primary.getByRole('button', { name: label, exact: true }), `L1 ${label}`).toBeVisible();
    }
    // Notes, Feeds, and Playgrounds remain outside the L1 rail.
    for (const label of ['Notes', 'Feeds', 'Playgrounds']) {
      await expect(primary.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('active state follows route identity across the home, notebook and journal families', async ({ page }) => {
    const primary = page.getByRole('navigation', { name: 'Primary' });
    const homeBtn = primary.getByRole('button', { name: 'Home', exact: true });
    const notebooksBtn = primary.getByRole('button', { name: 'Notebooks', exact: true });
    const journalBtn = primary.getByRole('button', { name: 'Journal', exact: true });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(homeBtn, 'Home L1 active on /').toHaveAttribute('aria-current', 'page', { timeout: 15_000 });

    for (const path of ['/notebooks', '/notebook/crossfit-girls', '/playgrounds']) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(notebooksBtn, `Notebooks L1 active on ${path}`).toHaveAttribute('aria-current', 'page', {
        timeout: 15_000,
      });
    }

    for (const path of ['/journal', '/day/2099-12-31']) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(journalBtn, `Journal L1 active on ${path}`).toHaveAttribute('aria-current', 'page', {
        timeout: 15_000,
      });
    }

    // Pages zone lights on /pages and rolled-up routes (/notes, /sessions, etc.)
    await page.goto('/pages', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(notebooksBtn).not.toHaveAttribute('aria-current', 'page');
    await expect(primary.getByRole('button', { name: 'Pages', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('promoted libraries render their own saved-query panels and tag-type filters', async ({ page }) => {
    const primary = page.getByRole('navigation', { name: 'Primary' });
    const sidebar = page.getByRole('navigation', { name: 'Main' });

    for (const [path, label, landing] of [
      ['/efforts', 'Efforts', 'All Efforts'],
      ['/equipment', 'Equipment', 'All Equipment'],
      ['/tags', 'Tags', 'All Tags'],
      ['/sessions', 'Sessions', 'All Sessions'],
    ] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await waitForFeedReady(page);
      await expect(primary.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(sidebar.getByRole('button', { name: landing, exact: true })).toBeVisible();
      const queryLinks = sidebar.getByTestId('conditions-nav-panel').locator('[data-slot="section"]').first();
      await expect(queryLinks.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0);
      await expect(queryLinks.getByRole('button', { name: 'Sessions', exact: true })).toHaveCount(0);
      if (path === '/sessions') {
        await page.screenshot({ path: '/tmp/sessions-l1.png', fullPage: true });
      }
    }

    await page.goto('/tags', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(sidebar.getByTestId('nav-shortcut-tag-type-equipment')).toBeVisible();
    await expect(sidebar.getByTestId('nav-shortcut-tag-type-discipline')).toBeVisible();
    await sidebar.getByTestId('nav-shortcut-tag-type-equipment').click();
    await expect(page).toHaveURL(/\/tags\?q=/);
    await expect(sidebar.getByTestId('nav-shortcut-tag-type-equipment')).toHaveAttribute('aria-current', 'page');
  });

  test('the journal view renders inside the notebooks zone with its own chrome', async ({ page }) => {
    await page.goto('/journal', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

    // L2 chrome lives in the context sidebar under the named 'Main' desktop
    // landmark (the 'Primary' nav carries the L1 icon rail only; an unnamed
    // sidebar nav and a 'Breadcrumb' landmark also exist — never .first()).
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    // Journal view chrome: landing and the two view rows. Creation lives in
    // the sticky header, not the L2 panel.
    await expect(sidebar.getByRole('button', { name: 'Journal', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'All entries', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'New journal entry' })).toHaveCount(0);
    // The sticky header owns creation.
    await expect(page.getByTestId('new-entry-primary')).toHaveText('+ Add');
  });

  test('the notebooks landing and the playgrounds view keep their own chrome', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-boot-feed-settled', /^\d+(\.\d+)?$/, { timeout: 30_000 });
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await expect(sidebar.getByRole('button', { name: 'Subscribed notebooks', exact: true })).toBeVisible();
    // The L2 panel offers no create actions on any view.
    await expect(sidebar.getByRole('button', { name: 'New journal entry' })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'New playground' })).toHaveCount(0);

    await page.goto('/playgrounds', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(sidebar.getByRole('button', { name: 'All playgrounds', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'New playground' })).toHaveCount(0);
    await expect(page.getByTestId('new-entry-primary')).toHaveText('+ Add');
  });
});

test.describe('Nav ladder — mobile (375px)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('mobile drawer: Journal is an L1 destination; Playgrounds is reachable with its own chrome', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-boot-feed-settled', /^\d+(\.\d+)?$/, { timeout: 30_000 });
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

    // Same drawer trigger the page objects use (e.g. EquipmentPage).
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    const primary = drawer.getByRole('navigation', { name: 'Primary' });

    // Journal is an L1 rail button; Playgrounds is not in the L1 rail
    await expect(primary.getByRole('button', { name: 'Journal', exact: true })).toBeVisible();
    await expect(primary.getByRole('button', { name: 'Playgrounds', exact: true })).toHaveCount(0);

    // Open Notebooks: the L2 panel offers Playgrounds and Subscribed notebooks.
    await primary.getByRole('button', { name: 'Notebooks', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(drawer.getByRole('button', { name: 'Playgrounds', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Subscribed notebooks', exact: true })).toBeVisible();
    // Primary rail Journal button navigates to /journal and dismisses the drawer
    await primary.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page).toHaveURL(/\/journal(?:\?.*)?$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(drawer.getByRole('button', { name: 'All entries', exact: true })).toBeVisible();
    // The L2 panel has no create action — the dock FAB owns creation.
    await expect(drawer.getByRole('button', { name: 'New journal entry' })).toHaveCount(0);
    // Playgrounds view: reachable through Notebooks L1.
    await primary.getByRole('button', { name: 'Notebooks', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await drawer.getByRole('button', { name: 'Playgrounds', exact: true }).click();
    await expect(page).toHaveURL(/\/playgrounds(?:\?.*)?$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(drawer.getByRole('button', { name: 'All playgrounds', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'New playground' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('mobile outline sheet selects the right section and closes its backdrop', async ({ page }) => {
    await page.goto('/page/guide-start', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await page.getByRole('button', { name: 'Open page options' }).click();
    const drawer = page.getByTestId('l3-right-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Three rules', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/h=first-workout/);
  });

  test('browser Back dismisses the mobile drawer without navigating underneath it', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-boot-feed-settled', /^\d+(\.\d+)?$/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveCount(0);
  });
});

test.describe('Nav ladder — L3 document index', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('a page document publishes the On this page index', async ({ page }) => {
    await page.goto('/page/guide-start', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.getByText('On this page', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Page options' }).click();
    await page.getByRole('button', { name: 'Three rules', exact: true }).click();
    await expect(page).toHaveURL(/h=first-workout/);
  });

  test('a note document publishes the On this page index', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await seedNote(page, 'nav-ladder-note', '# Nav Ladder Note\n\n## First section\n\nBody.\n\n## Second section\n\nBody.\n', {
      title: 'Nav Ladder Note',
    });
    await page.goto('/note/nav-ladder-note', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
    const rail = page.getByText('On this page', { exact: true });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    // TOC entries are scroll actions (role button), not route links.
    await expect(page.getByRole('button', { name: 'First section' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Second section' })).toBeVisible();
  });

  test('a dashboard document publishes the On this page index', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await seedNote(
      page,
      'dashboard/nav-ladder-dashboard',
      '---\ndashboard: true\nslug: nav-ladder-dashboard\ntitle: Nav Ladder Dashboard\n---\n\n# Nav Ladder Dashboard\n\n## Overview\n\n## Trends\n',
      { type: 'dashboard', title: 'Nav Ladder Dashboard' },
    );
    await page.goto('/dashboard/nav-ladder-dashboard', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Nav Ladder Dashboard' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('On this page', { exact: true })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Nav ladder — Phase 2 contextual L2/L3 sync, inline saved links & dashboards', () => {
  test('note page syncs L2/L3 live while typing, creates unrecognized items in place, and navigates 2-part facet + page links', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-boot-feed-settled', /^\d+(\.\d+)?$/, { timeout: 30_000 });

    await seedNote(
      page,
      'nav-live-facets-note',
      '# Morning Prep\n\n```time\n21-15-9\n  Thrusters 95 lb\n  Pull-ups\n```\n',
      { title: 'Morning Prep' },
    );

    await page.goto('/note/nav-live-facets-note?edit=1', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const editor = page.locator('.cm-content').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });

    const sidebar = page.getByRole('navigation', { name: 'Main' }).locator('nav').last();

    // Initial recognized efforts appear in L2 with 2-part filter buttons
    await expect(sidebar.getByText('Efforts', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(sidebar.getByRole('button', { name: 'Thruster', exact: true })).toBeVisible();

    // Append a new heading + known equipment + unrecognized effort & tag live into the editor
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n\n## Finisher\n#hyroxprep\n\n```time\n12 Kettlebell Zottman Curl\n```\n');

    // L3 outline ("On this page") updates live without reload
    await expect(page.getByRole('button', { name: 'Finisher', exact: true })).toBeVisible({ timeout: 10_000 });

    // L2 Equipment & Unrecognized + L3 Define action update live
    await expect(sidebar.getByRole('button', { name: 'Kettlebell', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByText('Unrecognized', { exact: true })).toBeVisible();
    const defineAction = page.getByTestId('l3-define-zottman-curl').first();
    await expect(defineAction).toBeVisible({ timeout: 10_000 });

    // Define "Zottman Curl" in place as an Effort
    await defineAction.click();
    const dialog = page.getByTestId('create-reference-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('create-reference-submit').click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Zottman Curl immediately graduates from Unrecognized into a 2-part Effort link in L2!
    await expect(sidebar.getByTestId('menu-filter-note-context-efforts:zottman-curl')).toBeVisible({ timeout: 10_000 });

    // Upgrade note to a Page and verify Pages container membership appears in L2
    await page.getByTestId('note-upgrade-to-page-btn').click();
    await page.getByTestId('note-page-slug-input').fill('morning-prep-board');
    await page.getByTestId('note-page-slug-save').click();
    await expect(sidebar.getByText('Pages', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByRole('button', { name: 'Morning Prep', exact: true })).toBeVisible();

    // Part 2 of 2-part link navigates to /notes filtered by that effort
    await sidebar.getByTestId('menu-filter-note-context-efforts:zottman-curl').click();
    await expect(page).toHaveURL(/\/notes\?q=.*zottman-curl/);

    // Go back and click Part 1 of 2-part link → canonical /effort/zottman-curl page
    await page.goBack();
    await expect(sidebar.getByRole('button', { name: 'Zottman Curl', exact: true })).toBeVisible({ timeout: 15_000 });
    await sidebar.getByRole('button', { name: 'Zottman Curl', exact: true }).click();
    await expect(page).toHaveURL(/\/effort\/zottman-curl$/);
  });

  test('library L2 inline saved-link editor creates, edits, and deletes links cleanly on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/notes', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.includes('routeWql'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);

    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await sidebar.getByTestId('conditions-nav-shortcut-add').click();
    await expect(sidebar.getByTestId('conditions-nav-inline-editor')).toBeVisible();

    await sidebar.getByTestId('conditions-nav-editor-label').fill('Kettlebell Notes');
    await sidebar.getByTestId('conditions-nav-editor-wql').fill(':note{equipment:kettlebell}');
    await sidebar.getByTestId('conditions-nav-editor-save').click();

    await expect(sidebar.getByRole('button', { name: 'Kettlebell Notes', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/notes\?q=.*equipment%3Akettlebell/);

    // Edit & delete inline via Manage mode
    await sidebar.getByTestId('conditions-nav-edit-toggle').click();
    await sidebar.getByRole('button', { name: 'Edit Kettlebell Notes' }).click();
    await sidebar.getByTestId('conditions-nav-editor-label').fill('KB Sessions');
    await sidebar.getByTestId('conditions-nav-editor-save').click();
    await expect(sidebar.getByText('KB Sessions', { exact: true })).toBeVisible();

    await sidebar.getByRole('button', { name: 'Delete KB Sessions' }).click();
    await expect(sidebar.getByText('KB Sessions', { exact: true })).toHaveCount(0);
    await sidebar.getByTestId('conditions-nav-edit-toggle').click();
  });

  test('library L2 inline saved-link editor works inside the 375px mobile drawer without stacked modals', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/journal', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.includes('routeWql'))
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    await drawer.getByTestId('conditions-nav-shortcut-add').click();
    await expect(drawer.getByTestId('conditions-nav-inline-editor')).toBeVisible();
    // Still a single dialog (no stacked modal over the drawer)
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await drawer.getByTestId('conditions-nav-editor-label').fill('12 Week Log');
    await drawer.getByTestId('conditions-nav-editor-wql').fill(':journal{} last 12w');
    await drawer.getByTestId('conditions-nav-editor-save').click();

    // Drawer remains open after saving in-place, then closes when clicking the saved link
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: '12 Week Log', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/journal\?q=.*12w/);
  });

  test('dashboard L2 switcher live-syncs newly created saved dashboards with unique slugs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboards', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await sidebar.getByTestId('dashboards-nav-new').click();
    await expect(page).toHaveURL(/\/dashboard\/new-dashboard$/);
    await expect(sidebar.getByTestId('dashboards-nav-saved')).toBeVisible({ timeout: 10_000 });
    await expect(sidebar.getByTestId('dashboard-nav-item-new-dashboard')).toBeVisible();

    // Creating a second dashboard deduplicates slug and updates L2 immediately without reload
    await sidebar.getByTestId('dashboards-nav-new').click();
    await expect(page).toHaveURL(/\/dashboard\/new-dashboard-2$/);
    await expect(sidebar.getByTestId('dashboard-nav-item-new-dashboard-2')).toBeVisible({ timeout: 10_000 });

    // Switch back to the first saved dashboard via L2
    await sidebar.getByTestId('dashboard-nav-item-new-dashboard').click();
    await expect(page).toHaveURL(/\/dashboard\/new-dashboard$/);
  });
});
