import { defineConfig, devices } from '@playwright/test';
import { appBaseURL } from './e2e/utils/url-helpers';

/**
 * Playwright configuration for smoketests.
 *
 * Targets the deployed playground app only:
 *  - CI:  https://wod.wiki. No local servers are started.
 *  - Local: the Vite dev app, started automatically (existing instances reused).
 *  - E2E_APP_URL overrides the target explicitly.
 *
 * Storybook smoke coverage lives in the wod-wiki-engine repository against
 * its own deployed Storybook.
 *
 * Run with: bun x playwright test --config playwright.smoke.config.ts
 */
const isCI = !!process.env.CI;
const appURL = appBaseURL();

const webServer = !isCI && !process.env.E2E_APP_URL
  ? {
      command: 'bun run dev:app',
      url: appURL,
      ignoreHTTPSErrors: true, // self-signed / Tailscale certs locally
      reuseExistingServer: true,
      timeout: 60 * 1000,
    }
  : undefined;

export default defineConfig({
  testDir: './e2e/smoke',
  testMatch: '**/*.smoke.e2e.ts',

  timeout: 30 * 1000,
  fullyParallel: false, // Run serially for production safety
  forbidOnly: !!process.env.CI,
  retries: 1, // One retry for flaky network issues
  workers: isCI ? 2 : 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/smoke', open: 'never' }]],

  use: {
    baseURL: appURL,
    launchOptions: { args: ['--enable-features=IdbSqliteBackingStore'] },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer,
});
