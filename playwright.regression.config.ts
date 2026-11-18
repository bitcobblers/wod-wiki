import { defineConfig, devices } from '@playwright/test';
import { appBaseURL } from './e2e/utils/url-helpers';

/**
 * Playwright configuration for the QA defect regression suite.
 *
 * One test file per OPEN defect in the QA ledger
 * (https://qa.forest-adhara.ts.net/issues.html), under `e2e/regression/`.
 * Every test asserts the CORRECT behavior, so the suite is EXPECTED TO BE
 * RED while its defect is open — a green test here means the defect is
 * fixed and the test should graduate into the matching live-app journey.
 *
 * This suite is deliberately NOT wired into the required PR checks: it is
 * run on demand against a target app, and its failures are the defect
 * backlog made executable, not build breakage.
 *
 * Targets the deployed playground app only:
 *  - CI:  https://wod.wiki. No local servers are started.
 *  - Local: the Vite dev app, started automatically (existing instances reused).
 *  - E2E_APP_URL overrides the target explicitly.
 *
 * Run with: bun x playwright test --config playwright.regression.config.ts
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
  testDir: './e2e/regression',
  testMatch: '**/*.e2e.ts',

  timeout: 120 * 1000, // Several defects are cold-boot / full-corpus timing paths
  fullyParallel: false, // Run serially for production safety
  forbidOnly: !!process.env.CI,
  retries: 0, // A retry that passes would mask a timing-dependent defect
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/regression', open: 'never' }]],

  use: {
    baseURL: appURL,
    launchOptions: { args: ['--enable-features=IdbSqliteBackingStore'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
