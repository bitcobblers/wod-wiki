// spec: e2e/specs/feeds/feed-subscription-and-autosync.md
import { createHash } from 'node:crypto';
import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { compileSeedRow, seedNoteIdSync } from '../../packages/tools/src/seedbuild/compiler';
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

const SEED_NOTE_A_PATH = 'markdown/notebooks/demo-catalog/session-1.md';
const SEED_NOTE_A_BODY = '---\ntags: [demo]\n---\n# Demo Session\n\n```time\n10 Push-ups\n```\n';
const SEED_NOTE_B_PATH = 'markdown/notebooks/demo-extra/session-2.md';
const SEED_NOTE_B_BODY = '---\ntags: [demo]\n---\n# Extra Demo Session\n\n```time\n15 Air Squats\n```\n';
const USER_NOTE_ID = 'markdown/notes/my-own-note.md';
const USER_NOTE_BODY = '# My own note\n\nNever a seed row.\n';

function buildManageChunks() {
  const specs = [
    { id: 'notebook.demo', path: SEED_NOTE_A_PATH, body: SEED_NOTE_A_BODY },
    { id: 'notebook.demo-extra', path: SEED_NOTE_B_PATH, body: SEED_NOTE_B_BODY },
  ];
  return specs.map((spec) => {
    const rows = [compileSeedRow(spec.path, spec.body)];
    const json = JSON.stringify(rows);
    const chunkPath = `chunks/${spec.id}.json`;
    return {
      rows,
      chunkPath,
      noteUuid: seedNoteIdSync(spec.path),
      noteBody: spec.body,
      entry: {
        id: spec.id,
        path: chunkPath,
        sha256: createHash('sha256').update(json).digest('hex'),
        bytes: new TextEncoder().encode(json).length,
        count: rows.length,
      },
    };
  });
}

test.describe('FED-01 — Feed Subscription & Auto-Sync Lifecycle', () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`subscription intake requires consent, navigates via L2 configure-sources, and remembers auto-sync at ${viewport.width}x${viewport.height}`, async ({
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
      await app.feeds.waitForReady();

      // Verify /notebooks renders zero retired /c/ or /collections links and zero legacy feed-settings-button
      await expect(page.locator('a[href^="/c/"], a[href^="/collections"]')).toHaveCount(0);
      await expect(page.getByTestId('feed-settings-button')).toHaveCount(0);

      // Reach /settings/sync through L2 `notebooks-configure-sources` (desktop sidebar vs mobile drawer)
      if (viewport.width === 375) {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.getByRole('dialog').getByTestId('notebooks-configure-sources').click();
      } else {
        await page.getByTestId('notebooks-configure-sources').click();
      }
      await expect(page).toHaveURL(/\/settings\/sync$/);

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

  test('multi-Notebook import, overflow menu dismissal, auto-sync vs check-only updates, and Unsubscribe/Delete preserve user Notes', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    const version = { current: 42 };
    const chunks = buildManageChunks();

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
          chunks: chunks.map((c) => c.entry),
        },
      }),
    );
    for (const chunk of chunks) {
      await page.context().route(`${MANAGE_URL}${chunk.chunkPath}`, (route) => route.fulfill({ json: chunk.rows }));
    }

    await app.goto('/settings/sync');
    await app.seed.note(USER_NOTE_ID, USER_NOTE_BODY);

    await page.getByRole('checkbox', { name: 'Subscribed only' }).setChecked(false);
    const row = page.getByTestId('feed-source-manage-library');
    await expect(row.getByText('Manage Library', { exact: true })).toBeVisible();
    await expect(row.getByTestId('feed-origin-manage-library')).toHaveText(MANAGE_URL);
    await expect(row.getByTestId('feed-autosync-manage-library')).toBeDisabled();

    // Overflow details: Published HTML + Git links, plus Escape and backdrop dismissal
    const more = row.getByTestId('feed-more-manage-library');
    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');
    await expect(row.getByRole('link', { name: `Published HTML: ${MANAGE_URL}` })).toHaveAttribute('href', MANAGE_URL);
    await expect(row.getByRole('link', { name: 'Git source directory' })).toHaveAttribute('href', MANAGE_REPO);

    await page.keyboard.press('Escape');
    await expect(more).not.toHaveAttribute('open', '');

    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');
    await more.locator('[data-testid="feed-more-backdrop"]').click({ position: { x: 5, y: 5 } });
    await expect(more).not.toHaveAttribute('open', '');

    // Subscribe -> imports BOTH Notebook chunks published by the Feed
    await expect(row.getByTestId('feed-subscribe-manage-library')).toBeEnabled({ timeout: 15_000 });
    await row.getByTestId('feed-subscribe-manage-library').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    for (const chunk of chunks) {
      expect(await getNoteContentByRouteId(page, chunk.noteUuid)).toBe(chunk.noteBody);
    }

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

    // Unsubscribe removes all imported Seed rows while retaining source entry & user Note
    await more.locator('summary').click();
    await row.getByTestId('feed-unsubscribe-manage-library').click();
    await expect(async () => {
      const subOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
      if (await subOnly.isChecked()) await subOnly.setChecked(false);
      await expect(row.getByTestId('feed-subscribe-manage-library')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    for (const chunk of chunks) {
      expect(await getNoteContentByRouteId(page, chunk.noteUuid)).toBeNull();
    }
    expect(await getNoteContentByRouteId(page, USER_NOTE_ID)).not.toBeNull();

    // Delete removes source entry completely while preserving user Note
    await more.locator('summary').click();
    await row.getByTestId('feed-delete-manage-library').click();
    await expect(row).toHaveCount(0);
    expect(await getNoteContentByRouteId(page, USER_NOTE_ID)).not.toBeNull();

    app.assertCleanConsole();
  });

  test('bare /subscribe, /feed/:slug CTA, curated HYROX copy, /page/guide-start smoke, and /load UIs stay mounted', async ({
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
    await expect(page.getByTestId(TEST_IDS.FEED_SUBSCRIPTION_INTAKE)).toBeVisible();

    // WW-031: /load and /load/journal stay mounted with portable import / validation UI
    await page.goto('/load');
    await expect(page).toHaveURL(/\/load$/);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready');

    await page.goto('/load/journal');
    await expect(page).toHaveURL(/\/load\/journal$/);
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready');

    // Guide route smoke (/page/guide-start resolves cleanly with Pages concept title)
    await app.goto('/page/guide-start');
    await expect(page.getByRole('heading', { name: /not found/i })).toHaveCount(0);
    await expect.poll(() => page.title(), { timeout: 10_000 }).toBe('Wod.Wiki - Pages');

    // WW-014 + WW-015 + WW-021: Subscribe from /feed/sport-hyrox, verify curated copy & persistence across nav
    await app.goto('/feed/sport-hyrox');
    const subBtn = page
      .getByTestId(TEST_IDS.FEED_DETAIL_SUBSCRIBE_BUTTON)
      .or(page.getByRole('button', { name: /^Subscribe$/i }));
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
