import type { Page } from '@playwright/test';

export async function currentDocument(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = document.querySelector('.cm-editor')?.parentElement?.__codemirrorView;
    if (!view) throw new Error('CodeMirror view was not exposed for test automation');
    return view.state.doc.toString();
  });
}

export async function replaceDocument(page: Page, document: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), document);
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
}
