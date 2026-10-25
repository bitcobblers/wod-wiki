import { expect, type Locator, type Page } from '@playwright/test';
import { TEST_IDS } from '../contracts/TestIdContract';
import { waitForFeedReady } from '../helpers/feedReadiness';

const DB_NAME = 'wodwiki-db';

export class EffortsPage {
  constructor(readonly page: Page) {}

  async gotoCatalog() {
    await this.page.goto('/efforts', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(this.page);
    await this.waitForCatalogLoaded();
  }

  async gotoDetail(slug: string) {
    await this.page.goto(`/e/${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(this.page);
    await this.waitForDetailLoaded();
  }

  catalogRoot(): Locator {
    return this.page.getByTestId('queriable-stream-view');
  }

  catalogSearch(): Locator {
    return this.page.locator('[data-testid="wql-text-editor"] .cm-content').first();
  }

  createCustomButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORTS_CATALOG_CREATE_BTN);
  }

  emptyState(): Locator {
    return this.page.getByTestId('stream-empty-state');
  }

  /** Exact-title row match: `^title$i` (case-insensitive) — a prefix match
   *  would click through to the wrong detail ('burpee' ⊂ 'Burpee pull up'). */
  effortRow(slug: string): Locator {
    const title = slug.replace(/-/g, ' ');
    const pattern = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return this.page
      .locator('[data-testid="library-row-effort"]')
      .filter({ has: this.page.getByRole('heading', { name: pattern }) })
      .first();
  }

  effortRows(): Locator {
    return this.page.locator('[data-testid="library-row-effort"]');
  }

  detailRoot(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_ROOT);
  }

  detailNotFound(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_NOT_FOUND);
  }

  detailLabel(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_LABEL);
  }

  detailSource(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_SOURCE);
  }

  cloneButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_CLONE_BTN);
  }

  editButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_EDIT_BTN);
  }

  saveButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_SAVE_BTN);
  }

  cancelButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_CANCEL_BTN);
  }

  deleteButton(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_DELETE_BTN);
  }

  notebookEditor(): Locator {
    return this.page.getByTestId(TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR);
  }

  /** Frontmatter renders as a read-only properties table inside the editor. */
  frontmatterProperties(): Locator {
    return this.notebookEditor().locator('.cm-frontmatter-preview');
  }

  editorContent(): Locator {
    return this.notebookEditor().locator('.cm-content').first();
  }

  async waitForCatalogLoaded() {
    await expect(this.catalogRoot()).toBeVisible({ timeout: 15_000 });
  }

  async waitForDetailLoaded() {
    await expect(this.detailRoot().or(this.detailNotFound())).toBeVisible({ timeout: 15_000 });
  }

  /**
   * First boot seed-imports the bundled registry into IndexedDB in the
   * background; the catalog/detail render the built-in fixture set until it
   * lands and the page is reloaded. Waits for the imported registry.
   */
  async waitForSeedRegistry(minRows = 20) {
    await expect
      .poll(
        () =>
          this.page.evaluate(
            (dbName) =>
              new Promise<number>((resolve) => {
                const req = indexedDB.open(dbName);
                req.onsuccess = () => {
                  const db = req.result;
                  if (!db.objectStoreNames.contains('efforts')) {
                    db.close();
                    resolve(0);
                    return;
                  }
                  const tx = db.transaction(['efforts'], 'readonly');
                  const countReq = tx.objectStore('efforts').count();
                  countReq.onsuccess = () => {
                    db.close();
                    resolve(countReq.result);
                  };
                  countReq.onerror = () => {
                    db.close();
                    resolve(0);
                  };
                };
                req.onerror = () => resolve(0);
              }),
            DB_NAME,
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(minRows);
  }

  async clickEffortRow(slug: string) {
    await this.effortRow(slug).click();
    await this.page.waitForURL(/\/e\//, { timeout: 10_000 });
  }

  /** Replace the catalog WQL query in the header composer and apply it. */
  async applyQuery(wql: string) {
    const composer = this.catalogSearch();
    await composer.click();
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.insertText(wql);
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(150);
  }

  async searchFor(term: string) {
    if (!term) {
      await this.applyQuery(':effort');
      return;
    }
    const literal = /\s/.test(term) ? `"${term}"` : term;
    await this.applyQuery(`:effort{text:${literal}}`);
  }

  async replaceEditorDocument(text: string) {
    const editor = this.editorContent();
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.click();
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.insertText(text);
    await this.page.waitForTimeout(100);
  }

  async clearUserEfforts() {
    await this.page.evaluate(async (dbName) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName as string);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['efforts'], 'readwrite');
          const store = tx.objectStore('efforts');
          const getAllReq = store.getAll();

          getAllReq.onsuccess = () => {
            for (const effort of getAllReq.result ?? []) {
              if (effort.registrySource === 'user') {
                store.delete(effort.slug);
              }
            }
          };

          getAllReq.onerror = () => {
            db.close();
            reject(getAllReq.error);
          };

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
    }, DB_NAME);
  }

  async seedUserEffort({ slug, label, discipline = 'strength', intensityTier = 'moderate', body }: {
    slug: string;
    label: string;
    discipline?: string;
    intensityTier?: string;
    body?: string;
  }) {
    await this.page.evaluate(async ({ dbName, slug, label, discipline, intensityTier, body }) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName as string);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['efforts'], 'readwrite');
          tx.objectStore('efforts').put({
            id: `effort-user-${slug}`,
            slug,
            label,
            aliases: [],
            baseAttributes: {
              met: 7.5,
              discipline,
              intensityTier,
            },
            registrySource: 'user',
            body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = () => reject(req.error);
      });
    }, { dbName: DB_NAME, slug, label, discipline, intensityTier, body });
  }
}
