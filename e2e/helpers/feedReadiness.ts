import { expect, type Page } from '@playwright/test';

/**
 * Wait for the app's boot feed sync to settle before asserting on any
 * feed-gated surface (efforts catalog/detail, library, journal editor).
 *
 * The bootstrap reflects its gate on <html> for CI/e2e diagnostics
 * (apps/playground/src/services/feed/feedReadiness.ts):
 *   data-feed-state:   'idle' | 'preparing' | 'ready' | 'error'
 *   data-feed-outcome: last FeedSyncOutcome ('disabled' | 'current' | 'busy' |
 *                      'imported' | 'server-stale' | 'error'), cleared when a
 *                      new attempt starts.
 *
 * Without this gate, route-level visibility assertions measure feed-import
 * latency instead of app behavior (#1066: 20 deterministic CI failures). An
 * 'error' outcome ungates the UI with whatever rows exist — that fails here so
 * a seeded-surface test never passes on missing data.
 */
export async function waitForFeedReady(page: Page, timeout = 60_000): Promise<void> {
  const root = page.locator('html');
  await expect(root, 'boot feed sync must settle before the surface renders').toHaveAttribute(
    'data-feed-state',
    /^(ready|error)$/,
    { timeout },
  );
  if ((await root.getAttribute('data-feed-state')) === 'error') {
    throw new Error('Feed sync settled with outcome "error" — imported rows may be missing');
  }
}

/** Playwright's own `page.goto` options — no hand-written option bag. */
export type FeedGotoOptions = NonNullable<Parameters<Page['goto']>[1]>;

/**
 * Navigate to a feed-dependent surface and wait for the boot feed sync to
 * settle — one call, one wait. Defaults to `domcontentloaded` + 20s timeout;
 * caller options override either.
 */
export async function gotoFeedSurface(
  page: Page,
  url: string,
  options?: FeedGotoOptions,
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000, ...options });
  await waitForFeedReady(page);
}

/**
 * Subscribe a built-in feed through the app's real Subscribe action. A feed
 * is subscribed as a whole — one Subscribe imports every notebook the feed
 * publishes (one checkpoint, one version) — so collection-surface tests that
 * need a feed's content opt in once by feed id; its notebooks are never
 * synced apart.
 * Works in dev and bundled preview alike — no module-path imports. Fails
 * the test when the feed does not reach an imported/current state instead of
 * silently proceeding.
 */
export async function syncFeed(page: Page, feedId: string, timeout = 180_000): Promise<void> {
  await page.goto('/settings/sync', { waitUntil: 'domcontentloaded' });
  const subscribedOnly = page.getByTestId('sync-subscribed-only-toggle');
  if (await subscribedOnly.isChecked()) await subscribedOnly.uncheck();
  const card = page.getByTestId(`feed-source-${feedId}`);
  await expect(card, `${feedId} feed must be registered`).toBeVisible({ timeout: 15_000 });
  const localVersion = card.getByTestId('feed-local-version');
  if (!(await localVersion.textContent())?.includes('Not imported yet')) return;
  await card.getByTestId(`feed-subscribe-${feedId}`).click();
  await expect(
    localVersion,
    `${feedId} import must commit rows`,
  ).not.toContainText('Not imported yet', { timeout });
}
