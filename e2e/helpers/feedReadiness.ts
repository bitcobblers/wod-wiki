import type { Page } from '@playwright/test';
import { waitForSeedReady } from './seedReadiness';

// ponytail: the readiness gate lives in seedReadiness.ts as waitForSeedReady
// (no waitForFeedReady exists in this tree); if the feed rename lands, swap
// the import for the renamed gate and delete this note.

/** Playwright's own `page.goto` options — no hand-written option bag. */
export type FeedGotoOptions = NonNullable<Parameters<Page['goto']>[1]>;

/**
 * Navigate to a seed-dependent surface and wait for the boot seed sync to
 * settle — one call, one wait. Defaults to `domcontentloaded` + 20s timeout;
 * caller options override either.
 */
export async function gotoFeedSurface(
  page: Page,
  url: string,
  options?: FeedGotoOptions,
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000, ...options });
  await waitForSeedReady(page);
}
