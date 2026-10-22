import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the deployed-Storybook smoke suite.
 *
 * Targets the Storybook build this pipeline just deployed:
 *  - main:    https://story.wod.wiki        (S3 main/storybook/)
 *  - PR:      https://<slug>.story.wod.wiki (S3 <slug>/storybook/)
 *
 * STORYBOOK_URL is required — this config never starts a local server; it
 * always tests the published artifact (deployed-artifact e2e, mirroring the
 * playground pipeline in the wod-wiki repo).
 *
 * Run with: STORYBOOK_URL=<url> bun x playwright test --config playwright.storybook.config.ts
 */
const baseURL = process.env.STORYBOOK_URL;

if (!baseURL) {
  console.error('STORYBOOK_URL must point at the deployed Storybook to test.');
  process.exit(1);
}

export default defineConfig({
  testDir: './e2e',
  // The database-driven suite needs its own file: it drives a real IndexedDB
  // (seeding, run persistence), so it must not share the smoke file's
  // 30s budget.
  testMatch: ['**/storybook.smoke.e2e.ts', '**/storybook.database.e2e.ts'],

  timeout: 30 * 1000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html'], ['junit', { outputFile: 'test-results/storybook-smoke-junit.xml' }]]
    : [['list'], ['html']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'on',
  },

  projects: [
    {
      name: 'storybook-chromium',
      testMatch: '**/storybook.smoke.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Database gate: the landing page seeds the core corpus over the
      // network, so this suite needs a far bigger budget than the smoke
      // file's 30s.
      name: 'storybook-database',
      testMatch: '**/storybook.database.e2e.ts',
      timeout: 180 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Mobile gate (map #990): flagship stories at a 375px viewport.
      name: 'storybook-mobile-375',
      testMatch: '**/storybook.mobile.smoke.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      // Dark-theme gate (map #990): theme toolbar global applied per story.
      name: 'storybook-dark',
      testMatch: '**/storybook.dark.smoke.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
