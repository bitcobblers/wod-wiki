import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Focused completion acceptance (storybook-completion* projects): the
 * Screens note stories mount a real CodeMirror markdown-preset editor, so
 * completion menus, keyboard handling, and document edits are exercised
 * through actual editor DOM — no static mockups.
 *
 * Contract (stock CodeMirror tooltip DOM only):
 *  - nested WQL: typing `:no` in ```query/```wql offers the `note` head;
 *    inside the braces, filter keys (`text`, `tags`, …) are offered
 *  - time body: `circ` → `Circuit` snippet, `100 k` → `kg` (mass),
 *    `soun` → `sound` property; mobile uses 48px coarse-pointer rows
 *  - frontmatter/prose never offer workout or query terms
 *
 * Runs against STORYBOOK_URL (playwright.storybook.config.ts):
 *  - storybook-completion          desktop, light
 *  - storybook-completion-mobile-375  375×812
 *  - storybook-completion-dark     desktop, dark theme global
 */

const NOTE_STORY = 'screens--universal-note-editor';
const DIALOG_STORY = 'screens--universal-note-editor-dialog';

// ```query and ```wql bodies render their preview until the cursor is placed
// inside the block — gotoLine's dispatch placement does exactly that, so the
// raw body text is editable and the nested WQL source dispatches there.

function storyUrl(storyId: string) {
  const dark = test.info().project.name.endsWith('-dark') ? '&globals=theme:dark' : '';
  return `/iframe.html?id=${storyId}&viewMode=story${dark}`;
}

async function openNoteEditor(page: Page, testId = 'note-editor-host') {
  await page.goto(storyUrl(NOTE_STORY), { waitUntil: 'domcontentloaded' });
  const host = page.getByTestId(testId);
  await expect(host.locator('.cm-content')).toBeVisible({ timeout: 15_000 });
  return host;
}

/**
 * Deterministic cursor placement, independent of click-to-position (posAtCoords
 * maps clicks around decorated fence markers unreliably in the live editor):
 * jump to doc start, then ArrowDown onto the target line, then End.
 * Start-anchored so insertions further down never invalidate later targets.
 * Sample doc lines (Screens.stories.tsx NOTE_COMPLETION_SAMPLE): wql body 16,
 * time last body line 23, prose 8, frontmatter date 3.
 */
async function gotoLine(page: Page, lineNumber: number, host?: Locator) {
  // Click to focus, then place the selection through the view API: the preset
  // keymap has no doc-start chord, and click-to-position maps unreliably around
  // decorated fence markers. Typing/assertions below stay real keyboard input.
  await (host ?? page.getByTestId('note-editor-host')).locator('.cm-line').first().click();
  await page.evaluate((line) => {
    return import('/@id/@codemirror/view').then((viewMod) => {
      const root =
        document.querySelector('[data-testid="note-editor-host"] .cm-editor') ??
        document.querySelector('[data-testid="note-dialog-editor"] .cm-editor');
      const view = root ? viewMod.EditorView.findFromDOM(root) : null;
      if (!view) throw new Error('note editor view not found');
      const target = view.state.doc.line(line);
      view.dispatch({ selection: { anchor: target.to } });
      view.focus();
    });
  }, lineNumber);
}

const LINE = { queryBody: 12, wqlBody: 16, timeBodyRest: 23, prose: 8, frontmatterDate: 3 };

/** Empty an existing fence-body line before typing a fresh statement/query. */
async function openBodyLine(page: Page, lineNumber: number, host?: Locator) {
  await gotoLine(page, lineNumber, host);
  await page.evaluate((line) => {
    return import('/@id/@codemirror/view').then((viewMod) => {
      const root =
        document.querySelector('[data-testid="note-editor-host"] .cm-editor') ??
        document.querySelector('[data-testid="note-dialog-editor"] .cm-editor');
      const view = root ? viewMod.EditorView.findFromDOM(root) : null;
      if (!view) throw new Error('note editor view not found');
      const target = view.state.doc.line(line);
      view.dispatch({
        changes: { from: target.from, to: target.to, insert: '' },
        selection: { anchor: target.from },
      });
      view.focus();
    });
  }, lineNumber);
}

function menu(page: Page) {
  return page.locator('.cm-tooltip-autocomplete');
}

function firstOptionLabel(page: Page) {
  return menu(page).locator('li[aria-selected="true"] .cm-completionLabel').first();
}

// ── Nested WQL ───────────────────────────────────────────────────────────────

