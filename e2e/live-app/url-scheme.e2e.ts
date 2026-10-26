/**
 * URL scheme acceptance (ticket 09) — spelled-out prefixes, one per concept.
 *
 * Validates against the live app:
 *  1. Every canonical list route renders its concept (never a 404), and the
 *     document title names the concept the path addresses.
 *  2. Canonical direct routes render: /notebook/:slug (+ item), /page/:slug
 *     (guide frontmatter), /day/:date, /note/:id, /t/:type/:tag.
 *  3. Retired paths 404 — no redirect matrix, no aliases: /catalogs,
 *     /collections/*, /c/*, /journal/:identity, /notes/:id, /p/*, /d/*,
 *     /e/*, /workout/*, /analytics/explorer.
 *  4. Query-result links point at the concept's own prefix (a feed row's
 *     Open link targets /feed/..., a notebook row targets /notebook/...).
 *  5. Saved per-route settings survive the rename: view settings stored
 *     under the retired /catalogs key resolve on /notebooks.
 *  6. Guide routes resolve on desktop and mobile viewports.
 */

import { expect, test } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { syncFeed, waitForFeedReady } from '../helpers/feedReadiness';

const LISTS: Array<{ path: string; title: string }> = [
  { path: '/notebooks', title: 'Wod.Wiki - Notebooks' },
  { path: '/notes', title: 'Wod.Wiki - Notes' },
  { path: '/journal', title: 'Wod.Wiki - Journal' },
  { path: '/pages', title: 'Wod.Wiki - Pages' },
  { path: '/tags', title: 'Wod.Wiki - Tags' },
  { path: '/feeds', title: 'Wod.Wiki - Feeds' },
  { path: '/efforts', title: 'Wod.Wiki - Efforts' },
  { path: '/equipment', title: 'Wod.Wiki - Equipment' },
  { path: '/dashboards', title: 'Wod.Wiki - Dashboards' },
];

const RETIRED = [
  '/catalogs',
  '/collections/crossfit-girls',
  '/c/crossfit-girls',
  '/journal/not-a-date',
  '/notes/some-note-id',
  '/p/guide-start',
  '/d/strength-trends',
  '/e/push-up',
  '/workout/crossfit-girls/fran',
  '/analytics/explorer',
  '/note/playground/hello-world',
  '/note/girls/fran',
  // Retired singulars and the analytics namespace — no redirect is left
  // behind for any of them.
  '/feed',
  '/dashboard',
  '/analytics',
];

