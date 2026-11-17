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
  // Workbench story — covered since #997: the Session Outputs Table renders
  // its Card List below sm, so this previously-overflowing story holds.
  'playground--for-time-starter',
  'screens--universal-note-editor',
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

test('screens--universal-note-editor completion menu uses 48px coarse-pointer touch targets at 375px', async ({ page }) => {
  await page.goto('/iframe.html?id=screens--universal-note-editor&viewMode=story', { waitUntil: 'networkidle' });
  const host = page.getByTestId('note-editor-host');
  await expect(host.locator('.cm-content')).toBeVisible({ timeout: 15_000 });

  await host.locator('.cm-line').first().click();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-editor-host"]') as unknown as {
      __codemirrorView?: {
        state: { doc: { line: (n: number) => { from: number; to: number } } };
        dispatch: (tr: { changes: { from: number; to: number; insert: string }; selection: { anchor: number } }) => void;
        focus: () => void;
      };
    };
    const view = el?.__codemirrorView;
    if (!view) throw new Error('note editor view not found');
    const line = view.state.doc.line(23);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } });
    view.focus();
  });
  await page.keyboard.type('circ');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.locator('li').first().evaluate((row) => getComputedStyle(row).minHeight))
    .toBe('48px');
});
