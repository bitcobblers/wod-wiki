import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Dedicated Tier 1 regression test runner (`vitest run --config vitest.regression.config.ts`).
 *
 * Runs expected-red (and passing) `*.regression.test.{ts,tsx}` suites across
 * `packages/*` without affecting standard PR checks (`bun run test:package` / `bun run test`).
 * Once a defect is fixed, graduate its regression test by renaming it to
 * `*.test.ts(x)` (or merging it into the canonical suite).
 */
const workspaceAliases = {
  '@wod-wiki/lang-harness': resolve(import.meta.dirname, 'packages/lang/tests/harness'),
  '@bitcobblers/wod-wiki-core/testing': resolve(import.meta.dirname, 'packages/core/src/testing.ts'),
  '@bitcobblers/wod-wiki-core': resolve(import.meta.dirname, 'packages/core/src'),
  '@bitcobblers/wod-wiki-storage/sql': resolve(import.meta.dirname, 'packages/storage/src/sql/index.ts'),
  '@bitcobblers/wod-wiki-storage/idb': resolve(import.meta.dirname, 'packages/storage/src/idb/index.ts'),
  '@bitcobblers/wod-wiki-storage': resolve(import.meta.dirname, 'packages/storage/src'),
  '@bitcobblers/wod-wiki-lang': resolve(import.meta.dirname, 'packages/lang/src'),
  '@bitcobblers/wod-wiki-wql': resolve(import.meta.dirname, 'packages/wql/src'),
  '@bitcobblers/wod-wiki-engine/agent': resolve(import.meta.dirname, 'packages/engine/src/agent/index.ts'),
  '@bitcobblers/wod-wiki-engine': resolve(import.meta.dirname, 'packages/engine/src'),
  '@bitcobblers/wod-wiki-tools/server': resolve(import.meta.dirname, 'packages/tools/src/server/app.ts'),
  '@bitcobblers/wod-wiki-tools': resolve(import.meta.dirname, 'packages/tools/src'),
  '@bitcobblers/wod-wiki-ui': resolve(import.meta.dirname, 'packages/ui/src'),
};

const regressionProject = (name: string, dir: string) => ({
  test: {
    name: `${name}-regression`,
    include: [`${dir}/tests/**/*.regression.test.ts`],
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: { alias: workspaceAliases },
});

export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
    projects: [
      regressionProject('core', 'packages/core'),
      regressionProject('lang', 'packages/lang'),
      regressionProject('storage', 'packages/storage'),
      regressionProject('wql', 'packages/wql'),
      regressionProject('engine', 'packages/engine'),
      regressionProject('tools', 'packages/tools'),
      {
        test: {
          name: 'ui-regression',
          include: ['packages/ui/{src,test}/**/*.regression.test.{ts,tsx}'],
          globals: true,
          environment: 'jsdom',
          setupFiles: [resolve(import.meta.dirname, 'packages/ui/test/setup.ts')],
          testTimeout: 20000,
          hookTimeout: 20000,
        },
        resolve: { alias: workspaceAliases },
      },
    ],
  },
});
