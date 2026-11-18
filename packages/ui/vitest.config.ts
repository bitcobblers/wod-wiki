import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * @bitcobblers/wod-wiki-ui tests render React components (CodeMirror widgets, dashboard
 * views, composer), so they run under jsdom. Cross-package imports resolve to
 * source so tests exercise the in-repo implementation, never a stale dist.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    exclude: [...configDefaults.exclude, '**/*.regression.test.{ts,tsx}'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@bitcobblers/wod-wiki-core/testing': resolve(import.meta.dirname, '../core/src/testing.ts'),
      '@bitcobblers/wod-wiki-core': resolve(import.meta.dirname, '../core/src'),
      '@bitcobblers/wod-wiki-lang': resolve(import.meta.dirname, '../lang/src'),
      '@bitcobblers/wod-wiki-wql': resolve(import.meta.dirname, '../wql/src'),
      '@bitcobblers/wod-wiki-ui/primitives': resolve(import.meta.dirname, './src/primitives/index.ts'),
      '@bitcobblers/wod-wiki-ui/extensions': resolve(import.meta.dirname, './src/extensions/index.ts'),
      '@bitcobblers/wod-wiki-ui': resolve(import.meta.dirname, './src/index.ts'),
    },
  },
});
