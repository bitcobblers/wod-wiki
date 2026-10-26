import { test, expect } from '@playwright/test';

test.describe('Canvas editor source content', () => {
  test('does not show YAML frontmatter on syntax pages', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/page/guide-protocols', { waitUntil: 'domcontentloaded', timeout: 20_000 });

    const editors = page.locator('.cm-content:visible');
    await expect(editors.first()).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => (await editors.allInnerTexts()).join('\n'), { timeout: 15_000 })
      .toContain('Run');
    const allEditorText = await editors.allInnerTexts();
    const joinedEditorText = allEditorText.join('\n');
    expect(joinedEditorText.trimStart().startsWith('---')).toBe(false);
    expect(joinedEditorText).not.toContain('search: hidden');
    expect(joinedEditorText).not.toContain('title: Just a Movement');

    expect(errors).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath('canvas-editor-frontmatter.png'), fullPage: true });
  });
});
