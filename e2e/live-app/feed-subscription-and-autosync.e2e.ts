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
      const preRegistry = await page.evaluate(() => new Promise<{ customFeeds?: Array<{ id: string }> } | null>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(null); return; }
          const g = db.transaction('meta', 'readonly').objectStore('meta').get('feed:registry');
          g.onsuccess = () => { db.close(); resolve((g.result as { customFeeds?: Array<{ id: string }> } | undefined) ?? null); };
          g.onerror = () => { db.close(); reject(g.error); };
        };
      }));
      expect((preRegistry?.customFeeds ?? []).some((f) => f.id === 'training-catalog')).toBe(false);

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

      const subRecord = await page.evaluate(() => new Promise<{ offlinePolicy?: string; subscribed?: boolean; autoSync?: boolean } | null>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(null); return; }
          const g = db.transaction('meta', 'readonly').objectStore('meta').get('feed:subscriptions');
          g.onsuccess = () => {
            db.close();
            const rec = g.result as { entries?: Record<string, { offlinePolicy?: string; subscribed?: boolean; autoSync?: boolean }> } | undefined;
            resolve(rec?.entries?.['training-catalog'] ?? null);
          };
          g.onerror = () => { db.close(); reject(g.error); };
        };
      }));
      expect(subRecord?.subscribed).toBe(true);
      expect(subRecord?.offlinePolicy).toBe('index-only');
      expect(subRecord?.autoSync).toBe(true);

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
      await expect(row.getByTestId('feed-sync-status')).toContainText('Index active');
      app.assertCleanConsole();
    });
  }

  test('Decline leaves source unregistered while default Subscribe is index-only and Download for offline imports chunks', async ({
    app,
  }) => {
    const { page } = app;
    const chunkFetches: string[] = [];
    const intakeRowMd = '# Training Catalog WOD\n\n```time\n10:00 AMRAP\n  10 Kettlebell Swings\n```\n';
    page.on('request', (req) => {
      if (req.url().startsWith(INTAKE_SOURCE) && req.url().includes('/chunks/')) {
        chunkFetches.push(req.url());
      }
    });
    const intakeFeed = await app.seed.mockPeerFeed(INTAKE_SOURCE, {
      name: 'Training Catalog',
      notebookSlug: 'catalog',
      notes: [{ slug: 'wod', title: 'Training Catalog WOD', markdown: intakeRowMd }],
    });
    const intakeRowUuid = intakeFeed.noteIds[0]!;

    // 1. Decline leaves feed:registry / feed:subscriptions and legacy seedSources unregistered
    await page.goto(`/subscribe?source=${encodeURIComponent(INTAKE_SOURCE)}`);
    const banner = page.getByTestId(TEST_IDS.UNKNOWN_FEED_INTAKE_BANNER);
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId(TEST_IDS.FEED_INTAKE_ONCE)).toHaveCount(0);
    await expect(banner.getByRole('button', { name: /Register only/i })).toHaveCount(0);
    await expect(banner.getByRole('checkbox', { name: /Download for offline/i })).not.toBeChecked();
    await expect(banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE)).toHaveText('Subscribe');
    await banner.getByRole('button', { name: 'Decline' }).click();
    await expect(page).toHaveURL(/\/notebooks$/);

    expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();
    const declinedRegistry = await page.evaluate(() => new Promise<{ customFeeds?: Array<{ id: string }> } | null>((resolve, reject) => {
      const req = indexedDB.open('wodwiki-db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(null); return; }
        const g = db.transaction('meta', 'readonly').objectStore('meta').get('feed:registry');
        g.onsuccess = () => { db.close(); resolve((g.result as { customFeeds?: Array<{ id: string }> } | undefined) ?? null); };
        g.onerror = () => { db.close(); reject(g.error); };
      };
    }));
    expect((declinedRegistry?.customFeeds ?? []).some((f) => f.id === 'training-catalog')).toBe(false);

    // 2. Default Subscribe is index-only (no chunk download) even with Auto-sync ticked
    await page.goto(`/subscribe?source=${encodeURIComponent(INTAKE_SOURCE)}`);
    await expect(banner).toBeVisible();
    await banner.getByRole('checkbox', { name: /Auto-sync updates/i }).check();
    await banner.getByTestId(TEST_IDS.FEED_INTAKE_SUBSCRIBE).click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)training-catalog\}$/i);
    await app.feeds.waitForReady();
    expect(chunkFetches, 'index-only subscribe performs zero eager chunk fetches').toEqual([]);
    expect(await getNoteContentByRouteId(page, intakeRowUuid)).toBeNull();

    await app.goto('/settings/sync');
    const row = page.getByTestId('feed-source-training-catalog');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('feed-autosync-training-catalog')).toBeChecked();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Index active');

    // 3. Download for offline upgrades index-only subscription to full chunk import
    const downloadBtn = row.getByTestId('feed-download-offline-training-catalog');
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    expect(chunkFetches.length).toBe(1);
    await expect.poll(() => getNoteContentByRouteId(page, intakeRowUuid), { timeout: 10_000 }).toBe(intakeRowMd);

    app.assertCleanConsole();
  });

  test('multi-Notebook index-first subscribe, Download offline, overflow menu dismissal, auto-sync vs manual updates, and Unsubscribe/Delete EditorDialog preserve user Notes', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    const version = { current: 42 };
    const chunks = buildManageChunks();
    const chunkFetches: string[] = [];

    const buildNotebooksMeta = () =>
      chunks.map((c) => {
        const slug = c.entry.id.replace(/^notebook\./, '');
        return {
          notebookId: c.entry.id,
          label: slug.charAt(0).toUpperCase() + slug.slice(1),
          indexPath: `indexes/notebooks/${c.entry.id}.json`,
          version: version.current,
          commit: `v${version.current}`,
          builtAt: '2026-10-15T00:00:00.000Z',
          sha256: c.entry.sha256,
          bytes: 256,
          indexBytes: 256,
          chunkBytes: c.entry.bytes,
          count: c.rows.length,
        };
      });

    await page.context().route(`${MANAGE_URL}manifest.json`, (route) =>
      route.fulfill({
        json: {
          schema: 10,
          version: version.current,
          builtAt: '2026-10-15T00:00:00.000Z',
          name: MANAGE_SOURCE.label,
          description: 'Seeded e2e catalog',
          repositoryUrl: MANAGE_REPO,
          indexBytes: 512,
          chunkBytes: 1024,
          chunks: chunks.map((c) => c.entry),
          notebooks: buildNotebooksMeta(),
        },
      }),
    );
    for (const chunk of chunks) {
      const idxPath = `indexes/notebooks/${chunk.entry.id}.json`;
      await page.context().route(`${MANAGE_URL}${idxPath}`, (route) =>
        route.fulfill({
          json: {
            notebookId: chunk.entry.id,
            label: chunk.entry.id.replace(/^notebook\./, ''),
            indexPath: idxPath,
            version: version.current,
            commit: `v${version.current}`,
            builtAt: '2026-10-15T00:00:00.000Z',
            sha256: chunk.entry.sha256,
            bytes: 256,
            indexBytes: 256,
            chunkBytes: chunk.entry.bytes,
            count: chunk.rows.length,
            records: [
              {
                uuid: chunk.noteUuid,
                path: (chunk.rows[0] as { path?: string })?.path ?? `markdown/notebooks/${chunk.entry.id}/note.md`,
                commit: `v${version.current}`,
                version: version.current,
                sha256: chunk.entry.sha256,
                title: (chunk.rows[0] as { title?: string })?.title ?? 'Seed Note',
              },
            ],
          },
        }),
      );
      await page.context().route(`${MANAGE_URL}${chunk.chunkPath}`, (route) => {
        chunkFetches.push(chunk.chunkPath);
        return route.fulfill({ json: chunk.rows });
      });
    }

    // Seed Manage Library as an unregistered->registered unsubscribed custom feed in authoritative IDB feed:registry
    await app.goto('/settings/sync');
    await page.evaluate(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('wodwiki-db');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('meta', 'readwrite');
            const store = tx.objectStore('meta');
            const g = store.get('feed:registry');
            g.onsuccess = () => {
              const existing = (g.result as { customFeeds?: Array<{ id: string }>; hiddenFeedIds?: string[] } | undefined) ?? {};
              const customFeeds = [...(existing.customFeeds ?? []).filter((f) => f.id !== src.id), src];
              store.put({
                key: 'feed:registry',
                customFeeds,
                hiddenFeedIds: (existing.hiddenFeedIds ?? []).filter((id) => id !== src.id),
                updatedAt: Date.now(),
              });
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
        }),
      MANAGE_SOURCE,
    );
    await page.reload();
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

    // Subscribe defaults to index-only (zero chunk downloads until Download offline)
    await expect(row.getByTestId('feed-subscribe-manage-library')).toBeEnabled({ timeout: 15_000 });
    await row.getByTestId('feed-subscribe-manage-library').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Index active', { timeout: 30_000 });
    expect(chunkFetches, 'initial Subscribe uses index-only without downloading chunks').toEqual([]);
    for (const chunk of chunks) {
      expect(await getNoteContentByRouteId(page, chunk.noteUuid)).toBeNull();
    }

    // Download offline -> pulls BOTH Notebook chunks published by the Feed
    const downloadOfflineBtn = row.getByTestId('feed-download-offline-manage-library');
    await expect(downloadOfflineBtn).toBeVisible();
    await downloadOfflineBtn.click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    expect(chunkFetches).toHaveLength(chunks.length);
    for (const chunk of chunks) {
      expect(await getNoteContentByRouteId(page, chunk.noteUuid)).toBe(chunk.noteBody);
    }

    const auto = row.getByTestId('feed-autosync-manage-library');
    await expect(auto).toBeEnabled();

    const readAutoSyncInMeta = async (): Promise<boolean | undefined> =>
      page.evaluate(() => new Promise<boolean | undefined>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(undefined); return; }
          const g = db.transaction('meta', 'readonly').objectStore('meta').get('feed:subscriptions');
          g.onsuccess = () => {
            db.close();
            const rec = g.result as { entries?: Record<string, { autoSync?: boolean }> } | undefined;
            resolve(rec?.entries?.['manage-library']?.autoSync);
          };
          g.onerror = () => { db.close(); reject(g.error); };
        };
      }));

    // Auto-sync ON -> background check applies v43
    await auto.check();
    await expect.poll(readAutoSyncInMeta, { timeout: 5_000 }).toBe(true);
    version.current = 43;
    await page.reload();
    await expect(row.getByTestId('feed-autosync-manage-library')).toBeChecked();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('feed-local-version')).toContainText('v43');

    // Auto-sync OFF -> v44 waits for manual Sync
    await auto.uncheck();
    await expect.poll(readAutoSyncInMeta, { timeout: 5_000 }).toBe(false);
    version.current = 44;
    await page.reload();
    await expect(row.getByTestId('feed-autosync-manage-library')).not.toBeChecked();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Update available', { timeout: 30_000 });
    await row.getByTestId('feed-sync-manage-library').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await expect(row.getByTestId('feed-local-version')).toContainText('v44');

    // Unsubscribe via accessible EditorDialog removes imported Seed rows while retaining source entry & user Note
    await more.locator('summary').click();
    await row.getByTestId('feed-unsubscribe-manage-library').click();
    const unsubDialog = page.getByRole('dialog');
    await expect(unsubDialog.getByRole('heading', { name: /Unsubscribe from "Manage Library"\?/i })).toBeVisible();
    await expect(unsubDialog).toContainText(/remain safely pinned locally/i);
    await unsubDialog.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
    await expect(unsubDialog).toBeHidden();

    await expect(async () => {
      const subOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
      if (await subOnly.isChecked()) await subOnly.setChecked(false);
      await expect(row.getByTestId('feed-subscribe-manage-library')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    for (const chunk of chunks) {
      expect(await getNoteContentByRouteId(page, chunk.noteUuid)).toBeNull();
    }
    expect(await getNoteContentByRouteId(page, USER_NOTE_ID)).not.toBeNull();

    // Delete via accessible EditorDialog removes source entry completely while preserving user Note
    await more.locator('summary').click();
    await row.getByTestId('feed-delete-manage-library').click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog.getByRole('heading', { name: /Delete "Manage Library"\?/i })).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete source', exact: true }).click();
    await expect(deleteDialog).toBeHidden();
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

    const readHyroxSubscribed = async (): Promise<boolean> =>
      page.evaluate(() => new Promise<boolean>((resolve, reject) => {
        const req = indexedDB.open('wodwiki-db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) { db.close(); resolve(false); return; }
          const g = db.transaction('meta', 'readonly').objectStore('meta').get('feed:subscriptions');
          g.onsuccess = () => {
            db.close();
            const rec = g.result as { entries?: Record<string, { subscribed?: boolean }> } | undefined;
            resolve(Boolean(rec?.entries?.['sport-hyrox']?.subscribed));
          };
          g.onerror = () => { db.close(); reject(g.error); };
        };
      }));

    await expect.poll(readHyroxSubscribed, { timeout: 10_000 }).toBe(true);

    // Navigate to /feeds -> verify curated HYROX heading & description preserved (no repo-slug boilerplate flip)
    await app.goto('/feeds');
    await expect(page.getByRole('heading', { name: 'HYROX', exact: true })).toBeVisible();
    await expect(page.getByText('HYROX race preparation and simulation workouts.')).toBeVisible();
    await expect(page.getByText(/a Wod\.Wiki community seed source/i)).toHaveCount(0);

    // Navigate to /journal and verify subscription survives in authoritative feed:subscriptions
    await app.goto('/journal');
    expect(await readHyroxSubscribed()).toBe(true);

    // Cleanup subscription from authoritative IStorage meta and mirror
    await app.goto('/settings/sync');
    const hyroxRow = page.getByTestId('feed-source-sport-hyrox');
    await hyroxRow.getByTestId('feed-more-sport-hyrox').locator('summary').click();
    await hyroxRow.getByTestId('feed-unsubscribe-sport-hyrox').click();
    const hyroxConfirm = page.getByRole('dialog');
    await hyroxConfirm.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
    await expect(hyroxConfirm).toBeHidden();
    await expect.poll(readHyroxSubscribed, { timeout: 10_000 }).toBe(false);
    app.assertCleanConsole();
  });
});
