import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Standalone runner for this package (`cd packages/engine && vitest run`).
// The root vitest.config.ts runs engine tests through its workspace project
// with source aliases; this mirrors that so the suite also runs without the
// root runner.
const engineDir = import.meta.dirname;
const repoRoot = resolve(engineDir, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@bitcobblers/wod-wiki-core': resolve(repoRoot, 'packages/core/src'),
      '@bitcobblers/wod-wiki-storage': resolve(repoRoot, 'packages/storage/src'),
      '@bitcobblers/wod-wiki-lang': resolve(repoRoot, 'packages/lang/src'),
      '@bitcobblers/wod-wiki-wql': resolve(repoRoot, 'packages/wql/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