for (const [fence, bodyLine] of [['query', LINE.queryBody], ['wql', LINE.wqlBody]] as const) {
  test(`nested WQL option opens in a ${fence} body and inserts on accept`, async ({ page }) => {
    const host = await openNoteEditor(page);
    await openBodyLine(page, bodyLine);
    await page.keyboard.type(':no');

    await expect(menu(page)).toBeVisible();
    await expect(firstOptionLabel(page)).toHaveText('note');

    await page.keyboard.press('Enter'); // accept — head inserts `:note{`
    await expect(menu(page)).toBeHidden();
    await expect(host.locator('.cm-line', { hasText: /^:note\{$/ })).toHaveCount(1);

    // Filter keys inside the braces.
    await page.keyboard.type('t');
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('.cm-completionLabel', { hasText: 'text' }).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
  });
}

// ── Whiteboard (time) body ───────────────────────────────────────────────────

test('time body offers structure, unit, and property completions', async ({ page }) => {
  const host = await openNoteEditor(page);

  // Structure snippet on an empty body line.
  await openBodyLine(page, LINE.timeBodyRest);
  await page.keyboard.type('circ');
  await expect(menu(page)).toBeVisible();
  await expect(firstOptionLabel(page)).toHaveText('Circuit');
  if (test.info().project.name.includes('mobile')) {
    await expect.poll(() => menu(page).locator('li').first().evaluate((row) => getComputedStyle(row).minHeight)).toBe('48px');
  }

  await page.keyboard.press('Enter');
  await expect(host.locator('.cm-line', { hasText: 'Air Squats' })).toHaveCount(1);

  await openNoteEditor(page);

  // Unit completion after a number.
  await openBodyLine(page, LINE.timeBodyRest);
  await page.keyboard.type('100 k');
  await expect(menu(page)).toBeVisible();
  const kg = menu(page).locator('.cm-completionLabel', { hasText: /^kg$/ }).first();
  await expect(kg).toBeVisible();
  await kg.click(); // pointer acceptance
  await expect(menu(page)).toBeHidden();
  await expect(host.locator('.cm-line', { hasText: '100 kg' })).toHaveCount(1);

  await openNoteEditor(page);

  // Property key on an empty line.
  await openBodyLine(page, LINE.timeBodyRest);
  await page.keyboard.type('soun');
  await expect(menu(page)).toBeVisible();
  await expect(firstOptionLabel(page)).toHaveText('sound');
  await page.keyboard.press('Enter');
  await expect(host.locator('.cm-line', { hasText: /^sound$/ })).toHaveCount(1);
});

// ── Keyboard behavior ────────────────────────────────────────────────────────

test('arrows move the active option and Escape dismisses without inserting', async ({ page }) => {
  const host = await openNoteEditor(page);
  await openBodyLine(page, LINE.queryBody);
  await page.keyboard.type(':no');

  await expect(menu(page)).toBeVisible();
  await expect(firstOptionLabel(page)).toHaveText('note');

  await page.keyboard.press('ArrowDown');
  await expect(firstOptionLabel(page)).toHaveText('notes');

  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(host.locator('.cm-line', { hasText: /^:note\{$/ })).toHaveCount(0);
});

// ── Section isolation ────────────────────────────────────────────────────────

test('frontmatter, prose, and fence bodies never leak foreign completions', async ({ page }) => {
  const host = await openNoteEditor(page);

  // Prose: query and workout triggers stay inert.
  await openBodyLine(page, LINE.prose);
  await page.keyboard.type(':no');
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('.cm-completionLabel', { hasText: 'note' })).toHaveCount(0);

  await gotoLine(page, LINE.prose);
  await page.keyboard.press('Enter');
  await page.keyboard.type('circ');
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('.cm-completionLabel', { hasText: 'Circuit' })).toHaveCount(0);

  // Frontmatter: no WQL heads or workout terms reach the metadata block.
  await gotoLine(page, LINE.frontmatterDate);
  await page.keyboard.type(' :no');
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('.cm-completionLabel', { hasText: 'note' })).toHaveCount(0);

  // Fence-type isolation: workout triggers in a wql body offer no Circuit.
  await openBodyLine(page, LINE.queryBody);
  await page.keyboard.type('circ');
  const labels = page.locator('.cm-completionLabel');
  await expect(labels.filter({ hasText: 'Circuit' })).toHaveCount(0);
});

// ── Dialog host ──────────────────────────────────────────────────────────────

test('dialog host floats completion menus and Escape gates menu before dialog', async ({ page }) => {
  await page.goto(storyUrl(DIALOG_STORY), { waitUntil: 'domcontentloaded' });
  await page.getByTestId('note-dialog-open').click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  const host = page.getByTestId('note-dialog-editor');
  await expect(host.locator('.cm-content')).toBeVisible({ timeout: 15_000 });

  await openBodyLine(page, LINE.queryBody, host);
  await page.keyboard.type(':no');
  await expect(menu(page)).toBeVisible();
  await expect(firstOptionLabel(page)).toHaveText('note');

  // The tooltip floats within the viewport above the dialog panel.
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

  await page.keyboard.press('Enter'); // accept into the doc
  await expect(menu(page)).toBeHidden();
  await expect(host.locator('.cm-line', { hasText: /^:note\{$/ })).toHaveCount(1);

  // First Escape dismisses the menu, second closes the dialog.
  await openBodyLine(page, LINE.queryBody, host);
  await page.keyboard.type(':no');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
