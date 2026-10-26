import fs from 'node:fs';
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

// Read the seed manifest versions stamped by scripts/sync-seed.ts (which runs
// before storybook in both dev and build) from Storybook's OWN public/seed —
// one entry per seed source. A source with no manifest is absent: the runtime
// then always consults that manifest instead of trusting the skip-fetch fast
// path.
function seedManifestVersions(): Record<string, number> {
  const seedDir = path.resolve(import.meta.dirname, 'public/seed');
  const versions: Record<string, number> = {};
  if (!fs.existsSync(seedDir)) return versions;
  for (const entry of fs.readdirSync(seedDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.resolve(seedDir, entry.name, 'manifest.json'), 'utf-8')) as { version?: unknown };
      if (typeof parsed.version === 'number' && parsed.version > 0) versions[entry.name] = parsed.version;
    } catch {
      // Absent/unreadable manifest → source not fast-pathable.
    }
  }
  return versions;
}

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000,
  },
  define: {
    // Build stamp for defaultFeedSources' embeddedVersion (shared
    // seedVersion.ts) — read from Storybook's own generated manifests.
    __FEED_VERSIONS__: JSON.stringify(seedManifestVersions()),
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
