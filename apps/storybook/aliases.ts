import path from 'node:path';

export const CODEMIRROR_SINGLETON_DEPS = [
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lang-markdown',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/markdown',
] as const;

/** Source-dir aliases so Storybook builds without package `dist/`. */
export function workspaceAliases(rootDir: string): Record<string, string> {
  return {
    '@': path.resolve(rootDir, 'apps/playground/src'),
    '@bitcobblers/wod-wiki-core': path.resolve(rootDir, 'packages/core/src'),
    '@bitcobblers/wod-wiki-lang/react': path.resolve(rootDir, 'packages/lang/src/react.ts'),
    '@bitcobblers/wod-wiki-lang': path.resolve(rootDir, 'packages/lang/src'),
    '@bitcobblers/wod-wiki-storage': path.resolve(rootDir, 'packages/storage/src'),
    '@bitcobblers/wod-wiki-wql': path.resolve(rootDir, 'packages/wql/src'),
    '@bitcobblers/wod-wiki-engine/react': path.resolve(rootDir, 'packages/engine/src/react.ts'),
    '@bitcobblers/wod-wiki-engine': path.resolve(rootDir, 'packages/engine/src'),
    '@bitcobblers/wod-wiki-ui/styles.css': path.resolve(rootDir, 'packages/ui/src/styles.css'),
    '@bitcobblers/wod-wiki-ui/extensions': path.resolve(rootDir, 'packages/ui/src/extensions/index.ts'),
    '@bitcobblers/wod-wiki-ui': path.resolve(rootDir, 'packages/ui/src'),
    react: path.resolve(rootDir, 'node_modules/react'),
    'react-dom': path.resolve(rootDir, 'node_modules/react-dom'),
  };
}
