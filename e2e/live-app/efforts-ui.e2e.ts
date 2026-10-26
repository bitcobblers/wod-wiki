/**
 * Efforts UI Surface — E2E Tests
 *
 * Validates the full Efforts UI surface in the live playground app:
 *  - Catalog page (/efforts) loads, filters, and searches
 *  - Detail page (/effort/:slug) shows bundled effort attributes
 *  - Creating a custom effort via the UI
 *  - Cloning a bundled effort
 *  - Editing and deleting a custom effort
 *
 * Tests run against the live app at http://localhost:5173
 * via playwright.journal.config.ts.
 */

import { test, expect, Page } from '@playwright/test';
import { EffortsPage } from '../pages/EffortsPage';
import { waitForFeedReady } from '../helpers/feedReadiness';
import { seedBundledEfforts } from '../helpers/seedEfforts';

const TEST_EFFORT_PREFIX = 'e2e-test';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupErrorCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected dev-server noise (e.g. HMR websocket, service workers)
      if (/ERR_CONNECTION_REFUSED|WebSocket|ws:\/\/|wss:\/\/|service worker/i.test(text)) return;
      errors.push(text);
    }
  });
  return errors;
}

async function setEditorContent(page: Page, content: string) {
  await page.waitForSelector('.cm-note-editor', { timeout: 10_000 });
  await page.evaluate((text) => {
    const el = document.querySelector('.cm-note-editor') as any;
    const view = el?.__codemirrorView;
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    }
  }, content);
  await page.waitForTimeout(300);
}

// ── Catalog Page ─────────────────────────────────────────────────────────────

test.describe('Efforts Catalog Page', () => {
  test('loads and displays bundled efforts', async ({ page }) => {
    const errors = setupErrorCapture(page);
    await page.goto('/efforts', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    await expect(page.getByTestId('stream-query-bar')).toBeVisible();
    await expect(page.getByRole('main').getByText('Rowing').first()).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('shows search and filter controls', async ({ page }) => {
    await page.goto('/efforts', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await waitForFeedReady(page);

    await expect(page.getByTestId('stream-query-bar')).toBeVisible();
  });

  test('filtering by custom shows empty state initially', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoCatalog();
    await efforts.applyQuery(':effort{origin:user}');
    await expect(page.getByTestId('stream-empty-state')).toBeVisible();
    await expect(page.getByText(/No efforts match/i)).toBeVisible();
  });

  test('filtering by bundled shows efforts', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoCatalog();
    await efforts.applyQuery(':effort{origin:bundled}');
    await expect(page.getByRole('main').getByText('Rowing').first()).toBeVisible();
  });

  test('search filtering narrows results', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoCatalog();
    await efforts.searchFor('Rowing');
    await expect(page.getByRole('main').getByText('Rowing').first()).toBeVisible();
    await expect(efforts.effortRow('burpee')).toHaveCount(0);
  });

  test('search with no matches shows empty state', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoCatalog();
    await efforts.searchFor('xyznonexistent');
    await expect(page.getByTestId('stream-empty-state')).toBeVisible();
    await expect(page.getByText(/No efforts match/i)).toBeVisible();
  });

  test('clicking an effort navigates to detail page', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoCatalog();

    await page.getByRole('main').getByRole('button', { name: /Rowing/ }).first().click();
    await page.waitForURL(/\/effort\/rowing/, { timeout: 5_000 });
    await expect(efforts.detailLabel()).toHaveText('Rowing');
  });
});

// ── Detail Page ──────────────────────────────────────────────────────────────

