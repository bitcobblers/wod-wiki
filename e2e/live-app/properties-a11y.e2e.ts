/**
 * Properties editor accessibility — labels, field affordance, popup geometry.
 *
 * Covers the audit findings on the note properties panel:
 *  - the property table has persistent, visible Key/Value column labels;
 *  - every field exposes a programmatic name and the value field is wired as
 *    a combobox (`aria-haspopup`) with a named listbox;
 *  - the suggestion popup stays a popup: it is anchored to the field, it
 *    does not span the property row, and it does not cover the metadata
 *    actions or the saved-history region below it.
 */

import { test, expect } from '@playwright/test';
import { seedJournalNote } from '../helpers/wodwikiDb';
import { waitForSeedReady } from '../helpers/seedReadiness';

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

test('property fields are labelled and the suggestion popup stays clear of the metadata actions', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForSeedReady(page);
  await seedJournalNote(page, DATE, CONTENT);

  await page.goto(`/journal/${DATE}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForSeedReady(page);

  const preview = page.locator('.cm-frontmatter-preview').first();
  await expect(preview).toBeVisible({ timeout: 15_000 });

  // Persistent, visible column labels — the placeholder is never the only cue.
  await expect(preview.locator('[data-frontmatter-column="key"]')).toHaveText('Key');
  await expect(preview.locator('[data-frontmatter-column="value"]')).toHaveText('Value');

  const value = preview.locator(
    '[data-frontmatter-row="category"] input[aria-label="Value for category"]',
  );
  await expect(value).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(value).toHaveAttribute('role', 'combobox');

  await value.click();
  const list = page.locator('[role="listbox"]').first();
  await expect(list).toBeVisible({ timeout: 10_000 });
  await expect(list).toHaveAttribute('aria-label', 'Suggested tags');

  // The popup is a popup: bounded by the field, not by the property row.
  const listBox = await list.boundingBox();
  expect(listBox?.width ?? 0, 'popup width').toBeLessThanOrEqual(340);

  // It must not cover the metadata actions or the saved-history region.
  const addProperty = await page.getByRole('button', { name: 'Add property', exact: true }).boundingBox();
  const savedHistory = await page.getByText('Saved block history').boundingBox();
  expect(overlaps(listBox, addProperty), 'popup covers the metadata actions').toBe(false);
  expect(overlaps(listBox, savedHistory), 'popup covers the saved-history region').toBe(false);

  // The popup is anchored to the field it describes.
  const fieldBox = await value.boundingBox();
  expect(Math.abs((listBox?.x ?? 0) - (fieldBox?.x ?? 0))).toBeLessThan(24);

  await page.screenshot({ path: testInfo.outputPath('properties-suggestions.png'), fullPage: true });

  expect(errors, 'no page errors').toHaveLength(0);
});
