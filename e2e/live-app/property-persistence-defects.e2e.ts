import { expect, test, type Page } from '@playwright/test';
import { EffortsPage } from '../pages/EffortsPage';
import { EquipmentPage } from '../pages/EquipmentPage';
import { waitForFeedReady } from '../helpers/feedReadiness';
import { getNoteContentByRouteId, WOD_DB } from '../helpers/wodwikiDb';
import { seedBundledEfforts } from '../helpers/seedEfforts';
import { seedBundledEquipment } from '../helpers/seedEquipment';
async function currentDocument(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = document.querySelector('.cm-editor')?.parentElement?.__codemirrorView as
      | { state: { doc: { toString(): string } } }
      | undefined;
    if (!view) throw new Error('CodeMirror view was not exposed for test automation');
    return view.state.doc.toString();
  });
}

async function replaceDocument(page: Page, document: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((text) => navigator.clipboard.writeText(text), document);
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
}

test.describe('Property Note persistence acceptance', () => {
  test.setTimeout(90_000);

  test('Save Category Note preserves frontmatter and its executable projection', async ({ page }) => {
    await page.goto('/t/domain', { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await expect(page.getByRole('button', { name: 'Save Category Note' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Edit YAML' }).click();
    const source = await currentDocument(page);
    const edited = source.replace('\n---\n', '\nmetrics.resistance: 12 kg\n---\n');
    expect(edited).toContain('metrics.resistance: 12 kg');
    await replaceDocument(page, edited);
    await page.getByRole('button', { name: 'Save Category Note' }).click();

    await expect.poll(() => getNoteContentByRouteId(page, 't/domain'), { timeout: 15_000 })
      .toContain('metrics.resistance: 12 kg');
    const contributions = await page.evaluate(async (dbName) => {
      const open = Promise.withResolvers<IDBDatabase>();
      const openRequest = indexedDB.open(dbName);
      openRequest.onsuccess = () => open.resolve(openRequest.result);
      openRequest.onerror = () => open.reject(openRequest.error);
      const db = await open.promise;
      const tx = db.transaction('tag_types', 'readonly');
      const getAll = Promise.withResolvers<Array<{ name: string; contributions?: unknown[] }>>();
      const readRequest = tx.objectStore('tag_types').getAll();
      readRequest.onsuccess = () => getAll.resolve(readRequest.result);
      readRequest.onerror = () => getAll.reject(readRequest.error);
      const records = await getAll.promise;
      db.close();
      return records.find((record) => record.name === 'domain')?.contributions;
    }, WOD_DB);
    expect(contributions).toContainEqual({ kind: 'metric', type: 'resistance', value: 12, unit: 'kg' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.cm-frontmatter-preview')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Show property details' }).click();
    await expect(page.getByLabel('Value for metrics.resistance')).toHaveValue('12 kg');
  });

  test('the synthesized tonnage widget uses a supported query', async ({ page }) => {
    await page.goto('/t/tag/tonnage', { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await expect(page.getByRole('heading', { name: 'Edit tonnage' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.cm-note-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Query syntax error/i)).toHaveCount(0);
    await expect(page.locator('.cm-query-block-preview').first()).toBeVisible();
  });

  test('editing a bundled Effort creates and reloads a custom copy without a conflict', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const efforts = new EffortsPage(page);
    await efforts.gotoDetail('thruster');
    await seedBundledEfforts(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();

    await page.getByRole('button', { name: 'Show property details' }).click();
    const met = efforts.frontmatterProperties().getByLabel('MET value');
    await met.fill('9');
    await met.press('Enter');

    await expect.poll(() => getNoteContentByRouteId(page, 'effort/thruster-custom'), { timeout: 15_000 })
      .toContain('met: 9');
    await expect(page.getByText(/Save failed|changed since it was loaded/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/effort\/thruster-custom$/, { timeout: 15_000 });

    await efforts.gotoDetail('thruster-custom');
    await expect(efforts.detailSource()).toContainText('Custom');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await efforts.waitForDetailLoaded();
    await page.getByRole('button', { name: 'Show property details' }).click();
    await expect(efforts.frontmatterProperties().getByLabel('MET value')).toHaveValue('9');
    await efforts.gotoDetail('thruster');
    await expect(efforts.detailSource()).toContainText('Bundled');
    await page.getByRole('button', { name: 'Show property details' }).click();
    await expect(efforts.frontmatterProperties().getByLabel('MET value')).toHaveValue('8');
    expect(pageErrors).toEqual([]);
  });

  test('editing bundled Equipment commits and navigates to a custom copy', async ({ page }) => {
    const equipment = new EquipmentPage(page);
    await page.goto('/equipment/dumbbell', { waitUntil: 'domcontentloaded' });
    await waitForFeedReady(page);
    await seedBundledEquipment(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await equipment.waitForDetailLoaded();

    await page.getByRole('button', { name: 'Show property details' }).first().click();
    const label = equipment.notebookEditor().locator('.cm-frontmatter-preview').getByLabel('Value for label');
    await label.fill('Dumbbell Heavy');
    await label.press('Enter');

    await expect(page).toHaveURL(/\/equipment\/dumbbell-custom$/, { timeout: 15_000 });
    await expect(equipment.detailSource()).toContainText('Custom');
    await expect.poll(() => getNoteContentByRouteId(page, 'equipment/dumbbell-custom'), { timeout: 15_000 })
      .toContain('Dumbbell Heavy');
    await expect.poll(() => getNoteContentByRouteId(page, 'equipment/dumbbell')).not.toContain('Dumbbell Heavy');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await equipment.waitForDetailLoaded();
    await page.getByRole('button', { name: 'Show property details' }).first().click();
    await expect(equipment.notebookEditor().locator('.cm-frontmatter-preview').getByLabel('Value for label'))
      .toHaveValue('Dumbbell Heavy (Custom)');
  });
});
