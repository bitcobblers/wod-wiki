import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile gate (storybook-mobile-375 project): flagship stories render with
 * zero horizontal overflow at a 375px viewport.
 *
 * Originally scoped to stories verified clean by the dark-mode/mobile
 * inventory (docs/research/008); the workbench stories joined in #997 once
 * the Session Outputs Table grew its Card List below sm. Surfaces known
 * broken at phone width get added here by their fix tickets — not before.
 */

async function renderedContent(page: Page) {
  return (await page.locator('body').innerText()).trim().length;
}


const STORIES = [
  'gallery-wql-composer--default',
  'gallery-wql-example-gallery--bar-section',
  'gallery-wql-example-gallery--table-section',
  'gallery-wql-example-gallery--value-section',
  // Workbench stories — covered since #997: the Session Outputs Table renders
  // its Card List below sm, so these previously-overflowing stories hold.
  'workbench-benchmark-fran--standard-couplet',
  'playground--for-time-starter',
  // Gallery rows — covered since #1001: the same Card List path contains the
  // rows cards (inventory 008 measured 815px cards / 472px overflow here),
  // and GalleryCardView roots carry min-w-0 against grid blowout.
  'gallery-wql-example-gallery--rows-find-section',
  // Timer surfaces — Minimal tier is the 375px-first surface; the phone
  // frame wrapper clamps to the viewport so it holds zero overflow.
  'gallery-timer-surfaces--minimal-rest',
  'gallery-timer-surfaces--minimal-prompts',
  // Database-driven stories — the landing page and the pages that read the
  // active database.
  'database--indexed-db-selection',
  'playground--library-page',
  'data--wql-library-search',
  'data--dashboard-generator',
  'sessions--session-explorer',
];

for (const storyId of STORIES) {
  test(`${storyId} has no horizontal overflow at 375px`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${storyId}&viewMode=story`, { waitUntil: 'networkidle' });

    await expect.poll(() => renderedContent(page), { timeout: 15_000 }).toBeGreaterThan(30);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
