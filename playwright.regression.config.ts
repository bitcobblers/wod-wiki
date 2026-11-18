import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';
import { appBaseURL } from './e2e/utils/url-helpers';

loadDotenv({ path: resolve(import.meta.dirname, '.env.local'), override: true });

/**
 * Playwright configuration for the QA defect regression suite.
 *
 * One test file per OPEN defect in the QA ledger
 * (https://qa.forest-adhara.ts.net/issues.html), under `e2e/regression/`.
 * Every test asserts the CORRECT behavior, so the suite is EXPECTED TO BE
 * RED while its defect is open — a green test here means the defect is
 * fixed and the test should graduate into the matching Tier 1/2a/2b/3 suite.
 *
 * This suite is deliberately NOT wired into the required PR checks: it is
 * run on demand against a target app, and its failures are the defect
 * backlog made executable, not build breakage.
 *
 * Targets the deployed playground app only:
 *  - E2E_APP_URL set     → remote deployed artifact. No local server started.
 *  - E2E_TARGET=preview  → serve `apps/playground/dist` via `vite preview` on 4173.
 *  - CI (no E2E_APP_URL) → https://wod.wiki. No local server started.
 *  - unset               → Vite dev server on 5173 (local development).
 *
 * Run with: bun x playwright test --config playwright.regression.config.ts
 */
const isCI = !!process.env.CI;
const httpsHost = process.env.HTTPS_HOST;
const e2eTarget = process.env.E2E_TARGET;
const remoteURL = process.env.E2E_APP_URL;
const hasTailscaleCerts = fs
  .readdirSync(import.meta.dirname)
  .some((f) => f.endsWith('.ts.net.crt'));
const previewBaseURL = hasTailscaleCerts
  ? 'https://localhost:4173'
  : 'http://localhost:4173';
const appURL = remoteURL
  ? remoteURL
  : e2eTarget === 'preview'
    ? previewBaseURL
    : appBaseURL();
const trustSelfSigned = remoteURL || isCI
  ? true
  : e2eTarget === 'preview'
    ? hasTailscaleCerts
    : !!httpsHost;

const webServer = !isCI && !remoteURL
  ? {
      command: e2eTarget === 'preview' ? 'bun run preview:app' : 'bun run dev:app',
      url: appURL,
      ignoreHTTPSErrors: trustSelfSigned, // self-signed / Tailscale certs locally
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
    ignoreHTTPSErrors: trustSelfSigned,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer,
});
