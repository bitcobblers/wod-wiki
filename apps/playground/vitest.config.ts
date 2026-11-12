import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = resolve(import.meta.dirname, '../..');

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  define: {
    __SEED_VERSIONS__: JSON.stringify({ core: 1 }),
  },
  resolve: {
    alias: [
      { find: 'bun:test', replacement: resolve(import.meta.dirname, 'tests/bun-test-shim.ts') },
      { find: /^@\/testing\/(.*)$/, replacement: `${resolve(import.meta.dirname, 'tests/testing')}/$1` },
      { find: '@/testing', replacement: resolve(import.meta.dirname, 'tests/testing/index.ts') },
      { find: /^@wod-wiki\/lang-harness\/(.*)$/, replacement: `${resolve(rootDir, 'packages/lang/tests/harness')}/$1` },
      { find: '@wod-wiki/lang-harness', replacement: resolve(rootDir, 'packages/lang/tests/harness/index.ts') },
      { find: '@bitcobblers/wod-wiki-core/testing', replacement: resolve(rootDir, 'packages/core/src/testing.ts') },
      { find: '@bitcobblers/wod-wiki-core', replacement: resolve(rootDir, 'packages/core/src/index.ts') },
      { find: '@bitcobblers/wod-wiki-lang/react', replacement: resolve(rootDir, 'packages/lang/src/react.ts') },
      { find: '@bitcobblers/wod-wiki-lang', replacement: resolve(rootDir, 'packages/lang/src/index.ts') },
      { find: '@bitcobblers/wod-wiki-storage/idb', replacement: resolve(rootDir, 'packages/storage/src/idb/index.ts') },
      { find: '@bitcobblers/wod-wiki-storage/sql/node', replacement: resolve(rootDir, 'packages/storage/src/sql/node.ts') },
      { find: '@bitcobblers/wod-wiki-storage/sql', replacement: resolve(rootDir, 'packages/storage/src/sql/index.ts') },
      { find: '@bitcobblers/wod-wiki-storage', replacement: resolve(rootDir, 'packages/storage/src/index.ts') },
      { find: '@bitcobblers/wod-wiki-wql', replacement: resolve(rootDir, 'packages/wql/src/index.ts') },
      { find: '@bitcobblers/wod-wiki-engine/agent', replacement: resolve(rootDir, 'packages/engine/src/agent/index.ts') },
      { find: '@bitcobblers/wod-wiki-engine/react', replacement: resolve(rootDir, 'packages/engine/src/react.ts') },
      { find: '@bitcobblers/wod-wiki-engine', replacement: resolve(rootDir, 'packages/engine/src/index.ts') },
      { find: '@bitcobblers/wod-wiki-tools/server', replacement: resolve(rootDir, 'packages/tools/src/server/app.ts') },
      { find: '@bitcobblers/wod-wiki-tools', replacement: resolve(rootDir, 'packages/tools/src/index.ts') },
      { find: '@bitcobblers/wod-wiki-ui/extensions', replacement: resolve(rootDir, 'packages/ui/src/extensions/index.ts') },
      { find: '@bitcobblers/wod-wiki-ui', replacement: resolve(rootDir, 'packages/ui/src/index.ts') },
      { find: /^@\/(.*)$/, replacement: `${resolve(import.meta.dirname, 'src')}/$1` },
    ],
  },
  test: {
    name: 'playground',
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    env: {
      TZ: 'UTC',
    },
    setupFiles: ['./tests/vitest-setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'app/**/*.{test,spec}.{ts,tsx}',
    ],
  },
});
