import { defineConfig, devices } from '@playwright/test';

const apiPort = Number(process.env.API_E2E_PORT?.trim() || '4190');
const baseURL = process.env.API_E2E_BASE_URL?.trim() || `http://127.0.0.1:${apiPort}`;

/**
 * Playwright configuration for hosted `wod server` (`VITE_STORAGE=api`) +
 * disposable SQLite browser E2E verification.
 *
 * Prerequisite build:
 *   bun run --filter '@bitcobblers/wod-wiki-playground' build:api
 * Run with:
 *   bun x playwright test --config playwright.api.config.ts
 */
export default defineConfig({
  testDir: './e2e/api-hosted',
  testMatch: '**/*.e2e.ts',

  timeout: 90 * 1000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report/api-hosted', open: 'never' }],
        ['junit', { outputFile: 'test-results/api-e2e-junit.xml' }],
        ['github'],
      ]
    : [['list'], ['html', { outputFolder: 'playwright-report/api-hosted', open: 'never' }]],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'api-hosted-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'bun e2e/setup/apiServerLauncher.ts',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
    env: {
      ...process.env,
      API_E2E_PORT: String(apiPort),
    },
  },
});
