// spec: e2e/specs/feeds/feed-subscription-and-autosync.md
import { createHash } from 'node:crypto';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { compileSeedRow } from '../../packages/tools/src/seedbuild/compiler';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';

const INTAKE_SOURCE = 'https://catalog.example.org/training/';
const INTAKE_MANIFEST = {
  schema: 9,
  version: 42,
  builtAt: '2026-10-16T00:00:00.000Z',
  name: 'Training catalog',
  description: 'Coach-published workouts',
  repositoryUrl: 'https://github.com/example/training',
  chunks: [],
};

const MANAGE_URL = 'https://manage.example.org/library/';
const MANAGE_REPO = 'https://github.com/example/manage-library';
const MANAGE_SOURCE = {
  id: 'manage-library',
  label: 'Manage Library',
  url: MANAGE_URL,
  repositoryUrl: MANAGE_REPO,
};
const CHUNK_ID = 'notebook.demo';
const CHUNK_PATH = `chunks/${CHUNK_ID}.json`;
const SEED_NOTE_PATH = 'markdown/notebooks/demo-catalog/session-1.md';
const SEED_NOTE_BODY = '---\ntags: [demo]\n---\n# Demo Session\n\n```time\n10 Push-ups\n```\n';
const USER_NOTE_ID = 'markdown/notes/my-own-note.md';
const USER_NOTE_BODY = '# My own note\n\nNever a seed row.\n';

