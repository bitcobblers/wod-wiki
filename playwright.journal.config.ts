import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';

// Load .env.local overrides (gitignored, machine-local) so HTTPS_HOST is
// available here when the playground dev server is running with TLS.
loadDotenv({ path: resolve(import.meta.dirname, '.env.local'), override: true });

const httpsHost = process.env.HTTPS_HOST;
// Three run modes:
//  - E2E_APP_URL set     → remote deployed artifact (CI: {slug}.preview.wod.wiki).
//                          No local server started.
//  - E2E_TARGET=preview  → serve `apps/playground/dist` via `vite preview` on 4173.
//  - unset               → Vite dev server on 5173 (local development).
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

const journalStorageState = resolve(import.meta.dirname, '.playwright/journal-storage-state.json');
const journalDarkStorageState = resolve(import.meta.dirname, '.playwright/journal-dark-storage-state.json');
const recordingIgnore = process.env.PLAYWRIGHT_RECORDING ? [] : ['**/*-recording.e2e.ts'];
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
  testIgnore: recordingIgnore,

  // Default per-test ceiling; cold-boot and remote feed-sync specs opt into
  // explicit `test.setTimeout(90_000 / 180_000)`.
  timeout: 45 * 1000,
  fullyParallel: false, // scroll tests are sensitive to ordering; run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Remote S3/CloudFront runs use 4 workers per shard; local preview/dev use 2.
  workers: remoteURL
    ? (process.env.CI ? 4 : 2)
    : process.env.CI ? 2 : undefined,
  reporter: process.env.PLAYWRIGHT_BLOB_REPORT
    ? [['blob'], ['github']]
    : process.env.CI
      ? [['html', { open: 'never' }], ['junit', { outputFile: 'test-results/live-e2e-junit.xml' }], ['json', { outputFile: 'test-results/live-e2e-results.json' }], ['github']]
      : 'html',

  use: {
    baseURL: appBaseURL,
    // ponytail: Playwright Chromium 151 defaults to the slow LevelDB path;
    // remove this when its SQLite IndexedDB backend is enabled by default.
    launchOptions: { args: ['--enable-features=IdbSqliteBackingStore'] },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    ignoreHTTPSErrors: trustSelfSigned, // trust self-signed / Tailscale certs locally
  },

  projects: [
    {
      name: 'journal-setup',
      testMatch: '**/setup/journal.setup.ts',
      timeout: 120 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Cold-boot specs measure empty-IndexedDB startup and seed progress gates
      // and must never inherit the pre-seeded storageState snapshot.
      name: 'journal-cold-chromium',
      testMatch: '**/live-app/cold-boot.e2e.ts',
      timeout: 90 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'journal-chromium',
      dependencies: ['journal-setup'],
      testMatch: ['**/live-app/**/*.e2e.ts'],
      testIgnore: ['**/live-app/cold-boot.e2e.ts', ...recordingIgnore],
      use: {
        ...devices['Desktop Chrome'],
        storageState: journalStorageState,
      },
    },
    {
      // Mobile gate (map #990): key routes at a 375px viewport, forced light
      // theme + pre-seeded core IndexedDB from journal-setup.
      name: 'journal-mobile-375',
      dependencies: ['journal-setup'],
      testMatch: '**/gates/*.mobile.smoke.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        storageState: journalStorageState,
      },
    },
    {
      // Dark-theme gate (map #990): same routes with dark forced via the
      // storage key + pre-seeded core IndexedDB from journal-setup.
      name: 'journal-dark',
      dependencies: ['journal-setup'],
      testMatch: '**/gates/journal.dark.smoke.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: journalDarkStorageState,
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
