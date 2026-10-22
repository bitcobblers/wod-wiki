import { test, expect, type Page } from '@playwright/test';

/**
 * Dark-theme gate (storybook-dark project): the theme toolbar global reaches
 * `documentElement` (Dark-Mode Standard host rule, #994/#998) and the shared
 * token palette actually flips — stories render Arctic Frost, not light-under-
 * a-wrapper (the pre-#998 breakage this assertion pins).
 *
 * Raw values are the palette contract from packages/ui/src/styles.css:
 * light `--background: 40 20% 96%`, dark `--background: 222 16% 21%`.
 */

const STORIES = [
  'gallery-wql-composer--default',
  'gallery-wql-example-gallery--value-section',
  'workbench-benchmark-fran--standard-couplet',
  // Database-driven stories — the landing page and the pages that read the
  // active database.
  'database--indexed-db-selection',
  'data--wql-library-search',
  'sessions--session-explorer',
];

const DARK_BG_RAW = '222 16% 21%';
const LIGHT_BG_RAW = '40 20% 96%';

async function paletteProbe(page: Page) {
  return page.evaluate((darkRaw) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const raw = rootStyle.getPropertyValue('--background').trim();

    // Resolve the expected color through the browser's own normalizer.
    const probe = document.createElement('div');
    probe.style.color = `hsl(${darkRaw})`;
    document.body.appendChild(probe);
    const expectedPainted = getComputedStyle(probe).color;
    probe.remove();

    const painted = getComputedStyle(document.body).backgroundColor;
    return { raw, painted, expectedPainted, htmlDark: document.documentElement.classList.contains('dark') };
  }, DARK_BG_RAW);
}

for (const storyId of STORIES) {
  test(`dark palette applies on ${storyId}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${storyId}&viewMode=story&globals=theme:dark`, { waitUntil: 'networkidle' });

    const probe = await paletteProbe(page);
    expect(probe.htmlDark, 'html carries the dark class').toBe(true);
    expect(probe.raw, 'html resolves the Arctic Frost --background raw token').toBe(DARK_BG_RAW);
    expect(probe.raw).not.toBe(LIGHT_BG_RAW);
    expect(probe.painted, 'body paints the dark background').toBe(probe.expectedPainted);

    await expect
      .poll(async () => (await page.locator('body').innerText()).trim().length, { timeout: 15_000 })
      .toBeGreaterThan(30);
  });
}
