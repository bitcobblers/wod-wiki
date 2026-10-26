import { expect, test, type Page } from '@playwright/test';
import { EquipmentPage } from '../pages/EquipmentPage';
import {
  BUNDLED_EQUIPMENT_FIXTURES,
  customEquipmentDocument,
  seedBundledEquipment,
  USAGE_NOTE_TITLE,
} from '../helpers/seedEquipment';
import { getNoteContentByRouteId } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

function attachErrorCapture(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  return {
    expectClean() {
      expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
      expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
    },
  };
}

const DUMBBELL = BUNDLED_EQUIPMENT_FIXTURES[0];

test.describe('Equipment — /equipment L1 surfaces', () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    test(`reaches the Equipment L1 from the nav rail and lands on the list at ${viewport.width}px`, async ({ page }) => {
      const errors = attachErrorCapture(page);
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await waitForFeedReady(page);
      await seedBundledEquipment(page);
      await page.reload({ waitUntil: 'domcontentloaded' });

      const equipment = new EquipmentPage(page);
      await equipment.clickEquipmentNav();
      await equipment.waitForListLoaded();

      // The seeded bundled corpus is listed (real notes, not placeholders).
      await expect(equipment.equipmentRow('dumbbell')).toBeVisible({ timeout: 15_000 });
      await expect(equipment.equipmentRow('kettlebell')).toBeVisible();

      errors.expectClean();
    });
  }

  test('desktop L2 panel offers New equipment and All Equipment on the list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/equipment', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    // L2 rows: the landing ("All Equipment") and the create action, sharing
    // the stream panel conventions with Efforts.
    await expect(page.getByText('All Equipment').first()).toBeVisible();
    const newEquipment = page.getByTestId('equipment-create-equipment');
    await expect(newEquipment).toBeVisible();
    await newEquipment.click();
    await expect(page).toHaveURL(/\/equipment\/new\?mode=create$/);
  });

  test('renders bundled equipment as a real note page and clones it preserving the source', async ({ page }) => {
    const errors = attachErrorCapture(page);
    await page.goto('/equipment/dumbbell', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await seedBundledEquipment(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const equipment = new EquipmentPage(page);
    await equipment.waitForDetailLoaded();

    // Real note content through the journal note shell/editor — same layout
    // as an effort detail, frontmatter + body from the owner note.
    await expect(equipment.detailLabel()).toHaveText('Dumbbell');
    await expect(equipment.detailSource()).toContainText('Bundled');
    await expect(equipment.notebookEditor()).toBeVisible();
    const sourceBody = await equipment.notebookEditor().locator('.cm-content > .cm-line').allTextContents();

    // Copy-to-edit: the clone keeps the authored source and becomes editable.
    await equipment.cloneButton().click();
    await expect(equipment.detailLabel()).toHaveText('Dumbbell (Custom)');
    await expect(equipment.detailSource()).toContainText('Custom');
    await expect(equipment.notebookEditor().locator('.cm-content > .cm-line')).toHaveText(sourceBody);

    // Editing the custom copy commits the CUSTOM identity (slug/id/label) —
    // never the bundled projection — with the source body preserved.
    const clonedContent = await getNoteContentByRouteId(page, 'equipment/dumbbell-custom');
    const idMatch = clonedContent?.match(/^id:\s*(.+)$/m);
    const existingId = idMatch ? idMatch[1].trim() : undefined;
    await equipment.replaceEditorDocument(
      customEquipmentDocument(DUMBBELL, 'dumbbell-custom', 'Updated after clone.', existingId),
    );
    await expect
      .poll(() => getNoteContentByRouteId(page, 'equipment/dumbbell-custom'), { timeout: 15_000 })
      .toContain('Updated after clone.');

    await page.goto('/equipment/dumbbell-custom', { waitUntil: 'domcontentloaded' });
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Dumbbell (Custom)');
    await expect(equipment.notebookEditor().getByText('Updated after clone.')).toBeVisible();

    // A reload reads the committed custom source back.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Dumbbell (Custom)');
    await expect(equipment.notebookEditor().getByText('Updated after clone.')).toBeVisible();

    errors.expectClean();
  });

  test('creates custom equipment through the note editor and survives reload', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const slug = `plate-e2e-${Date.now()}`;
    await page.goto('/equipment/new?mode=create', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    const equipment = new EquipmentPage(page);
    // Create uses the same editor layout as edit — no detached textarea page.
    await expect(equipment.createEditor().locator('.cm-note-editor')).toBeVisible();
    await expect(equipment.createEditor().locator('textarea')).toHaveCount(0);

    await equipment.replaceEditorDocument(
      [
        '---',
        'type: equipment',
        `id: equipment-user-${slug}`,
        `slug: ${slug}`,
        'label: "Training Plate"',
        'aliases:',
        '  - plates',
        '---',
        'Bumper plates for loading barbells.',
        '',
      ].join('\n'),
    );
    await equipment.createButton().click();

    await expect(page).toHaveURL(new RegExp(`/equipment/${slug}$`), { timeout: 15_000 });
    await expect(equipment.detailLabel()).toHaveText('Training Plate');
    await expect(equipment.detailSource()).toContainText('Custom');

    // The committed note is the durable source — reload reads it back.
    await expect
      .poll(() => getNoteContentByRouteId(page, `equipment/${slug}`), { timeout: 15_000 })
      .toContain('Bumper plates for loading barbells.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Training Plate');
    await expect(equipment.notebookEditor().getByText('Bumper plates for loading barbells.')).toBeVisible();

    errors.expectClean();
  });

  test('create and edit custom equipment from a phone viewport', async ({ page }) => {
    const errors = attachErrorCapture(page);
    const slug = `plate-mobile-${Date.now()}`;
    await page.setViewportSize({ width: 375, height: 812 });

    // ── Create: the editor field must be reachable and typable by touch. ──
    await page.goto('/equipment/new?mode=create', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    const equipment = new EquipmentPage(page);
    await equipment.replaceEditorDocument(
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

    // Create is the primary dock action on mobile.
    await equipment.createButton().click();
    await expect(page).toHaveURL(new RegExp(`/equipment/${slug}$`), { timeout: 15_000 });
    await expect(equipment.detailLabel()).toHaveText('Mobile Plate');

    // ── Edit: the saved note's editor accepts touch input and persists. ──
    await equipment.replaceEditorDocument(
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
    await expect
      .poll(() => getNoteContentByRouteId(page, `equipment/${slug}`), { timeout: 15_000 })
      .toContain('Edited on mobile after create.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await equipment.waitForDetailLoaded();
    await expect(equipment.detailLabel()).toHaveText('Mobile Plate');
    await expect(equipment.notebookEditor().getByText('Edited on mobile after create.')).toBeVisible();

    errors.expectClean();
  });

  test('links usage with real titles and related efforts from the canonical indices', async ({ page }) => {
    const errors = attachErrorCapture(page);
    await page.goto('/equipment/dumbbell', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await seedBundledEquipment(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const equipment = new EquipmentPage(page);
    await equipment.waitForDetailLoaded();

    // Related efforts: definitions referencing this equipment, linked to the
    // effort detail route.
    const relatedEffort = equipment.contextLink('Dumbbell Snatch');
    await expect(relatedEffort).toBeVisible();
    await relatedEffort.click();
    await expect(page).toHaveURL(/\/effort\/dumbbell-snatch$/);

    // Usage: the consumer workout note by its real title.
    await page.goBack();
    await equipment.waitForDetailLoaded();
    const usage = equipment.contextLink(USAGE_NOTE_TITLE);
    await expect(usage).toBeVisible();
    await usage.click();
    await expect(page).toHaveURL(/\/notebook\/equipment-e2e-gym\/dumbbell-day$/);

    errors.expectClean();
  });

  test('opens equipment entries on the dedicated route while generic note access survives', async ({ page }) => {
    const errors = attachErrorCapture(page);
    await page.goto('/equipment/dumbbell', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);
    await seedBundledEquipment(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const equipment = new EquipmentPage(page);
    // From the list, opening an equipment entry routes to /equipment/<slug>.
    await equipment.gotoList();
    await equipment.equipmentRow('dumbbell').click();
    await expect(page).toHaveURL(/\/equipment\/dumbbell$/, { timeout: 10_000 });
    await expect(equipment.detailLabel()).toHaveText('Dumbbell');

    // The same source note stays reachable through the canonical note editor.
    await page.goto(`/note/${encodeURIComponent('equipment/dumbbell')}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-note-editor').first()).toBeVisible();
    await expect(page.locator('.cm-content').first()).toContainText('handheld free weight');

    errors.expectClean();
  });

  test('shows a recoverable not-found state for unknown slugs', async ({ page }) => {
    await page.goto('/equipment/nonexistent-gear-12345', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    const equipment = new EquipmentPage(page);
    await expect(equipment.detailNotFound()).toBeVisible();
    await expect(equipment.notFoundCreateButton()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Equipment' })).toBeVisible();
  });
});
