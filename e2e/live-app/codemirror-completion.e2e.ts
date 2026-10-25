import { expect, test } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { BaseNotePage } from '../pages/BaseNotePage';

const NOTE_ID = 'codemirror-completion-context';
const CONTENT = '# Completion context\n\n```query\nQUERY\n```\n\n```time\nWORKOUT\n```\n';

class PlaygroundNotePage extends BaseNotePage {
  async goto(id: string): Promise<void> {
    await this.page.goto(`/playground/${id}`, { waitUntil: 'domcontentloaded' });
    await this.waitForLoad();
  }
}

test('playground note editor applies nested WQL and Whiteboard completions', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await seedNote(page, `playground/${NOTE_ID}`, CONTENT, { type: 'playground', title: NOTE_ID });
  const note = new PlaygroundNotePage(page);
  await note.goto(NOTE_ID);

  const menu = page.locator('.cm-tooltip-autocomplete');
  await note.replaceEditorMarker('QUERY');
  await page.keyboard.type(':no');
  await expect(menu).toBeVisible();
  await expect(menu.locator('li[aria-selected="true"] .cm-completionLabel')).toHaveText('note');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  expect(await note.editorDoc()).toContain(':note{');

  await page.keyboard.type('source:journal}');
  await note.replaceEditorMarker('WORKOUT');
  await page.keyboard.type('100 k');
  const kg = menu.locator('.cm-completionLabel', { hasText: /^kg$/ });
  await expect(kg).toHaveCount(1);
  await page.screenshot({ path: 'e2e/screenshots/codemirror-completion-live.png' });
  await kg.click();
  await expect(menu).toBeHidden();
  expect(await note.editorDoc()).toContain('100 kg');
  expect(errors).toEqual([]);
});
