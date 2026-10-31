import { test, expect, type Page } from '@playwright/test';
import { waitForFeedReady } from '../helpers/feedReadiness';

/**
 * Mobile gate (journal-mobile-375 project): the CAL layouts render on the
 * real library pages without horizontal overflow at a 375px viewport.
 *
 * Agenda and Planner are the calendar projections of the same result set the
 * Cards/Rows/Feed layouts show. On a phone the planner's board turns vertical
 * (one card per week) and the agenda is a day list — neither may overflow.
 *
 * The layout is a per-route stored setting, so the gate seeds it before the
 * app boots rather than driving the picker.
 */

const VIEW_SETTINGS_KEY = 'wodwiki.viewSettings.v1/notes';

async function seedLayout(page: Page, layout: 'agenda' | 'planner') {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(
        key as string,
        JSON.stringify({ level: 'note', layout: value, visibleFields: ['title', 'date'] }),
      );
    },
    [VIEW_SETTINGS_KEY, layout] as const,
  );
}

test('the agenda layout renders on /notes at 375px without horizontal overflow', async ({ page }) => {
  await seedLayout(page, 'agenda');
  await page.goto('/notes?q=:note{}', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);

  const agenda = page.getByTestId('calendar-agenda-view');
  await expect(agenda).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('the planner layout renders on /notes at 375px without horizontal overflow', async ({ page }) => {
  await seedLayout(page, 'planner');
  await page.goto('/notes?q=:note{}', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);

  const planner = page.getByTestId('calendar-planner-view');
  await expect(planner).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('a planner cell starts a new entry on its own day, with a notebook target', async ({ page }) => {
  await seedLayout(page, 'planner');
  await page.goto('/notes?q=:note{}', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);

  await expect(page.getByTestId('calendar-planner-view')).toBeVisible();

  // Every day cell carries a "+" that starts an entry on THAT day.
  const addButton = page.getByTestId('calendar-planner-add-button').first();
  await expect(addButton).toBeVisible();
  const label = await addButton.getAttribute('aria-label');
  await addButton.click();

  // The dialog opens on the clicked day.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const expectedDate = label?.match(/Add an entry on (\w+) (\d+)/);
  const opened = await page.locator('#journal-create-date').inputValue();
  expect(opened).toBeTruthy();
  // The date the dialog opens on is the date the button names.
  const openedParts = opened.split('-');
  expect(Number(openedParts[2])).toBe(Number(expectedDate?.[2]));

  // The note can be targeted at any notebook the user owns — the journal is
  // the default target.
  const target = page.locator('[data-testid="journal-create-target-notebook"]');
  await expect(target).toBeVisible();
  await expect(target.locator('option').first()).toHaveText('Journal (no notebook)');
});

test('the layout picker offers the calendar layouts only where entries have dates', async ({ page }) => {
  await page.goto('/notes?q=:note{}', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);

  // The page options drawer carries the L3 controls on phones. The controls
  // are mounted in more than one place (the desktop rail stays in the DOM,
  // the dock sheet and the ⋯ sheet both carry them), so every assertion
  // here is scoped to the VISIBLE copy.
  await page.getByRole('button', { name: 'Open page options' }).click();

  await expect(page.locator('[data-testid="l3-layout-agenda"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid="l3-layout-planner"]:visible')).toBeVisible();

  // An effort has no date — the calendar layouts cannot place one, so the
  // picker must not offer them there.
  await page.goto('/efforts', { waitUntil: 'domcontentloaded' });
  await waitForFeedReady(page);
  await page.getByRole('button', { name: 'Open page options' }).click();

  await expect(page.locator('[data-testid="l3-layout-cards"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid="l3-layout-agenda"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-testid="l3-layout-planner"]:visible')).toHaveCount(0);
});
