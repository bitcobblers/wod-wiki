// spec: e2e/specs/properties/equipment-catalog-and-backlinks.md
/**
 * PRP-02 — Equipment catalog & backlinks (P1-core)
 *
 * `/equipment` L1 catalog rendering across desktop + 375×812, and the bundled
 * Equipment Property Note clone-to-custom flow preserving authored Markdown
 * while leaving the bundled source untouched.
 */

import { test, expect } from '../fixtures/playgroundActor';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';

const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }];

test.describe('PRP-02 — Equipment catalog & backlinks', () => {
  test('the /equipment L1 catalog renders bundled Equipment across desktop and 375×812', async ({ app }, testInfo) => {
    for (const viewport of VIEWPORTS) {
      await app.page.setViewportSize(viewport);
      await app.seed.bundledEquipment();

      let equipment = await app.properties.openEquipment();
      await equipment.waitForListLoaded();
      await expect(equipment.equipmentRow('dumbbell'), `catalog lists dumbbell at ${viewport.width}px`).toBeVisible({ timeout: 15_000 });
      await expect(equipment.equipmentRow('kettlebell')).toBeVisible();

      if (viewport.width === 375) {
        const overflow = await app.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow at 375px').toBe(false);
      }

      // The L2 detail is a real Note page: label, Bundled source, authored Markdown.
      equipment = await app.properties.openEquipment('dumbbell');
      await equipment.waitForDetailLoaded();
      await expect(equipment.detailLabel()).toHaveText('Dumbbell');
      await expect(equipment.detailSource()).toContainText('Bundled');
      await expect(equipment.notebookEditor()).toBeVisible();
      await app.assertCleanConsole();
    }
  });

  test('bundled Equipment clone-to-custom preserves the authored Markdown and leaves the source untouched', async ({ app }, testInfo) => {
    await app.page.setViewportSize(VIEWPORTS[0]!);
    await app.seed.bundledEquipment();
    const equipment = await app.properties.openEquipment('dumbbell');
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Dumbbell');

    // 1. Capture the authored source Markdown as the cloning baseline.
    const authoredSource = await getNoteContentByRouteId(app.page, 'equipment/dumbbell');
    expect(authoredSource, 'the bundled source note stores authored Markdown').toBeTruthy();
    const editorLines = await equipment.notebookEditor().locator('.cm-content > .cm-line').allTextContents();
    expect(editorLines.join('\n').length, 'the editor mounts the authored Markdown').toBeGreaterThan(0);

    // 2. Clone-to-custom: identity flips to Custom, source lines preserved verbatim.
    await equipment.cloneButton().click();
    await expect(equipment.detailLabel()).toHaveText('Dumbbell (Custom)');
    await expect(equipment.detailSource()).toContainText('Custom');
    await expect(equipment.notebookEditor().locator('.cm-content > .cm-line')).toHaveText(editorLines);
    const stripFrontmatter = (md: string | null) => md?.replace(/^---[\s\S]*?---\s*/, '').trim() ?? '';
    await expect
      .poll(() => getNoteContentByRouteId(app.page, 'equipment/dumbbell-custom'), { timeout: 15_000 })
      .not.toBeNull();
    const clonedRaw = await getNoteContentByRouteId(app.page, 'equipment/dumbbell-custom');
    expect(clonedRaw).toContain('slug: dumbbell-custom');
    expect(clonedRaw).toContain('registrySource: user');
    expect(stripFrontmatter(clonedRaw)).toBe(stripFrontmatter(authoredSource));
    await app.page.screenshot({ path: testInfo.outputPath('equipment-clone-custom.png') });

    // 3. Reload reads the committed custom copy back; bundled source untouched.
    const reloaded = await app.properties.openEquipment('dumbbell-custom');
    await reloaded.waitForDetailLoaded();
    await expect(reloaded.detailLabel()).toHaveText('Dumbbell (Custom)');
    await expect(reloaded.notebookEditor().locator('.cm-content > .cm-line')).toHaveText(editorLines);
    expect(await getNoteContentByRouteId(app.page, 'equipment/dumbbell'), 'bundled source untouched by the clone').toBe(authoredSource);
    await app.assertCleanConsole();
  });
});
