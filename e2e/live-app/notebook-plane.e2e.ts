import { expect, test, type Page } from '@playwright/test';
import { seedNote } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * The notebook plane (tickets 05 + 08) — user-level behavior over real
 * storage:
 *
 *  - the plane query `:notebook{}` returns the NOTES of every notebook
 *    (never synthetic container rows) and `notebook:<slug>` narrows those
 *    notes — negation narrows the same shape; an empty user notebook yields
 *    no rows, no fake container,
 *  - the /notebooks management list (the NotebookService surface) shows the
 *    always-present notebooks (defaults + the app-owned core references)
 *    plus feed libraries, and user notebooks support create / rename /
 *    delete,
 *  - a note moves between user-owned notebooks through the row action,
 *  - a notebook note clones into the journal (Add to today keeps lineage),
 *  - editability follows notebook ownership: a user-owned note opens an
 *    editable editor; a feed-delivered note opens read-only.
 */

async function createNotebook(page: Page, name: string): Promise<void> {
  await page.getByTestId('notebooks-create-button').click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByPlaceholder('e.g., Morning Routines').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notebook-list')).toContainText(name);
}

/** The Add-to-today handler commits asynchronously; the journal page query
 *  runs once at boot, so wait for the IDB write before navigating there. */
async function waitForJournalNote(page: Page, title: string): Promise<void> {
  await page.waitForFunction(
    (wanted) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('wodwiki-db');
        req.onsuccess = () => {
          const db = req.result as IDBDatabase;
          const tx = db.transaction('notes', 'readonly');
          const cur = tx.objectStore('notes').openCursor();
          cur.onsuccess = () => {
            if (!cur.result) return resolve(false);
            const note = cur.result.value as { type?: string; title?: string };
            if (note.type === 'journal' && note.title === wanted) {
              db.close();
              return resolve(true);
            }
            cur.result.continue();
          };
          cur.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      }),
    title,
    { timeout: 15_000 },
  );
}

