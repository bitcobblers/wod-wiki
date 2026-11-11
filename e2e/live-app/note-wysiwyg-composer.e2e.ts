/**
 * Note WYSIWYG & Mobile Wheel Composer E2E Acceptance Suite
 *
 * Verifies the unified CodeMirror 6 WYSIWYG Markdown + domain-block authoring
 * experience across desktop (>=1024px) and mobile (<1024px) viewports:
 *  1. Desktop: interactive task checkboxes, clickable GFM table cells,
 *     pinned query block previews with explicit Source toggle, and one-click
 *     TIMER <-> LOG dialect badge switching.
 *  2. Mobile: clean blurred document mount (zero keyboard auto-pop, zero
 *     horizontal overflow), tap-to-open half-screen flick & scroll-wheel
 *     composer (`inputmode="none"`), horizontal slot navigation, `+ Add`
 *     metric insertion, and `[Type]` <-> `[Wheel]` keyboard handoff.
 */

import { test, expect } from '@playwright/test';
import { seedJournalNote } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

const DESKTOP_DATE = '2099-09-12';
const MOBILE_DATE = '2099-09-13';

const SAMPLE_NOTE = [
  '---',
  'title: Strength & Conditioning',
  'tags:',
  '  - conditioning',
  '---',
  '',
  '# Session Plan',
  '',
  '- [ ] Dynamic warmup',
  '',
  '| Lift | Weight |',
  '| --- | --- |',
  '| Squat | 100kg |',
  '',
  '```time',
  '10:00 15 Kettlebell Swing',
  '```',
  '',
  '```query',
  'sum:reps{} by {week} | :bar{}',
  '```',
  '',
  'Closing notes.',
].join('\n');

test.describe('Note WYSIWYG & Composer', () => {
  test('desktop: prose WYSIWYG checkboxes, inline table editing, dialect badge toggle, and pinned query Source toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await seedJournalNote(page, DESKTOP_DATE, SAMPLE_NOTE);

    await page.goto(`/day/${DESKTOP_DATE}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const editor = page.locator('.cm-note-editor .cm-content');
    await expect(editor).toBeVisible();

    // Move cursor to the closing line so prose widgets above are rendered in WYSIWYG mode
    await page.evaluate(() => {
      const host = document.querySelector('.cm-note-editor') as (HTMLElement & { __codemirrorView?: import('@codemirror/view').EditorView }) | null;
      const view = host?.__codemirrorView;
      if (view) {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      }
    });

    // 1. Click interactive task checkbox -> updates raw markdown to `- [x]`
    const checkbox = page.locator('button.cm-md-task-checkbox').first();
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');

    // 2. Click a rendered GFM table cell -> edits inline and commits to document
    const tableCell = page.locator('.cm-table-preview tbody td').first();
    await expect(tableCell).toBeVisible();
    await expect(tableCell).toContainText('Squat');
    await tableCell.click();
    const cellInput = tableCell.locator('input');
    await expect(cellInput).toBeVisible();
    await cellInput.fill('Front Squat');
    await cellInput.press('Enter');
    await expect(page.locator('.cm-table-preview tbody td').first()).toContainText('Front Squat');

    // 3. Click TIMER dialect badge -> toggles fence to LOG
    const dialectBadge = page.locator('.cm-wod-dialect-badge').first();
    await expect(dialectBadge).toHaveText('TIMER');
    await dialectBadge.click();
    await expect(page.locator('.cm-wod-dialect-badge').first()).toHaveText('LOG');

    // 4. Query block stays rendered until explicit Source button is clicked
    const queryView = page.getByTestId('query-block-view');
    await expect(queryView).toBeVisible();
    await page.getByTestId('query-edit-source').click();
    await expect(queryView).toHaveCount(0);
    await expect(editor).toContainText('sum:reps{} by {week}');
  });

  test('mobile: opens blurred in pure WYSIWYG, opens half-screen wheel composer on tap, adds metrics, and toggles Type mode', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await waitForFeedReady(page);
      await seedJournalNote(page, MOBILE_DATE, SAMPLE_NOTE);

      await page.goto(`/day/${MOBILE_DATE}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const editorContent = page.locator('.cm-note-editor .cm-content');
      await expect(editorContent).toBeVisible();

      // Opens cleanly blurred (no auto-focused textbox, wheel closed, zero horizontal overflow)
      const isFocusedOnMount = await page.evaluate(
        () => document.activeElement?.classList.contains('cm-content') ?? false,
      );
      expect(isFocusedOnMount).toBe(false);
      await expect(page.getByTestId('mobile-wheel-composer')).toHaveCount(0);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);

      // Tap onto the workout line (`10:00 15 Kettlebell Swing`) -> opens wheel composer with inputmode="none"
      const workoutLine = page.locator('.cm-wod-inner').first();
      await workoutLine.click();

      const wheel = page.getByTestId('mobile-wheel-composer');
      await expect(wheel).toBeVisible();
      await expect(editorContent).toHaveAttribute('inputmode', 'none');

      // Upper half of viewport remains visible for live code (>55% free above wheel)
      const wheelBox = await wheel.boundingBox();
      expect(wheelBox).not.toBeNull();
      expect(wheelBox!.y).toBeGreaterThan(812 * 0.52);

      // Tap `+ Add` slot and insert Weight / Load (`20kg`)
      await page.getByTestId('mobile-wheel-slot-add').click();
      await page.getByTestId('wheel-option-add-weight').click();
      await expect(editorContent).toContainText('10:00 15 Kettlebell Swing 20kg');

      // Tap [Type] to summon native keyboard (`inputmode="text"`), then [Wheel] to return
      await page.getByTestId('mobile-wheel-type-btn').click();
      await expect(editorContent).toHaveAttribute('inputmode', 'text');
      await expect(page.getByTestId('mobile-typing-bar')).toBeVisible();

      await page.getByTestId('mobile-return-wheel-btn').click();
      await expect(editorContent).toHaveAttribute('inputmode', 'none');
      await expect(wheel).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