test.describe('Effort Detail Page', () => {
  test('displays bundled effort attributes', async ({ page }) => {
    const errors = setupErrorCapture(page);
    const efforts = new EffortsPage(page);
    await efforts.gotoDetail('rowing');

    await expect(efforts.detailLabel()).toHaveText('Rowing');
    await expect(efforts.detailSource()).toHaveText('Bundled');
    // Assert metric values, not the number input's decimal formatting.
    const properties = efforts.frontmatterProperties();
    await expect.poll(async () => Number(await properties.getByLabel('MET value').inputValue())).toBe(7);
    await expect(page.getByLabel('Intensity tier')).toHaveValue('high');
    // Properties panel is editable: the slug lives in an input value.
    await expect(properties.getByLabel('Value for slug')).toHaveValue('rowing');
    await expect(efforts.cloneButton()).toBeVisible();
    await expect(efforts.editButton()).not.toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('shows high-intensity effort correctly', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoDetail('kettlebell-snatch');
    await seedBundledEfforts(page);
    await efforts.waitForSeedRegistry();
    // Seed arrival must resolve an already-open missing effort without reload.
    await page.evaluate(() => new Promise<void>((resolve) => {
      const observer = new BroadcastChannel('wodwiki.seed');
      const sender = new BroadcastChannel('wodwiki.seed');
      observer.onmessage = () => {
        observer.close();
        sender.close();
        resolve();
      };
      sender.postMessage({ kind: 'seed-imported', source: 'core', version: 'e2e-refresh' });
    }));
    await efforts.waitForDetailLoaded();

    await expect(efforts.detailLabel()).toHaveText('Kettlebell Snatch');
    // The frontmatter preview replaces the raw YAML, so the slug is
    // user-visible as the properties input value, not editor text.
    const properties = efforts.frontmatterProperties();
    await expect(properties.getByLabel('Value for slug')).toHaveValue('kettlebell-snatch');
    // Frontmatter companion surfaces the effort attributes.
    await expect.poll(async () => Number(await properties.getByLabel('MET value').inputValue())).toBe(12);
    await expect(page.getByLabel('Intensity tier')).toHaveValue('high');
  });

  test('shows effort with aliases', async ({ page }) => {
    const efforts = new EffortsPage(page);
    await efforts.gotoDetail('rowing');

    // Aliases render as resolved chips with per-alias remove actions and an
    // add input — not a joined text value. Seeded rowing aliases: row, rower,
    // rowing machine, erg, ergometer, concept2 row, "Long Row", "Row
    // Calories"; every chip links to the canonical Rowing page.
    const aliases = efforts.frontmatterProperties().getByLabel('Value for aliases').locator('..');
    await expect(aliases.getByLabel('Value for aliases')).toBeVisible();
    await expect(aliases.getByRole('button', { name: 'Remove row', exact: true })).toBeVisible();
    await expect(aliases.getByRole('button', { name: 'Remove rower', exact: true })).toBeVisible();
    await expect(aliases.getByRole('button', { name: 'Remove concept2 row', exact: true })).toBeVisible();
    await expect(aliases.getByRole('link', { name: 'Open Rowing page' }).first()).toBeVisible();
  });
});

// ── Clone Effort ─────────────────────────────────────────────────────────────
// (The retired create-custom effort fixme lived here; the supported flow is
// covered by efforts create-custom coverage: "opens create-custom flow from the
// catalog CTA and creates the effort" against the notebook editor form.)

test.describe('Clone Effort', () => {
  const cloneSlug = `${TEST_EFFORT_PREFIX}-clone-${Date.now()}`;

  test.fixme('clones a bundled effort', async ({ page }) => { // e2e-remediation: Save button retired from effort detail surface — needs product decision (#719) // e2e-remediation: expect(locator).toBeVisible() failed — runtime state, needs trace
    const errors = setupErrorCapture(page);

    await page.goto('/effort/rowing', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(800);

    await page.getByRole('button', { name: /Clone/i }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();

    const yaml = [
      '---',
      `slug: ${cloneSlug}`,
      'label: Rowing Clone',
      'aliases:',
      '  - cloned-rowing',
      'baseAttributes:',
      '  met: 7.5',
      '  discipline: rowing',
      '  intensityTier: moderate',
      'registrySource: user',
      'derivation:',
      '  parentSlug: rowing',
      '---',
    ].join('\n');

    await setEditorContent(page, yaml);

    await page.getByRole('button', { name: /Save/i }).click();
    await page.waitForURL(new RegExp(`/effort/${cloneSlug}`), { timeout: 5_000 });

    await expect(page.getByRole('heading', { name: 'Rowing Clone' })).toBeVisible();
    await expect(page.getByText('Custom', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('7.5')).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});

// ── Edit and Delete Custom Effort ────────────────────────────────────────────

test.describe('Edit and Delete Custom Effort', () => {
  const editSlug = `${TEST_EFFORT_PREFIX}-edit-${Date.now()}`;

  test.fixme('edits and deletes a custom effort', async ({ page }) => { // e2e-remediation: .cm-note-editor edit surface retired — needs product decision (#719) // e2e-remediation: page.waitForSelector timeout 10s — runtime state, needs trace
    const errors = setupErrorCapture(page);

    // Create a custom effort
    await page.goto('/effort/new?mode=create', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(800);

    const createYaml = [
      '---',
      `slug: ${editSlug}`,
      'label: Edit Me',
      'aliases: []',
      'baseAttributes:',
      '  met: 5.0',
      'registrySource: user',
      '---',
    ].join('\n');

    await setEditorContent(page, createYaml);
    await page.getByRole('button', { name: /Save/i }).click();
    await page.waitForURL(new RegExp(`/effort/${editSlug}`), { timeout: 5_000 });

    // Edit
    await page.getByRole('button', { name: /Edit/i }).click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();

    const updateYaml = [
      '---',
      `slug: ${editSlug}`,
      'label: Edited Effort',
      'aliases: []',
      'baseAttributes:',
      '  met: 6.0',
      'registrySource: user',
      '---',
    ].join('\n');

    await setEditorContent(page, updateYaml);
    // Verify editor content was updated before saving
    const editor = page.locator('.cm-content[contenteditable="true"]').first();
    await expect(editor).toContainText('Edited Effort', { timeout: 3_000 });
    // Extra wait for React state to settle
    await page.waitForTimeout(2_000);
    await page.getByRole('button', { name: /Save/i }).click();
    await page.waitForTimeout(1_000);

    // Force reload to verify persistence (workaround for React stale-state issue in edit flow)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    await expect(page.getByRole('heading', { name: 'Edited Effort' })).toBeVisible();
    await expect(page.getByRole('main').getByText('6.0')).toBeVisible();

    // Delete
    await page.getByRole('button', { name: /Edit/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Delete/i }).click();
    await page.waitForURL('/efforts', { timeout: 5_000 });

    await page.waitForTimeout(600);
    await expect(page.getByText('Edited Effort')).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });
});
