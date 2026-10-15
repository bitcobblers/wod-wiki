import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Workspace unit-test runner (`bun run test:package`). Mirrors the original
// vitest.workspace.ts scope: all five packages plus the contract suite under
// tests/contract. The playground and storybook apps run their own runners.
//
// Cross-package imports alias to SOURCE (engine→core, ui→lang…) so tests
// never depend on a prior tsup build and never test a stale dist. Projects
// are declared explicitly (string-form globs don't inherit these aliases in
// Vitest 4); ui keeps its own config for jsdom + testing-library setup.
const workspaceAliases = {
  '@bitcobblers/wod-wiki-core': resolve(import.meta.dirname, 'packages/core/src'),
  '@bitcobblers/wod-wiki-storage': resolve(import.meta.dirname, 'packages/storage/src'),
  '@bitcobblers/wod-wiki-lang': resolve(import.meta.dirname, 'packages/lang/src'),
  '@bitcobblers/wod-wiki-wql': resolve(import.meta.dirname, 'packages/wql/src'),
  '@bitcobblers/wod-wiki-engine': resolve(import.meta.dirname, 'packages/engine/src'),
  '@bitcobblers/wod-wiki-tools': resolve(import.meta.dirname, 'packages/tools/src'),
  '@bitcobblers/wod-wiki-ui': resolve(import.meta.dirname, 'packages/ui/src'),
};

const sourceProject = (name: string, dir: string) => ({
  test: {
    name,
    include: [`${dir}/tests/**/*.test.ts`],
    environment: 'node',
  },
  resolve: { alias: workspaceAliases },
});

export default defineConfig({
  test: {
    projects: [
      sourceProject('core', 'packages/core'),
      sourceProject('lang', 'packages/lang'),
      sourceProject('storage', 'packages/storage'),
      sourceProject('wql', 'packages/wql'),
      sourceProject('engine', 'packages/engine'),
      sourceProject('tools', 'packages/tools'),
      'packages/ui',
      {
        test: {
          name: 'contract',
          include: ['tests/contract/**/*.test.ts'],
          environment: 'node',
        },
        resolve: { alias: workspaceAliases },
      },
    ],
  },
});
