/**
 * Note reference metrics — Editor slice (effort/equipment inline authoring).
 *
 * Consumer-visible behaviors on a real note in the live app:
 *
 * 1. Inline note metrics — the Properties widget renders note defaults with
 *    canonical labels; "Add metric" writes a flat `metrics.*` key into the
 *    SAME source document in one undo step, preserving sibling properties
 *    (including nested/other keys) exactly.
 * 2. Focused-line picker — "+ Metric" on a workout line authors the explicit
 *    reference suffix (quoted JSON, effort slug) through the palette.
 * 3. Diagnostic repair — an unknown `metrics.effort` reference stays visible
 *    with actions; correcting it through the value input rewrites exactly
 *    that property and clears the diagnostic.
 *
 * Runs against the live app via playwright.journal.config.ts (live-app suite).
 */

import { test, expect, type Page } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { seedBundledEfforts } from '../helpers/seedEfforts';
import { seedBundledEquipment } from '../helpers/seedEquipment';
import { waitForFeedReady } from '../helpers/feedReadiness';

const NOTE_ID = `ref-metrics-e2e`;
const BASE_DOC = [
  '---',
  'title: Ref Metrics',
  'metrics.effort: burpee',
  'metrics.equipment:',
  '  - kettlebell',
  'metrics.rpe: 7',
  '---',
  '',
  '# Refs',
  '',
  '```time',
  '10 Dumbbell Snatch @15kg',
  '```',
  '',
].join('\n');

const UNKNOWN_DOC = BASE_DOC.replace('metrics.effort: burpee', 'metrics.effort: no-such-move');

/** Boot the app once, seed the catalogs, rehydrate the registries. */
async function bootWithCatalogs(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
  await seedBundledEfforts(page);
  await seedBundledEquipment(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
}

async function openNote(page: Page, doc: string): Promise<string> {
  await seedNote(page, `playground/${NOTE_ID}`, doc, { type: 'playground', title: NOTE_ID });
  await page.goto(`/playground/${NOTE_ID}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForSelector('.cm-content[contenteditable="true"]', { timeout: 15_000 });
  // The notebook page opens with the caret inside the frontmatter, which
  // reveals raw YAML and hides the properties preview; click into the body so
  // the preview (and its diagnostics) render for the assertions below.
  await page.locator('.cm-content').getByText('Refs').click();
  return page.evaluate(() => {
    const view = document.querySelector('.cm-editor')?.parentElement?.__codemirrorView as
      | { state: { doc: { toString(): string } } }
      | undefined;
    if (!view) throw new Error('CodeMirror view was not exposed for test automation');
    return view.state.doc.toString();
  });
}

function propertiesBox(page: Page) {
  return page.locator('.cm-frontmatter-preview');
}

async function currentDoc(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = document.querySelector('.cm-editor')?.parentElement?.__codemirrorView as
      | { state: { doc: { toString(): string } } }
      | undefined;
    if (!view) throw new Error('CodeMirror view was not exposed for test automation');
    return view.state.doc.toString();
  });
}

test.describe('Note reference metrics (editor slice)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    await bootWithCatalogs(page);
  });

  test('inline note metrics render canonical labels and Add metric patches one property with one undo', async ({ page }) => {
    const seeded = await openNote(page, BASE_DOC);
    expect(seeded).toContain('metrics.effort: burpee');

    const box = propertiesBox(page);
    await expect(box).toBeVisible();
    // Canonical labels from the shared resolver, not raw slugs.
    await expect(box.getByText('Burpee', { exact: false }).first()).toBeVisible();
    await expect(box.getByText('Kettlebell', { exact: false }).first()).toBeVisible();

    // Note-level Add metric: effort picker commits a flat dotted key.
    await box.getByTestId('editor-add-metric-note').click();
    const draftInput = page.locator('[data-frontmatter-metric-draft] input');
    await draftInput.fill('rowing');
    await draftInput.press('Enter');

    const after = await currentDoc(page);
    expect(after).toContain('metrics.effort: rowing');
    // Source preservation: siblings untouched (flat numeric + list + comment-free).
    expect(after).toContain('metrics.rpe: 7');
    expect(after).toContain('  - kettlebell');
    expect(after).toContain('10 Dumbbell Snatch @15kg');

    // One undo step restores the previous property value — and only it.
    await page.locator('.cm-content').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('Control+z');
    const undone = await currentDoc(page);
    expect(undone).toContain('metrics.effort: burpee');
    expect(undone).not.toContain('metrics.effort: rowing');
    expect(undone).toContain('metrics.rpe: 7');
  });

  test('focused-line Add metric authors the quoted JSON reference suffix', async ({ page }) => {
    await openNote(page, BASE_DOC);

    // Focus the workout line so the inline metric panel appears.
    await page.locator('.cm-content').getByText('Dumbbell Snatch').click();
    const panel = page.locator('.cm-metric-inline-panel');
    await expect(panel).toBeVisible();

    await panel.getByTestId('editor-add-metric-line').click();

    // Palette step 1: pick the effort from the catalog.
    await page.keyboard.type('burpee');
    await page.locator('[data-item-id="burpee"]').click();
    // Palette step 2: equipment — leave empty (Esc finishes).
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => currentDoc(page), { timeout: 10_000 })
      .toContain('10 Dumbbell Snatch @15kg {"effort":"burpee"}');

    // The authored line keeps its statement text; only the suffix was added.
    const doc = await currentDoc(page);
    expect(doc).toContain('```time\n10 Dumbbell Snatch @15kg {"effort":"burpee"}\n```');
  });

  test('unknown effort ref stays visible and repair rewrites exactly that property', async ({ page }) => {
    await openNote(page, UNKNOWN_DOC);

    const box = propertiesBox(page);
    const diagnostic = box.getByTestId('editor-ref-unknown');
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic).toContainText('no-such-move');

    // Repair through the property's own value editor: select an existing slug.
    const valueInput = box.getByLabel('Value for metrics.effort');
    await valueInput.fill('burpee');
    await valueInput.press('Enter');

    await expect
      .poll(async () => currentDoc(page), { timeout: 10_000 })
      .toContain('metrics.effort: burpee');
    await expect(diagnostic).toHaveCount(0);
    await expect(box.getByText('Burpee', { exact: false }).first()).toBeVisible();
    // Nothing else moved.
    const doc = await currentDoc(page);
    expect(doc).toContain('metrics.rpe: 7');
    expect(doc).toContain('  - kettlebell');
  });
});
