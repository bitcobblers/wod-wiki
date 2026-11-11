import { defineConfig } from 'vitest/config';
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
  },
  resolve: {
    alias: {
      '@bitcobblers/wod-wiki-core/testing': resolve(import.meta.dirname, '../core/src/testing.ts'),
      '@bitcobblers/wod-wiki-core': resolve(import.meta.dirname, '../core/src'),
      '@bitcobblers/wod-wiki-lang': resolve(import.meta.dirname, '../lang/src'),
      '@bitcobblers/wod-wiki-wql': resolve(import.meta.dirname, '../wql/src'),
    },
  },
});
