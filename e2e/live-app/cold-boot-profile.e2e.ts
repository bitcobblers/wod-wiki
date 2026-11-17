// spec: e2e/specs/journal/cold-boot-profile.md
import type { Page } from '@playwright/test';
import { expect, test, TEST_IDS } from '../fixtures/playgroundActor';

const HOME_BUDGET_MS = 5_000;
const THROTTLED_MOBILE_BUDGET_MS = 6_500;
const PROGRESS_BUDGET_MS = process.env.E2E_APP_URL ? 1_500 : 1_000;

async function readBootMark(page: Page, name: string): Promise<number | null> {
  return page.evaluate((markName) => {
    return performance.getEntriesByName(markName, 'mark')[0]?.startTime ?? null;
  }, name);
}

async function dismissSettledSyncToasts(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        for (const close of await page.locator('[toast-close]').all()) {
          await close.click({ timeout: 2_000 }).catch(() => {});
        }
        return page.locator('[toast-close]').count();
      },
      { timeout: 15_000 },
    )
    .toBe(0);
}

async function expectColdHome(
  page: Page,
  screenshotName: string,
  budgetMs: number = HOME_BUDGET_MS,
): Promise<void> {
  await page.addInitScript(({ heroTestId }) => {
    localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    localStorage.setItem('wod-wiki-playground-theme', 'light');
    const shellObserver = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="boot-shell"]')) return;
      document.documentElement.dataset.bootShellSeen = performance.now().toFixed(3);
      shellObserver.disconnect();
    });
    shellObserver.observe(document, { childList: true, subtree: true });

    const heroObserver = new MutationObserver(() => {
      if (!document.querySelector(`[data-testid="${heroTestId}"]`)) return;
      heroObserver.disconnect();
      if (!document.documentElement.dataset.bootHeroSeen) {
        document.documentElement.dataset.bootHeroSeen = performance.now().toFixed(3);
      }
    });
    heroObserver.observe(document, { childList: true, subtree: true });
  }, { heroTestId: TEST_IDS.tour.HERO });

  const root = page.locator('html');
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Static HTML phase observable before JS bundle completes
  await expect(root).toHaveAttribute('data-boot-shell-seen', /.+/, { timeout: PROGRESS_BUDGET_MS });
  const shellSeenMs = Number(await root.getAttribute('data-boot-shell-seen'));
  expect(shellSeenMs).toBeLessThan(PROGRESS_BUDGET_MS);

  // Usable Home renders without waiting for seed-ready (measured via in-browser performance.now())
  const hero = page.getByTestId(TEST_IDS.tour.HERO);
  await expect(hero).toBeVisible({ timeout: budgetMs * 2 });
  await expect(root).toHaveAttribute('data-boot-hero-seen', /.+/, { timeout: budgetMs * 2 });
  const heroVisibleMs = Number(await root.getAttribute('data-boot-hero-seen'));
  expect(heroVisibleMs).toBeLessThan(budgetMs);

  await expect(root).toHaveAttribute('data-boot-home-first-paint', /.+/, { timeout: budgetMs * 2 });
  const homeFirstPaintMs = await readBootMark(page, 'home:first-paint');
  expect(homeFirstPaintMs).not.toBeNull();
  expect(homeFirstPaintMs!).toBeLessThan(budgetMs);
  await expect(page.getByText('Loading library…')).toHaveCount(0);

  const editor = page.locator('[data-gate-id="editor-pane"] .cm-content').first();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('0:03 Count Down');
  const arrivalText = await editor.textContent();
  const stableRegions = [
    hero.getByRole('heading', { level: 1 }),
    page.getByTestId(TEST_IDS.tour.WHY_VIDEO),
    editor,
  ];
  const contentBoxesBefore = await Promise.all(stableRegions.map((region) => region.boundingBox()));
  await page.screenshot({
    path: test.info().outputPath(`${screenshotName}-before-seed.png`),
    animations: 'disabled',
  });

  test.info().annotations.push({
    type: 'cold-boot-budget',
    description: `boot shell ${shellSeenMs.toFixed(1)}ms; hero visible ${heroVisibleMs.toFixed(1)}ms; home:first-paint ${homeFirstPaintMs!.toFixed(1)}ms`,
  });

  await expect(root).toHaveAttribute('data-boot-feed-settled', /.+/, { timeout: 60_000 });
  await expect(root).toHaveAttribute('data-boot-corpus-ready', /.+/, { timeout: 60_000 });
  await expect(root).toHaveAttribute('data-feed-state', 'ready', { timeout: 60_000 });
  await expect(hero).toBeVisible();
  await expect(editor).toHaveText(arrivalText ?? '');
  await page.screenshot({
    path: test.info().outputPath(`${screenshotName}-after-seed.png`),
    animations: 'disabled',
  });
  await dismissSettledSyncToasts(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await Promise.all(stableRegions.map((region) => region.boundingBox()))).toEqual(contentBoxesBefore);

  await page.goto('/page/guide-start', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'First Workout', exact: true }).first()).toBeVisible();
}

test.describe('@cold-boot JRN-00 — Cold Boot Profile & Seed Phase Settlement', () => {
  test('Scenario 1: cold production Home meets desktop budget before background import settles', async ({
    app,
  }) => {
    const { page } = app;
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectColdHome(page, 'cold-boot-desktop', HOME_BUDGET_MS);
    app.assertCleanConsole();
  });

  test('Scenario 2: cold production Home meets throttled 375x812 mobile budget before import settles', async ({
    app,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await page.setViewportSize({ width: 375, height: 812 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 40,
      downloadThroughput: 10_000_000 / 8,
      uploadThroughput: 10_000_000 / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    try {
      await expectColdHome(page, 'cold-boot-mobile', THROTTLED_MOBILE_BUDGET_MS);
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    }
    app.assertCleanConsole();
  });

  test('Scenario 3: corpus deep link reports seed phase and unknown cold-boot route settles into NotFoundPage', async ({
    app,
    browser,
  }) => {
    test.setTimeout(120_000);
    const { page } = app;
    await page.addInitScript(() => {
      localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    await page.context().route('**/seed/core/**canvas*.json', async (route) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5_000);
      await promise;
      await route.continue();
    });

    await page.goto('/page/guide-start', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status').filter({ hasText: 'Downloading canvas…' })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole('heading', { name: 'First Workout', exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    // Folded from error-states.e2e.ts: cold boot directly on an unknown route settles into NotFoundPage
    const unknownCtx = await browser.newContext();
    const unknownPage = await unknownCtx.newPage();
    const unknownErrors: string[] = [];
    const unknownConsoleErrors: string[] = [];
    unknownPage.on('pageerror', (err) => unknownErrors.push(err.message));
    unknownPage.on('console', (msg) => {
      if (msg.type() === 'error') unknownConsoleErrors.push(msg.text());
    });
    await unknownPage.addInitScript(() => {
      localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    await unknownPage.goto('/definitely-not-a-page-xyz', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await expect(unknownPage.getByRole('heading', { name: /not found/i })).toBeVisible({ timeout: 30_000 });
    await unknownPage.getByRole('button', { name: /go home/i }).click();
    await unknownPage.waitForURL(({ pathname }) => pathname === '/', { timeout: 10_000 });
    await expect(unknownPage.locator('#root')).not.toBeEmpty();
    expect(unknownErrors).toEqual([]);
    expect(unknownConsoleErrors).toEqual([]);
    await unknownCtx.close();

    app.assertCleanConsole();
  });
});
