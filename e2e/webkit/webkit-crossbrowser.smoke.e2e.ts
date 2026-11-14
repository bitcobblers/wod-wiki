import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { WOD_DB } from '../helpers/wodwikiDb';

/**
 * Cross-browser WebKit smoke suite (`Desktop Safari` + `iPhone 13`).
 *
 * Exercises WebKit's IndexedDB + Web Worker seed pipeline, WQL stream
 * filtering, Effort catalog -> detail routing, Analytics Explorer, and
 * 375x812 mobile navigation/options drawers with zero `pageerror`s.
 */
test.describe('WebKit Cross-Browser Smoke Gate', () => {
  test('cold-boots core seed into WebKit IndexedDB and navigates /journal, /notebooks WQL filtering, /efforts detail, and /dashboards', async ({
    app,
  }) => {
    const { page } = app;

    // 1. Cold boot & core seed readiness on '/'
    await app.goto('/');
    await expect(page.locator('html[data-theme-boot="1"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('data-boot-feed-settled', /.+/, {
      timeout: 60_000,
    });
    await expect(page.getByTestId('tour-hero')).toBeVisible();

    const coreVersion = await page.evaluate(async (dbName) => {
      const db = await new Promise<IDBDatabase>((resolveDb, rejectDb) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolveDb(req.result);
        req.onerror = () => rejectDb(req.error);
      });
      try {
        return await new Promise<number>((resolveVer, rejectVer) => {
          const tx = db.transaction('meta', 'readonly');
          const req = tx.objectStore('meta').get('seed:core');
          req.onsuccess = () => {
            const row = req.result as { seedVersion?: number } | undefined;
            resolveVer(row?.seedVersion ?? 0);
          };
          req.onerror = () => rejectVer(req.error);
        });
      } finally {
        db.close();
      }
    }, WOD_DB);
    expect(coreVersion).toBeGreaterThan(0);

    // 2. /journal stream surface + agent readiness state
    await app.journal.openStream();
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await expect(page.getByTestId(TEST_IDS.STREAM_VIEW)).toBeVisible();

    // 3. /notebooks UI creation + WQL stream filtering (`:notebook{notebook:...}`)
    await app.notebooks.openLibrary();
    await app.notebooks.create('WebKit Safari Smoke 2099', 'Cross-browser WebKit IndexedDB + WQL check');
    await app.wql.queryStream('/notebooks', ':notebook{notebook:webkit-safari-smoke-2099}');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await app.wql.expectStreamContains('WebKit Safari Smoke 2099');
    await app.wql.expectStreamExcludes('My Workout');

    // 4. /efforts catalog -> Effort detail navigation
    const effortsPage = await app.properties.openEffort();
    await effortsPage.waitForSeedRegistry(20);
    const firstEffortRow = effortsPage.effortRows().first();
    await expect(firstEffortRow).toBeVisible();
    const firstEffortTitle = (await firstEffortRow.getByRole('heading').first().innerText()).trim();
    expect(firstEffortTitle.length).toBeGreaterThan(0);

    await firstEffortRow.click();
    await expect(page).toHaveURL(/\/effort\/.+/, { timeout: 15_000 });
    await expect(effortsPage.detailRoot()).toBeVisible({ timeout: 15_000 });
    await expect(effortsPage.detailLabel()).toContainText(firstEffortTitle);

    // 5. /dashboards Analytics Explorer deep-link query
    await app.wql.openExplorer('sum:totalVolume{}');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('explorer-meta')).toBeVisible();
    if ((page.viewportSize()?.width ?? 1280) >= 1024) {
      await expect(page.getByRole('heading', { name: 'Metric Explorer' })).toBeVisible();
    } else {
      await expect(page.getByLabel('Breadcrumb')).toContainText('Dashboards');
    }
    expect(new URL(page.url()).searchParams.get('q')).toBe('sum:totalVolume{}');
  });

  test('375x812 mobile drawer navigation switches L1 surfaces without horizontal overflow or pageerrors', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });

    await app.goto('/journal');
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });

    const expectNoHorizontalOverflow = async (routeLabel: string): Promise<void> => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal overflow on ${routeLabel} at 375x812`).toBe(0);
    };

    await expectNoHorizontalOverflow('/journal');

    // Open mobile navigation drawer and switch to /dashboards via L1 rail
    await page.getByTestId(TEST_IDS.MOBILE_NAV_OPEN).click();
    const navDrawer = page.getByTestId(TEST_IDS.MOBILE_NAV_DRAWER);
    await expect(navDrawer).toBeVisible();

    await navDrawer.getByTestId(TEST_IDS.NAV_L1_DASHBOARDS).click();
    await expect(page).toHaveURL(/\/dashboards$/, { timeout: 15_000 });
    await expect(navDrawer).toBeHidden();
    await expect(page.locator('main').first()).toHaveAttribute('data-agent-status', 'ready', {
      timeout: 20_000,
    });
    await expectNoHorizontalOverflow('/dashboards');

    // Re-open mobile navigation drawer and switch to /efforts via L1 rail
    await page.getByTestId(TEST_IDS.MOBILE_NAV_OPEN).click();
    await expect(navDrawer).toBeVisible();
    await navDrawer.getByTestId('nav-l1-efforts').click();
    await expect(page).toHaveURL(/\/efforts$/, { timeout: 15_000 });
    await expect(navDrawer).toBeHidden();
    await expect(page.getByTestId(TEST_IDS.STREAM_VIEW)).toBeVisible();
    await expectNoHorizontalOverflow('/efforts');

    // Open and dismiss right L3 page-options drawer cleanly at 375x812
    await page.getByRole('button', { name: 'Open page options' }).click();
    const rightDrawer = page.getByTestId('l3-right-drawer');
    await expect(rightDrawer).toBeVisible();
    await rightDrawer.getByRole('button', { name: 'Close page options' }).click();
    await expect(rightDrawer).toBeHidden();
  });
});
