import { defineConfig } from '@playwright/test';

/**
 * Reporter configuration for merging sharded Playwright blob reports in CI:
 *   bun x playwright merge-reports --config playwright.merge.config.ts ./all-blob-reports
 */
export default defineConfig({
  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/live-e2e-junit.xml' }],
    ['json', { outputFile: 'test-results/live-e2e-results.json' }],
    ['github'],
  ],
});