test.describe('Notebook plane', () => {
  test.beforeEach(async ({ page }) => {
    // Taller desktop viewport — the move dropdown renders below the feed
    // row; at 720px it opens past the fold and its items stay unreachable.
    await page.setViewportSize({ width: 1280, height: 960 });
    // The feed layout is the surface under test. Layout persists per route in
    // localStorage (default cards) — pin it before every load.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'wodwiki.viewSettings.v1/notebooks',
        JSON.stringify({ level: 'note', layout: 'feed', visibleFields: ['title', 'excerpt', 'date'] }),
      );
    });
  });

  test('the management list shows the always-present notebooks and user CRUD works', async ({ page }) => {
    await page.goto('/notebooks');
    await waitForFeedReady(page);

    const list = page.getByTestId('notebook-list');
    await expect(list).toBeVisible();
    // The always-present notebooks: defaults (app-owned, writable), and the
    // core references delivered by the core feed.
    await expect(list).toContainText('Defaults');
    await expect(list).toContainText('Efforts');
    await expect(list).toContainText('Equipment');
    await expect(list).toContainText('Dashboards');

    // Create → the landing note appears as a Yours row.
    await createNotebook(page, 'Trip 2026');
    const row = page.locator('[data-testid="notebook-list-row"]', { hasText: 'Trip 2026' });
    await expect(row).toBeVisible();

    // Rename through the edit dialog (prefilled).
    await page.getByTestId('notebook-edit-trip-2026').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByPlaceholder('e.g., Morning Routines')).toHaveValue('Trip 2026');
    await dialog.getByPlaceholder('e.g., Morning Routines').fill('Trip 2027');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('notebook-list')).toContainText('Trip 2027');

    // Delete: notes return to the journal, the notebook row disappears. The
    // slug is the notebook's identity — a rename does not re-slug it.
    await page.getByTestId('notebook-delete-trip-2026').click();
    await page.getByTestId('notebook-delete-confirm-trip-2026').click();
    await expect(page.getByTestId('notebook-list')).not.toContainText('Trip 2027');
  });

  test('the notebook plane returns notes from every notebook and narrows by slug', async ({ page }) => {
    // The retired type:feed gate is gone — the defaults notebook holds the
    // starter note and the plane reaches it with a plain notebook: filter.
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:defaults}')}`);
    await waitForFeedReady(page);
    const rows = page.getByTestId('stream-feed-item');
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText('My Workout');

    // A different notebook does not leak in.
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:playground}')}`);
    await expect(page.getByText('My Workout')).toHaveCount(0);

    // Bare `:notebook{}` is the inclusive note plane: notes from EVERY
    // notebook, never synthetic container rows.
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{}')}`);
    await waitForFeedReady(page);
    const all = page.getByTestId('stream-feed-item');
    await expect(all.first()).toBeVisible();
    await expect(all.filter({ hasText: 'My Workout' }).first()).toBeVisible();

    // Negation narrows the same note shape — defaults notes drop out.
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{!notebook:defaults}')}`);
    await waitForFeedReady(page);
    await expect(page.getByText('My Workout')).toHaveCount(0);

    // A fresh user notebook (created from the plain /notebooks surface —
    // the management controls live there) narrows to its real notes. A new
    // notebook ships one landing note, so the plane answers with exactly
    // that note row — never a synthetic container row.
    await page.goto('/notebooks');
    await waitForFeedReady(page);
    await createNotebook(page, 'Trip 2026');
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:trip-2026}')}`);
    await waitForFeedReady(page);
    await expect(page.getByTestId('stream-feed-item')).toHaveCount(1);
  });

  test('a note moves into a user-owned notebook and clones into the journal', async ({ page }) => {
    await page.goto('/notebooks');
    await waitForFeedReady(page);
    await createNotebook(page, 'Trip 2026');
    await createNotebook(page, 'Trip 2027');

    // Move the starter note from defaults into Trip 2026 via the feed row's
    // move action (the feed layout's real control — the shared move menu).
    // The move commits asynchronously and the mounted stream re-runs once it
    // lands — gate on the row leaving the source listing before navigating.
    // A goto straight after the menu click races the uncommitted move, and
    // the target page's one-shot stream query then renders pre-move state.
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:defaults}')}`);
    await waitForFeedReady(page);
    const row = page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' }).first();
    await row.getByTestId('stream-feed-move').click();
    await page.getByTestId('stream-feed-move-notebook/trip-2026').click();
    await expect(page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' })).toHaveCount(0, { timeout: 15_000 });
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:trip-2026}')}`);
    await waitForFeedReady(page);
    await expect(page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' }).first()).toBeVisible();

    // Move it again between user notebooks: the row follows, Trip 2026 is
    // left empty (defaults self-heals its starter; user notebooks do not).
    const movedRow = page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' }).first();
    await movedRow.getByTestId('stream-feed-move').click();
    await page.getByTestId('stream-feed-move-notebook/trip-2027').click();
    await expect(page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' })).toHaveCount(0, { timeout: 15_000 });
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:trip-2027}')}`);
    await waitForFeedReady(page);
    await expect(page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' }).first()).toBeVisible();
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:trip-2026}')}`);
    await waitForFeedReady(page);
    await expect(page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' })).toHaveCount(0);

    // Clone into the journal: Add-to-today copies the note onto today's
    // journal (the handler stays on-page; the journal page shows the clone).
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:trip-2027}')}`);
    await waitForFeedReady(page);
    const finalRow = page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' }).first();
    await finalRow.getByTestId('stream-feed-add').click();
    await waitForJournalNote(page, 'My Workout');
    await page.goto('/journal');
    await waitForFeedReady(page);
    // The default `last 4w` window ends at the captured instant, and the
    // journal date stamp is local midnight — depending on the time of day
    // the stamp can land inside or past the window (pre-existing add-to-
    // today/date-key skew, outside this ticket). 'Remove time window' is an
    // empty-state remedy: it only renders when the windowed stream is empty.
    // Click it when offered; when the clone lands inside the window it is
    // already visible.
    const removeWindow = page.getByRole('button', { name: /Remove time window/ });
    if (await removeWindow.isVisible().catch(() => false)) await removeWindow.click();
    // The journal page renders its own entry cards (not stream-feed-item rows).
    await expect(page.locator('main')).toContainText('My Workout');
  });

  test('editability follows notebook ownership', async ({ page }) => {
    // A user-owned note (the starter note in defaults) opens editable.
    await page.goto(`/notebooks?q=${encodeURIComponent(':notebook{notebook:defaults}')}`);
    await waitForFeedReady(page);
    const row = page.getByTestId('stream-feed-item').filter({ hasText: 'My Workout' }).first();
    await row.getByTestId('stream-feed-open').click();
    await expect(page.locator('.cm-content[contenteditable="true"]').first()).toBeVisible();

    // A feed-delivered note (a seeded collection row) opens read-only.
    // Single-segment id — /notes/:noteId is one path segment.
    await seedNote(page, 'feed-note-ro', '# Delivered Session\n\n```time\n5 Burpees\n```\n', {
      title: 'Delivered Session',
      sourceId: 'collection:notebook-demo/feed-note',
    });
    await page.goto('/note/feed-note-ro');
    await waitForFeedReady(page);
    await expect(page.locator('.cm-content[contenteditable="false"]').first()).toBeVisible();
  });
});
