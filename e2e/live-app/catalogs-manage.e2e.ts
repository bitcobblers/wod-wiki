import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { compileSeedRow } from '../../packages/tools/src/seedbuild/compiler';
import { getNoteContentByRouteId, seedNote } from '../helpers/wodwikiDb';

/**
 * Catalog manager (/catalogs?manage=1) — companion to catalog-subscription
 * .e2e.ts (intake). This file owns manager behavior: the ?manage=1 deep link,
 * the toolbar/dock "Manage Catalogs" entry, per-source identity + published
 * links, auto-sync toggle persistence, auto-sync vs check-only updates, and
 * the unsubscribe (entry retained) vs delete (entry removed) distinction —
 * against a real registered custom source serving a real compiled chunk.
 *
 * Fixtures are self-seeded (localStorage source + routed manifest/chunks) so
 * no test depends on community-repo content. A user-authored note is seeded
 * before the destructive actions to prove neither ever touches user notes.
 */

const SOURCE_URL = 'https://manage.example.org/library/';
const REPO_URL = 'https://github.com/example/manage-library';
const SOURCE = { id: 'manage-library', label: 'Manage Library', url: SOURCE_URL, repositoryUrl: REPO_URL };
const CHUNK_ID = 'collection.demo';
const CHUNK_PATH = `chunks/${CHUNK_ID}.json`;
const SEED_NOTE_PATH = 'markdown/collections/demo-catalog/session-1.md';
const SEED_NOTE_BODY = '---\ntags: [demo]\n---\n# Demo Session\n\n```time\n10 Push-ups\n```\n';
const USER_NOTE_PATH = 'markdown/notes/my-own-note.md';
const USER_NOTE_BODY = '# My own note\n\nNever a seed row.\n';

/** A real compiled chunk (same pipeline the publisher uses) with its manifest entry. */
function chunkFixture() {
  const rows = [compileSeedRow(SEED_NOTE_PATH, SEED_NOTE_BODY)];
  const bytes = JSON.stringify(rows);
  return {
    rows,
    entry: {
      id: CHUNK_ID,
      path: CHUNK_PATH,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: new TextEncoder().encode(bytes).length,
      count: rows.length,
    },
  };
}

/** Register the custom source before any app script runs and mock its host.
 *  `version.current` is mutable so a test can publish a newer version. */
async function seedSource(page: Page, version: { current: number }): Promise<void> {
  const { rows, entry } = chunkFixture();
  await page.addInitScript((source) => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([source]));
  }, SOURCE);
  await page.route(`${SOURCE_URL}manifest.json`, route =>
    route.fulfill({
      json: {
        schema: 9,
        version: version.current,
        builtAt: '2026-10-15T00:00:00.000Z',
        name: SOURCE.label,
        description: 'Seeded e2e catalog',
        repositoryUrl: REPO_URL,
        chunks: [entry],
      },
    }));
  await page.route(`${SOURCE_URL}${CHUNK_PATH}`, route => route.fulfill({ json: rows }));
}

