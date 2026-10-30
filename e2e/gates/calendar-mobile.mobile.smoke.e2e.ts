import { test, expect } from '@playwright/test';

/**
 * Mobile gate (journal-mobile-375 project): the mobile CAL layout renders
 * without horizontal overflow at a 375px viewport, in every shape.
 *
 * The CAL layout is a fourth library layout, and on a phone it is a
 * DIFFERENT shape from the desktop month grid — agenda, week strip, month
 * heatmap. Each must fit the narrow viewport, and each must keep its
 * touch targets at the house's 44px minimum: a calendar whose cells are
 * tappable-but-tiny is worse than no calendar.
 */

const SHAPES = ['agenda', 'week', 'month'] as const;

for (const shape of SHAPES) {
  test(`the ${shape} calendar shape fits 375px without horizontal overflow`, async ({ page }) => {
    await page.goto(`/proto/calendar-mobile?v=${shape}`, { waitUntil: 'domcontentloaded' });

    const view = page.getByTestId('calendar-stream-view');
    await expect(view).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}

test('the calendar keeps every touch target at 44px or taller', async ({ page }) => {
  await page.goto('/proto/calendar-mobile?v=agenda', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('calendar-stream-view')).toBeVisible();

  const undersized = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.height < 44) {
        const label = (el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 30);
        bad.push(`${label} (${Math.round(rect.height)}px)`);
      }
    }
    return bad;
  });

  expect(undersized).toEqual([]);
});

test('the month shape opens a day as a bottom sheet with that day\'s notes', async ({ page }) => {
  await page.goto('/proto/calendar-mobile?v=month', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cal-month-grid')).toBeVisible();

  // Oct 16 holds one note ("Elizabeth — 21-15-9" in the girls notebook).
  await page.getByRole('button', { name: /^16, 1 entries$/ }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Elizabeth — 21-15-9')).toBeVisible();
  await expect(sheet.getByText('2026-10-16')).toBeVisible();
});
