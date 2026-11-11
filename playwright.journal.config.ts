import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';

// Load .env.local overrides (gitignored, machine-local) so HTTPS_HOST is
// available here when the playground dev server is running with TLS.
loadDotenv({ path: resolve(import.meta.dirname, '.env.local'), override: true });

const httpsHost = process.env.HTTPS_HOST;
// Four run modes:
//  - E2E_DIST_DIR set    → serve a prebuilt `playground-dist` directory via
//                          `scripts/serve-preview-dist.ts` on 127.0.0.1:4173
//                          (CI shards testing the exact deployed artifact).
//  - E2E_APP_URL set     → remote deployed artifact (manual workflow_dispatch
//                          or ad-hoc remote target). No local server started.
//  - E2E_TARGET=preview  → serve `apps/playground/dist` via `serve-preview-dist.ts`
//                          on 127.0.0.1:4173.
//  - unset               → Vite dev server on 5173 (local development).
const e2eDistDir = process.env.E2E_DIST_DIR;
const e2eTarget = process.env.E2E_TARGET;
const remoteURL = !e2eDistDir ? process.env.E2E_APP_URL : undefined;
const useStaticDistServer = Boolean(e2eDistDir) || e2eTarget === 'preview';
const staticDistDir = e2eDistDir || 'apps/playground/dist';
const staticPreviewPort = Number(process.env.E2E_PREVIEW_PORT || 4173);
const appBaseURL = useStaticDistServer
  ? `http://127.0.0.1:${staticPreviewPort}`
  : remoteURL
    ? remoteURL
    : httpsHost
      ? `https://${httpsHost}:5173`
      : 'http://localhost:5173';
const trustSelfSigned = useStaticDistServer
  ? false
  : remoteURL
    ? true // CI preview deploys sit behind CloudFront; be tolerant of cert quirks
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

  // Fast default failure ceiling; specs that sync remote feeds or exercise the
  // 45s seed-claim TTL opt into explicit `test.setTimeout(90_000 / 180_000)`.
  timeout: 35 * 1000,
  fullyParallel: false, // scroll tests are sensitive to ordering; run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Static dist and remote S3 bundles have no dev transform pipeline, so 4
  // workers saturate a 4-vCPU runner cleanly.
  workers: (useStaticDistServer || remoteURL)
    ? (process.env.CI ? 4 : 4)
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
    : useStaticDistServer
      ? {
          command: `bun scripts/serve-preview-dist.ts --dir "${staticDistDir}" --port ${staticPreviewPort}`,
          url: appBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 30 * 1000,
        }
      : {
          command: 'bun run dev:app',
          url: appBaseURL,
          ignoreHTTPSErrors: trustSelfSigned, // self-signed / Tailscale certs locally
          reuseExistingServer: true,
          timeout: 60 * 1000,
        },
});
