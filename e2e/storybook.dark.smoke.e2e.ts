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
  'analyze-wql-wql-composer--default',
  'analyze-wql-wql-example-gallery--value-section',
  'workbench-language-workbench--runtime-pipeline-tour',
  'plan-editor-noteeditor--universal-note-editor',
  // Database-driven stories — the landing page and the pages that read the
  // active database.
  'workbench-database-storage-indexeddb-selection--indexed-db-selection',
  'workbench-database-storage-data-explorer--wql-library-search',
  'workbench-database-storage-session-explorer--session-explorer',
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

    await expect.poll(async () => (await paletteProbe(page)).htmlDark, { timeout: 15_000 }).toBe(true);
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

test('dark note editor completion tooltip maintains WCAG AA contrast on plan-editor-noteeditor--universal-note-editor', async ({ page }) => {
  await page.goto('/iframe.html?id=plan-editor-noteeditor--universal-note-editor&viewMode=story&globals=theme:dark', {
    waitUntil: 'networkidle',
  });
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
    const line = view.state.doc.line(16);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, selection: { anchor: line.from } });
    view.focus();
  });
  await page.keyboard.type(':no');
  const menu = page.locator('.cm-tooltip-autocomplete');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('li[aria-selected="true"]')).toBeVisible();

  const metrics = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const resolveRgb = (cssColor: string, backdrop = '#2d333e'): [number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r ?? 0, g ?? 0, b ?? 0];
    };
    const lum = ([r, g, b]: [number, number, number]) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const editorEl = document.querySelector<HTMLElement>('[data-testid="note-editor-host"] .cm-editor')!;
    const contentEl = document.querySelector<HTMLElement>('[data-testid="note-editor-host"] .cm-content')!;
    const tooltipEl = document.querySelector<HTMLElement>('.cm-tooltip-autocomplete')!;
    const selectedRow = tooltipEl.querySelector<HTMLElement>('li[aria-selected="true"]')!;
    const labelEl = selectedRow.querySelector<HTMLElement>('.cm-completionLabel')!;
    const editorLum = lum(resolveRgb(getComputedStyle(editorEl).backgroundColor, bodyBg));
    const textLum = lum(resolveRgb(getComputedStyle(contentEl).color, bodyBg));
    const tooltipBg = getComputedStyle(tooltipEl).backgroundColor;
    const tooltipLum = lum(resolveRgb(tooltipBg, bodyBg));
    const rowLum = lum(resolveRgb(getComputedStyle(selectedRow).backgroundColor, tooltipBg));
    const labelLum = lum(resolveRgb(getComputedStyle(labelEl).color, tooltipBg));
    return {
      editorLum,
      tooltipLum,
      editorContrast: ratio(textLum, editorLum),
      tooltipContrast: ratio(labelLum, tooltipLum),
      selectedRowContrast: ratio(labelLum, rowLum),
    };
  });

  expect(metrics.editorLum).toBeLessThan(0.12);
  expect(metrics.tooltipLum).toBeLessThan(0.15);
  expect(metrics.editorContrast).toBeGreaterThanOrEqual(4.5);
  expect(metrics.tooltipContrast).toBeGreaterThanOrEqual(4.5);
  expect(metrics.selectedRowContrast).toBeGreaterThanOrEqual(4.5);
});
