import { expect, test } from '@playwright/test';
import { installFastClock } from '../utils/fastClock';
import { advanceUntilReview } from '../pages/WallClockPage';
import { seedNote } from '../helpers/wodwikiDb';

test('rest overrun advances and completes both sets instead of trapping the session', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('wodwiki.profileInitialized.v1', 'true');
  });
  await installFastClock(page);
  const workout = '(2 Sets)\n  10 Kettlebell Swings 24kg\n  *:30 Rest';
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await seedNote(page, 'playground/rest-overrun', `# rest-overrun\n\n\`\`\`time\n${workout}\n\`\`\`\n`, {
    type: 'playground',
    title: 'rest-overrun',
  });
  await page.goto('/playground/rest-overrun', { waitUntil: 'domcontentloaded' });
  await page.locator('.cm-content').getByText('Kettlebell Swings').click();
  const play = page.getByRole('button', { name: 'Play', exact: true }).first();
  await expect(play).toBeVisible({ timeout: 15_000 });
  await play.evaluate((element) => (element as HTMLElement).click());
  await page.waitForURL(/\/(tracker|run)\//, { timeout: 15_000 });

  await advanceUntilReview(page);

  await expect(page.getByRole('dialog', { name: 'Workout Complete' })).toBeVisible();
  await expect(page.getByText(/Timer can['’]t be skipped/i)).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Kettlebell Swings' })).toHaveCount(2);
});
