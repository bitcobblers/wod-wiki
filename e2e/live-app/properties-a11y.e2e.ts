/**
 * Properties editor accessibility — labels, field affordance, popup geometry.
 *
 * Covers the audit findings on the note properties panel:
 *  - the property table has persistent, visible Key/Value column labels;
 *  - every field exposes a programmatic name and the value field is wired as
 *    a combobox (`aria-haspopup`) with a named listbox;
 *  - the suggestion list expands inside the properties panel under the field
 *    it belongs to, so it never covers the metadata actions or the
 *    saved-history region below it.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedJournalNote } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';
import { JournalEntryPage } from '../pages/JournalEntryPage';

const DATE = '2099-09-09';
const CONTENT = [
  '---',
  'title: Properties A11y',
  'category:',
  '---',
  '',
  '# Properties',
  '',
].join('\n');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function openProperties(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
  await seedJournalNote(page, DATE, CONTENT);

  const journal = new JournalEntryPage(page);
  await journal.goto(DATE);
  await expect(page.locator('.cm-frontmatter-preview').first()).toBeVisible({ timeout: 15_000 });
  return journal;
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`property fields are labelled and the suggestion list stays clear of the metadata actions (${viewport.name})`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await openProperties(page);

    const preview = page.locator('.cm-frontmatter-preview').first();
    // Persistent, visible column labels — the placeholder is never the only cue.
    await expect(preview.locator('[data-frontmatter-column="key"]')).toHaveText('Key');
    await expect(preview.locator('[data-frontmatter-column="value"]')).toHaveText('Value');

    const value = preview.locator(
      '[data-frontmatter-row="category"] input[aria-label="Value for category"]',
    );
    await expect(value).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(value).toHaveAttribute('role', 'combobox');

    const panelHeight = (await preview.boundingBox())?.height ?? 0;

    await value.click();
    // The popup is the listbox this field controls (every field keeps its own).
    const listId = await value.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    const list = page.locator(`#${listId}`);
    await expect(list).toBeVisible({ timeout: 10_000 });
    await expect(list).toHaveAttribute('aria-label', 'Suggested tags');

    // The list floats: it is not part of the properties panel, and opening it
    // does not grow the panel (the note below it must not move).
    expect(await list.evaluate((element) => element.closest('.cm-frontmatter-preview'))).toBeNull();
    const panelBox = await preview.boundingBox();
    expect(Math.abs((panelBox?.height ?? 0) - panelHeight)).toBeLessThanOrEqual(1);

    // The list is a popup: bounded by the field, not by the property row.
    const listBox = await list.boundingBox();
    expect(listBox?.width ?? 0, 'suggestion list width').toBeLessThanOrEqual(340);

    // It must not cover the metadata actions or the saved-history region.
    const addProperty = await page.getByRole('button', { name: 'Add property', exact: true }).boundingBox();
    const savedHistory = await page.getByText('Saved block history').boundingBox();
    expect(overlaps(listBox, addProperty), 'suggestion list covers the metadata actions').toBe(false);
    expect(overlaps(listBox, savedHistory), 'suggestion list covers the saved-history region').toBe(false);

    // The list is anchored to the field it describes.
    const fieldBox = await value.boundingBox();
    expect(Math.abs((listBox?.x ?? 0) - (fieldBox?.x ?? 0))).toBeLessThan(24);

    await page.screenshot({ path: testInfo.outputPath(`properties-suggestions-${viewport.name}.png`), fullPage: true });

    expect(errors, 'no page errors').toHaveLength(0);
  });
}

test('Add tag classifies the note with a category property', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
  await seedJournalNote(page, DATE, CONTENT);

  const journal = new JournalEntryPage(page);
  await journal.goto(DATE);

  const preview = page.locator('.cm-frontmatter-preview').first();
  await expect(preview).toBeVisible({ timeout: 15_000 });

  // The note has no tag property yet: Add tag classifies it as a category.
  await page.getByRole('button', { name: 'Add tag', exact: true }).click();
  const field = preview.locator('input[aria-label="Value for category"]');
  await expect(field).toBeVisible();
  await field.fill('strength');
  await field.press('Enter');

  await expect.poll(async () => journal.storedContent(DATE)).toContain('category:');
  const stored = (await journal.storedContent(DATE)) ?? '';
  expect(stored).toMatch(/category:\n\s+- strength/);
  expect(stored).not.toContain('tags:');
});
