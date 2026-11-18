import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { CODEMIRROR_SINGLETON_DEPS, workspaceAliases } from './aliases.ts';

const rootDir = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', ...CODEMIRROR_SINGLETON_DEPS],
    alias: workspaceAliases(rootDir),
  },
  test: {
    name: 'storybook-regression',
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: [
      path.resolve(import.meta.dirname, 'test/setup.ts'),
      path.resolve(rootDir, 'apps/playground/src/testing/vitest-setup.ts'),
    ],
    include: ['test/regression/**/*.regression.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
