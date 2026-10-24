/**
 * Note Editor Navigation — native geometry & focus E2E
 *
 * One focused flow over the real note surface (JournalPageShell → NoteEditor)
 * covering the round-2 dogfood regressions:
 *  - N2: the editor surface must self-focus .cm-content when the date page
 *    opens editable (previously activeElement stayed on a toggle button and
 *    arrows page-scrolled).
 *  - N1: ArrowUp/Down move ONE VISUAL row (fenced workout block + wrapped
 *    paragraph); Shift+Up extends one row — wrapped motion asserted via
 *    measured caret coords (Δy == one 22px line height, x stable).
 *  - N3: Home on an empty line is a no-op.
 *  - #6: metric inline chips stay live inside the workout fence.
 *
 * Root cause guarded here: exterior margins on block-widget DOM (e.g.
 * `.cm-frontmatter-preview`) are invisible to CodeMirror's height map and
 * displace every posAtCoords reverse lookup below the widget.
 *
 * Fixture motion is goal-column accurate: caret placement lines (0-column
 * starts for the Up chain, line-end placement for the Down chain) keep every
 * expected head exact under CodeMirror's persistent goal column.
 *
 * Caret placement uses the dev-server `__codemirrorView` test handle exposed
 * by NoteEditor under webdriver.
 */

import { test, expect, type Page } from '@playwright/test';
import type { EditorView } from '@codemirror/view';
import { seedJournalNote } from '../helpers/wodwikiDb';
import { waitForSeedReady } from '../helpers/seedReadiness';

const DATE = '2099-08-04';

// ~300 chars so the paragraph soft-wraps into several visual rows at the
// default 1280px viewport (~90 chars/row in 14px JetBrains Mono).
const PARAGRAPH =
  'This deliberately long paragraph line exists to soft wrap across several ' +
  'visual rows inside the note editor viewport, so that vertical caret ' +
  'navigation traverses one visual row at a time instead of jumping between ' +
  'logical document lines when the caret climbs or descends through it.';

// 0:'---' 1:'title:…' 2:'---' 3:'' 4:'# …' 5:'' 6:PARAGRAPH 7:''
// 8:'```time' 9:'Timer: 1:00' 10:'10 Burpees' 11:'' 12:'10 Push Ups' 13:'```'
const LINES = [
  '---',
  'title: Nav Regression',
  '---',
  '',
  '# Navigation regression',
  '',
  PARAGRAPH,
  '',
  '```time',
  'Timer: 1:00',
  '10 Burpees',
  '',
  '10 Push Ups',
  '```',
];
const CONTENT = LINES.join('\n');

// Cumulative doc offset of a 0-based line index (shared fixture addressing).
const lineStart = (idx: number) =>
  LINES.slice(0, idx).reduce((sum, l) => sum + l.length + 1, 0);

const LINE_HEIGHT = 22;

const viewHandle = (page: Page) =>
  page.evaluateHandle((): EditorView => {
    const host = document.querySelector('.cm-note-editor') as
      | (HTMLElement & { __codemirrorView?: EditorView })
      | null;
    if (!host?.__codemirrorView) throw new Error('editor view not exposed');
    return host.__codemirrorView;
  });

/** Focus the editor, place the caret, and let CM settle measurement. */
async function setCaret(page: Page, pos: number) {
  await page.evaluate(
    ([view, head]: [EditorView, number]) => {
      view.focus();
      view.dispatch({ selection: { anchor: head, head }, scrollIntoView: true });
    },
    [await viewHandle(page), pos] as [EditorView, number],
  );
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
    return promise;
  });
}

async function getHead(page: Page): Promise<number> {
  return page.evaluate(
    (view: EditorView) => view.state.selection.main.head,
    await viewHandle(page),
  );
}

/** Viewport coords of the caret position. */
async function coordsAt(page: Page, pos: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([view, pos]: [EditorView, number]) => {
      const rect = view.coordsAtPos(pos);
      if (!rect) throw new Error(`no coords for pos ${pos}`);
      return { x: rect.left, y: rect.top };
    },
    [await viewHandle(page), pos] as [EditorView, number],
  );
}

