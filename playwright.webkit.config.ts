import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';

loadDotenv({ path: resolve(import.meta.dirname, '.env.local'), override: true });

const remoteURL = process.env.E2E_APP_URL;
const forceHttp = !!process.env.VITE_NO_HTTPS;
const hasTailscaleCerts =
  !forceHttp &&
  fs.readdirSync(import.meta.dirname).some((f) => f.endsWith('.ts.net.crt'));

const localPreviewURL = hasTailscaleCerts
  ? 'https://localhost:4173'
  : 'http://localhost:4173';

const appBaseURL = remoteURL || localPreviewURL;
const trustSelfSigned = remoteURL ? true : hasTailscaleCerts;

/**
 * Single-shard WebKit cross-browser smoke gate (`Desktop Safari` + `iPhone 13`).
 *
 * - CI:    targets deployed S3/CloudFront preview via `E2E_APP_URL`.
 * - Local: serves `apps/playground/dist` via `bun run preview:app` on `:4173`
 *          with `VITE_NO_HTTPS=1` (`http://localhost:4173`).
 *
 * Intentionally omits Chromium-only `--enable-features=IdbSqliteBackingStore`
 * launch flags so WebKit (`Desktop Safari` + `iPhone 13`) launches cleanly.
 */
export default defineConfig({
  testDir: './e2e/webkit',
  testMatch: '**/*.smoke.e2e.ts',

  timeout: 90 * 1000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report/webkit', open: 'never' }],
        ['junit', { outputFile: 'test-results/webkit-smoke-junit.xml' }],
        ['github'],
      ]
    : [['list'], ['html', { outputFolder: 'playwright-report/webkit', open: 'never' }]],

  use: {
    baseURL: appBaseURL,
    browserName: 'webkit',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    ignoreHTTPSErrors: trustSelfSigned,
  },

  projects: [
    {
      name: 'webkit-desktop-safari',
      use: {
        ...devices['Desktop Safari'],
        browserName: 'webkit',
      },
    },
    {
      name: 'webkit-iphone-13',
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],

  webServer: remoteURL
    ? undefined
    : {
        command: 'bun run preview:app',
        url: appBaseURL,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
          ),
          VITE_NO_HTTPS: process.env.VITE_NO_HTTPS ?? '1',
        },
        ignoreHTTPSErrors: trustSelfSigned,
        reuseExistingServer: true,
        timeout: 60 * 1000,
      },
});