test.describe('Catalog manager — /catalogs?manage=1', () => {
  test('deep link opens the manager with identity and published links; closing keeps other params', async ({ page }) => {
    await seedSource(page, { current: 42 });
    await page.goto('/catalogs?manage=1&q=:notebook');

    const drawer = page.getByTestId('catalogs-manager-drawer');
    await expect(drawer).toBeVisible();
    const row = drawer.getByTestId('seed-source-manage-library');
    await expect(row.getByText('Manage Library', { exact: true })).toBeVisible();
    await expect(row.getByTestId('seed-origin-manage-library')).toHaveText(SOURCE_URL);
    // Unsubscribed and never imported → Subscribe is the primary action;
    // auto-sync is unavailable while unsubscribed.
    await expect(row.getByTestId('seed-subscribe-manage-library')).toBeVisible();
    await expect(row.getByTestId('seed-autosync-manage-library')).toBeDisabled();

    // Native details overflow: published HTML + git links, noopener enforced.
    const more = row.getByTestId('seed-more-manage-library');
    await more.locator('summary').click();
    const html = row.getByRole('link', { name: `Published HTML: ${SOURCE_URL}` });
    await expect(html).toHaveAttribute('href', SOURCE_URL);
    await expect(html).toHaveAttribute('rel', /noopener/);
    const git = row.getByRole('link', { name: 'Git source directory' });
    await expect(git).toHaveAttribute('href', REPO_URL);
    await expect(git).toHaveAttribute('rel', /noopener/);

    // Escape closes; ONLY the manage param is dropped (URLSearchParams may
    // percent-encode the q value's colon).
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/catalogs\?q=(:|%3A)notebook$/i);
  });

  test('desktop toolbar opens the manager in place', async ({ page }) => {
    await seedSource(page, { current: 42 });
    await page.goto('/catalogs');
    await expect(page.getByTestId('manage-catalogs-button')).toBeVisible();
    await page.getByTestId('manage-catalogs-button').click();
    await expect(page.getByTestId('catalogs-manager-drawer')).toBeVisible();
    await expect(page).toHaveURL(/\/catalogs\?manage=1$/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('catalogs-manager-drawer')).toBeHidden();
    await expect(page).toHaveURL(/\/catalogs$/);
  });

  test('mobile: manage stays reachable via the actions dock; the deep link survives reload', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSource(page, { current: 42 });
    await page.goto('/catalogs');

    await page.getByTestId('actions-overflow').click();
    const sheet = page.getByRole('dialog', { name: 'Stream actions' });
    await sheet.getByTestId('manage-catalogs-button').click();
    const drawer = page.getByTestId('catalogs-manager-drawer');
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/\/catalogs\?manage=1$/);

    await page.reload();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('seed-source-manage-library')).toBeVisible();
  });

  test('subscribe imports content; auto-sync applies a bump, check-only waits for Sync; unsubscribe retains, delete removes', async ({ page }) => {
    test.setTimeout(120_000);
    const version = { current: 42 };
    await seedSource(page, version);
    await page.on('dialog', dialog => void dialog.accept());

    await page.goto('/catalogs?manage=1');
    const drawer = page.getByTestId('catalogs-manager-drawer');
    const row = drawer.getByTestId('seed-source-manage-library');

    // Subscribe = real import of the served chunk, then subscribed + current.
    await row.getByTestId('seed-subscribe-manage-library').click();
    await expect(row.getByTestId('seed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('seed-subscribe-manage-library')).toBeHidden();

    // A user-authored note that must survive every lifecycle action below.
    await seedNote(page, USER_NOTE_PATH, USER_NOTE_BODY);

    const auto = row.getByTestId('seed-autosync-manage-library');
    await expect(auto).toBeEnabled();

    // Auto-sync ON: the load-time background check applies the published bump.
    await auto.check();
    version.current = 43;
    await page.reload();
    await expect(drawer.getByTestId('seed-source-manage-library')).toBeVisible();
    await expect(row.getByTestId('seed-autosync-manage-library')).toBeChecked();
    await expect(row.getByTestId('seed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('seed-local-version')).toContainText('v43');
    await expect(row.getByTestId('seed-sync-manage-library')).toBeHidden();

    // Auto-sync OFF: the bump stays pending until the athlete presses Sync.
    await auto.uncheck();
    version.current = 44;
    await page.reload();
    await expect(row.getByTestId('seed-autosync-manage-library')).not.toBeChecked();
    await expect(row.getByTestId('seed-sync-status')).toContainText('Update available', { timeout: 30_000 });
    await expect(row.getByTestId('seed-sync-manage-library')).toBeVisible();
    await row.getByTestId('seed-sync-manage-library').click();
    await expect(row.getByTestId('seed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('seed-local-version')).toContainText('v44');

    // Unsubscribe: imported content removed, the source entry stays.
    const more = row.getByTestId('seed-more-manage-library');
    await more.locator('summary').click();
    await row.getByTestId('seed-unsubscribe-manage-library').click();
    await expect(row.getByTestId('seed-subscribe-manage-library')).toBeVisible({ timeout: 15_000 });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('seed-autosync-manage-library')).toBeDisabled();
    expect(await getNoteContentByRouteId(page, SEED_NOTE_PATH)).toBeNull();
    expect(await getNoteContentByRouteId(page, USER_NOTE_PATH)).not.toBeNull();

    // Delete: content AND the source entry are removed; user notes remain.
    const deleteButton = row.getByTestId('seed-delete-manage-library');
    if (!(await deleteButton.isVisible())) await more.locator('summary').click();
    await deleteButton.click();
    await expect(row).toHaveCount(0);
    expect(await getNoteContentByRouteId(page, USER_NOTE_PATH)).not.toBeNull();
    const sources = await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'));
    expect(JSON.parse(sources ?? '[]')).toEqual([]);
  });
});
