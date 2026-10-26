import { test, expect } from '@playwright/test';

const source = 'https://catalog.example.org/training/';
const manifest = {
  schema: 9,
  version: 42,
  builtAt: '2026-10-16T00:00:00.000Z',
  name: 'Training catalog',
  description: 'Coach-published workouts',
  repositoryUrl: 'https://github.com/example/training',
  chunks: [],
};

for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
  test(`subscription intake requires consent and remembers auto-sync at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route(`${source}manifest.json`, route => route.fulfill({ json: manifest }));
    await page.goto(`/subscribe?source=${encodeURIComponent(source)}`);

    const banner = page.getByTestId('unknown-feed-intake-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('heading', { name: /Add "Training catalog" to your Library\?/i })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();

    const autoSync = banner.getByRole('checkbox', { name: /Auto-sync updates/i });
    await expect(autoSync).not.toBeChecked();
    await autoSync.check();

    await banner.getByTestId('feed-intake-subscribe').click();
    await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)training-catalog\}$/i);

    // Verify source was registered with autoSync
    await page.goto('/settings/sync');
    const row = page.getByTestId('feed-source-training-catalog');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('feed-autosync-training-catalog')).toBeChecked();
  });
}

test('dismissal replaces the intake history entry without registering a source', async ({ page }) => {
  await page.route(`${source}manifest.json`, route => route.fulfill({ json: manifest }));
  await page.goto(`/subscribe?source=${encodeURIComponent(source)}`);

  const banner = page.getByTestId('unknown-feed-intake-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Decline' }).click();

  await expect(page).toHaveURL(/\/notebooks$/);
  expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();
});

test('import once leaves the source unsubscribed even when auto-sync was checked', async ({ page }) => {
  await page.route(`${source}manifest.json`, route => route.fulfill({ json: manifest }));
  await page.goto(`/subscribe?source=${encodeURIComponent(source)}`);

  const banner = page.getByTestId('unknown-feed-intake-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('checkbox', { name: /Auto-sync updates/i }).check();
  await banner.getByTestId('feed-intake-once').click();

  await expect(page).toHaveURL(/\/notebooks\?q=(:|%3A)notebook\{feed(:|%3A)training-catalog\}$/i);

  await page.goto('/settings/sync');
  const subscribedOnly = page.getByRole('checkbox', { name: 'Subscribed only' });
  await subscribedOnly.setChecked(false);
  const row = page.getByTestId('feed-source-training-catalog');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('feed-subscribe-training-catalog')).toBeVisible();
  await expect(row.getByTestId('feed-autosync-training-catalog')).not.toBeChecked();
});