test('note editor: opens focused and editable, arrows walk visual rows, Home no-op on empty line', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Seed from the app origin (IndexedDB lives per-origin, not about:blank).
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  // The boot seed sync builds the app's DB schema; seeding against a
  // half-booted origin races the import (#1066).
  await waitForSeedReady(page);
  await seedJournalNote(page, DATE, CONTENT);

  // The date page opens the note editor inline and editable (the Read/Edit
  // toggles are retired on this surface) and must self-focus .cm-content —
  // the focus contract under test. Clicking into the content would mask it.
  await page.goto(`/journal/${DATE}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForSeedReady(page);
  // Measure focus, not mount latency: editor must be attached first. The
  // self-focus contract is source-backed (NoteEditor focuses on open when
  // editable — its readonly→editable effect calls view.focus()).
  await expect(page.locator('.cm-content').first()).toBeAttached({ timeout: 10_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.classList.contains('cm-content'),
        ),
      { timeout: 5_000 },
    )
    .toBe(true);

  // N1 Up chain: caret at column 0 of the last body line so the persistent
  // goal column keeps every landing at a line start.
  await setCaret(page, lineStart(12));
  await page.keyboard.press('ArrowUp');
  expect(await getHead(page)).toBe(lineStart(11)); // blank line in fence
  await page.keyboard.press('ArrowUp');
  expect(await getHead(page)).toBe(lineStart(10)); // 10 Burpees
  await page.keyboard.press('ArrowUp');
  expect(await getHead(page)).toBe(lineStart(9)); // Timer: 1:00
  await page.keyboard.press('ArrowUp');
  expect(await getHead(page)).toBe(lineStart(8)); // ```time fence
  await page.keyboard.press('ArrowUp');
  expect(await getHead(page)).toBe(lineStart(7)); // blank above fence

  // Wrapped paragraph: every press climbs exactly one VISUAL row — Δy one
  // line height with stable x — until the paragraph's first row.
  let prev = await coordsAt(page, lineStart(7));
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('ArrowUp');
    const head = await getHead(page);
    if (head === lineStart(6)) break;
    expect(head, 'Up stays inside the paragraph until its first row').toBeGreaterThan(lineStart(6));
    const next = await coordsAt(page, head);
    expect(next.y, 'ArrowUp climbs one visual row').toBeLessThan(prev.y);
    expect(prev.y - next.y, 'one visual row per ArrowUp').toBeLessThanOrEqual(LINE_HEIGHT + 6);
    expect(Math.abs(next.x - prev.x), 'x stays stable across wrapped rows').toBeLessThanOrEqual(50);
    prev = next;
  }
  expect(await getHead(page)).toBe(lineStart(6));
  await page.keyboard.press('ArrowUp');
  expect(await getHead(page)).toBe(lineStart(5)); // blank line above paragraph

  // Shift+Up extends the selection by exactly one visual row.
  await setCaret(page, lineStart(12));
  await page.keyboard.press('Shift+ArrowUp');
  const selection = await page.evaluate((view: EditorView) => {
    const sel = view.state.selection.main;
    return { head: sel.head, anchor: sel.anchor };
  }, await viewHandle(page));
  expect(selection.head).toBe(lineStart(11));
  expect(selection.anchor).toBe(lineStart(12));

  // N3: Home on an empty line is a no-op.
  await setCaret(page, lineStart(11));
  await page.keyboard.press('Home');
  expect(await getHead(page)).toBe(lineStart(11));

  // A replaced frontmatter block is one navigation unit, regardless of its height.
  await setCaret(page, 0);
  await page.keyboard.press('Control+Home');
  expect(await getHead(page)).toBe(0);
  await page.keyboard.press('ArrowDown');
  const afterDown = await getHead(page);
  expect(afterDown).toBeGreaterThan(0);
  expect(afterDown).toBeLessThanOrEqual(lineStart(3));

  // Down through the fence from the paragraph's END (goal column clamps to
  // each line's end; blanks clamp to 0) — one row per press, and the metric
  // chip row stays live on the Timer line.
  await setCaret(page, lineStart(6) + PARAGRAPH.length);
  await page.keyboard.press('ArrowDown');
  expect(await getHead(page)).toBe(lineStart(7)); // blank
  await page.keyboard.press('ArrowDown');
  expect(await getHead(page)).toBe(lineStart(8) + LINES[8].length); // ```time end
  await page.keyboard.press('ArrowDown');
  expect(await getHead(page)).toBe(lineStart(9) + LINES[9].length); // Timer end → inside "1:00"
  await expect(page.locator('[aria-label="Metric inline panel"]')).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('ArrowDown');
  expect(await getHead(page)).toBe(lineStart(10) + LINES[10].length); // Burpees end
  await page.keyboard.press('ArrowDown');
  expect(await getHead(page)).toBe(lineStart(11)); // blank
  await page.keyboard.press('ArrowDown');
  expect(await getHead(page)).toBe(lineStart(12) + LINES[12].length); // Push Ups end

  await setCaret(page, CONTENT.length);
  await page.getByRole('button', { name: 'Add property', exact: true }).click();
  await page
    .locator('[data-frontmatter-row="property"]')
    .getByLabel('Property key', { exact: true })
    .fill('stale_draft');
  await page.evaluate(
    ({ view, content }: { view: EditorView; content: string }) => view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: { anchor: content.length },
    }),
    { view: await viewHandle(page), content: CONTENT },
  );
  await setCaret(page, CONTENT.length);
  expect(await page.evaluate(
    (view: EditorView) => view.state.doc.toString(),
    await viewHandle(page),
  )).toBe(CONTENT);

  expect(errors, 'no page errors during navigation').toHaveLength(0);
});