test.describe('URL scheme — canonical lists', () => {
  for (const { path, title } of LISTS) {
    test(`${path} renders and the document title names the concept`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(String(err)));
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await waitForFeedReady(page);
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
      await expect.poll(() => page.title(), { timeout: 10_000 }).toBe(title);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('URL scheme — canonical direct routes', () => {
  test('/notebook/:slug and /notebook/:slug/:item render the notebook plane', async ({ page }) => {
    await page.goto('/notebook/crossfit-girls', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Notebooks');

    await page.goto('/notebook/crossfit-girls/fran', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/notebook\/crossfit-girls\/fran/);
  });

  test('/note/:id renders the canonical single-note editor', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await seedNote(page, 'url-scheme-note', '# URL scheme note\n\nPlain body.\n', { title: 'URL scheme note' });
    await page.goto('/note/url-scheme-note', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
    await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Note');
  });

  test('/day/:date renders the journal date page', async ({ page }) => {
    await page.goto('/day/2099-12-31', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Day');
  });

  test('/feed/:slug renders the feed detail after its import', async ({ page }) => {
    await syncFeed(page, 'seed-crossfit');
    await page.goto('/feed/seed-crossfit', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Feed');
  });

  test('query results link to the concept prefix (notebooks landing rows)', async ({ page }) => {
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    // No emitted link may use a retired prefix anywhere on the surface.
    await expect(page.locator('a[href^="/c/"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/collections"]')).toHaveCount(0);
    // Landing rows link to the notebook's own prefix — assert the emitted
    // href, then click through.
    const girls = page.getByRole('link', { name: 'CrossFit Girls' });
    await expect(girls).toHaveAttribute('href', '/notebook/crossfit-girls');
    await girls.click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
      .toBe('/notebook/crossfit-girls');
  });
});

test.describe('URL scheme — tag deep link', () => {
  test('/t/:type/:tag renders the tag editor for that tag', async ({ page }) => {
    const TAG = 'url-scheme-e2e';
    // Defensive cleanup (only if a previous run left the tag behind): the
    // catalogue query narrows to the tag, then its editor deletes it.
    await page.goto(`/tags?q=${encodeURIComponent(`:tag{tag:${TAG}}`)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    const row = page.getByTestId('library-row-tag').filter({ hasText: TAG });
    if ((await row.count()) > 0) {
      await page.goto(`/t/domain/${TAG}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(page.getByRole('heading', { name: `Edit ${TAG}` })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('heading', { name: `Edit ${TAG}` })).toHaveCount(0);
    }
    // Create the tag on its direct route (the catalogue is a query surface,
    // not an editor).
    await page.goto(`/t/domain/${TAG}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Tags', level: 1 })).toBeVisible();
    await page.getByPlaceholder('heavy').fill(TAG);
    await page.getByRole('button', { name: /Add Tag/i }).click();
    await expect(page.getByRole('heading', { name: `Edit ${TAG}` })).toBeVisible({ timeout: 10_000 });

    // The catalogue lists it as a query row linking back to the direct route.
    await page.goto('/tags', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await expect(page.locator('[data-testid="wql-composer-root"]:visible')).toContainText(':tag{}');
    await expect(page.getByTestId('library-row-tag').filter({ hasText: TAG })).toBeVisible({ timeout: 15_000 });

    // The canonical tag deep link opens the editor on that tag.
    await page.goto(`/t/domain/${TAG}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `Edit ${TAG}` })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Tags');
  });
});

test.describe('URL scheme — retired paths 404', () => {
  for (const path of RETIRED) {
    test(`${path} does not resolve`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(String(err)));
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('#root')).not.toBeEmpty();
      // No redirect: the URL stays on the retired path (pathname — the
      // app may carry an origin/host prefix around absolute URLs).
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
        .toBe(path);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('URL scheme — saved settings survive the rename', () => {
  test('view settings stored under the retired /catalogs key resolve on /notebooks', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'wodwiki.viewSettings.v1/catalogs',
        JSON.stringify({ level: 'note', layout: 'rows', visibleFields: ['title', 'date'] }),
      );
    });
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    // The rows layout (PropertyTable) renders only when the stored legacy
    // settings resolve — the default is the grouped cards stream.
    await expect(page.locator('table').first(), 'rows layout from the legacy /catalogs key').toBeVisible({ timeout: 30_000 });
  });

  test('query config stored under the retired /catalogs key resolves on /notebooks', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'wodwiki.routeWql.v1/catalogs',
        JSON.stringify({ defaultWql: ':notebook{notebook:crossfit-girls}' }),
      );
    });
    await page.goto('/notebooks', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    // The migrated default query narrows the stream to the girls notebook —
    // visible in the composer's committed query chip.
    await expect(page.getByTestId('stream-query-status')).toContainText(/crossfit-girls|notebook/, { timeout: 30_000 });
  });
});

test.describe('URL scheme — guide routes', () => {
  for (const viewport of [
    { name: 'desktop', size: { width: 1280, height: 960 } },
    { name: 'mobile', size: { width: 375, height: 812 } },
  ]) {
    test(`/page/guide-start resolves on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport.size);
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(String(err)));
      await page.goto('/page/guide-start', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await waitForFeedReady(page);
      await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
      await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
      await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Pages');
      expect(errors).toEqual([]);
    });
  }
});