function buildManageChunk() {
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

test.describe('FED-01 — Feed Subscription & Auto-Sync Lifecycle', () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`subscription intake requires consent and remembers auto-sync at ${viewport.width}x${viewport.height}`, async ({
      app,
    }) => {
      const { page } = app;
      await page.setViewportSize(viewport);
      await page.context().route(`${INTAKE_SOURCE}manifest.json`, (route) => route.fulfill({ json: INTAKE_MANIFEST }));

      await page.goto(`/subscribe?source=${encodeURIComponent(INTAKE_SOURCE)}`);
      const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
      await expect(banner).toBeVisible();
      await expect(banner.getByRole('heading', { name: /Add "Training catalog" to your Library\?/i })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();

      if (viewport.width === 375) {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow, 'no horizontal overflow at 375x812').toBe(false);
      }

      const autoSync = banner.getByRole('checkbox', { name: /Auto-sync updates/i });
      await expect(autoSync).not.toBeChecked();
      await autoSync.check();

      await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
      await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)training-catalog\}$/i);

      await app.goto('/settings/sync');
      const row = page.getByTestId('feed-source-training-catalog');
      await expect(row).toBeVisible();
      await expect(row.getByTestId('feed-autosync-training-catalog')).toBeChecked();
      app.assertCleanConsole();
    });
  }

  test('Decline and Import Once honor non-subscribing consent choices', async ({ app }) => {
    const { page } = app;
    await page.context().route(`${INTAKE_SOURCE}manifest.json`, (route) => route.fulfill({ json: INTAKE_MANIFEST }));

    // 1. Decline leaves seedSources empty
    await page.goto(`/subscribe?source=${encodeURIComponent(INTAKE_SOURCE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Decline' }).click();
    await expect(page).toHaveURL(/\/notebooks$/);
    expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();

    // 2. Import Once leaves source unsubscribed even if auto-sync checkbox was ticked
    await page.goto(`/subscribe?source=${encodeURIComponent(INTAKE_SOURCE)}`);
    await expect(banner).toBeVisible();
    await banner.getByRole('checkbox', { name: /Auto-sync updates/i }).check();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_ONCE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)training-catalog\}$/i);

    await app.goto('/settings/sync');
    await page.getByRole('checkbox', { name: 'Subscribed only' }).setChecked(false);
    const row = page.getByTestId('feed-source-training-catalog');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('feed-subscribe-training-catalog')).toBeVisible();
    await expect(row.getByTestId('feed-autosync-training-catalog')).not.toBeChecked();

    app.assertCleanConsole();
  });

  test('auto-sync applies version bumps, check-only waits for Sync, and Unsubscribe/Delete preserve user Notes', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    const version = { current: 42 };
    const { rows, entry } = buildManageChunk();

    page.on('dialog', (dialog) => void dialog.accept());
    await page.addInitScript((src) => {
      localStorage.setItem('wodwiki.seedSources', JSON.stringify([src]));
    }, MANAGE_SOURCE);

    await page.context().route(`${MANAGE_URL}manifest.json`, (route) =>
      route.fulfill({
        json: {
          schema: 9,
          version: version.current,
          builtAt: '2026-10-15T00:00:00.000Z',
          name: MANAGE_SOURCE.label,
          description: 'Seeded e2e catalog',
          repositoryUrl: MANAGE_REPO,
          chunks: [entry],
        },
      }),
    );
    await page.context().route(`${MANAGE_URL}${CHUNK_PATH}`, (route) => route.fulfill({ json: rows }));

    await app.goto('/settings/sync');
    await app.seed.note(USER_NOTE_ID, USER_NOTE_BODY);

    await page.getByRole('checkbox', { name: 'Subscribed only' }).setChecked(false);
    const row = page.getByTestId('feed-source-manage-library');

    await expect(row.getByTestId('feed-subscribe-manage-library')).toBeEnabled({ timeout: 15_000 });
    await row.getByTestId('feed-subscribe-manage-library').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });

    const auto = row.getByTestId('feed-autosync-manage-library');
    await expect(auto).toBeEnabled();

    // Auto-sync ON -> background check applies v43
    await auto.check();
    version.current = 43;
    await page.reload();
    await expect(row.getByTestId('feed-autosync-manage-library')).toBeChecked();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('feed-local-version')).toContainText('v43');

    // Auto-sync OFF -> v44 waits for manual Sync
    await auto.uncheck();
    version.current = 44;
    await page.reload();
    await expect(row.getByTestId('feed-autosync-manage-library')).not.toBeChecked();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Update available', { timeout: 30_000 });
    await row.getByTestId('feed-sync-manage-library').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('feed-local-version')).toContainText('v44');

    // Unsubscribe removes Seed rows while retaining source entry & user Note
    const more = row.getByTestId('feed-more-manage-library');
    await more.locator('summary').click();
    await row.getByTestId('feed-unsubscribe-manage-library').click();
    await expect(async () => {
      const subOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
      if (await subOnly.isChecked()) await subOnly.setChecked(false);
      await expect(row.getByTestId('feed-subscribe-manage-library')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    expect(await getNoteContentByRouteId(page, SEED_NOTE_PATH)).toBeNull();
    expect(await getNoteContentByRouteId(page, USER_NOTE_ID)).not.toBeNull();

    // Delete removes source entry completely while preserving user Note
    const deleteButton = row.getByTestId('feed-delete-manage-library');
    if (!(await deleteButton.isVisible())) await more.locator('summary').click();
    await deleteButton.click();
    await expect(row).toHaveCount(0);
    expect(await getNoteContentByRouteId(page, USER_NOTE_ID)).not.toBeNull();

    app.assertCleanConsole();
  });

  test('bare /subscribe, /feed/:slug CTA, curated HYROX copy, subscription persistence, and /load UIs stay mounted', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1280, height: 850 });

    // Mock HYROX manifest carrying CLI boilerplate description to test WW-015 curated copy preservation
    const hyroxBase = 'https://bitcobblers.github.io/wod-wiki-sport-hyrox/';
    await page.context().route(`${hyroxBase}manifest.json`, (route) =>
      route.fulfill({
        json: {
          schema: 9,
          version: 1,
          builtAt: '2026-11-01T00:00:00.000Z',
          name: 'wod-wiki-sport-hyrox',
          description:
            'wod-wiki-sport-hyrox — a Wod.Wiki community seed source: grouped notebooks validated and compiled into versioned seed artifacts by the wod CLI from @bitcobblers/wod-wiki-tools.',
          chunks: [],
        },
      }),
    );

    // WW-013: bare /subscribe stays on /subscribe with intake UI
    await page.goto('/subscribe');
    await expect(page).toHaveURL(/\/subscribe$/);
    await expect(page.getByTestId('feed-subscription-intake')).toBeVisible();

    // WW-031: /load and /load/journal stay mounted with portable import / validation UI
    await page.goto('/load');
    await expect(page).toHaveURL(/\/load$/);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready');

    await page.goto('/load/journal');
    await expect(page).toHaveURL(/\/load\/journal$/);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready');

    // WW-014 + WW-015 + WW-021: Subscribe from /feed/sport-hyrox, verify curated copy & persistence across nav
    await app.goto('/feed/sport-hyrox');
    const subBtn = page.getByTestId('feed-detail-subscribe-button').or(page.getByRole('button', { name: /^Subscribe$/i }));
    await expect(subBtn.first()).toBeVisible();
    await subBtn.first().click();

    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const raw = localStorage.getItem('wodwiki.seedSubscriptions');
          return raw ? Boolean((JSON.parse(raw) as Record<string, boolean>)['sport-hyrox']) : false;
        });
      })
      .toBe(true);

    // Navigate to /feeds -> verify curated HYROX heading & description preserved (no repo-slug boilerplate flip)
    await app.goto('/feeds');
    await expect(page.getByRole('heading', { name: 'HYROX', exact: true })).toBeVisible();
    await expect(page.getByText('HYROX race preparation and simulation workouts.')).toBeVisible();
    await expect(page.getByText(/a Wod\.Wiki community seed source/i)).toHaveCount(0);

    // Navigate to /journal and verify subscription survives
    await app.goto('/journal');
    const stillSubscribed = await page.evaluate(() => {
      const raw = localStorage.getItem('wodwiki.seedSubscriptions');
      return raw ? Boolean((JSON.parse(raw) as Record<string, boolean>)['sport-hyrox']) : false;
    });
    expect(stillSubscribed).toBe(true);

    // Cleanup subscription
    await page.evaluate(() => {
      const raw = localStorage.getItem('wodwiki.seedSubscriptions');
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      delete parsed['sport-hyrox'];
      localStorage.setItem('wodwiki.seedSubscriptions', JSON.stringify(parsed));
    });
    app.assertCleanConsole();
  });
});
