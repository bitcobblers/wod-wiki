import { expect, type Page } from '@playwright/test';

/**
 * Wait for the app's boot seed sync to settle before asserting on any
 * seed-gated surface (efforts catalog/detail, library, journal editor).
 *
 * The bootstrap reflects its gate on <html> for CI/e2e diagnostics
 * (apps/playground/src/services/seed/seedReadiness.ts):
 *   data-seed-state:   'idle' | 'preparing' | 'ready' | 'error'
 *   data-seed-outcome: last SeedSyncOutcome ('disabled' | 'current' | 'busy' |
 *                      'imported' | 'server-stale' | 'error'), cleared when a
 *                      new attempt starts.
 *
 * Without this gate, route-level visibility assertions measure seed-import
 * latency instead of app behavior (#1066: 20 deterministic CI failures). An
 * 'error' outcome ungates the UI with whatever rows exist — that fails here so
 * a seeded-surface test never passes on missing data.
 */
export async function waitForSeedReady(page: Page, timeout = 60_000): Promise<void> {
  const root = page.locator('html');
  await expect(root, 'boot seed sync must settle before the surface renders').toHaveAttribute(
    'data-seed-state',
    /^(ready|error)$/,
    { timeout },
  );
  if ((await root.getAttribute('data-seed-state')) === 'error') {
    throw new Error('Seed sync settled with outcome "error" — seeded rows may be missing');
  }
}

/**
 * Subscribe a built-in seed through the app's real Subscribe action. A seed
 * is subscribed as a whole — one Subscribe imports every notebook the seed
 * publishes (one checkpoint, one version) — so collection-surface tests that
 * need a seed's content opt in once by seed id; its notebooks are never
 * synced apart.
 * Works in dev and bundled preview alike — no module-path imports. Fails the
 * test when the source does not reach an imported/current state instead of
 * silently proceeding.
 */
export async function syncSeed(page: Page, seedId: string, timeout = 180_000): Promise<void> {
  await page.goto('/settings/sync', { waitUntil: 'domcontentloaded' });
  const subscribedOnly = page.getByTestId('sync-subscribed-only-toggle');
  if (await subscribedOnly.isChecked()) await subscribedOnly.uncheck();
  const card = page.getByTestId(`seed-source-${seedId}`);
  await expect(card, `${seedId} seed source must be registered`).toBeVisible({ timeout: 15_000 });
  const localVersion = card.getByTestId('seed-local-version');
  if (!(await localVersion.textContent())?.includes('Not imported yet')) return;
  await card.getByTestId(`seed-subscribe-${seedId}`).click();
  await expect(
    localVersion,
    `${seedId} import must commit rows`,
  ).not.toContainText('Not imported yet', { timeout });
}
