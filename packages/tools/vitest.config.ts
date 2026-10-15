import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const toolsDir = import.meta.dirname;
const repoRoot = resolve(toolsDir, '../..');

export default defineConfig({
  resolve: {
    alias: {
      '@bitcobblers/wod-wiki-core': resolve(repoRoot, 'packages/core/src'),
      '@bitcobblers/wod-wiki-storage': resolve(repoRoot, 'packages/storage/src'),
      '@bitcobblers/wod-wiki-lang': resolve(repoRoot, 'packages/lang/src'),
      '@bitcobblers/wod-wiki-wql': resolve(repoRoot, 'packages/wql/src'),
      '@bitcobblers/wod-wiki-engine': resolve(repoRoot, 'packages/engine/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
