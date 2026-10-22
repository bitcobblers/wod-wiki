import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { CODEMIRROR_SINGLETON_DEPS, workspaceAliases } from './aliases.ts';

const rootDir = path.resolve(import.meta.dirname, '../..');

// Node builtins referenced by workspace source (storage plane, seed sync)
// resolve to the browser empty shim — the same mapping the playground uses.
const nodeBuiltinShims = [
  'url',
  'node:url',
  'path',
  'node:path',
  'fs',
  'node:fs',
  'child_process',
  'node:child_process',
  'crypto',
  'node:crypto',
];
const nodeShimAliases = Object.fromEntries(
  nodeBuiltinShims.map((id) => [id, path.resolve(rootDir, 'scripts/empty-shim.ts')]),
);

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    react(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', ...CODEMIRROR_SINGLETON_DEPS],
    alias: {
      ...nodeShimAliases,
      ...workspaceAliases(rootDir),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'recharts',
      'lucide-react',
      'clsx',
      'tailwind-merge',
      ...CODEMIRROR_SINGLETON_DEPS,
    ],
    exclude: ['@lezer/common'],
  },
});
