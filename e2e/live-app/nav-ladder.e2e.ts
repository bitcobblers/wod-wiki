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
