import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_IDS } from '../contracts/TestIdContract';
import { waitForSeedReady } from '../helpers/seedReadiness';

/** Live-app page object for the equipment L1 surfaces: /equipment list,
 *  /equipment/:slug detail, /equipment/new?mode=create. */
export class EquipmentPage {
  constructor(readonly page: Page) {}

  async gotoList() {
    await this.page.goto('/equipment', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(this.page);
    await this.waitForListLoaded();
  }

  async gotoDetail(slug: string) {
    await this.page.goto(`/equipment/${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(this.page);
    await this.waitForDetailLoaded();
  }

  async gotoCreate(slug?: string) {
    const path = slug ? `/equipment/${encodeURIComponent(slug)}?mode=create` : '/equipment/new?mode=create';
    await this.page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForSeedReady(this.page);
    await expect(this.createEditor()).toBeVisible({ timeout: 15_000 });
  }

  listRoot(): Locator {
    return this.page.getByTestId('queriable-stream-view');
  }

  emptyState(): Locator {
    return this.page.getByTestId('stream-empty-state');
  }

  equipmentRow(slug: string): Locator {
    const title = slug.replace(/-/g, ' ');
    const pattern = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return this.page
      .locator('[data-testid="library-row-equipment"]')
      .filter({ has: this.page.getByRole('heading', { name: pattern }) })
      .first();
  }

  detailRoot(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_ROOT);
  }

  detailNotFound(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_NOT_FOUND);
  }

  detailLabel(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_LABEL);
  }

  detailSource(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_SOURCE);
  }

  cloneButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_CLONE_BTN);
  }

  createButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_CREATE_BTN);
  }

  notFoundCreateButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_NOT_FOUND_CREATE_BTN);
  }

  notebookEditor(): Locator {
    return this.page.getByTestId(TEST_IDS.EQUIPMENT_DETAIL_NOTEBOOK_EDITOR);
  }

  createEditor(): Locator {
    return this.page.getByTestId('equipment-create-editor');
  }

  editorContent(): Locator {
    return this.notebookEditor().or(this.createEditor()).locator('.cm-content').first();
  }

  /** L2 sidebar section link by label ("Used in", "Efforts", "Up", …) —
   *  MenuList renders link entries as buttons, not anchors. */
  contextLink(label: string): Locator {
    return this.page.getByRole('button', { name: label });
  }

  async waitForListLoaded() {
    await expect(this.listRoot()).toBeVisible({ timeout: 15_000 });
  }

  async waitForDetailLoaded() {
    await expect(this.detailRoot().or(this.detailNotFound())).toBeVisible({ timeout: 15_000 });
  }

  /** Replace the whole editor document through the real CodeMirror view. */
  async replaceEditorDocument(text: string) {
    const replaced = await this.page.evaluate((docText) => {
      const el = document.querySelector('[data-testid="equipment-create-editor"], [data-testid="equipment-detail-notebook-editor"]');
      const container = el?.querySelector('.cm-editor')?.parentElement;
      if (container && '__codemirrorView' in container) {
        const view = container.__codemirrorView;
        if (view && typeof view === 'object' && 'state' in view && 'dispatch' in view) {
          const cm = view as { state: { doc: { length: number } }; dispatch: (tr: unknown) => void };
          cm.dispatch({
            changes: { from: 0, to: cm.state.doc.length, insert: docText },
          });
          return true;
        }
      }
      return false;
    }, text);
    if (!replaced) {
      const editor = this.editorContent();
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await this.page.keyboard.press(`${modifier}+a`);
      await this.page.keyboard.insertText(text);
    }
    // Real save trigger — drafts persist on blur (useEditorSave has no idle
    // timer); typing-only edits must blur, as a touch user tapping away would.
    await this.editorContent().blur();
    await this.page.waitForTimeout(300);
  }

  /** Click the Equipment L1 destination in the app rail (desktop) or the
   *  mobile navigation drawer. */
  async clickEquipmentNav() {
    const mobile = (await this.page.viewportSize())?.width === 375;
    if (mobile) {
      await this.page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await this.page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'Equipment' })
      .click();
    await this.page.waitForURL(/\/equipment/, { timeout: 10_000 });
    if (mobile) {
      await this.page.getByRole('button', { name: 'Close navigation' }).click();
    }
  }
}
