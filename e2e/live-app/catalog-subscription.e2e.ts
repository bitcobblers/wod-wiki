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
    await expect(page.getByRole('heading', { name: 'Subscribe to Training catalog?' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();
    const autoSync = page.getByRole('checkbox', { name: 'Auto-sync this seed' });
    await expect(autoSync).not.toBeChecked();
    await autoSync.check();
    await page.getByRole('button', { name: 'Import & Subscribe', exact: true }).click();
    await expect(page).toHaveURL(/\/catalogs\?manage=1$/);
    const manager = page.getByRole('dialog');
    await expect(manager).toBeVisible();
    await expect(manager.getByText('Training catalog', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('checkbox', { name: /Auto-sync.*Training catalog|Training catalog.*Auto-sync/i })).toBeChecked();
  });
}

test('invalid source is rejected before contacting its host', async ({ page }) => {
  let contacted = false;
  await page.route('http://catalog.example.org/**', route => { contacted = true; return route.abort(); });
  await page.goto(`/subscribe?source=${encodeURIComponent('http://catalog.example.org/training/')}`);
  await expect(page.getByRole('alert')).toContainText('HTTPS');
  expect(contacted).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();
});

test('dismissal replaces the intake history entry without registering a source', async ({ page }) => {
  await page.route(`${source}manifest.json`, route => route.fulfill({ json: manifest }));
  await page.goto(`/subscribe?source=${encodeURIComponent(source)}`);
  await expect(page.getByRole('heading', { name: 'Subscribe to Training catalog?' })).toBeVisible();
  await page.getByRole('button', { name: 'Decline & Dismiss' }).click();
  await expect(page).toHaveURL(/\/catalogs$/);
  expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Subscribe to Training catalog?' })).toHaveCount(0);
});

test('import once leaves the source unsubscribed even when auto-sync was checked', async ({ page }) => {
  await page.route(`${source}manifest.json`, route => route.fulfill({ json: manifest }));
  await page.goto(`/subscribe?source=${encodeURIComponent(source)}`);
  await expect(page.getByRole('heading', { name: 'Subscribe to Training catalog?' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Auto-sync this seed' }).check();
  await page.getByRole('button', { name: 'Import Once', exact: true }).click();
  await expect(page).toHaveURL(/\/catalogs\?manage=1$/);
  const row = page.getByRole('dialog').getByTestId('seed-source-training-catalog');
  await expect(row.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible();
  await expect(row.getByRole('checkbox', { name: /Auto-sync/i })).not.toBeChecked();
  await page.reload();
  await expect(row.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible();
  await expect(row.getByRole('checkbox', { name: /Auto-sync/i })).not.toBeChecked();
});

test('an incompatible manifest cannot offer an import or register a source', async ({ page }) => {
  await page.route(`${source}manifest.json`, route => route.fulfill({ json: { ...manifest, schema: 0 } }));
  await page.goto(`/subscribe?source=${encodeURIComponent(source)}`);
  await expect(page.getByRole('alert')).toContainText('schema');
  await expect(page.getByRole('button', { name: 'Import & Subscribe', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('wodwiki.seedSources'))).toBeNull();
});
