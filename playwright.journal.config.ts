import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';

// Load .env.local overrides (gitignored, machine-local) so HTTPS_HOST is
// available here when the playground dev server is running with TLS.
loadDotenv({ path: resolve(import.meta.dirname, '.env.local'), override: true });

const httpsHost = process.env.HTTPS_HOST;
// Three run modes:
//  - E2E_APP_URL set     → remote deployed artifact (CI: the S3 preview the
//                          pipeline just published). No local server started.
//  - E2E_TARGET=preview  → serve the production bundle (`bun run build:app`
//                          output) via `vite preview` on port 4173.
//  - unset               → Vite dev server on 5173 (local development).
// `vite preview` inherits the playground config's TLS: Tailscale certs on
// dev machines (https), plain http in CI where no certs exist.
const e2eTarget = process.env.E2E_TARGET;
const remoteURL = process.env.E2E_APP_URL;
const hasTailscaleCerts = fs
  .readdirSync(import.meta.dirname)
  .some((f) => f.endsWith('.ts.net.crt'));
const previewBaseURL = hasTailscaleCerts
  ? 'https://localhost:4173'
  : 'http://localhost:4173';
const appBaseURL = remoteURL
  ? remoteURL
  : e2eTarget === 'preview'
    ? previewBaseURL
    : httpsHost
      ? `https://${httpsHost}:5173`
      : 'http://localhost:5173';
const trustSelfSigned = remoteURL
  ? true // CI preview deploys sit behind CloudFront; be tolerant of cert quirks
  : e2eTarget === 'preview'
    ? hasTailscaleCerts
    : !!httpsHost;

/**
 * Playwright configuration for journal / playground e2e tests.
 * Local: Vite dev server (default) or `vite preview` (E2E_TARGET=preview).
 * CI:    the deployed playground artifact via E2E_APP_URL — the suite always
 *        tests exactly the build that was published.
 * Run with:  bun run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/live-app/**/*.e2e.ts'],

  // Must exceed the seed-claim TTL (45s in seedSync.ts): a page reload can
  // orphan a claim mid-import, and the busy retry converges only after the
  // TTL — a 45s test timeout would cancel the test before that retry fires.
  timeout: 90 * 1000,
  fullyParallel: false, // scroll tests are sensitive to ordering; run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Files run in parallel across workers; with fullyParallel: false, tests
  // within a file still run serially. Remote runs use 4 workers (the target
  // is a static S3 bundle, not a fragile dev server); local preview/dev use
  // 2 to avoid overloading a single machine's transform pipeline.
  workers: remoteURL
    ? (process.env.CI ? 4 : 2)
    : process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['html'], ['junit', { outputFile: 'test-results/live-e2e-junit.xml' }], ['json', { outputFile: 'test-results/live-e2e-results.json' }], ['github']]
    : 'html',

  use: {
    baseURL: appBaseURL,
    // ponytail: Playwright Chromium 151 defaults to the slow LevelDB path;
    // remove this when its SQLite IndexedDB backend is enabled by default.
    launchOptions: { args: ['--enable-features=IdbSqliteBackingStore'] },
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: trustSelfSigned, // trust self-signed / Tailscale certs locally
  },

  projects: [
    {
      name: 'journal-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Mobile gate (map #990): key routes at a 375px viewport, forced light
      // theme so the pass is deterministic. The playground's ThemeProvider
      // reads wod-wiki-playground-theme from localStorage on mount.
      name: 'journal-mobile-375',
      testMatch: '**/gates/journal.mobile.smoke.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        storageState: {
          cookies: [],
          origins: [
            {
              origin: new URL(appBaseURL).origin,
              localStorage: [{ name: 'wod-wiki-playground-theme', value: 'light' }],
            },
          ],
        },
      },
    },
    {
      // Dark-theme gate (map #990): same routes with dark forced via the
      // storage key; asserts html.dark plus rendered content.
      name: 'journal-dark',
      testMatch: '**/gates/journal.dark.smoke.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: {
          cookies: [],
          origins: [
            {
              origin: new URL(appBaseURL).origin,
              localStorage: [{ name: 'wod-wiki-playground-theme', value: 'dark' }],
            },
          ],
        },
      },
    },
  ],

  // No local server in remote mode — the deployed artifact is already live.
  webServer: remoteURL
    ? undefined
    : {
        command: e2eTarget === 'preview' ? 'bun run preview:app' : 'bun run dev:app',
        url: appBaseURL,
        ignoreHTTPSErrors: trustSelfSigned, // self-signed / Tailscale certs locally
        reuseExistingServer: true,
        timeout: 60 * 1000,
      },
});
