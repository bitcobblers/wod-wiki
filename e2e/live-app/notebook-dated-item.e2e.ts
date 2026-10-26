import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { compileSeedRow } from '../../packages/tools/src/seedbuild/compiler';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Dated notebook item (/notebook/:slug/:date/:item) — the dated member view
 * resolves its item from a real compiled seed chunk, renders the note, and
 * the workout start path (Play → journal record → day autostart) works.
 *
 * Fixtures are self-seeded (localStorage source + routed manifest/chunks) so
 * no test depends on community-repo content. The core corpus ships no dated
 * notebooks, so the dated shape is exercised through a custom source.
 */

const SOURCE_URL = 'https://dated.example.org/library/';
const SOURCE = { id: 'dated-library', label: 'Dated Library', url: SOURCE_URL };
const CHUNK_ID = 'notebook.dated';
const CHUNK_PATH = `chunks/${CHUNK_ID}.json`;
const SEED_NOTE_PATH = 'markdown/notebooks/dated/2026-02-01/session-1.md';
const SEED_NOTE_BODY = '---\ntags: [dated]\n---\n# Dated Session One\n\n```time\n5 Burpees\n```\n';

/** A real compiled chunk (same pipeline the publisher uses) with its manifest entry. */
function chunkFixture() {
  const rows = [compileSeedRow(SEED_NOTE_PATH, SEED_NOTE_BODY)];
  const bytes = JSON.stringify(rows);
  return {
    rows,
    entry: {
      id: CHUNK_ID,
      path: CHUNK_PATH,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: new TextEncoder().encode(bytes).length,
      count: rows.length,
    },
  };
}

/** Register the custom source before any app script runs and mock its host.
 *  Routes at the CONTEXT level: the seed sync fetches manifest/chunks inside
 *  its Web Worker, and page.route cannot intercept worker-issued fetches. */
async function seedSource(page: Page): Promise<void> {
  const { rows, entry } = chunkFixture();
  await page.addInitScript((source) => {
    localStorage.setItem('wodwiki.seedSources', JSON.stringify([source]));
  }, SOURCE);
  await page.context().route(`${SOURCE_URL}manifest.json`, route =>
    route.fulfill({
      json: {
        schema: 9,
        version: 42,
        builtAt: '2026-10-20T00:00:00.000Z',
        name: SOURCE.label,
        description: 'Seeded e2e dated notebook',
        chunks: [entry],
      },
    }));
  await page.context().route(`${SOURCE_URL}${CHUNK_PATH}`, route => route.fulfill({ json: rows }));
}

test.describe('Dated notebook item — /notebook/:slug/:date/:item', () => {
  // The first seed import of a fresh profile is slow; the dated item page
  // resolves its content from that import, so the default timeout is tight.
  test.setTimeout(180_000);

  test('renders the dated item and the workout start path lands on the day autostart', async ({ page }) => {
    await seedSource(page);
    await page.goto('/settings/sync');
    await page.getByRole('checkbox', { name: 'Subscribed only' }).setChecked(false);
    const row = page.getByTestId('feed-source-dated-library');
    await row.getByTestId('feed-subscribe-dated-library').click();
    await expect(row.getByTestId('feed-sync-status')).toContainText('Up to date', { timeout: 30_000 });
    await waitForFeedReady(page);

    await page.goto('/notebook/dated/2026-02-01/session-1');
    // Route resolves the dated member, not the "not found" fallback. Content
    // renders in the read-only editor, so assert text, not heading roles.
    // A fresh-profile reload re-hydrates the whole app (~30s on CI), so
    // these carry an explicit timeout.
    await expect(page.locator('#dated-session-one')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.cm-content').getByText('5 Burpees')).toBeVisible({ timeout: 90_000 });

    // Workout start path: place the cursor in the wod block and click Play.
    // Overlay decorations can intercept pointer events, so DOM-click.
    await page.locator('.cm-content').getByText('5 Burpees').first().click();
    const play = page.locator('button[aria-label="Play"]').first();
    await expect(play).toBeVisible({ timeout: 10_000 });
    await play.evaluate((el) => (el as HTMLElement).click());

    // Start mints a journal record for today and navigates to the day page
    // (the autostart param is consumed by the day page and stripped from the
    // URL — the journal record is the persistence contract, as in
    // notebook-workout-run).
    await page.waitForURL(/\/day\/\d{4}-\d{2}-\d{2}/, { timeout: 30_000 });
    await expect(page.locator('.cm-content')).toContainText('5 Burpees', { timeout: 30_000 });
    const journalNoteId = await findTodaysJournalNote(page);
    expect(journalNoteId, 'Play must create a journal note for today').toBeTruthy();
  });
});

/** The journal record Play mints — the newest journal-typed note. Seeded
 *  corpus rows are typed 'note', so journal-typed rows are user records. */
async function findTodaysJournalNote(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    return new Promise<string | null>((resolve, reject) => {
      const req = indexedDB.open('wodwiki-db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('notes', 'readonly');
        const getAll = tx.objectStore('notes').getAll();
        getAll.onsuccess = () => {
          const match = (getAll.result as Array<{ id: string; type?: string }>)
            .filter(n => n.type === 'journal' || n.id.startsWith('journal/'))
            .pop();
          db.close();
          resolve(match?.id ?? null);
        };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  });
}
