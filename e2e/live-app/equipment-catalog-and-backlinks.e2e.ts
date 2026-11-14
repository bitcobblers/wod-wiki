// spec: e2e/specs/properties/equipment-catalog-and-backlinks.md
/**
 * PRP-02 — Equipment catalog & backlinks (P1-core)
 *
 * `/equipment` L1 catalog rendering across desktop + 375×812, bundled
 * Equipment Property Note clone-to-custom and inline auto-clone flows,
 * mobile custom Equipment creation/editing, canonical `/note/:noteId` access,
 * cross-index backlinks, and unknown-slug recovery.
 */

import { test, expect, TEST_IDS } from '../fixtures/playgroundActor';
import { USAGE_NOTE_TITLE } from '../helpers/seedEquipment';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 375, height: 812 },
];

test.describe('PRP-02 — Equipment catalog & backlinks', () => {
  test('Scenario 1: /equipment L1 renders bundled Equipment across desktop + 375×812 and exposes canonical /note access', async ({
    app,
  }) => {
    for (const viewport of VIEWPORTS) {
      await app.page.setViewportSize(viewport);
      await app.seed.bundledEquipment();

      let equipment = await app.properties.openEquipment();
      await equipment.waitForListLoaded();
      await expect(
        equipment.equipmentRow('dumbbell'),
        `catalog lists dumbbell at ${viewport.width}px`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(equipment.equipmentRow('kettlebell')).toBeVisible();

      if (viewport.width === 1280) {
        await expect(app.page.getByText('All Equipment').first()).toBeVisible();
        await expect(app.page.getByTestId('equipment-create-equipment')).toHaveCount(0);
        const addPrimary = app.page.getByTestId(TEST_IDS.NEW_ENTRY_PRIMARY);
        await expect(addPrimary).toHaveText('+ Add');
        await expect(addPrimary).toHaveAttribute('aria-label', '+ Add Equipment');
      }

      if (viewport.width === 375) {
        const overflow = await app.page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow, 'no horizontal overflow at 375px').toBe(false);
      }

      // L2 detail renders as a real Note page: label, Bundled source, authored Markdown.
      equipment = await app.properties.openEquipment('dumbbell');
      await equipment.waitForDetailLoaded();
      await expect(equipment.detailLabel()).toHaveText('Dumbbell');
      await expect(equipment.detailSource()).toContainText('Bundled');
      await expect(equipment.notebookEditor()).toBeVisible();
    }

    // Canonical /note/:noteId route resolves the same Equipment owner Note
    await app.page.setViewportSize(VIEWPORTS[0]!);
    await app.editor.openNote(encodeURIComponent('equipment/dumbbell'));
    await expect(app.page.locator('.cm-note-editor').first()).toBeVisible();
    await expect(app.page.locator('.cm-content').first()).toContainText('handheld free weight');

    app.assertCleanConsole();
  });

  test('Scenario 2: bundled Equipment clone-to-custom preserves authored Markdown and leaves bundled source untouched', async ({
    app,
  }, testInfo) => {
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
    expect(
      await getNoteContentByRouteId(app.page, 'equipment/dumbbell'),
      'bundled source untouched by the clone',
    ).toBe(authoredSource);
    app.assertCleanConsole();
  });

  test('Scenario 3: Equipment detail surfaces canonical backlinks to related Efforts and referencing workout Notes', async ({
    app,
  }) => {
    await app.page.setViewportSize(VIEWPORTS[0]!);
    await app.seed.bundledEquipment();

    const equipment = await app.properties.openEquipment('dumbbell');
    await equipment.waitForDetailLoaded();

    const relatedEffort = equipment.contextLink('Dumbbell Snatch');
    await expect(relatedEffort).toBeVisible();
    await relatedEffort.click();
    await expect(app.page).toHaveURL(/\/effort\/dumbbell-snatch$/);

    await app.page.goBack();
    await equipment.waitForDetailLoaded();
    const usage = equipment.contextLink(USAGE_NOTE_TITLE);
    await expect(usage).toBeVisible();
    await usage.click();
    await expect(app.page).toHaveURL(/\/notebook\/equipment-e2e-gym\/dumbbell-day$/);

    app.assertCleanConsole();
  });

  test('Scenario 4: creates and edits Custom Equipment on 375×812 mobile, auto-clones bundled Equipment on inline edit, and recovers on unknown slug', async ({
    app,
  }) => {
    const slug = `plate-mobile-${Date.now().toString().slice(-6)}`;

    // 1. Mobile 375×812 Custom Equipment creation + body edit persistence across reload
    await app.page.setViewportSize(VIEWPORTS[1]!);
    await app.goto('/equipment/new?mode=create');

    const createRoot = app.page.getByTestId('equipment-create-editor');
    await expect(createRoot.locator('.cm-note-editor')).toBeVisible();
    await expect(createRoot.locator('textarea')).toHaveCount(0);

    await app.page.getByRole('button', { name: 'Edit YAML' }).click();
    await app.editor.replaceDocument(
      [
        '---',
        'type: equipment',
        `id: equipment-user-${slug}`,
        `slug: ${slug}`,
        'label: "Mobile Plate"',
        'aliases:',
        '  - mobile plates',
        '---',
        'Typed from a phone viewport.',
        '',
      ].join('\n'),
    );
    await app.page.getByTestId(TEST_IDS.EQUIPMENT_CREATE_BTN).click();

    await expect(app.page).toHaveURL(new RegExp(`/equipment/${slug}$`), { timeout: 15_000 });
    await expect(app.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_LABEL)).toHaveText('Mobile Plate');
    await expect(app.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_SOURCE)).toContainText('Custom');

    await app.page.getByRole('button', { name: 'Edit YAML' }).click();
    await app.editor.replaceDocument(
      [
        '---',
        'type: equipment',
        `id: equipment-user-${slug}`,
        `slug: ${slug}`,
        'label: "Mobile Plate"',
        'aliases:',
        '  - mobile plates',
        '---',
        'Typed from a phone viewport.',
        '',
        'Edited on mobile after create.',
        '',
      ].join('\n'),
    );
    await app.page.locator('.cm-content').first().blur();

    await expect
      .poll(() => getNoteContentByRouteId(app.page, `equipment/${slug}`), { timeout: 15_000 })
      .toContain('Edited on mobile after create.');

    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await expect(app.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_LABEL)).toHaveText('Mobile Plate');
    await expect(app.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_NOTEBOOK_EDITOR)).toContainText(
      'Edited on mobile after create.',
    );

    // 2. Desktop inline edit on bundled /equipment/kettlebell auto-clones to kettlebell-custom
    await app.page.setViewportSize(VIEWPORTS[0]!);
    await app.seed.bundledEquipment();
    const kettlebell = await app.properties.openEquipment('kettlebell');
    await kettlebell.waitForDetailLoaded();

    await app.page.getByRole('button', { name: 'Show property details' }).first().click();
    const labelInput = kettlebell.notebookEditor().locator('.cm-frontmatter-preview').getByLabel('Value for label');
    await labelInput.fill('Kettlebell Heavy');
    await labelInput.press('Enter');

    await expect(app.page).toHaveURL(/\/equipment\/kettlebell-custom$/, { timeout: 15_000 });
    await expect(kettlebell.detailSource()).toContainText('Custom');
    await expect
      .poll(() => getNoteContentByRouteId(app.page, 'equipment/kettlebell-custom'), { timeout: 15_000 })
      .toContain('Kettlebell Heavy');
    await expect
      .poll(() => getNoteContentByRouteId(app.page, 'equipment/kettlebell'))
      .not.toContain('Kettlebell Heavy');

    await app.page.reload({ waitUntil: 'domcontentloaded' });
    await app.feeds.waitForReady();
    await kettlebell.waitForDetailLoaded();
    await app.page.getByRole('button', { name: 'Show property details' }).first().click();
    await expect(
      kettlebell.notebookEditor().locator('.cm-frontmatter-preview').getByLabel('Value for label'),
    ).toHaveValue('Kettlebell Heavy (Custom)');

    // 3. Unknown Equipment slug renders recoverable not-found view
    const missing = await app.properties.openEquipment('nonexistent-apparatus-12345');
    await expect(missing.detailNotFound()).toBeVisible();
    await expect(missing.notFoundCreateButton()).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Back to Equipment' })).toBeVisible();

    app.assertCleanConsole();
  });
});
