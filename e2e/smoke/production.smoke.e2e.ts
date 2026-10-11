import { test, expect, type Page } from '@playwright/test';
import { appBaseURL } from '../utils/url-helpers';
import { waitForSeedReady } from '../helpers/seedReadiness';
import { seedNote } from '../helpers/wodwikiDb';

/** Pageerror noise filter — production loads third-party/analytics/extension scripts. */
function isCriticalError(message: string): boolean {
  const lower = message.toLowerCase();
  return !lower.includes('extension') &&
    !lower.includes('chrome-extension') &&
    !lower.includes('adblock') &&
    !lower.includes('third-party');
}

/** Navigate to a route, capture pageerrors, and assert it renders without critical errors. */
async function probeRoute(page: Page, path: string): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForSeedReady(page);
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  expect(errors.filter(isCriticalError)).toHaveLength(0);
}

test.describe(`App Smoketests — ${appBaseURL()}`, () => {
  test('homepage loads and renders title', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Check that we have the main app container
    const app = page.locator('#root, body > div').first();
    await expect(app).toBeVisible();

    // Check for Wod.Wiki branding
    const title = await page.title();
    expect(title).toContain('Wod.Wiki');

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'e2e/screenshots/smoke-homepage.png', fullPage: false });
  });

  test('can navigate to journal page', async ({ page }) => {
    // Navigate to today's journal entry
    const today = new Date().toISOString().split('T')[0];
    await page.goto(`/journal/${today}`, { waitUntil: 'domcontentloaded' });

    await waitForSeedReady(page);
    // Date-page contract (JournalDatePage always renders this action once the
    // route settles): the page's own New note control, plus the inline editor
    // when the date already has a note.
    await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'e2e/screenshots/smoke-journal.png', fullPage: false });
  });

  test('no console errors on homepage', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/', { waitUntil: 'networkidle' });

    // Allow some time for async errors to surface
    await page.waitForTimeout(2000);

    // Filter out non-critical errors (third-party scripts, etc.)
    const criticalErrors = errors.filter(err => {
      const lower = err.toLowerCase();
      return !lower.includes('extension') &&
             !lower.includes('chrome-extension') &&
             !lower.includes('adblock') &&
             !lower.includes('third-party');
    });

    expect(criticalErrors).toHaveLength(0);
  });

  // ── Deepening (#694): primary routes + a real workout start ───────────────

  test('/efforts loads without critical page errors', async ({ page }) => {
    await probeRoute(page, '/efforts');
    await page.screenshot({ path: 'e2e/screenshots/smoke-efforts.png', fullPage: false });
  });

  test('/feeds loads without critical page errors', async ({ page }) => {
    await probeRoute(page, '/feeds');
    await page.screenshot({ path: 'e2e/screenshots/smoke-feeds.png', fullPage: false });
  });

  test('/chapters/basics redirects and renders without critical page errors', async ({ page }) => {
    // /chapters/basics → /guide/start (client-side redirect). Probe the
    // source route; the redirect resolves and the guide renders.
    await probeRoute(page, '/chapters/basics');
    await page.screenshot({ path: 'e2e/screenshots/smoke-syntax-basics.png', fullPage: false });
  });

  test('Fran collection workout starts and mounts the running controls', async ({ page }) => {
    test.setTimeout(90_000); // production network + cold parse
    await page.addInitScript(() => {
      // Suppress the First-Note Wizard so it can't intercept the Play click.
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    page.on('dialog', (d) => { void d.accept(); });

    // The workout corpus (crossfit-girls/fran) lives in the wod-wiki-community
    // content repo and is not bundled with the app; seed the note this smoke
    // run exercises straight into IndexedDB.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForSeedReady(page);
    await seedNote(page, 'crossfit-girls/fran', '# Fran\n\n```time\n0:05 AMRAP\n  5 Thrusters\n  5 Pull Ups\n```\n', { title: 'Fran' });

    await page.goto('/collections/crossfit-girls/fran', { waitUntil: 'domcontentloaded' });
    await waitForSeedReady(page);
    await expect(page.locator('main').first()).toContainText('Fran');

    // Start the workout: DOM click (block overlay decorations intercept
    // pointer events, same as the live-app specs).
    const play = page.getByRole('button', { name: 'Play', exact: true }).first();
    await expect(play).toBeVisible({ timeout: 15_000 });
    await play.evaluate((el) => (el as HTMLElement).click());

    await expect(page).toHaveURL(/\/journal\/\d{4}-\d{2}-\d{2}/);
    await expect(page.getByRole('button', { name: 'Stop Session', exact: true }).first()).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/smoke-fran-timer.png', fullPage: false });
  });

  // ── Deep-link cold load (#909): /analytics/* deep links are meant to be
  // shareable (?q= carries the query). GitHub Pages can't rewrite unknown
  // paths to a 200, so the 404.html → sessionStorage → restore fallback is
  // what makes a cold open render. Assert the render (not the HTTP status —
  // that's a Pages limitation, documented in #909).

  test('/analytics/explorer deep link cold-loads and renders (#909)', async ({ page }) => {
    const deepLink = '/analytics/explorer?q=' + encodeURIComponent('sum:totalVolume{}');
    await page.goto(deepLink, { waitUntil: 'domcontentloaded' });
    await waitForSeedReady(page);

    // The SPA fallback restores the deep link and the explorer mounts.
    await expect(page.getByText('Metric Explorer').first()).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/dashboards\?q=/);
    expect(new URL(page.url()).searchParams.get('q')).toBe('sum:totalVolume{}');
  });
});
