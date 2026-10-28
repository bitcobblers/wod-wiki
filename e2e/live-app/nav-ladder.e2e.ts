/**
 * Navigation ladder acceptance (ticket 10) — L1 list, L2 thing, L3 place.
 *
 * Validates against the live app:
 *  1. Every L1 zone is a canonical library list route and its label IS the
 *     route's name (Notebooks, Notes, Feeds, Pages, Dashboards, Efforts,
 *     Equipment, Sessions, Tags). Journal and Playgrounds are NOT L1 zones.
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

const L1_LABELS = ['Notebooks', 'Journal', 'Pages', 'Dashboards'];

test.describe('Nav ladder — L1 zones derive from the route scheme', () => {
  test('L1 rail labels are the primary domains (Notebooks, Journal, Pages, Dashboards); entity lists are rolled up', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

    const primary = page.getByRole('navigation', { name: 'Primary' });
    for (const label of L1_LABELS) {
      await expect(primary.getByRole('button', { name: label, exact: true }), `L1 ${label}`).toBeVisible();
    }
    // Notes, Feeds, Efforts, Equipment, Sessions, Tags, Playgrounds are not L1 rail items.
    for (const label of ['Notes', 'Feeds', 'Efforts', 'Equipment', 'Sessions', 'Tags', 'Playgrounds']) {
      await expect(primary.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('active state follows route identity across the notebook and journal families', async ({ page }) => {
    const primary = page.getByRole('navigation', { name: 'Primary' });
    const notebooksBtn = primary.getByRole('button', { name: 'Notebooks', exact: true });
    const journalBtn = primary.getByRole('button', { name: 'Journal', exact: true });

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

  test('the journal view renders inside the notebooks zone with its own chrome', async ({ page }) => {
    await page.goto('/journal', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });

    // L2 chrome lives in the context sidebar under the named 'Main' desktop
    // landmark (the 'Primary' nav carries the L1 icon rail only; an unnamed
    // sidebar nav and a 'Breadcrumb' landmark also exist — never .first()).
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    // Journal view chrome: create action, landing, and the two view rows.
    await expect(sidebar.getByRole('button', { name: 'New journal entry' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Journal', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Playgrounds', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'All entries', exact: true })).toBeVisible();
  });

  test('the notebooks landing and the playgrounds view keep their own chrome', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await expect(sidebar.getByRole('button', { name: 'All notebooks', exact: true })).toBeVisible();
    // The landing offers no journal/playgrounds create actions.
    await expect(sidebar.getByRole('button', { name: 'New journal entry' })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'New playground' })).toHaveCount(0);

    await page.goto('/playgrounds', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(sidebar.getByRole('button', { name: 'New playground' })).toBeVisible({ timeout: 15_000 });
    await expect(sidebar.getByRole('button', { name: 'All playgrounds', exact: true })).toBeVisible();
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
    await expect(drawer.getByRole('button', { name: 'Playgrounds', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'All notebooks', exact: true })).toBeVisible();

    // View rows navigate and dismiss the drawer, so each folded view is
    // asserted after reopening the navigation on its own route.
    await drawer.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page).toHaveURL(/\/journal(?:\?.*)?$/);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(drawer.getByRole('button', { name: 'New journal entry' })).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByRole('button', { name: 'All entries', exact: true })).toBeVisible();

    // Playgrounds view: own route and own chrome.
    await drawer.getByRole('button', { name: 'Playgrounds', exact: true }).click();
    await expect(page).toHaveURL(/\/playgrounds(?:\?.*)?$/);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(drawer.getByRole('button', { name: 'New playground' })).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByRole('button', { name: 'All playgrounds', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Nav ladder — L3 document index', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('a page document publishes the On this page index', async ({ page }) => {
    await page.goto('/page/guide-start', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.getByText('On this page', { exact: true })).toBeVisible({ timeout: 15_000 });
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
