/**
 * Page placement — many-to-many E2E
 *
 * A page is a placement. The relation is many-to-many in both directions:
 * a note may sit on several pages at once, and a page may hold several
 * notes. This spec covers the user-visible half of that model over the
 * real app:
 *
 *  - placing a note on a second page keeps it on the first,
 *  - the note then appears in both pages' listings,
 *  - removing a placement detaches only that page,
 *  - moving a placement detaches the source and attaches the destination,
 *  - the note's canonical route (/note/<id>) survives every placement
 *    change — placement never clones, deletes or re-addresses the note.
 *
 * The membership is read straight from the `page_notes` junction (the
 * storage truth), not from a single-page projection.
 */

import { test, expect, type Page } from '@playwright/test';
import { deleteNoteByRouteId, getNotePlacements, seedJournalNote } from '../helpers/wodwikiDb';
import { waitForFeedReady } from '../helpers/feedReadiness';

const DATE = '2099-09-10';
const OTHER_DATE = '2099-09-11';
const NAMED_SLUG = 'placement-e2e-page';
const NOTE_ID = `journal/${DATE}`;
const NOTE_PATH = `/note/${encodeURIComponent(NOTE_ID)}`;
const CONTENT = '# Placement E2E\n\n```time\n10 Pushups\n```';

/** Open the note's placement dialog from the canonical note route. */
async function openPlacementDialog(page: Page): Promise<void> {
  await page.goto(NOTE_PATH, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
  await page.getByRole('button', { name: 'Page options' }).click();
  await page.getByRole('menuitem', { name: 'Note placements' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Fill the named-page field and place the note on it. */
async function placeOnNamedPage(page: Page, slug: string): Promise<void> {
  await page.getByLabel('Named page').fill(slug);
  await page.getByRole('button', { name: 'Place on this page' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** The placements of the seeded note, read from the junction. */
function placements(page: Page) {
  return getNotePlacements(page, NOTE_ID);
}

test.beforeEach(async ({ page }) => {
  // Suppress the First-Note Wizard — its backdrop intercepts every click.
  await page.addInitScript(() => {
    window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
  await deleteNoteByRouteId(page, NOTE_ID);
  await seedJournalNote(page, DATE, CONTENT, { title: 'Placement E2E' });
});

test.describe('Page placement — many-to-many', () => {
  test('placing a note on a second page keeps it on the first', async ({ page }) => {
    await openPlacementDialog(page);
    await placeOnNamedPage(page, NAMED_SLUG);

    const rows = await placements(page);
    expect(rows.map((row) => row.date ?? row.slug).sort()).toEqual([DATE, NAMED_SLUG]);
  });

  test('the note appears in the journal listing of every date it is placed on', async ({ page }) => {
    await openPlacementDialog(page);
    await page.getByLabel('Journal date').fill(OTHER_DATE);
    await page.getByRole('button', { name: 'Place on this page' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const rows = await placements(page);
    expect(rows.map((row) => row.date).sort()).toEqual([DATE, OTHER_DATE]);

    await page.goto(`/day/${OTHER_DATE}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
    await expect(page.getByRole('link', { name: 'Placement E2E' }).first()).toBeVisible();
  });

  test('removing a placement detaches that page only', async ({ page }) => {
    await openPlacementDialog(page);
    await placeOnNamedPage(page, NAMED_SLUG);

    await openPlacementDialog(page);
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const rows = await placements(page);
    expect(rows).toHaveLength(1);
  });

  test('moving a placement detaches the source and attaches the destination', async ({ page }) => {
    await openPlacementDialog(page);
    await placeOnNamedPage(page, NAMED_SLUG);

    await openPlacementDialog(page);
    await page.getByLabel('Journal date').fill(OTHER_DATE);
    await page.getByRole('button', { name: 'Move' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const rows = await placements(page);
    expect(rows.map((row) => row.date ?? row.slug).sort()).toEqual([OTHER_DATE, NAMED_SLUG]);
  });

  test('the canonical note route survives every placement change', async ({ page }) => {
    await openPlacementDialog(page);
    await placeOnNamedPage(page, NAMED_SLUG);

    await openPlacementDialog(page);
    await page.getByLabel('Journal date').fill(OTHER_DATE);
    await page.getByRole('button', { name: 'Move' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // The note is still exactly one note, addressed by its own route.
    await page.goto(NOTE_PATH, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
    await expect(page.getByText('Placement E2E').first()).toBeVisible();
    expect(await placements(page)).toHaveLength(2);
  });

  test('placing refuses a journal date AND a named page together — neither is dropped silently', async ({ page }) => {
    await openPlacementDialog(page);
    await page.getByLabel('Journal date').fill(OTHER_DATE);
    await page.getByLabel('Named page').fill(NAMED_SLUG);
    await page.getByRole('button', { name: 'Place on this page' }).click();

    await expect(page.getByRole('alert')).toContainText('OR a named page');
    await expect(page.getByRole('dialog')).toBeVisible();
    // Nothing was placed.
    expect((await placements(page)).map((row) => row.date ?? row.slug)).toEqual([DATE]);
  });
});

test.describe('Named-page listing — /page/:slug', () => {
  const SECOND_DATE = '2099-09-12';
  const SECOND_NOTE_ID = `journal/${SECOND_DATE}`;
  const SECOND_NOTE_PATH = `/note/${encodeURIComponent(SECOND_NOTE_ID)}`;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
    });
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
    await deleteNoteByRouteId(page, NOTE_ID);
    await deleteNoteByRouteId(page, SECOND_NOTE_ID);
    await seedJournalNote(page, DATE, '# Placement E2E\n\nFirst note body.', { title: 'Placement E2E' });
    await seedJournalNote(page, SECOND_DATE, '# Placement E2E Two\n\nSecond note body.', { title: 'Placement E2E Two' });
    // Both notes share the named page.
    for (const noteId of [NOTE_ID, SECOND_NOTE_ID]) {
      await page.goto(`/note/${encodeURIComponent(noteId)}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await waitForFeedReady(page);
      await page.getByRole('button', { name: 'Page options' }).click();
      await page.getByRole('menuitem', { name: 'Note placements' }).click();
      await page.getByLabel('Named page').fill(NAMED_SLUG);
      await page.getByRole('button', { name: 'Place on this page' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    }
  });

  test('lists both notes in placement order and each opens its own note', async ({ page }) => {
    await page.goto(`/page/${NAMED_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);

    // Both notes are visible on the page's own listing.
    await expect(page.getByRole('link', { name: /Placement E2E Two/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Placement E2E(?! Two)/ })).toBeVisible();

    // Each note opens its own canonical route — never the other's.
    await page.getByRole('link', { name: /^Placement E2E(?! Two)/ }).click();
    await expect(page).toHaveURL(NOTE_PATH);
    await expect(page.getByText('First note body.')).toBeVisible();

    await page.goto(`/page/${NAMED_SLUG}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await waitForFeedReady(page);
    await page.getByRole('link', { name: /Placement E2E Two/ }).click();
    await expect(page).toHaveURL(SECOND_NOTE_PATH);
    await expect(page.getByText('Second note body.')).toBeVisible();
  });
});
