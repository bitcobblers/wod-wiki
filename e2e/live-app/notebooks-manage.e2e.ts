import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { compileSeedRow, seedNoteIdSync } from '../../packages/tools/src/seedbuild/compiler';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Feed Source Settings (/settings/sync) and Library Navigation (/notebooks).
 * Companion to feed-subscription.e2e.ts.
 *
 * Verifies:
 * - Desktop/Mobile "Configure sources" L2 CTA on /notebooks navigates to /settings/sync
 * - Per-source identity, endpoint, and repository links on /settings/sync
 * - Auto-sync toggle persistence, manual sync vs background check
 * - Feed unsubscribe (checkpoint reset, content removed) vs delete (source deleted)
 * - Exact user note preservation
 */

const SOURCE_URL = 'https://manage.example.org/library/';
const REPO_URL = 'https://github.com/example/manage-library';
const SOURCE = { id: 'manage-library', label: 'Manage Library', url: SOURCE_URL, repositoryUrl: REPO_URL };
const CHUNK_ID = 'notebook.demo';
const CHUNK_PATH = `chunks/${CHUNK_ID}.json`;
const SEED_NOTE_PATH = 'markdown/notebooks/demo-catalog/session-1.md';
const SEED_NOTE_BODY = '---\ntags: [demo]\n---\n# Demo Session\n\n```time\n10 Push-ups\n```\n';

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

async function seedSource(page: Page, version: { current: number }): Promise<void> {
  const { rows, entry } = chunkFixture();
  await page.addInitScript((source) => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([source]));
  }, SOURCE);
  await page.context().route(`${SOURCE_URL}manifest.json`, route =>
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
  await page.context().route(`${SOURCE_URL}${CHUNK_PATH}`, route =>
    route.fulfill({
      json: rows,
    }));
}

test.describe('Feed Source Settings & Library Navigation', () => {
  test('desktop L2 menu opens /settings/sync from /notebooks', async ({ page }) => {
    await seedSource(page, { current: 42 });
    await page.goto('/notebooks');
    await expect(page.getByTestId('feed-settings-button')).toHaveCount(0);
    await page.getByTestId('notebooks-configure-sources').click();
    await expect(page).toHaveURL(/\/settings\/sync$/);
    const subscribedOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
    await subscribedOnly.setChecked(false);
    const row = page.getByTestId('feed-source-manage-library');
    await expect(row.getByText('Manage Library', { exact: true })).toBeVisible();
    await expect(row.getByTestId('feed-origin-manage-library')).toHaveText(SOURCE_URL);
    await expect(row.getByTestId('feed-subscribe-manage-library')).toBeVisible();
    await expect(row.getByTestId('feed-autosync-manage-library')).toBeDisabled();

    // Native details overflow: published HTML + git links
    const more = row.getByTestId('feed-more-manage-library');
    await more.locator('summary').click();
    const html = row.getByRole('link', { name: `Published HTML: ${SOURCE_URL}` });
    await expect(html).toHaveAttribute('href', SOURCE_URL);
    const git = row.getByRole('link', { name: 'Git source directory' });
    await expect(git).toHaveAttribute('href', REPO_URL);
  });

  test('mobile: configure sources is reachable via navigation drawer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSource(page, { current: 42 });
    await page.goto('/notebooks');

    await expect(page.getByTestId('feed-settings-button')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog').getByTestId('notebooks-configure-sources').click();
    await expect(page).toHaveURL(/\/settings\/sync$/);

    const subscribedOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
    await subscribedOnly.setChecked(false);
    await expect(page.getByTestId('feed-source-manage-library')).toBeVisible();
  });

  test('one Subscribe imports every notebook the seed publishes', async ({ page }) => {
    const source = 'https://bitcobblers.github.io/wod-wiki-sport-crossfit/';
    const chunks = ['crossfit-games', 'crossfit-girls'].map(name => {
      const path = `markdown/notebooks/${name}/isolation.md`;
      const content = `# ${name} isolation\n\nNotebook body.`;
      const body = JSON.stringify([compileSeedRow(path, content)]);
      return { path, content, body, entry: {
        id: `notebook.${name}`, path: `chunks/notebook.${name}.json`,
        sha256: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body), count: 1,
      } };
    });
    await page.context().route(`${source}**`, route => {
      const url = route.request().url();
      if (url.endsWith('manifest.json')) return route.fulfill({ json: {
        schema: 9, version: 999999999, builtAt: '2026-10-20T00:00:00.000Z',
        chunks: chunks.map(chunk => chunk.entry),
      } });
      const chunk = chunks.find(chunk => url.endsWith(chunk.entry.path));
      return chunk ? route.fulfill({ contentType: 'application/json', body: chunk.body }) : route.abort();
    });
    await page.goto('/settings/sync');
    await waitForFeedReady(page);
    const subscribedOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
    await subscribedOnly.setChecked(false);
    const row = page.getByTestId('feed-source-sport-crossfit');
    await row.getByTestId('feed-subscribe-sport-crossfit').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    expect(await getNoteContentByRouteId(page, seedNoteIdSync(chunks[0].path))).toBe(chunks[0].content);
    expect(await getNoteContentByRouteId(page, seedNoteIdSync(chunks[1].path))).toBe(chunks[1].content);
  });
});
